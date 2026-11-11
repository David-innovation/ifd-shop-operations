'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
const sync=require('../lib/arrival-sync').patch,merge=require('../lib/store').merge;
test('arrival projection follows accepted messages, failed delay retains earlier time, changed booking clears projection',()=>{
 const job={date:'2026-11-16',fitter:'Lennox',msgs:{a:{channel:'sms',rev:'fit-slot:2026-11-16:8-10',state:'sent',at:'2026-11-11T10:00:00Z',snap:{date:'2026-11-16',fitter:'Lennox',slot:'8-10'}}}};
 merge(job,sync(job));assert.equal(job.arrival.slot,'8-10');assert.equal(job.arrival.messageId,'a');assert.deepEqual(sync(job),{});
 job.msgs.b={...job.msgs.a,at:'2026-11-11T11:00:00Z',state:'failed',snap:{...job.msgs.a.snap,slot:'10-12'}};
 assert.deepEqual(sync(job),{});job.msgs.b.state='delivered';merge(job,sync(job));assert.equal(job.arrival.slot,'10-12');
 job.fitter='Another fitter';merge(job,sync(job));assert.equal(job.arrival.slot,'');
});
test('estimator arrival is isolated from fitting and newer manual confirmation is preserved',()=>{
 const job={date:'2026-11-16',fitter:'Lennox',pre:{v:{date:'2026-11-12',who:'Davy'}},msgs:{a:{channel:'sms',rev:'visit-slot:x',state:'delivered',at:'2026-11-11T10:00:00Z',snap:{visitId:'v',date:'2026-11-12',fitter:'Davy',slot:'8-10'}}}};
 merge(job,sync(job));assert.equal(job.pre.v.arrival.slot,'8-10');assert.equal(job.arrival,undefined);
 job.pre.v.arrival={slot:'1-3',at:'2026-11-11T12:00:00Z'};assert.deepEqual(sync(job),{});
});
test('confirmed underlay upgrade remains two pounds above base and gripper quantities retain lengths',()=>{
 assert.equal(L.priceList({underlay10:5.99,underlay12:6.99}).underlay12,7.99);
 const job={rooms:{r:{name:'Bedroom',len:4,wid:3,spec:{floor:'carpet',gripper:true}}}};
 const q={lines:[{label:'Gripper',price:50,needQty:50,needUnit:'lengths'}]};
 const n=L.quoteNeeds(job,q)[0];assert.equal(n.qty,50);assert.equal(n.unit,'lengths');assert.equal(L.accUnits(50,'lengths',1.52),50);
});
test('four bedrooms and HSL have complete itemised supply plan with straight stairs and separate product prices',()=>{
 const job={brief:{choices:[{k:'c',title:'Test carpet',unit:'m',w:4}]},rooms:{}};
 [[4,3.6],[3.5,3.2],[3,2.8],[3,2.6]].forEach((v,i)=>job.rooms['r'+i]={name:'Bedroom '+(i+1),len:v[0],wid:v[1],want:'c',spec:{floor:'carpet'}});
 job.rooms.h={name:'Hall stairs landing',want:'c',spec:{floor:'carpet'},hsl:{hall:{on:true,len:3,wid:1.2},landing:{on:true,len:2,wid:2},stairs:{on:true,n:12,wid:90,tread:25,riser:20,winders:0}}};
 const plan=L.supplyPlan(job);assert.equal(plan.problems.length,0);assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].cuts.length,7);
 assert.ok(plan.groups[0].cuts.find(c=>/stairs$/.test(c.label)));assert.equal(plan.groups[0].cut,L.round2(plan.groups[0].cuts.reduce((t,c)=>t+c.length,0)));
 const cat=L.catalogue(job,{}, {c:{ppm:12.99}},{});assert.equal(cat.carpet.amount,L.round2(plan.groups[0].sq*12.99));
 job.rooms.h.hsl.stairs.winders=2;assert.ok(L.supplyPlan(job).problems.length);assert.equal(L.catalogue(job,{}, {c:{ppm:12.99}},{}).carpet.amount,0);
 job.rooms.h.cutPlan={signature:L.cutPlanSignature(job,job.rooms.h),byName:'Test estimator',cuts:[{w:4,len:5.2,note:'Reviewed drawing: hall, landing and turning stairs'}]};
 assert.equal(L.supplyPlan(job).problems.length,0);assert.equal(L.supplyPlan(job).groups[0].cuts.at(-1).length,5.2);
 job.rooms.h.hsl.stairs.winders=3;assert.ok(L.supplyPlan(job).problems.length,'changed sizes invalidate the reviewed plan');
});
