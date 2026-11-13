'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{create}=require('../server'),{docPath}=require('../lib/store'),R=require('../lib/estimator-reminder');
const owner={id:'owner',name:'Owner',role:'owner',mobile:'07497557253'};
const base=()=>({status:'open',type:'Quote',ref:'R1',customer:{name:'Customer',email:'customer@example.test'},pre:{measure:{kind:'measure',status:'booked',date:'2026-11-14'}}});
function setup(time='2026-11-13T08:59:59Z'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-est-reminder-')),sent=[];let clock=Date.parse(time),mode='ok';
 const options={env:{DATA_DIR:dir},now:()=>clock,mailer:{ready:true,send:async m=>{await new Promise(r=>setTimeout(r,5));if(mode!=='ok')throw Object.assign(Error('provider '+mode),{unsure:mode==='unsure'});sent.push(m);return {ref:'email'+sent.length};}},log:()=>{},pollMs:3600000};
 let app=create(options);app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:false}});
 return {get app(){return app;},sent,setTime:s=>clock=Date.parse(s),mode:s=>mode=s,restart:()=>{app.close();app=create(options);},cleanup:()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('estimator reminder starts at 9am London day before, once across concurrent polls and restart',async()=>{
 const f=setup();try{f.app.store.setDoc(docPath('jobs/a'),base());await f.app.commands.poll();assert.equal(f.sent.length,0);f.setTime('2026-11-13T09:00:00Z');await Promise.all([f.app.commands.poll(),f.app.commands.poll()]);assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/Saturday, 14 November 2026/);assert.match(f.sent[0].text,/12 noon today/);assert.match(f.sent[0].html,/YOUR ESTIMATOR VISIT/);assert.doesNotMatch(f.sent[0].text,/pay your fitter|moving furniture|additional charge/);await f.app.commands.poll();f.restart();await f.app.commands.poll();assert.equal(f.sent.length,1);
 }finally{f.cleanup();}
});
test('rescheduling before dispatch skips old date and the new date sends once when due',async()=>{
 const f=setup();try{f.app.store.setDoc(docPath('jobs/a'),base());f.app.store.updateDoc(docPath('jobs/a'),{pre:{measure:{date:'2026-11-17'}}});f.setTime('2026-11-13T09:01:00Z');await f.app.commands.poll();assert.equal(f.sent.length,0);f.setTime('2026-11-16T09:00:00Z');await f.app.commands.poll();assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/Tuesday, 17 November 2026/);assert.doesNotMatch(f.sent[0].text,/14 November/);f.app.store.updateDoc(docPath('jobs/a'),{pre:{measure:{date:'2026-11-20'}}});await f.app.commands.poll();f.app.store.updateDoc(docPath('jobs/a'),{pre:{measure:{date:'2026-11-17'}}});await f.app.commands.poll();assert.equal(f.sent.length,1);
 }finally{f.cleanup();}
});
test('failed old-date reminders cannot retry or be sent under a new key; uncertain sends never duplicate',async()=>{
 const f=setup('2026-11-13T09:00:00Z');try{f.app.store.setDoc(docPath('jobs/a'),base());f.mode('failed');await f.app.commands.poll();let j=f.app.store.getDoc('jobs/a').data;const [mk,m]=Object.entries(j.msgs)[0];assert.match(j.estimatorReminderIssue,/failed/);f.app.store.updateDoc(docPath('jobs/a'),{pre:{measure:{date:'2026-11-15'}}});await assert.rejects(()=>f.app.commands.run('msg.retry',{jobId:'a',mk},owner),e=>e.code==='old_reminder');await assert.rejects(()=>f.app.commands.run('msg.send',{...m,jobId:'a',key:'changed-key',byName:'Owner'},owner),e=>e.code==='old_reminder');await f.app.commands.poll();assert.equal(f.app.store.getDoc('jobs/a').data.estimatorReminderIssue,'');
 f.app.store.setDoc(docPath('jobs/b'),base());f.mode('unsure');await f.app.commands.poll();const before=f.app.store.getDoc('jobs/b').data;assert.match(before.estimatorReminderIssue,/uncertain/);await f.app.commands.poll();const after=f.app.store.getDoc('jobs/b').data;assert.equal(Object.keys(after.msgs).length,1);assert.equal(Object.keys(Object.values(after.msgs)[0].tries).length,1);assert.equal(f.sent.length,0);
 }finally{f.cleanup();}
});
test('cancelled/completed visits and jobs, test jobs, wrong visit types and missing email are safe; BST uses local 9am',async()=>{
 const f=setup('2026-11-13T09:00:00Z');try{for(const [id,patch] of [['done',{status:'done'}],['cancelled',{status:'cancelled'}],['test',{test:true}],['visitdone',{pre:{measure:{kind:'measure',status:'done',date:'2026-11-14'}}}],['visitcancel',{pre:{measure:{kind:'measure',status:'cancelled',date:'2026-11-14'}}}],['floorcheck',{pre:{measure:{kind:'subfloor',status:'booked',date:'2026-11-14'}}}],['missing',{customer:{name:'Missing'}}]])f.app.store.setDoc(docPath('jobs/'+id),{...base(),...patch});await f.app.commands.poll();assert.equal(f.sent.length,0);assert.match(f.app.store.getDoc('jobs/missing').data.estimatorReminderIssue,/email address/);
 const j=base();j.pre.measure.date='2026-07-02';assert.equal(R.eligible(j,'measure',Date.parse('2026-07-01T07:59:59Z')),false);assert.equal(R.eligible(j,'measure',Date.parse('2026-07-01T08:00:00Z')),true);assert.equal(R.eligible(j,'measure',Date.parse('2026-07-01T23:00:00Z')),false);
 }finally{f.cleanup();}
});
test('isolated owner estimator trial uses real scheduler rules and cleans up',async()=>{
 const f=setup('2026-11-13T13:00:00Z'),trial=require('../lib/estimator-reminder-trial');try{assert.throws(()=>trial(f.app.store,{...owner,role:'estimator'},Date.parse('2026-11-13T13:00:00Z'),'prepare'),e=>e.code==='forbidden');const go=a=>trial(f.app.store,owner,Date.parse('2026-11-13T13:00:00Z'),a);go('prepare');await f.app.commands.poll();assert.equal(f.sent.length,0);go('move');await f.app.commands.poll();assert.equal(f.sent.length,0);go('due');await f.app.commands.poll();await f.app.commands.poll();assert.equal(f.sent.length,1);assert.equal(go('status').messages[0].attempts,1);go('stop');await f.app.commands.poll();assert.equal(f.sent.length,1);
 }finally{f.cleanup();}
});
