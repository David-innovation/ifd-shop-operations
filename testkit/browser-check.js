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
    await pg.getByRole('button', {name:/(Fitter|Sonnie|Lennox|Stiv).s page/}).click();
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
    const answer = async (i, o) => { const P = '#fr' + i; o = o || {};
      await pg.click(P + (o.floor === 'flooring' ? 'Flooring' : 'Carpet'));
      await pg.click(P + 'Underlay' + (o.underlay === false ? 'N' : 'Y')); await pg.click(P + (o.floor === 'flooring' ? 'Beading' : 'Gripper') + (o.edge === false ? 'N' : 'Y'));
      if (o.bars){ await pg.click(P + 'BarsY'); for (const k of Object.keys(o.bars)) await pg.fill(P + 'Bar' + k, String(o.bars[k])); } else await pg.click(P + 'BarsN');
      await pg.click(P + 'Old' + (o.old ? 'Y' : 'N')); if (o.old) await pg.click(P + 'Uplift' + (o.uplift ? 'Y' : 'N')); await pg.click(P + 'Furn' + (o.furn ? 'Y' : 'N')); };
    const openJobPlain = async name => { await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Jobs'}).click(); await pg.locator('#view .row', {has:pg.locator('.who', {hasText:name})}).first().click(); await pg.waitForSelector('#sheet .panel'); };
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
    // choosing the estimator sends the measure to them: onto a day they are already near, or as urgent to arrange
    await pg.keyboard.press('Escape');
    await pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'settings/main', data:{estimators:['Eddie'], limits:{hsl:1, miles:10}}})}));
    const visit = (k, d, extra) => { const o = {}; o[k] = Object.assign({n:1, kind:'measure', who:'Eddie', date:d, slot:'', status:'booked', at:new Date().toISOString(), by:''}, extra || {}); return o; };
    mkJob('m1', 'Eddie Nearby', 'G81 2AA', {fitter:'', lines:{}, total:0, sizeCheck:'estimator', rooms:{}, pre:visit('v1', day(2))});
    mkJob('u1', 'Urgent Coatbridge', 'ML5 2BB', {fitter:'Lennox', date:day(10), sizeCheck:'', rooms:{r1:{n:1, name:'Bedroom', len:3, wid:3, area:9, source:'customer', status:'unverified', line:'l1'}}});
    mkJob('u2', 'Short Carpet', 'G81 4CC', {fitter:'Lennox', date:day(11), sizeCheck:'estimator', rooms:{r1:{n:1, name:'Lounge', len:3, wid:3, area:9, source:'customer', status:'unverified', line:'l1'}}, pre:visit('v1', day(2))});
    await pg.reload(); await live();
    await pg.getByRole('button', {name:'New sale'}).first().click(); await pg.waitForSelector('#modal .dstrip');
    await pg.fill('#saleName', 'Auto Measure'); await pg.fill('#salePhone', '07700 900888'); await pg.fill('#salePost', 'G81 3BB');
    await pg.locator('#modal .seg button', {hasText:'Fitting'}).click(); await pg.selectOption('#saleFitter', 'Lennox');
    await (await cellOf(pg.locator('#modal'), day(9))).click();
    await pg.locator('#modal .radio', {hasText:'An estimator must measure'}).locator('input').check();
    await pg.waitForFunction(() => /Goes in Eddie.s diary/.test((document.querySelector('#saleEstPlan') || {}).textContent || ''), null, {timeout:6000});
    ok(new RegExp('for \\w+ ' + dnum(day(2)) + ' ').test(await pg.locator('#saleEstPlan').innerText()) && /already near G81 \(Eddie Nearby, G81\)/.test(await pg.locator('#saleEstPlan').innerText()), 'choosing the estimator on a sale says which day it will go in their diary, and why');
    ok(/The fitting is only 7 days after that/.test(await pg.locator('#saleEstPlan').innerText()) && /up to 10 days to come in/.test(await pg.locator('#saleEstPlan').innerText()), 'and warns when that leaves less time before the fitting than a new carpet takes to come in');
    await pg.getByRole('button', {name:'Add another charge'}).click(); await pg.locator('#modal input[placeholder="Fitting, delivery, door bars"]').fill('Fitting'); await pg.locator('#modal input[id^="ln-p-"]').fill('50');
    await pg.locator('#modal').getByRole('button', {name:'Save the sale'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:10000});
    const sale = Object.values(app.store.getDoc('jobs/d9001').data.pre)[0];
    ok(sale.who === 'Eddie' && sale.date === day(2) && sale.status === 'booked' && sale.auto === true && sale.urgent === false, 'saving the sale books the measure with the estimator on that day');
    await openJob('Urgent Coatbridge');
    await pg.locator('#checksCard .radio', {hasText:'An estimator must measure'}).locator('input').check();
    await pg.waitForFunction(() => /Urgent: Eddie has to arrange this/.test(document.querySelector('#checksCard').innerText), null, {timeout:6000});
    const urg = Object.values(app.store.getDoc('jobs/u1').data.pre)[0];
    ok(urg.who === 'Eddie' && urg.date === '' && urg.urgent === true, 'when the estimator is not near in time it goes to them as urgent, with no day');
    await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Jobs'}).click();
    ok(/Sizes not checked and the fitting is in 10 days|to be arranged by Eddie/.test(await pg.locator('#view .row', {has:pg.locator('.who', {hasText:'Urgent Coatbridge'})}).first().innerText()), 'the job carries the warning that its measure is still to be arranged');
    await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Diary'}).click();
    ok(/Measures to arrange/.test(await pg.locator('#view').innerText()) && /Urgent Coatbridge/.test(await pg.locator('#view').innerText()), 'the shop sees it in the diary as a measure still to arrange');
    // the estimator's own dashboard: the shop sees what is with them on Today, and it opens from there
    await pg.selectOption('#diaryFitter', 'Eddie');
    ok(await pg.getByRole('button', {name:/Eddie.s page/}).count() === 1, 'choosing a person in the diary offers that person’s page by name');
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#estStrip');
    const strip = await pg.locator('#estStrip .estrow', {hasText:'Eddie'}).innerText();
    ok(/1 measure to arrange/.test(strip) && /Open dashboard/.test(strip) && await pg.locator('#estStrip .estrow.hot').count() === 1, 'the shop’s Today screen shows what is waiting on the estimator');
    await pg.locator('#estStrip .estrow', {hasText:'Eddie'}).click();
    await pg.waitForSelector('#urgentBox');
    const tiles = await pg.locator('#estTiles .tile').allInnerTexts();
    ok(tiles.length === 4 && /^1\s+To arrange/.test(tiles[0]) && /Findings owed/.test(tiles[1]) && /Today/.test(tiles[2]) && /Next 7 days/.test(tiles[3]) && await pg.locator('#estTiles .tile.hot').count() === 1 && (await pg.locator('#estName').innerText()) === 'Eddie',
      'the estimator has a dashboard of their own: what to arrange, findings owed, today and the week');
    ok(!/£/.test(await pg.locator('#view').innerText()) && await pg.locator('nav.tabs').isHidden(), 'it shows no prices and none of the shop’s other screens');
    const ub = await pg.locator('#urgentBox').innerText();
    ok(/Urgent Coatbridge/.test(ub) && /07700 900556/.test(ub) && /Fitting booked for/.test(ub) && !/£/.test(ub), 'the estimator’s page puts it at the top as urgent, with the customer’s number and the fitting date');
    await pg.locator('#urgentBox').getByRole('button', {name:'Pick the day'}).click(); await pg.waitForSelector('#modal .dstrip');
    await (await cellOf(pg.locator('#modal'), day(3))).click();
    await pg.locator('#modal').getByRole('button', {name:'Book it in'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden && !document.querySelector('#urgentBox'), null, {timeout:6000});
    const arr = Object.values(app.store.getDoc('jobs/u1').data.pre)[0];
    ok(arr.date === day(3) && arr.urgent === false, 'they pick the day from their own diary and it is booked');
    // on the visit they see what is on the order, and decide what happens when a size is different
    await pg.locator('.fent', {hasText:'Urgent Coatbridge'}).first().click(); await pg.waitForSelector('#sheet .panel');
    const es = await pg.locator('#sheet').innerText();
    ok(/What is on the order/.test(es) && /Test carpet/.test(es) && /Does the order cover the floor/.test(es) && !/£/.test(es), 'on a measure the estimator sees what is on the order and whether it covers the floor, with no prices');
    await pg.locator('#sheet').getByRole('button', {name:'Submit findings'}).click(); await pg.waitForSelector('#fr0Len');
    await pg.fill('#fr0Len', '3.05');
    ok(await pg.locator('#fr0Carpet').getAttribute('aria-pressed') === 'true' && await pg.locator('#fr0Guide, #fr0DirAny, #fr0W4').count() === 0 && !/roll|cut|allowance/i.test(await pg.locator('#modal .card', {has:pg.locator('#fr0Len')}).first().innerText()),
      'the room already knows it is carpet from what is on the order, and whoever measures is shown no roll, cut or direction: only the sizes and the questions');
    const qs = await pg.locator('#fr0Spec').innerText();
    ok(/Is new underlay required\?/.test(qs) && /Is new gripper required\?/.test(qs) && /Are door bars required\?/.test(qs) && /Is there old flooring down\?/.test(qs) && /Does the customer want a price to move furniture\?/.test(qs)
      && /Not required/.test(qs) && /5 questions still to answer/.test(await pg.locator('#fr0Count').innerText()) && await pg.locator('#fr0Spec .sq.miss').count() === 5 && (qs.match(/ANSWER NEEDED/gi) || []).length === 5,
      'each question is a full question with Required or Not required, every unanswered one is marked, and the room counts what is left');
    ok(await pg.evaluate(() => Array.from(document.querySelectorAll('#fr0Spec .sq.miss')).every(r => { const a = r.querySelector('span').getBoundingClientRect(), b = r.querySelector('.seg').getBoundingClientRect(); return r.getBoundingClientRect().height < 110 && b.left > a.left + 40; })),
      'an unanswered question still reads as one row: the question on the left and its answers on the right');
    await pg.locator('#fr0Ok').click();
    ok(!(await pg.locator('#fr0Ok').isChecked()) && /Answer these first, then tick the room: underlay, gripper, door bars, old flooring, furniture/.test(await pg.locator('#fr0Need').innerText()) && await pg.locator('#fr0Spec .sq.miss').count() === 5,
      'a room cannot be ticked until every question in it is answered, and it says which ones are left');
    await pg.click('#fr0BarsY');
    ok(/how many door bars/.test(await pg.locator('#fr0Need').innerText()), 'saying door bars are required then asks how many');
    await answer(0, {bars:{cc:1}});
    ok(/All answered/.test(await pg.locator('#fr0Count').innerText()) && await pg.locator('#fr0Spec .sq.miss').count() === 0 && await pg.locator('#fr0Need').isHidden() && await pg.locator('#fr0UnderlayY.on.yes').count() === 1,
      'once they are all answered the marks clear and each answer shows filled in');
    await pg.locator('#fr0Ok').check();
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    ok(/Say what was wrong with the sizes/.test(await pg.locator('#modal').innerText()), 'a changed size needs an explanation of what was wrong');
    await pg.fill('#findWrong', 'Customer measured to the skirting on one side only');
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    ok(/Choose what happens next/.test(await pg.locator('#modal').innerText()) && Object.values(app.store.getDoc('jobs/u1').data.pre)[0].status === 'booked', 'and a decision: sign it off or send it back');
    await pg.locator('#modal .radio', {hasText:'Small adjustment'}).locator('input').check();
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const u1 = app.store.getDoc('jobs/u1').data, u1v = Object.values(u1.pre)[0];
    ok(u1.rooms.r1.status === 'verified' && u1.rooms.r1.len === 3.05 && Object.keys(u1.rooms.r1.hist || {}).length === 1 && u1v.decision === 'sign' && /skirting/.test(u1v.changed.join(' ')) && !(u1.review && u1.review.on),
      'a small adjustment is signed off by the estimator: the size is updated, the old one kept, and the shop is not asked');
    ok(u1.lines.l1.qty === 30 && u1.total === 90, 'signing off does not touch the order or the price');
    await pg.keyboard.press('Escape');
    await pg.locator('.fent', {hasText:'Short Carpet'}).first().click(); await pg.waitForSelector('#sheet .panel');
    await pg.locator('#sheet').getByRole('button', {name:'Submit findings'}).click(); await pg.waitForSelector('#fr0Len');
    await pg.fill('#fr0Len', '3.4'); await pg.fill('#fr0Wid', '3.3'); await answer(0, {}); await pg.locator('#fr0Ok').check(); await pg.fill('#findWrong', 'Bay window was missed, the room is much bigger');
    await pg.locator('#modal .radio', {hasText:'Small adjustment'}).locator('input').check();
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    ok(/cannot be signed off/.test(await pg.locator('#modal').innerText()) && Object.values(app.store.getDoc('jobs/u2').data.pre)[0].status === 'booked', 'when the carpet on the order no longer covers the floor it cannot be signed off');
    await pg.locator('#modal .radio', {hasText:'Send it back to the shop'}).locator('input').check();
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const u2 = app.store.getDoc('jobs/u2').data;
    ok(u2.review && u2.review.on === true && u2.review.sentBy === 'Eddie' && /Bay window was missed/.test(u2.review.why) && u2.lines.l1.qty === 30, 'sending it back raises it for the shop with the reason, and still changes nothing on the order');
    await pg.waitForSelector('#withShop');
    ok(/Short Carpet/.test(await pg.locator('#withShop').innerText()) && /Bay window was missed/.test(await pg.locator('#withShop').innerText()) && !/£/.test(await pg.locator('#view').innerText()), 'the estimator’s dashboard then lists it as with the shop, so they know it is not waiting on them');
    await pg.keyboard.press('Escape'); await pg.getByRole('button', {name:'Back to the shop'}).click(); await pg.locator('#tabs .tab', {hasText:'Today'}).click();
    await pg.waitForFunction(() => /Short Carpet/.test((document.querySelector('#actSec') || {}).innerText || ''), null, {timeout:6000});
    ok(/Sent back by Eddie/.test(await pg.locator('#actSec').innerText()) && /Bay window was missed/.test(await pg.locator('#actSec').innerText()), 'and it lands in Act now on Today');
    // booking a measure says what it is for: the rooms, what the customer picked in the shop, and the extras to price
    await pg.getByRole('button', {name:'Book a measure'}).first().click(); await pg.waitForSelector('#mBrief');
    await pg.locator('#modal input[name=mWho][value=Eddie]').check();
    await pg.fill('#mPost', 'G81 5DD'); await pg.fill('#mName', 'Brief Customer'); await pg.fill('#mPhone', '07700 900777');
    await (await cellOf(pg.locator('#modal'), day(4))).click();
    ok(!/null/.test(await pg.locator('#modal .ddetail').last().innerText()), 'the chosen day reads cleanly, with no stray "null"');
    await pg.locator('#modal').getByRole('button', {name:'Book the measure'}).click();
    ok(/Say which rooms are being measured/.test(await pg.locator('#modal').innerText()), 'a measure cannot be booked without saying which rooms');
    await pg.locator('#mbQuick button', {hasText:'Bedroom'}).click(); await pg.locator('#mbQuick button', {hasText:'Bedroom'}).click();
    await pg.locator('#mbQuick button', {hasText:/^\+ Hall, stairs and landing$/}).click();
    await pg.locator('#mbQuick button', {hasText:'Other'}).click(); await pg.fill('#mbRoom3', 'Garden room');
    ok(await pg.locator('#mbRoom0').inputValue() === 'Bedroom 1' && await pg.locator('#mbRoom1').inputValue() === 'Bedroom 2' && await pg.locator('#mbRoom2').inputValue() === 'Hall, stairs and landing',
      'rooms are added with a tap, a second bedroom numbers itself, and Other takes any name');
    await pg.fill('#mbFind', 'Royale Oak'); await pg.press('#mbFind', 'Enter'); await pg.locator('#mBrief .results .pick').first().click();
    await pg.fill('#mbTyped', 'Grey twist carpet, stand by the door'); await pg.press('#mbTyped', 'Enter');
    await pg.selectOption('#mbWant2', {label:'Grey twist carpet, stand by the door'});
    await pg.locator('#mbAlso label', {hasText:'Underlay'}).locator('input').check(); await pg.locator('#mbAlso label', {hasText:'Door bars'}).locator('input').check();
    await pg.locator('#modal').getByRole('button', {name:'Book the measure'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden && document.querySelector('#briefCard'), null, {timeout:10000});
    const bj = app.store.list('jobs').find(x => (x.data.customer || {}).name === 'Brief Customer'), bb = bj.data.brief, oak = bb.choices.find(c => c.variantId), grey = bb.choices.find(c => c.typed);
    ok(bb.rooms.map(r => r.name).join('|') === 'Bedroom 1|Bedroom 2|Hall, stairs and landing|Garden room' && oak && /Royale Oak/.test(oak.title) && grey && bb.rooms[0].want === oak.k && bb.rooms[2].want === grey.k && bb.also.join('|') === 'Underlay|Door bars' && Object.keys(bj.data.lines).length === 0,
      'the booking keeps the rooms, the product picked for each and the extras, and orders nothing');
    const bc = await pg.locator('#briefCard').innerText();
    ok(/What the measure is for/.test(bc) && /Bedroom 2/.test(bc) && /Royale Oak/.test(bc) && /Grey twist/.test(bc) && /Also to price: Underlay, Door bars/.test(bc), 'the job shows the shop what the measure is for');
    // whoever measures sees it on the visit, with no prices, and the findings start from those rooms
    await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.locator('#estStrip .estrow', {hasText:'Eddie'}).click();
    await pg.locator('.fent', {hasText:'Brief Customer'}).first().click(); await pg.waitForSelector('#sheet #briefCard');
    const estSheet = await pg.locator('#sheet').innerText();
    ok(/What to measure/.test(estSheet) && /Hall, stairs and landing/.test(estSheet) && /Grey twist/.test(estSheet) && /Underlay/.test(estSheet) && !/£/.test(estSheet), 'the estimator sees the rooms and what was chosen on the visit, with no prices');
    await pg.locator('#sheet').getByRole('button', {name:'Submit findings'}).click(); await pg.waitForSelector('#fr0Len');
    ok(await pg.locator('#fr0Name').inputValue() === 'Bedroom 1' && await pg.locator('#fr3Name').inputValue() === 'Garden room' && /For: Royale Oak/.test(await pg.locator('#modal').innerText()), 'the findings start from the rooms that were asked for');
    ok(await pg.locator('#fr0Flooring').getAttribute('aria-pressed') === 'true' && await pg.locator('#fr2Carpet').getAttribute('aria-pressed') === 'false', 'a room knows it is flooring when the product picked for it is sold by the pack');
    await pg.fill('#fr0Len', '3.5'); await pg.fill('#fr0Wid', '3');
    await answer(0, {floor:'flooring', bars:{ff:1, cf:1}, old:true, uplift:true, furn:true}); await pg.locator('#fr0Ok').check();
    await pg.fill('#fr1Len', '3'); await pg.fill('#fr1Wid', '2.8');
    await pg.locator('#modal .card', {has:pg.locator('#fr1Name')}).getByRole('button', {name:'Same answers as the room above'}).click();
    ok(await pg.locator('#fr1BeadingY').getAttribute('aria-pressed') === 'true' && await pg.locator('#fr1BarsY').getAttribute('aria-pressed') === 'false', 'one tap copies the answers from the room above, but not its door bars');
    await pg.click('#fr1BarsN'); await pg.locator('#fr1Ok').check();
    // a hall, stairs and landing is measured in parts: the hall and the landing drawn and sized, the stairs counted
    ok(await pg.locator('#fr2Hsl').count() === 1 && await pg.locator('#fr2Len').count() === 0 && await pg.locator('#fr2HallY').getAttribute('aria-pressed') === 'true'
      && await pg.locator('#fr2StairsY').getAttribute('aria-pressed') === 'true' && await pg.locator('#fr2LandY').getAttribute('aria-pressed') === 'true',
      'a hall, stairs and landing is measured in parts, not as one length and width');
    await pg.click('#fr2Carpet');
    await pg.fill('#fr2HallLen', '3.2'); await pg.fill('#fr2HallWid', '1.1');
    await pg.fill('#fr2StepCount', '13'); await pg.fill('#fr2StepWid', '0.86'); await pg.fill('#fr2StepTread', '25'); await pg.fill('#fr2StepRiser', '20');
    ok(/the stair width in centimetres, for example 86/.test(await pg.locator('#fr2Need').innerText()), 'a stair width typed in metres is caught: the stairs are sized in centimetres like the steps');
    await pg.fill('#fr2StepWid', '86');
    const nd2 = await pg.locator('#fr2Need').innerText();
    ok(/whether the stairs turn/.test(nd2) && /the landing at its longest and widest/.test(nd2) && !/how many stairs/.test(nd2) && !/the hall/.test(nd2), 'it says exactly what is still missing from the stairs and the landing');
    await pg.click('#fr2TurnY'); await pg.fill('#fr2TurnCount', '2'); await pg.fill('#fr2TurnDepth', '40');
    await pg.fill('#fr2LandLen', '2.6'); await pg.fill('#fr2LandWid', '1.9');
    ok(await pg.locator('#fr2LandPad').isVisible() && await pg.locator('#fr2HallDraw').count() === 1, 'the drawing for the landing is there from the start, and the hall has a button for one');
    await pg.locator('#fr2LandPad').scrollIntoViewIfNeeded();
    let bx = await pg.locator('#fr2LandPad').boundingBox();
    await pg.mouse.move(bx.x + 60, bx.y + 60); await pg.mouse.down(); await pg.mouse.move(bx.x + 260, bx.y + 60, {steps:4}); await pg.mouse.move(bx.x + 260, bx.y + 200, {steps:4}); await pg.mouse.move(bx.x + 60, bx.y + 200, {steps:4}); await pg.mouse.move(bx.x + 60, bx.y + 60, {steps:4}); await pg.mouse.up();
    await pg.fill('#fr2LandSize', '2.6'); await pg.click('#fr2LandPut');
    ok(/tap the drawing on the side that is 2\.60 m/.test(await pg.locator('#fr2LandHint').innerText()), 'a size is typed, then placed on the drawing with a tap');
    bx = await pg.locator('#fr2LandPad').boundingBox(); await pg.mouse.click(bx.x + 160, bx.y + 40);
    ok(/Draw the landing with a finger/.test(await pg.locator('#fr2LandHint').innerText()) && await pg.evaluate(() => { const c = document.querySelector('#fr2LandPad'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90) ink++; return ink > 1500; }),
      'the landing is drawn with the size printed on it');
    ok(await pg.evaluate(() => { const L = window.IFDLogic, P = L.carpetPlan, e1 = P(3, 3.8).best, e2 = P(4.2, 3, {widths:[4]}).best, e2b = P(4.2, 3), e3 = P(4.2, 4.6).best, dec = P(3.05, 3.42).best, ex = P(4, 3, {widths:[4]});
      return e1.across === 3.8 && e1.cut === 3.1 && e1.rollW === 4 && e1.sq === 12.4 && e1.units === 31
        && e2.across === 3 && e2.cut === 4.3 && e2.rollW === 4 && e2.sq === 17.2
        && e2b.best.rollW === 5 && e2b.best.sq === 15.5 && e2b.other.rollW === 4 && e2b.other.sq === 17.2
        && e3.across === 4.6 && e3.cut === 4.3 && e3.rollW === 5 && e3.sq === 21.5
        && P(3, 3.8, {dir:'wid'}).best.cut === 3.9 && P(3, 3.8, {dir:'wid'}).best.sq === 15.6
        && dec.across === 3.42 && dec.cut === 3.2 && dec.sq === 12.8
        && ex.best.across === 4 && ex.tight === true && P(3.95, 3).tight === true && P(3.8, 3).tight === false
        && P(4.2, 4.6, {widths:[4]}).fits === false && P(5.2, 5.1).fits === false && P(5.2, 5.1).needs === 5.1 && P(6, 3).best.cut === 6.1; }),
      'the carpet sums: the worked examples, a set direction, decimals rounded up to 10 cm, a carpet that only comes in one width, exact fits flagged and rooms too wide for any roll');
    await answer(2, {w:5, underlay:true, edge:true, old:true, uplift:false}); await pg.locator('#fr2Ok').check();
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    ok(/No size has been given for Garden room/.test(await pg.locator('#modal').innerText()), 'a room that was asked for cannot be quietly skipped');
    await pg.fill('#findNotes', 'Garden room was locked, customer will send the size');
    await pg.locator('#modal').getByRole('button', {name:'Submit findings'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const bj2 = app.store.getDoc('jobs/' + bj.id).data, br = Object.values(bj2.rooms);
    ok(br.length === 3 && br.every(r => r.status === 'verified') && br.find(r => r.name === 'Hall, stairs and landing').want === grey.k && !(bj2.review && bj2.review.on), 'the measured rooms keep which floor each is for, and nothing is flagged');
    const sp0 = br.find(r => r.name === 'Bedroom 1').spec, sp2 = br.find(r => r.name === 'Hall, stairs and landing').spec;
    ok(sp0.floor === 'flooring' && sp0.underlay === true && sp0.beading === true && sp0.bars.ff === 1 && sp0.bars.cf === 1 && sp0.old === true && sp0.uplift === true && sp0.furniture === true
      && sp2.floor === 'carpet' && sp2.rollW === 0 && sp2.dir === 'any' && sp2.gripper === true && sp2.old === true && sp2.uplift === false && sp2.bars.cc === 0, 'each room keeps its answers: carpet or flooring, roll width, underlay, gripper or beading, door bars, old flooring and furniture');
    const hr = br.find(r => r.name === 'Hall, stairs and landing'), hp = Object.values(hr.photos || {});
    ok(hr.hsl.hall.on === true && hr.hsl.hall.len === 3.2 && hr.hsl.hall.wid === 1.1 && hr.hsl.stairs.n === 13 && hr.hsl.stairs.wid === 0.86 && hr.hsl.stairs.tread === 25 && hr.hsl.stairs.riser === 20 && hr.hsl.stairs.winders === 2 && hr.hsl.stairs.wdepth === 40
      && hr.hsl.landing.len === 2.6 && hr.hsl.landing.wid === 1.9 && hr.area === 14.78 && hp.length === 1 && hp[0].kind === 'sketch' && hp[0].part === 'landing' && hp[0].sizes.join() === '2.60 m',
      'the hall, the stairs and the landing are each kept, with the drawing of the landing and the sizes written on it');
    // back in the shop, the sale starts from what was chosen, beside the sizes that were measured
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    await pg.getByRole('button', {name:'Back to the shop'}).click();
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#priceSec');
    const pr = await pg.locator('#priceSec .row.price', {hasText:'Brief Customer'}).innerText();
    ok(/To price/.test(await pg.locator('#priceSec h2').innerText()) && /07700 900777/.test(pr) && /Measured by Eddie/.test(pr) && /3 rooms: Bedroom 1, Bedroom 2, Hall, stairs and landing/.test(pr) && /Chosen in the shop: Royale Oak/.test(pr)
      && /Measured today/.test(pr) && /Stairs to work out/.test(pr) && /Has drawings/.test(pr) && /Price it/.test(pr) && !/£/.test(pr),
      'a measured job lands on the shop’s dashboard under To price, with the customer, who measured, the rooms and what was chosen');
    await pg.locator('#priceSec .row.price', {hasText:'Brief Customer'}).click(); await pg.waitForSelector('#quoteForm');
    ok(/Measured and ready to price/.test(await pg.locator('#toPriceBanner').innerText()) && /ring Brief Customer on 07700 900777/.test(await pg.locator('#toPriceBanner').innerText()) && await pg.locator('#toPriceBanner').getByRole('button', {name:'Price it'}).count() === 1,
      'opening it says what to do next: price it, then ring the customer');
    const qf = await pg.locator('#quoteForm').innerText(), qlab = await pg.evaluate(() => Array.from(document.querySelectorAll('#quoteLines .qline input[type=text]')).map(i => i.value));
    ok(/What was measured/.test(qf) && /Bedroom 1\s+3\.50 × 3\.00 m/.test(qf) && /Flooring: Royale Oak/.test(qf) && /Hall, stairs and landing\s+14\.78 m² in all/.test(qf) && /13 stairs, 86 cm wide/.test(qf)
      && qlab.join('|') === 'Carpet|Flooring|Underlay|Gripper|Beading|Door bars|Fitting|Uplift and disposal|Moving furniture' && /18\.90 m² of floor, nothing added for wastage/.test(qf) && /3 rooms, 33\.68 m² of floor, 15 stairs/.test(qf),
      'pricing opens straight from the dashboard: each room with its size and what it needs, then one price box for each thing to price');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden);
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    ok(await pg.evaluate(() => { const L = window.IFDLogic, old = {hsl:{hall:{on:false}, stairs:{on:true, n:12, wid:80, tread:21, riser:21, winders:0, wdepth:0}, landing:{on:true, len:2.6, wid:2.2}}, area:432.92};
      return L.roomArea(old) === 9.99 && /12 stairs, 80 cm wide/.test(L.hslText(old)); }), 'a stair width that was saved in centimetres is read as centimetres, so the area is right');
    await openJobPlain('Brief Customer'); await pg.waitForSelector('#pricingCard');
    ok(await pg.evaluate(() => !document.querySelector('#pricingMore').open) && /Bedroom 1/.test(await pg.locator('#measuredBlock').innerText()), 'the job shows the rooms simply, with the carpet working-out folded away');
    await pg.locator('#pricingMore summary').click();
    const cc = await pg.locator('#checksCard').innerText();
    ok(/Hall 3\.20 × 1\.10 m at its longest and widest\. 13 stairs, 86 cm wide[\s\S]*?Landing 2\.60 × 1\.90 m at its longest and widest/.test(cc) && await pg.locator('#checksCard .thumbs img, #checksCard .thumb').count() >= 1,
      'the job shows the hall, the stairs and the landing in words, with the drawing beside them');
    const pc = await pg.locator('#pricingCard').innerText();
    ok(/Flooring: Bedroom 1, Bedroom 2\s+18\.90 m²/.test(pc) && /Carpet: Hall, stairs and landing, hall[\s\S]*?1\.20 m off the 4 m roll, 4\.80 m²/.test(pc) && /Carpet: Hall, stairs and landing, landing[\s\S]*?2\.00 m off the 4 m roll, 8\.00 m²/.test(pc)
      && /Stairs: Hall, stairs and landing[\s\S]*?13 stairs, 86 cm wide, each 25 cm deep and 20 cm high, plus 2 turning steps, 40 cm at the deepest[\s\S]*?Run 7\.35 m, 0\.86 m wide/.test(pc)
      && /Flooring underlay\s+18\.90 m²/.test(pc) && /Carpet underlay\s+14\.78 m²/.test(pc) && /Work out by hand\s+gripper for Hall, stairs and landing/.test(pc) && /Beading, round the walls\s+about 24\.60 m/.test(pc) && /Door bars, carpet to flooring\s+1/.test(pc) && /Door bars, flooring to flooring\s+1/.test(pc)
      && /Uplift and dispose: Bedroom 1, Bedroom 2\s+18\.90 m²/.test(pc) && /Furniture to move\s+Bedroom 1, Bedroom 2/.test(pc) && /customer is lifting it\s+Hall, stairs and landing/.test(pc) && !/£/.test(pc),
      'the shop gets one summary to price from: floor areas, carpet cuts, underlay, gripper, beading, door bars, uplift and furniture');
    await pg.locator('#sheet').getByRole('button', {name:'Add items'}).click(); await pg.waitForSelector('#saleFromMeasure');
    const fm = await pg.locator('#saleFromMeasure').innerText();
    ok(/Royale Oak/.test(fm) && /Bedroom 1 3\.50 × 3\.00 m/.test(fm) && /Hall, stairs and landing 14\.78 m²/.test(fm) && /4 m roll: 3\.20 m cut, 12\.80 m² of carpet/.test(fm) && /The stairs in Hall, stairs and landing are not in these figures/.test(fm) && /Also to price: Underlay, Door bars/.test(fm), 'making the sale shows what was chosen beside the measured sizes');
    await pg.locator('#saleFromMeasure').getByRole('button', {name:'Add to the sale'}).click();
    await pg.waitForFunction(() => /On the sale/.test(document.querySelector('#saleFromMeasure').innerText), null, {timeout:6000});
    ok(await pg.locator('#modal input[id^="ln-q-"]').count() === 1, 'one tap puts the chosen product on the sale, ready for the quantity');
    ok(/Not on it yet: underlay, gripper, beading, door bars, uplift and disposal, moving furniture/.test(await pg.locator('#pricingMiss').innerText()), 'the sale says what the measure needs that is not on it yet');
    await pg.getByRole('button', {name:'Add another charge'}).click(); await pg.locator('#modal input[placeholder="Fitting, delivery, door bars"]').fill('Underlay and gripper'); await pg.locator('#modal input[placeholder="Fitting, delivery, door bars"]').blur();
    await pg.waitForFunction(() => /Not on it yet: beading, door bars/.test((document.querySelector('#pricingMiss') || {}).innerText || ''), null, {timeout:6000});
    ok(true, 'and stops asking for each one as it is added');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden);
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    // a carpet that comes in both widths: the sale takes the right roll for each room, with the quantity and the price from the same sums
    const cs = (floor, extra) => Object.assign({floor:floor, rollW:0, dir:'any', underlay:false, gripper:false, beading:null, bars:{cc:0, cf:0, ff:0}, old:false, uplift:null, furniture:false}, extra || {});
    const vr = {status:'verified', verBy:'Eddie', verRole:'estimator', verOn:day(0), source:'estimator', want:'c1'};
    app.store.setDoc(docPath('jobs/c1'), {v:1, ref:'M-CARPET', source:'measure', status:'open', type:'Fitting', date:'', slot:'', fitter:'', diary:false, shopifyClosed:false, createdAt:new Date().toISOString(),
      customer:{name:'Carpet Rolls', phone:'07700 900999', address:'9 Test Street', postcode:'G81 6EE'}, lines:{}, total:0, pay:{}, notes:'', quote:[], drafts:{}, sizeCheck:'estimator', pre:{}, log:{},
      brief:{rooms:[{name:'Lounge', want:'c1'}, {name:'Big bedroom', want:'c1'}], choices:[{k:'c1', title:'Silver twist carpet · Roll R-801 · 4m wide', variantId:'gid://shopify/ProductVariant/801', unit:'m', w:4, widths:[4, 5]}], also:[]},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet')}, vr), r2:Object.assign({n:2, name:'Big bedroom', len:4.2, wid:4.6, area:19.32, spec:cs('carpet')}, vr)}});
    await pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/c1', data:{notes:'in'}})}));
    await openJobPlain('Carpet Rolls'); await pg.waitForSelector('#pricingCard');
    const pc2 = await pg.locator('#pricingCard').innerText();
    ok(/Carpet: Lounge[\s\S]*?Floor 3\.00 × 3\.80 m, 11\.40 m²\. The 3\.80 m side goes across the roll[\s\S]*?3\.10 m off the 4 m roll, 12\.40 m²/.test(pc2) && /Carpet: Big bedroom[\s\S]*?4\.30 m off the 5 m roll, 21\.50 m²/.test(pc2),
      'the shop sees the floor area and the carpet ordered side by side, on the right roll for each room');
    await pg.locator('#sheet').getByRole('button', {name:'Add items'}).click(); await pg.waitForSelector('#saleRoll4');
    ok(/4 m roll: 3\.10 m cut, 12\.40 m² of carpet/.test(await pg.locator('#saleRoll4').innerText()) && /31 lengths of 10 cm/.test(await pg.locator('#saleRoll4').innerText()) && /5 m roll: 4\.30 m cut, 21\.50 m² of carpet/.test(await pg.locator('#saleRoll5').innerText()),
      'the sale lists what to take off each width of roll');
    await pg.locator('#saleRoll4').getByRole('button', {name:'Add to the sale'}).click(); await pg.waitForFunction(() => document.querySelectorAll('#modal input[id^="ln-q-"]').length === 1);
    await pg.locator('#saleRoll5').getByRole('button', {name:'Add to the sale'}).click(); await pg.waitForFunction(() => document.querySelectorAll('#modal input[id^="ln-q-"]').length === 2);
    const sold = await pg.evaluate(() => ({q:Array.from(document.querySelectorAll('#modal input[id^="ln-q-"]')).map(i => i.value), p:Array.from(document.querySelectorAll('#modal input[id^="ln-p-"]')).map(i => i.value), text:document.querySelector('#modal').innerText}));
    ok(sold.q.join('|') === '3.1|4.3' && sold.p.join('|') === '124|215' && /R-801 · 4m wide/.test(sold.text) && /R-802 · 5m wide/.test(sold.text) && /£339\.00/.test(sold.text),
      'adding them picks the 4 m roll and the 5 m roll of that carpet, with the cut as the quantity and the price from the carpet ordered, and the total agrees');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden);
    await pg.selectOption('#pdir-r1', 'wid');
    await pg.waitForFunction(() => /3\.90 m off the 4 m roll, 15\.60 m²/.test(document.querySelector('#pricingCard').innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/c1').data.rooms.r1.spec.dir === 'wid' && /kept that way round/.test(await pg.locator('#pricingCard').innerText()) && app.store.getDoc('jobs/c1').data.rooms.r1.spec.floor === 'carpet',
      'the shop can say a carpet has to run a set way, and the carpet ordered follows without being turned');
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    // ---- pricing a measured job, the quote waiting on the customer, the customer saying yes, the carpet allocated ----
    const nowQ = new Date().toISOString(), preQ = {v1:{n:1, kind:'measure', who:'Eddie', date:day(0), slot:'', status:'done', at:nowQ, by:'', doneAt:nowQ, doneBy:'Eddie', role:'estimator'}};
    const qJob = (id, ref, name, extra) => app.store.setDoc(docPath('jobs/' + id), Object.assign({v:1, ref:ref, source:'measure', status:'open', type:'Fitting', date:'', slot:'', fitter:'', diary:false, shopifyClosed:false, createdAt:nowQ,
      customer:{name:name, phone:'07700 900321', email:'quote@example.com', address:'3 Test Street', postcode:'G81 6EE'}, lines:{}, total:0, pay:{}, notes:'', quote:[], drafts:{}, sizeCheck:'estimator', pre:preQ, log:{},
      brief:{rooms:[{name:'Lounge', want:'c1'}], choices:[{k:'c1', title:'Silver twist carpet · Roll R-801 · 4m wide', variantId:'gid://shopify/ProductVariant/801', unit:'m', w:4, widths:[4, 5]}], also:[]},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet', {underlay:true, gripper:true, bars:{cc:1, cf:0, ff:0}, old:true, uplift:true})}, vr)}}, extra || {}));
    qJob('q1', 'M-QUOTE', 'Quentin Quote', {brief:{rooms:[{name:'Lounge', want:'c1'}, {name:'Hall, stairs and landing', want:'c1'}], choices:[{k:'c1', title:'Silver twist carpet · Roll R-801 · 4m wide', variantId:'gid://shopify/ProductVariant/801', unit:'m', w:4, widths:[4, 5]}], also:[]},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet', {underlay:true, gripper:true, bars:{cc:1, cf:0, ff:0}, old:true, uplift:true})}, vr),
        r2:Object.assign({n:2, name:'Hall, stairs and landing', len:0, wid:0, area:0, spec:cs('carpet'), hsl:{hall:{on:false, len:0, wid:0}, stairs:{on:true, n:12, wid:0.8, tread:21, riser:21, winders:0, wdepth:0}, landing:{on:true, len:2.6, wid:2.2}}}, vr)}});
    const sentQ = {qa:{n:1, at:nowQ, by:'', byName:'Sam', lines:[{label:'Carpet', price:200}, {label:'Fitting', price:120}], total:320, sent:{email:{at:nowQ, to:'quote@example.com', byName:'Sam'}}}};
    qJob('q2', 'M-ORDER', 'Olive Orderin', {quotes:sentQ});
    qJob('q3', 'M-NOPE', 'Norman Notaken', {quotes:sentQ});
    await pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/q1', data:{notes:'in'}})}));
    ok(await pg.evaluate(() => { const L = window.IFDLogic, t = L.todayISO(), at = n => new Date(Date.now() - n * 86400000).toISOString(), job = (sent, chase) => ({status:'open', lines:{}, quotes:{a:{at:at(9), lines:[{label:'Carpet', price:5}], sent:sent}}, chase:chase || {}});
      const w0 = L.quoteWait(job({}), t), w1 = L.quoteWait(job({email:{at:at(0)}}), t), w4 = L.quoteWait(job({email:{at:at(4)}}), t), w5 = L.quoteWait(job({email:{at:at(5)}}), t);
      const again = L.quoteWait(job({email:{at:at(6)}}, {c1:{at:at(0), outcome:'deciding'}}), t), noans = L.quoteWait(job({email:{at:at(6)}}, {c1:{at:at(0), outcome:'noanswer'}}), t), next = L.quoteWait(job({email:{at:at(6)}}, {c1:{at:at(1), outcome:'noanswer'}}), t);
      const resent = L.quoteWait(job({email:{at:at(8)}, text:{at:at(1)}}, {c1:{at:at(7), outcome:'deciding'}}), t);
      return w0.state === 'unsent' && w1.state === 'waiting' && w1.ringOn === L.addDays(t, 5) && w4.state === 'waiting' && w5.state === 'ring' && w5.days === 5
        && again.state === 'waiting' && again.ringOn === L.addDays(t, 5) && again.calls === 1 && noans.state === 'waiting' && noans.ringOn === L.addDays(t, 1) && next.state === 'ring'
        && resent.state === 'waiting' && resent.ringOn === L.addDays(t, 4) && resent.calls === 0; }),
      'the five-day rule: a sent quote waits five days, then it is time to ring; a call restarts the wait, no answer comes back the next day, and sending it again starts afresh');
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#priceSec');
    await pg.locator('#priceSec .row.price', {hasText:'Quentin Quote'}).click(); await pg.waitForSelector('#quoteForm');
    const qn = await pg.evaluate(() => Array.from(document.querySelectorAll('#quoteLines .qline')).map(q => [q.querySelector('input').value, (q.querySelector('.qnote') || {}).textContent || '']));
    ok(qn.map(x => x[0]).join('|') === 'Carpet|Underlay|Gripper|Door bars|Fitting|Uplift and disposal' && /21\.60 m² to order: 5\.40 m off the 4 m roll, plus the stairs, a 5\.34 m run 80 cm wide/.test(qn[0][1]) && /1 carpet to carpet/.test(qn[3][1]) && /Lounge, 11\.40 m²/.test(qn[5][1])
      && (await pg.locator('#quoteTotal').innerText()) === '£0.00', 'staff get one empty price box for each thing to price, with a note of what it covers');
    for (const [i, v] of [[0, '300'], [1, '80'], [2, '20'], [3, '9.99'], [4, '150'], [5, '40']]) await pg.fill('#qp' + i, v);
    ok((await pg.locator('#quoteTotal').innerText()) === '£599.99', 'the total adds up as the prices are typed');
    await pg.fill('#ql0', 'Carpet 5.4m x 4m'); await pg.fill('#quoteBy', 'Sam'); await pg.locator('#modal').getByRole('button', {name:'Save the quote'}).click();
    ok(/Take the sizes out of the wording/.test(await pg.locator('#modal').innerText()) && !Object.keys(app.store.getDoc('jobs/q1').data.quotes || {}).length, 'a size typed into the wording is refused: the customer is only given the figures');
    await pg.fill('#ql0', 'Carpet'); await pg.locator('#modal').getByRole('button', {name:'Save the quote'}).click(); await pg.waitForSelector('#quoteSend');
    const qmsg = await pg.inputValue('#quoteMsg'), qhref = await pg.getAttribute('#quoteEmailBtn', 'href');
    ok(/^Hi Quentin,/.test(qmsg) && /Carpet: £300\.00\nUnderlay: £80\.00\nGripper: £20\.00\nDoor bars: £9\.99\nFitting: £150\.00\nUplift and disposal: £40\.00\n\nTotal: £599\.99/.test(qmsg) && /Thanks again,\nSam\nInnovation Flooring Direct$/.test(qmsg)
      && !(await pg.evaluate(m => window.IFDLogic.hasSize(m), qmsg)) && /^mailto:quote%40example\.com\?subject=/.test(qhref), 'the customer’s copy has the figures and the total, a thank you and the name of who sent it, and no sizes');
    await pg.evaluate(() => { const a = document.querySelector('#quoteEmailBtn'); a.addEventListener('click', e => e.preventDefault()); a.click(); });
    await pg.waitForFunction(() => true); await pg.waitForTimeout(400);
    const q1q = Object.entries(app.store.getDoc('jobs/q1').data.quotes)[0];
    ok(q1q[1].total === 599.99 && q1q[1].byName === 'Sam' && q1q[1].sent.email.to === 'quote@example.com', 'the quote is saved on the job with who sent it and how');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden);
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    // it waits on the dashboard, and after five days it is time to ring
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#quotedSec');
    const ringDay = await pg.evaluate(() => window.IFDLogic.fmtDay(window.IFDLogic.addDays(window.IFDLogic.todayISO(), 5)));
    const qrow = await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).innerText();
    ok(/Quotes sent/.test(await pg.locator('#quotedSec h2').innerText()) && /Emailed/.test(qrow) && qrow.includes('Ring them on ' + ringDay + ' if they have not been back') && /£599\.99/.test(qrow) && !(await pg.locator('#priceSec .row', {hasText:'Quentin Quote'}).count())
      && await pg.locator('#quotedSec.actnow').count() === 0, 'a sent quote leaves To price and waits under Quotes sent, with the day to ring them');
    const six = new Date(Date.now() - 6 * 86400000).toISOString();
    await pg.evaluate(a => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/q1', data:{quotes:{[a.k]:{sent:{email:{at:a.at}}}}}})}), {k:q1q[0], at:six});
    await pg.waitForFunction(() => /No reply in 6 days: ring them/.test(document.querySelector('#quotedSec').innerText), null, {timeout:8000});
    ok(await pg.locator('#quotedSec.actnow').count() === 1 && /Ring them/.test(await pg.locator('#quotedSec .row.act', {hasText:'Quentin Quote'}).innerText()), 'after five days with no reply it turns red and says to ring them');
    await pg.locator('#quotedSec .row.act', {hasText:'Quentin Quote'}).click(); await pg.waitForSelector('#chaseForm');
    ok(/07700 900321/.test(await pg.locator('#chaseForm').innerText()) && /£599\.99/.test(await pg.locator('#chaseForm').innerText()), 'opening it brings up the call, with the number and the quote');
    await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click();
    ok(/Say what happened on the call/.test(await pg.locator('#modal').innerText()), 'the call has to say what happened');
    await pg.locator('#chaseOut .radio', {hasText:'Still deciding'}).locator('input').check(); await pg.fill('#chaseNote', 'Waiting on her husband');
    await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const ch1 = Object.values(app.store.getDoc('jobs/q1').data.chase)[0];
    ok(ch1.outcome === 'deciding' && ch1.byName === 'Sam' && ch1.note === 'Waiting on her husband' && /Sam rang\. Still deciding: Waiting on her husband/.test(await pg.locator('#quoteCalls').innerText())
      && (await pg.locator('#quoteNext').innerText()).includes('Ring them on ' + ringDay), 'the call is logged on the job and the five days start again');
    // the customer says yes: fitting, delivery or collection, and the carpet from our own rolls goes to be cut
    await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).click(); await pg.waitForSelector('#acceptForm');
    await pg.waitForFunction(() => /In stock: 30\.0 m free on Silver twist carpet · Roll R-801 · 4m wide/.test(document.querySelector('#accSt0').innerText), null, {timeout:8000});
    const af = await pg.locator('#acceptForm').innerText();
    ok(await pg.inputValue('#accLen0') === '5.4' && /For Lounge, Hall, stairs and landing, landing/.test(af) && /The stairs are not in that length: a 5\.34 m run, 80 cm wide/.test(af) && await pg.locator('#accStock0.on').count() === 1 && /goes straight to the warehouse’s cutting list/.test(af)
      && /Carpet\s+£300\.00/.test(af) && (await pg.locator('#accTotal').innerText()) === '£599.99', 'saying yes shows the carpet to cut, that it is in stock, and the quote the customer agreed');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Choose fitting, delivery or collection/.test(await pg.locator('#modal').innerText()) && !app.store.getDoc('jobs/q1').data.accepted, 'it has to be entered as a fitting, a delivery or a collection');
    await pg.fill('#accLen0', '40');
    ok(/Only 30\.0 m free on our rolls/.test(await pg.locator('#accSt0').innerText()) && await pg.locator('#accStock0').isDisabled(), 'a cut longer than the roll cannot come from stock');
    await pg.fill('#accLen0', '10.8'); await pg.click('#accStock0'); await pg.click('#accFitting');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:8000});
    const a1 = app.store.getDoc('jobs/q1').data, a1l = Object.values(a1.lines).sort((x, y) => x.n - y.n), d1 = shopify.state.lastDraft;
    ok(a1.type === 'Fitting' && a1.total === 599.99 && a1.accepted.byName === 'Sam' && a1.accepted.total === 599.99 && a1l.length === 7 && a1l[0].unit === 'm' && a1l[0].qty === 108 && a1l[0].w === 4 && a1l[0].hold === 'draft' && /^#D/.test(a1l[0].holdRef) && a1l[0].state === 'todo'
      && a1l[0].variantId === 'gid://shopify/ProductVariant/801' && a1l[0].price === 0 && /Lounge/.test(a1l[0].rooms) && /the stairs/.test(a1l[0].rooms) && a1l.slice(1).map(l => l.title + ' ' + l.price).join('|') === 'Carpet 300|Underlay 80|Gripper 20|Door bars 9.99|Fitting 150|Uplift and disposal 40'
      && a1l.slice(1).every(l => l.hold === 'none') && Object.keys(a1.drafts).length === 1, 'the job becomes a fitting at the quoted total, with the cut off our roll and every line of the quote on it');
    ok(d1.lineItems.length === 7 && d1.lineItems[0].variantId === 'gid://shopify/ProductVariant/801' && d1.lineItems[0].quantity === 108 && !d1.lineItems.some(i => /Carpet cut/.test(i.title || '')) && d1.lineItems[1].title === 'Carpet' && d1.lineItems[1].originalUnitPriceWithCurrency.amount === '300.00'
      && !!d1.reserveInventoryUntil && d1.customAttributes.some(x => x.key === 'Job type' && x.value === 'Fitting'), 'Shopify reserves the cut on that roll and holds the sale at the quoted figures');
    await pg.waitForSelector('#cutBanner');
    ok(/On the cutting list\. 10\.8 m of Silver twist carpet · Roll R-801 · 4m wide/.test(await pg.locator('#cutBanner').innerText()) && /To cut/.test(await pg.locator('#sheet .panel-head').innerText()) && /The customer said yes/.test(await pg.locator('#quoteAccepted').innerText())
      && await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).count() === 0, 'the job says it is on the cutting list, and the quote shows as accepted');
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#cutSec');
    ok(/10\.8 m\s+off the 4 m roll/.test(await pg.locator('#cutSec .row', {hasText:'Quentin Quote'}).innerText()) && !(await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).count()) && /1/.test(await pg.locator('#tabs .tab', {hasText:'Cutting'}).innerText()),
      'the dashboard shows it under To cut, and it has left Quotes sent');
    await pg.locator('#cutSec').getByRole('button', {name:'Open the cutting list'}).click(); await pg.waitForSelector('#cutList');
    const crow = pg.locator('#cutList .row', {hasText:'Quentin Quote'});
    ok(/10\.8 m/.test(await crow.innerText()) && /Silver twist carpet · Roll R-801 · 4m wide/.test(await crow.innerText()) && /Fitting/.test(await crow.innerText()) && /Rooms: Lounge/.test(await crow.innerText()) && !/£/.test(await pg.locator('#cutList').innerText()),
      'the warehouse’s cutting list shows the length, the roll, who it is for and the rooms, and no prices');
    await crow.getByRole('button', {name:'Cut done'}).click(); await pg.waitForSelector('#cutForm');
    await pg.locator('#modal').getByRole('button', {name:'Save: it is cut'}).click();
    ok(/Say where the cut piece is now/.test(await pg.locator('#modal').innerText()), 'a cut cannot be marked done without saying where the piece is');
    await pg.selectOption('#cutBay', 'W4-01'); await pg.locator('#modal').getByRole('button', {name:'Save: it is cut'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const cl = Object.values(app.store.getDoc('jobs/q1').data.lines).find(l => l.unit === 'm');
    await pg.waitForFunction(() => !/Quentin Quote/.test(document.querySelector('#cutList').innerText), null, {timeout:6000});
    ok(cl.state === 'allocated' && cl.bay === 'W4-01' && cl.picked === true && cl.cutBy === 'Sam', 'marking it cut records who cut it and where it is, and it leaves the list');
    // ordering in: the job is held until the order details and the arrival date are in
    await openJobPlain('Olive Orderin'); await pg.waitForSelector('#quoteCard');
    await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).click(); await pg.waitForSelector('#acceptForm');
    await pg.waitForFunction(() => /In stock/.test(document.querySelector('#accSt0').innerText), null, {timeout:8000});
    await pg.click('#accOrder0');
    ok(/It goes under To order\. The job is held there until the order details and the arrival date are in/.test(await pg.locator('#accHint0').innerText()), 'choosing to order it in says the job will be held for the order details');
    await pg.click('#accDelivery'); await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:8000});
    const o1 = app.store.getDoc('jobs/q2').data, o1l = Object.values(o1.lines).find(l => l.unit === 'm');
    ok(o1.type === 'Delivery' && o1.total === 320 && o1l.hold === 'supplier' && o1l.state === 'todo' && o1l.qty === 31 && o1l.variantId === '' && o1l.title === 'Silver twist carpet · 4m wide' && !shopify.state.lastDraft.reserveInventoryUntil && shopify.state.lastDraft.lineItems.length === 2,
      'carpet that is ordered in takes nothing off our rolls, and the sale is still held in Shopify at the quoted figures');
    await pg.waitForSelector('#orderBanner');
    ok(/held here until the order details and the arrival date are in/.test(await pg.locator('#orderBanner').innerText()) && /Order details needed/.test(await pg.locator('#sheet .panel-head').innerText()), 'the job says it is held for its order details');
    await pg.evaluate(d => { const i = document.querySelector('#jobDate'); i.value = d; i.dispatchEvent(new Event('change', {bubbles:true})); }, day(3));
    await pg.waitForFunction(() => /still has to be ordered/.test(document.body.innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/q2').data.date === '', 'it cannot be given a date until the order details are in');
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#orderSec');
    const orow = pg.locator('#orderSec .row', {hasText:'Olive Orderin'});
    ok(/To order: 3\.1 m of Silver twist carpet · 4m wide/.test(await orow.innerText()) && /Delivery/.test(await orow.innerText()), 'the dashboard lists it under To order with what to order');
    await orow.getByRole('button', {name:'Enter order details'}).click(); await pg.waitForSelector('#ordForm');
    await pg.locator('#modal').getByRole('button', {name:'Save the order details'}).click();
    ok(/Enter who it is ordered from/.test(await pg.locator('#modal').innerText()) && /Enter the day it is due to arrive/.test(await pg.locator('#modal').innerText()), 'the order details need the supplier and the arrival date');
    await pg.fill('#ordSupplier', 'Carpet Co'); await pg.fill('#ordRef', 'PO-77'); await pg.click('#ordIn10');
    const etaDay = await pg.evaluate(() => window.IFDLogic.addDays(window.IFDLogic.todayISO(), 10)), etaTxt = await pg.evaluate(d => window.IFDLogic.fmtDay(d), etaDay);
    await pg.locator('#modal').getByRole('button', {name:'Save the order details'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const o2l = Object.values(app.store.getDoc('jobs/q2').data.lines).find(l => l.unit === 'm');
    await pg.waitForSelector('#onOrderSec');
    ok(o2l.state === 'ordered' && o2l.supplier === 'Carpet Co' && o2l.orderRef === 'PO-77' && o2l.due === etaDay && o2l.orderedBy === 'Sam' && !(await pg.locator('#orderSec').count())
      && (await pg.locator('#onOrderSec .row', {hasText:'Olive Orderin'}).innerText()).includes('Due in ' + etaTxt) && /from Carpet Co, order PO-77/.test(await pg.locator('#onOrderSec .row', {hasText:'Olive Orderin'}).innerText()),
      'once the order details are in it moves to On order, showing when it is due');
    await openJobPlain('Olive Orderin'); await pg.waitForSelector('#quoteCard');
    ok(/On order/.test(await pg.locator('#sheet .panel-head').innerText()) && !(await pg.locator('#orderBanner').count()), 'the job is no longer held');
    await pg.evaluate(d => { const i = document.querySelector('#jobDate'); i.value = d; i.dispatchEvent(new Event('change', {bubbles:true})); }, day(3));
    await pg.waitForFunction(() => /is not due in until/.test(document.body.innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/q2').data.date === '', 'it cannot be dated for before the carpet is due in');
    await pg.evaluate(d => { const i = document.querySelector('#jobDate'); i.value = d; i.dispatchEvent(new Event('change', {bubbles:true})); }, etaDay);
    await pg.waitForFunction(d => document.querySelector('#jobDate') && document.querySelector('#jobDate').value === d, etaDay, {timeout:6000});
    await pg.waitForTimeout(300);
    ok(app.store.getDoc('jobs/q2').data.date === etaDay, 'and can be dated from the day it arrives');
    await pg.locator('#sheet').getByRole('button', {name:'It has arrived: book it in'}).click(); await pg.selectOption('#allocBay', 'W4-01'); await pg.locator('#modal').getByRole('button', {name:'Save'}).click();
    await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const o3l = Object.values(app.store.getDoc('jobs/q2').data.lines).find(l => l.unit === 'm');
    ok(o3l.state === 'allocated' && o3l.bay === 'W4-01', 'when it arrives it is booked into a bay');
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
    // a customer who is not going ahead
    await openJobPlain('Norman Notaken'); await pg.waitForSelector('#quoteCard');
    await pg.locator('#quoteCard').getByRole('button', {name:'Rang them'}).click(); await pg.waitForSelector('#chaseForm');
    await pg.locator('#chaseOut .radio', {hasText:'Not going ahead'}).locator('input').check(); await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click();
    ok(/Say why they are not going ahead/.test(await pg.locator('#modal').innerText()), 'a quote cannot be closed as not going ahead without a reason');
    await pg.fill('#chaseNote', 'Went with a cheaper quote'); await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const n1 = app.store.getDoc('jobs/q3').data;
    ok(n1.status === 'cancelled' && n1.lost.why === 'Went with a cheaper quote' && n1.lost.byName === 'Sam', 'it is closed with the reason kept');
    await pg.waitForFunction(() => /Quote not taken/.test(document.querySelector('#sheet .panel-head').innerText), null, {timeout:6000});
    await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden);
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
    // a first read that lands while the server is still starting is tried again by itself
    await pg.locator('#tabs .tab', {hasText:'Today'}).click();
    let failedOnce = false;
    await pg.route('**/api/db/list?coll=jobs*', r => { if (!failedOnce){ failedOnce = true; r.fulfill({status:502, contentType:'text/html', body:'Bad Gateway'}); } else r.continue(); });
    await pg.reload();
    await pg.waitForFunction(() => /saved jobs cannot be reached/.test(document.body.innerText), null, {timeout:8000});
    await pg.waitForFunction(() => !/saved jobs cannot be reached/.test(document.body.innerText) && /Quentin Quote/.test(document.querySelector('#view').innerText), null, {timeout:12000});
    await pg.unroute('**/api/db/list?coll=jobs*');
    ok(failedOnce, 'a first read that fails while the server is restarting is tried again by itself, with no reload needed');
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
