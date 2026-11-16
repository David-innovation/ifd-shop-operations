'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../server'),{docPath}=require('../lib/store');
test('estimator entrance isolates roles, diary preparation retains records, and invitations deduplicate',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'est-access-')),codes=[],sent=[];
const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',OWNER_MOBILE:'07700900001'},now:()=>Date.parse('2026-11-16T10:00:00Z'),sendText:async(to,body)=>codes.push({to,body}),texter:{ready:true,send:async(to,body)=>{sent.push({to,body});return{ref:'sms'+sent.length};}},mailer:{ready:false},log:()=>{},pollMs:3600000});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const call=async(p,cookie,b)=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'x-ifd':'1','content-type':'application/json',cookie:cookie||''},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
const login=async(mobile,mode)=>{await call('/api/login/code',null,{mobile,mode});return call('/api/login/verify',null,{mobile,mode,code:/code: (\d{6})/.exec(codes.at(-1).body)[1]});};
try{
 const owner=(await login('07700900001')).cookie;
 let r=await call('/api/estimator-access',owner,{action:'save',name:'Estimator A',mobile:'07700900002'});assert.equal(r.status,200);const id=r.data.id;
 const j={test:true,status:'open',type:'Fitting',customer:{name:'ZZ TEST home',phone:'07700900002',address:'House',postcode:'G81 4LF'},brief:{choices:[{title:'Zenith — trial choice'}],rooms:[]},pre:{v:{kind:'both',who:'Estimator A',status:'booked',date:'2026-11-16'}},lines:{},rooms:{}};
 app.store.setDoc(docPath('jobs/home'),j);app.store.setDoc(docPath('jobs/old'),j);
 r=await call('/api/estimator-access',owner,{action:'prepare',userId:id,jobId:'home',customerName:'David Woodcock',notes:'Measure bedrooms and living room.'});assert.equal(r.status,200);assert.equal(r.data.preview.length,1);assert.equal(app.store.getDoc('jobs/old').data.pre.v.who,'');assert.equal(app.store.getDoc('jobs/home').data.test,true);
 const est=(await login('07700900002','estimator')).cookie;
 for(const p of ['/api/estimator-access','/api/db/list?coll=jobs','/api/users','/api/slot-deadlines','/estimator-access'])assert.equal((await fetch(base+p,{headers:{cookie:est}})).status,403,p);
 r=await call('/api/appointments',est);assert.equal(r.data.jobs.length,1);assert.equal(r.data.jobs[0].name,'David Woodcock');assert.equal(r.data.role,'estimator');assert.deepEqual(r.data.inspections,[]);
 const root=await fetch(base+'/',{headers:{cookie:est}});assert.ok(!(await root.text()).includes('id="newSaleTop"'));
 const n=codes.length;await call('/api/login/code',null,{mobile:'07700900001',mode:'estimator'});assert.equal(codes.length,n);
 const page=await (await fetch(base+'/estimator')).text();assert.match(page,/Estimator sign-in/);
 r=await call('/api/estimator-access',owner,{action:'send',userId:id});assert.equal(r.status,200);await call('/api/estimator-access',owner,{action:'send',userId:id});assert.equal(sent.length,1);assert.match(sent[0].body,/\/estimator/);assert.doesNotMatch(sent[0].body,/trial|practice|ZZ TEST/i);
}finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});