'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{create}=require('../server'),{docPath}=require('../lib/store');
test('accepted practice quote becomes paid trial warehouse requirements without stock effects and rejects stale chasing',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-trial-')),app=create({env:{DATA_DIR:dir,SESSION_PEPPER:'test'},log:()=>{},pollMs:3600000}),owner={id:'test',name:'TEST OWNER',role:'owner'},seed=require('../lib/fitter-practice');try{
for(const s of ['carpet-detailed','carpet-exact','cutting-plan','approval-trial'])seed(app.store,owner,Date.now(),s);
const id='ZZ-MEASURE-COMBINED-esttrial_test',d=docPath('jobs/'+id),source=app.store.getDoc('jobs/ZZ-FITTER-PRACTICE-test-carpet-detailed').data;app.store.setDoc(d,{...source,test:true});
await app.commands.run('cutting.configure',{jobId:id,widths:[4,5],plain:true,sameBatch:true,pileConfirmed:true},owner);
const p=await app.commands.run('cutting.preview',{jobId:id},owner);await app.commands.run('cutting.approve',{jobId:id,version:p.version,rate:14.99},owner);
const q=app.rules.quoteOf(app.store.getDoc(d.path).data);app.store.updateDoc(d,{customerAcceptance:{rev:q.k}});
await assert.rejects(app.commands.run('msg.prepared',{jobId:id,kind:'quote',rev:q.k,channel:'email',body:'A friendly follow-up',key:'test_chase',to:'test@example.com'},owner),e=>e.code==='followup_stopped');
await assert.rejects(app.commands.run('trial.accept',{jobId:id},{...owner,role:'shop'}),e=>e.status===403);
await app.commands.run('trial.accept',{jobId:id},owner);const j=app.store.getDoc(d.path).data,lines=app.rules.linesOf(j);
assert.equal(j.fitterId,'trial_test');assert.equal(j.pay.trial_materials.amount,app.rules.quoteParts(q).shopTotal);assert.ok(lines.length>1);assert.ok(lines.every(l=>!l.variantId&&l.bay==='TEST-BAY'));assert.equal(j.diary,false);assert.equal((await app.commands.run('trial.accept',{jobId:id},owner)).duplicate,true);
}finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}});
