'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
const base=()=>({status:'open',type:'Fitting',fitter:'Fitter A',fitterId:'a',customer:{name:'Test customer',phone:'07700900123',address:'Test road',postcode:'G81 1DX'},lines:{floor:{title:'Oak Herringbone Laminate',unit:'packs',qty:5}},rooms:{},pre:{}});
test('inspection diary shows postcode matches, bookings and days off, and enforces the same free slots when saved',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-inspection-calendar-')),st=require('../lib/store').open(dir),doc=require('../lib/store').docPath,u={id:'a',name:'Fitter A',role:'fitter'},api=require('../lib/herringbone-inspections')({st,L,allowed:(j,u)=>j.fitterId===u.id,now:()=>Date.parse('2026-11-14T08:00:00Z'),broadcast:()=>{}});
 try{st.setDoc(doc('jobs/test'),base());st.setDoc(doc('jobs/near'),{...base(),diary:true,date:'2026-11-16',fitterWork:{slot:'8-10am',duration:60}});st.setDoc(doc('jobs/unknown'),{...base(),diary:true,date:'2026-11-17'});st.setDoc(doc('timeoff/a'),{name:'Fitter A',days:{'2026-11-18':{off:true}}});const b={jobId:'test',action:'calendar',duration:60},cal=api.save(b,u),day=d=>cal.days.find(x=>x.date===d);
 assert.equal(cal.area,'G81');assert.equal(day('2026-11-16').sameArea,true);assert.equal(day('2026-11-16').jobs[0].name,'Test customer');assert.ok(day('2026-11-16').slots.includes('1-3pm'));assert.ok(!day('2026-11-16').slots.includes('10am-12pm'));assert.equal(day('2026-11-17').slots.length,0);assert.equal(day('2026-11-18').off,true);assert.equal(day('2026-11-18').slots.length,0);assert.equal(api.save({...b,postcode:'G82 1AA'},u).days.find(x=>x.date==='2026-11-16').sameArea,false);assert.throws(()=>api.save({...b,postcode:'bad'},u),e=>e.status===400);assert.throws(()=>api.save(b,{...u,id:'other'}),e=>e.status===403);
 const book={jobId:'test',version:api.list(u).find(x=>x.id==='test').version,action:'book',date:'2026-11-16',slot:'10am-12pm',duration:60,agreed:true};assert.throws(()=>api.save(book,u),e=>e.status===409);api.save({...book,slot:'1-3pm',postcode:'G81 1DX'},u);assert.equal(api.list(u).find(x=>x.id==='test').visit.duration,60);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('inspection preparation flows to one revised quote and fitter instructions without booking or stock changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-prep-flow-')),st=require('../lib/store').open(dir),doc=require('../lib/store').docPath,u={id:'a',name:'Fitter A',role:'fitter'},shop={id:'owner',name:'Shop',role:'owner'};
 const api=require('../lib/herringbone-inspections')({st,L,allowed:(j,u)=>u.role==='owner'||j.fitterId===u.id,now:()=>Date.parse('2026-11-14T08:00:00Z'),broadcast:()=>{}}),get=()=>st.getDoc('jobs/test').data,body=()=>({jobId:'test',version:api.list(u)[0].version});
 try{const j=base();j.quotes={q1:{n:1,at:'2026-11-13T08:00:00Z',lines:[{key:'flooring',label:'Flooring',price:372.16},{key:'fitting',label:'Fitting',price:440}],total:812.16,areas:[{name:'Living room',total:812.16,lines:[]}],rates:{prepPlywood:14}}};st.setDoc(doc('jobs/test'),j);
 api.save({...body(),action:'book',date:'2026-11-14',slot:'11am-1pm',agreed:true},u);const visitId=api.list(u)[0].visit.k;
 const result={...body(),action:'result',visitId,outcome:'prep',note:'TEST ONLY: Living room requires plywood before installation.',preparation:{method:'plywood',area:20}};
 assert.throws(()=>api.save({...result,preparation:{method:'plywood',area:-1}},u),e=>e.status===400);api.save(result,u);assert.equal(get().review.on,true);assert.equal(get().preparationRequired.area,20);
 assert.throws(()=>api.save({...body(),action:'price'},u),e=>e.status===403);api.save({...body(),action:'price'},shop);
 const priced=get(),q=L.quoteOf(priced);assert.equal(q.total,1092.16);assert.equal(q.lines.filter(l=>l.key==='prep').length,1);assert.equal(q.lines.find(l=>l.key==='prep').price,280);assert.equal(L.round2(q.areas.reduce((s,a)=>s+a.total,0)),1092.16);assert.equal(L.quoteParts(q).shopTotal,652.16);assert.equal(L.quoteParts(q).fitTotal,440);
 assert.equal(api.save({...body(),action:'price'},shop).duplicate,true);assert.equal(L.quotesOf(get()).length,2);assert.deepEqual(priced.lines,j.lines);assert.equal(priced.diary,undefined);assert.equal(L.herringboneInspection(priced).blocked,true);
 const details=require('../lib/fitter-details').details(priced,L);assert.equal(details.preparation.amount,280);assert.equal(details.preparation.agreed,false);assert.match(details.visits[0].sub.condition,/requires plywood/);
 const html=require('../lib/quote-email').html({job:priced,q,L});assert.match(html,/Plywood floor preparation/);assert.match(html,/£280.00/);assert.match(html,/already includes/);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
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
