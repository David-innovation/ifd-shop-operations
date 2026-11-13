'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../server'),{docPath}=require('../lib/store'),W=require('../lib/fitter-work');
test('private feedback is saved once per completion, low ratings flag follow-up and all ratings get the same public invitation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-feedback-')),sent=[],clock={t:Date.parse('2026-11-13T12:00:00Z')};
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',PUBLIC_URL:'https://feedback.example.test'},now:()=>clock.t,mailer:{ready:true,from:'sales@example.test',send:async m=>{sent.push(m);return {ref:'mail'+sent.length};}},log:()=>{},pollMs:3600000});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{
  app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['customer@example.test']},words:{reviewUrl:'https://example.test/google',facebookReviewUrl:'https://example.test/facebook'}});
  const j={status:'done',type:'Fitting',test:true,ref:'ZZ FEEDBACK',customer:{name:'TEST',email:'customer@example.test'},fitter:'Test fitter',fitterId:'f1',thankYouRequired:true,customerSignoffs:{complete:{at:'2026-11-13T11:00:00Z',outcome:'clear',signed:true,fitter:'Test fitter'}},fitterWork:{profiles:['carpet'],checks:Object.fromEntries(W.checks(['carpet']).map(c=>[c.id,{state:'done'}]))},pay:{p:{amount:123}},lines:{x:{qty:4}}};
  app.store.setDoc(docPath('jobs/test'),j);await app.commands.poll();assert.equal(sent.length,1);assert.match(sent[0].html,/RATE YOUR FITTER/);
  const route=new URL(sent[0].text.match(/Rate your fitter privately: (https:\/\/\S+)/)[1]).pathname,before=app.store.getDoc('jobs/test').data;
  const page=await fetch(base+route);assert.equal(page.status,200);assert.match(await page.text(),/What went well/);assert.deepEqual(app.store.getDoc('jobs/test').data,before);
  const post=(body,origin=base)=>fetch(base+route,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
  assert.equal((await post('rating=5','https://other.test')).status,403);assert.equal((await post('rating=6')).status,400);
  assert.equal((await post('rating=2&comment=%3Cscript%3Etest%3C%2Fscript%3E&contact=yes')).status,303);assert.equal((await post('rating=5')).status,303);
  let saved=app.store.getDoc('jobs/test').data,r=saved.customerFeedback.complete;assert.equal(r.rating,2);assert.equal(r.needsFollowUp,true);assert.equal(r.month,'2026-11');assert.deepEqual(saved.lines,j.lines);assert.deepEqual(saved.pay,j.pay);
  const thanks=await (await fetch(base+route)).text();assert.match(thanks,/https:\/\/example.test\/google/);assert.match(thanks,/https:\/\/example.test\/facebook/);assert.doesNotMatch(thanks,/<script>/);
  await assert.rejects(()=>app.commands.run('feedback.review',{jobId:'test',event:'complete',note:'Called customer'},{id:'f1',role:'fitter'}),e=>e.status===403);
  await app.commands.run('feedback.review',{jobId:'test',event:'complete',note:'TEST called customer and agreed follow-up'},{id:'s1',role:'shop',name:'Shop staff'});r=app.store.getDoc('jobs/test').data.customerFeedback.complete;assert.equal(r.reviewed,true);assert.equal(r.comment,'<script>test</script>');assert.equal(r.reviewedBy,'Shop staff');
  const feedback=require('../lib/fitter-feedback').make({st:app.store,now:()=>clock.t,broadcast:()=>{},baseUrl:base});
  app.store.setDoc(docPath('jobs/high'),j);const high=feedback.issue({...j,id:'high'},'complete');feedback.submit(new URL(high).pathname.slice(10),{rating:'5',comment:'Great'});const highPage=feedback.page(new URL(high).pathname.slice(10));assert.match(highPage,/https:\/\/example.test\/google/);assert.match(highPage,/https:\/\/example.test\/facebook/);
  app.store.updateDoc(docPath('jobs/test'),{status:'open'});assert.equal((await fetch(base+route)).status,409);clock.t+=91*86400000;assert.equal((await fetch(base+new URL(high).pathname)).status,410);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
