'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const L = require('../lib/rules').load(fs.readFileSync(path.join(__dirname, '../app/ifd-shop-operations.html'), 'utf8'));
const sms = require('../lib/sms');

test('booking confirmation changes when goods change, but not when warehouse ticks change', () => {
  const job = {status:'open', type:'Fitting', diary:true, date:'2026-11-20', fitter:'Lennox', total:300, fitterDue:60, customer:{address:'Test shop'}, lines:{a:{title:'Oak floor', variantId:'v1', qty:10, unit:'packs'}, b:{title:'Underlay', qty:1, unit:'roll'}}};
  const snap = L.bookingSnap(job), rev = L.bookingRev(snap);
  for (const patch of [{title:'Different oak'}, {variantId:'v2'}, {qty:11}, {gone:true}]) {
    const changed = structuredClone(job); Object.assign(changed.lines.a, patch);
    assert.ok(L.snapChanges(snap,L.bookingSnap(changed)).includes('the flooring or accessories'));
    assert.notEqual(rev,L.bookingRev(L.bookingSnap(changed)));
  }
  const picked = structuredClone(job); Object.assign(picked.lines.a,{picked:true, checked:true, bay:'A1', state:'cut'});
  assert.equal(rev,L.bookingRev(L.bookingSnap(picked)));
  const reordered = structuredClone(job); reordered.lines.a.n=2; reordered.lines.b.n=1;
  assert.equal(rev,L.bookingRev(L.bookingSnap(reordered)));
});

test('incomplete SMS searches never clear uncertain sends for automatic retry', async () => {
  const now=Date.parse('2026-11-11T12:00:00Z');
  let result;
  const provider=sms.make({TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_FROM:'Innovation'},async()=>({ok:true,json:async()=>result}));
  result={messages:[],next_page_uri:'/another-page'};
  assert.equal((await provider.find('+447700900001','Quote',now,[])).known,false);
  result={messages:[{sid:'SMtest',body:'Quote',direction:'outbound-api',date_created:'invalid'}]};
  assert.equal((await provider.find('+447700900001','Quote',now,[])).known,false);
  result={messages:[{sid:'SMtest',body:'Quote',direction:'outbound-api',date_created:new Date(now).toUTCString(),status:'sent'}],next_page_uri:'/another-page'};
  assert.equal((await provider.find('+447700900001','Quote',now,[])).found.ref,'SMtest');
  result={messages:[]};
  assert.deepEqual(await provider.find('+447700900001','Quote',now,[]),{known:true,found:null});
});
