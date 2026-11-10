'use strict';
/* Runs the shop's real screens in a browser against this server, with the stand-in Shopify.
   Not part of `npm test` because it needs a browser: run with `node testkit/browser-check.js`. */
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const { create } = require('../server'), fake = require('./fake-shopify'), { docPath } = require('../lib/store');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8Dwn4GBgYmBgYGBgQEAEhACAXdBLswAAAAASUVORK5CYII=', 'base64');
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifd-b-')), shopify = fake.make(), texts = [];
  const app = create({env:{DATA_DIR:dir, INSECURE_COOKIES:'1', SESSION_PEPPER:'t', OWNER_NAME:'David', OWNER_MOBILE:'07700 900001', SHOP_MOBILE:'07700 900002', SHOPIFY_STORE:'innovationflooring', SHOPIFY_CLIENT_ID:'test-id', SHOPIFY_CLIENT_SECRET:'test-secret'},
    fetch:shopify.fetchImpl, sendText:async (to, body) => { texts.push({to, body}); }, log:() => {}});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port, errors = [];
  const browser = await chromium.launch({executablePath:process.env.CHROME || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
  const codeFor = to => /code: (\d{6})/.exec(texts.filter(t => t.to === to).pop().body)[1];
  async function signedIn(mobile, e164){
    const ctx = await browser.newContext({viewport:{width:1280, height:900}}), pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await pg.goto(base + '/');
    await pg.fill('#mobile', mobile); await pg.click('#b1'); await pg.waitForSelector('#code:visible');
    await pg.fill('#code', codeFor(e164)); await pg.click('#b2');
    return {ctx, pg};
  }
  try {
    const a = await signedIn('07700 900002', '+447700900002'), pg = a.pg;
    await pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    ok(true, 'the shop signs in with a texted code and the screens come up connected to Shopify');
    await pg.waitForSelector('#inboxSec .row');
    ok(/Alex Sample/.test(await pg.locator('#inboxSec').innerText()), 'website orders arrive through the server’s own line to Shopify');
    await pg.locator('#inboxSec .row', {hasText:'Alex Sample'}).getByRole('button', {name:'Make job'}).click();
    await pg.waitForSelector('#sheet .panel');
    await pg.waitForFunction(() => /14 packs on the order cover 25\.70 m²/.test(document.querySelector('#checksCard').innerText), null, {timeout:8000});
    const saved = app.store.getDoc('jobs/o5001');
    ok(saved.exists && saved.data.rooms.r1.area === 23 && saved.data.lines.l1.cov === 1.836 && /^u_/.test(Object.values(saved.data.log)[0].by), 'the job is saved on the server with its rooms, pack size and who made it');
    // a second screen, signed in separately, sees the same job and hears about changes without reloading
    const b = await signedIn('07700 900001', '+447700900001');
    await b.pg.waitForFunction(() => /Alex Sample/.test(document.querySelector('#checksSec') ? document.querySelector('#checksSec').innerText : ''), null, {timeout:10000});
    ok(true, 'a second screen shows the same job');
    await pg.locator('#checksCard .radio', {hasText:'Supply only'}).locator('input').check();
    await b.pg.waitForFunction(() => !/Alex Sample/.test(document.querySelector('#checksSec').innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/o5001').data.sizeCheck === 'none', 'a change on one screen reaches the other by itself');
    // pictures are kept by the server and come back from the saved id
    await pg.locator('#checksCard .ln', {hasText:'Living room'}).first().locator('input[type=file]').setInputFiles({name:'room.png', mimeType:'image/png', buffer:PNG});
    await pg.waitForFunction(() => { const i = document.querySelector('#checksCard .thumb img'); return i && i.complete && i.naturalWidth > 0; }, null, {timeout:8000});
    ok(fs.readdirSync(path.join(dir, 'assets')).length === 1, 'a photo is stored on the server and shown again from it');
    // a stock change goes out through the server
    await pg.keyboard.press('Escape');
    await pg.reload(); await pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    await pg.locator('#tabs .tab', {hasText:'Jobs'}).click();
    ok(/Alex Sample/.test(await pg.locator('#view').innerText()), 'the job is still there after reloading the page');
    // a fitter who cannot do the job sends it back from site, and the shop is told to act
    const tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    app.store.setDoc(docPath('settings/main'), {fitters:['Sonnie'], bays:['W4-01']});
    app.store.setDoc(docPath('jobs/tback'), {v:1, ref:'#T1', source:'shop', status:'open', type:'Fitting', date:tmr, slot:'AM', fitter:'Sonnie', diary:true, shopifyClosed:false,
      customer:{name:'Bea Returned', phone:'07700 900555', address:'1 Test Street', postcode:'G81 1XP'},
      lines:{l1:{n:1, title:'Test carpet', sub:'', unit:'m', qty:36, hold:'draft', holdRef:'#D1', state:'allocated', bay:'W4-01', picked:true, checked:true, price:100, w:4}}, total:100, pay:{}, notes:'', quote:[], drafts:{},
      arrival:{slot:'08:30 to 09:30', forDate:tmr, at:new Date().toISOString(), by:''}, sizeCheck:'verified', rooms:{r1:{n:1, name:'Bedroom', len:3.5, wid:3, area:10.5, source:'shop', status:'verified', verBy:'Shop', verRole:'shop', verOn:tmr}}, pre:{}, log:{}});
    await pg.reload(); await pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    await pg.locator('#tabs .tab', {hasText:'Today'}).click();
    ok(/Nothing has been sent back/.test(await pg.locator('#actSec').innerText()), 'Today says nothing has been sent back when nothing has');
    await pg.locator('#tabs .tab', {hasText:'Diary'}).click();
    await pg.selectOption('#diaryFitter', 'Sonnie');
    await pg.getByRole('button', {name:/Fitter.s page/}).click();
    await pg.locator('.fent', {hasText:'Bea Returned'}).click();
    await pg.locator('#sheet').getByRole('button', {name:'Send back to the shop'}).click();
    await pg.locator('#modal').getByRole('button', {name:'Send back to the shop'}).click();
    ok(/Choose why it is going back/.test(await pg.locator('#modal').innerText()) && !app.store.getDoc('jobs/tback').data.backs, 'a job cannot be sent back without saying why');
    await pg.locator('#modal .radio', {hasText:'Floor not ready'}).locator('input').check();
    await pg.fill('#backNote', 'Screed is still wet in the back bedroom.');
    await pg.locator('#modal input[type=file]').setInputFiles({name:'floor.png', mimeType:'image/png', buffer:PNG});
    await pg.waitForSelector('#modal .thumb img');
    await pg.locator('#modal').getByRole('button', {name:'Send back to the shop'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const jb = app.store.getDoc('jobs/tback').data, bk = Object.values(jb.backs)[0];
    ok(bk.on === true && bk.reason === 'floor' && bk.fitter === 'Sonnie' && bk.date === tmr && Object.keys(bk.photos).length === 1 && jb.diary === false, 'the fitter sends it back with the reason and a photo, and it leaves the diary');
    ok(jb.status === 'open' && jb.lines.l1.bay === 'W4-01' && jb.lines.l1.state === 'allocated' && jb.total === 100 && jb.date === tmr, 'sending it back changes nothing else: stock, bay, price and date are as they were');
    const fs2 = await pg.locator('#sheet').innerText();
    ok(/With the shop/.test(fs2) && /Screed is still wet/.test(fs2) && !/£|Sign off this visit/.test(fs2), 'the fitter sees it is with the shop, with no prices and no sign-off');
    await b.pg.waitForFunction(() => /Bea Returned/.test((document.querySelector('#actSec') || {}).innerText || ''), null, {timeout:8000});
    const act = await b.pg.locator('#actSec').innerText();
    ok(/Act now/i.test(act) && /Sent back by Sonnie/.test(act) && /Floor not ready\. Screed is still wet/.test(act) && /1 photo/.test(act), 'the shop’s Today screen shows it under Act now straight away, with who, why and the photo count');
    ok(/Sonnie has sent Bea Returned back to the shop/.test(await b.pg.locator('#toast').innerText()), 'the shop’s screen is told the moment it happens');
    await b.pg.locator('#actSec .row', {hasText:'Bea Returned'}).click();
    await b.pg.waitForSelector('#backCard');
    ok(await b.pg.locator('#sheet').getByRole('button', {name:'Put in the diary'}).isDisabled(), 'it cannot go back in the diary until the shop has dealt with it');
    await b.pg.locator('#backCard').getByRole('button', {name:'Deal with it'}).click();
    await b.pg.locator('#modal').getByRole('button', {name:'Mark as dealt with'}).click();
    ok(/Say what was done/.test(await b.pg.locator('#modal').innerText()), 'dealing with it needs a note of what was done');
    await b.pg.fill('#backDone', 'Rang the customer, rebooked for next week.');
    await b.pg.locator('#modal').getByRole('button', {name:'Mark as dealt with'}).click();
    await b.pg.waitForFunction(() => document.querySelector('#modal').hidden && !document.querySelector('#backCard'), null, {timeout:6000});
    const done = Object.values(app.store.getDoc('jobs/tback').data.backs)[0];
    ok(done.on === false && /rebooked/.test(done.doneNote) && /^u_/.test(done.doneBy) && done.note === 'Screed is still wet in the back bedroom.', 'the shop records what was done and the original reason is kept');
    ok(/Nothing has been sent back/.test(await b.pg.locator('#actSec').innerText()) && /Sent back before/.test(await b.pg.locator('#sheet').innerText()), 'Act now clears and the job keeps the history');
    ok(!(await b.pg.locator('#sheet').getByRole('button', {name:'Put in the diary'}).isDisabled()), 'once dealt with, the shop can put it back in the diary');
    await b.pg.keyboard.press('Escape');
    await pg.keyboard.press('Escape'); await pg.getByRole('button', {name:'Back to the shop'}).click();
    ok(shopify.state.calls.includes('OpsShop') && shopify.state.calls.includes('OpsInbox') && shopify.state.tokens === 1, 'every Shopify question went through one server-held key');
    ok(await pg.getByRole('button', {name:'Sign out'}).isVisible(), 'the shared screen has a way to sign out');
    await pg.getByRole('button', {name:'Sign out'}).click(); await pg.waitForSelector('#mobile');
    await pg.goto(base + '/'); ok(await pg.locator('#mobile').isVisible(), 'after signing out the screens are closed again');
    // a fitter can sign in but gets none of the shop's screens
    app.ensureUser('Sonnie', '07700 900003', 'fitter');
    const f = await signedIn('07700 900003', '+447700900003');
    await f.pg.waitForFunction(() => /signed in, Sonnie/.test(document.body.innerText), null, {timeout:8000});
    ok(!/£|New sale|Alex Sample/.test(await f.pg.locator('body').innerText()), 'a fitter’s sign-in shows none of the shop’s screens');
    console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'browser checks on the hosted server passed: ' + passed);
    if (errors.length) process.exitCode = 1;
  } catch (e){ console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').filter(l => /browser-check/.test(l)).join('\n'), '\n', errors.join(' | ')); process.exitCode = 1; }
  finally { await browser.close(); app.close(); fs.rmSync(dir, {recursive:true, force:true}); }
})();
