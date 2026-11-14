const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),store=require('../lib/store'),M=require('../lib/supplier-mail'),L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
test('phone order, ETA changes and partial receipts preserve dates and missing-stock warnings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'supplier-track-')),st=store.open(dir);try{
 const m=M.make({st,L,env:{},now:()=>Date.parse('2026-11-14T12:00:00Z'),broadcast:()=>{}}),u={role:'shop',id:'shop'};
 const j={status:'open',type:'Fitting',date:'2026-11-21',lines:{a:{qty:10,hold:'supplier',state:'ordered',deliveryId:'po',rx:{one:{qty:4}}}}};
 st.setDoc(store.docPath('jobs/job'),j);st.setDoc(store.docPath('deliveries/po'),{supplier:'ZZ TEST',status:'open',lines:{a:{qty:10,jobId:'job',jobLine:'a'}}});
 const b={action:'placed',id:'po',method:'phone',orderedDate:'2026-11-14',byName:'Libby',ref:'TEST-123',expected:'2026-11-18'};
 assert.throws(()=>m.record(b,{role:'fitter'}));assert.throws(()=>m.record({...b,byName:''},u));assert.throws(()=>m.record({...b,ref:''},u));m.record(b,u);
 assert.equal(st.getDoc('deliveries/po').data.orderedByName,'Libby');assert.equal(L.supplierRisk(j,'2026-11-13'),false);assert.equal(L.supplierRisk(j,'2026-11-14'),true);
 assert.throws(()=>m.record({...b,action:'eta',reason:''},u));m.record({...b,action:'eta',reason:'Supplier delay',expected:'2026-11-24'},u);
 const saved=st.getDoc('jobs/job').data;assert.equal(saved.date,'2026-11-21');assert.equal(saved.lines.a.due,'2026-11-24');assert.equal(saved.lines.a.rx.one.qty,4);assert.equal(L.supplierRisk(saved,'2026-11-14'),true);assert.equal(Object.keys(st.getDoc('deliveries/po').data.orderHistory).length,2);
 saved.lines.a.rx.two={qty:6};assert.equal(L.supplierRisk(saved,'2026-11-14'),false);saved.status='cancelled';assert.equal(L.supplierRisk(saved,'2026-11-14'),false);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
