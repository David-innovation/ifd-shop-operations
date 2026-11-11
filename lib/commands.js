'use strict';
/* Changes with rules the server itself enforces, whichever screen or script asks for them:
   marking carpet as cut, recording money, and sending messages to customers.
   The rules are the same ones the screens use (they are loaded from the same code), so the two cannot drift apart. */
const crypto = require('node:crypto');
const storeLib = require('./store'), sms = require('./sms'), mail = require('./mail');

const err = (status, code, message, more) => ({status, code, message, more:more || null});
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max || 200);
const KEY = /^[A-Za-z0-9_-]{6,64}$/;
const KINDS = {quote:'Quote', confirm:'Fitting confirmation', receipt:'Receipt', other:'Message'};
const BY_HAND = {email:'by email from their own mailbox', sms:'by text from their own phone', phone:'by phone', hand:'in person', post:'by post'};

function make(o){
  const st = o.st, L = o.L, texter = o.texter, mailer = o.mailer, now = o.now, log = o.log, broadcast = o.broadcast;
  const iso = () => new Date(now()).toISOString(), key = p => p + now().toString(36) + crypto.randomBytes(4).toString('hex');
  const SYSTEM = {id:'system', name:'The system', role:'system'};

  function jobOf(id){
    const d = storeLib.docPath('jobs/' + String(id || '')); if (!d) throw err(400, 'invalid_argument', 'That is not a job.');
    const r = st.getDoc(d.path); if (!r.exists) throw err(404, 'not_found', 'That job does not exist.');
    return {d, job:Object.assign({}, r.data, {id:d.id})};
  }
  function save(d, patch, user, text){
    const p = Object.assign({}, patch);
    if (p.msgs) {
      const current = st.getDoc(d.path);
      if (current.exists) Object.assign(p, require('./arrival-sync').patch(storeLib.merge(JSON.parse(JSON.stringify(current.data)), p)));
    }
    if (text){ p.log = {}; p.log[key('g')] = {at:iso(), by:user.id, text:text}; }
    st.updateDoc(d, p); reconcile(d); st.audit(user.id, 'command', d.path + (text ? ': ' + text : '')); broadcast(d.coll);
  }
  function diaryContext(){
    const settings=st.getDoc('settings/main').data||{}, off={};
    st.list('timeoff').forEach(x=>{if(x.data.name)off[x.data.name]=x.data.days||{};});
    return {off,ctx:{jobs:st.list('jobs').map(x=>({...x.data,id:x.id})),limits:settings.limits}};
  }
  function reconcile(d){
    if(d.coll!=='jobs')return;
    const found=st.getDoc(d.path);if(!found.exists)return;
    const job={...found.data,id:d.id}, p=require('./arrival-sync').patch(job);
    // Legacy pack-flooring jobs still need manual allocation; new acceptances retain the complete pack plan.
    const hasPackFloor=L.roomsOf(job).some(r=>(L.specOf(r)||{}).floor==='flooring');
    if(job.diaryAuto && (!hasPackFloor || job.accepted?.packs?.groups?.length) && !job.diary && job.status==='open' && job.date>=iso().slice(0,10)){
      const {off,ctx}=diaryContext();
      if(L.canConfirmDiary(job,off,ctx).ok && L.canComplete(job).ok){
        p.diary=true;p.diaryAuto=false;p.fittingSheetRequired=true;p.log={};p.log[key('g')]={at:iso(),by:'system',text:'Added to diary automatically after all stock was prepared and checked. Customer job-confirmation email is waiting to be sent.'};
      }
    }
    if(Object.keys(p).length)st.updateDoc(d,p);
  }
  const nameOf = (b, user) => { const n = clean(b.byName, 60); if (!n) throw err(400, 'invalid_argument', 'Type your name.'); return n; };

  /* ---------- cutting ----------
     A piece is only marked as cut when nothing is holding the job: sizes verified, no review outstanding, and the carpet
     sold still covering the floor as measured. The owner can override with a reason, and that is written on the job. */
  function cut(b, user){
    const {d, job} = jobOf(b.jobId), l = L.linesOf(job).filter(x => x.k === b.lineK)[0];
    if (!l) throw err(404, 'not_found', 'That item is not on the job.');
    if (l.unit !== 'm') throw err(400, 'invalid_argument', 'Only carpet off a roll is marked as cut.');
    if (l.picked) return {ok:true, duplicate:true};
    const name = nameOf(b, user), bay = clean(b.bay || l.bay, 40).toUpperCase();
    if (!bay) throw err(400, 'invalid_argument', 'Say where the cut piece is now.');
    if (!L.isFinalBay(bay)) throw err(400, 'invalid_argument', 'GOODS-IN is not a final place. Choose where the cut piece has been put.');
    const why = L.cutBlocks(job, l), len = (Number(l.qty) / 10).toFixed(1), rec = {state:'allocated', bay:bay, picked:true, cutAt:iso(), cutBy:name, cutById:user.id};
    if(Array.isArray(l.cuts) && l.cuts.reduce((n,c)=>n+Number(c.length||0),0)>Number(l.qty)/10+0.001) why.push('The reserved carpet is shorter than the saved room cutting plan.');
    let extra = '';
    if (why.length){
      const reason = clean(b.override && b.override.reason, 400);
      if (!reason) throw err(409, 'held', 'This cannot be cut yet. ' + why.join(' '), {why:why});
      if (user.role !== 'owner') throw err(403, 'forbidden', 'Only the owner can override a hold. ' + why.join(' '), {why:why});
      if (reason.length < 10) throw err(400, 'invalid_argument', 'Give the reason for cutting it anyway, in a few words.');
      rec.cutOverride = {at:iso(), by:user.id, byName:user.name, reason:reason, holds:why};
      extra = '. HOLD OVERRIDDEN by ' + user.name + ': ' + reason + '. Held at the time for: ' + why.join(' ');
    }
    const patch = {lines:{}}; patch.lines[l.k] = rec;
    save(d, patch, user, len + ' m of ' + l.title + ' cut by ' + name + ' and put in ' + bay + extra);
    return {ok:true, override:!!rec.cutOverride};
  }

  /* ---------- money ----------
     This records money that has already been taken on the card machine, in cash or by transfer. It never charges a card.
     Nothing is ever deleted: a wrong entry is struck out with a reason and a refund is its own entry. */
  function pay(b, user){
    const {d, job} = jobOf(b.jobId), kind = clean(b.kind, 20) || 'payment', name = nameOf(b, user), patch = {pay:{}}, mine = job.pay || {};
    const method = clean(b.method, 40) || 'Other', money = L.money;
    if (kind === 'void'){
      const e = mine[b.payK]; if (!e) throw err(404, 'not_found', 'That entry is not on the job.');
      if (e.void) return {ok:true, duplicate:true};
      const reason = clean(b.reason, 300); if (reason.length < 5) throw err(400, 'invalid_argument', 'Say why this entry is being struck out.');
      patch.pay[b.payK] = {void:{at:iso(), by:user.id, byName:name, reason:reason}};
      save(d, patch, user, (e.kind === 'refund' ? 'Refund' : 'Payment') + ' of ' + money(e.amount) + ' (' + (e.method || 'no method') + ') struck out by ' + name + ': ' + reason);
      return {ok:true};
    }
    const k = String(b.key || ''); if (!KEY.test(k)) throw err(400, 'invalid_argument', 'That request has no reference, so it cannot be recorded safely. Close this and try again.');
    const pk = 'p' + k; if (mine[pk]) return {ok:true, duplicate:true, pay:mine[pk]};       /* the same request arriving twice is one payment */
    const amount = L.round2(b.amount); if (!(amount > 0)) throw err(400, 'invalid_argument', 'Enter the amount.');
    const note = clean(b.note, 300);
    if (kind === 'refund'){
      const paid = L.paidOf(job), reason = clean(b.reason, 300);
      if (amount > paid + 0.004) throw err(409, 'over_refund', paid > 0 ? 'Only ' + money(paid) + ' has been paid on this job, so ' + money(amount) + ' cannot be refunded.' : 'Nothing has been paid on this job, so there is nothing to refund.');
      if (reason.length < 5) throw err(400, 'invalid_argument', 'Say why the money is going back.');
      patch.pay[pk] = {at:iso(), amount:amount, method:method, by:user.id, byName:name, kind:'refund', reason:reason};
      save(d, patch, user, 'Recorded a refund of ' + money(amount) + ' by ' + method.toLowerCase() + ': ' + reason + '. Entered by ' + name);
      return {ok:true, pay:patch.pay[pk]};
    }
    if (kind !== 'payment' && kind !== 'correction') throw err(400, 'invalid_argument', 'That is not a kind of entry.');
    if (job.status === 'cancelled') throw err(409, 'invalid_state', 'This job is cancelled, so no payment can be recorded on it.');
    let bal = L.balanceOf(job), text = '';
    if (kind === 'correction'){
      const e = mine[b.payK], reason = clean(b.reason, 300);
      if (!e || e.void) throw err(404, 'not_found', 'That entry is not on the job, or has already been struck out.');
      if (e.kind === 'refund') throw err(400, 'invalid_argument', 'A refund is struck out, not corrected.');
      if (reason.length < 5) throw err(400, 'invalid_argument', 'Say what was wrong with the entry.');
      patch.pay[b.payK] = {void:{at:iso(), by:user.id, byName:name, reason:reason, replacedBy:pk}};
      bal = L.round2(bal + (Number(e.amount) || 0));
      text = 'Payment of ' + money(e.amount) + ' (' + (e.method || 'no method') + ') corrected by ' + name + ': ' + reason + '. ';
    }
    const rec = {at:iso(), amount:amount, method:method, by:user.id, byName:name, kind:'payment'};
    if (note) rec.note = note; if (kind === 'correction') rec.corrects = b.payK;
    if (amount > bal + 0.004){
      const over = L.round2(amount - Math.max(0, bal));
      if (b.excess === 'change'){
        if (!(bal > 0)) throw err(409, 'nothing_owed', 'Nothing is owed to the shop on this job, so there is no payment to take.', {balance:bal});
        rec.amount = L.round2(bal); rec.tendered = amount; rec.change = over;
      } else if (b.excess === 'credit') rec.credit = over;
      else throw err(409, 'overpayment', bal > 0 ? 'That is ' + money(over) + ' more than the ' + money(bal) + ' still to pay the shop.' : 'Nothing is owed to the shop on this job.', {over:over, balance:bal});
    }
    patch.pay[pk] = rec;
    save(d, patch, user, text + 'Recorded ' + money(rec.amount) + ' taken by ' + method.toLowerCase() + (rec.tendered ? ' (' + money(rec.tendered) + ' handed over, ' + money(rec.change) + ' change given)' : '')
      + (rec.credit ? ', which leaves the customer ' + money(rec.credit) + ' in credit' : '') + '. Entered by ' + name);
    return {ok:true, pay:rec};
  }

  /* ---------- messages to customers ----------
     Prepared: copied or opened in an app, nothing known to have gone. Queued: handed to the email or text service.
     Sent: the service accepted it and gave a reference. Delivered: the text service reports the handset took it.
     Failed: it did not go, with the reason. By hand: a member of staff states they sent it themselves. */
  function msgSettings(){
    const r = st.getDoc('settings/main'), m = (r.exists && r.data.msgs) || {};
    return {testOnly:m.testOnly !== false, allow:(Array.isArray(m.allow) ? m.allow : []).map(normTo).filter(Boolean)};
  }
  function normTo(v){ const s = String(v || '').trim(); return s.indexOf('@') !== -1 ? (mail.validEmail(s) ? s.toLowerCase() : '') : sms.normaliseMobile(s); }
  function draftOf(b, user, loose, job){
    const kind = clean(b.kind, 20), channel = clean(b.channel, 20), body = String(b.body == null ? '' : b.body).replace(/\r\n/g, '\n').trim();
    if (!KINDS[kind]) throw err(400, 'invalid_argument', 'That is not a kind of message.');
    if (!body) throw err(400, 'invalid_argument', 'There is no message to send.');
    if (body.length > (channel === 'sms' ? 1500 : 6000)) throw err(400, 'invalid_argument', 'That message is too long' + (channel === 'sms' ? ' for a text.' : '.'));
    if (kind === 'quote' && L.hasSize(body, job)) throw err(400, 'has_sizes', 'There is a size in the message. Take it out: customers are only given the figures.');
    let to = clean(b.to, 160);
    if (!loose){
      if (channel === 'email'){ if (!mail.validEmail(to)) throw err(400, 'invalid_argument', 'That is not an email address.'); to = to.toLowerCase(); }
      else if (channel === 'sms'){ to = sms.normaliseMobile(to); if (!to) throw err(400, 'invalid_argument', 'That is not a mobile number.'); }
      else throw err(400, 'invalid_argument', 'Choose email or text.');
    }
    const m = {kind:kind, channel:channel, to:to, body:body, rev:clean(b.rev, 80), byName:nameOf(b, user)};
    if (channel === 'email') m.subject = clean(b.subject, 160).replace(/[\r\n]+/g, ' ') || 'A message from the shop';
    if (b.snap && typeof b.snap === 'object' && !Array.isArray(b.snap) && JSON.stringify(b.snap).length <= 2000) m.snap = b.snap;
    if (kind === 'confirm' && job) m.revNo = L.confirmRevNo(job, m.rev);              /* which set of booking details this was: 1, 2, 3 */
    return m;
  }
  function allowed(m){
    const prov = m.channel === 'email' ? mailer : texter;
    if (!prov.ready) throw err(409, 'not_set_up', m.channel === 'email' ? 'Email sending has not been set up yet, so nothing was sent. Use another way and record it by hand.' : 'Texting has not been set up yet, so nothing was sent. Use another way and record it by hand.');
    const cfg = msgSettings();
    if (cfg.testOnly && cfg.allow.indexOf(m.to) === -1) throw err(403, 'test_mode', 'Messages are in test mode, so they only go to the owner’s test details. Nothing was sent to ' + m.to + '.');
  }
  const went = m => (m.channel === 'email' ? ' emailed to ' : ' texted to ') + m.to + ' by ' + m.byName;
  const goneOk = st => st === 'sent' || st === 'delivered';
  async function deliver(d, mk, rec, user){
    const tk = key('t'), patch = {tries:{}}; let ref = '';
    try {
      const r = rec.channel === 'email' ? await mailer.send({to:rec.to, subject:rec.subject, text:rec.body,html:rec.kind==='confirm'?require('./fitting-sheet').html(rec.body):undefined}) : await texter.send(rec.to, rec.body);
      ref = (r && r.ref) || '';
      Object.assign(patch, {state:'sent', ref:ref, sentAt:iso(), err:''}); patch.tries[tk] = {at:iso(), ok:true, ref:ref};
    } catch (e){
      const why = clean(e && e.message, 300) || 'It could not be sent.';
      /* handed over but no answer came back: it may have gone. Never treated as failed, so it cannot be resent blind. */
      if (e && e.unsure){ Object.assign(patch, {state:'unsure', unsureAt:iso(), err:why}); if (e.ref) patch.ref = clean(e.ref, 200); patch.tries[tk] = {at:iso(), ok:false, unsure:true, err:why}; }
      else { Object.assign(patch, {state:'failed', failedAt:iso(), err:why}); patch.tries[tk] = {at:iso(), ok:false, err:why}; }
    }
    const p = {msgs:{}}; p.msgs[mk] = patch;
    save(d, p, user, KINDS[rec.kind] + went(rec) + (patch.state === 'sent' ? '. Accepted by the ' + (rec.channel === 'email' ? 'mail server' : 'text service') + (ref ? ', reference ' + ref : '')
      : patch.state === 'unsure' ? '. NOT KNOWN WHETHER IT WENT: ' + patch.err : '. IT DID NOT SEND: ' + patch.err));
    if (patch.state === 'sent' && rec.channel === 'sms' && ref) watch(d.id, mk, ref);
    if (patch.state === 'unsure' && rec.channel === 'sms') watchUnsure(d.id, mk);
    return {ok:patch.state === 'sent', state:patch.state, mk:mk, msg:Object.assign({}, rec, patch)};
  }
  async function msgSend(b, user){
    const {d, job} = jobOf(b.jobId), m = draftOf(b, user, false, job), k = String(b.key || '');
    if (!KEY.test(k)) throw err(400, 'invalid_argument', 'That request has no reference, so it cannot be sent safely. Close this and try again.');
    const mk = 'm' + k, mine = job.msgs || {};
    if (mine[mk]) return {ok:goneOk(mine[mk].state), state:mine[mk].state, duplicate:true, mk:mk, msg:mine[mk]};        /* the same request twice is one message, and the answer is how far that one has got */
    allowed(m);
    /* an earlier send of this to the same place that may or may not have gone has to be sorted out first, even if a second copy is meant */
    const hanging = L.msgsOf(job).filter(x => x.kind === m.kind && String(x.rev || '') === m.rev && x.channel === m.channel && x.to === m.to && x.state === 'unsure')[0];
    if (hanging) throw err(409, 'unsure_first', 'An earlier send of this to ' + m.to + ' is not known to have gone. Sort that one out first, so the customer does not get it twice.', {mk:hanging.k});
    if (!b.again){
      const dup = L.msgsOf(job).filter(x => x.kind === m.kind && String(x.rev || '') === m.rev && x.channel === m.channel && x.to === m.to && (x.state === 'queued' || x.state === 'sent' || x.state === 'delivered'))[0];
      if (dup) throw err(409, 'already_sent', 'This has already gone to ' + m.to + '. Use Send it again only if you mean them to get it twice.', {mk:dup.k});
    }
    const rec = Object.assign(m, {state:'queued', at:iso(), by:user.id}), p = {msgs:{}}; p.msgs[mk] = rec;
    save(d, p, user, null);
    return deliver(d, mk, rec, user);
  }
  async function msgRetry(b, user){
    const {d, job} = jobOf(b.jobId), rec = (job.msgs || {})[b.mk];
    if (!rec) throw err(404, 'not_found', 'That message is not on the job.');
    if (rec.state === 'unsure') throw err(409, 'unsure_first', 'It is not known whether this went, so it is not sent again blind. Check it first.');
    if (rec.state !== 'failed') throw err(409, 'invalid_state', rec.state === 'queued' ? 'This is already being sent.' : 'This has already gone, so it is not sent again from here.');
    allowed(rec);
    const p = {msgs:{}}; p.msgs[b.mk] = {state:'queued', err:''}; save(d, p, user, null);
    return deliver(d, b.mk, Object.assign({}, rec, {byName:clean(b.byName, 60) || rec.byName}), user);
  }
  /* copied, opened in an app, or sent by a member of staff themselves: recorded for what it is, never as sent by the system */
  function msgNote(b, user, state){
    const {d, job} = jobOf(b.jobId), m = draftOf(b, user, true, job), k = String(b.key || '');
    if (!KEY.test(k)) throw err(400, 'invalid_argument', 'That request has no reference. Close this and try again.');
    const mk = 'm' + k; if ((job.msgs || {})[mk]) return {ok:true, duplicate:true, mk:mk};
    if (state === 'manual'){
      if (!BY_HAND[m.channel]) throw err(400, 'invalid_argument', 'Say how it was sent.');
      if (m.channel !== 'hand' && m.channel !== 'phone' && !m.to) throw err(400, 'invalid_argument', 'Say where it was sent to.');
      m.note = clean(b.note, 300);
    } else m.how = clean(b.how, 20) === 'opened' ? 'opened' : 'copied';
    const rec = Object.assign(m, {state:state, at:iso(), by:user.id}), p = {msgs:{}}; p.msgs[mk] = rec;
    save(d, p, user, state === 'manual' ? KINDS[m.kind] + ' recorded as sent ' + BY_HAND[m.channel] + (m.to ? ' to ' + m.to : '') + ' by ' + m.byName + (m.note ? ': ' + m.note : '')
      : KINDS[m.kind] + (m.how === 'opened' ? ' opened in an app' : ' copied') + ' by ' + m.byName + '. Prepared only: nothing was sent from here');
    return {ok:true, mk:mk, msg:rec};
  }

  /* ---------- a send whose answer was lost ----------
     A text can be looked up with the text service: it either has it (so it went) or has no record (so it is safe to send
     again). An email cannot be looked up, so a person checks the shop mailbox's Sent folder or asks the customer, and
     says which. Either way the message keeps its history and is never sent twice by guesswork. */
  async function settleText(d, mk, rec, user, who){
    /* texts this system already holds a reference for are somebody else's: the same words sent earlier must not be mistaken for this one */
    const known = []; st.list('jobs', '', 'asc', 0).forEach(row => { const o = (row.data && row.data.msgs) || {}; Object.keys(o).forEach(x => { if (o[x] && o[x].channel === 'sms' && o[x].ref) known.push(o[x].ref); }); });
    const r = await texter.find(rec.to, rec.body, Date.parse(rec.at) || now(), known);
    if (!r.known) return 'unknown';
    const p = {msgs:{}};
    if (r.found){
      const stt = r.found.status, bad = stt === 'failed' || stt === 'undelivered', done = stt === 'delivered';
      p.msgs[mk] = bad ? {state:'failed', ref:r.found.ref, failedAt:iso(), err:'The text service took it but could not deliver it' + (r.found.err ? ': ' + r.found.err : '') + '.'}
        : done ? {state:'delivered', ref:r.found.ref, sentAt:rec.at, deliveredAt:iso(), err:''} : {state:'sent', ref:r.found.ref, sentAt:rec.at, err:''};
      save(d, p, user, KINDS[rec.kind] + ' text to ' + rec.to + ': checked with the text service' + who + '. It has it, reference ' + r.found.ref + (bad ? ', but it WAS NOT DELIVERED' : done ? ', delivered to the handset' : ', so it went'));
      if (!bad && !done) watch(d.id, mk, r.found.ref);
      return p.msgs[mk].state;
    }
    if (now() - (Date.parse(rec.at) || 0) < 60000) return 'soon';
    p.msgs[mk] = {state:'failed', failedAt:iso(), err:'The text service has no record of it, so it did not go. It is safe to send it again.'};
    save(d, p, user, KINDS[rec.kind] + ' text to ' + rec.to + ': checked with the text service' + who + '. It has no record of it, so it did not go');
    return 'failed';
  }
  async function msgCheck(b, user){
    const {d, job} = jobOf(b.jobId), rec = (job.msgs || {})[b.mk], name = nameOf(b, user);
    if (!rec) throw err(404, 'not_found', 'That message is not on the job.');
    if (rec.state !== 'unsure') return {ok:goneOk(rec.state), state:rec.state, mk:b.mk, msg:rec};
    if (rec.channel !== 'sms') throw err(400, 'invalid_argument', 'An email cannot be checked from here. Look in the Sent folder of the shop mailbox, or ask the customer, then say whether it arrived.');
    const out = await settleText(d, b.mk, rec, user, ' by ' + name);
    if (out === 'unknown') throw err(502, 'upstream_error', 'The text service could not be asked just now. Nothing has been sent again. Try the check again shortly.');
    if (out === 'soon') throw err(409, 'too_soon', 'The text service has no record of it yet. Give it a minute, then check again.');
    const after = jobOf(b.jobId).job.msgs[b.mk];
    return {ok:goneOk(after.state), state:after.state, mk:b.mk, msg:after};
  }
  function msgResolve(b, user){
    const {d, job} = jobOf(b.jobId), rec = (job.msgs || {})[b.mk], name = nameOf(b, user), note = clean(b.note, 300);
    if (!rec) throw err(404, 'not_found', 'That message is not on the job.');
    if (rec.state !== 'unsure') throw err(409, 'invalid_state', 'This message is no longer waiting to be checked.');
    const p = {msgs:{}};
    if (b.went === true){
      if (note.length < 3) throw err(400, 'invalid_argument', 'Say how you know it arrived, for example that it is in the Sent folder or the customer confirmed it.');
      p.msgs[b.mk] = {state:'sent', sentAt:rec.at, err:'', confirmed:{at:iso(), by:user.id, byName:name, note:note}};
      save(d, p, user, KINDS[rec.kind] + went(rec) + ': ' + name + ' checked and it did arrive (' + note + ')');
    } else if (b.went === false){
      if (note.length < 3) throw err(400, 'invalid_argument', 'Record what you checked before allowing another send.');
      p.msgs[b.mk] = {state:'failed', failedAt:iso(), err:'Checked by ' + name + ': it did not arrive.' + (note ? ' ' + note : ''), confirmed:{at:iso(), by:user.id, byName:name, note:note, went:false}};
      save(d, p, user, KINDS[rec.kind] + went(rec) + ': ' + name + ' checked and it did not arrive' + (note ? ' (' + note + ')' : '') + '. It can now be sent again');
    } else throw err(400, 'invalid_argument', 'Say whether it arrived.');
    const after = jobOf(b.jobId).job.msgs[b.mk];
    if (after.state === 'sent' && after.channel === 'sms' && after.ref) watch(d.id, b.mk, after.ref);
    return {ok:goneOk(after.state), state:after.state, mk:b.mk, msg:after};
  }

  /* ---------- has a text reached the handset? ---------- */
  const watching = new Map(), checking = new Map(); let timer = null;
  function watchUnsure(jobId, mk){ checking.set(jobId + '/' + mk, {jobId:jobId, mk:mk, n:0}); }
  function watch(jobId, mk, ref){ watching.set(jobId + '/' + mk, {jobId:jobId, mk:mk, ref:ref, n:0}); }
  async function poll(){
    await sendFittingSheets();
    await sendThanks();
    for (const [k, w] of Array.from(watching)){
      w.n++; let r = {status:''};
      try { r = await texter.status(w.ref); } catch (e) {}
      const done = r.status === 'delivered', bad = r.status === 'failed' || r.status === 'undelivered';
      if (done || bad){
        watching.delete(k);
        try {
          const {d, job} = jobOf(w.jobId), rec = (job.msgs || {})[w.mk]; if (!rec || rec.state !== 'sent') continue;
          const p = {msgs:{}}; p.msgs[w.mk] = done ? {state:'delivered', deliveredAt:iso()} : {state:'failed', failedAt:iso(), err:'The text service could not deliver it' + (r.err ? ': ' + r.err : '') + '.'};
          save(d, p, SYSTEM, KINDS[rec.kind] + ' text to ' + rec.to + (done ? ' delivered to the handset' : ' WAS NOT DELIVERED' + (r.err ? ': ' + r.err : '')));
        } catch (e) {}
      } else if (w.n > 60) watching.delete(k);
    }
    /* texts whose answer was lost: once a minute has passed, ask the text service whether it has them */
    for (const [k, c] of Array.from(checking)){
      c.n++;
      try {
        const {d, job} = jobOf(c.jobId), rec = (job.msgs || {})[c.mk];
        if (!rec || rec.state !== 'unsure'){ checking.delete(k); continue; }
        if (now() - (Date.parse(rec.at) || 0) < 60000) continue;
        const out = await settleText(d, c.mk, rec, SYSTEM, ' by the system');
        if (out !== 'unknown' && out !== 'soon') checking.delete(k); else if (c.n > 40) checking.delete(k);
      } catch (e){ if (c.n > 40) checking.delete(k); }
    }
  }
  /* after a restart: anything caught mid-send is not known to have gone, and recent texts are watched again */
  function recover(){
    try {
      st.list('jobs', '', 'asc', 0).forEach(row => {
        const ms = (row.data && row.data.msgs) || {}, d = storeLib.docPath('jobs/' + row.id), p = {msgs:{}}; let n = 0;
        Object.keys(ms).forEach(k => {
          const m = ms[k];
          if (m.state === 'queued'){ p.msgs[k] = {state:'unsure', unsureAt:iso(), err:'The system restarted while this was being sent, so it is not known whether it went.'}; n++; if (m.channel === 'sms') watchUnsure(row.id, k); }
          else if (m.state === 'unsure' && m.channel === 'sms' && now() - Date.parse(m.at) < 2 * 3600000) watchUnsure(row.id, k);
          else if (m.state === 'sent' && m.channel === 'sms' && m.ref && now() - Date.parse(m.sentAt || m.at) < 2 * 3600000) watch(row.id, k, m.ref);
        });
        if (n && d) save(d, p, SYSTEM, n + (n === 1 ? ' message was' : ' messages were') + ' being sent when the system restarted and may not have gone');
        const arrival = require('./arrival-sync').patch(st.getDoc(d.path).data);
        if (Object.keys(arrival).length) save(d, arrival, SYSTEM, 'Arrival times reconciled with accepted customer texts');
        reconcile(d);
      });
    } catch (e){ log('message recovery failed: ' + (e && e.message)); }
  }
  function start(){ recover(); timer = setInterval(() => { poll().catch(() => {}); }, o.pollMs || 15000); timer.unref(); }
  function stop(){ clearInterval(timer); }

  let sheetsBusy=false;
  async function sendFittingSheets(){
    if(sheetsBusy)return;sheetsBusy=true;
    try{for(const row of st.list('jobs')){
      const job={...row.data,id:row.id};if(!job.fittingSheetRequired||!job.diary||job.type!=='Fitting'||job.status!=='open'||job.date<iso().slice(0,10))continue;
      const d=storeLib.docPath('jobs/'+row.id),snap=L.bookingSnap(job),rev=L.bookingRev(snap),to=String(job.customer?.email||'').trim().toLowerCase();
      const issue=message=>{if(job.fittingSheetIssue!==message)save(d,{fittingSheetIssue:message},SYSTEM,null);};
      if(!mail.validEmail(to)){issue('Add the customer email address to send their job confirmation.');continue;}
      const existing=L.msgsOf(job).find(m=>m.kind==='confirm'&&m.channel==='email'&&m.rev===rev&&m.to===to&&['queued','sent','delivered','unsure','failed'].includes(m.state));
      if(existing){issue(['sent','delivered'].includes(existing.state)?'':existing.state==='failed'?'The job-confirmation email failed. Open the message and retry.':existing.state==='unsure'?'The job-confirmation email may have sent. Check before trying again.':'Job-confirmation email is sending.');continue;}
      const shop={name:'Innovation Flooring Direct',phone:'0141 952 5200',email:mailer.from||'sales@innovationflooringdirect.com',address:'2 South Elgin Place, Clydebank G81 1XP',words:st.getDoc('settings/main').data?.words||{}},changed=L.confirmChanges(job),revised=!!L.confirmLast(job);
      try{allowed({channel:'email',to});}catch(e){issue(e.message||'Email sending is not ready.');continue;}
      const id='sheet-'+crypto.createHash('sha256').update(row.id+'|'+rev+'|'+to).digest('hex').slice(0,40);
      try{await msgSend({jobId:row.id,key:id,kind:'confirm',channel:'email',to,subject:L.confirmSubject(job,shop,revised),body:L.confirmMessage(job,shop,{revised,changes:changed}),rev,snap,byName:'The system'},SYSTEM);issue('');}catch(e){issue(e.message||'The job confirmation could not be sent.');}
    }}finally{sheetsBusy=false;}
  }

  function customerSignoff(b,user){
    const {d,job}=jobOf(b.jobId),k=String(b.key||'');
    if(!KEY.test(k))throw err(400,'signoff','Refresh and try again.');
    if(job.customerSignoffs?.[k])return {ok:true,duplicate:true};
    if(job.status!=='open'||job.type!=='Fitting'||!job.diary||job.date!==b.date||job.date>iso().slice(0,10))throw err(409,'signoff','This is not an open fitting due today or earlier. Refresh the job.');
    const rec=require('./customer-signoff').validate(b);
    if(Object.values(job.customerSignoffs||{}).some(x=>x.date===job.date))throw err(409,'signoff','This visit already has a customer sign-off. Ask the shop to arrange any return visit.');
    if(rec.outcome==='clear'){const check=L.canComplete(job);if(!check.ok)throw err(409,'held',check.why.join(' '));}
    Object.assign(rec,{at:iso(),date:job.date,by:user.id,byName:user.name,fitter:job.fitter,ref:job.ref});
    const done=rec.outcome==='clear'&&rec.signed;
    const patch={customerSignoffs:{[k]:rec},thankYouRequired:true};
    if(done)Object.assign(patch,{status:'done',doneAt:iso(),doneAs:'Fitted',ret:'',retWhy:'',signoff:{at:iso(),by:user.id,fitter:job.fitter,customerEvent:k}});
    else Object.assign(patch,{ret:'needed',retWhy:rec.note||'Customer signature unavailable: '+rec.reason});
    save(d,patch,user,done?'Customer signed off the fitting.':'Customer visit needs shop follow-up: '+(rec.note||rec.reason));
    return {ok:true,completed:done};
  }
  let thanksBusy=false;
  async function sendThanks(){
    if(thanksBusy)return;thanksBusy=true;
    try{for(const row of st.list('jobs')){
      const j=row.data;if(!j.thankYouRequired||j.status==='cancelled')continue;
      const event=Object.entries(j.customerSignoffs||{}).sort((a,b)=>a[1].at.localeCompare(b[1].at))[0];if(!event)continue;
      const d=storeLib.docPath('jobs/'+row.id),issue=msg=>{if(j.thankYouIssue!==msg)save(d,{thankYouIssue:msg},SYSTEM,null);};
      const rev='thanks:'+event[0],existing=Object.values(j.msgs||{}).find(m=>m.rev===rev&&m.channel==='email');
      if(existing){issue(['sent','delivered'].includes(existing.state)?'':existing.state==='failed'?'Thank-you email failed. Open Messages and retry.':existing.state==='unsure'?'Thank-you email may have sent. Check before retrying.':'Thank-you email is sending.');continue;}
      const to=String(j.customer?.email||'').trim().toLowerCase();
      if(!mail.validEmail(to)){issue('Add a customer email address for the thank-you email.');continue;}
      const review=String(st.getDoc('settings/main').data?.words?.reviewUrl||'').trim();
      const reviewText=/^https:\/\/[^\s]+$/.test(review)?'Leave a review here: '+review+'\nYou can also find Innovation Flooring Direct on Facebook to leave a review or recommendation.':'If you would like to share your experience, please search for Innovation Flooring Direct on Google and Facebook and leave an honest review or recommendation.';
      const r=event[1],body='Hello '+(j.customer?.name||'there')+',\n\nThank you for choosing Innovation Flooring Direct and welcoming our fitter into your home.\n\nJob reference: '+(j.ref||row.id)+'\n'+(r.outcome==='issues'?'We have recorded the following for our shop team to follow up:\n'+r.note:r.signed?'Your visit has been signed off. We hope you enjoy your new floor.':'Your fitter has recorded the visit. The shop will follow up because customer sign-off was unavailable: '+r.reason)+'\n\nIf there is anything else we can help with, please call 0141 952 5200.\n\nWe welcome your honest feedback about your experience. '+reviewText+'\n\nThank you again for your business.\nInnovation Flooring Direct';
      try{await msgSend({jobId:row.id,key:'thanks-'+crypto.createHash('sha256').update(row.id+'|'+event[0]).digest('hex').slice(0,40),kind:'other',channel:'email',to,subject:'Thank you from Innovation Flooring Direct · '+(j.ref||row.id),body,rev,byName:'The system'},SYSTEM);issue('');}catch(e){issue(e.message||'Thank-you email could not be sent.');}
    }}finally{thanksBusy=false;}
  }
  /* ---------- the plain record routes may not reach round these rules ---------- */
  function guardJobWrite(d, data, isSet, user){
    const cur = st.getDoc(d.path), same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    if(data&&(isSet||Object.hasOwn(data,'customerSignoffs'))&&!same(cur.data?.customerSignoffs,data.customerSignoffs))throw err(409,'use_command','Customer signatures are saved through customer sign-off and cannot be edited.');
    if(data?.status==='done'&&(cur.data||data).type==='Fitting'&&cur.data?.status!=='done')throw err(409,'use_command','Use customer sign-off to complete this fitting.');
    if (!cur.exists){
      /* a new job: it cannot arrive already carrying messages, a cut piece, or (for a sale made in the shop) more paid than it comes to */
      if (data && data.msgs && Object.keys(data.msgs).length) throw err(409, 'use_command', 'Messages are recorded by the system when they are sent.');
      const nl = (data && data.lines) || {};
      if (Object.keys(nl).some(k => nl[k] && nl[k].unit === 'm' && nl[k].picked)) throw err(409, 'use_command', 'Carpet is marked as cut through the cutting screen, which checks nothing is holding the job.');
      if (data && data.source === 'shop' && L.paidOf(data) > L.shopTotal(data) + 0.004) throw err(409, 'overpayment', 'The payment is more than the sale comes to.');
      return;
    }
    const before = cur.data, after = isSet ? data : storeLib.merge(JSON.parse(JSON.stringify(before)), data);
    if(after.diary&&!before.diary&&after.type==='Fitting')data.fittingSheetRequired=true;
    if(after.diary && !before.diary){const {off,ctx}=diaryContext(), check=L.canConfirmDiary({...after,id:d.id},off,ctx);if(!check.ok)throw err(409,'diary_held',check.why.join(' '));}
    if(before.diary && data.diary===false) data.diaryAuto=false;
    if (!same(before.pay, after.pay)) throw err(409, 'use_command', 'Payments are recorded through the payment screen, so they are checked and cannot be entered twice.');
    if (!same(before.msgs, after.msgs)) throw err(409, 'use_command', 'Messages are recorded by the system when they are sent.');
    const bl = before.lines || {}, al = after.lines || {};
    Object.keys(al).forEach(k => { const a = al[k], b = bl[k]; if (a && a.unit === 'm' && a.picked && !(b && b.picked)) throw err(409, 'use_command', 'Carpet is marked as cut through the cutting screen, which checks nothing is holding the job.'); });
  }
  function guardSettings(d, data, isSet, user){
    const cur = st.getDoc(d.path);
    [['msgs', 'Only the owner can change who messages may go to.'], ['words', 'Only the owner can change the standard wording on customer messages.'], ['prices', 'Only the owner can change the price list.']].forEach(x => {
      const before = (cur.exists && cur.data[x[0]]) || {}, after = isSet ? (data[x[0]] || {}) : (data[x[0]] ? storeLib.merge(JSON.parse(JSON.stringify(before)), data[x[0]]) : before);
      if (JSON.stringify(before) !== JSON.stringify(after) && user.role !== 'owner') throw err(403, 'forbidden', x[1]);
    });
  }

  const table = {'cut':cut, 'pay':pay, 'msg.send':msgSend, 'msg.retry':msgRetry, 'msg.check':msgCheck, 'msg.resolve':msgResolve, 'msg.manual':(b, u) => msgNote(b, u, 'manual'), 'msg.prepared':(b, u) => msgNote(b, u, 'prepared')};
  async function run(name, body, user){
    const fn = table[name]; if (!fn) throw err(404, 'not_found', 'That is not something this system does.');
    return fn(body || {}, user);
  }
  function status(){ const c = msgSettings(); return {email:!!mailer.ready, emailFrom:mailer.from || '', sms:!!texter.ready, testOnly:c.testOnly, allow:c.allow.length}; }
  return { run, status, start, stop, guardJobWrite, guardSettings, poll, reconcile, customerSignoff };
}
module.exports = { make };
