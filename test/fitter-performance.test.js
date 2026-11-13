'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {open,docPath}=require('../lib/store'),{make}=require('../lib/fitter-performance');
test('ratings isolate identity, exclude test data, count one review per job, rank fairly and send once after month end',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-performance-')),st=open(dir),sent=[];
 let time=Date.parse('2026-11-13T12:00:00Z');const users=[{id:'f1',name:'One',role:'fitter',active:1},{id:'f2',name:'Two',role:'fitter',active:1},{id:'f3',name:'Three',role:'fitter',active:1},{id:'s',name:'Shop',role:'shop',active:1}];
 const p=make({st,users:()=>users,now:()=>time,broadcast:()=>{},mailer:{ready:true,send:async m=>{sent.push(m);return {ref:'mail'+sent.length};}}});
 const add=(id,fitterId,rating,extra={})=>st.setDoc(docPath('jobs/'+id),{ref:id,customer:{name:'Customer'},customerFeedback:{a:{fitterId,fitter:users.find(x=>x.id===fitterId)?.name,rating,at:'2026-11-13T12:00:00Z',comment:fitterId+' private comment'}},...extra});
 try{
  p.start();st.setDoc(docPath('settings/main'),{msgs:{testOnly:false}});
  for(let i=0;i<5;i++){add('one'+i,'f1',i===0?3:5);add('two'+i,'f2',i===0?3:5);}add('three','f3',5);
  add('practice','f1',1,{test:true});add('ZZ-TRIAL','f1',1);add('namedtest','f1',1,{customer:{name:'ZZ TEST customer'}});
  add('wrongid','f2',1,{customerFeedback:{a:{fitterId:'unknown',fitter:'One',rating:1,at:'2026-11-13T12:00:00Z'}}});
  st.updateDoc(docPath('jobs/one0'),{customerFeedback:{b:{fitterId:'f1',rating:3,at:'2026-11-13T13:00:00Z',comment:'f1 updated comment',reviewNote:'SECRET SHOP NOTE'}}});
  let d=p.own(users[0]);assert.equal(d.monthly.count,5);assert.equal(d.monthly.average,4.6);assert.equal(d.position,1);assert.equal(d.tied,true);assert.equal(d.leader,true);assert.equal(d.provisional,true);assert.equal(d.reviews.length,5);assert.doesNotMatch(JSON.stringify(d),/f2 private|SECRET SHOP|customer|fitterId/);
  assert.equal(p.own(users[2]).position,null);assert.equal(p.own({id:'trial_owner',role:'fitter'}).allTime.count,0);
  assert.throws(()=>p.own(users[3]),e=>e.status===403);assert.throws(()=>p.admin(users[0]),e=>e.status===403);assert.throws(()=>p.contact(users[0],{id:'f2',email:'bad@example.com'}),e=>e.status===403);
  p.contact(users[3],{id:'f1',email:'one@example.com'});p.contact(users[3],{id:'f2',email:'two@example.com'});
  await p.poll();assert.equal(sent.length,0);time=Date.parse('2026-12-01T12:00:00Z');await Promise.all([p.poll(),p.poll()]);assert.equal(sent.length,2);await p.poll();assert.equal(sent.length,2);assert.equal(st.list('fitterMessages','', 'asc',0).length,3);assert.match(sent[0].subject,/Joint highest-rated/);assert.match(sent[0].text,/What customers appreciated/);assert.match(sent[0].text,/Feedback to learn from/);assert.doesNotMatch(sent[0].text,/f2 private|SECRET SHOP/);
  assert.equal(p.admin(users[3]).emails.find(m=>m.fitterId==='f3').state,'board_only');
  p.contact(users[3],{id:'f3',email:'three@example.com'});await p.poll();assert.equal(sent.length,3);assert.match(sent[2].subject,/Your monthly/);assert.equal(p.own(users[0],'2026-11').provisional,false);
 }finally{p.stop();st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('ambiguous names deny legacy reviews and failed or uncertain monthly emails never duplicate',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-performance-fail-')),st=open(dir);let calls=0;const people=[{id:'a',name:'Same',role:'fitter',active:1},{id:'b',name:'Same',role:'fitter',active:1}],p=make({st,users:()=>people,now:()=>Date.parse('2026-12-01T12:00:00Z'),broadcast:()=>{},mailer:{ready:true,send:async()=>{calls++;throw new Error('Lost answer');}}});
 try{st.setDoc(docPath('settings/fitterPerformance'),{startMonth:'2026-11',contacts:{a:{email:'a@example.com'}}});st.setDoc(docPath('settings/main'),{msgs:{testOnly:false}});st.setDoc(docPath('jobs/legacy'),{customerFeedback:{a:{fitter:'Same',rating:5,at:'2026-11-01T12:00:00Z'}}});assert.equal(p.own(people[0],'2026-11').monthly.count,0);st.updateDoc(docPath('jobs/legacy'),{customerFeedback:{a:{fitterId:'a'}}});await p.poll();await p.poll();assert.equal(calls,1);assert.equal(p.admin({role:'shop'}).emails[0].state,'failed');}finally{p.stop();st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
