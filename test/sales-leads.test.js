const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
test('lead follow-ups, duplicate prevention, permissions and conversion preserve customer and enquiry',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leads-')),st=require('../lib/store').open(dir),m=require('../lib/sales-leads').make({st,L,now:()=>Date.parse('2026-11-15T10:00:00Z'),broadcast:()=>{}}),u={id:'shop',name:'Shop',role:'shop'};
 try{
 assert.throws(()=>m.list({role:'fitter'}));
 const b={action:'add',key:'practice_123',by:'Libby',customer:{name:'Practice customer',phone:'07700900001',email:'test@example.test',postcode:'G81 1DX',address:'TEST address'},enquiry:'Three bedrooms, carpet',test:true};
 assert.equal(m.action(u,b).ok,true);assert.equal(m.action(u,b).duplicate,true);assert.equal(m.action(u,{...b,key:'practice_456'}).duplicate,true);assert.equal(m.list(u).rows.length,1);assert.equal(m.list(u).rows[0].needsContact,true);
 assert.throws(()=>m.action(u,{action:'update',id:b.key,version:1,by:'Libby',stage:'waiting',note:'Call again'}));
 m.action(u,{action:'update',id:b.key,version:1,by:'Libby',stage:'waiting',note:'Call tomorrow',nextContact:'2026-11-16'});assert.equal(m.list(u).rows[0].needsContact,false);
 assert.throws(()=>m.action(u,{action:'update',id:b.key,version:1,by:'Declan',stage:'closed',note:'Stale change'}));
 const job={leadId:b.key,ref:'TEST',customer:b.customer,status:'open',diary:false,lines:{},pay:{},total:0,pre:{},rooms:{}};
 m.convert(u,{id:b.key,job});assert.throws(()=>m.convert(u,{id:b.key,job}));const saved=st.getDoc('jobs/lead_'+b.key).data;assert.deepEqual(saved.customer,b.customer);assert.equal(saved.leadEnquiry,b.enquiry);assert.equal(saved.test,true);assert.equal(m.list(u).rows[0].jobId,'lead_'+b.key);assert.equal(m.list(u).rows[0].needsContact,false);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
