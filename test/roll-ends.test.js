'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{open,docPath}=require('../lib/store'),{make}=require('../lib/roll-ends');
test('roll ends retain stock, unique codes, original roll and bay; double clicks reuse code; reservations and mismatches block',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollends-')),st=open(dir);let available=41,hand=41,mutations=0;
 const shop={graphql:async(q,b)=>{if(q.includes('mutation'))mutations++;return {data:{productVariant:{id:b.id,title:'Roll R-TEST',product:{id:'gid://shopify/Product/1',title:'ZZ TEST Carpet'},rollWidth:{value:'4'},rollNumber:{value:'R-TEST'},inventoryItem:{tracked:true,inventoryLevels:{nodes:[{location:{id:'loc',name:'Warehouse'},quantities:[{name:'available',quantity:available},{name:'on_hand',quantity:hand}]}]}}}}};}};
 st.setDoc(docPath('settings/main'),{bays:['A1']});const api=make({st,shop,now:()=>0,broadcast:()=>{}}),u={role:'warehouse',name:'Warehouse',id:'w'},b={variantId:'gid://shopify/ProductVariant/1',length:4.1,bay:'A1'};
 try{
  await assert.rejects(api.create({role:'fitter'},b),e=>e.status===403);
  await assert.rejects(api.create(u,{...b,length:4}),e=>/does not match/.test(e.message));
  hand=45;await assert.rejects(api.create(u,b),e=>/reserved/.test(e.message));hand=41;
  const results=await Promise.all([api.create(u,b),api.create(u,b)]);assert.equal(results[0].code,'RE-000001');assert.equal(results[1].code,'RE-000001');assert.ok(results.some(r=>r.duplicate));assert.equal(mutations,0);assert.equal(available,41);
  assert.equal((await api.list(u)).rows.length,1);assert.equal(st.getDoc('bays/1').data.bay,'A1');assert.equal(results[0].originalRoll,'R-TEST');
  const enriched=api.decorate({data:{nodes:[{id:b.variantId,title:'Original',rollStatus:{value:'Available'}}]}});assert.match(enriched.data.nodes[0].title,/RE-000001/);assert.equal(enriched.data.nodes[0].rollStatus.value,'Remnant');assert.equal(api.query('OpsSearch',{q:'RE-000001 status:active'}).q,'id:1');
  available=0;hand=0;const sold=(await api.list(u)).rows[0];assert.equal(sold.available,0);assert.equal(sold.status,'No free stock');assert.equal(sold.code,'RE-000001');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
