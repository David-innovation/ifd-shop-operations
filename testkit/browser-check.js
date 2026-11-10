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
    app.store.setDoc(docPath('settings/main'), {fitters:['Sonnie', 'Lennox'], bays:['W4-01']});
    app.store.setDoc(docPath('jobs/tback'), {v:1, ref:'#T1', source:'shop', status:'open', type:'Fitting', date:tmr, slot:'AM', fitter:'Sonnie', diary:true, shopifyClosed:false,
      customer:{name:'Bea Returned', phone:'07700 900555', address:'1 Test Street', postcode:'G81 1XP'},
      lines:{l1:{n:1, title:'Test carpet', sub:'', unit:'m', qty:36, hold:'draft', holdRef:'#D1', state:'allocated', bay:'W4-01', picked:true, checked:true, price:100, w:4}}, total:100, pay:{}, notes:'', quote:[], drafts:{},
      arrival:{slot:'08:30 to 09:30', forDate:tmr, at:new Date().toISOString(), by:''}, sizeCheck:'verified', rooms:{r1:{n:1, name:'Bedroom', len:3.5, wid:3, area:10.5, source:'shop', status:'verified', verBy:'Shop', verRole:'shop', verOn:tmr}}, pre:{}, log:{}});
    await pg.reload(); await pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    await pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'settings/main', data:{estimators:[]}})}));   // so the other open screen hears about the fitters too
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
    await pg.waitForFunction(() => /With the shop/.test(document.querySelector('#sheet').innerText), null, {timeout:6000});
    const fs2 = await pg.locator('#sheet').innerText();
    ok(/With the shop/.test(fs2) && /Screed is still wet/.test(fs2) && !/£|Sign off this visit/.test(fs2), 'the fitter sees it is with the shop, with no prices and no sign-off');
    await b.pg.waitForFunction(() => /Bea Returned/.test((document.querySelector('#actSec') || {}).innerText || ''), null, {timeout:8000});
    const act = await b.pg.locator('#actSec').innerText();
    ok(/Act now/i.test(act) && /Sent back by Sonnie/.test(act) && /Floor not ready\. Screed is still wet/.test(act) && /1 photo/.test(act), 'the shop’s Today screen shows it under Act now straight away, with who, why and the photo count');
    ok(/Sonnie has sent Bea Returned back to the shop/.test(await b.pg.locator('#toast').innerText()), 'the shop’s screen is told the moment it happens');
    await b.pg.locator('#actSec .row', {hasText:'Bea Returned'}).click();
    await b.pg.waitForSelector('#backCard');
    ok(await b.pg.locator('#sheet').getByRole('button', {name:'Put in the diary', exact:true}).count() === 0, 'it cannot simply be put back in the diary while it is sent back');
    await b.pg.locator('#sheet .card', {hasText:'Installation: when and who'}).getByRole('button', {name:'Deal with it and rebook'}).click();
    await b.pg.locator('#modal').getByRole('button', {name:'Save', exact:true}).click();
    ok(/Say what was done/.test(await b.pg.locator('#modal').innerText()), 'dealing with it needs a note of what was done');
    await b.pg.fill('#backDone', 'Rang the customer, rebooked.');
    await b.pg.locator('#modal').getByRole('button', {name:'Save', exact:true}).click();
    ok(/Tap the new day/.test(await b.pg.locator('#modal').innerText()) && Object.values(app.store.getDoc('jobs/tback').data.backs)[0].on === true, 'and either a new day or a clear statement that there is none yet');
    const freeRow = b.pg.locator('#modal .area-row', {hasText:'Lennox'});
    ok(new RegExp(String(Number(tmr.slice(8)))).test(await freeRow.innerText()), 'it shows the next free day for each fitter');
    await freeRow.getByRole('button', {name:'Use this'}).click();
    ok(await b.pg.locator('#backFitterNew').inputValue() === 'Lennox' && await b.pg.locator('#backDate').inputValue() === tmr && /Lennox.s diary/.test(await b.pg.locator('#modal .dpick').innerText()), 'using one picks that fitter and day and brings up their diary');
    await b.pg.selectOption('#backFitterNew', 'Sonnie');
    await b.pg.locator('#modal .area-row', {hasText:'Sonnie'}).getByRole('button', {name:'Use this'}).click();
    await b.pg.locator('#modal').getByRole('button', {name:'Save', exact:true}).click();
    await b.pg.waitForFunction(() => document.querySelector('#modal').hidden && !document.querySelector('#backCard'), null, {timeout:6000});
    const rb = app.store.getDoc('jobs/tback').data, done = Object.values(rb.backs)[0];
    ok(done.on === false && /rebooked/.test(done.doneNote) && /^u_/.test(done.doneBy) && done.note === 'Screed is still wet in the back bedroom.', 'the shop records what was done and the original reason is kept');
    ok(rb.diary === true && rb.fitter === 'Sonnie' && rb.date === tmr && rb.lines.l1.bay === 'W4-01' && rb.total === 100, 'saving rebooks it into the diary on the chosen day with the chosen fitter, and nothing else changes');
    ok(/Nothing has been sent back/.test(await b.pg.locator('#actSec').innerText()) && /Sent back before/.test(await b.pg.locator('#sheet').innerText()), 'Act now clears and the job keeps the history');
    await b.pg.keyboard.press('Escape');
    await pg.keyboard.press('Escape'); await pg.getByRole('button', {name:'Back to the shop'}).click();
    // choosing a day: the chosen person's diary, not a calendar box
    const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10), dnum = iso => String(Number(iso.slice(8)));
    const off2 = {}; off2[day(2)] = {off:true, note:'Holiday', at:new Date().toISOString(), by:''};
    app.store.setDoc(docPath('timeoff/p-sonnie'), {name:'Sonnie', days:off2});
    await pg.reload(); await pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    await pg.getByRole('button', {name:'New sale'}).first().click();
    await pg.waitForSelector('#modal .dstrip');
    ok(await pg.locator('#modal input[type=date]:visible').count() === 0, 'a new sale has no calendar box to pick the day from');
    ok(/Whole diary/.test(await pg.locator('#modal .dpick').innerText()), 'with nobody chosen it shows the whole diary');
    await pg.selectOption('#saleFitter', 'Sonnie');
    await pg.waitForFunction(() => /Sonnie.s diary/.test(document.querySelector('#modal .dpick').innerText));
    const cellOf = async (root, iso) => { const pgx = root; for (let i = 0; i < 3; i++){ const c = pgx.locator('.dday', {has:pg.locator('.dn', {hasText:new RegExp('^' + dnum(iso) + '$')})}); if (await c.count()) return c.first(); await pgx.getByRole('button', {name:'Later'}).click(); } throw new Error('day not found ' + iso); };
    const m1 = pg.locator('#modal');
    const busy = await cellOf(m1, tmr);
    ok(/1 booked/.test(await busy.innerText()), 'choosing the person brings up their diary with what they already have on each day');
    const offCell = await cellOf(m1, day(2));
    ok(/Day off/.test(await offCell.innerText()) && await offCell.isDisabled(), 'a day they cannot work shows as a day off and cannot be chosen');
    const free = await cellOf(m1, day(3));
    ok(/Next free/.test(await free.innerText()), 'their next free day is marked, skipping the booked day and the day off');
    await free.click();
    ok(await pg.locator('#saleDate').inputValue() === day(3) && /Chosen:/.test(await pg.locator('#modal .ddetail').innerText()) && /nothing else booked/.test(await pg.locator('#modal .ddetail').innerText()), 'tapping a day chooses it and says what else is on');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click();
    // the same on a job: tap a day in the fitter's diary, or clear it
    await pg.locator('#tabs .tab', {hasText:'Jobs'}).click();
    await pg.locator('#view .row', {hasText:'Bea Returned'}).first().click();
    await pg.waitForSelector('#sheet .dstrip');
    ok(await pg.locator('#sheet input[type=date]:visible').count() === 0 && /Sonnie.s diary/.test(await pg.locator('#sheet .dpick').innerText()), 'the job shows its fitter’s diary in place of the calendar box');
    const s1 = pg.locator('#sheet .dpick'); const tgt = await cellOf(s1, day(4)); await tgt.click();
    await pg.waitForFunction(d => /Chosen/.test(document.querySelector('#sheet .ddetail').innerText) && document.querySelector('#jobDate').value === d, day(4), {timeout:6000});
    ok(app.store.getDoc('jobs/tback').data.date === day(4), 'tapping a day in the fitter’s diary moves the job to that day');
    await pg.locator('#sheet .dpick').getByRole('button', {name:'No date'}).click();
    await pg.waitForFunction(() => /Tap a day/.test(document.querySelector('#sheet .ddetail').innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/tback').data.date === '', 'the date can still be cleared');
    await pg.keyboard.press('Escape');
    // booking a measure: nothing to pick until a person is chosen, then their diary
    await pg.getByRole('button', {name:'Book a measure'}).first().click();
    await pg.waitForSelector('#modal .dpick');
    ok(/Choose whose diary first/.test(await pg.locator('#modal .dpick').innerText()) && await pg.locator('#modal .dday').count() === 0, 'booking a measure asks for the person before showing any days');
    await pg.locator('#modal .radio', {hasText:'Sonnie'}).locator('input').check();
    await pg.waitForFunction(() => document.querySelectorAll('#modal .dday').length === 7);
    ok(/Sonnie.s diary/.test(await pg.locator('#modal .dpick').innerText()) && await pg.locator('#modal input[type=date]:visible').count() === 0, 'then that person’s diary comes up, with no calendar box');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click();
    // a fitter's day: one hall, stairs and landing, and the day's work kept within reach
    const X = day(8), live = () => pg.waitForFunction(() => document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:10000});
    const mkJob = (id, name, pc, extra) => app.store.setDoc(docPath('jobs/' + id), Object.assign({v:1, ref:'#' + id.toUpperCase(), source:'shop', status:'open', type:'Fitting', date:'', slot:'', fitter:'Sonnie', diary:false, shopifyClosed:false,
      customer:{name:name, phone:'07700 900556', address:'2 Test Street', postcode:pc},
      lines:{l1:{n:1, title:'Test carpet', sub:'', unit:'m', qty:30, hold:'draft', holdRef:'#D2', state:'allocated', bay:'W4-01', picked:true, checked:true, price:90, w:4}}, total:90, pay:{}, notes:'', quote:[], drafts:{},
      sizeCheck:'verified', rooms:{r1:{n:1, name:'Bedroom', len:3, wid:3, area:9, source:'shop', status:'verified', verBy:'Shop', verRole:'shop', verOn:tmr}}, pre:{}, log:{}}, extra || {}));
    mkJob('h1', 'Helen Stairs', 'G84 7AA', {date:X, diary:true, rooms:{r1:{n:1, name:'Hall, stairs and landing', len:4, wid:1, area:4, source:'shop', status:'verified', verBy:'Shop', verRole:'shop', verOn:tmr}}});
    mkJob('h2', 'Second Stairs', 'G84 8BB', {hsl:true});
    mkJob('h3', 'Far Bedrooms', 'ML5 1AA');
    mkJob('h4', 'Near Bedrooms', 'G82 1AA');
    await pg.reload(); await live();
    const openJob = async name => { await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Jobs'}).click(); await pg.locator('#view .row', {has:pg.locator('.who', {hasText:name})}).first().click(); await pg.waitForSelector('#sheet .dstrip'); return pg.locator('#sheet .dpick'); };
    let sx = await openJob('Second Stairs'), cx = await cellOf(sx, X);
    ok(await pg.locator('#jobHsl').isChecked() && /HSL full/.test(await cx.innerText()) && await cx.isDisabled(), 'a second hall, stairs and landing cannot be put on a day the fitter already has one');
    sx = await openJob('Near Bedrooms'); cx = await cellOf(sx, X);
    await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sheet .dday .da')).some(x => /\d+ mi$/.test(x.textContent)), null, {timeout:8000});
    ok(/HSL on/.test(await cx.innerText()) && /\b8 mi\b/.test(await cx.innerText()) && !(await pg.locator('#jobHsl').isChecked()), 'other rooms can still go on that day, and it shows how near they are');
    await cx.click();
    await pg.waitForFunction(d => document.querySelector('#jobDate').value === d, X, {timeout:6000});
    ok(app.store.getDoc('jobs/h4').data.date === X && await pg.locator('#sheet .dpick .banner:visible').count() === 0, 'a job within reach goes straight on');
    sx = await openJob('Far Bedrooms'); cx = await cellOf(sx, X);
    await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sheet .dday .dfar')).some(x => /mi away/.test(x.textContent)), null, {timeout:8000});
    ok(/30 mi away/.test(await cx.innerText()), 'a job an hour away shows in red with the miles');
    await cx.click();
    await pg.waitForSelector('#sheet .dpick .banner:visible');
    ok(/30 miles from Sonnie.s other work that day/.test(await pg.locator('#sheet .dpick .banner').innerText()) && app.store.getDoc('jobs/h3').data.date === '', 'choosing it stops and says why, without booking anything');
    await pg.locator('#sheet .dpick').getByRole('button', {name:'Book it anyway'}).click();
    await pg.waitForFunction(d => document.querySelector('#jobDate').value === d, X, {timeout:6000});
    ok(app.store.getDoc('jobs/h3').data.date === X, 'it can still be booked on purpose');
    await pg.keyboard.press('Escape');
    await pg.waitForFunction(() => Array.from(document.querySelectorAll('#view .row')).some(r => /Far Bedrooms/.test((r.querySelector('.who') || {}).innerText || '') && /30 miles from Sonnie.s other work that day \(Helen Stairs, G84\)/i.test(r.innerText)), null, {timeout:6000}).catch(() => {});
    const farRow = await pg.locator('#view .row', {has:pg.locator('.who', {hasText:'Far Bedrooms'})}).first().innerText();
    ok(/30 miles from Sonnie.s other work that day \(Helen Stairs, G84\)/i.test(farRow), 'and the job carries the warning afterwards: ' + farRow.replace(/\n+/g, ' | '));
    // forced on by another route, it still cannot be confirmed
    await pg.evaluate(d => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/h2', data:{date:d}})}), X);
    sx = await openJob('Second Stairs');
    await pg.waitForFunction(() => /already has a hall, stairs and landing/.test(document.querySelector('#sheet').innerText), null, {timeout:6000});
    ok(await pg.locator('#sheet').getByRole('button', {name:'Put in the diary', exact:true}).isDisabled() && /Second hall, stairs and landing for Sonnie/.test(await pg.locator('#sheet').innerText()), 'a second one that gets onto the day some other way cannot be confirmed in the diary');
    // the limit is the shop's to change
    await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Setup'}).click();
    await pg.fill('#limHsl', '2'); await pg.fill('#limMiles', '40'); await pg.getByRole('button', {name:'Save the limits'}).click();
    await pg.waitForFunction(() => true); const lim = () => app.store.getDoc('settings/main').data.limits || {};
    for (let i = 0; i < 40 && lim().hsl !== 2; i++) await pg.waitForTimeout(100);
    ok(lim().hsl === 2 && lim().miles === 40 && app.store.getDoc('settings/main').data.fitters.length === 2, 'the limits are set in Setup, without disturbing the rest of the settings');
    sx = await openJob('Second Stairs');
    ok(!(await pg.locator('#sheet').getByRole('button', {name:'Put in the diary', exact:true}).isDisabled()), 'with the limit raised to two, the second one is allowed');
    await pg.keyboard.press('Escape');
    ok(!/miles from/.test(await pg.locator('#view .row', {has:pg.locator('.who', {hasText:'Far Bedrooms'})}).first().innerText()), 'and with the distance raised, the far job is no longer flagged');
    await pg.getByRole('button', {name:'New sale'}).first().click(); await pg.waitForSelector('#modal .dstrip');
    await pg.locator('#modal .seg button', {hasText:'Fitting'}).click(); await pg.locator('#saleHsl').check(); await pg.selectOption('#saleFitter', 'Sonnie');
    cx = await cellOf(pg.locator('#modal'), X);
    ok(/HSL full/.test(await cx.innerText()) && await cx.isDisabled(), 'a new sale with a hall, stairs and landing cannot take a day that is already at the limit');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click();
    // a screen left open brings itself up to date when the screens have been replaced, without losing work in hand
    await pg.locator('#tabs .tab', {hasText:'Today'}).click();
    await pg.evaluate(() => { window.__mark = 1; document.querySelector('meta[name="ifd-version"]').content = 'an-older-build'; });
    app.dropLive();                                                             // what a restart looks like to an open screen
    await pg.waitForFunction(() => !window.__mark && document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:20000});
    ok(await pg.evaluate(v => document.querySelector('meta[name="ifd-version"]').content === v, app.version), 'an idle screen refreshes itself onto the new build');
    await pg.getByRole('button', {name:'New sale'}).first().click(); await pg.fill('#saleName', 'Half typed');
    await pg.evaluate(() => { window.__mark = 1; document.querySelector('meta[name="ifd-version"]').content = 'an-older-build'; });
    app.dropLive();
    await pg.waitForSelector('#staleBar', {timeout:20000});
    ok(await pg.evaluate(() => window.__mark === 1) && await pg.locator('#saleName').inputValue() === 'Half typed', 'a screen with something open is told, and is not refreshed under the person’s hands');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await pg.locator('h1').first().click();
    await pg.waitForFunction(() => !window.__mark && document.querySelector('#storeText') && document.querySelector('#storeText').textContent === 'Shopify live', null, {timeout:20000});
    ok(true, 'it refreshes as soon as they close what they were doing');
    app.store.setDoc(docPath('jobs/tlive'), {v:1, ref:'#T9', source:'shop', status:'open', type:'Collection', date:'', slot:'', fitter:'', diary:false, customer:{name:'Late Arrival', phone:'07700 900777'}, lines:{}, total:0, pay:{}, quote:[], drafts:{}, sizeCheck:'none', rooms:{}, pre:{}, log:{}});
    await b.pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/tlive', data:{notes:'x'}})}));
    await pg.locator('#tabs .tab', {hasText:'Jobs'}).click();
    await pg.waitForFunction(() => /Late Arrival/.test(document.querySelector('#view').innerText), null, {timeout:10000});
    ok(true, 'live updates keep arriving after the connection has been dropped and picked up again');
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
