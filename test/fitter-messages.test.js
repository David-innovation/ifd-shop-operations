'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {open}=require('../lib/store'),{make}=require('../lib/fitter-messages');
test('private boards enforce recipient ownership, deduplicate sends and replies, and distinguish reading from acknowledgement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-board-')),st=open(dir),people=[{id:'f1',name:'First',role:'fitter',active:1},{id:'f2',name:'Second',role:'fitter',active:1}],shop={id:'s1',name:'Shop',role:'shop'},owner={id:'o1',name:'Owner',role:'owner'};
 const m=make({st,users:()=>people,now:()=>Date.parse('2026-11-13T12:00:00Z'),broadcast:()=>{}});
 try{const b={fitterId:'f1',subject:'Tomorrow',body:'Please read your job details.',key:'message-test-1'};m.send(shop,b);assert.equal(m.send(shop,b).duplicate,true);let mine=m.own(people[0]).messages;assert.equal(mine.length,1);assert.equal(m.own(people[1]).messages.length,0);assert.throws(()=>m.admin(people[0],'f2'),e=>e.status===403);assert.throws(()=>m.action(people[1],{id:mine[0].id,action:'seen'}),e=>e.status===404);assert.throws(()=>m.send(people[0],b),e=>e.status===403);
 m.action(people[0],{id:mine[0].id,action:'seen'});mine=m.own(people[0]).messages;assert.ok(mine[0].seenAt);assert.equal(mine[0].ackAt,'');m.action(people[0],{id:mine[0].id,action:'ack'});assert.ok(m.own(people[0]).messages[0].ackAt);
 const reply={id:mine[0].id,action:'reply',key:'reply-test-1',body:'Read and understood.'};m.action(people[0],reply);assert.equal(m.action(people[0],reply).duplicate,true);assert.equal(m.admin(shop,'f1').unreadReplies,1);m.review(shop,{id:mine[0].id,key:reply.key});assert.equal(m.admin(shop,'f1').unreadReplies,0);
 assert.throws(()=>m.send(shop,{...b,fitterId:'trial_o1',key:'message-test-2'}),e=>e.status===400);m.send(owner,{...b,fitterId:'trial_o1',key:'message-test-2'});assert.equal(m.own({id:'trial_o1',role:'fitter'}).messages[0].test,true);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
