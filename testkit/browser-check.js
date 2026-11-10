'use strict';
/* Runs the shop's real screens in a browser against this server, with the stand-in Shopify.
   Not part of `npm test` because it needs a browser: run with `node testkit/browser-check.js`. */
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const { create } = require('../server'), fake = require('./fake-shopify');
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
