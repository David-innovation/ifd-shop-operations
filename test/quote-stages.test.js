'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
const base=()=>({status:'open',quotes:{q:{at:'2026-11-13T09:00:00Z',lines:[{label:'Carpet',price:100}]}},msgs:{}}),msg=(at,state='sent',follow=false)=>({kind:'quote',rev:'q',channel:'email',state,at,sentAt:at,subject:(follow?'A friendly follow-up — ':'')+'Your quote'});
test('priced quotes progress through sending, two-day reviews, two follow-ups and call, retaining closed records',()=>{
 const j=base();assert.equal(L.quoteStage(j,'2026-11-13').key,'unsent');
 j.msgs.a=msg('2026-11-13T09:00:00Z','prepared');assert.equal(L.quoteStage(j,'2026-11-20').key,'unsent');
 j.msgs.a=msg('2026-11-13T09:00:00Z');assert.equal(L.quoteStage(j,'2026-11-14').key,'waiting');assert.equal(L.quoteStage(j,'2026-11-15').label,'First email follow-up due');
 j.msgs.b=msg('2026-11-15T09:00:00Z','failed',true);assert.equal(L.quoteStage(j,'2026-11-15').followups,0);
 j.msgs.b=msg('2026-11-15T09:00:00Z','sent',true);assert.equal(L.quoteStage(j,'2026-11-16').key,'waiting');assert.equal(L.quoteStage(j,'2026-11-17').label,'Second email follow-up due');
 j.msgs.c=msg('2026-11-17T09:00:00Z','sent',true);assert.equal(L.quoteStage(j,'2026-11-19').label,'Call customer');
 j.customerAcceptance={rev:'q'};assert.equal(L.quoteStage(j,'2026-11-20').key,'accepted');j.status='cancelled';assert.equal(L.quoteStage(j,'2026-11-20').key,'closed');
});
test('revised quotes do not inherit a previous quote follow-up or acceptance',()=>{const j=base();j.msgs.a=msg('2026-11-13T09:00:00Z');j.customerAcceptance={rev:'q'};j.quotes.next={at:'2026-11-14T09:00:00Z',lines:[{label:'Carpet',price:120}]};assert.equal(L.quoteStage(j,'2026-11-20').key,'unsent');});
test('friendly follow-up keeps the branded quote and acceptance link',()=>{const j=base();j.customer={name:'David'};j.ref='TEST';const html=require('../lib/quote-email').html({job:j,q:L.quoteOf(j),L,body:'A friendly follow-up\nHello',url:'https://example.com/quote/test'});assert.match(html,/chance to look through/);assert.match(html,/ACCEPT MY QUOTE/);assert.match(html,/£100.00/);});

