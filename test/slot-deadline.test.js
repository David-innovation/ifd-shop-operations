'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{check}=require('../lib/slot-deadline');
const job={type:'Fitting',status:'open',diary:true,date:'2026-11-14',customer:{phone:'07497557253'}};
test('noon the calendar day before uses London time, including summer and weekends',()=>{
 assert.equal(check(job,Date.parse('2026-11-13T11:59:59Z')).overdue,false);
 assert.equal(check(job,Date.parse('2026-11-13T12:00:00Z')).overdue,true);
 assert.equal(check(job,Date.parse('2026-11-14T08:00:00Z')).overdue,true);
 assert.equal(check({...job,date:'2026-07-13'},Date.parse('2026-07-12T10:59:59Z')).overdue,false);
 assert.equal(check({...job,date:'2026-07-13'},Date.parse('2026-07-12T11:00:00Z')).overdue,true);
 assert.equal(check({...job,date:'2026-11-16'},Date.parse('2026-11-15T12:00:00Z')).deadline,'2026-11-15');
});
test('only accepted SMS for the current visit clears the warning; pending failed and stale-date messages do not',()=>{
 const m={rev:'fit-slot:2026-11-14:11am-1pm',channel:'sms',state:'sent',at:'2026-11-13T10:00:00Z',snap:{date:job.date,slot:'11am-1pm'}},now=Date.parse('2026-11-13T13:00:00Z');
 for(const state of ['sent','delivered'])assert.equal(check({...job,msgs:{a:{...m,state}}},now).sent,true);
 for(const state of ['queued','unsure','failed','prepared'])assert.equal(check({...job,msgs:{a:{...m,state}}},now).overdue,true);
 assert.equal(check({...job,date:'2026-11-15',msgs:{a:m}},now).sent,false);
 assert.equal(check({...job,msgs:{a:{...m,channel:'email'}}},now).sent,false);
 assert.equal(check({...job,msgs:{a:m,b:{...m,at:'2026-11-13T11:00:00Z',state:'failed'}}},now).sent,false);
 assert.equal(check({...job,status:'done'},now),null);assert.equal(check({...job,diary:false},now),null);assert.equal(check({...job,visitId:'measure'},now),null);
});

test('shop escalation matches fitter deadlines, clears on sending and filters tests',()=>{const {shopList}=require('../lib/slot-deadline'),now=Date.parse('2026-11-13T12:00:00Z'),rows=[{id:'real',data:{...job,ref:'JOB-1',fitter:'Team',customer:{name:'Customer',phone:'123'}}},{id:'test',data:{...job,test:true}}],st={list:()=>rows};assert.equal(shopList(st,now-1).length,0);assert.equal(shopList(st,now).length,1);assert.equal(shopList(st,now,true).length,2);rows[0].data.msgs={a:{rev:'fit-slot:x',channel:'sms',state:'sent',snap:{date:job.date,slot:'11am-1pm'}}};assert.equal(shopList(st,now).length,0);});
