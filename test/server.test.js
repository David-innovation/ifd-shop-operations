'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { create } = require('../server'), fake = require('../testkit/fake-shopify'), { merge, docPath } = require('../lib/store'), { normaliseMobile } = require('../lib/sms'), sh = require('../lib/shopify');
const fakeMail = require('../testkit/fake-mail'), fakeTwilio = require('../testkit/fake-twilio');

const OWNER = '+447700900001', SHOPM = '+447700900002', FITTER = '+447700900003';
async function boot(extra, o){
  const dir = (o && o.dir) || fs.mkdtempSync(path.join(os.tmpdir(), 'ifd-')), shopify = fake.make(), texts = [], clock = {t:Date.parse('2026-11-10T09:00:00Z')};
  /* with {messaging:true} the system is given a mail server and a text service to send through: stand-ins that keep what they are handed */
  const mailbox = o && o.messaging ? fakeMail.make() : null, twilio = o && o.messaging ? fakeTwilio.make({now:() => clock.t}) : null, mailPort = mailbox ? await mailbox.listen() : 0;
  const sending = mailbox ? Object.assign({SMTP_HOST:'127.0.0.1', SMTP_PORT:String(mailPort), SMTP_SECURE:'off', SMTP_USER:'shop@example.test', SMTP_PASS:'mail-test-pass', EMAIL_FROM:'Innovation Flooring Direct <shop@example.test>'}, twilio.env) : {};
  const env = Object.assign({DATA_DIR:dir, INSECURE_COOKIES:'1', SESSION_PEPPER:'test', OWNER_NAME:'David', OWNER_MOBILE:'07700 900001', SHOP_MOBILE:'07700 900002', SHOPIFY_STORE:'innovationflooring', SHOPIFY_CLIENT_ID:'test-id', SHOPIFY_CLIENT_SECRET:'test-secret'}, sending, extra || {});
  const app = create({env, fetch:(url, init) => twilio && twilio.handles(url) ? twilio.fetchImpl(url, init) : shopify.fetchImpl(url, init), sendText:async (to, body) => { texts.push({to, body}); }, now:() => clock.t, log:() => {}, pollMs:3600000});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const req = async (method, url, body, cookie, headers) => {
    const h = Object.assign({'x-ifd':'1'}, headers || {}); if (cookie) h.cookie = cookie; let payload;
    if (Buffer.isBuffer(body)) payload = body; else if (body !== undefined){ h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + url, {method, headers:h, body:payload, redirect:'manual'}), text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return {status:r.status, json, text, headers:r.headers};
  };
  const codeFor = m => { const t = texts.filter(x => x.to === m).pop(); return t ? /code: (\d{6})/.exec(t.body)[1] : ''; };
  const signIn = async mobile => { await req('POST', '/api/login/code', {mobile}); const r = await req('POST', '/api/login/verify', {mobile, code:codeFor(normaliseMobile(mobile))}); assert.strictEqual(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; };
  const cmd = (name, body, cookie) => req('POST', '/api/cmd', Object.assign({cmd:name}, body), cookie);
  const job = id => app.store.getDoc('jobs/' + id).data;
  return {app, base, req, cmd, job, texts, clock, shopify, mailbox, twilio, codeFor, signIn, dir, stop:() => { app.close(); if (mailbox) mailbox.close(); fs.rmSync(dir, {recursive:true, force:true}); }};
}
const SHOP = {name:'Innovation Flooring Direct', phone:'0141 952 5200', email:'help@example.test', address:'2 South Elgin Place, Clydebank G81 1XP'};
test('customer sign-off enforces assignment, signatures, holds, immutable history and neutral email once',async()=>{
 const s=await boot({}, {messaging:true});try{
  s.app.ensureUser('Lennox',FITTER,'fitter');s.app.ensureUser('Other','07700900004','fitter');
  const fitter=await s.signIn(FITTER),other=await s.signIn('07700900004'),owner=await s.signIn(OWNER);
  s.app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['zed@example.test']},words:{reviewUrl:'https://example.test/review'}});
  const j=testJob({date:'2026-11-10',diary:true,lines:{l1:{title:'Test carpet',unit:'m',qty:31,w:4,state:'allocated',bay:'W4-01',picked:true,checked:true}}});
  s.app.store.setDoc(docPath('jobs/signed'),j);
  const b={jobId:'signed',date:j.date,key:'customer_sign_1',outcome:'clear',name:'TEST CUSTOMER',agreed:true,strokes:[[[0.1,0.2],[0.3,0.4],[0.5,0.2]]]};
  const sign=(body,cookie=fitter)=>s.req('POST','/api/appointments/signoff',body,cookie);
  assert.equal((await sign(b,other)).status,403);
  assert.equal((await sign({...b,strokes:[]})).status,400);
  assert.equal((await sign({...b,agreed:false})).status,400);
  assert.equal((await sign({...b,strokes:[[[2,0],[0,0]]]})).status,400);
  assert.equal((await sign({...b,outcome:'issues',note:''})).status,400);
  assert.equal((await sign(b)).status,200);assert.equal(s.job('signed').status,'done');
  assert.equal((await sign(b)).json.duplicate,true);assert.equal(Object.keys(s.job('signed').customerSignoffs).length,1);
  assert.equal((await s.req('POST','/api/db/update',{path:'jobs/signed',data:{customerSignoffs:{}}},owner)).status,409);
  assert.equal((await s.req('POST','/api/db/set',{path:'jobs/signed',data:j},owner)).status,409);
  await Promise.all([s.app.commands.poll(),s.app.commands.poll()]);await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,1);assert.match(s.mailbox.state.got[0].text,/honest feedback/);
  s.app.store.setDoc(docPath('jobs/issues'),j);
  assert.equal((await sign({...b,jobId:'issues',key:'customer_issues',outcome:'issues',note:'TEST: trim needs attention'})).status,200);
  assert.equal(s.job('issues').status,'open');assert.equal(s.job('issues').ret,'needed');
  await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,2);assert.match(s.mailbox.state.got[1].text,/trim needs attention/);assert.match(s.mailbox.state.got[1].text,/https:\/\/example.test\/review/);
  s.app.store.setDoc(docPath('jobs/heldsign'),testJob({date:j.date,diary:true}));assert.equal((await sign({...b,jobId:'heldsign'})).status,409);
  assert.equal((await s.req('POST','/api/db/update',{path:'jobs/heldsign',data:{status:'done'}},owner)).status,409);
  s.app.store.setDoc(docPath('jobs/absent'),j);assert.equal((await sign({...b,jobId:'absent',strokes:[],reason:'Customer had to leave'})).status,200);assert.equal(s.job('absent').status,'open');
  s.app.store.updateDoc(docPath('settings/main'),{words:{reviewUrl:''}});await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,3);assert.match(s.mailbox.state.got[2].text,/Google and Facebook/);
 }finally{s.stop();}
});
/* a made-up fitting: one carpet room measured 3.00 x 3.80 m, 3.1 m sold off a 4 m roll, £377.40 in all of which £150 is the fitter's */
const testJob = extra => Object.assign({v:1, ref:'#T9', source:'shop', status:'open', type:'Fitting', date:'', slot:'', fitter:'Lennox', diary:false, shopifyClosed:false, createdAt:'2026-11-10T09:00:00.000Z',
  customer:{name:'Zed Tester', phone:'07700 900555', email:'zed@example.test', address:'1 Test Street', postcode:'G81 1XP'},
  lines:{l1:{n:1, title:'Test carpet', sub:'', unit:'m', qty:31, w:4, hold:'draft', holdRef:'#D1', state:'todo', bay:'', picked:false, checked:false, price:0}},
  total:377.4, fitterDue:150, pay:{}, notes:'', quote:[], drafts:{}, sizeCheck:'verified', pre:{}, log:{},
  rooms:{r1:{n:1, name:'Lounge', len:3, wid:3.8, area:11.4, source:'shop', status:'verified', verBy:'Shop', verRole:'shop', verOn:'2026-11-10'}}}, extra || {});

test('accepted jobs enter diary only after preparation and checking, and explicit removal stays removed', async () => {
  const s=await boot();try{
    const owner=await s.signIn(OWNER),date=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const job=testJob({date,diaryAuto:true});s.app.store.setDoc(docPath('jobs/journey-diary'),job);
    const change=data=>s.req('POST','/api/db/update',{path:'jobs/journey-diary',data},owner);
    assert.equal((await change({diary:true})).status,409);
    await s.req('POST','/api/cmd',{cmd:'cut',jobId:'journey-diary',lineK:'l1',byName:'David',bay:'W4-01'},owner);
    assert.equal(s.app.store.getDoc('jobs/journey-diary').data.diary,false);
    assert.equal((await change({lines:{l1:{checked:true}}})).status,200);
    assert.equal(s.app.store.getDoc('jobs/journey-diary').data.diary,true);
    await change({diary:false});await change({notes:'Further edit'});
    assert.equal(s.app.store.getDoc('jobs/journey-diary').data.diary,false);
    assert.equal(s.app.store.getDoc('jobs/journey-diary').data.diaryAuto,false);
  }finally{s.stop();}
});

test('pack quotes combine identical variants, preserve exact quantities and gate automatic diary handover', async () => {
  const s=await boot();try{
    const L=s.app.rules, owner=await s.signIn(OWNER), variant='gid://shopify/ProductVariant/701';
    const job=testJob({date:'2026-11-20',diaryAuto:true,brief:{choices:[{k:'a',title:'Oak laminate',variantId:variant},{k:'b',title:'Oak laminate',variantId:variant}]},rooms:{a:{name:'Bedroom',area:12,want:'a',status:'verified',spec:{floor:'flooring'}},b:{name:'Hall',area:8,want:'b',status:'verified',spec:{floor:'flooring'}}},lines:{}});
    const goods={a:{cov:1.836,pack:20.18},b:{cov:1.836,pack:20.18}}, plan=L.packPlan(job,goods,{});
    assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].packs,12);assert.equal(plan.groups[0].required,22);
    assert.equal(L.catalogue(job,{},goods,{}).flooring.amount,242.16);
    assert.match(L.packPlan(job,{},{}).problems.join(' '),/coverage/);
    job.accepted={packs:plan};job.lines={p:{title:'Oak laminate',variantId:variant,unit:'packs',cov:1.836,qty:11,hold:'draft',state:'allocated',bay:'W4-01',picked:true,checked:true}};
    assert.match(L.canConfirmDiary(job,{},{}).why.join(' '),/12 packs required/);
    job.lines.p.qty=12;job.lines.p.checked=false;
    s.app.store.setDoc(docPath('jobs/pack-diary'),job);
    const change=data=>s.req('POST','/api/db/update',{path:'jobs/pack-diary',data},owner);
    assert.equal((await change({diary:true})).status,409);
    assert.equal((await change({lines:{p:{checked:true}}})).status,200);
    assert.equal(s.job('pack-diary').diary,true,JSON.stringify(L.canConfirmDiary(s.job('pack-diary'),{},{}))+JSON.stringify(L.canComplete(s.job('pack-diary'))));
    const changed=s.job('pack-diary');changed.rooms.a.area=13;
    assert.match(L.canConfirmDiary(changed,{},{}).why.join(' '),/changed after acceptance/);
  }finally{s.stop();}
});

test('fitting sheets email once per booking revision, omit sizes, and keep SMS separate', async()=>{
 const s=await boot({}, {messaging:true});try{
  s.app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['zed@example.test']}});
  const j=testJob({date:'2026-11-20',diary:true,fittingSheetRequired:true,lines:{p:{title:'Meadow Oak 8mm',unit:'packs',qty:12,price:240},g:{title:'Full-spread glue',unit:'m²',qty:20,price:60},prep:{title:'Floor preparation',price:280}},total:1080,fitterDue:500});
  s.app.store.setDoc(docPath('jobs/sheet'),j);await Promise.all([s.app.commands.poll(),s.app.commands.poll()]);await s.app.commands.poll();
  assert.equal(s.mailbox.state.got.length,1);const first=s.mailbox.state.got[0];assert.match(first.text,/Your job confirmation/);assert.match(first.text,/Meadow Oak/);assert.doesNotMatch(first.text,/8mm|20 m²|12 packs|3\.00|3\.80/);assert.match(first.html,/font-size:14px/);assert.match(first.html,/statutory consumer rights/);assert.equal(s.app.rules.confirmState(s.job('sheet')),'sent');
  s.app.store.updateDoc(docPath('jobs/sheet'),{date:'2026-11-21'});await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,2);assert.match(s.mailbox.state.got[1].text,/replaces our earlier confirmation/);
  s.app.store.updateDoc(docPath('jobs/sheet'),{date:'2026-11-22'});s.mailbox.state.refuse['zed@example.test']=1;await s.app.commands.poll();await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,2);assert.match(s.job('sheet').fittingSheetIssue,/failed/);assert.equal(s.app.rules.confirmState(s.job('sheet')),'changed');
  const failed=Object.entries(s.job('sheet').msgs).find(([k,m])=>m.state==='failed');await s.cmd('msg.retry',{jobId:'sheet',mk:failed[0],byName:'David'},await s.signIn(OWNER));await s.app.commands.poll();assert.equal(s.mailbox.state.got.length,3);
  const html=require('../lib/fitting-sheet').html('<script>bad</script>');assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 }finally{s.stop();}
});

test('missing email setup stays visibly pending and old bookings are not emailed retrospectively',async()=>{
 const s=await boot();try{
  s.app.store.setDoc(docPath('jobs/pending-sheet'),testJob({date:'2026-11-20',diary:true,fittingSheetRequired:true}));await s.app.commands.poll();assert.match(s.job('pending-sheet').fittingSheetIssue,/not been set up/);assert.equal(Object.keys(s.job('pending-sheet').msgs||{}).length,0);
  s.app.store.setDoc(docPath('jobs/old-booking'),testJob({date:'2026-11-20',diary:true}));await s.app.commands.poll();assert.equal(s.job('old-booking').fittingSheetIssue,undefined);
 }finally{s.stop();}
});

test('records merge the way the screens expect', () => {
  assert.deepStrictEqual(merge({a:{b:1, c:[1, 2]}, x:1}, {a:{c:[3], d:{e:1}}, y:2}), {a:{b:1, c:[3], d:{e:1}}, x:1, y:2});
  assert.strictEqual(normaliseMobile('07700 900123'), '+447700900123'); assert.strictEqual(normaliseMobile('+44 7700 900123'), '+447700900123'); assert.strictEqual(normaliseMobile('0141 952'), '');
});

test('nothing is reachable without signing in', async () => {
  const s = await boot();
  try {
    assert.strictEqual((await s.req('GET', '/api/db/list?coll=jobs')).status, 401);
    assert.strictEqual((await s.req('GET', '/api/me')).status, 401);
    assert.strictEqual((await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{name} }'})).status, 401);
    assert.strictEqual((await s.req('GET', '/_blob/' + 'a'.repeat(32))).status, 401);
    const home = await s.req('GET', '/'); assert.strictEqual(home.status, 200); assert.match(home.text, /Text me a code/); assert.doesNotMatch(home.text, /IFDLogic/);
    assert.strictEqual((await s.req('GET', '/healthz')).text, 'ok');
  } finally { s.stop(); }
});

test('sign-in by texted code', async () => {
  const s = await boot();
  try {
    // a number that is not set up gets the same answer and no text: knowing a number is not enough
    let r = await s.req('POST', '/api/login/code', {mobile:'07700 900999'}); assert.strictEqual(r.status, 200); assert.strictEqual(s.texts.length, 0);
    assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:'07700 900999', code:'123456'})).status, 401);
    r = await s.req('POST', '/api/login/code', {mobile:'07700 900001'}); assert.strictEqual(r.status, 200); assert.strictEqual(s.texts.length, 1); assert.strictEqual(s.texts[0].to, OWNER);
    const code = s.codeFor(OWNER); assert.match(code, /^\d{6}$/);
    // a wrong code is refused, the right one works once
    const wrong = code === '000000' ? '111111' : '000000';
    assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:OWNER, code:wrong})).status, 401);
    r = await s.req('POST', '/api/login/verify', {mobile:'07700 900001', code}); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.role, 'owner');
    const setc = r.headers.get('set-cookie'); assert.match(setc, /HttpOnly/); assert.match(setc, /SameSite=Lax/);
    const cookie = setc.split(';')[0];
    assert.deepStrictEqual((await s.req('GET', '/api/me', undefined, cookie)).json, {id:(await s.req('GET', '/api/me', undefined, cookie)).json.id, name:'David', role:'owner'});
    assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:OWNER, code})).status, 401, 'a used code does not work again');
    // five wrong tries kill the code
    await s.req('POST', '/api/login/code', {mobile:SHOPM}); const c2 = s.codeFor(SHOPM), bad = c2 === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:SHOPM, code:bad})).status, 401);
    assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:SHOPM, code:c2})).status, 401, 'locked after five wrong tries');
    // codes run out
    s.clock.t += 16 * 60000; await s.req('POST', '/api/login/code', {mobile:SHOPM}); const c3 = s.codeFor(SHOPM); s.clock.t += 11 * 60000;
    assert.strictEqual((await s.req('POST', '/api/login/verify', {mobile:SHOPM, code:c3})).status, 401, 'a code older than ten minutes is refused');
    // no more than three texts to one number in a quarter of an hour
    s.clock.t += 16 * 60000; const before = s.texts.length; for (let i = 0; i < 5; i++) await s.req('POST', '/api/login/code', {mobile:SHOPM});
    assert.strictEqual(s.texts.length - before, 3);
    // sign out
    assert.strictEqual((await s.req('POST', '/api/logout', {}, cookie)).status, 200); assert.strictEqual((await s.req('GET', '/api/me', undefined, cookie)).status, 401);
    // the secure flag is on unless a test turns it off
    const s2 = await boot({INSECURE_COOKIES:''}); try { await s2.req('POST', '/api/login/code', {mobile:OWNER}); const r2 = await s2.req('POST', '/api/login/verify', {mobile:OWNER, code:s2.codeFor(OWNER)}); assert.match(r2.headers.get('set-cookie'), /; Secure/); } finally { s2.stop(); }
  } finally { s.stop(); }
});

test('changes must come from this system’s own pages', async () => {
  const s = await boot();
  try {
    const cookie = await s.signIn(OWNER);
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/a', data:{x:1}}, cookie, {'x-ifd':''})).status, 403);
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/a', data:{x:1}}, cookie, {origin:'https://evil.example'})).status, 403);
    assert.strictEqual((await s.req('GET', '/api/db/doc?path=jobs/a', undefined, cookie)).json.exists, false);
  } finally { s.stop(); }
});

test('records: set, merge, add, list, delete, and live updates', async () => {
  const s = await boot();
  try {
    const cookie = await s.signIn(SHOPM);
    // listen for changes the way an open screen does
    const events = [], ac = new AbortController();
    const es = await fetch(s.base + '/api/events', {headers:{cookie}, signal:ac.signal}); const reader = es.body.getReader(), dec = new TextDecoder();
    (async () => { try { for (;;){ const {value, done} = await reader.read(); if (done) break; dec.decode(value).split('\n').filter(l => l.startsWith('data: ')).forEach(l => events.push(JSON.parse(l.slice(6)).coll)); } } catch (e) {} })();
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'jobs/o1', data:{a:1}}, cookie)).json.error.code, 'invalid_argument', 'cannot update a record that is not there');
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/o1', data:{ref:'#1', lines:{l1:{qty:14, state:'todo'}}, tags:['a', 'b']}}, cookie)).status, 200);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'jobs/o1', data:{lines:{l1:{state:'allocated', bay:'W4-02'}, l2:{qty:1}}, tags:['c'], log:{g1:{text:'x'}}}}, cookie)).status, 200);
    const d = (await s.req('GET', '/api/db/doc?path=jobs/o1', undefined, cookie)).json;
    assert.deepStrictEqual(d.data, {ref:'#1', lines:{l1:{qty:14, state:'allocated', bay:'W4-02'}, l2:{qty:1}}, tags:['c'], log:{g1:{text:'x'}}}); assert.strictEqual(d.version, 2);
    const added = (await s.req('POST', '/api/db/add', {coll:'tasks', data:{text:'Ring supplier', due:'2026-11-12'}}, cookie)).json; assert.match(added.id, /^[0-9a-f]{20}$/);
    await s.req('POST', '/api/db/set', {path:'activity/2026-11-09', data:{day:'2026-11-09'}}, cookie); await s.req('POST', '/api/db/set', {path:'activity/2026-11-10', data:{day:'2026-11-10'}}, cookie);
    assert.deepStrictEqual((await s.req('GET', '/api/db/list?coll=activity&order=day&dir=desc&limit=1', undefined, cookie)).json.docs.map(x => x.id), ['2026-11-10']);
    assert.strictEqual((await s.req('GET', '/api/db/list?coll=jobs', undefined, cookie)).json.docs.length, 1);
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'../etc/passwd', data:{}}, cookie)).status, 400);
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs', data:{}}, cookie)).status, 400, 'a collection is not a record');
    await s.req('POST', '/api/db/delete', {path:'tasks/' + added.id}, cookie); assert.strictEqual((await s.req('GET', '/api/db/list?coll=tasks', undefined, cookie)).json.docs.length, 0);
    await new Promise(r => setTimeout(r, 80)); ac.abort();
    assert.ok(events.includes('jobs') && events.includes('tasks') && events.includes('activity'), 'open screens are told about each change: ' + events.join(','));
    // two saves at once to the same job both land
    await Promise.all([s.req('POST', '/api/db/update', {path:'jobs/o1', data:{visits:{v1:{note:'one'}}}}, cookie), s.req('POST', '/api/db/update', {path:'jobs/o1', data:{visits:{v2:{note:'two'}}}}, cookie)]);
    assert.deepStrictEqual(Object.keys((await s.req('GET', '/api/db/doc?path=jobs/o1', undefined, cookie)).json.data.visits).sort(), ['v1', 'v2']);
    // and they are still there after the system restarts
    const dir = s.dir; s.app.close();
    const again = create({env:{DATA_DIR:dir, INSECURE_COOKIES:'1', SESSION_PEPPER:'test'}, fetch:s.shopify.fetchImpl, sendText:async () => {}, log:() => {}});
    assert.strictEqual(again.store.getDoc('jobs/o1').data.lines.l1.bay, 'W4-02'); again.close();
    fs.rmSync(dir, {recursive:true, force:true});
  } catch (e){ try { s.stop(); } catch (x) {} throw e; }
});

test('the line to Shopify', async () => {
  const s = await boot();
  try {
    const cookie = await s.signIn(SHOPM);
    assert.ok(sh.allowed('query OpsShop{ shop{ name } }', 'query')); assert.strictEqual(sh.allowed('mutation OpsAdjust($i:X!){ a }', 'query'), null);
    assert.strictEqual(sh.allowed('query Anything{ shop{ name } }', 'query'), null); assert.strictEqual(sh.allowed('query OpsShop{ a } mutation Evil{ b }', 'query'), null);
    let r = await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{ name myshopifyDomain } }'}, cookie);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.body.data.shop.myshopifyDomain, 'innovationflooring.myshopify.com'); assert.strictEqual(s.shopify.state.tokens, 1);
    await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsInbox{ orders{ nodes{ id } } }'}, cookie); assert.strictEqual(s.shopify.state.tokens, 1, 'the key is kept and reused');
    s.shopify.state.expireNext = true;
    r = await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsInbox{ orders{ nodes{ id } } }'}, cookie); assert.strictEqual(r.status, 200); assert.strictEqual(s.shopify.state.tokens, 2, 'a key that ran out is replaced once and the question asked again');
    assert.strictEqual((await s.req('POST', '/api/shopify', {kind:'query', query:'query Everything{ customers{ nodes{ id } } }'}, cookie)).json.error.code, 'not_in_manifest');
    assert.strictEqual((await s.req('POST', '/api/shopify', {kind:'query', query:'mutation OpsAdjust($input:X!){ inventoryAdjustQuantities(input:$input){ userErrors{ code } } }'}, cookie)).status, 400, 'a change cannot be slipped through as a question');
    // a change goes through, is logged with who made it, and Shopify's own refusal comes back for the screen to show
    const adj = (from, delta) => ({kind:'mutation', query:'mutation OpsAdjust($input:InventoryAdjustQuantitiesInput!){ inventoryAdjustQuantities(input:$input){ userErrors{ code } } }', variables:{input:{name:'available', reason:'received', changes:[{inventoryItemId:'gid://shopify/InventoryItem/701', locationId:'gid://shopify/Location/1', delta, changeFromQuantity:from}]}}});
    r = await s.req('POST', '/api/shopify', adj(36, 10), cookie); assert.strictEqual(r.json.body.data.inventoryAdjustQuantities.userErrors.length, 0); assert.strictEqual(s.shopify.state.avail, 46);
    r = await s.req('POST', '/api/shopify', adj(36, 10), cookie); assert.strictEqual(r.json.body.data.inventoryAdjustQuantities.userErrors[0].code, 'CHANGE_FROM_QUANTITY_STALE'); assert.strictEqual(s.shopify.state.avail, 46, 'a repeat with a stale figure adds nothing');
    const audit = s.app.store.db.prepare("SELECT user, action FROM audit WHERE action LIKE 'shopify%'").all(); assert.strictEqual(audit.length, 2); assert.strictEqual(audit[0].action, 'shopify OpsAdjust');
    s.shopify.state.down = true; r = await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{ name } }'}, cookie); assert.strictEqual(r.status, 502); assert.strictEqual(r.json.error.code, 'upstream_error');
    // the key itself never reaches a screen
    s.shopify.state.down = false; const all = JSON.stringify((await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{ name } }'}, cookie)).json) + (await s.req('GET', '/', undefined, cookie)).text + (await s.req('GET', '/shim.js')).text;
    assert.doesNotMatch(all, /test-secret|tok\d/);
  } finally { s.stop(); }
});

test('Shopify not connected yet is said plainly', async () => {
  const s = await boot({SHOPIFY_CLIENT_ID:'', SHOPIFY_CLIENT_SECRET:''});
  try { const cookie = await s.signIn(SHOPM), r = await s.req('POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{ name } }'}, cookie); assert.strictEqual(r.status, 502); assert.strictEqual(r.json.error.code, 'server_not_connected'); }
  finally { s.stop(); }
});

test('a fitter’s sign-in cannot reach the shop’s screens, records, Shopify or pictures', async () => {
  const s = await boot();
  try {
    const shopCookie = await s.signIn(SHOPM);
    await s.req('POST', '/api/db/set', {path:'jobs/o1', data:{total:6064.36, customer:{name:'A'}}}, shopCookie);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8Dwn4GBgYmBgYGBgQEAEhACAXdBLswAAAAASUVORK5CYII=', 'base64');
    const up = await s.req('POST', '/api/assets', png, shopCookie, {'content-type':'image/png'}); assert.strictEqual(up.status, 200); assert.match(up.json.id, /^[0-9a-f]{32}$/);
    const got = await fetch(s.base + up.json.url, {headers:{cookie:shopCookie}}); assert.strictEqual(got.headers.get('content-type'), 'image/png'); assert.ok(Buffer.from(await got.arrayBuffer()).equals(png));
    assert.strictEqual((await s.req('POST', '/api/assets', Buffer.from('<script>'), shopCookie, {'content-type':'text/html'})).status, 415);
    const fid = s.app.ensureUser('Sonnie', FITTER, 'fitter'), cookie = await s.signIn(FITTER);
    assert.strictEqual((await s.req('GET', '/api/me', undefined, cookie)).json.role, 'fitter');
    for (const [m, u, b] of [['GET', '/api/db/list?coll=jobs'], ['GET', '/api/db/doc?path=jobs/o1'], ['POST', '/api/db/set', {path:'jobs/o1', data:{}}], ['POST', '/api/shopify', {kind:'query', query:'query OpsShop{ shop{ name } }'}], ['GET', '/api/users'], ['GET', up.json.url], ['GET', '/api/events']])
      assert.strictEqual((await s.req(m, u, b, cookie)).status, 403, m + ' ' + u);
    const home = await s.req('GET', '/', undefined, cookie); assert.match(home.text, /Visit arrival texts/); assert.doesNotMatch(home.text, /IFDLogic|6064/);
    // taking someone off cuts them out at once
    s.app.disableUser(fid); assert.strictEqual((await s.req('GET', '/api/me', undefined, cookie)).status, 401);
    await s.req('POST', '/api/login/code', {mobile:FITTER}); assert.strictEqual(s.texts.filter(t => t.to === FITTER).length, 1, 'and no new code is sent to them');
    assert.strictEqual((await s.req('DELETE', '/api/assets/' + up.json.id, undefined, shopCookie)).json.deleted, true); assert.strictEqual((await fetch(s.base + up.json.url, {headers:{cookie:shopCookie}})).status, 404);
  } finally { s.stop(); }
});

test('an open screen can tell when the screens have been replaced', async () => {
  const s = await boot();
  try {
    const shop = await s.signIn('07700 900002');
    const home = await s.req('GET', '/', undefined, shop);
    const m = /<meta name="ifd-version" content="([0-9a-f]{12})">/.exec(home.text);
    assert.ok(m && m[1] === s.app.version, 'the page carries the build it was made from');
    assert.strictEqual(home.headers.get('cache-control'), 'no-store');
    const ac = new AbortController(), r = await fetch(s.base + '/api/events', {headers:{cookie:shop, 'x-ifd':'1'}, signal:ac.signal});
    const rd = r.body.getReader(), dec = new TextDecoder(); let got = '';
    while (!/event: version\ndata: [^\n]+\n\n/.test(got)){ const c = await rd.read(); if (c.done) break; got += dec.decode(c.value); }
    ac.abort();
    assert.match(got, new RegExp('event: version\\ndata: \\{"v":"' + s.app.version + '"\\}'), 'the live line says which build is running as soon as it connects');
  } finally { s.stop(); }
});

test('where a postcode district is: looked up once, kept, and only for the shop', async () => {
  const s = await boot();
  try {
    const shop = await s.signIn('07700 900002');
    const a = await s.req('GET', '/api/geo?codes=g84,ML5,ZZ99,not-a-code,G84', undefined, shop);
    assert.strictEqual(a.status, 200);
    assert.deepStrictEqual(Object.keys(a.json.codes).sort(), ['G84', 'ML5'], 'districts that exist come back; unknown and malformed ones do not');
    assert.ok(Math.abs(a.json.codes.G84.lat - 56.014) < 0.001 && Math.abs(a.json.codes.ML5.lng + 4.032) < 0.001);
    const asked = s.shopify.state.geo;
    assert.strictEqual(asked, 3, 'each district is asked for once (G84, ML5 and the unknown ZZ99)');
    await s.req('GET', '/api/geo?codes=G84,ML5,ZZ99', undefined, shop);
    assert.strictEqual(s.shopify.state.geo, asked, 'the answers are kept, so nothing is asked twice');
    assert.strictEqual((await s.req('GET', '/api/geo?codes=G84')).status, 401);
    s.app.ensureUser('Sonnie', '07700 900003', 'fitter');
    assert.strictEqual((await s.req('GET', '/api/geo?codes=G84', undefined, await s.signIn('07700 900003'))).status, 403);
  } finally { s.stop(); }
});

/* ---------- audit stage 1: the rules the server itself enforces ---------- */
test('the server uses the same rules as the screens', async () => {
  const s = await boot();
  try {
    const L = s.app.rules, j = testJob();
    assert.strictEqual(typeof L.checksOutstanding, 'function'); assert.strictEqual(L.shopTotal(j), 227.4); assert.strictEqual(L.balanceOf(j), 227.4); assert.strictEqual(L.cutBlocks(j, j.lines.l1).length, 0);
    assert.match(L.owedText(j), /^£227\.40 still to pay the shop$/);
  } finally { s.stop(); }
});

test('cutting: a held job cannot be marked cut by any route, and an override is the owner’s, with a reason, on the record', async () => {
  const s = await boot();
  try {
    const shop = await s.signIn(SHOPM), owner = await s.signIn(OWNER), put = (id, extra) => s.app.store.setDoc(docPath('jobs/' + id), testJob(extra));
    put('c1'); put('c2'); put('c3');
    // the plain record route cannot tick a roll line as cut, held or not
    let r = await s.req('POST', '/api/db/update', {path:'jobs/c1', data:{lines:{l1:{picked:true, state:'allocated', bay:'W4-01'}}}}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'use_command'); assert.strictEqual(s.job('c1').lines.l1.picked, false);
    r = await s.req('POST', '/api/db/set', {path:'jobs/c1', data:testJob({lines:{l1:Object.assign({}, testJob().lines.l1, {picked:true})}})}, shop);
    assert.strictEqual(r.status, 409, 'nor can replacing the whole record'); assert.strictEqual(s.job('c1').lines.l1.picked, false);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'jobs/c1', data:{lines:{l1:{bay:'W4-01'}}, notes:'ordinary changes still save'}}, shop)).status, 200);
    // the audit's case: accepted at 3.00 x 3.80, then corrected to 5.20 x 3.80. Verification is cleared, the shop has to review it, and 3.1 m no longer covers the floor
    s.app.store.updateDoc(docPath('jobs/c1'), {rooms:{r1:{len:5.2, wid:3.8, area:19.76, status:'unverified'}}, review:{on:true, why:'Sizes changed after the sale'}});
    r = await s.cmd('cut', {jobId:'c1', lineK:'l1', bay:'W4-01', byName:'Sam'}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'held');
    assert.ok(r.json.error.why.some(t => /Size not verified: Lounge/.test(t)) && r.json.error.why.some(t => /review a change/.test(t)) && r.json.error.why.some(t => /3\.1 m on the job no longer covers the floor as measured \(19\.76 m²\)/.test(t)), r.json.error.why.join(' | '));
    assert.strictEqual(s.job('c1').lines.l1.picked, false);
    // acknowledging the review and verifying the new size does not make 3.1 m of carpet cover a 5.2 m room
    s.app.store.updateDoc(docPath('jobs/c1'), {rooms:{r1:{status:'verified'}}, review:{on:false}});
    r = await s.cmd('cut', {jobId:'c1', lineK:'l1', bay:'W4-01', byName:'Sam'}, shop);
    assert.strictEqual(r.status, 409); assert.deepStrictEqual(r.json.error.why.length, 1); assert.match(r.json.error.why[0], /no longer covers the floor/);
    // an override: not the shop's sign-in, not without a real reason, and it is written on the job
    r = await s.cmd('cut', {jobId:'c1', lineK:'l1', bay:'W4-01', byName:'Sam', override:{reason:'Customer agreed a join on the phone'}}, shop);
    assert.strictEqual(r.status, 403); assert.strictEqual(r.json.error.code, 'forbidden');
    assert.strictEqual((await s.cmd('cut', {jobId:'c1', lineK:'l1', bay:'W4-01', byName:'David', override:{reason:'ok'}}, owner)).status, 400);
    r = await s.cmd('cut', {jobId:'c1', lineK:'l1', bay:'W4-01', byName:'David', override:{reason:'Customer agreed a join on the phone'}}, owner);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.override, true);
    const l = s.job('c1').lines.l1, logged = Object.values(s.job('c1').log).map(x => x.text).join('\n');
    assert.ok(l.picked === true && l.bay === 'W4-01' && l.cutBy === 'David' && l.cutOverride.reason === 'Customer agreed a join on the phone' && l.cutOverride.byName === 'David' && /no longer covers/.test(l.cutOverride.holds[0]));
    assert.match(logged, /HOLD OVERRIDDEN by David: Customer agreed a join on the phone\. Held at the time for: .*no longer covers/);
    // a job with nothing holding it: where the piece is has to be said, it is cut once, and asking twice changes nothing
    assert.strictEqual((await s.cmd('cut', {jobId:'c2', lineK:'l1', bay:'', byName:'Sam'}, shop)).status, 400);
    assert.strictEqual((await s.cmd('cut', {jobId:'c2', lineK:'l1', bay:'GOODS-IN', byName:'Sam'}, shop)).status, 400);
    assert.strictEqual((await s.cmd('cut', {jobId:'c2', lineK:'l1', bay:'W4-02'}, shop)).status, 400, 'and by whom');
    const both = await Promise.all([s.cmd('cut', {jobId:'c2', lineK:'l1', bay:'W4-02', byName:'Sam'}, shop), s.cmd('cut', {jobId:'c2', lineK:'l1', bay:'W4-02', byName:'Sam'}, shop)]);
    assert.deepStrictEqual(both.map(x => x.status), [200, 200]); assert.strictEqual(both.filter(x => x.json.duplicate).length, 1, 'the second of two identical requests is recognised');
    assert.strictEqual(Object.values(s.job('c2').log).filter(x => /cut by Sam/.test(x.text)).length, 1); assert.strictEqual(s.job('c2').lines.l1.cutBy, 'Sam');
    // a job that is not open cannot be cut
    s.app.store.updateDoc(docPath('jobs/c3'), {status:'cancelled'});
    assert.strictEqual((await s.cmd('cut', {jobId:'c3', lineK:'l1', bay:'W4-02', byName:'Sam'}, shop)).json.error.code, 'held');
    // and a fitter's sign-in cannot reach any of this
    s.app.ensureUser('Sonnie', FITTER, 'fitter');
    assert.strictEqual((await s.cmd('cut', {jobId:'c3', lineK:'l1', bay:'W4-02', byName:'Sonnie'}, await s.signIn(FITTER))).status, 403);
    assert.strictEqual((await s.cmd('nonsense', {}, shop)).status, 404);
  } finally { s.stop(); }
});

test('money: overpayments, change and credit, the same entry twice, corrections, strike-outs and refunds', async () => {
  const s = await boot();
  try {
    const shop = await s.signIn(SHOPM), L = s.app.rules, put = (id, extra) => s.app.store.setDoc(docPath('jobs/' + id), testJob(extra)), k = n => 'key' + String(n).padStart(6, '0');
    put('m1'); put('m2'); put('m3');
    // payments only go in through the checked route
    let r = await s.req('POST', '/api/db/update', {path:'jobs/m1', data:{pay:{p1:{amount:300, method:'Cash'}}}}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'use_command'); assert.deepStrictEqual(s.job('m1').pay, {});
    // the audit's case: £300 against £227.40 owed to the shop (the other £150 is the fitter's)
    r = await s.cmd('pay', {jobId:'m1', kind:'payment', amount:300, method:'Cash', byName:'Sam', key:k(1)}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'overpayment'); assert.strictEqual(r.json.error.over, 72.6); assert.strictEqual(r.json.error.balance, 227.4); assert.deepStrictEqual(s.job('m1').pay, {});
    assert.match(r.json.error.message, /£72\.60 more than the £227\.40 still to pay the shop/);
    // change given: the shop is paid what was owed and the record says what was handed over
    r = await s.cmd('pay', {jobId:'m1', kind:'payment', amount:300, method:'Cash', byName:'Sam', key:k(1), excess:'change'}, shop);
    assert.strictEqual(r.status, 200); let e = Object.values(s.job('m1').pay)[0];
    assert.ok(e.amount === 227.4 && e.tendered === 300 && e.change === 72.6 && e.byName === 'Sam' && e.method === 'Cash'); assert.strictEqual(L.balanceOf(s.job('m1')), 0); assert.strictEqual(L.owedText(s.job('m1')), 'Nothing more to pay the shop');
    r = await s.cmd('pay', {jobId:'m1', kind:'payment', amount:10, method:'Cash', byName:'Sam', key:k(2), excess:'change'}, shop);
    assert.strictEqual(r.json.error.code, 'nothing_owed', 'change cannot be given against nothing owed');
    // kept as credit: the whole amount is recorded and the job says the customer is in credit, never "-£72.60 still to pay"
    r = await s.cmd('pay', {jobId:'m2', kind:'payment', amount:300, method:'Card machine', byName:'Sam', key:k(3), excess:'credit'}, shop);
    assert.strictEqual(r.status, 200); e = Object.values(s.job('m2').pay)[0];
    assert.ok(e.amount === 300 && e.credit === 72.6); assert.strictEqual(L.creditOf(s.job('m2')), 72.6); assert.strictEqual(L.owedText(s.job('m2')), 'The customer is £72.60 in credit');
    assert.ok(L.warningsOf(s.job('m2'), '2026-11-10', {}).some(w => /£72\.60 in credit/.test(w.text)));
    // the same entry sent twice, one after the other or at the same moment, is one entry
    r = await s.cmd('pay', {jobId:'m2', kind:'payment', amount:300, method:'Card machine', byName:'Sam', key:k(3), excess:'credit'}, shop);
    assert.strictEqual(r.json.duplicate, true); assert.strictEqual(Object.keys(s.job('m2').pay).length, 1);
    const twice = await Promise.all([1, 2].map(() => s.cmd('pay', {jobId:'m3', kind:'payment', amount:50, method:'Cash', byName:'Sam', key:k(4)}, shop)));
    assert.deepStrictEqual(twice.map(x => x.status), [200, 200]); assert.strictEqual(twice.filter(x => x.json.duplicate).length, 1); assert.strictEqual(Object.keys(s.job('m3').pay).length, 1); assert.strictEqual(L.paidOf(s.job('m3')), 50);
    // two different payments at the same moment cannot take the job past what is owed
    const race = await Promise.all([s.cmd('pay', {jobId:'m3', kind:'payment', amount:150, method:'Cash', byName:'Sam', key:k(5)}, shop), s.cmd('pay', {jobId:'m3', kind:'payment', amount:150, method:'Cash', byName:'Sam', key:k(6)}, shop)]);
    assert.deepStrictEqual(race.map(x => x.status).sort(), [200, 409]); assert.strictEqual(L.paidOf(s.job('m3')), 200); assert.strictEqual(L.balanceOf(s.job('m3')), 27.4);
    // who entered it, and a reference, are required
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'payment', amount:5, method:'Cash', key:k(7)}, shop)).status, 400);
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'payment', amount:5, method:'Cash', byName:'Sam'}, shop)).status, 400);
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'payment', amount:0, method:'Cash', byName:'Sam', key:k(7)}, shop)).status, 400);
    // a correction: the wrong entry stays, struck out, with the reason, and the right one sits beside it
    const first = Object.keys(s.job('m3').pay).find(x => s.job('m3').pay[x].amount === 50);
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'correction', payK:first, amount:60, method:'Card machine', byName:'Sam', key:k(8)}, shop)).status, 400, 'a correction needs a reason');
    r = await s.cmd('pay', {jobId:'m3', kind:'correction', payK:first, amount:60, method:'Card machine', reason:'Typed 50, the slip says 60', byName:'Sam', key:k(8)}, shop);
    assert.strictEqual(r.status, 200); let p = s.job('m3').pay;
    assert.ok(p[first].amount === 50 && p[first].void.reason === 'Typed 50, the slip says 60' && p[first].void.replacedBy === 'p' + k(8) && p['p' + k(8)].amount === 60 && p['p' + k(8)].corrects === first && p['p' + k(8)].method === 'Card machine');
    assert.strictEqual(L.paidOf(s.job('m3')), 210); assert.strictEqual(Object.keys(p).length, 3, 'nothing is deleted');
    r = await s.cmd('pay', {jobId:'m3', kind:'correction', payK:'p' + k(8), amount:500, method:'Cash', reason:'Trying to overpay by correcting', byName:'Sam', key:k(9)}, shop);
    assert.strictEqual(r.json.error.code, 'overpayment', 'a correction is checked against what is owed too');
    // striking one out: a reason, once, and it stops counting
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'void', payK:'p' + k(5), reason:'', byName:'Sam'}, shop)).status, 400);
    const struck = s.job('m3').pay['p' + k(5)] ? 'p' + k(5) : 'p' + k(6);
    r = await s.cmd('pay', {jobId:'m3', kind:'void', payK:struck, reason:'Entered on the wrong job', byName:'Sam'}, shop); assert.strictEqual(r.status, 200);
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'void', payK:struck, reason:'Entered on the wrong job', byName:'Sam'}, shop)).json.duplicate, true);
    assert.strictEqual(L.paidOf(s.job('m3')), 60); assert.strictEqual(s.job('m3').pay[struck].amount, 150); assert.strictEqual(s.job('m3').pay[struck].void.byName, 'Sam');
    // refunds: never more than was paid, always with a reason, and as their own entry
    r = await s.cmd('pay', {jobId:'m3', kind:'refund', amount:100, method:'Cash', reason:'Customer changed their mind', byName:'Sam', key:k(10)}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'over_refund');
    assert.strictEqual((await s.cmd('pay', {jobId:'m3', kind:'refund', amount:20, method:'Cash', reason:'', byName:'Sam', key:k(10)}, shop)).status, 400);
    r = await s.cmd('pay', {jobId:'m3', kind:'refund', amount:20, method:'Cash', reason:'Door bar not needed', byName:'Sam', key:k(10)}, shop); assert.strictEqual(r.status, 200);
    p = s.job('m3').pay; assert.ok(p['p' + k(10)].kind === 'refund' && p['p' + k(10)].reason === 'Door bar not needed'); assert.strictEqual(L.paidOf(s.job('m3')), 40); assert.strictEqual(L.balanceOf(s.job('m3')), 187.4); assert.strictEqual(Object.keys(p).length, 4);
    // the receipt says the same as the ledger: live entries only, the refund as a refund, the fitter's money apart
    const receipt = L.receiptMessage(s.job('m3'), SHOP);
    assert.match(receipt, /paid £60\.00 by card machine/); assert.match(receipt, /refunded £20\.00 by cash/); assert.doesNotMatch(receipt, /£50\.00|£150\.00 by/);
    assert.match(receipt, /Reference: #T9/); assert.match(receipt, /Paid to Innovation Flooring Direct so far: £40\.00\nStill to pay Innovation Flooring Direct: £187\.40\nFitting, paid straight to your fitter on the day: £150\.00\. This is not paid to the shop\./);
    assert.match(receipt, /\nInnovation Flooring Direct\n2 South Elgin Place, Clydebank G81 1XP\n0141 952 5200\nhelp@example\.test$/); assert.doesNotMatch(receipt, /Sam/, 'the receipt is signed by the shop, not a person');
    assert.match(L.receiptMessage(s.job('m2'), SHOP), /In credit with Innovation Flooring Direct: £72\.60/);
    // every change is on the job's own history, with who made it
    const hist = Object.values(s.job('m3').log).map(x => x.text).join('\n');
    assert.match(hist, /Recorded £50\.00 taken by cash\. Entered by Sam/); assert.match(hist, /corrected by Sam: Typed 50, the slip says 60\. Recorded £60\.00 taken by card machine/); assert.match(hist, /struck out by Sam: Entered on the wrong job/); assert.match(hist, /Recorded a refund of £20\.00 by cash: Door bar not needed/);
    // a new shop sale cannot be saved already carrying more paid than it comes to, or a piece already cut
    r = await s.req('POST', '/api/db/set', {path:'jobs/mnew', data:testJob({pay:{p1:{at:'2026-11-10T09:00:00.000Z', amount:500, method:'Cash'}}})}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'overpayment'); assert.strictEqual(s.app.store.getDoc('jobs/mnew').exists, false);
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/mnew', data:testJob({pay:{p1:{at:'2026-11-10T09:00:00.000Z', amount:50, method:'Cash'}}})}, shop)).status, 200, 'a deposit taken with the sale is fine');
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/mcut', data:testJob({lines:{l1:Object.assign({}, testJob().lines.l1, {picked:true})}})}, shop)).json.error.code, 'use_command');
    // a cancelled job takes no payment
    s.app.store.updateDoc(docPath('jobs/m1'), {status:'cancelled'});
    assert.strictEqual((await s.cmd('pay', {jobId:'m1', kind:'payment', amount:1, method:'Cash', byName:'Sam', key:k(11)}, shop)).json.error.code, 'invalid_state');
  } finally { s.stop(); }
});

test('messages: only the mail server or the text service taking it counts as sent; failures, retries, duplicates, test mode and hand-sent are all recorded for what they are', async () => {
  const s = await boot({}, {messaging:true});
  try {
    const shop = await s.signIn(SHOPM), owner = await s.signIn(OWNER), L = s.app.rules, k = n => 'msg' + String(n).padStart(6, '0'), ms = id => s.job(id).msgs || {};
    const quote = {qa:{n:1, at:'2026-11-10T09:00:00.000Z', byName:'Sam', lines:[{label:'Carpet', price:200}, {label:'Fitting', price:150}], total:350}};
    s.app.store.setDoc(docPath('jobs/g1'), testJob({lines:{}, total:0, fitterDue:0, quotes:quote})); s.app.store.setDoc(docPath('jobs/g2'), testJob({date:'2026-11-20', diary:true}));
    const body = 'Hi Zed,\n\nThanks for coming in. Here is your quote.\n\nCarpet: £200.00\nFitting: £150.00\n\nTotal: £350.00\n\nThanks again,\nSam\nInnovation Flooring Direct';
    const send = (extra, cookie) => s.cmd('msg.send', Object.assign({jobId:'g1', kind:'quote', channel:'email', to:'zed@example.test', subject:'Your quote from Innovation Flooring Direct', body:body, rev:'qa', byName:'Sam'}, extra), cookie || shop);
    assert.deepStrictEqual((await s.req('GET', '/api/status', undefined, shop)).json, {email:true, emailFrom:'shop@example.test', sms:true, testOnly:true, allow:0});
    // test mode is on until the owner says otherwise: nothing goes to anyone who is not on the owner's list
    let r = await send({key:k(1)});
    assert.strictEqual(r.status, 403); assert.strictEqual(r.json.error.code, 'test_mode'); assert.strictEqual(s.mailbox.state.got.length, 0); assert.deepStrictEqual(ms('g1'), {});
    r = await s.req('POST', '/api/db/update', {path:'settings/main', data:{msgs:{testOnly:false}}}, shop);
    assert.strictEqual(r.status, 403, 'the shop sign-in cannot switch test mode off'); 
    s.app.store.setDoc(docPath('settings/main'), {fitters:['Lennox']});
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{msgs:{testOnly:true, allow:['zed@example.test', '07700 900555', '07700 900556', '07700 900557']}}}, owner)).status, 200);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{bays:['W4-01']}}, shop)).status, 200, 'other settings still save for the shop');
    // a size in a quote is refused by the server too
    assert.strictEqual((await send({key:k(2), body:body.replace('Carpet:', 'Carpet 5.4m x 4m:')})).json.error.code, 'has_sizes');
    // a real send: the mail server takes it, and the record holds who, what exactly, which quote, and the server's reference
    r = await send({key:k(3)});
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true);
    let got = s.mailbox.state.got; assert.strictEqual(got.length, 1);
    assert.deepStrictEqual(got[0].to, ['zed@example.test']); assert.strictEqual(got[0].text, body, 'the customer gets exactly the words on the screen'); assert.strictEqual(got[0].subject, 'Your quote from Innovation Flooring Direct');
    assert.match(got[0].fromHeader, /Innovation Flooring Direct <shop@example\.test>/); assert.strictEqual(s.mailbox.state.signIns, 1);
    let m = ms('g1')['m' + k(3)];
    assert.ok(m.state === 'sent' && m.to === 'zed@example.test' && m.body === body && m.rev === 'qa' && m.kind === 'quote' && m.channel === 'email' && m.byName === 'Sam' && m.ref === got[0].id && m.sentAt && Object.keys(m.tries).length === 1, JSON.stringify(m));
    assert.ok(L.quoteSent(s.job('g1'), Object.assign({k:'qa'}, quote.qa)), 'and now the quote counts as sent');
    assert.match(Object.values(s.job('g1').log).map(x => x.text).join('\n'), /Quote emailed to zed@example\.test by Sam\. Accepted by the mail server, reference </);
    // the same request again is the same message; a fresh request for something already sent is refused unless it is meant
    r = await send({key:k(3)}); assert.strictEqual(r.json.duplicate, true); assert.strictEqual(s.mailbox.state.got.length, 1);
    r = await send({key:k(4)}); assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'already_sent'); assert.strictEqual(s.mailbox.state.got.length, 1); assert.strictEqual(Object.keys(ms('g1')).length, 1);
    r = await send({key:k(4), again:true}); assert.strictEqual(r.json.ok, true); assert.strictEqual(s.mailbox.state.got.length, 2);
    // a send that fails: recorded as not sent, with the reason, and it does not count as sent
    s.mailbox.state.refuse['zed@example.test'] = 1;
    r = await send({key:k(5), rev:'qb'});
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, false); m = ms('g1')['m' + k(5)];
    assert.ok(m.state === 'failed' && /would not take that address: 550/.test(m.err) && m.failedAt && !m.sentAt && !m.ref, JSON.stringify(m)); assert.strictEqual(s.mailbox.state.got.length, 2);
    assert.strictEqual(L.quoteSent(s.job('g1'), {k:'qb'}), ''); assert.strictEqual(L.msgFailed(s.job('g1')).map(x => x.k).join(), 'm' + k(5));
    assert.ok(L.warningsOf(s.job('g1'), '2026-11-10', {}).some(w => w.tone === 'bad' && /did not send/i.test(w.text)), 'the job is flagged for the shop to act on');
    assert.match(Object.values(s.job('g1').log).map(x => x.text).join('\n'), /IT DID NOT SEND: The mail server would not take that address/);
    // trying again: the same record, one message delivered, both attempts kept
    r = await s.cmd('msg.retry', {jobId:'g1', mk:'m' + k(5), byName:'Sam'}, shop);
    assert.strictEqual(r.json.ok, true); m = ms('g1')['m' + k(5)];
    assert.ok(m.state === 'sent' && m.ref && m.err === '' && Object.values(m.tries).filter(t => t.ok).length === 1 && Object.values(m.tries).filter(t => !t.ok).length === 1); assert.strictEqual(s.mailbox.state.got.length, 3); assert.strictEqual(Object.keys(ms('g1')).length, 3);
    assert.strictEqual((await s.cmd('msg.retry', {jobId:'g1', mk:'m' + k(5), byName:'Sam'}, shop)).json.error.code, 'invalid_state', 'a message that went is not sent again by retrying');
    assert.strictEqual(s.mailbox.state.got.length, 3); assert.strictEqual(L.msgFailed(s.job('g1')).length, 0);
    // the mail server being down, or refusing the sign-in, is a failure with a plain reason
    s.mailbox.state.badAuth = true; r = await send({key:k(6), rev:'qc'});
    assert.strictEqual(r.json.ok, false); assert.match(ms('g1')['m' + k(6)].err, /refused the sign-in/); s.mailbox.state.badAuth = false;
    // texts: accepted is "sent"; "delivered" only once the text service says the handset has it
    const snap = L.bookingSnap(s.job('g2')), text = L.confirmText(s.job('g2'), SHOP), rev1 = L.bookingRev(snap);
    const sms = (extra) => s.cmd('msg.send', Object.assign({jobId:'g2', kind:'confirm', channel:'sms', to:'07700 900555', body:text, rev:rev1, snap:snap, byName:'Sam'}, extra), shop);
    r = await sms({key:k(7)}); assert.strictEqual(r.json.ok, true); m = ms('g2')['m' + k(7)];
    assert.ok(m.state === 'sent' && m.to === '+447700900555' && /^SM[0-9a-f]{32}$/.test(m.ref) && m.snap.fitter === 'Lennox' && m.snap.date === '2026-11-20' && !m.deliveredAt);
    assert.strictEqual(s.twilio.state.sent[0].body, text); assert.strictEqual(s.twilio.state.sent[0].to, '+447700900555'); assert.match(text, /^Innovation Flooring Direct: your fitting is booked for Fri 20 Nov with Lennox, ref #T9\. £150\.00 for fitting is paid straight to your fitter on the day\. Still to pay the shop: £227\.40\. Any changes ring 0141 952 5200\.$/);
    assert.strictEqual(m.revNo, 1, 'the first set of booking details the customer is told is revision 1');
    assert.strictEqual(L.confirmState(s.job('g2')), 'sent');
    await s.app.commands.poll(); m = ms('g2')['m' + k(7)];
    assert.ok(m.state === 'delivered' && m.deliveredAt); assert.match(Object.values(s.job('g2').log).map(x => x.text).join('\n'), /Fitting confirmation text to \+447700900555 delivered to the handset/);
    // what the customer was told is kept with it, so a later change shows the booking as needing to be confirmed again
    s.app.store.updateDoc(docPath('jobs/g2'), {slot:'PM'}); assert.strictEqual(L.confirmState(s.job('g2')), 'changed'); assert.strictEqual(L.confirmChanges(s.job('g2')).join(), 'the booking details');
    s.app.store.updateDoc(docPath('jobs/g2'), {slot:''}); assert.strictEqual(L.confirmState(s.job('g2')), 'sent');
    // a text the network could not deliver turns from sent to failed
    s.twilio.state.undeliverable['+447700900556'] = true;
    r = await sms({key:k(8), to:'07700 900556'}); assert.strictEqual(r.json.ok, true); await s.app.commands.poll(); m = ms('g2')['m' + k(8)];
    assert.ok(m.state === 'failed' && /could not deliver it: Unreachable destination handset/.test(m.err) && m.sentAt && m.failedAt);
    // a text the service refuses outright
    s.twilio.state.refuse['+447700900557'] = 1;
    r = await sms({key:k(9), to:'07700 900557'}); assert.strictEqual(r.json.ok, false); assert.match(ms('g2')['m' + k(9)].err, /The text service refused it: The To number is not a valid phone number \(code 21211\)/);
    r = await s.cmd('msg.retry', {jobId:'g2', mk:'m' + k(9), byName:'Sam'}, shop); assert.strictEqual(r.json.ok, true); assert.strictEqual(s.twilio.state.sent.filter(t => t.to === '+447700900557').length, 1);
    // copied, or opened in an app: prepared, never sent
    s.app.store.setDoc(docPath('jobs/g3'), testJob({lines:{}, total:0, fitterDue:0, quotes:quote})); s.app.store.setDoc(docPath('jobs/g4'), testJob({date:'2026-11-20', diary:true}));
    r = await s.cmd('msg.prepared', {jobId:'g3', kind:'quote', channel:'copy', to:'', body:body, rev:'qa', byName:'Sam', how:'copied', key:k(10)}, shop); assert.strictEqual(r.status, 200);
    r = await s.cmd('msg.prepared', {jobId:'g3', kind:'quote', channel:'email', to:'zed@example.test', body:body, rev:'qa', byName:'Sam', how:'opened', key:k(11)}, shop); assert.strictEqual(r.status, 200);
    r = await s.cmd('msg.prepared', {jobId:'g4', kind:'confirm', channel:'copy', to:'', body:text, rev:rev1, snap:snap, byName:'Sam', how:'copied', key:k(12)}, shop); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(Object.values(ms('g3')).map(x => x.state), ['prepared', 'prepared']); assert.strictEqual(L.quoteSent(s.job('g3'), {k:'qa'}), '');
    const w3 = L.quoteWait(s.job('g3'), '2026-11-10'); assert.strictEqual(w3.state, 'unsent'); assert.strictEqual(w3.why, 'prepared'); assert.strictEqual(L.confirmState(s.job('g4')), 'todo', 'a copied confirmation still leaves the customer to be told');
    assert.strictEqual(s.mailbox.state.got.length, 3); assert.match(Object.values(s.job('g3').log).map(x => x.text).join('\n'), /Quote copied by Sam\. Prepared only: nothing was sent from here/);
    // sent by a member of staff themselves: recorded as exactly that, under their name
    assert.strictEqual((await s.cmd('msg.manual', {jobId:'g3', kind:'quote', channel:'email', to:'', body:body, rev:'qa', byName:'Sam', key:k(13)}, shop)).status, 400, 'where it went has to be said');
    r = await s.cmd('msg.manual', {jobId:'g3', kind:'quote', channel:'email', to:'zed@example.test', body:body, rev:'qa', byName:'Sam', note:'From the shop mailbox', key:k(13)}, shop); assert.strictEqual(r.status, 200);
    m = ms('g3')['m' + k(13)]; assert.ok(m.state === 'manual' && m.byName === 'Sam' && m.note === 'From the shop mailbox' && !m.ref); assert.ok(L.quoteSent(s.job('g3'), {k:'qa'})); assert.strictEqual(L.quoteWait(s.job('g3'), '2026-11-10').state, 'waiting');
    assert.match(Object.values(s.job('g3').log).map(x => x.text).join('\n'), /Quote recorded as sent by email from their own mailbox to zed@example\.test by Sam: From the shop mailbox/);
    // nobody can write "sent" onto a job through the plain record route
    r = await s.req('POST', '/api/db/update', {path:'jobs/g4', data:{msgs:{mforged:{kind:'confirm', state:'sent', at:'2026-11-10T09:00:00.000Z', snap:snap}}}}, shop);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'use_command'); assert.strictEqual(L.confirmState(s.job('g4')), 'todo');
    assert.strictEqual((await s.req('POST', '/api/db/set', {path:'jobs/gnew', data:testJob({msgs:{mforged:{kind:'quote', state:'sent'}}})}, shop)).status, 409, 'nor on a new record');
    // the old way of marking things sent, a click recorded on the quote or the job, no longer counts for anything
    s.app.store.setDoc(docPath('jobs/g5'), testJob({lines:{}, total:0, quotes:{qa:Object.assign({}, quote.qa, {sent:{email:{at:'2026-11-10T09:00:00.000Z', to:'zed@example.test'}}})}, confirms:{c1:{at:'2026-11-10T09:00:00.000Z', date:'2026-11-20', fitter:'Lennox'}}}));
    assert.strictEqual(L.quoteSent(s.job('g5'), {k:'qa'}), ''); assert.strictEqual(L.quoteWait(s.job('g5'), '2026-11-10').state, 'unsent');
    // none of the sending details, or who is on the owner's list, reach a screen
    const seen = JSON.stringify((await s.req('GET', '/api/status', undefined, shop)).json) + (await s.req('GET', '/', undefined, shop)).text;
    assert.doesNotMatch(seen, /mail-test-pass|tw-test-token|ACtest/); assert.strictEqual((await s.req('GET', '/api/status', undefined, shop)).json.allow, 4);
    assert.strictEqual((await s.req('GET', '/api/status')).status, 401);
  } finally { s.stop(); }
});

test('messages: with no mail server or text service set up nothing is sent and nothing says it was; a restart mid-send is not assumed to have gone', async () => {
  const s = await boot();
  try {
    const shop = await s.signIn(SHOPM), owner = await s.signIn(OWNER);
    s.app.store.setDoc(docPath('jobs/n1'), testJob());
    await s.req('POST', '/api/db/set', {path:'settings/main', data:{msgs:{testOnly:false, allow:[]}}}, owner);
    assert.deepStrictEqual((await s.req('GET', '/api/status', undefined, shop)).json, {email:false, emailFrom:'', sms:false, testOnly:false, allow:0});
    for (const ch of ['email', 'sms']){
      const r = await s.cmd('msg.send', {jobId:'n1', kind:'other', channel:ch, to:ch === 'email' ? 'zed@example.test' : '07700 900555', subject:'x', body:'Hello', rev:'', byName:'Sam', key:'nosetup' + ch}, shop);
      assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'not_set_up'); assert.match(r.json.error.message, /has not been set up yet, so nothing was sent/);
    }
    assert.strictEqual(s.job('n1').msgs, undefined); assert.strictEqual(s.texts.length, 2, 'only the two sign-in codes were ever texted');
    // caught mid-send by a restart: it is marked as not known to have gone, for a person to check, rather than sent or silently dropped
    s.app.store.updateDoc(docPath('jobs/n1'), {msgs:{mstuck:{kind:'quote', channel:'email', to:'zed@example.test', body:'Hello', rev:'qa', byName:'Sam', state:'queued', at:'2026-11-10T09:00:00.000Z'}}});
    const dir = s.dir; s.app.close();
    const again = await boot({}, {dir:dir});
    const m = again.job('n1').msgs.mstuck; assert.strictEqual(m.state, 'unsure'); assert.match(m.err, /restarted while this was being sent, so it is not known whether it went/);
    assert.strictEqual((await again.cmd('msg.retry', {jobId:'n1', mk:'mstuck', byName:'Sam'}, await again.signIn(SHOPM))).json.error.code, 'unsure_first', 'and it is not sent again blind');
    again.stop();
  } catch (e){ try { s.stop(); } catch (x) {} throw e; }
});

test('customer wording: references, the shop and the fitter paid apart with one total, how each is paid, the shop’s sign-off and no person’s name', async () => {
  const s = await boot();
  try {
    const L = s.app.rules, shop = await s.signIn(SHOPM), owner = await s.signIn(OWNER);
    const job = testJob({ref:'M-2X4AM', date:'2026-11-20', slot:'AM', diary:true, total:599.99, pay:{p1:{at:'2026-11-10T09:00:00.000Z', amount:120, method:'Card machine'}},
      lines:{a:{n:1, title:'Carpet', hold:'none', price:300}, b:{n:2, title:'Uplift and disposal', hold:'none', price:69.99}, c:{n:3, title:'Fitting', hold:'none', price:150}}});
    const q = {k:'qa', n:2, at:'2026-11-10T09:00:00.000Z', byName:'Sam', lines:[{label:'Carpet', price:300}, {label:'Underlay', price:80}, {label:'Fitting', price:150}, {label:'Uplift and disposal', price:69.99}]};
    const qm = L.quoteMessage(job, q, SHOP);
    assert.strictEqual(L.quoteRef(job, q), 'M-2X4AM-Q2'); assert.strictEqual(L.quoteSubject(job, q, SHOP), 'Your quote from Innovation Flooring Direct, ref M-2X4AM-Q2');
    assert.match(qm, /Quote reference: M-2X4AM-Q2\nDate: 10 November 2026\n\nCarpet: £300\.00\nUnderlay: £80\.00\nUplift and disposal: £69\.99\nTo pay Innovation Flooring Direct: £449\.99\n\nFitting: £150\.00\nTo pay your fitter directly: £150\.00\n\nTotal: £599\.99\n/);
    assert.match(qm, /How payment works\n£449\.99 is paid to Innovation Flooring Direct\. It is paid in the shop, by card over the phone, or by bank transfer, and is due before your fitting day\.\n£150\.00 for the fitting is paid straight to your fitter on the day, once the job is finished\. It is not paid to the shop\./);
    assert.match(qm, /reply to this email or ring us on 0141 952 5200 and quote M-2X4AM-Q2\.\n\nInnovation Flooring Direct\n2 South Elgin Place, Clydebank G81 1XP\n0141 952 5200\nhelp@example\.test$/); assert.doesNotMatch(qm, /Sam|David/);
    // a reference that happens to look like a size (2X4, or ending 4AM) is not mistaken for one, but a real size still is
    assert.strictEqual(L.hasSize(qm), true); assert.strictEqual(L.hasSize(qm, job), false); assert.strictEqual(L.hasSize(qm.replace('Carpet:', 'Carpet 5.4m x 4m:'), job), true);
    const qt = L.quoteText(job, q, SHOP); assert.ok(qt.length <= 200 && /quote M-2X4AM-Q2\. To pay the shop: £449\.99\. Fitting, paid straight to your fitter on the day: £150\.00\. Total: £599\.99\./.test(qt), qt);
    // supply only: one amount, all to the shop
    const supply = L.quoteMessage(job, {k:'qb', n:1, at:'2026-11-10T09:00:00.000Z', lines:[{label:'Carpet', price:300}]}, SHOP);
    assert.match(supply, /Carpet: £300\.00\n\nTotal: £300\.00\n\nHow payment works\n£300\.00 is paid to Innovation Flooring Direct\./); assert.doesNotMatch(supply, /fitter/);
    // the booking confirmation: reference, date, arrival, fitter, address, the money both ways, what to do beforehand, how to reach the shop
    const cm = L.confirmMessage(job, SHOP);
    assert.match(cm, /Your fitting is booked\.\n\nYour job confirmation\nReference: M-2X4AM\nDate: Friday 20 November 2026\nArrival: your fitter will text you an arrival time slot before the visit\.\nFitter: Lennox\nAddress: 1 Test Street, G81 1XP\n/);
    assert.match(cm, /Payment\nTotal: £599\.99\nTo pay Innovation Flooring Direct: £449\.99\. Paid so far: £120\.00\. Still to pay: £329\.99\. It is paid in the shop[^\n]*\nTo pay your fitter directly: £150\.00, on the day once the job is finished\. It is not paid to the shop\./);
    assert.match(cm, /Before we arrive/); assert.match(cm, /Please clear the rooms of furniture/); assert.match(cm, /We are lifting and taking away the old flooring/); assert.match(cm, /statutory consumer rights/);
    assert.match(cm, /ring us on 0141 952 5200 and quote M-2X4AM\.\n\nInnovation Flooring Direct\n2 South Elgin Place, Clydebank G81 1XP\n0141 952 5200\nhelp@example\.test$/); assert.strictEqual(L.confirmSubject(job, SHOP, false), 'Your fitting is booked with Innovation Flooring Direct, ref M-2X4AM');
    const timed = Object.assign({}, job, {arrival:{slot:'08:30 to 09:30', forDate:'2026-11-20'}});
    assert.match(L.confirmMessage(timed, SHOP), /\nArrival: between 08:30 and 09:30\n/); assert.match(L.confirmText(timed, SHOP), /booked for Fri 20 Nov, arriving between 08:30 and 09:30 with Lennox, ref M-2X4AM/);
    // a change to the day, the booking details, the arrival time, the price, the fitter, the fitting total or the address is a new revision, and the revised message says so
    const told = L.bookingSnap(job), changed = o => L.snapChanges(told, L.bookingSnap(Object.assign({}, job, o))).join();
    assert.strictEqual(changed({date:'2026-11-21'}), 'the day'); assert.strictEqual(changed({slot:'PM'}), 'the booking details'); assert.strictEqual(changed({arrival:{slot:'08:30 to 09:30', forDate:'2026-11-20'}}), 'the arrival time');
    assert.strictEqual(changed({total:650}), 'the price'); assert.strictEqual(changed({fitter:'Sonnie'}), 'the fitter'); assert.strictEqual(changed({fitterDue:100}), 'the fitting total'); assert.strictEqual(changed({}), '');
    assert.notStrictEqual(L.bookingRev(told), L.bookingRev(L.bookingSnap(Object.assign({}, job, {slot:'PM'})))); assert.strictEqual(L.bookingRev(told), L.bookingRev(L.bookingSnap(job))); assert.ok(L.bookingRev(told).length <= 40);
    const rv = L.confirmMessage(Object.assign({}, job, {slot:'PM'}), SHOP, {revised:true, changes:['the booking details']});
    assert.match(rv, /The details of your fitting have changed \(the booking details\)\. This replaces our earlier confirmation\.\n\nYour job confirmation\nReference: M-2X4AM\nDate: Friday 20 November 2026\nArrival: your fitter will text/); assert.strictEqual(L.confirmSubject(job, SHOP, true), 'Updated fitting details from Innovation Flooring Direct, ref M-2X4AM');
    // the owner's own wording replaces the standing wording, and only the owner can change it
    const own = Object.assign({}, SHOP, {words:{terms:'A deposit of half is taken with the order.', prep:'Please leave the heating off.'}});
    assert.match(L.quoteMessage(job, q, own), /£449\.99 is paid to Innovation Flooring Direct\. A deposit of half is taken with the order\./); assert.match(L.confirmMessage(job, own), /- Please leave the heating off\./); assert.doesNotMatch(L.confirmMessage(job, own), /aged 18/);
    s.app.store.setDoc(docPath('settings/main'), {fitters:['Lennox']});
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{words:{terms:'Pay whenever'}}}, shop)).status, 403);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{words:{terms:'A deposit of half is taken with the order.'}}}, owner)).status, 200);
  } finally { s.stop(); }
});

test('a send whose answer was lost is never sent again blind: it is looked up, or a person checks, and the history is kept', async () => {
  const s = await boot({}, {messaging:true});
  try {
    const shop = await s.signIn(SHOPM), L = s.app.rules, k = n => 'uns' + String(n).padStart(6, '0'), ms = id => s.job(id).msgs || {}, logOf = id => Object.values(s.job(id).log).map(x => x.text).join('\n');
    s.app.store.setDoc(docPath('settings/main'), {msgs:{testOnly:true, allow:['zed@example.test', '07700 900555', '07700 900556']}});
    const quote = {qa:{n:1, at:'2026-11-10T09:00:00.000Z', byName:'Sam', lines:[{label:'Carpet', price:200}], total:200}};
    for (const id of ['u1', 'u2', 'u3', 'u4', 'u5']) s.app.store.setDoc(docPath('jobs/' + id), testJob({lines:{}, total:0, fitterDue:0, quotes:quote}));
    const mail = (id, extra) => s.cmd('msg.send', Object.assign({jobId:id, kind:'quote', channel:'email', to:'zed@example.test', subject:'Your quote', body:'Hello Zed, your quote is £200.00', rev:'qa', byName:'Sam'}, extra), shop);
    const text = (id, extra) => s.cmd('msg.send', Object.assign({jobId:id, kind:'quote', channel:'sms', to:'07700 900555', body:'Quote #T9-Q1. Total: £200.00', rev:'qa', byName:'Sam'}, extra), shop);
    // EMAIL: the mail server took the message, then the line dropped before its answer came back
    s.mailbox.state.loseAnswer = 1;
    let r = await mail('u1', {key:k(1)});
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, false); assert.strictEqual(r.json.state, 'unsure'); let m = ms('u1')['m' + k(1)];
    assert.ok(m.state === 'unsure' && /handed to the mail server but its answer did not come back, so it is not known whether it went/.test(m.err) && m.unsureAt && !m.sentAt && !m.failedAt && /^<.+@example\.test>$/.test(m.ref), JSON.stringify(m));
    assert.strictEqual(s.mailbox.state.got.length, 1, 'in truth the customer has it');
    assert.strictEqual(L.quoteSent(s.job('u1'), {k:'qa'}), '', 'it does not count as sent'); assert.strictEqual(L.quoteWait(s.job('u1'), '2026-11-10').why, 'unsure'); assert.strictEqual(L.msgFailed(s.job('u1')).length, 1);
    assert.ok(L.warningsOf(s.job('u1'), '2026-11-10', {}).some(w => /may not have gone: check before sending it again/.test(w.text))); assert.match(logOf('u1'), /NOT KNOWN WHETHER IT WENT/);
    // it cannot be retried, and a fresh send to the same place is refused even if a second copy is asked for
    assert.strictEqual((await s.cmd('msg.retry', {jobId:'u1', mk:'m' + k(1), byName:'Sam'}, shop)).json.error.code, 'unsure_first');
    assert.strictEqual((await mail('u1', {key:k(2)})).json.error.code, 'unsure_first'); assert.strictEqual((await mail('u1', {key:k(2), again:true})).json.error.code, 'unsure_first');
    assert.strictEqual((await s.cmd('msg.check', {jobId:'u1', mk:'m' + k(1), byName:'Sam'}, shop)).status, 400, 'an email cannot be looked up');
    assert.strictEqual(s.mailbox.state.got.length, 1, 'nothing was sent again');
    // a person checks the Sent folder: it did arrive. That needs saying how they know, and is written on the job
    assert.strictEqual((await s.cmd('msg.resolve', {jobId:'u1', mk:'m' + k(1), went:true, byName:'Sam', note:''}, shop)).status, 400);
    r = await s.cmd('msg.resolve', {jobId:'u1', mk:'m' + k(1), went:true, byName:'Sam', note:'It is in the Sent folder'}, shop); assert.strictEqual(r.json.state, 'sent'); m = ms('u1')['m' + k(1)];
    assert.ok(m.state === 'sent' && m.confirmed.byName === 'Sam' && m.confirmed.note === 'It is in the Sent folder' && Object.keys(m.tries).length === 1 && m.body === 'Hello Zed, your quote is £200.00'); assert.ok(L.quoteSent(s.job('u1'), {k:'qa'}));
    assert.match(logOf('u1'), /Sam checked and it did arrive \(It is in the Sent folder\)/); assert.strictEqual(s.mailbox.state.got.length, 1); assert.strictEqual(Object.keys(ms('u1')).length, 1);
    assert.strictEqual((await s.cmd('msg.resolve', {jobId:'u1', mk:'m' + k(1), went:false, byName:'Sam'}, shop)).json.error.code, 'invalid_state', 'once settled it cannot be settled again');
    // EMAIL: the line dropped and the message was lost with it. A person checks: it did not arrive. Only then can it be sent again, once
    s.mailbox.state.loseMessage = 1;
    r = await mail('u2', {key:k(3)}); assert.strictEqual(r.json.state, 'unsure'); assert.strictEqual(s.mailbox.state.got.length, 1);
    assert.strictEqual((await s.cmd('msg.resolve', {jobId:'u2', mk:'m' + k(3), went:false, byName:'Sam', note:''}, shop)).status, 400);
    assert.strictEqual(ms('u2')['m' + k(3)].state, 'unsure');
    r = await s.cmd('msg.resolve', {jobId:'u2', mk:'m' + k(3), went:false, byName:'Sam', note:'Not in Sent, customer has nothing'}, shop); assert.strictEqual(r.json.state, 'failed');
    assert.match(ms('u2')['m' + k(3)].err, /Checked by Sam: it did not arrive\. Not in Sent, customer has nothing/);
    r = await s.cmd('msg.retry', {jobId:'u2', mk:'m' + k(3), byName:'Sam'}, shop); assert.strictEqual(r.json.ok, true); assert.strictEqual(s.mailbox.state.got.length, 2); m = ms('u2')['m' + k(3)];
    assert.ok(m.state === 'sent' && Object.keys(m.tries).length === 2 && Object.keys(ms('u2')).length === 1, 'the same message, with both tries on it');
    // TEXT: the text service took it, then the line dropped. Asking the text service finds it, so it went, and nothing is sent twice
    s.twilio.state.loseAnswer['+447700900555'] = 1;
    r = await text('u3', {key:k(4)}); assert.strictEqual(r.json.state, 'unsure'); assert.strictEqual(s.twilio.state.sent.length, 1); assert.ok(!ms('u3')['m' + k(4)].ref);
    assert.strictEqual((await text('u3', {key:k(5), again:true})).json.error.code, 'unsure_first'); assert.strictEqual(s.twilio.state.sent.length, 1);
    r = await s.cmd('msg.check', {jobId:'u3', mk:'m' + k(4), byName:'Sam'}, shop); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true); m = ms('u3')['m' + k(4)];
    assert.ok(m.state === 'sent' && m.ref === s.twilio.state.sent[0].sid && m.err === ''); assert.match(logOf('u3'), /checked with the text service by Sam\. It has it, reference SM/); assert.strictEqual(s.twilio.state.sent.length, 1);
    await s.app.commands.poll(); assert.strictEqual(ms('u3')['m' + k(4)].state, 'delivered', 'and from there it is followed to the handset as usual');
    // TEXT: the line dropped and the text never got there. Straight away the text service has no record, which is too soon to be sure; a minute on it is, and it can be sent again once
    s.twilio.state.loseText['+447700900555'] = 1;
    r = await text('u4', {key:k(6)}); assert.strictEqual(r.json.state, 'unsure'); assert.strictEqual(s.twilio.state.sent.length, 1);
    r = await s.cmd('msg.check', {jobId:'u4', mk:'m' + k(6), byName:'Sam'}, shop); assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error.code, 'too_soon'); assert.strictEqual(ms('u4')['m' + k(6)].state, 'unsure');
    s.twilio.state.listDown = true; s.clock.t += 61000;
    r = await s.cmd('msg.check', {jobId:'u4', mk:'m' + k(6), byName:'Sam'}, shop); assert.strictEqual(r.status, 502, 'if the text service cannot be asked, nothing is decided'); assert.strictEqual(ms('u4')['m' + k(6)].state, 'unsure');
    s.twilio.state.listDown = false;
    r = await s.cmd('msg.check', {jobId:'u4', mk:'m' + k(6), byName:'Sam'}, shop); assert.strictEqual(r.json.state, 'failed'); assert.match(ms('u4')['m' + k(6)].err, /has no record of it, so it did not go\. It is safe to send it again/);
    r = await s.cmd('msg.retry', {jobId:'u4', mk:'m' + k(6), byName:'Sam'}, shop); assert.strictEqual(r.json.ok, true); assert.strictEqual(s.twilio.state.sent.length, 2); assert.strictEqual(Object.keys(ms('u4')).length, 1);
    // TEXT: left alone, the system asks the text service itself after a minute and settles it either way
    s.twilio.state.loseAnswer['+447700900556'] = 1;
    r = await text('u5', {key:k(7), to:'07700 900556'}); assert.strictEqual(r.json.state, 'unsure');
    await s.app.commands.poll(); assert.strictEqual(ms('u5')['m' + k(7)].state, 'unsure', 'not inside the first minute');
    s.clock.t += 61000; await s.app.commands.poll(); assert.ok(['sent', 'delivered'].indexOf(ms('u5')['m' + k(7)].state) !== -1); assert.match(logOf('u5'), /checked with the text service by the system\. It has it/);
    assert.strictEqual(s.twilio.state.sent.filter(t => t.to === '+447700900556').length, 1);
    // a fault at the text service while taking the text is also "not known", not "failed"
    s.app.store.setDoc(docPath('jobs/u6'), testJob({lines:{}, total:0, quotes:quote})); s.twilio.state.fault = 1;
    r = await text('u6', {key:k(8)}); assert.strictEqual(r.json.state, 'unsure'); assert.match(ms('u6')['m' + k(8)].err, /had a fault \(503\)/);
    // the same request arriving again while the first is still on its way to the mail server is one message, and the answer says it is still going rather than "sent"
    s.app.store.setDoc(docPath('jobs/u7'), testJob({lines:{}, total:0, quotes:quote})); s.mailbox.state.slow = 250; const before = s.mailbox.state.got.length;
    const first = mail('u7', {key:k(9)}); await new Promise(x => setTimeout(x, 80));
    const second = await mail('u7', {key:k(9)}); assert.strictEqual(second.json.duplicate, true); assert.strictEqual(second.json.state, 'queued'); assert.strictEqual(second.json.ok, false);
    const done = await first; s.mailbox.state.slow = 0; assert.strictEqual(done.json.state, 'sent'); assert.strictEqual(s.mailbox.state.got.length, before + 1); assert.strictEqual(Object.keys(ms('u7')).length, 1);
    assert.strictEqual((await mail('u7', {key:k(9)})).json.state, 'sent', 'asked again afterwards, the same request reports that it went');
  } finally { s.stop(); }
});

test('catalogue pricing: each line worked out from the measure, Shopify’s prices and the shop’s price list; a discount off the shop’s part only; the price list is the owner’s', async () => {
  const s = await boot();
  try {
    const L = s.app.rules, shop = await s.signIn(SHOPM), owner = await s.signIn(OWNER);
    const cs = (floor, extra) => Object.assign({floor:floor, rollW:0, dir:'any', underlay:false, gripper:false, beading:null, bars:{cc:0, cf:0, ff:0}, old:false, uplift:null, furniture:false}, extra || {});
    const vr = {status:'verified', verBy:'Eddie', verRole:'estimator', verOn:'2026-11-10', source:'estimator', want:'c1'};
    const mJob = (rooms, choices) => ({v:1, ref:'M-CAT', source:'measure', status:'open', customer:{name:'Cat Alogue'}, lines:{}, quotes:{}, brief:{rooms:Object.keys(rooms).map(k => ({name:rooms[k].name, want:'c1'})), choices:choices, also:[]}, rooms:rooms});
    const roll = {k:'c1', title:'Silver twist carpet · Roll R-801 · 4m wide', variantId:'gid://shopify/ProductVariant/801', unit:'m', w:4, widths:[4, 5]};
    // ---- carpet: 3.00 x 3.80 m off a 4 m roll at Shopify's £10 per m², with underlay, gripper, a door bar, the old floor lifted and furniture moved
    const carpet = mJob({r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet', {underlay:true, gripper:true, bars:{cc:1, cf:0, ff:0}, old:true, uplift:true, furniture:true})}, vr)}, [roll]);
    const c = L.catalogue(carpet, {}, {c1:{ppm:10}}, {});
    assert.strictEqual(c.carpet.amount, 124); assert.match(c.carpet.text, /12\.40 m² of Silver twist carpet × £10\.00 per m²/);
    assert.strictEqual(c.underlay.amount, 68.29); assert.strictEqual(L.catalogue(carpet, {}, {c1:{ppm:10}}, {underlay:'12'}).underlay.amount, 91.09);
    assert.strictEqual(c.gripper.amount, 9); assert.match(c.gripper.text, /9 lengths of 1\.52 m × £1\.00/); assert.strictEqual(c.bars.amount, 9.99); assert.strictEqual(c.uplift.amount, 45.6); assert.strictEqual(c.furniture.amount, 30);
    assert.strictEqual(c.fitting.amount, 120); assert.match(c.fitting.text, /11\.40 m² × £5\.00 per m² = £57\.00, so the least charge of £120\.00 applies/);
    // a carpet Shopify has no price for is not guessed: the price per m² has to be typed, and the sum says it was
    const bare = L.catalogue(carpet, {}, {}, {}).carpet; assert.strictEqual(bare.amount, 0); assert.strictEqual(bare.needRate, true); assert.match(bare.text, /No price per m²/);
    const typed = L.catalogue(carpet, {}, {}, {carpetRate:12}).carpet; assert.strictEqual(typed.amount, 148.8); assert.match(typed.text, /£12\.00 per m²/);
    // a hall, stairs and landing: the higher least charge, and the stairs are left for a person to add
    const hsl = mJob({r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet')}, vr),
      r2:Object.assign({n:2, name:'Hall, stairs and landing', len:0, wid:0, area:0, spec:cs('carpet'), hsl:{hall:{on:false, len:0, wid:0}, stairs:{on:true, n:12, wid:0.8, tread:21, riser:21, winders:0, wdepth:0}, landing:{on:true, len:2.6, wid:2.2}}}, vr)}, [roll]);
    const h1 = L.catalogue(hsl, {}, {c1:{ppm:10}}, {}), h2 = L.catalogue(hsl, {}, {c1:{ppm:10}}, {carpetExtra:4});
    assert.strictEqual(h1.carpet.amount, 280); assert.match(h1.carpet.text, /cutting plan/);
    assert.strictEqual(h2.carpet.amount, 280); assert.strictEqual(h1.fitting.amount, 150); assert.match(h1.fitting.text, /least charge of £150\.00 with a hall, stairs and landing applies/);
    // ---- laminate: the floor plus 10% in whole packs at Shopify's pack price; no fitting rate set means none is made up
    const lam = mJob({r1:Object.assign({n:1, name:'Lounge', len:5, wid:4.6, area:23, spec:cs('flooring', {underlay:true, gripper:null, beading:true})}, vr)}, [{k:'c1', title:'Royale Oak 12mm Herringbone Laminate', variantId:'gid://shopify/ProductVariant/701', unit:'packs'}]);
    const lamG = {c1:{ppm:0, cov:1.836, pack:20.18, type:'laminate flooring'}}, l1 = L.catalogue(lam, {}, lamG, {});
    assert.strictEqual(l1.flooring.amount, 282.52); assert.match(l1.flooring.text, /23\.00 m² of Royale Oak 12mm Herringbone Laminate \+ 10% = 25\.30 m²: 14 packs of 1\.836 m² × £20\.18/);
    assert.strictEqual(l1.fitting.amount, 506); assert.match(l1.fitting.text, /Herringbone laminate/); assert.strictEqual(l1.beading.amount, 40);
    assert.strictEqual(l1.underlay.amount, 0); assert.strictEqual(l1.underlay.needPick, true); assert.match(l1.underlay.text, /choose which underlay/);
    const l2 = L.catalogue(lam, {fitLaminatePattern:12}, lamG, {underlayFloor:{id:'u1', title:'15 m2 Premium Quality Silver Underlay · 1 Roll', cov:15, pack:59.9}});
    assert.strictEqual(l2.fitting.amount, 276); assert.strictEqual(l2.underlay.amount, 119.8); assert.match(l2.underlay.text, /2 × 15 m2 Premium Quality Silver Underlay · 1 Roll \(covers 15 m² each\) × £59\.90/);
    // an underlay whose name says one size and whose Shopify coverage says another is not worked out
    assert.strictEqual(L.covClash('10 m2 Premium Quality Gold Underlay · 1 Roll', 15), 10); assert.strictEqual(L.covClash('15 m2 Premium Quality Silver Underlay · 1 Roll', 15), 0); assert.strictEqual(L.covClash('5.5mm Fibreboard Underlay · 7m2 Box', 7), 0); assert.strictEqual(L.covClash('Foam Laminate Underlay', 15), 0);
    const gold = L.catalogue(lam, {}, lamG, {underlayFloor:{id:'u2', title:'10 m2 Premium Quality Gold Underlay · 1 Roll', cov:15, pack:39.99, clash:10}}).underlay;
    assert.strictEqual(gold.amount, 0); assert.match(gold.text, /says 10 m² and Shopify says it covers 15 m²\. It is not worked out until that is put right in Shopify/);
    // ---- engineered wood: fitting by how it is laid, glue always, floor preparation always and never made up
    const eng = t => mJob({r1:Object.assign({n:1, name:'Lounge', len:5, wid:4, area:20, spec:cs('flooring')}, vr)}, [{k:'c1', title:t, variantId:'gid://shopify/ProductVariant/702', unit:'packs'}]);
    const engG = {c1:{ppm:68.78, cov:1.2, pack:82.54, type:'Real Wood Flooring'}}, keys = (job, g) => L.quoteRows(job, g).map(r => r.key + (r.must ? '!' : '')).join(',');
    const e1 = L.catalogue(eng('Harbour Engineered Herringbone'), {}, engG, {});
    assert.strictEqual(e1.flooring.amount, 1568.26); assert.strictEqual(e1.fitting.amount, 600); assert.strictEqual(e1.glue.amount, 100); assert.strictEqual(e1.prep.amount, 280); assert.match(e1.prep.text, /home check/);
    assert.strictEqual(keys(eng('Harbour Engineered Herringbone')), 'flooring,fitting,glue!,prep!');
    // told as wood by its Shopify product type when the name does not say so
    const e2 = L.catalogue(eng('Windsor Natural Oak'), {}, engG, {}); assert.strictEqual(e2.fitting.amount, 440); assert.strictEqual(e2.glue.amount, 100);
    assert.strictEqual(keys(eng('Windsor Natural Oak')), 'flooring,fitting'); assert.strictEqual(keys(eng('Windsor Natural Oak'), engG), 'flooring,fitting,glue!,prep!');
    const e3 = L.catalogue(eng('Heritage Oak 14mm Chevron Engineered'), {}, engG, {}).fitting; assert.strictEqual(e3.amount, 600); assert.match(e3.text, /Engineered chevron/);
    assert.strictEqual(L.floorKind('Frostwood Oak 6.5mm Unilin Straight Waterproof Click Vinyl', 'LVT Flooring').wood, false); assert.strictEqual(L.floorKind('Frostwood Oak 6.5mm Unilin Straight Waterproof Click Vinyl', 'LVT Flooring').lvt, true);
    // ---- the price list: the owner's figures replace the defaults one by one, and a bad figure falls back to the default
    const pl = L.priceList({fitCarpet:6, gripper:'abc', doorBar:-1, uplift:'', furniture:0});
    assert.strictEqual(pl.fitCarpet, 6); assert.strictEqual(pl.gripper, 1); assert.strictEqual(pl.doorBar, 9.99); assert.strictEqual(pl.uplift, 1.5); assert.strictEqual(pl.furniture, 0); assert.strictEqual(pl.waste, 10);
    assert.strictEqual(L.catalogue(carpet, {fitCarpet:12, fitCarpetMin:100}, {c1:{ppm:10}}, {}).fitting.amount, 136.8);
    assert.strictEqual(L.discountsOf({discounts:'5, 10,15 ; 20, 10, 150, x, 0'}).join(), '5,10,15,20'); assert.strictEqual(L.discountsOf(L.priceList({})).join(), '5,10,15,20'); assert.strictEqual(L.discountsOf(L.priceList({discounts:'12.5'})).join(), '12.5');
    // ---- a discount comes off what the shop is paid and never off the fitter's money; the customer sees full prices, the saving, and what is left to pay
    assert.strictEqual(L.discounted('Carpet', 124, 10), 111.6); assert.strictEqual(L.discounted('Fitting', 120, 10), 120); assert.strictEqual(L.discounted('Underlay', 68.29, 15), 58.05); assert.strictEqual(L.discounted('Carpet', 124, 0), 124);
    const q = {k:'qa', n:1, at:'2026-11-10T09:00:00.000Z', byName:'Sam', discount:{pct:10, amount:20.23}, lines:[{label:'Carpet', key:'carpet', price:111.6, full:124, calc:'12.40 m² of Silver twist carpet × £10.00 per m²'}, {label:'Underlay', price:61.46, full:68.29}, {label:'Door bars', price:8.99, full:9.99}, {label:'Fitting', price:120}]};
    const parts = L.quoteParts(q); assert.strictEqual(parts.discount, 20.23); assert.strictEqual(parts.pct, 10); assert.strictEqual(parts.shopTotal, 182.05); assert.strictEqual(parts.fitTotal, 120); assert.strictEqual(L.quoteTotal(q), 302.05);
    const qm = L.quoteMessage(carpet, q, SHOP);
    assert.match(qm, /Carpet: £124\.00\nUnderlay: £68\.29\nDoor bars: £9\.99\n10% discount: -£20\.23\nTo pay Innovation Flooring Direct: £182\.05\n\nFitting: £120\.00\nTo pay your fitter directly: £120\.00\n\nTotal: £302\.05\n/);
    assert.strictEqual(L.hasSize(qm, carpet), false, 'how a line was worked out, with its sizes, never reaches the customer'); assert.match(L.quoteText(carpet, q, SHOP), /Includes 10% discount of £20\.23\. To pay the shop: £182\.05\./);
    assert.doesNotMatch(L.quoteMessage(carpet, {k:'qb', n:1, at:'2026-11-10T09:00:00.000Z', lines:[{label:'Carpet', price:124}, {label:'Fitting', price:120}]}, SHOP), /discount/i);
    // an underlay priced from a Shopify product is carried to the yes screen as the product to offer first
    assert.strictEqual(L.quoteNeeds(lam, {lines:[{label:'Underlay', price:119.8, pick:'gid://shopify/ProductVariant/9101'}]})[0].pickId, 'gid://shopify/ProductVariant/9101');
    // ---- only the owner can change the price list
    s.app.store.setDoc(docPath('settings/main'), {fitters:['Lennox']});
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{prices:{fitCarpet:1}}}, shop)).status, 403);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{prices:{fitCarpet:6}}}, owner)).status, 200);
    assert.strictEqual(s.app.store.getDoc('settings/main').data.prices.fitCarpet, 6);
    assert.strictEqual((await s.req('POST', '/api/db/update', {path:'settings/main', data:{fitters:['Lennox', 'Sonnie']}}, shop)).status, 200, 'the rest of Setup is unaffected');
  } finally { s.stop(); }
});




