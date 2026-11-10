'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { create } = require('../server'), fake = require('../testkit/fake-shopify'), { merge } = require('../lib/store'), { normaliseMobile } = require('../lib/sms'), sh = require('../lib/shopify');

const OWNER = '+447700900001', SHOPM = '+447700900002', FITTER = '+447700900003';
async function boot(extra){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifd-')), shopify = fake.make(), texts = [], clock = {t:Date.parse('2026-11-10T09:00:00Z')};
  const env = Object.assign({DATA_DIR:dir, INSECURE_COOKIES:'1', SESSION_PEPPER:'test', OWNER_NAME:'David', OWNER_MOBILE:'07700 900001', SHOP_MOBILE:'07700 900002', SHOPIFY_STORE:'innovationflooring', SHOPIFY_CLIENT_ID:'test-id', SHOPIFY_CLIENT_SECRET:'test-secret'}, extra || {});
  const app = create({env, fetch:shopify.fetchImpl, sendText:async (to, body) => { texts.push({to, body}); }, now:() => clock.t, log:() => {}});
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
  return {app, base, req, texts, clock, shopify, codeFor, signIn, dir, stop:() => { app.close(); fs.rmSync(dir, {recursive:true, force:true}); }};
}

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
    await Promise.all([s.req('POST', '/api/db/update', {path:'jobs/o1', data:{pay:{p1:{amount:50}}}}, cookie), s.req('POST', '/api/db/update', {path:'jobs/o1', data:{pay:{p2:{amount:25}}}}, cookie)]);
    assert.deepStrictEqual(Object.keys((await s.req('GET', '/api/db/doc?path=jobs/o1', undefined, cookie)).json.data.pay).sort(), ['p1', 'p2']);
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
    const home = await s.req('GET', '/', undefined, cookie); assert.match(home.text, /signed in, Sonnie/); assert.doesNotMatch(home.text, /IFDLogic|6064/);
    // taking someone off cuts them out at once
    s.app.disableUser(fid); assert.strictEqual((await s.req('GET', '/api/me', undefined, cookie)).status, 401);
    await s.req('POST', '/api/login/code', {mobile:FITTER}); assert.strictEqual(s.texts.filter(t => t.to === FITTER).length, 1, 'and no new code is sent to them');
    assert.strictEqual((await s.req('DELETE', '/api/assets/' + up.json.id, undefined, shopCookie)).json.deleted, true); assert.strictEqual((await fetch(s.base + up.json.url, {headers:{cookie:shopCookie}})).status, 404);
  } finally { s.stop(); }
});
