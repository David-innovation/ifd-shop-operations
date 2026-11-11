'use strict';
/* Runs the shop's real screens in a browser against this server, with the stand-in Shopify.
   Not part of `npm test` because it needs a browser: run with `node testkit/browser-check.js`. */
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const { create } = require('../server'), fake = require('./fake-shopify'), fakeMail = require('./fake-mail'), fakeTwilio = require('./fake-twilio'), { docPath } = require('../lib/store');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8Dwn4GBgYmBgYGBgQEAEhACAXdBLswAAAAASUVORK5CYII=', 'base64');
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifd-b-')), shopify = fake.make(), texts = [], mailbox = fakeMail.make(), twilio = fakeTwilio.make(), mailPort = await mailbox.listen(); let clockSkip = 0;
  const app = create({env:Object.assign({SMTP_HOST:'127.0.0.1', SMTP_PORT:String(mailPort), SMTP_SECURE:'off', EMAIL_FROM:'Innovation Flooring Direct <shop@example.test>'}, twilio.env, {DATA_DIR:dir, INSECURE_COOKIES:'1', SESSION_PEPPER:'t', OWNER_NAME:'David', OWNER_MOBILE:'07700 900001', SHOP_MOBILE:'07700 900002', SHOPIFY_STORE:'innovationflooring', SHOPIFY_CLIENT_ID:'test-id', SHOPIFY_CLIENT_SECRET:'test-secret'}),
    fetch:(url, init) => twilio.handles(url) ? twilio.fetchImpl(url, init) : shopify.fetchImpl(url, init), sendText:async (to, body) => { texts.push({to, body}); }, log:() => {}, pollMs:3600000, now:() => Date.now() + clockSkip});   // clockSkip lets a check move the server's clock on a minute
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port, base0 = base, errors = [];
  const browser = await chromium.launch({executablePath:process.env.CHROME || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
  const codeFor = to => /code: (\d{6})/.exec(texts.filter(t => t.to === to).pop().body)[1];
  async function signedIn(mobile, e164, at){
    const base = at || base0, ctx = await browser.newContext({viewport:{width:1280, height:900}}), pg = await ctx.newPage();
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
    app.store.setDoc(docPath('settings/main'), {fitters:['Sonnie', 'Lennox'], bays:['W4-01'], msgs:{testOnly:true, allow:['quote@example.com', '07700 900321']}});   // messages may only go to these made-up details
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
    const sentQ = {qa:{n:1, at:nowQ, by:'', byName:'Sam', lines:[{label:'Carpet', price:200}, {label:'Fitting', price:120}], total:320}};
    const sentM = {mold:{kind:'quote', channel:'email', to:'quote@example.com', subject:'Your quote', body:'Hi', rev:'qa', byName:'Sam', state:'sent', at:nowQ, sentAt:nowQ, ref:'<made-up@example.test>'}};
    qJob('q2', 'M-ORDER', 'Olive Orderin', {quotes:sentQ, msgs:sentM});
    qJob('q3', 'M-NOPE', 'Norman Notaken', {quotes:sentQ, msgs:sentM});
    const poke = id => pg.evaluate(p => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:p, data:{poked:Date.now()}})}), 'jobs/' + id);   // tells open screens a record changed
    const closeSheet = async () => { await pg.locator('#sheet').getByRole('button', {name:'Close'}).first().click(); await pg.waitForFunction(() => document.querySelector('#sheet').hidden); };
    const modalGone = () => pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:8000});
    await poke('q1');
    ok(await pg.evaluate(() => { const L = window.IFDLogic, t = L.todayISO(), at = n => new Date(Date.now() - n * 86400000).toISOString(), m = (n, state, rev) => ({kind:'quote', rev:rev || 'a', channel:'email', to:'a@b.test', state:state || 'sent', at:at(n), sentAt:at(n)});
      const job = (msgs, chase, clicked) => ({status:'open', lines:{}, quotes:{a:{at:at(9), lines:[{label:'Carpet', price:5}], sent:clicked}}, msgs:msgs || {}, chase:chase || {}});
      const none = L.quoteWait(job({}), t), clicked = L.quoteWait(job({}, {}, {email:{at:at(0)}}), t), prep = L.quoteWait(job({a:m(0, 'prepared')}), t), bad = L.quoteWait(job({a:m(0, 'failed')}), t), busy = L.quoteWait(job({a:m(0, 'queued')}), t), other = L.quoteWait(job({a:m(0, 'sent', 'an-older-quote')}), t);
      const w1 = L.quoteWait(job({a:m(0)}), t), w4 = L.quoteWait(job({a:m(4)}), t), w5 = L.quoteWait(job({a:m(5, 'delivered')}), t), hand = L.quoteWait(job({a:m(5, 'manual')}), t);
      const again = L.quoteWait(job({a:m(6)}, {c1:{at:at(0), outcome:'deciding'}}), t), noans = L.quoteWait(job({a:m(6)}, {c1:{at:at(0), outcome:'noanswer'}}), t), next = L.quoteWait(job({a:m(6)}, {c1:{at:at(1), outcome:'noanswer'}}), t);
      return none.state === 'unsent' && none.why === 'none' && clicked.state === 'unsent' && prep.state === 'unsent' && prep.why === 'prepared' && bad.state === 'unsent' && bad.why === 'failed' && busy.why === 'sending' && other.state === 'unsent'
        && w1.state === 'waiting' && w1.ringOn === L.addDays(t, 5) && w4.state === 'waiting' && w5.state === 'ring' && w5.days === 5 && hand.state === 'ring'
        && again.state === 'waiting' && again.ringOn === L.addDays(t, 5) && again.calls === 1 && noans.state === 'waiting' && noans.ringOn === L.addDays(t, 1) && next.state === 'ring'
        && L.quoteWait(job({a:m(6)}, {c1:{at:at(0), outcome:'yes'}}), t).state === 'yes' && L.quoteWait(job({a:m(6)}, {c1:{at:at(0), outcome:'changes'}}), t).state === 'change'; }),
      'the five-day rule: the wait only starts when the quote has really gone (a copy, a failed send, a message about an older quote or the old click do not start it); after five days it is time to ring, a call restarts the wait, no answer comes back the next day, and a yes or a change stays flagged');
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#priceSec');
    await pg.locator('#priceSec .row.price', {hasText:'Quentin Quote'}).click(); await pg.waitForSelector('#quoteForm');
    const qn = await pg.evaluate(() => Array.from(document.querySelectorAll('#quoteLines .qline')).map(q => [q.querySelector('input').value, (q.querySelector('.qnote') || {}).textContent || '']));
    ok(qn.map(x => x[0]).join('|') === 'Carpet|Underlay|Gripper|Door bars|Fitting|Uplift and disposal' && /21\.60 m² to order: 5\.40 m off the 4 m roll, plus the stairs, a 5\.34 m run 80 cm wide/.test(qn[0][1]) && /1 carpet to carpet/.test(qn[3][1]) && /Lounge, 11\.40 m²/.test(qn[5][1])
      && (await pg.locator('#quoteTotal').innerText()) === '£0.00', 'staff get one empty price box for each thing to price, with a note of what it covers');
    for (const [i, v] of [[0, '300'], [1, '80'], [2, '20'], [3, '9.99'], [4, '150'], [5, '40']]) await pg.fill('#qp' + i, v);
    ok((await pg.locator('#quoteTotal').innerText()) === '£599.99', 'the total adds up as the prices are typed');
    await pg.fill('#ql0', 'Carpet 5.4m x 4m'); await pg.fill('#quoteBy', 'Sam'); await pg.locator('#modal').getByRole('button', {name:'Save the quote'}).click();
    ok(/Take the sizes out of the wording/.test(await pg.locator('#modal').innerText()) && !Object.keys(app.store.getDoc('jobs/q1').data.quotes || {}).length, 'a size typed into the wording is refused: the customer is only given the figures');
    await pg.fill('#ql0', 'Carpet'); await pg.locator('#modal').getByRole('button', {name:'Save the quote'}).click(); await pg.waitForSelector('#msgForm');
    const qmsg = await pg.inputValue('#msgBody');
    ok(/^Hi Quentin,/.test(qmsg) && /Quote reference: M-QUOTE-Q1\nDate: \d+ \w+ \d{4}\n/.test(qmsg)
      && /Carpet: £300\.00\nUnderlay: £80\.00\nGripper: £20\.00\nDoor bars: £9\.99\nUplift and disposal: £40\.00\nTo pay Innovation Flooring Direct: £449\.99\n\nFitting: £150\.00\nTo pay your fitter directly: £150\.00\n\nTotal: £599\.99/.test(qmsg)
      && /How payment works\n£449\.99 is paid to Innovation Flooring Direct\.[^\n]*\n£150\.00 for the fitting is paid straight to your fitter on the day, once the job is finished\. It is not paid to the shop\./.test(qmsg)
      && /quote M-QUOTE-Q1\.\n\nInnovation Flooring Direct\n2 South Elgin Place, Clydebank G81 1XP\n0141 952 5200\nhelp@innovationflooringdirect\.com$/.test(qmsg) && !/Sam/.test(qmsg)
      && !(await pg.evaluate(m => window.IFDLogic.hasSize(m, {ref:'M-QUOTE'}), qmsg)) && (await pg.locator('#msgSubject').innerText()) === 'Email subject: Your quote from Innovation Flooring Direct, ref M-QUOTE-Q1',
      'the customer’s copy has the quote reference, what is paid to the shop and what is paid to the fitter as separate amounts with one total, how each is paid, the shop’s own sign-off with no person’s name, and no sizes');
    const qsms = await pg.inputValue('#msgSms');
    ok(/^Innovation Flooring Direct quote M-QUOTE-Q1\. To pay the shop: £449\.99\. Fitting, paid straight to your fitter on the day: £150\.00\. Total: £599\.99\./.test(qsms) && /goes as 2 texts/.test(await pg.locator('#msgSmsCount').innerText()) && await pg.inputValue('#msgBy') === 'Sam',
      'the text version is short, carries the same reference and split, and says how many texts it will go as; the sender’s name is kept for the job, not put in the message');
    const q1 = () => app.store.getDoc('jobs/q1').data, q1m = () => Object.entries(q1().msgs || {}).map(([k, m]) => Object.assign({k:k}, m)).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const q1q = Object.entries(q1().quotes)[0];
    ok(q1q[1].total === 599.99 && q1q[1].byName === 'Sam' && !q1().msgs && mailbox.state.got.length === 0, 'the quote is saved on the job with who priced it, and saving it sends nothing');
    // audit finding 1: copying the message, or opening it in an email app, is not sending it
    await pg.click('#msgCopy'); await pg.waitForFunction(() => /Prepared, not sent/.test(document.querySelector('#msgList').innerText), null, {timeout:8000});
    await pg.evaluate(() => { const a = document.querySelector('#msgOpenMail'); a.addEventListener('click', e => e.preventDefault()); a.click(); });
    await pg.waitForFunction(() => document.querySelectorAll('#msgList .msgl').length === 2, null, {timeout:8000});
    ok(q1m().length === 2 && q1m().every(m => m.state === 'prepared') && q1m()[0].how === 'copied' && q1m()[1].how === 'opened' && /^mailto:quote%40example\.com\?subject=/.test(await pg.getAttribute('#msgOpenMail', 'href')) && mailbox.state.got.length === 0,
      'copying the quote, or opening it in an email app, is recorded as prepared and nothing more');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone(); await pg.waitForSelector('#quoteNext');
    ok(/Prepared but not sent to the customer yet/.test(await pg.locator('#quoteNext').innerText()) && /Prepared, not sent/.test(await pg.locator('#quoteCard h3').innerText()) && /The customer has not been sent it/.test(await pg.locator('#quoteCard').innerText()),
      'the job says the quote was prepared and has not been sent');
    await closeSheet(); await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#quotedSec');
    const qrow0 = await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).innerText();
    ok(/Prepared but not sent to the customer yet/.test(qrow0) && /Send it/.test(qrow0) && !/Ring them on/.test(qrow0) && !/Quotes sent/.test(await pg.locator('#quotedSec h2').innerText()) && await pg.locator('#quotedSec .row.act', {hasText:'Quentin Quote'}).count() === 1,
      'on the dashboard it is flagged to be sent, and its five days have not started');
    // a real send that the mail server refuses, then a second try that goes: one message, in the words as edited
    await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).click(); await pg.waitForSelector('#msgForm');
    ok(await pg.inputValue('#msgBody') === qmsg, 'opening it again brings back the same words');
    const edited = qmsg.replace('To go ahead,', 'We can fit before Christmas if you let us know this week.\n\nTo go ahead,'); assert.ok(edited !== qmsg);
    await pg.fill('#msgBody', edited);
    mailbox.state.refuse['quote@example.com'] = 1;
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgFail', {timeout:8000});
    const f1 = q1m().filter(m => m.state === 'failed');
    ok(f1.length === 1 && f1[0].channel === 'email' && /would not take that address: 550/.test(f1[0].err) && f1[0].failedAt && /It did not send\. The mail server would not take that address/.test(await pg.locator('#msgFail').innerText()) && mailbox.state.got.length === 0
      && await pg.evaluate(j => window.IFDLogic.quoteWait(j, window.IFDLogic.todayISO()).why === 'failed', q1()), 'a send the mail server refuses is shown as not sent, with the reason, and the quote still counts as unsent');
    await pg.waitForFunction(() => { const x = document.querySelector('#failedSec'); return !!x && /Quentin Quote/.test(x.innerText) && /Quote: Did not send by email to quote@example\.com/.test(x.innerText); }, null, {timeout:8000});
    ok(/Messages to sort out/.test(await pg.locator('#failedSec h2').innerText()) && /would not take that address/.test(await pg.locator('#failedSec').innerText()) && await pg.locator('#failedSec').getByRole('button', {name:'Try again'}).count() === 1,
      'and the dashboard lists it under Messages that did not send, for the shop to act on');
    await pg.locator('#msgFail').getByRole('button', {name:'Try again'}).click(); await pg.waitForSelector('#msgOk', {timeout:8000});
    const sentE = q1m().filter(m => m.channel === 'email' && m.state === 'sent');
    ok(sentE.length === 1 && sentE[0].k === f1[0].k && Object.keys(sentE[0].tries).length === 2 && mailbox.state.got.length === 1 && mailbox.state.got[0].text === edited && mailbox.state.got[0].to.join() === 'quote@example.com' && mailbox.state.got[0].subject === 'Your quote from Innovation Flooring Direct, ref M-QUOTE-Q1'
      && sentE[0].body === edited && sentE[0].ref === mailbox.state.got[0].id && sentE[0].rev === q1q[0] && sentE[0].byName === 'Sam' && sentE[0].sentAt && /Sent\. The mail server accepted it for quote@example\.com/.test(await pg.locator('#msgOk').innerText()),
      'trying again sends that one message: the customer gets the words exactly as edited, and the record keeps them with who sent it, which quote it was and the mail server’s reference');
    await pg.waitForFunction(() => !document.querySelector('#failedSec'), null, {timeout:8000});
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgTwice', {timeout:8000});
    ok(/already gone to quote@example\.com/.test(await pg.locator('#msgTwice').innerText()) && mailbox.state.got.length === 1 && q1m().length === 3, 'pressing send again does not send it twice: a second copy has to be asked for');
    // by text: sent once the text service takes it, delivered once the handset has it
    await pg.click('#msgSendText'); await pg.waitForFunction(() => /The text service accepted it for \+447700900321/.test((document.querySelector('#msgOk') || {innerText:''}).innerText), null, {timeout:8000});
    ok(q1m().filter(m => m.channel === 'sms')[0].state === 'sent' && twilio.state.sent.length === 1 && twilio.state.sent[0].body === qsms && twilio.state.sent[0].to === '+447700900321', 'a text goes out through the text service, in the short wording');
    await app.commands.poll();
    const t1 = q1m().filter(m => m.channel === 'sms')[0];
    ok(t1.state === 'delivered' && t1.deliveredAt && /^SM/.test(t1.ref), 'and shows as delivered only when the text service says the handset has it');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone(); await pg.waitForSelector('#msgsCard');
    await pg.waitForFunction(() => /Delivered/.test(document.querySelector('#msgsCard').innerText), null, {timeout:8000});
    const mc = await pg.locator('#msgsCard').innerText();
    ok(/Quote\s+M-QUOTE-Q1\s+Delivered/.test(mc) && /Quote\s+M-QUOTE-Q1\s+Sent/.test(mc) && /Prepared, not sent/.test(mc) && /Reference </.test(mc) && /Copied\. Nothing was sent from here/.test(mc) && (await pg.locator('#msgsCard .msgtext').allTextContents()).some(t => t.includes('We can fit before Christmas')),
      'the job keeps every message with how far it got and exactly what it said');
    await pg.locator('#quoteCard').getByRole('button', {name:'Send it again'}).click(); await pg.waitForSelector('#msgForm');
    ok(await pg.inputValue('#msgBody') === edited, 'opening the quote message again shows the words that were sent, not a fresh draft');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    const forged = await pg.evaluate(k => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/q1', data:{msgs:{[k]:{state:'delivered'}}}})}).then(r => r.status), q1m()[0].k);
    ok(forged === 409 && q1m()[0].state === 'prepared', 'a screen cannot write "sent" or "delivered" onto a job itself: only the server records what went');
    await closeSheet();
    // it waits on the dashboard, and after five days it is time to ring
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#quotedSec');
    const ringDay = await pg.evaluate(() => window.IFDLogic.fmtDay(window.IFDLogic.addDays(window.IFDLogic.todayISO(), 5)));
    const qrow = await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).innerText();
    ok(/Quotes sent/.test(await pg.locator('#quotedSec h2').innerText()) && /Texted .*, delivered/.test(qrow) && qrow.includes('Ring them on ' + ringDay + ' if they have not been back') && /£599\.99/.test(qrow) && !(await pg.locator('#priceSec .row', {hasText:'Quentin Quote'}).count())
      && await pg.locator('#quotedSec.actnow').count() === 0, 'once it has really gone it waits under Quotes sent, with the day to ring them');
    const six = new Date(Date.now() - 6 * 86400000).toISOString(), aged = {}; q1m().filter(m => m.state === 'sent' || m.state === 'delivered').forEach(m => { aged[m.k] = {at:six, sentAt:six}; });
    app.store.updateDoc(docPath('jobs/q1'), {msgs:aged}); await poke('q1');
    await pg.waitForFunction(() => /No reply in 6 days: ring them/.test(document.querySelector('#quotedSec').innerText), null, {timeout:8000});
    ok(await pg.locator('#quotedSec.actnow').count() === 1 && /Ring them/.test(await pg.locator('#quotedSec .row.act', {hasText:'Quentin Quote'}).innerText()), 'after five days with no reply it turns red and says to ring them');
    await pg.locator('#quotedSec .row.act', {hasText:'Quentin Quote'}).click(); await pg.waitForSelector('#chaseForm');
    ok(/07700 900321/.test(await pg.locator('#chaseForm').innerText()) && /£599\.99/.test(await pg.locator('#chaseForm').innerText()), 'opening it brings up the call, with the number and the quote');
    await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click();
    ok(/Say what happened on the call/.test(await pg.locator('#modal').innerText()), 'the call has to say what happened');
    await pg.locator('#chaseOut .radio', {hasText:'Still deciding'}).locator('input').check(); await pg.fill('#chaseNote', 'Waiting on her husband');
    await pg.locator('#modal').getByRole('button', {name:'Save the call'}).click(); await modalGone();
    const ch1 = Object.values(q1().chase)[0];
    ok(ch1.outcome === 'deciding' && ch1.byName === 'Sam' && ch1.note === 'Waiting on her husband' && /Sam rang\. Still deciding: Waiting on her husband/.test(await pg.locator('#quoteCalls').innerText())
      && (await pg.locator('#quoteNext').innerText()).includes('Ring them on ' + ringDay), 'the call is logged on the job and the five days start again');
    // the customer says yes: fitting, delivery or collection, and the carpet from our own rolls goes to be cut
    await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).click(); await pg.waitForSelector('#acceptForm');
    await pg.waitForFunction(() => /In stock: 30\.0 m free on Silver twist carpet · Roll R-801 · 4m wide/.test(document.querySelector('#accSt0').innerText), null, {timeout:8000});
    const af = await pg.locator('#acceptForm').innerText();
    ok(await pg.inputValue('#accLen0') === '5.4' && /For Lounge, Hall, stairs and landing, landing/.test(af) && /The stairs are not in that length: a 5\.34 m run, 80 cm wide/.test(af) && await pg.locator('#accStock0.on').count() === 1 && /goes straight to the warehouse’s cutting list/.test(af)
      && /Carpet\s+£300\.00/.test(af) && (await pg.locator('#accTotal').innerText()) === '£599.99', 'saying yes shows the carpet to cut, that it is in stock, and the quote the customer agreed');
    // audit finding 5: underlay, gripper and door bars are real things to get ready, with a quantity; fitting and uplift are services
    const needs = await pg.evaluate(() => Array.from(document.querySelectorAll('#accNeeds .accitem')).map(d => { const k = d.querySelector('select[id^="accNeedKind"]'), q = d.querySelector('input[id^="accNeedQty"]'), u = d.querySelector('select[id^="accNeedUnit"]');
      return d.querySelector('b').textContent + ':' + (k ? k.value : 'goods') + (k && k.value === 'pick' ? ':' + q.value + ' ' + u.value : ''); }));
    ok(needs.length === 6 && needs[0] === 'Carpet:goods' && needs[1] === 'Underlay · under carpet:pick:11.4 m²' && /^Gripper:pick:1[34](\.\d+)? metres$/.test(needs[2]) && needs[3] === 'Door bars · 1 carpet to carpet:pick:1 items' && needs[4] === 'Fitting:service' && needs[5] === 'Uplift and disposal:service',
      'the yes screen sorts the quote into goods, things to pick with their quantities from the measure, and services: ' + needs.join(' | '));
    await pg.waitForFunction(() => !/Looking in Shopify/.test(document.querySelector('#accNeeds').innerText) && /No product in Shopify is set up for this yet/.test(document.querySelector('#accNeedNote1').innerText), null, {timeout:8000});
    ok(shopify.state.accSearches.some(q => /accessory_underlay AND tag:for_carpet/.test(q)) && shopify.state.accSearches.some(q => /accessory_gripper/.test(q)) && shopify.state.accSearches.some(q => /accessory_doorbar/.test(q))
      && await pg.locator('#accNeedSrc1 option').count() === 1 && await pg.inputValue('#accNeedSrc1') === 'none' && /picked and checked for the job and Shopify stock is not changed/.test(await pg.locator('#accNeedNote2').innerText()),
      'for carpet underlay, gripper and door bars the yes screen looks in Shopify, finds no product set up for them, and says they will be picked without changing Shopify stock: the laminate underlays are not offered for carpet');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Choose fitting, delivery or collection/.test(await pg.locator('#modal').innerText()) && !q1().accepted, 'it has to be entered as a fitting, a delivery or a collection');
    await pg.fill('#accLen0', '40');
    ok(/Only 30\.0 m free on our rolls/.test(await pg.locator('#accSt0').innerText()) && await pg.locator('#accStock0').isDisabled(), 'a cut longer than the roll cannot come from stock');
    await pg.fill('#accLen0', '10.8'); await pg.click('#accStock0');
    await pg.click('#accCollection');
    ok(/goes straight to be cut, and the customer collects it when it is ready/.test(await pg.locator('#accWhenNote').innerText()) && await pg.locator('#accFitter').isHidden() && await pg.locator('#modal .dstrip').isHidden() && await pg.locator('#accFitRow').isHidden() && await pg.locator('#accSplit').isHidden(),
      'a collection needs nothing more: it goes straight to be cut');
    await pg.click('#accDelivery');
    ok(/Pick the delivery day/.test(await pg.locator('#accWhenNote').innerText()) && await pg.locator('#modal .dstrip').isVisible(), 'a delivery asks for its day');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Pick the delivery day/.test(await pg.locator('#modal .banner.bad').last().innerText()) && !q1().accepted, 'and cannot be saved without one');
    await pg.click('#accFitting');
    ok(/Choose the fitter\. Their diary comes up to pick the day/.test(await pg.locator('#accWhenNote').innerText()) && /Choose whose diary first/.test(await pg.locator('#modal .dpick').innerText()), 'a fitting asks for the fitter first');
    ok(await pg.inputValue('#accFitPay') === '150.00' && /Pulled through from the Fitting line on the quote/.test(await pg.locator('#accFitRow').innerText()) && /£150\.00 of that is paid to the fitter on completion\. To pay the shop: £449\.99/.test(await pg.locator('#accSplit').innerText()),
      'choosing fitting pulls the fitting total through from the quote, as the part the customer pays the fitter');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Choose the fitter\./.test(await pg.locator('#modal .banner.bad').last().innerText()) && !q1().accepted, 'a fitting cannot be saved without a fitter');
    await pg.selectOption('#accFitter', 'Lennox');
    await pg.waitForFunction(() => /Lennox’s diary/.test(document.querySelector('#modal .dpick').innerText));
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Pick the fitting day in Lennox’s diary/.test(await pg.locator('#modal .banner.bad').last().innerText()), 'choosing the fitter brings up their diary, and the day has to be picked from it');
    await (await cellOf(pg.locator('#modal'), day(9))).click();
    await pg.waitForFunction(() => /Chosen/.test(document.querySelector('#modal .ddetail').innerText));
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click(); await modalGone();
    const a1 = q1(), a1l = Object.values(a1.lines).sort((x, y) => x.n - y.n), d1 = shopify.state.lastDraft, picks1 = a1l.filter(l => l.hold === 'pick');
    ok(a1.type === 'Fitting' && a1.fitter === 'Lennox' && a1.date === day(9) && a1.diary === false && a1.fitterDue === 150 && a1.total === 599.99 && a1.accepted.byName === 'Sam' && a1.accepted.total === 599.99 && a1.accepted.q === q1q[0] && a1l.length === 7 && a1l[0].unit === 'm' && a1l[0].qty === 108 && a1l[0].w === 4 && a1l[0].hold === 'draft' && /^#D/.test(a1l[0].holdRef) && a1l[0].state === 'todo'
      && a1l[0].variantId === 'gid://shopify/ProductVariant/801' && a1l[0].price === 0 && /Lounge/.test(a1l[0].rooms) && /the stairs/.test(a1l[0].rooms) && a1l.slice(1).map(l => l.title + ' ' + l.price).join('|') === 'Carpet 300|Underlay 80|Gripper 20|Door bars 9.99|Fitting 150|Uplift and disposal 40'
      && Object.keys(a1.drafts).length === 1, 'the job becomes a fitting at the quoted total, tied to the quote that was accepted, with the cut off our roll and every line of the quote on it');
    ok(a1l.slice(1).map(l => l.hold).join('|') === 'none|pick|pick|pick|none|none' && picks1[0].qty === 11.4 && picks1[0].unit === 'm²' && picks1[1].unit === 'metres' && picks1[1].qty >= 13 && picks1[2].qty === 1 && picks1.every(l => l.state === 'todo' && l.picked === false && l.checked === false),
      'underlay, gripper and door bars go on the job as things to be picked and checked, with their quantities; fitting and uplift need no stock');
    const sd1 = Object.values(shopify.state.docs).pop();
    ok(d1.lineItems.length === 6 && d1.lineItems[0].variantId === 'gid://shopify/ProductVariant/801' && d1.lineItems[0].quantity === 108 && !d1.lineItems.some(i => /Carpet cut/.test(i.title || '')) && d1.lineItems[1].title === 'Carpet' && d1.lineItems[1].originalUnitPriceWithCurrency.amount === '300.00'
      && d1.lineItems[2].title === 'Underlay (11.4 m²)' && !d1.lineItems.some(i => /fitting/i.test(i.title || '')) && d1.customAttributes.some(x => x.key === 'Fitting paid direct to the fitter' && x.value === '£150.00') && sd1.total === 449.99
      && !!d1.reserveInventoryUntil && d1.customAttributes.some(x => x.key === 'Job type' && x.value === 'Fitting') && d1.customAttributes.some(x => x.key === 'Job date' && x.value === day(9)),
      'Shopify reserves the cut on that roll and holds the shop’s part of the sale, £449.99: the £150 that goes to the fitter is left out of the Shopify sale and noted on it');
    await pg.waitForSelector('#cutBanner');
    ok(/On the cutting list\. 10\.8 m of Silver twist carpet · Roll R-801 · 4m wide/.test(await pg.locator('#cutBanner').innerText()) && /To cut/.test(await pg.locator('#sheet .panel-head').innerText()) && /The customer said yes/.test(await pg.locator('#quoteAccepted').innerText())
      && await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).count() === 0, 'the job says it is on the cutting list, and the quote shows as accepted');
    ok(/Underlay[\s\S]*?11\.4 m²[\s\S]*?Not picked yet/.test(await pg.locator('#sheet').innerText()) && !/Underlay[^\n]*\n[^\n]*No stock needed/.test(await pg.locator('#sheet').innerText())
      && /To be picked: not a Shopify stock item/.test(await pg.locator('#sheet').innerText()) && /Picking and checking this does not change Shopify stock/.test(await pg.locator('#sheet').innerText()),
      'on the job the underlay shows its quantity and that it is not picked yet, not "No stock needed", and says plainly that picking it does not change Shopify stock');
    await closeSheet();
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#cutSec');
    ok(/10\.8 m\s+off the 4 m roll/.test(await pg.locator('#cutSec .row', {hasText:'Quentin Quote'}).innerText()) && !(await pg.locator('#quotedSec .row', {hasText:'Quentin Quote'}).count()), 'the dashboard shows it under To cut, and it has left the quotes');
    await pg.locator('#cutSec').getByRole('button', {name:'Open the cutting list'}).click(); await pg.waitForSelector('#cutList');
    const crow = pg.locator('#cutList .row', {hasText:'Quentin Quote'});
    ok(/10\.8 m/.test(await crow.innerText()) && /Silver twist carpet · Roll R-801 · 4m wide/.test(await crow.innerText()) && /Fitting with Lennox/.test(await crow.innerText()) && /Rooms: Lounge/.test(await crow.innerText()) && !/£/.test(await pg.locator('#cutList').innerText()),
      'the warehouse’s cutting list shows the length, the roll, who it is for, the fitter and the day, the rooms, and no prices');
    await crow.getByRole('button', {name:'Cut done'}).click(); await pg.waitForSelector('#cutForm');
    await pg.locator('#modal').getByRole('button', {name:'Save: it is cut'}).click();
    ok(/Say where the cut piece is now/.test(await pg.locator('#modal').innerText()), 'a cut cannot be marked done without saying where the piece is');
    await pg.selectOption('#cutBay', 'W4-01'); await pg.locator('#modal').getByRole('button', {name:'Save: it is cut'}).click(); await modalGone();
    const cl = Object.values(q1().lines).find(l => l.unit === 'm');
    await pg.waitForFunction(() => !/Quentin Quote/.test(document.querySelector('#cutList').innerText), null, {timeout:6000});
    ok(cl.state === 'allocated' && cl.bay === 'W4-01' && cl.picked === true && cl.cutBy === 'Sam' && cl.cutAt, 'marking it cut goes through the server, records who cut it and where it is, and it leaves the list');
    // the accessories: on the picking list with quantities and no prices, and the job is not ready until they are picked and checked
    const prow = () => pg.locator('#pickList .row', {hasText:'Quentin Quote'});
    ok(await prow().count() === 3 && /11\.4 m²/.test(await prow().first().innerText()) && /Underlay/.test(await prow().first().innerText()) && /Door bars · 1 carpet to carpet/.test(await pg.locator('#pickList').innerText()) && !/£/.test(await pg.locator('#pickList').innerText()),
      'the same page lists the underlay, gripper and door bars to pick for the job, with quantities and no prices');
    ok(await pg.evaluate(j => { const L = window.IFDLogic, d = L.canConfirmDiary(j, {}, {jobs:[], limits:{}, geo:{}, areas:[]}), c = L.canComplete(j); return L.stageOf(j) !== 'ready' && L.stageOf(j) !== 'allocated' && !d.ok && d.why.some(t => /^Underlay/.test(t)) && d.why.some(t => /^Gripper/.test(t)) && d.why.some(t => /^Door bars/.test(t))
      && !c.ok && c.why.some(t => /^Underlay/.test(t)); }, Object.assign({id:'q1'}, q1())), 'with the carpet cut but the accessories not picked, the job is not ready, cannot go in the diary and cannot be finished');
    for (let i = 0; i < 3; i++){
      await prow().first().getByRole('button', {name:'Picked'}).click(); await pg.waitForSelector('#pickForm');
      if (i === 0){ await pg.locator('#modal').getByRole('button', {name:'Save: it is picked'}).click(); ok(/Say where you have put it/.test(await pg.locator('#modal').innerText()) && /not linked to a Shopify product, so marking it picked does not change Shopify stock/.test(await pg.locator('#pickStockNote').innerText()), 'a pick has to say where the goods have been put, and says it does not change Shopify stock'); }
      await pg.selectOption('#pickBay', 'W4-01'); await pg.locator('#modal').getByRole('button', {name:'Save: it is picked'}).click(); await modalGone();
      await pg.waitForFunction(n => document.querySelectorAll('#pickList .row').length >= 0 && Array.from(document.querySelectorAll('#pickList .row')).filter(r => /Quentin Quote/.test(r.innerText)).length === n, 2 - i, {timeout:6000});
    }
    const pk = Object.values(q1().lines).filter(l => l.hold === 'pick');
    ok(pk.every(l => l.state === 'allocated' && l.bay === 'W4-01' && l.picked === true && l.pickedBy === 'Sam' && l.checked === false) && await pg.evaluate(j => window.IFDLogic.stageOf(j) === 'allocated' && !window.IFDLogic.canComplete(j).ok && window.IFDLogic.canComplete(j).why.some(t => /has not been checked/.test(t)), Object.assign({id:'q1'}, q1())),
      'picking records who picked each one and where it is; the job still cannot be finished until they are checked');
    await openJobPlain('Quentin Quote'); await pg.waitForSelector('#moneyCard');
    for (let i = 0; i < 4; i++){ await pg.locator('#sheet .tick', {hasText:'Checked'}).locator('input:not(:checked)').first().check(); await pg.waitForFunction(n => document.querySelectorAll('#sheet .tick input:checked').length >= 5 + n, i, {timeout:6000}); }
    ok(Object.values(q1().lines).filter(l => l.hold !== 'none').every(l => l.picked && l.checked) && await pg.evaluate(j => window.IFDLogic.stageOf(j) === 'ready', Object.assign({id:'q1'}, q1())), 'once the carpet and every accessory is in its bay, picked and checked, the job is ready');
    // the fitting total is the fitter's, and once the fitting is in the diary the customer is told
    ok(await pg.evaluate(() => { const L = window.IFDLogic, j = {status:'open', type:'Fitting', fitter:'', date:'2031-03-03', slot:'', total:500, fitterDue:120, customer:{address:'1 Test Street', postcode:'G81 1XP'}, pay:{a:{amount:100}}, lines:{a:{n:1, title:'Carpet', hold:'none'}}, sizeCheck:'verified', rooms:{r:{name:'A', status:'verified'}}};
      const told = (state, over) => ({kind:'confirm', channel:'email', to:'a@b.test', state:state, at:'2031-01-01T10:00:00Z', sentAt:'2031-01-01T10:00:00Z', snap:Object.assign(L.bookingSnap(Object.assign({}, j, {fitter:'Sonnie'})), over || {})}), on = (extra) => Object.assign({}, j, {fitter:'Sonnie', diary:true}, extra);
      return L.canConfirmDiary(j, {}, {jobs:[], limits:{}, geo:{}, areas:[]}).why.indexOf('Choose the fitter first.') !== -1 && L.balanceOf(j) === 280 && L.fitterDue(Object.assign({}, j, {type:'Delivery'})) === 0 && L.balanceOf(Object.assign({}, j, {type:'Delivery'})) === 400
        && L.confirmState(on()) === 'todo' && L.confirmState(on({confirms:{a:{at:'2031-01-01T10:00:00Z', date:'2031-03-03', fitter:'Sonnie'}}})) === 'todo' && L.confirmState(on({msgs:{a:told('prepared')}})) === 'todo' && L.confirmState(on({msgs:{a:told('failed')}})) === 'todo'
        && L.confirmState(on({msgs:{a:told('sent')}})) === 'sent' && L.confirmState(on({msgs:{a:told('manual')}})) === 'sent' && L.confirmState(on({msgs:{a:told('delivered')}})) === 'sent'
        && L.confirmState(on({msgs:{a:told('sent')}, fitter:'Stiv'})) === 'changed' && L.confirmChanges(on({msgs:{a:told('sent')}, fitter:'Stiv'})).join() === 'the fitter' && L.confirmChanges(on({msgs:{a:told('sent')}, date:'2031-03-04', slot:'AM'})).join() === 'the day,morning or afternoon'
        && L.confirmChanges(on({msgs:{a:told('sent')}, fitterDue:90})).join() === 'the fitting total' && L.confirmChanges(on({msgs:{a:told('sent')}, customer:{address:'2 Other Road', postcode:'G81 1XP'}})).join() === 'the address' && L.confirmState(Object.assign({}, j, {fitter:'Sonnie', diary:false})) === 'na'; }),
      'a fitting cannot go in the diary without a fitter, the fitting total comes off what the shop collects, a copied or failed confirmation does not count, and a change of day, time of day, fitter, fitting total or address after the customer was told is noticed');
    ok(/£449\.99 to pay the shop/.test(await pg.locator('#moneyCard').innerText()) && (await pg.locator('#fitDue').innerText()) === '£150.00' && (await pg.locator('#shopDue').innerText()) === '£449.99' && /Not yet: it is due when the job is finished/.test(await pg.locator('#fitPaid').innerText()),
      'the job shows the fitting total paid to the fitter, apart from what is left to pay the shop');
    await pg.locator('#sheet').getByRole('button', {name:'Put in the diary'}).click(); await pg.waitForSelector('#msgForm');
    const cm = await pg.inputValue('#msgBody'), longD = await pg.evaluate(d => window.IFDLogic.longDay(d), day(9));
    ok(/^Hi Quentin,/.test(cm) && /Your fitting is booked\.\n\nReference: M-QUOTE\n/.test(cm) && cm.includes('Date: ' + longD + ' ' + day(9).slice(0, 4) + '\nArrival: we will ring you beforehand to agree the time.\nFitter: Lennox\nAddress: 3 Test Street, G81 6EE\n')
      && /Payment\nTotal: £599\.99\nTo pay Innovation Flooring Direct: £449\.99\. Still to pay: £449\.99\.[^\n]*\nTo pay your fitter directly: £150\.00, on the day once the job is finished\. It is not paid to the shop\./.test(cm)
      && /Before we arrive\n- Please have the rooms cleared of furniture before we arrive\.\n- We are lifting and taking away the old flooring in Lounge\.\n- Please make sure someone aged 18 or over is in/.test(cm)
      && /ring us on 0141 952 5200 and quote M-QUOTE\.\n\nInnovation Flooring Direct\n2 South Elgin Place, Clydebank G81 1XP\n0141 952 5200\nhelp@innovationflooringdirect\.com$/.test(cm) && !/Sam/.test(cm) && q1().diary === true
      && (await pg.locator('#msgSubject').innerText()) === 'Email subject: Your fitting is booked with Innovation Flooring Direct, ref M-QUOTE',
      'putting a fitting in the diary brings up the customer’s confirmation: the reference, the day, the arrival, the fitter, the address, what is paid to the shop and what to the fitter, what to do before we arrive, and the shop’s contact details');
    // audit finding 1 again: copying the confirmation does not make it sent, and the warning stays
    await pg.click('#msgCopy'); await pg.waitForFunction(() => /Fitting confirmation\s+Booking revision 1\s+Prepared, not sent/.test(document.querySelector('#msgList').innerText), null, {timeout:8000});
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    await pg.waitForSelector('#confirmBanner');
    ok(/Tell the customer\. The fitting is in the diary for .* and the confirmation has not been sent\. It was prepared but not sent\./.test(await pg.locator('#confirmBanner').innerText()) && !(await pg.locator('#confirmSent').count()), 'copying it leaves the job flagged: the customer still has to be told');
    await closeSheet();
    await pg.locator('#tabs .tab', {hasText:'Today'}).click(); await pg.waitForSelector('#confirmSec');
    const cfr = pg.locator('#confirmSec .row', {hasText:'Quentin Quote'});
    ok(/In the diary, customer not told yet/.test(await cfr.innerText()) && /with Lennox · £150\.00 to the fitter on completion/.test(await cfr.innerText()), 'and the dashboard lists it under Confirmations to send');
    await cfr.getByRole('button', {name:'Send the confirmation'}).click(); await pg.waitForSelector('#msgForm');
    const mailsBefore = mailbox.state.got.length;
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgOk', {timeout:8000});
    await pg.waitForFunction(() => !/Quentin Quote/.test((document.querySelector('#confirmSec') || {innerText:''}).innerText), null, {timeout:8000});
    const cf = q1m().filter(m => m.kind === 'confirm' && m.state === 'sent')[0], cmail = mailbox.state.got[mailbox.state.got.length - 1];
    ok(mailbox.state.got.length === mailsBefore + 1 && cmail.text === cm && cmail.subject === 'Your fitting is booked with Innovation Flooring Direct, ref M-QUOTE' && cf.revNo === 1 && cmail.to.join() === 'quote@example.com' && cf.channel === 'email' && cf.to === 'quote@example.com' && cf.body === cm && cf.ref === cmail.id
      && cf.snap.date === day(9) && cf.snap.fitter === 'Lennox' && cf.snap.due === 150 && cf.snap.total === 599.99 && cf.byName === 'Sam', 'the confirmation really goes to the customer, and the record keeps the day, the fitter and the fitting total they were told');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    await openJobPlain('Quentin Quote'); await pg.waitForSelector('#confirmSent');
    ok(/Confirmation: Emailed to quote@example\.com/.test(await pg.locator('#confirmSent').innerText()) && !(await pg.locator('#confirmBanner').count()), 'the job shows the confirmation was sent');
    await pg.selectOption('#jobFitter', 'Sonnie');
    await pg.waitForSelector('#confirmBanner', {timeout:8000});
    ok(/Needs reconfirmation\. The fitter changed since the customer was told \(Emailed to quote@example\.com/.test(await pg.locator('#confirmBanner').innerText()), 'changing the fitter afterwards shows the booking as needing reconfirmation');
    await pg.selectOption('#jobFitter', 'Lennox'); await pg.waitForSelector('#confirmSent', {timeout:8000});
    // a change to morning or afternoon: a revised confirmation is needed, it says what changed and that it replaces the earlier one, and the earlier one is kept
    await pg.locator('#sheet .seg.sm').getByRole('button', {name:'PM', exact:true}).click();
    await pg.waitForFunction(() => /Needs reconfirmation\. Morning or afternoon changed/.test((document.querySelector('#confirmBanner') || {innerText:''}).innerText), null, {timeout:8000});
    await pg.locator('#confirmBanner').getByRole('button', {name:'Send the new details'}).click(); await pg.waitForSelector('#msgForm');
    const cm2 = await pg.inputValue('#msgBody');
    ok(/The details of your fitting have changed \(morning or afternoon\)\. This replaces our earlier confirmation\./.test(cm2) && /Arrival: in the afternoon\. We will ring you beforehand to agree the time\./.test(cm2) && /Reference: M-QUOTE/.test(cm2)
      && (await pg.locator('#msgSubject').innerText()) === 'Email subject: Updated fitting details from Innovation Flooring Direct, ref M-QUOTE' && /Changed since they were told: morning or afternoon/.test(await pg.locator('#msgForm').innerText()),
      'after the slot changes, the revised confirmation says what changed and that it replaces the earlier one');
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgOk', {timeout:8000}); await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    await pg.waitForSelector('#confirmSent', {timeout:8000});
    const confs = q1m().filter(m => m.kind === 'confirm' && m.state === 'sent');
    ok(confs.length === 2 && confs[0].revNo === 1 && confs[0].body === cm && confs[0].snap.slot === '' && confs[1].revNo === 2 && confs[1].body === cm2 && confs[1].snap.slot === 'PM' && confs[0].rev !== confs[1].rev
      && /Booking revision 2/.test(await pg.locator('#msgsCard').innerText()) && /Booking revision 1/.test(await pg.locator('#msgsCard').innerText()), 'the revised confirmation is revision 2, and revision 1 is still on the job exactly as it was sent');
    // audit finding 4: money. A record of money already taken, checked by the server
    const paid1 = () => Object.entries(q1().pay || {}).map(([k, e]) => Object.assign({k:k}, e)).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    await pg.locator('#moneyCard').getByRole('button', {name:'Record a payment'}).click(); await pg.waitForSelector('#payForm');
    ok(/£449\.99 still to pay the shop\. The fitting total of £150\.00 is paid to the fitter and is not part of this/.test(await pg.locator('#payOwed').innerText()) && /does not charge a card/.test(await pg.locator('#payForm').innerText()) && await pg.inputValue('#payAmount') === '449.99' && await pg.locator('#payOver').isHidden(),
      'recording a payment says what the shop is owed, that the fitter’s money is apart, and that it does not charge a card');
    await pg.fill('#payAmount', '100'); await pg.selectOption('#payMethod', 'Cash');
    await pg.evaluate(() => { const b = Array.from(document.querySelectorAll('#modal button')).find(x => x.textContent === 'Record payment'); b.click(); b.click(); });   // pressed twice in a hurry
    await modalGone(); await pg.waitForSelector('#ledger');
    ok(paid1().length === 1 && paid1()[0].amount === 100 && paid1()[0].method === 'Cash' && paid1()[0].byName === 'Sam' && (await pg.locator('#shopPaid').innerText()) === '£100.00' && /£349\.99 to pay the shop/.test(await pg.locator('#moneyCard h3').innerText()), 'a payment pressed twice is recorded once');
    await pg.locator('#ledger .payl').first().getByRole('button', {name:'Correct'}).click(); await pg.waitForSelector('#fixForm');
    await pg.fill('#fixAmount', '120'); await pg.selectOption('#fixMethod', 'Card machine'); await pg.locator('#modal').getByRole('button', {name:'Save the correction'}).click();
    ok(/Say what was wrong with it/.test(await pg.locator('#modal').innerText()) && paid1().length === 1, 'a correction needs a reason');
    await pg.fill('#fixWhy', 'It was £120 on the card machine, not £100 cash'); await pg.locator('#modal').getByRole('button', {name:'Save the correction'}).click(); await modalGone();
    await pg.waitForFunction(() => document.querySelectorAll('#ledger .payl').length === 2, null, {timeout:6000});
    ok(paid1().length === 2 && paid1()[0].amount === 100 && paid1()[0].void.reason === 'It was £120 on the card machine, not £100 cash' && paid1()[1].amount === 120 && paid1()[1].corrects === paid1()[0].k && await pg.locator('#ledger .payl.void').count() === 1
      && /Struck out .* by Sam: It was £120 on the card machine, not £100 cash/.test(await pg.locator('#ledger .payl.void').innerText()) && (await pg.locator('#shopPaid').innerText()) === '£120.00', 'the wrong entry stays on the record, struck out with the reason, beside the right one');
    await pg.locator('#moneyCard').getByRole('button', {name:'Record a payment'}).click(); await pg.waitForSelector('#payForm');
    await pg.fill('#payAmount', '400');
    ok(await pg.locator('#payOver').isVisible() && /That is £70\.01 more than the £329\.99 still to pay the shop\. What happened to the extra\?/.test(await pg.locator('#payOver').innerText()), 'typing more than is owed asks what happened to the extra');
    await pg.locator('#modal').getByRole('button', {name:'Record payment'}).click();
    ok(/Say what happened to the extra/.test(await pg.locator('#modal').innerText()) && paid1().length === 2, 'and an overpayment is not saved until that is answered');
    await pg.check('#payOverCredit'); await pg.locator('#modal').getByRole('button', {name:'Record payment'}).click(); await modalGone();
    await pg.waitForFunction(() => /£70\.01 in credit/.test(document.querySelector('#moneyCard h3').innerText), null, {timeout:6000});
    ok(paid1().length === 3 && paid1()[2].amount === 400 && paid1()[2].credit === 70.01 && !/-£/.test(await pg.locator('#moneyCard').innerText()) && /This left the customer £70\.01 in credit/.test(await pg.locator('#ledger').innerText()),
      'kept as credit, the job says the customer is £70.01 in credit and never shows a minus amount still to pay');
    await pg.locator('#moneyCard').getByRole('button', {name:'Record a refund'}).click(); await pg.waitForSelector('#refForm');
    ok(await pg.inputValue('#refAmount') === '70.01' && /does not send money anywhere/.test(await pg.locator('#refForm').innerText()), 'a refund starts at the credit and says it only records money already given back');
    await pg.fill('#refAmount', '900'); await pg.fill('#refWhy', 'Credit given back'); await pg.locator('#modal').getByRole('button', {name:'Record refund'}).click();
    await pg.waitForFunction(() => /Only £520\.00 has been paid on this job/.test(document.querySelector('#modal').innerText), null, {timeout:6000});
    await pg.fill('#refAmount', '70.01'); await pg.locator('#modal').getByRole('button', {name:'Record refund'}).click(); await modalGone();
    await pg.waitForFunction(() => /Shop paid/.test(document.querySelector('#moneyCard h3').innerText), null, {timeout:6000});
    ok(paid1().length === 4 && paid1()[3].kind === 'refund' && paid1()[3].amount === 70.01 && paid1()[3].reason === 'Credit given back' && (await pg.locator('#shopPaid').innerText()) === '£449.99' && /-£70\.01/.test(await pg.locator('#ledger').innerText()),
      'a refund cannot be more than was paid, is its own entry with its reason, and brings the job back to paid');
    await pg.locator('#moneyCard').getByRole('button', {name:'Send a receipt'}).click(); await pg.waitForSelector('#msgForm');
    const rc = await pg.inputValue('#msgBody');
    ok(/Reference: M-QUOTE/.test(rc) && /paid £120\.00 by card machine/.test(rc) && /paid £400\.00 by card machine/.test(rc) && /refunded £70\.01/.test(rc) && !/£100\.00/.test(rc) && !/Sam/.test(rc)
      && /Paid to Innovation Flooring Direct so far: £449\.99\nNothing more to pay Innovation Flooring Direct\.\nFitting, paid straight to your fitter on the day: £150\.00\. This is not paid to the shop\./.test(rc),
      'the receipt says what the ledger says: the entries that count, the refund as a refund, and the fitter’s money apart');
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgOk', {timeout:8000});
    ok(mailbox.state.got[mailbox.state.got.length - 1].text === rc && mailbox.state.got[mailbox.state.got.length - 1].subject === 'Your receipt from Innovation Flooring Direct, ref M-QUOTE' && q1m().some(m => m.kind === 'receipt' && m.state === 'sent'), 'and the receipt is really sent to the customer');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    await closeSheet();
    // audit finding 2: a held job cannot be cut from the job sheet, the cutting list or any other route
    const holdJob = extra => Object.assign({v:1, ref:'M-HOLD', source:'measure', status:'open', type:'Fitting', date:'', slot:'', fitter:'Lennox', diary:false, shopifyClosed:false, createdAt:nowQ, accepted:{at:nowQ, byName:'Sam', total:300, type:'Fitting'},
      customer:{name:'Holly Held', phone:'07700 900444', address:'4 Test Street', postcode:'G81 6EE'}, total:300, fitterDue:0, pay:{}, notes:'', quote:[], drafts:{}, sizeCheck:'estimator', pre:preQ, log:{},
      lines:{l1:{n:1, title:'Silver twist carpet · Roll R-801 · 4m wide', sub:'', unit:'m', qty:31, w:4, hold:'draft', holdRef:'#D77', state:'allocated', bay:'W4-01', picked:false, checked:false, price:300, rooms:'Lounge'}},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:3, wid:3.8, area:11.4, spec:cs('carpet')}, vr)}}, extra || {});
    app.store.setDoc(docPath('jobs/h1'), holdJob()); await poke('h1');
    const h1 = () => app.store.getDoc('jobs/h1').data;
    await openJobPlain('Holly Held'); await pg.waitForSelector('#sheet .tick');
    await pg.locator('#sheet .tick', {hasText:'Cut'}).locator('input').click(); await pg.waitForSelector('#cutForm');
    ok(/Cut done/.test(await pg.locator('#modal h2').innerText()) && !(await pg.locator('#cutHeldWhy').count()) && h1().lines.l1.picked === false, 'with the sizes verified and the carpet covering the floor, the Cut tick on the job opens the cut form, and nothing is saved by the tick itself');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await modalGone();
    // the room is corrected from 3.00 x 3.80 to 5.20 x 3.80: verification is cleared, the shop has to review it, and 3.1 m no longer covers it
    app.store.updateDoc(docPath('jobs/h1'), {rooms:{r1:{len:5.2, wid:3.8, area:19.76, status:'changed'}}, review:{on:true, what:'sizes', why:'Lounge was changed from 3.00 x 3.80 m to 5.20 x 3.80 m after the sale.'}}); await poke('h1');
    await pg.waitForFunction(() => /Shop review needed/.test(document.querySelector('#sheet').innerText), null, {timeout:8000});
    await pg.locator('#sheet .tick', {hasText:'Cut'}).locator('input').click(); await pg.waitForSelector('#cutHeldWhy');
    const hw = await pg.locator('#cutHeldWhy').innerText();
    ok(/Not to be cut yet/.test(await pg.locator('#modal h2').innerText()) && /Do not cut this yet/.test(hw) && /Size not verified: Lounge/.test(hw) && /review a change/.test(hw) && /3\.1 m on the job no longer covers the floor as measured \(19\.76 m²\)/.test(hw)
      && await pg.locator('#modal').getByRole('button', {name:/Cut it anyway|Save: it is cut/}).count() === 0 && h1().lines.l1.picked === false, 'after the size is corrected the Cut tick on the job sheet is refused, and says why');
    await pg.locator('#modal').getByRole('button', {name:'Close'}).last().click(); await modalGone();
    ok(!(await pg.locator('#sheet .tick', {hasText:'Cut'}).locator('input').isChecked()) && h1().lines.l1.picked === false, 'the tick stays off and nothing is recorded as cut');
    const viaRoute = await pg.evaluate(() => fetch('/api/db/update', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({path:'jobs/h1', data:{lines:{l1:{picked:true}}}})}).then(r => r.status));
    const viaCmd = await pg.evaluate(() => fetch('/api/cmd', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({cmd:'cut', jobId:'h1', lineK:'l1', bay:'W4-01', byName:'Sam'})}).then(r => r.json().then(j => r.status + ' ' + j.error.code)));
    ok(viaRoute === 409 && viaCmd === '409 held' && h1().lines.l1.picked === false, 'and the server refuses it too, whichever way it is asked');
    await closeSheet(); await pg.locator('#tabs .tab', {hasText:/Cutting/}).click(); await pg.waitForSelector('#cutHeld');
    const hrow = pg.locator('#cutHeld .row', {hasText:'Holly Held'});
    ok(await hrow.count() === 1 && !(await pg.locator('#cutList .row', {hasText:'Holly Held'}).count()) && await hrow.getByRole('button', {name:'Cut done'}).count() === 0 && await hrow.getByRole('button', {name:'Override'}).count() === 0 && /no longer covers the floor/.test(await hrow.innerText()),
      'on the cutting list it sits under Not to be cut yet, with the reason and no way to mark it cut');
    // acknowledging the review, and verifying the new size, does not make 3.1 m cover a 5.2 m room
    await openJobPlain('Holly Held'); await pg.locator('#sheet').getByRole('button', {name:/review/i}).first().click(); await pg.waitForSelector('#reviewNote');
    await pg.fill('#reviewNote', 'Spoke to the customer, carrying on'); await pg.locator('#modal').getByRole('button', {name:'Mark as reviewed'}).click(); await modalGone();
    app.store.updateDoc(docPath('jobs/h1'), {rooms:{r1:{status:'verified'}}}); await poke('h1');
    await pg.waitForFunction(() => !/Shop review needed/.test(document.querySelector('#sheet').innerText), null, {timeout:8000});
    await pg.locator('#sheet .tick', {hasText:'Cut'}).locator('input').click(); await pg.waitForSelector('#cutHeldWhy');
    const hw2 = await pg.locator('#cutHeldWhy').innerText();
    ok(h1().review.on === false && /no longer covers the floor as measured/.test(hw2) && !/review a change/.test(hw2) && !/Size not verified/.test(hw2) && h1().lines.l1.picked === false, 'marking the review as done does not clear a real shortage: it still cannot be cut');
    await pg.locator('#modal').getByRole('button', {name:'Close'}).last().click(); await modalGone(); await closeSheet();
    // the third way in: the Cut done button on a job whose piece is still on the cutting list
    app.store.setDoc(docPath('jobs/h2'), holdJob({ref:'M-HOLD2', customer:{name:'Hattie Held', phone:'07700 900445', address:'5 Test Street', postcode:'G81 6EE'}, lines:{l1:Object.assign({}, holdJob().lines.l1, {state:'todo', bay:''})},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:5.2, wid:3.8, area:19.76, spec:cs('carpet')}, vr)}})); await poke('h2');
    await openJobPlain('Hattie Held'); await pg.locator('#sheet .ln').getByRole('button', {name:'Cut done'}).click(); await pg.waitForSelector('#cutHeldWhy');
    ok(/Not to be cut yet/.test(await pg.locator('#modal h2').innerText()) && /no longer covers the floor as measured/.test(await pg.locator('#cutHeldWhy').innerText()) && await pg.locator('#modal').getByRole('button', {name:/Cut it anyway|Save: it is cut/}).count() === 0
      && app.store.getDoc('jobs/h2').data.lines.l1.picked === false, 'the Cut done button on the job is refused for the same reason: every way of marking a cut asks the same question');
    await pg.locator('#modal').getByRole('button', {name:'Close'}).last().click(); await modalGone(); await closeSheet();
    // only the owner, signed in as themselves, can have it cut anyway, and the reason goes on the job
    await b.pg.keyboard.press('Escape'); await b.pg.locator('#tabs .tab', {hasText:/Cutting/}).click(); await b.pg.waitForSelector('#cutHeld');
    await b.pg.locator('#cutHeld .row', {hasText:'Holly Held'}).getByRole('button', {name:'Override'}).click(); await b.pg.waitForSelector('#cutWhy');
    await b.pg.selectOption('#cutBay', 'W4-01'); await b.pg.fill('#cutBy', 'David'); await b.pg.locator('#modal').getByRole('button', {name:'Cut it anyway'}).click();
    ok(/Say why it is being cut anyway/.test(await b.pg.locator('#modal').innerText()) && h1().lines.l1.picked === false, 'the owner’s override needs a reason');
    await b.pg.fill('#cutWhy', 'Customer has agreed to a join at the doorway'); await b.pg.locator('#modal').getByRole('button', {name:'Cut it anyway'}).click();
    await b.pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:8000});
    const ov = h1().lines.l1;
    ok(ov.picked === true && ov.cutBy === 'David' && ov.cutOverride.reason === 'Customer has agreed to a join at the doorway' && /no longer covers/.test(ov.cutOverride.holds.join(' ')) && Object.values(h1().log).some(x => /HOLD OVERRIDDEN by David: Customer has agreed to a join at the doorway/.test(x.text)),
      'with a reason the owner’s override is saved, and the job’s history says who overrode which hold and why');
    // audit finding 3: finishing the job, the goods leaving and the shop being paid are three separate things
    ok(await pg.evaluate(() => { const L = window.IFDLogic, j = extra => Object.assign({status:'done', type:'Fitting', total:377.4, fitterDue:150, pay:{}, lines:{a:{n:1, title:'Carpet', hold:'none'}}, drafts:{d1:{id:'gid://shopify/DraftOrder/1', name:'#D1'}}}, extra);
      const order = (o) => ({at:'2031-01-01T10:00:00Z', paidHere:o.paidHere || 0, docs:[Object.assign({name:'#3001', orderName:'#3001', isOrder:true, cancelled:false, fulfilled:true, paid:false, total:227.4}, o)]});
      const none = L.closeOff(j(), null), draft = L.closeOff(j(), {at:'x', paidHere:0, docs:[{name:'#D1', isOrder:false, total:227.4}]});
      const unpaid = L.closeOff(j(), order({})), part = L.closeOff(j({pay:{p:{amount:100}}}), order({paidHere:100})), partStale = L.closeOff(j({pay:{p:{amount:100}}}), order({paidHere:0}));
      const fullTodo = L.closeOff(j({pay:{p:{amount:227.4}}}), order({paidHere:227.4})), full = L.closeOff(j({pay:{p:{amount:227.4}}}), order({paidHere:227.4, paid:true}));
      const wrongPaid = L.closeOff(j(), order({paid:true})), wrongTotal = L.closeOff(j(), order({total:377.4})), unfulfilled = L.closeOff(j(), order({fulfilled:false}));
      const txt = x => x.steps.concat(x.wrong).join(' ');
      return none.need && !none.inStep && /still owed £227\.40, so do not mark it paid/.test(txt(none)) && /do not mark it paid\. Tick Payment due later, then Create order/.test(txt(draft)) && !/Mark as paid|mark it paid, /i.test(txt(draft).replace(/do not mark it paid/g, ''))
        && unpaid.inStep && part.inStep && !partStale.inStep && /A payment has changed since Shopify was last checked/.test(txt(partStale))
        && !fullTodo.inStep && /The shop has been paid in full\. Mark order #3001 as paid in Shopify/.test(txt(fullTodo)) && full.inStep
        && wrongPaid.wrong.length === 1 && /shows order #3001 as paid in full, but £227\.40 is still owed to the shop/.test(wrongPaid.wrong[0])
        && wrongTotal.wrong.length === 1 && /Shopify has this sale at £377\.40 but the shop’s part is £227\.40 \(the fitting total of £150\.00 goes to the fitter and is not a shop sale\)/.test(wrongTotal.wrong[0])
        && !unfulfilled.inStep && /Mark order #3001 as fulfilled/.test(txt(unfulfilled))
        && L.balanceOf(j()) === 227.4 && L.balanceOf(j({pay:{p:{amount:100}}})) === 127.4 && L.balanceOf(j({pay:{p:{amount:227.4}}})) === 0 && L.fitterOwed(j()) === 150 && L.fitterOwed(j({fitterPaid:{at:'2031-01-01T10:00:00Z'}})) === 0; }),
      'closing off in Shopify: unpaid, part paid, paid in full and fitter-outstanding jobs each get the right instruction and the right balance, and a sale marked paid while the shop is owed, or one that includes the fitter’s money, is called out');
    const dr = shopify.state.staff.addDraft(227.4), draftsBefore = shopify.state.drafts, callsBefore = shopify.state.calls.length;
    app.store.setDoc(docPath('jobs/x1'), {v:1, ref:'#X1', source:'shop', status:'done', doneAt:nowQ, doneAs:'Fitted', type:'Fitting', date:day(-1), slot:'', fitter:'Lennox', diary:true, shopifyClosed:false, createdAt:nowQ,
      customer:{name:'Una Unpaid', phone:'07700 900666', address:'6 Test Street', postcode:'G81 6EE'}, lines:{l1:{n:1, title:'Carpet', sub:'', unit:'items', qty:1, hold:'none', price:227.4}, l2:{n:2, title:'Fitting', sub:'', unit:'items', qty:1, hold:'none', price:150}},
      total:377.4, fitterDue:150, pay:{}, notes:'', quote:[], drafts:{[dr.num]:{id:dr.id, name:dr.name, closed:false}}, sizeCheck:'verified', rooms:{}, pre:{}, log:{}});
    await poke('x1'); const x1 = () => app.store.getDoc('jobs/x1').data, check = async () => { const was = (x1().shopifySeen || {}).at || ''; await pg.waitForTimeout(5); await pg.locator('#closeCard').getByRole('button', {name:'Check Shopify'}).click();
      for (let i = 0; i < 160 && ((x1().shopifySeen || {}).at || '') === was; i++) await pg.waitForTimeout(50);
      const at = x1().shopifySeen.at; assert.ok(at !== was, 'Shopify was not read back'); await pg.waitForTimeout(250); };   // the answer is saved, then the screen redraws from it
    await pg.keyboard.press('Escape'); await pg.locator('#tabs .tab', {hasText:'Jobs'}).click(); await pg.fill('#jobSearch', 'Una Unpaid');      // finished jobs are found by searching
    await pg.locator('#view .row', {has:pg.locator('.who', {hasText:'Una Unpaid'})}).first().click(); await pg.waitForSelector('#closeCard'); await pg.fill('#jobSearch', '');
    const cc0 = await pg.locator('#closeCard').innerText();
    ok(/£0\.00 of £227\.40\. £227\.40 still to pay the shop/.test(await pg.locator('#closePaid').innerText()) && /£150\.00, still to be recorded as paid by the customer direct to the fitter\. It is not a shop sale and does not belong in Shopify/.test(await pg.locator('#closeFitter').innerText())
      && /The shop is still owed £227\.40, so do not mark it paid: create the order with Payment due later/.test(cc0) && /Not checked yet/.test(await pg.locator('#closeShows').innerText()),
      'a finished job that still owes the shop £227.40 does not tell staff to mark the Shopify sale paid, and shows the fitter’s £150 apart');
    await check(); await pg.waitForFunction(() => /Draft #D\d+: £227\.40, not an order yet/.test(document.querySelector('#closeShows').innerText), null, {timeout:8000});
    ok(/Open draft #D\d+ in Shopify\. The shop is still owed £227\.40, so do not mark it paid\. Tick Payment due later, then Create order/.test(await pg.locator('#closeSteps').innerText()) && x1().shopifyReco === 'todo', 'checking reads the draft back from Shopify and says to make the order with payment due later');
    shopify.state.staff.makeOrder(dr.name, false); shopify.state.staff.fulfil(dr.name);                     // staff do that in Shopify's own admin
    await check(); await pg.waitForFunction(() => /Agrees with the job/.test(document.querySelector('#closeCard h3').innerText), null, {timeout:8000});
    ok(/Order #3\d+: £227\.40, not paid/.test(await pg.locator('#closeShows').innerText()) && /Marked fulfilled in Shopify/.test(await pg.locator('#closeGoods').innerText()) && x1().shopifySeen.docs[0].paid === false && x1().shopifySeen.docs[0].outstanding === 227.4
      && /£227\.40 still owed/.test(await pg.locator('#sheet').innerText()), 'unpaid: Shopify shows the order unpaid and the job shows £227.40 owed, so the two agree and the debt stays flagged');
    const logN = () => Object.values(x1().log).filter(x => /Shopify checked/.test(x.text)).length, logBefore = logN();
    await check(); await check();
    ok(logN() === logBefore && logBefore === 1 && Object.keys(x1().drafts).length === 1 && x1().shopifySeen.docs.length === 1 && shopify.state.drafts === draftsBefore && shopify.state.calls.slice(callsBefore).includes('OpsDraft') && !shopify.state.calls.slice(callsBefore).some(c => /Create|Adjust|OpsSet|Delete/.test(c)),
      'checking again and again leaves one record of what Shopify said, one line in the history, and changes nothing in Shopify');
    const payX = async (amount) => { await pg.locator('#moneyCard').getByRole('button', {name:'Record a payment'}).click(); await pg.waitForSelector('#payForm'); await pg.fill('#payAmount', String(amount)); await pg.locator('#modal').getByRole('button', {name:'Record payment'}).click(); await modalGone(); };
    await pg.locator('#moneyCard').getByRole('button', {name:'Record a payment'}).click(); await pg.waitForSelector('#payForm'); await pg.fill('#payAmount', '300');
    ok(/That is £72\.60 more than the £227\.40 still to pay the shop\. What happened to the extra\?/.test(await pg.locator('#payOver').innerText()), 'the audit’s case: £300 against £227.40 asks what happened to the £72.60');
    await pg.locator('#modal').getByRole('button', {name:'Record payment'}).click();
    ok(/Say what happened to the extra/.test(await pg.locator('#modal').innerText()) && Object.keys(x1().pay).length === 0, 'and nothing is recorded until change or credit is chosen');
    await pg.locator('#modal').getByRole('button', {name:'Cancel'}).click(); await modalGone();
    await payX(100); await pg.waitForFunction(() => /A payment has changed since Shopify was last checked/.test(document.querySelector('#closeCard').innerText), null, {timeout:8000});
    await check(); await pg.waitForFunction(() => /Agrees with the job/.test(document.querySelector('#closeCard h3').innerText), null, {timeout:8000});
    ok(/£100\.00 of £227\.40\. £127\.40 still to pay the shop/.test(await pg.locator('#closePaid').innerText()) && x1().shopifySeen.paidHere === 100 && x1().shopifySeen.docs[0].paid === false, 'part paid: £127.40 is still owed here and the Shopify order stays unpaid');
    await payX(127.4); await pg.waitForFunction(() => /A payment has changed/.test(document.querySelector('#closeCard').innerText), null, {timeout:8000});
    await check(); await pg.waitForFunction(() => /The shop has been paid in full\. Mark order #3\d+ as paid in Shopify/.test(document.querySelector('#closeCard').innerText), null, {timeout:8000});
    ok(x1().shopifyReco === 'todo' && /Nothing more to pay the shop/.test(await pg.locator('#closePaid').innerText()), 'paid in full here: now, and only now, staff are told to mark the Shopify order paid');
    shopify.state.staff.markPaid(dr.name);
    await check(); await pg.waitForFunction(() => /Agrees with the job/.test(document.querySelector('#closeCard h3').innerText), null, {timeout:8000});
    ok(x1().shopifySeen.docs[0].paid === true && x1().shopifySeen.docs[0].received === 227.4 && x1().shopifyReco === 'agrees' && /Fitting total of £150\.00 not recorded as paid to the fitter/.test(await pg.locator('#sheet').innerText()),
      'fully shop-paid: both systems show £227.40 paid, and the fitter’s £150 is still flagged as not recorded');
    await pg.locator('#moneyCard').getByRole('button', {name:'The fitter has been paid'}).click(); await pg.waitForSelector('#fpForm');
    await pg.fill('#fpNote', 'Cash on the day'); await pg.locator('#modal').getByRole('button', {name:'Record it'}).click(); await modalGone();
    await pg.waitForFunction(() => /^Yes\. Recorded/.test(document.querySelector('#fitPaid').innerText), null, {timeout:6000});
    ok(x1().fitterPaid.amount === 150 && x1().fitterPaid.byName === 'Sam' && x1().fitterPaid.fitter === 'Lennox' && Object.keys(x1().pay).length === 2 && /recorded as paid by the customer direct to the fitter/.test(await pg.locator('#closeFitter').innerText())
      && !/not recorded as paid to the fitter/.test(await pg.locator('#sheet').innerText()), 'the fitter being paid is noted on the job, apart from the shop’s ledger');
    shopify.state.staff.setTotal(dr.name, 377.4);                                                                // somebody puts the fitting money on the Shopify sale
    await check(); await pg.waitForFunction(() => /Does not agree/.test(document.querySelector('#closeCard h3').innerText), null, {timeout:8000});
    ok(/Shopify has this sale at £377\.40 but the shop’s part is £227\.40/.test(await pg.locator('#closeCard').innerText()) && x1().shopifyReco === 'wrong' && Object.values(x1().log).some(x => /Shopify checked and it does not agree/.test(x.text)),
      'if the Shopify sale and the shop’s part stop agreeing, the job says so and it goes in the history');
    await closeSheet();
    // ordering in: the job is held until the order details and the arrival date are in
    await openJobPlain('Olive Orderin'); await pg.waitForSelector('#quoteCard');
    await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).click(); await pg.waitForSelector('#acceptForm');
    await pg.waitForFunction(() => /In stock/.test(document.querySelector('#accSt0').innerText), null, {timeout:8000});
    await pg.click('#accOrder0');
    ok(/It goes under To order\. The job is held there until the order details and the arrival date are in/.test(await pg.locator('#accHint0').innerText()), 'choosing to order it in says the job will be held for the order details');
    await pg.click('#accFitting'); await pg.selectOption('#accFitter', 'Lennox');
    ok(/Choose the fitter\. The day is picked once the order details and the arrival date are in/.test(await pg.locator('#accWhenNote').innerText()) && await pg.locator('#modal .dstrip').isHidden() && await pg.locator('#accFitter').isVisible(), 'a fitting whose carpet is ordered in still gets its fitter, and its day waits for the arrival date');
    await pg.click('#accDelivery');
    ok(/The delivery day is picked once the order details and the arrival date are in/.test(await pg.locator('#accWhenNote').innerText()) && await pg.locator('#modal .dstrip').isHidden(), 'a delivery whose carpet is ordered in is not asked for a day yet');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:8000});
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
    await pg.locator('#modal').getByRole('button', {name:'Save the order details'}).click(); await pg.waitForSelector('#dayForm', {timeout:6000});
    ok((await pg.locator('#dayForm').innerText()).includes('The carpet is due in ' + etaTxt + ', so pick that day or a later one'), 'as soon as the arrival date is in, it asks for the delivery day');
    await pg.locator('#modal').getByRole('button', {name:'Not yet'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    const o2l = Object.values(app.store.getDoc('jobs/q2').data.lines).find(l => l.unit === 'm');
    await pg.waitForSelector('#onOrderSec');
    ok(o2l.state === 'ordered' && o2l.supplier === 'Carpet Co' && o2l.orderRef === 'PO-77' && o2l.due === etaDay && o2l.orderedBy === 'Sam' && !(await pg.locator('#orderSec').count())
      && (await pg.locator('#onOrderSec .row', {hasText:'Olive Orderin'}).innerText()).includes('Due in ' + etaTxt) && /from Carpet Co, order PO-77/.test(await pg.locator('#onOrderSec .row', {hasText:'Olive Orderin'}).innerText()),
      'once the order details are in it moves to On order, showing when it is due');
    const oo = pg.locator('#onOrderSec .row', {hasText:'Olive Orderin'});
    ok(/No day picked yet/.test(await oo.innerText()), 'and it says no day has been picked yet');
    await oo.getByRole('button', {name:'Pick the day'}).click(); await pg.waitForSelector('#dayForm');
    await pg.evaluate(d => { const i = document.querySelector('#dayDate'); i.value = d; i.dispatchEvent(new Event('change', {bubbles:true})); }, day(3));
    await pg.waitForFunction(() => /The carpet is not due in until/.test(document.body.innerText), null, {timeout:6000});
    await pg.locator('#modal').getByRole('button', {name:'Save the day'}).click();
    ok(/Pick the delivery day/.test(await pg.locator('#modal .banner.bad').last().innerText()) && app.store.getDoc('jobs/q2').data.date === '', 'the day cannot be before the carpet is due in');
    const dayAfter = await pg.evaluate(d => window.IFDLogic.addDays(d, 1), etaDay);
    await (await cellOf(pg.locator('#modal'), dayAfter)).click();
    await pg.waitForFunction(() => /Chosen/.test(document.querySelector('#modal .ddetail').innerText));
    await pg.locator('#modal').getByRole('button', {name:'Save the day'}).click(); await pg.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout:6000});
    ok(app.store.getDoc('jobs/q2').data.date === dayAfter, 'and is saved once it is on or after the arrival date');
    await pg.waitForFunction(() => /Delivery (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(document.querySelector('#onOrderSec').innerText), null, {timeout:6000});
    await openJobPlain('Olive Orderin'); await pg.waitForSelector('#quoteCard');
    ok(/On order/.test(await pg.locator('#sheet .panel-head').innerText()) && !(await pg.locator('#orderBanner').count()), 'the job is no longer held');
    await pg.evaluate(d => { const i = document.querySelector('#jobDate'); i.value = d; i.dispatchEvent(new Event('change', {bubbles:true})); }, day(3));
    await pg.waitForFunction(() => /is not due in until/.test(document.body.innerText), null, {timeout:6000});
    ok(app.store.getDoc('jobs/q2').data.date === dayAfter, 'on the job itself the day cannot be moved to before the carpet is due in either');
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
    // ---- answers that get lost on the way: nothing is sent twice by guesswork ----
    qJob('l1', 'M-LOST', 'Larry Lost', {quotes:sentQ}); qJob('l2', 'M-MAYBE', 'Mina Maybe', {quotes:sentQ}); await poke('l1');
    const jm = id => Object.entries(app.store.getDoc('jobs/' + id).data.msgs || {}).map(([k, m]) => Object.assign({k:k}, m)).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const openSend = async name => { await openJobPlain(name); await pg.waitForSelector('#quoteCard'); await pg.locator('#quoteCard').getByRole('button', {name:/^Send it/}).click(); await pg.waitForSelector('#msgForm'); };
    // the send button pressed twice in a hurry
    await openSend('Larry Lost'); let mailN = mailbox.state.got.length;
    await pg.evaluate(() => { const b = document.querySelector('#msgSendEmail'); b.click(); b.click(); }); await pg.waitForSelector('#msgOk', {timeout:8000});
    ok(mailbox.state.got.length === mailN + 1 && jm('l1').length === 1, 'the send button pressed twice sends one email');
    // the server sent it, but its answer never reached this screen
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone(); await openSend('Mina Maybe'); mailN = mailbox.state.got.length; let lostOnce = false;
    await pg.route('**/api/cmd', async route => { if (!lostOnce && /msg\.send/.test(route.request().postData() || '')){ lostOnce = true; await route.fetch(); await route.abort(); } else await route.continue(); });
    await pg.click('#msgSendEmail');
    await pg.waitForFunction(() => /The answer did not come back, so this screen cannot tell yet whether it went\. Press the same Send button again/.test(document.querySelector('#msgForm').innerText), null, {timeout:8000});
    ok(mailbox.state.got.length === mailN + 1 && !(await pg.locator('#msgOk').count()), 'when the answer is lost between the server and the screen, the screen does not claim it went, and says what to do');
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgOk', {timeout:8000}); await pg.unroute('**/api/cmd');
    ok(mailbox.state.got.length === mailN + 1 && jm('l2').length === 1 && jm('l2')[0].state === 'sent', 'pressing Send again finds the message already gone: the customer gets it once');
    // the text service took the text, then its answer was lost: not sent again blind, and settled by asking the text service
    twilio.state.loseAnswer['+447700900321'] = 1; let textN = twilio.state.sent.length;
    await pg.click('#msgSendText'); await pg.waitForSelector('#msgUnsure', {timeout:8000});
    ok(/It is not known whether this went\./.test(await pg.locator('#msgUnsure').innerText()) && /It has not been sent again/.test(await pg.locator('#msgUnsure').innerText()) && twilio.state.sent.length === textN + 1 && jm('l2').filter(m => m.channel === 'sms')[0].state === 'unsure'
      && await pg.locator('#msgList .unsure').count() === 1 && await pg.locator('#msgList').getByRole('button', {name:'Try again'}).count() === 0, 'a text whose answer was lost shows as not known to have gone, with a way to check and no Try again');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone(); await closeSheet(); await pg.locator('#tabs .tab', {hasText:'Today'}).click();
    await pg.waitForFunction(() => { const x = document.querySelector('#failedSec'); return !!x && /Mina Maybe/.test(x.innerText) && /Not known if it went/.test(x.innerText); }, null, {timeout:8000});
    ok(await pg.locator('#failedSec .row', {hasText:'Mina Maybe'}).getByRole('button', {name:'Sort it out'}).count() === 1 && await pg.locator('#failedSec .row', {hasText:'Mina Maybe'}).getByRole('button', {name:'Try again'}).count() === 0, 'the dashboard lists it to be sorted out, not retried');
    await pg.locator('#failedSec .row', {hasText:'Mina Maybe'}).getByRole('button', {name:'Sort it out'}).click(); await pg.waitForSelector('#msgsCard .unsure');
    ok(/Do not send this again until it has been checked/.test(await pg.locator('#msgsCard .unsure').innerText()) && /may not have gone: check before sending it again/.test(await pg.locator('#sheet').innerText()), 'the job itself says not to send it again until it has been checked');
    await pg.locator('#quoteCard').getByRole('button', {name:/^Send it/}).click(); await pg.waitForSelector('#msgForm');
    await pg.click('#msgSendText'); await pg.waitForSelector('#msgHanging', {timeout:8000});
    ok(/An earlier send of this to \+447700900321 is not known to have gone\. Sort that one out first/.test(await pg.locator('#msgHanging').innerText()) && twilio.state.sent.length === textN + 1, 'pressing Send again is refused until the first one is sorted out');
    await pg.locator('#msgList .unsure').getByRole('button', {name:'Check with the text service'}).click(); await pg.waitForSelector('#msgOk', {timeout:8000});
    const lt = jm('l2').filter(m => m.channel === 'sms')[0];
    ok(lt.state === 'sent' && lt.ref === twilio.state.sent[twilio.state.sent.length - 1].sid && twilio.state.sent.length === textN + 1 && jm('l2').length === 2 && Object.values(app.store.getDoc('jobs/l2').data.log).some(x => /checked with the text service by Sam\. It has it/.test(x.text)),
      'asking the text service finds it went: the message is marked sent with its reference, nothing is sent twice, and the check is on the job’s history');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone();
    // the mail server took an email, then its answer was lost: a person checks and says which, with how they know
    qJob('l3', 'M-EMAIL', 'Edna Emailed', {quotes:sentQ}); await poke('l3'); await openSend('Edna Emailed'); mailN = mailbox.state.got.length; mailbox.state.loseAnswer = 1;
    await pg.click('#msgSendEmail'); await pg.waitForSelector('#msgUnsure', {timeout:8000});
    ok(jm('l3')[0].state === 'unsure' && mailbox.state.got.length === mailN + 1 && /Look in the Sent folder of help@innovationflooringdirect\.com for a message to quote@example\.com, or ask the customer/.test(await pg.locator('#msgList .unsure').innerText())
      && await pg.locator('#msgList .unsure').getByRole('button', {name:'Check with the text service'}).count() === 0, 'an email whose answer was lost says where to look, since an email cannot be looked up');
    await pg.locator('#msgList .unsure').getByRole('button', {name:'It did arrive'}).click();
    await pg.waitForFunction(() => /Say how you know it arrived/.test(document.querySelector('#msgList .unsure').innerText), null, {timeout:8000});
    await pg.fill('#msgList .unsHow', 'It is in the Sent folder'); await pg.locator('#msgList .unsure').getByRole('button', {name:'It did arrive'}).click(); await pg.waitForSelector('#msgOk', {timeout:8000});
    ok(jm('l3').length === 1 && jm('l3')[0].state === 'sent' && jm('l3')[0].confirmed.note === 'It is in the Sent folder' && jm('l3')[0].confirmed.byName === 'Sam' && mailbox.state.got.length === mailN + 1, 'saying it did arrive needs how they know, marks it sent under their name, and sends nothing more');
    await pg.locator('#modal').getByRole('button', {name:'Done'}).click(); await modalGone(); await closeSheet();
    // ---- accessories that are real Shopify products: reserved with the sale, taken off stock once, put back once if the job is cancelled ----
    qJob('f1', 'M-FLOOR', 'Fiona Flooring', {brief:{rooms:[{name:'Lounge', want:'c1'}], choices:[{k:'c1', title:'Royale Oak 12mm Herringbone Laminate', variantId:'gid://shopify/ProductVariant/701', unit:'packs'}], also:[]},
      rooms:{r1:Object.assign({n:1, name:'Lounge', len:5, wid:4.6, area:23, spec:cs('flooring', {underlay:true, gripper:null, beading:true})}, vr)},
      quotes:{qa:{n:1, at:nowQ, by:'', byName:'Sam', lines:[{label:'Flooring', price:500}, {label:'Underlay', price:90}, {label:'Beading', price:30}, {label:'Fitting', price:200}], total:820}}});
    await poke('f1'); const fJob = () => app.store.getDoc('jobs/f1').data, silver = 'gid://shopify/ProductVariant/9101';
    await openJobPlain('Fiona Flooring'); await pg.waitForSelector('#quoteCard'); await pg.locator('#quoteCard').getByRole('button', {name:'Customer said yes'}).click(); await pg.waitForSelector('#acceptForm');
    await pg.waitForFunction(() => document.querySelectorAll('#accNeedSrc1 option').length === 4 && !/Looking in Shopify/.test(document.querySelector('#accNeeds').innerText), null, {timeout:8000});
    const srcs = await pg.locator('#accNeedSrc1 option').allTextContents();
    ok(srcs[0] === 'Choose the product, or say it is not a stock item' && /15 m2 Premium Quality Silver Underlay · 1 Roll · 242 free in Shopify/.test(srcs[1]) && /Thermo-X UFH Underlay · 1 Roll · 250 free/.test(srcs[2]) && srcs[3] === 'Not a Shopify stock item: picked only' && await pg.inputValue('#accNeedSrc1') === ''
      && /Choose which product this is\. They are not matched automatically/.test(await pg.locator('#accNeedNote1').innerText()) && shopify.state.accSearches.some(q => /accessory_underlay AND NOT tag:for_carpet/.test(q)),
      'for underlay under flooring the yes screen offers the Shopify underlay products with what is free, and matches nothing by itself');
    ok(await pg.locator('#accNeedSrc2 option').count() === 3 && await pg.locator('#accNeedSrc2 option').nth(1).evaluate(o => o.disabled) && /Shopify is not counting stock for this/.test(await pg.locator('#accNeedSrc2 option').nth(1).textContent()), 'a product Shopify is not counting stock for cannot be chosen as stock');
    await pg.click('#accCollection'); await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click();
    ok(/Say where the underlay under flooring comes from: choose the product, or say it is not a stock item/.test(await pg.locator('#modal .banner.bad').last().innerText()) && !fJob().accepted, 'the sale cannot be saved until somebody has said where each accessory comes from');
    await pg.selectOption('#accNeedSrc1', silver); await pg.selectOption('#accNeedSrc2', 'none');
    ok(await pg.inputValue('#accNeedUnits1') === '2' && /2 rolls, each covering 15 m² according to Shopify\. Check that against the label/.test(await pg.locator('#accNeedPer1').innerText()) && /comes off Shopify stock once, when the order is fulfilled there/.test(await pg.locator('#accNeedNote1').innerText()),
      'choosing the 15 m² roll for 23 m² of floor works out 2 rolls, and says when Shopify stock changes');
    await pg.fill('#accNeedUnits1', '999');
    ok(/Only 242 free in Shopify/.test(await pg.locator('#accNeedNote1').innerText()), 'more than Shopify has free is flagged'); await pg.fill('#accNeedUnits1', '2');
    await pg.locator('#modal').getByRole('button', {name:'Save: the customer said yes'}).click(); await modalGone();
    const fl = Object.values(fJob().lines).sort((x, y) => x.n - y.n), fd = shopify.state.lastDraft, ul = fl.find(l => l.variantId === silver), bd = fl.find(l => l.title === 'Beading');
    ok(ul && ul.hold === 'draft' && /^#D/.test(ul.holdRef) && ul.unit === 'rolls' && ul.qty === 2 && ul.price === 90 && ul.acc.label === 'Underlay' && ul.acc.need === 23 && ul.acc.unit === 'm²' && ul.state === 'todo' && ul.picked === false && !ul.cov
      && bd.hold === 'pick' && bd.unit === 'metres' && fl.find(l => l.title === 'Fitting').hold === 'none' && fl.find(l => l.title === 'Flooring').hold === 'none' && fJob().total === 820,
      'the underlay goes on the job as 2 rolls reserved in Shopify, the beading as a pick-only item, and fitting as a service');
    const vi = fd.lineItems.filter(i => i.variantId === silver);
    ok(vi.length === 1 && vi[0].quantity === 2 && vi[0].appliedDiscount.value === 100 && fd.lineItems.some(i => i.title === 'Underlay (23 m²)' && i.originalUnitPriceWithCurrency.amount === '90.00') && !!fd.reserveInventoryUntil
      && Object.values(shopify.state.docs).pop().total === 820 && shopify.state.acc[silver] === 240, 'Shopify reserves the 2 rolls on the same draft as the sale, once, and the sale keeps the quoted figures');
    ok(/Reserved in Shopify #D\d+/.test(await pg.locator('#sheet .ln', {hasText:'Silver Underlay'}).innerText()) && /For underlay: 23 m² needed\. Reserved on the Shopify draft\. It comes off Shopify stock when the order is fulfilled in Shopify, not when it is ticked here/.test(await pg.locator('#sheet .ln', {hasText:'Silver Underlay'}).innerText()),
      'the job says the rolls are reserved in Shopify and that ticking them here is not what changes the stock');
    await closeSheet(); await pg.locator('#tabs .tab', {hasText:/Cutting/}).click(); await pg.waitForSelector('#pickList');
    const frow = pg.locator('#pickList .row', {hasText:'Fiona Flooring'});
    ok(await frow.count() === 2 && /2 rolls/.test(await frow.first().innerText()) && /Reserved in Shopify #D\d+/.test(await frow.first().innerText()) && /Not Shopify stock/.test(await frow.nth(1).innerText()), 'both are on the picking list, each marked as Shopify stock or not');
    await frow.first().getByRole('button', {name:'Picked'}).click(); await pg.waitForSelector('#pickForm');
    ok(/does not take it off Shopify stock\. That happens once, when the order is fulfilled in Shopify/.test(await pg.locator('#pickStockNote').innerText()), 'picking a Shopify item says the tick does not take it off stock');
    await pg.selectOption('#pickBay', 'W4-01'); await pg.locator('#modal').getByRole('button', {name:'Save: it is picked'}).click(); await modalGone();
    ok(shopify.state.acc[silver] === 240 && !shopify.state.calls.slice(-6).some(c => /Adjust|OpsSet/.test(c)), 'picking it changes nothing in Shopify: still 2 reserved, no stock adjustment made');
    await openJobPlain('Fiona Flooring'); await pg.locator('#sheet').getByRole('button', {name:'Cancel this job'}).click();
    await pg.waitForFunction(() => /Delete draft #D\d+ in Shopify and release its reserved stock/.test(document.querySelector('#modal').innerText), null, {timeout:6000});
    const delsBefore = shopify.state.deletes || 0;
    await pg.locator('#modal').getByRole('button', {name:'Cancel the job'}).click(); await modalGone();
    ok(fJob().status === 'cancelled' && shopify.state.acc[silver] === 242 && (shopify.state.deletes || 0) === delsBefore + 1 && Object.values(fJob().drafts)[0].deleted === true, 'cancelling the job deletes the draft once and the 2 rolls go back on sale');
    await closeSheet();
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
    await pg.waitForFunction(() => !/saved jobs cannot be reached/.test(document.body.innerText) && /Late Arrival|Olive Orderin|Brief Customer/.test(document.querySelector('#view').innerText), null, {timeout:12000});
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
    // the owner's Setup page: what is ready to send, test mode, and who test messages may go to
    await b.pg.keyboard.press('Escape'); await b.pg.locator('#tabs .tab', {hasText:/Setup|More/}).first().click();
    if (!(await b.pg.locator('#msgSetupSec').count())) await b.pg.locator('#view').getByRole('button', {name:'Setup'}).click();
    await b.pg.waitForFunction(() => /^Ready\. Sent from shop@example\.test/.test((document.querySelector('#setEmail') || {innerText:''}).innerText), null, {timeout:8000});
    ok(/^Ready/.test(await b.pg.locator('#setSms').innerText()) && /^On\. Messages only go to the test details listed here/.test(await b.pg.locator('#setTest').innerText()) && /quote@example\.com/.test(await b.pg.locator('#msgSetupSec').innerText()),
      'Setup shows the owner that email and texts are ready, that test mode is on, and who test messages may go to');
    await b.pg.fill('#newMsgTo', '07700 900888'); await b.pg.locator('#msgSetupSec').getByRole('button', {name:'Add test details'}).click();
    await b.pg.waitForFunction(() => /07700 900888/.test(document.querySelector('#msgSetupSec .meta').innerText), null, {timeout:8000});
    await b.pg.locator('#msgSetupSec').getByRole('button', {name:'Turn test mode off and message customers'}).click(); await b.pg.waitForSelector('#liveForm');
    ok(app.store.getDoc('settings/main').data.msgs.testOnly === true && app.store.getDoc('settings/main').data.msgs.allow.length === 3 && app.store.getDoc('settings/main').data.fitters.length >= 2, 'the owner adds a test number without disturbing the other settings, and going live is asked twice');
    await b.pg.locator('#modal').getByRole('button', {name:'Keep test mode on'}).click();
    // the standard wording is the owner's to set, and the next message uses it
    ok(/It is paid in the shop, by card over the phone, or by bank transfer, and is due before your fitting day\./.test(await b.pg.inputValue('#setTerms')) && /aged 18 or over/.test(await b.pg.inputValue('#setPrep')) && /never with a person’s name/.test(await b.pg.locator('#wordsSec').innerText()), 'Setup shows the standing wording for how the shop is paid and what to do before a fitting');
    await b.pg.fill('#setTerms', 'Half is paid when you order and the rest before your fitting day.'); await b.pg.locator('#wordsSec').getByRole('button', {name:'Save the wording'}).click();
    await b.pg.waitForFunction(() => true); for (let i = 0; i < 60 && !((app.store.getDoc('settings/main').data.words || {}).terms); i++) await b.pg.waitForTimeout(50);
    ok(app.store.getDoc('settings/main').data.words.terms === 'Half is paid when you order and the rest before your fitting day.' && app.store.getDoc('settings/main').data.msgs.allow.length === 3
      && await b.pg.evaluate(() => /is paid to Innovation Flooring Direct\. Half is paid when you order and the rest before your fitting day\./.test(window.IFDLogic.quoteMessage({ref:'M-X', customer:{name:'A'}}, {n:1, at:new Date().toISOString(), lines:[{label:'Carpet', price:5}]}, {name:'Innovation Flooring Direct', phone:'1', words:{terms:'Half is paid when you order and the rest before your fitting day.'}}))),
      'the owner changes how the shop’s part is paid, without disturbing the other settings, and quotes use the new wording');
    // with no mail server or text service set up, as the live system is until their details are entered, nothing can be sent and nothing says it was
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ifd-b2-'));
    const app2 = create({env:{DATA_DIR:dir2, INSECURE_COOKIES:'1', SESSION_PEPPER:'t', OWNER_NAME:'David', OWNER_MOBILE:'07700 900001', SHOP_MOBILE:'07700 900002', SHOPIFY_STORE:'innovationflooring', SHOPIFY_CLIENT_ID:'test-id', SHOPIFY_CLIENT_SECRET:'test-secret'},
      fetch:fake.make().fetchImpl, sendText:async (to, body) => { texts.push({to, body}); }, log:() => {}, pollMs:3600000});
    try {
      await new Promise(r => app2.server.listen(0, '127.0.0.1', r));
      app2.store.setDoc(docPath('settings/main'), {fitters:['Lennox'], bays:['W4-01']});
      app2.store.setDoc(docPath('jobs/u1'), {v:1, ref:'M-UNSET', source:'measure', status:'open', type:'Fitting', date:'', slot:'', fitter:'', diary:false, shopifyClosed:false, createdAt:nowQ, customer:{name:'Nora Notsetup', phone:'07700 900321', email:'quote@example.com'},
        lines:{}, total:0, pay:{}, notes:'', quote:[], drafts:{}, sizeCheck:'estimator', pre:preQ, log:{}, rooms:{}, quotes:{qa:{n:1, at:nowQ, by:'', byName:'Sam', lines:[{label:'Carpet', price:200}, {label:'Fitting', price:120}], total:320}}});
      const u = await signedIn('07700 900002', '+447700900002', 'http://127.0.0.1:' + app2.server.address().port), up = u.pg, u1 = () => app2.store.getDoc('jobs/u1').data;
      await up.waitForSelector('#quotedSec');
      await up.locator('#quotedSec .row', {hasText:'Nora Notsetup'}).click(); await up.waitForSelector('#msgForm');
      await up.waitForFunction(() => /Email sending is not set up yet\. Texting is not set up yet\. Until it is, send it another way below and record that you did/.test(document.querySelector('#msgSetup').innerText), null, {timeout:8000});
      ok(await up.locator('#msgSendEmail').isDisabled() && await up.locator('#msgSendText').isDisabled(), 'before the mail and text details are in, the send buttons are off and the screen says why');
      const direct = await up.evaluate(() => fetch('/api/cmd', {method:'POST', headers:{'x-ifd':'1', 'content-type':'application/json'}, body:JSON.stringify({cmd:'msg.send', jobId:'u1', kind:'quote', channel:'email', to:'quote@example.com', subject:'x', body:'Hello', rev:'qa', byName:'Sam', key:'directtry1'})}).then(r => r.json().then(j => r.status + ' ' + j.error.code)));
      ok(direct === '409 not_set_up' && !u1().msgs, 'and asking the server directly sends nothing and records nothing');
      await up.fill('#msgBy', 'Sam'); await up.click('#msgHand'); await up.waitForSelector('#msgHandBox:not([hidden])');
      await up.selectOption('#msgHandHow', 'email'); await up.fill('#msgHandNote', 'Sent from the shop mailbox'); await up.locator('#msgHandBox').getByRole('button', {name:'Record it as sent by hand'}).click();
      await up.waitForSelector('#msgHandDone', {timeout:8000});
      const hm = Object.values(u1().msgs)[0];
      ok(hm.state === 'manual' && hm.channel === 'email' && hm.to === 'quote@example.com' && hm.byName === 'Sam' && hm.note === 'Sent from the shop mailbox' && !hm.ref && /^Hi Nora,/.test(hm.body), 'a quote a member of staff sent themselves is recorded as sent by hand, under their name, with the words');
      await up.locator('#modal').getByRole('button', {name:'Done'}).click(); await up.waitForFunction(() => document.querySelector('#modal').hidden);
      await up.locator('#sheet').getByRole('button', {name:'Close'}).first().click();
      await up.waitForFunction(() => /Sent by hand/.test(document.querySelector('#quotedSec').innerText) && /Ring them on/.test(document.querySelector('#quotedSec').innerText), null, {timeout:8000});
      ok(/Quotes sent/.test(await up.locator('#quotedSec h2').innerText()), 'and only then does the quote count as sent and start its five days');
      await up.locator('#tabs .tab', {hasText:/Setup|More/}).first().click(); if (!(await up.locator('#msgSetupSec').count())) await up.locator('#view').getByRole('button', {name:'Setup'}).click();
      await up.waitForFunction(() => /^Not set up yet/.test((document.querySelector('#setEmail') || {innerText:''}).innerText), null, {timeout:8000});
      ok(/^Not set up yet/.test(await up.locator('#setSms').innerText()) && /Only the owner can change these/.test(await up.locator('#msgSetupSec').innerText()) && await up.locator('#newMsgTo').count() === 0 && await up.locator('#setTerms').isDisabled(), 'Setup says plainly that email and texts are not set up, and the shop sign-in cannot change who messages go to');
    } finally { app2.close(); fs.rmSync(dir2, {recursive:true, force:true}); }
    console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'browser checks on the hosted server passed: ' + passed);
    if (errors.length) process.exitCode = 1;
  } catch (e){ console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').filter(l => /browser-check/.test(l)).join('\n'), '\n', errors.join(' | ')); process.exitCode = 1; }
  finally { await browser.close(); app.close(); await mailbox.close(); fs.rmSync(dir, {recursive:true, force:true}); }
})();
