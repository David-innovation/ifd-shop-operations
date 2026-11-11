'use strict';
/* Texts go out through Twilio. Until its details are in the environment a sign-in code is written to the service log
   instead, which only the owner can read. Customer messages are never logged in place of sending: without Twilio the
   system says texting is not set up. A text counts as delivered only when Twilio reports the handset took it. */
function normaliseMobile(input){
  let s = String(input || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('07') && s.length === 11) s = '+44' + s.slice(1);
  if (s.startsWith('447') && s.length === 12) s = '+' + s;
  return /^\+\d{10,15}$/.test(s) ? s : '';
}
function make(env, fetchImpl, log){
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM, ready = !!(sid && token && from);
  const base = (env.TWILIO_BASE || 'https://api.twilio.com') + '/2010-04-01/Accounts/' + encodeURIComponent(sid || '') + '/Messages';
  const auth = {'authorization':'Basic ' + Buffer.from(sid + ':' + token).toString('base64')};
  /* resolves with Twilio's own reference once it has accepted the text; rejects with a plain reason otherwise */
  async function send(to, body){
    if (!ready) throw Object.assign(new Error('Texting has not been set up yet.'), {code:'not_set_up'});
    let res;
    try { res = await fetchImpl(base + '.json', {method:'POST', headers:Object.assign({'content-type':'application/x-www-form-urlencoded'}, auth), body:new URLSearchParams({To:to, From:from, Body:body}).toString(), signal:AbortSignal.timeout(20000)}); }
    catch (e){
      /* never connected: nothing was handed over. Anything else (cut off, timed out) and the text may have been taken. */
      const why = String((e && e.cause && e.cause.code) || (e && e.code) || '');
      if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].indexOf(why) !== -1) throw new Error('The text service could not be reached.');
      throw Object.assign(new Error('The text was handed to the text service but its answer did not come back, so it is not known whether it went.'), {unsure:true});
    }
    const j = await res.json().catch(() => ({}));
    if (res.status >= 500) throw Object.assign(new Error('The text service had a fault (' + res.status + ') while taking the text, so it is not known whether it went.'), {unsure:true});
    if (!res.ok) throw new Error('The text service refused it: ' + (j.message || res.status) + (j.code ? ' (code ' + j.code + ')' : ''));
    if (!j.sid) throw Object.assign(new Error('The text service answered without a reference, so it is not known whether the text went.'), {unsure:true});
    return {sent:true, ref:j.sid, status:j.status || 'queued'};
  }
  /* where a text has got to: queued, sent, delivered, undelivered or failed */
  async function status(ref){
    if (!ready || !/^[A-Za-z0-9]{10,64}$/.test(String(ref || ''))) return {status:''};
    try {
      const res = await fetchImpl(base + '/' + ref + '.json', {headers:auth, signal:AbortSignal.timeout(15000)}), j = await res.json().catch(() => ({}));
      return res.ok ? {status:String(j.status || ''), err:j.error_message || (j.error_code ? 'code ' + j.error_code : '')} : {status:''};
    } catch (e){ return {status:''}; }
  }
  /* did a text with exactly these words go to this number since `sinceMs`? Asked after a send whose answer was lost.
     {known:false} means the service could not be asked; {known:true, found:null} means it has no record of it. */
  async function find(to, body, sinceMs, known){
    if (!ready) return {known:false};
    try {
      const day = new Date(sinceMs - 86400000).toISOString().slice(0, 10);
      const res = await fetchImpl(base + '.json?To=' + encodeURIComponent(to) + '&DateSent%3E=' + day + '&PageSize=50', {headers:auth, signal:AbortSignal.timeout(15000)});
      if (!res.ok) return {known:false};
      const j = await res.json().catch(() => null); if (!j || !Array.isArray(j.messages)) return {known:false};
      /* the same words, to the same number, made at or after the moment this one was sent, and not a text this system already has a record of */
      const mine = known || [], hits = j.messages.filter(x => x && x.sid && mine.indexOf(x.sid) === -1 && String(x.body) === String(body) && String(x.direction || 'outbound').indexOf('outbound') === 0 && !(Date.parse(x.date_created) < sinceMs - 30000));
      const hit = hits.sort((a, b) => Date.parse(a.date_created) - Date.parse(b.date_created))[0];
      return {known:true, found:hit ? {ref:hit.sid, status:String(hit.status || ''), err:hit.error_message || (hit.error_code ? 'code ' + hit.error_code : '')} : null};
    } catch (e){ return {known:false}; }
  }
  return { ready, send, status, find };
}
/* the sign-in code path: never fails the sign-in page, and falls back to the log until Twilio is set up */
function sender(env, fetchImpl, log){
  const t = make(env, fetchImpl, log);
  if (!t.ready) return async (to, body) => { log('TEXT NOT SENT (Twilio not set up). To ' + to + ': ' + body); return {sent:false, logged:true}; };
  return (to, body) => t.send(to, body);
}
module.exports = { normaliseMobile, sender, make };
