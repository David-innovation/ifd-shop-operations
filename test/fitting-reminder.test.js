'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{create}=require('../server'),{docPath}=require('../lib/store');
test('three-day fitting reminder sends once, preserves UK dates, excludes closed/test jobs and blocks stale retries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-reminder-')),sent=[];let time=Date.parse('2026-11-13T12:00:00Z'),reject=false;
 const app=create({env:{DATA_DIR:dir},now:()=>time,mailer:{ready:true,from:'sales@example.test',send:async m=>{if(reject)throw Error('rejected');sent.push(m);return {ref:'mail'+sent.length};}},log:()=>{},pollMs:3600000});
 const base={status:'open',diary:true,type:'Fitting',date:'2026-11-16',ref:'R1',customer:{name:'Customer',email:'customer@example.test'}};
 try{app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:false}});for(const [id,extra] of [['due',{}],['later',{date:'2026-11-17'}],['closed',{status:'done'}],['cancelled',{status:'cancelled'}],['test',{test:true}],['notbooked',{diary:false}],['missing',{customer:{name:'Missing email'}}]])app.store.setDoc(docPath('jobs/'+id),{...base,...extra});
 await app.commands.poll();assert.equal(sent.length,1);assert.match(sent[0].html,/INNOVATION/);assert.match(sent[0].text,/12 noon the day before/);assert.match(sent[0].text,/we will send you a message/);assert.match(sent[0].text,/Monday, 16 November 2026|Monday 16 November 2026/);await app.commands.poll();assert.equal(sent.length,1);assert.match(app.store.getDoc('jobs/missing').data.fittingReminderIssue,/email address/);
 app.store.updateDoc(docPath('jobs/due'),{date:'2026-11-20'});await app.commands.poll();assert.equal(sent.length,1);time=Date.parse('2026-11-17T12:00:00Z');await app.commands.poll();assert.equal(sent.length,2);
 app.store.setDoc(docPath('jobs/failure'),{...base,date:'2026-11-20'});reject=true;await app.commands.poll();const j=app.store.getDoc('jobs/failure').data,mk=Object.keys(j.msgs)[0];assert.equal(j.msgs[mk].state,'failed');app.store.updateDoc(docPath('jobs/failure'),{date:'2026-11-22'});await assert.rejects(()=>app.commands.run('msg.retry',{jobId:'failure',mk},{id:'owner',name:'Owner',role:'owner'}),e=>e.code==='old_reminder');
 const R=require('../lib/fitting-reminder');assert.equal(R.eligible({...base,date:'2026-07-04'},Date.parse('2026-06-30T23:30:00Z')),true);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('owner-only live reminder fixture uses the scheduler, reschedule is checked, concurrent polls do not duplicate',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-reminder-trial-')),sent=[];const time=Date.parse('2026-11-13T12:00:00Z');
 const app=create({env:{DATA_DIR:dir},now:()=>time,mailer:{ready:true,send:async m=>{await new Promise(r=>setTimeout(r,20));sent.push(m);return {ref:'proof'};}},log:()=>{},pollMs:3600000});
 const trial=require('../lib/reminder-trial'),owner={id:'owner',name:'Owner',mobile:'07497557253',role:'owner'};
 try{app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:false}});
 assert.throws(()=>trial(app.store,{...owner,role:'fitter'},time,'prepare'),e=>e.code==='forbidden');
 trial(app.store,owner,time,'prepare');await app.commands.poll();assert.equal(sent.length,0);
 trial(app.store,owner,time,'move');await app.commands.poll();assert.equal(sent.length,0);
 trial(app.store,owner,time,'due');await Promise.all([app.commands.poll(),app.commands.poll(),app.commands.poll()]);assert.equal(sent.length,1);assert.match(sent[0].text,/16 November 2026/);assert.match(sent[0].text,/additional charge/);
 await app.commands.poll();assert.equal(sent.length,1);const result=trial(app.store,owner,time,'status');assert.equal(result.messages.length,1);assert.equal(result.messages[0].attempts,1);
 trial(app.store,owner,time,'move');await app.commands.poll();assert.equal(sent.length,1);
 trial(app.store,owner,time,'due');await app.commands.poll();assert.equal(sent.length,1);
 trial(app.store,owner,time,'stop');await app.commands.poll();assert.equal(sent.length,1);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
