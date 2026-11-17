'use strict';
const crypto=require('node:crypto');
const LOCATIONS='query ClearanceLocations{locations(first:50){nodes{id name isActive}}}';
const CREATE='mutation ClearanceCreate($input:ProductSetInput!){productSet(input:$input,synchronous:true){product{id variants(first:1){nodes{id}}} userErrors{field message}}}';
const FIND='query ClearanceFind($q:String!){products(first:2,query:$q){nodes{id handle variants(first:1){nodes{id}}}}}';
const fail=(status,message)=>{throw {status,code:'clearance',message};};
const money=n=>Math.round(n*100)/100;
function validate(b,bays){
 const out={};for(const k of ['supplier','reference','line','name','colour','locationId','bay']){out[k]=String(b[k]||'').trim();if(!out[k]||out[k].length>150)fail(400,'Complete '+k+'.');}
 if(!bays.includes(out.bay))fail(400,'Choose a storage bay.');
 if(!['carpet','vinyl','laminate','spc','lvt','wood'].includes(b.kind))fail(400,'Choose the product type.');out.kind=b.kind;out.roll=['carpet','vinyl'].includes(b.kind);
 for(const k of ['selling','rrp']){out[k]=Number(b[k]);if(!Number.isFinite(out[k])||out[k]<=0||out[k]>10000)fail(400,'Enter valid selling and comparison prices per m².');out[k]=money(out[k]);}if(out.rrp<out.selling)fail(400,'The comparison price must not be below the selling price.');
 if(out.roll){out.width=Number(b.width);out.length=Number(b.length);if(!(out.width>=0.5&&out.width<=6&&out.length>0&&out.length<=1000)||Math.abs(out.length*10-Math.round(out.length*10))>1e-6)fail(400,'Enter the roll width and length in metres; length must be in 10 cm increments.');out.quantity=Math.round(out.length*10);out.area=money(out.width*out.length);}
 else{out.pallets=Number(b.pallets);out.packsPerPallet=Number(b.packsPerPallet);out.quantity=Number(b.quantity);out.coverage=Number(b.coverage);if(!Number.isInteger(out.pallets)||out.pallets<1||!Number.isInteger(out.packsPerPallet)||out.packsPerPallet<1||!Number.isInteger(out.quantity)||out.quantity<1||out.quantity>100000||!(out.coverage>0&&out.coverage<=100))fail(400,'Enter pallets, packs per pallet, actual whole packs and coverage per pack.');out.area=money(out.quantity*out.coverage);}
 return out;
}
function productInput(r){const b=r.input,meta=(key,value,type='number_decimal')=>({namespace:'custom',key,type,value:String(value)}),types={carpet:'Carpet roll',vinyl:'Vinyl roll',laminate:'Laminate Flooring',spc:'SPC Flooring',lvt:'LVT Flooring',wood:'Engineered Wood'};return {title:b.name+' — '+b.colour+' · '+r.code,handle:r.handle,status:'ACTIVE',productType:types[b.kind],vendor:b.supplier,tags:['Floor Pilot clearance',r.code],metafields:[meta('price_per_pack',JSON.stringify({amount:b.selling,currency_code:'GBP'}),'money'),meta('clearance_rrp_m2',b.rrp),meta('clearance_reference',r.code,'single_line_text_field'),...(!b.roll?[meta('coverage_per_pack',b.coverage)]:[])],productOptions:[{name:'Title',values:[{name:'Default Title'}]}],variants:[{optionValues:[{optionName:'Title',name:'Default Title'}],price:String(money(b.roll?b.selling*b.width/10:b.selling*b.coverage)),inventoryPolicy:'DENY',inventoryItem:{tracked:true,sku:r.code},inventoryQuantities:[{locationId:b.locationId,name:'available',quantity:0}],metafields:b.roll?[meta('roll_width_m',b.width),meta('roll_number',r.code,'single_line_text_field')]:[]}]};}
function make({st,shop,goodsIn,now,broadcast}){
 const db=st.db;db.exec('CREATE TABLE IF NOT EXISTS clearance_intakes(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,json TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT json FROM clearance_intakes ORDER BY rowid DESC').all().map(x=>JSON.parse(x.json)),get=id=>{const x=db.prepare('SELECT json FROM clearance_intakes WHERE id=?').get(id);return x&&JSON.parse(x.json);},save=r=>db.prepare('UPDATE clearance_intakes SET json=? WHERE id=?').run(JSON.stringify(r),r.id);
 for(const r of rows())if(r.state==='creating'){r.state='uncertain';save(r);}
 const access=u=>{if(!['shop','owner'].includes(u?.role))fail(403,'The office sets clearance products and selling prices.');};
 const gql=async(q,v)=>{const r=await shop.graphql(q,v);if(r.errors?.length)throw Error(r.errors.map(e=>e.message).join('; '));return r.data;};
 async function list(u){access(u);return {bays:goodsIn.list(u).bays,locations:(await gql(LOCATIONS,{})).locations.nodes.filter(l=>l.isActive),receipts:rows().slice(0,100)};}
 const busy=new Set();
 async function receive(u,b){access(u);if(!/^[\w-]{8,100}$/.test(b.key||''))fail(400,'Reload the clearance form.');
 const input=validate(b,goodsIn.list(u).bays),fingerprint=crypto.createHash('sha256').update([input.supplier,input.reference,input.line].map(x=>x.toLowerCase()).join('|')).digest('hex');
 let r=get(b.key)||rows().find(r=>r.fingerprint===fingerprint);if(r){if(JSON.stringify(r.input)!==JSON.stringify(input))fail(409,'This delivery line already exists with different details. Open its saved receipt.');if(r.state==='received')return {...r,duplicate:true};if(busy.has(r.id))return {...r,duplicate:true};if(['creating','uncertain'].includes(r.state))fail(409,'Product creation is not confirmed. Ask the office to reconcile this receipt before trying again.');}
 else{if(db.prepare('SELECT id FROM goods_receipts WHERE fingerprint=? OR id=?').get(fingerprint,b.key))fail(409,'This delivery line has already been received. Check Deliveries.');const code='CL-'+crypto.randomBytes(4).toString('hex').toUpperCase();r={id:b.key,fingerprint,code,handle:'floor-pilot-'+code.toLowerCase(),input,state:'ready',at:new Date(now()).toISOString(),by:u.name};db.prepare('INSERT INTO clearance_intakes VALUES(?,?,?)').run(r.id,fingerprint,JSON.stringify(r));}
 busy.add(r.id);try{
 if(!r.variantId){r.state='creating';save(r);try{const d=await gql(CREATE,{input:productInput(r)}),result=d.productSet;if(result.userErrors?.length){r.state='failed';r.error=result.userErrors.map(e=>e.message).join('; ');save(r);fail(400,r.error);}if(!result.product?.variants?.nodes?.[0]?.id)throw Error('No product confirmation');r.productId=result.product.id;r.variantId=result.product.variants.nodes[0].id;r.state='product_created';save(r);}catch(e){if(r.state!=='failed'){r.state='uncertain';r.error='Product creation reply was not confirmed. Do not create it again.';save(r);}throw e;}}
 const receipt=await goodsIn.receive(u,{key:r.id,variantId:r.variantId,...input,roll:r.code});r.receipt=receipt;r.state=receipt.state==='received'?'received':receipt.state;r.error=receipt.error||'';save(r);broadcast('catalogue');return r;
 }finally{busy.delete(r.id);}}
 async function reconcile(u,b){access(u);const r=get(b.id);if(!r)fail(404,'Receipt not found.');if(busy.has(r.id))fail(409,'Still processing.');if(r.variantId)return r;const found=(await gql(FIND,{q:'handle:'+r.handle})).products.nodes.filter(p=>p.handle===r.handle);if(found.length!==1)fail(409,'No unique product confirmation found. Check Shopify before making any further stock changes.');r.productId=found[0].id;r.variantId=found[0].variants.nodes[0].id;r.state='product_created';r.error='';save(r);return r;}
 return {list,receive,reconcile};
}
module.exports={make,validate,productInput,LOCATIONS,CREATE,FIND};
