'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../server'),{docPath}=require('../lib/store'),template=require('../lib/quote-email');
async function boot(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-quote-')),sent=[],clock={t:Date.parse('2026-11-12T18:00:00Z')};
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',PUBLIC_URL:'https://quotes.example.test'},now:()=>clock.t,mailer:{ready:true,from:'sales@innovationflooringdirect.com',send:async m=>{sent.push(m);return {ref:'test-mail'};}},log:()=>{},pollMs:3600000});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const job={status:'open',type:'Quote',diary:false,ref:'TEST-QUOTE',customer:{name:'David <script> & Test',email:'customer@example.test'},quotes:{q1:{at:'2026-11-12T18:00:00Z',n:1,lines:[{label:'Velvet Dreams carpet',price:1029.60},{label:'Underlay',price:204.56},{label:'Gripper',price:56},{label:'Door bars',price:39.96},{label:'Fitting',price:181.55}]}}};
 app.store.setDoc(docPath('settings/main'),{msgs:{testOnly:true,allow:['customer@example.test']}});app.store.setDoc(docPath('jobs/trial'),job);
 const send=async(key='quote_send_1')=>app.commands.run('msg.send',{jobId:'trial',key,kind:'quote',channel:'email',rev:'q1',subject:'TEST quote',to:'customer@example.test',body:'Hello David\nSubfloor inspection\nOld flooring prevented inspection. Additional preparation must be agreed.\nTo go ahead, reply.',byName:'TEST'},{id:'owner',role:'owner'});
 return {app,sent,clock,base,job,send,get:()=>app.store.getDoc('jobs/trial').data,close(){app.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('branded quote uses saved figures, acceptance GET is read-only, POST is explicit and idempotent without stock/payment/diary mutations',async()=>{
 const s=await boot();try{
  const sent=await s.send();assert.equal(sent.ok,true);const m=s.sent[0];assert.match(m.html,/Your home\. Our expertise/);assert.match(m.html,/£1,330\.12/);assert.match(m.html,/£181\.55/);assert.match(m.html,/£1,511\.67/);assert.match(m.html,/Old flooring prevented inspection/);assert.doesNotMatch(m.html,/<script>/);assert.match(m.html,/ACCEPT MY QUOTE/);
  const link=sent.msg.acceptUrl,route=new URL(link).pathname;assert.match(m.text,new RegExp(route));const before=s.get();
  for(let i=0;i<2;i++){const r=await fetch(s.base+route);assert.equal(r.status,200);assert.match(await r.text(),/CONFIRM ACCEPTANCE/);}assert.deepEqual(s.get(),before,'scanners do not accept');
  assert.equal((await fetch(s.base+route,{method:'POST',headers:{origin:'https://other.test'},body:'confirm=yes'})).status,403);
  assert.equal((await fetch(s.base+route,{method:'POST',headers:{origin:s.base},body:''})).status,400);
  for(let i=0;i<2;i++)assert.equal((await fetch(s.base+route,{method:'POST',headers:{origin:s.base,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303);
  const j=s.get();assert.equal(j.customerAcceptance.total,1511.67);assert.equal(j.customerAcceptance.pending,true);assert.equal(j.diary,false);assert.equal(j.pay,undefined);assert.equal(j.lines,undefined);assert.equal(j.accepted,undefined);assert.equal(Object.keys(j.chase).length,1);assert.equal(s.app.rules.quoteWait(j,'2026-11-12').state,'yes');
  assert.match(await (await fetch(s.base+route)).text(),/Your acceptance has been received/);assert.deepEqual(j.quotes,before.quotes);
  const second=await s.send('quote_send_1');assert.equal(second.duplicate,true);assert.equal(s.sent.length,1);
 }finally{s.close();}
});
test('invalid, expired, revised and cancelled quote links cannot accept; supply-only totals and HTML escape correctly',async()=>{
 const s=await boot();try{
  const sent=await s.send(),route=new URL(sent.msg.acceptUrl).pathname;
  assert.equal((await fetch(s.base+'/quote/not-a-token')).status,404);
  s.app.store.updateDoc(docPath('jobs/trial'),{quotes:{q1:{lines:[{label:'Changed',price:10}]}}});assert.equal((await fetch(s.base+route)).status,409);
  s.app.store.setDoc(docPath('jobs/trial'),s.job);s.clock.t+=31*86400000;assert.equal((await fetch(s.base+route)).status,410);s.clock.t-=31*86400000;
  s.app.store.updateDoc(docPath('jobs/trial'),{status:'cancelled'});assert.equal((await fetch(s.base+route)).status,409);
  const html=template.html({job:{ref:'SAFE',customer:{name:'<script>'}},q:{lines:[{label:'Floor <img>',price:20}]},L:s.app.rules,url:'https://example.test/?a="'});assert.match(html,/&lt;img&gt;/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/Fitting — paid separately/);assert.match(html,/£20.00/);
 }finally{s.close();}
});
test('invoices retain one number, extract inclusive VAT, exclude fitter money and send the branded document without stock changes',async()=>{
 const s=await boot();try{
  const d=docPath('jobs/trial');s.app.store.updateDoc(d,{type:'Fitting',customer:{address:'1 Example Street',postcode:'G81 1DX'},accepted:{q:'q1'},total:1511.67,fitterDue:181.55,pay:{p:{amount:1000,kind:'payment'}}});
  const b={jobId:'trial',supplyDate:'2026-11-12',dueDate:'2026-11-12'},user={id:'owner',role:'owner'};
  const a=await s.app.commands.run('invoice.create',b,user),again=await s.app.commands.run('invoice.create',b,user);assert.equal(a.invoice.number,again.invoice.number);assert.equal(again.duplicate,true);assert.equal(a.invoice.total,1330.12);assert.equal(Math.round((a.invoice.net+a.invoice.vat)*100),133012);assert.equal(a.invoice.company.vat,'450384503');assert.equal(a.invoice.lines.length,4);assert.ok(!a.invoice.lines.some(l=>/fitting/i.test(l.description)));
  const r=await s.app.commands.run('msg.send',{jobId:'trial',kind:'invoice',key:'invoice_test_1',to:'customer@example.test',byName:'Test'},user);assert.equal(r.ok,true);const m=s.sent[0];assert.match(m.html,/YOUR VAT INVOICE/);assert.match(m.html,/£330.12/);assert.match(m.html,/GB450384503/);assert.doesNotMatch(m.html,/ACCEPT MY QUOTE/);assert.match(m.text,/Fitting of £181.55 is excluded/);assert.equal(s.get().diary,false);assert.equal(s.get().lines,undefined);
  s.app.store.updateDoc(d,{quotes:{q1:{lines:[{label:'Changed price',price:10}]}},total:191.55});await assert.rejects(s.app.commands.run('invoice.create',b,user),e=>e.code==='invoice_review');await assert.rejects(s.app.commands.run('msg.send',{jobId:'trial',kind:'invoice',key:'invoice_test_2',to:'customer@example.test',byName:'Test'},user),e=>e.code==='invoice_review');
 }finally{s.close();}
});
