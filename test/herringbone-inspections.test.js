'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
const base=()=>({status:'open',type:'Fitting',fitter:'Fitter A',fitterId:'a',customer:{name:'Test customer',phone:'07700900123',address:'Test road',postcode:'G81 1DX'},lines:{floor:{title:'Oak Herringbone Laminate',unit:'packs',qty:5}},rooms:{},pre:{}});
test('herringbone inspection is mandatory across floor types; only assigned fitter clearance or booked preparation qualifies',()=>{
 for(const title of ['Herringbone laminate','Herringbone engineered wood','Herringbone click SPC','Herringbone glue-down LVT','Herringbone effect laminate']){const j=base();j.lines.floor.title=title;assert.equal(L.herringboneInspection(j).blocked,true,title);assert.ok(L.checksOutstanding(j).some(x=>/Herringbone/.test(x)));}
 const j=base();j.type='Collection';assert.equal(L.herringboneInspection(j).required,false);j.type='Fitting';j.lines.floor.title='Straight laminate';assert.equal(L.herringboneInspection(j).required,false);j.lines.floor.title='Herringbone laminate';
 j.pre.visit={kind:'subfloor',status:'done',who:'Fitter A',whoId:'a',doneAt:'2026-11-14',sub:{outcome:'suitable'},inspectionScope:L.herringboneScope(j)};assert.equal(L.herringboneInspection(j).blocked,false);
 j.fitter='Fitter B';assert.equal(L.herringboneInspection(j).blocked,true);j.fitter='Fitter A';j.customer.address='Different property';assert.equal(L.herringboneInspection(j).blocked,true);j.pre.visit.inspectionScope=L.herringboneScope(j);j.pre.visit.sub.outcome='not_checked';assert.equal(L.herringboneInspection(j).blocked,true);
 j.review={on:false};assert.equal(L.herringboneInspection(j).blocked,true,'Closing a shop review does not pass inspection');
 j.diary=true;j.date='2026-11-16';j.fitterWork={purpose:'preparation'};assert.equal(L.herringboneInspection(j).state,'prep_booked');j.fitterWork.purpose='fitting';assert.equal(L.herringboneInspection(j).blocked,true);
});
test('assigned fitter can arrange and record inspection before installation booking; privacy, conflicts, stale writes and unresolved prep enforced',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-inspection-')),st=require('../lib/store').open(dir),doc=require('../lib/store').docPath,u={id:'a',name:'Fitter A',role:'fitter'},other={id:'b',name:'Fitter B',role:'fitter'};
 const api=require('../lib/herringbone-inspections')({st,L,allowed:(j,u)=>j.fitterId===u.id,now:()=>Date.parse('2026-11-14T08:00:00Z'),broadcast:()=>{}});
 const get=()=>st.getDoc('jobs/test').data,body=()=>({jobId:'test',version:api.list(u)[0].version});
 try{
 st.setDoc(doc('jobs/test'),base());assert.equal(api.list(u).length,1);assert.equal(api.list(other).length,0);assert.throws(()=>api.save({jobId:'test'},other),e=>e.status===403);
 const b={...body(),action:'book',date:'2026-11-14',slot:'11am-1pm',agreed:true};assert.throws(()=>api.save({...b,agreed:false},u),e=>e.status===400);
 st.setDoc(doc('timeoff/a'),{name:u.name,days:{'2026-11-14':{off:true}}});assert.throws(()=>api.save(b,u),e=>e.status===409);st.setDoc(doc('timeoff/a'),{name:u.name,days:{}});
 api.save(b,u);assert.equal(get().diary,undefined);assert.equal(api.list(u)[0].state,'booked');assert.throws(()=>api.save(b,u),e=>e.status===409);
 let v=api.list(u)[0].visit;api.save({...body(),action:'result',visitId:v.k,outcome:'prep',note:'Plywood is required before this floor can be installed.'},u);assert.equal(get().review.on,true);assert.equal(L.herringboneInspection(get()).blocked,true);
 api.save({...body(),action:'book',date:'2026-11-14',slot:'1-3pm',agreed:true},u);v=api.list(u)[0].visit;const result={...body(),action:'result',visitId:v.k,outcome:'suitable',note:'Preparation completed; exposed floor checked and suitable.'};assert.throws(()=>api.save(result,u),e=>e.status===400);api.save({...result,checked:true},u);assert.equal(L.herringboneInspection(get()).blocked,false);assert.equal(get().review.on,true,'Shop review remains until staff check extra work');assert.equal(Object.keys(get().pre).length,2,'Previous inspection retained');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
