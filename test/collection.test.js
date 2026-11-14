'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{docPath}=require('../lib/store'),{create}=require('../server');
test('collection records cash/card, requires actual payment, sends branded receipt once and preserves history',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collection-')),sent=[];
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test'},log:()=>{},mailer:{ready:true,from:'sales@innovationflooringdirect.com',send:async m=>{sent.push(m);return {ref:'mail-'+sent.length};}},texter:{ready:false},pollMs:3600000});
 try{
  app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['david@example.test']}});
  const make=()=>({ref:'ZZ-COLLECTION',test:true,status:'open',source:'shop',sizeCheck:'none',type:'Collection',customer:{name:'TEST David',email:'david@example.test'},total:120,fitterDue:0,lines:{p:{title:'Test laminate',qty:4,unit:'packs',hold:'stock',state:'allocated',bay:'W1',picked:true,checked:true}},pay:{}});
  const u={id:'shop',name:'Shop',role:'shop'},b={jobId:'c1',key:'collect-test-1',byName:'Tester',amount:120,method:'Card',paymentReceived:true};
  app.store.setDoc(docPath('jobs/c1'),make());
  await assert.rejects(app.commands.run('collection.complete',{...b,method:''},u),e=>e.code==='collection');
  await assert.rejects(app.commands.run('collection.complete',{...b,paymentReceived:false},u),e=>e.code==='collection');
  await assert.rejects(app.commands.run('collection.complete',b,{role:'fitter'}),e=>e.status===403);
  assert.equal(sent.length,0);
  const results=await Promise.all([app.commands.run('collection.complete',b,u),app.commands.run('collection.complete',b,u)]);
  assert.ok(results.some(x=>x.duplicate));await app.commands.poll();await app.commands.poll();
  let j=app.store.getDoc('jobs/c1').data;assert.equal(j.status,'done');assert.equal(Object.keys(j.pay).length,1);assert.equal(Object.values(j.pay)[0].method,'Card');assert.equal(sent.length,1);assert.match(sent[0].text,/Test laminate — 4 packs/);assert.match(sent[0].text,/Card — £120.00/);assert.match(sent[0].html,/Thank you for visiting/);assert.match(sent[0].text,/Google or Facebook/);assert.doesNotMatch(sent[0].html,/Floor Pilot|David Woodcock|fitting warranty/i);
  const cash=make();cash.pay={deposit:{kind:'payment',amount:20,method:'Cash',at:'2026-01-01'}};app.store.setDoc(docPath('jobs/c2'),cash);
  await app.commands.run('collection.complete',{...b,jobId:'c2',key:'collect-test-2',amount:100,method:'Bank transfer'},u);
  j=app.store.getDoc('jobs/c2').data;assert.equal(Object.keys(j.pay).length,2);assert.equal(j.collectionReceipt.paid,120);assert.equal(sent.length,2);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

