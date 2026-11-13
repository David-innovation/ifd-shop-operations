'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../server'),{docPath}=require('../lib/store');
test('fitter slot API enforces assignments, fixed wording, dates, test mode and duplicate protection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-slots-')),codes=[],sent=[];
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',OWNER_MOBILE:'07700900001'},now:()=>Date.parse('2026-11-11T12:00:00Z'),sendText:async(to,body)=>codes.push({to,body}),texter:{ready:true,send:async(to,body)=>{sent.push({to,body});return {ref:'SMtest'};},check:async()=>({state:'delivered'})},mailer:{ready:false},log:()=>{},pollMs:3600000});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const call=async(url,cookie,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'x-ifd':'1',cookie:cookie||'','content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const login=async mobile=>{await call('/api/login/code',null,{mobile});const code=/code: (\d{6})/.exec(codes.at(-1).body)[1];const r=await fetch(base+'/api/login/verify',{method:'POST',headers:{'x-ifd':'1','content-type':'application/json'},body:JSON.stringify({mobile,code})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 try{
 app.ensureUser('Lennox','07700900003','fitter');app.ensureUser('Other','07700900004','fitter');
 const user=await login('07700900003'),other=await login('07700900004');
 const j={status:'open',type:'Fitting',diary:true,date:'2026-11-12',fitter:'Lennox',ref:'ZZ-SLOT',customer:{name:'ZZ TEST slot',phone:'07700900555',address:'Test shop'},total:900,fitterDue:200};
 app.store.setDoc(docPath('jobs/slot'),j);app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['07700900555']}});
 assert.equal((await call('/api/appointments')).status,401);
 assert.equal((await call('/api/slot-deadlines',user)).status,403);
 const ownerSession=await login('07700900001');
 assert.equal((await call('/api/slot-deadlines',ownerSession)).data.jobs.length,0);
 assert.equal((await call('/api/slot-deadlines?tests=1',ownerSession)).data.jobs[0].id,'slot');
 assert.equal((await call('/api/appointments',other)).data.jobs.length,0);
 assert.equal((await call('/api/my-ratings')).status,401);
 assert.equal((await call('/api/my-ratings?fitterId=other',user)).data.allTime.count,0);
 assert.equal((await call('/api/fitter-messages/admin',user)).status,403);
 assert.equal((await call('/api/fitter-performance',user)).status,403);
 assert.deepEqual((await call('/api/my-messages?fitterId=other',user)).data.messages,[]);
 const listing=(await call('/api/appointments',user)).data;assert.equal(listing.slots.length,6);assert.equal(listing.jobs.length,1);assert.equal(listing.jobs[0].total,undefined);
 for(const p of listing.jobs[0].previews){assert.ok(p.length<=160);assert.match(p,/STAFF TEST/);assert.doesNotMatch(p,/£|payment|total/i);}
 const body={jobId:'slot',date:j.date,slot:'8-10am',key:'slot_test_123'};
 assert.equal((await call('/api/appointments/send',other,body)).status,403);
 assert.equal((await call('/api/appointments/send',user,{...body,body:'Custom words'})).status,400);
 assert.equal((await call('/api/appointments/send',user,{...body,to:'07700900009'})).status,400);
 assert.equal((await call('/api/appointments/send',user,{...body,slot:'9-5'})).status,400);
 assert.equal((await call('/api/appointments/send',user,{...body,date:'2026-11-13'})).status,409);
 assert.equal((await call('/api/cmd',user,{cmd:'msg.send',...body})).status,403);
 assert.equal((await call('/api/appointments/send',user,{...body,mode:'delay'})).status,409);
 const first=await call('/api/appointments/send',user,body);assert.equal(first.data.state,'sent');assert.equal(sent.length,1);assert.equal(sent[0].to,'+447700900555');assert.match(sent[0].body,/Thu 12 Nov, 8-10am/);
 assert.equal(app.store.getDoc('jobs/slot').data.arrival.slot,'8-10am');
 assert.equal((await call('/api/appointments/send',user,body)).data.duplicate,true);assert.equal(sent.length,1);
 assert.equal((await call('/api/appointments/send',user,{...body,key:'different_key'})).status,409);assert.equal(sent.length,1);
 assert.equal((await call('/api/appointments/send',user,{...body,mode:'delay',key:'delay_same_slot'})).status,409);
 const delay={...body,slot:'1-3pm',mode:'delay',key:'delay_test_123'};
 assert.equal((await call('/api/appointments/send',user,delay)).data.state,'sent');assert.equal(sent.length,2);assert.match(sent[1].body,/Sorry, your fitter is delayed.*1-3pm/);assert.ok(sent[1].body.length<=160);
 assert.equal(app.store.getDoc('jobs/slot').data.arrival.slot,'1-3pm');
 assert.equal((await call('/api/appointments/send',user,delay)).status,409);assert.equal(sent.length,2);
 assert.equal(Object.keys(app.store.getDoc('jobs/slot').data.msgs).length,2);
 app.store.updateDoc(docPath('jobs/slot'),{msgs:{uncertain:{kind:'other',channel:'sms',rev:'fit-slot:2026-11-12:2-4pm',state:'unsure'}}});
 assert.equal((await call('/api/appointments/send',user,{...body,slot:'3-5pm',key:'third_key_123'})).status,409);
 app.store.setDoc(docPath('jobs/blocked'),{...j,customer:{...j.customer,phone:'07700900009'}});
 assert.equal((await call('/api/appointments/send',user,{...body,jobId:'blocked'})).status,403);assert.equal(sent.length,2);
 app.store.setDoc(docPath('jobs/notbooked'),{...j,diary:false});assert.equal((await call('/api/appointments/send',user,{...body,jobId:'notbooked'})).status,409);
 app.ensureUser('Surveyor','07700900006','estimator');app.ensureUser('Another surveyor','07700900007','estimator');
 const estimator=await login('07700900006'),wrongEstimator=await login('07700900007');
 app.store.setDoc(docPath('jobs/visit'),{...j,type:'Quote',diary:false,pre:{one:{kind:'measure',who:'Surveyor',status:'booked',date:j.date},two:{kind:'both',who:'Surveyor',status:'booked',date:j.date},cancelled:{kind:'measure',who:'Surveyor',status:'cancelled',date:j.date},done:{kind:'measure',who:'Surveyor',status:'done',date:j.date}}});
 const visits=(await call('/api/appointments',estimator)).data.jobs;assert.equal(visits.length,2);assert.equal(visits[0].kind,'Estimator visit');assert.equal(visits[0].total,undefined);
 for(const preview of [...visits[0].previews,...visits[0].delayPreviews]){assert.match(preview,/estimator/);assert.doesNotMatch(preview,/fitter/);assert.ok(preview.length<=160);}
 assert.equal((await call('/api/appointments',wrongEstimator)).data.jobs.length,0);
 const vb={...body,jobId:'visit',visitId:'one',key:'visit_send_123'};
 assert.equal((await call('/api/appointments/send',user,vb)).status,403);
 assert.equal((await call('/api/appointments/send',wrongEstimator,vb)).status,403);
 assert.equal((await call('/api/appointments/send',estimator,{...vb,visitId:'missing'})).status,403);
 assert.equal((await call('/api/appointments/send',estimator,{...vb,visitId:'cancelled'})).status,409);
 assert.equal((await call('/api/appointments/send',estimator,{...vb,mode:'delay'})).status,409);
 assert.equal((await call('/api/appointments/send',estimator,vb)).data.state,'sent');assert.match(sent.at(-1).body,/Your estimator will arrive/);
 assert.equal(app.store.getDoc('jobs/visit').data.pre.one.arrival.slot,'8-10am');
 assert.equal((await call('/api/appointments/send',estimator,{...vb,visitId:'two',mode:'delay',slot:'1-3pm',key:'other_visit_delay'})).status,409);
 assert.equal((await call('/api/appointments/send',estimator,{...vb,mode:'delay',slot:'1-3pm',key:'visit_delay_123'})).data.state,'sent');assert.match(sent.at(-1).body,/Sorry, your estimator is delayed/);
 assert.equal((await call('/api/appointments/send',estimator,{...vb,visitId:'two',key:'visit_two_123'})).data.state,'sent');
 assert.equal(Object.keys(app.store.getDoc('jobs/visit').data.msgs).length,3);
 assert.equal((await call('/api/appointments/send',estimator,body)).status,403);
 assert.equal((await call('/api/cmd',estimator,{cmd:'msg.send',...vb})).status,403);
 app.ensureUser('Lennox','07700900005','fitter');assert.equal((await call('/api/appointments',user)).data.jobs.length,0);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('virtual owner fitter trial sees its named test assignment only',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-trial-assignment-')),app=create({env:{DATA_DIR:dir,SESSION_PEPPER:'test'},log:()=>{},pollMs:3600000});
 try{const base={status:'open',type:'Fitting',diary:true,date:'2026-11-23',fitter:'David - fitter trial',customer:{name:'ZZ TEST King Street'},rooms:{},lines:{}};for(const [id,patch]of Object.entries({mine:{},real:{customer:{name:'Real customer'}},other:{fitter:'Other - fitter trial'},explicitOther:{fitterId:'trial_other'}}))app.store.setDoc(docPath('jobs/'+id),{...base,...patch});
 const api=require('../lib/appointments').make({st:app.store,cmds:{status:()=>({testOnly:false})},users:()=>[{id:'owner1',name:'David',role:'owner',active:true}],now:()=>Date.parse('2026-11-12T12:00:00Z'),L:app.rules,broadcast:()=>{}});
 assert.deepEqual(api.list({id:'trial_owner1',name:'David - fitter trial',role:'fitter'}).jobs.map(j=>j.id),['mine']);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
