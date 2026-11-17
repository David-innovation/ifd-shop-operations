'use strict';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>{throw {status,code:'goods_in',message};};
const fields=`id title sku product{id title productType coverage:metafield(namespace:"custom",key:"coverage_per_pack"){value}} rollWidth:metafield(namespace:"custom",key:"roll_width_m"){value} rollNumber:metafield(namespace:"custom",key:"roll_number"){value} inventoryItem{id tracked inventoryLevels(first:50){nodes{location{id name} quantities(names:["available","on_hand"]){name quantity}}}}`;
const SEARCH=`query GoodsInSearch($q:String!,$after:String){productVariants(first:50,after:$after,query:$q){pageInfo{hasNextPage endCursor} nodes{${fields}}}}`;
const ONE=`query GoodsInVariant($id:ID!){productVariant(id:$id){${fields}}}`;
const mutation=id=>`mutation GoodsInReceive($input:InventoryAdjustQuantitiesInput!){inventoryAdjustQuantities(input:$input) @idempotent(key:"goods-${id}"){inventoryAdjustmentGroup{id} userErrors{field message code}}}`;
function make({st,shop,now,broadcast}){
 const db=st.db,stamp=()=>new Date(now()).toISOString();
 db.exec('CREATE TABLE IF NOT EXISTS goods_receipts(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS goods_costs(variant TEXT PRIMARY KEY,json TEXT NOT NULL);');
 const get=id=>{const r=db.prepare('SELECT json FROM goods_receipts WHERE id=?').get(id);return r?JSON.parse(r.json):null;};
 const save=r=>db.prepare('UPDATE goods_receipts SET json=? WHERE id=?').run(JSON.stringify(r),r.id);
 // A process restart cannot safely assume an in-flight remote write failed.
 for(const row of db.prepare('SELECT json FROM goods_receipts').all()){const r=JSON.parse(row.json);if(r.state==='sending'){r.state='uncertain';r.error='Office must check Shopify stock history before resolving this receipt.';save(r);}}
 const office=u=>['owner','shop'].includes(u?.role),access=u=>{if(!office(u)&&u?.role!=='warehouse')fail(403,'Warehouse access is required.');};
 const cost=id=>{const r=db.prepare('SELECT json FROM goods_costs WHERE variant=?').get(id);return r?JSON.parse(r.json):null;};
 async function gql(q,v){const r=await shop.graphql(q,v);if(r.errors?.length)throw Error(r.errors.map(x=>x.message).join('; '));return r.data;}
 function product(v){if(!v)return null;const width=Number(v.rollWidth?.value)||0,roll=width>0||v.product.productType==='Carpet roll',coverage=Number(v.product.coverage?.value)||0;return {id:v.id,title:v.product.title+(v.title==='Default Title'?'':' — '+v.title),sku:v.sku||'',unit:roll?'roll':coverage>0?'packs':'items',width,rollNumber:v.rollNumber?.value||'',coverage,tracked:!!v.inventoryItem?.tracked,itemId:v.inventoryItem?.id,locations:(v.inventoryItem?.inventoryLevels?.nodes||[]).map(l=>({id:l.location.id,name:l.location.name,...Object.fromEntries(l.quantities.map(q=>[q.name,q.quantity]))}))};}
 async function find(u,q,after){access(u);const r=await gql(SEARCH,{q:String(q||'').slice(0,150),after:after||null});return {products:r.productVariants.nodes.map(product),...r.productVariants.pageInfo};}
 async function one(id){if(!/^gid:\/\/(?:shopify\/ProductVariant\/\d+|floor-pilot\/ProductVariant\/CL-[A-F0-9]{8})$/.test(id||''))fail(400,'Choose a catalogue product.');return product((await gql(ONE,{id})).productVariant);}
 function safe(r){const {unitCost,clearanceCost,costHistory,...rest}=r;return rest;}
 function list(u,includeCosts=false){access(u);return {office:u?.role==='owner',bays:st.getDoc('settings/main').data?.bays||[],receipts:db.prepare('SELECT json FROM goods_receipts ORDER BY rowid DESC LIMIT 100').all().map(x=>{const r=JSON.parse(x.json);return includeCosts&&u?.role==='owner'?{...r,cost:cost(r.variantId)}:safe(r);})};}
 function validate(p,b){
  if(!p?.tracked)fail(400,'This product does not have tracked stock. Ask the office to set it up.');
  const location=p.locations.find(l=>l.id===b.locationId);if(!location)fail(400,'Choose a stock location for this product.');
  const bay=String(b.bay||'').trim().toUpperCase(),bays=st.getDoc('settings/main').data?.bays||[];if(!bay||!bays.includes(bay))fail(400,'Choose a storage bay.');
  const supplier=String(b.supplier||'').trim(),reference=String(b.reference||'').trim(),line=String(b.line||'').trim();if(!supplier||!reference||!line||[supplier,reference,line].some(x=>x.length>120))fail(400,'Enter supplier, delivery reference and delivery-note line number.');
  let qty=Number(b.quantity),length=0,width=p.width,roll=String(b.roll||'').trim();
  if(p.unit==='roll'){length=Number(b.length);if(!(width>0)||Number(b.width)!==width)fail(400,'Roll width must match the chosen catalogue roll.');if(!roll||roll.length>80)fail(400,'Enter the roll number from its label.');if(!(length>0&&length<=1000)||Math.abs(length*10-Math.round(length*10))>0.00001)fail(400,'Enter roll length in metres, to the nearest 10 cm.');qty=Math.round(length*10);if(p.rollNumber&&p.rollNumber!==roll)fail(400,'The roll number must match the catalogue roll. Ask the office to add the new roll first.');}
  else if(!Number.isInteger(qty)||qty<=0||qty>100000)fail(400,'Enter a whole number of packs or items.');
  return {variantId:p.id,title:p.title,unit:p.unit,coverage:p.coverage,quantity:qty,length,width,roll,supplier,reference,line,bay,locationId:location.id,locationName:location.name,before:location.available,onHandBefore:location.on_hand,itemId:p.itemId};
 }
 async function receive(u,b){access(u);if(['cost','unitCost','clearanceCost'].some(k=>Object.hasOwn(b,k)))fail(400,'Costs are entered separately by the office.');
  if(!/^[\w-]{8,100}$/.test(b.key||''))fail(400,'Refresh the receiving form.');const prior=get(b.key);if(prior)return {...safe(prior),duplicate:true};
  const p=await one(b.variantId),r=validate(p,b),fingerprint=hash([r.supplier,r.reference,r.line].map(x=>x.toLowerCase()).join('|'));
  const duplicate=db.prepare('SELECT json FROM goods_receipts WHERE fingerprint=?').get(fingerprint);if(duplicate)return {...safe(JSON.parse(duplicate.json)),duplicate:true};
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roll_ends'").get()&&db.prepare('SELECT variant FROM roll_ends WHERE variant=?').get(r.variantId))fail(409,'This is a labelled roll end. A new delivery needs its own catalogue roll record; do not add it to the old piece.');
  // Existing supplier orders must use their own receipt route, which allocates to jobs.
  const match=st.list('deliveries').find(x=>[x.data.ref,x.data.orderRef].some(ref=>ref&&String(ref).toLowerCase()===r.reference.toLowerCase()));if(match)fail(409,'This reference is already on a supplier order. Open it in Deliveries so the stock is allocated to its customer job.');
  if(r.roll&&db.prepare('SELECT json FROM goods_receipts').all().some(x=>{const z=JSON.parse(x.json);return z.variantId===r.variantId&&z.roll===r.roll&&z.state!=='rejected';}))fail(409,'This roll has already been logged. Check the receipt history.');
  Object.assign(r,{id:b.key,state:'sending',at:stamp(),by:u.name,byId:u.id,test:/^ZZ.*TEST/i.test(r.title),fingerprint});
  try{db.prepare('INSERT INTO goods_receipts VALUES(?,?,?)').run(r.id,fingerprint,JSON.stringify(r));}catch(e){const same=db.prepare('SELECT json FROM goods_receipts WHERE fingerprint=?').get(fingerprint),existing=get(r.id)||(same&&JSON.parse(same.json));if(existing)return {...safe(existing),duplicate:true};throw e;}
  try{const data=await gql(mutation(r.id),{input:{name:'available',reason:'received',referenceDocumentUri:'gid://floor-pilot/GoodsReceipt/'+r.id,changes:[{inventoryItemId:r.itemId,locationId:r.locationId,delta:r.quantity,changeFromQuantity:r.before}]}}),out=data.inventoryAdjustQuantities;
   if(out.userErrors?.length){r.state='rejected';r.error=out.userErrors.map(x=>x.message).join('; ');save(r);return safe(r);}
   if(!out.inventoryAdjustmentGroup?.id)throw Error('Stock update returned no confirmation.');r.state='received';r.adjustmentId=out.inventoryAdjustmentGroup.id;r.receivedAt=stamp();save(r);
   const d=require('./store').docPath('bays/'+r.variantId.split('/').pop());st.setDoc(d,{bay:r.bay});st.audit(u.id,'goods received',r.id+' '+r.title+' '+r.quantity+' stock units');broadcast('bays');
  }catch(e){if(r.state!=='received'){r.state='uncertain';r.error='Stock update not confirmed. Do not receive again. Office must check Shopify history. '+(e.message||'');save(r);}}
  return safe(r);
 }
 async function setCost(u,b){if(u?.role!=='owner')fail(403,'Only office staff can edit purchase costs.');const p=await one(b.variantId);if(!p)fail(404,'Product not found.');const amount=Number(b.amount);if(b.amount===''||!Number.isFinite(amount)||amount<0||amount>1000000)fail(400,'Enter a purchase cost excluding VAT.');const basis=p.unit==='roll'?'m²':p.unit==='packs'?'pack':'item';
  if(b.receiptId){const r=get(b.receiptId);if(!r||r.variantId!==p.id)fail(400,'Choose the correct receipt.');if(!String(b.reason||'').trim())fail(400,'Add a reason for the clearance cost.');r.costHistory=[...(r.costHistory||[]),{at:stamp(),by:u.name,previous:r.clearanceCost??null}];r.clearanceCost={amount,basis,reason:String(b.reason).slice(0,500),at:stamp(),by:u.name};save(r);}
  else{const old=cost(p.id);db.prepare('INSERT INTO goods_costs VALUES(?,?) ON CONFLICT(variant) DO UPDATE SET json=excluded.json').run(p.id,JSON.stringify({amount,basis,at:stamp(),by:u.name,history:[...(old?.history||[]),...(old?[{amount:old.amount,at:old.at}]:[])]}));}
  st.audit(u.id,'goods cost recorded',p.id+(b.receiptId?' receipt '+b.receiptId:' standard cost'));return {ok:true};
 }
 async function valuation(u){if(u?.role!=='owner')fail(403,'Stock values are for the office only.');let after=null,rows=[];do{const data=await find(u,'',after);for(const p of data.products){if(/^ZZ.*TEST/i.test(p.title))continue;const onHand=p.locations.reduce((n,l)=>n+Math.max(0,l.on_hand||0),0);if(!onHand)continue;const c=cost(p.id),units=p.unit==='roll'?onHand/10*p.width:onHand;rows.push({...p,onHand,units,cost:c,value:c?Math.round(units*c.amount*100)/100:null});}after=data.hasNextPage?data.endCursor:null;}while(after);return {rows,knownValue:Math.round(rows.reduce((n,r)=>n+(r.value||0),0)*100)/100,missing:rows.filter(r=>r.value===null).length,basis:'Current on-hand stock at standard purchase cost, excluding VAT. Clearance receipt costs are recorded separately and are not a FIFO/accounting valuation.',stocktakeVerified:st.getDoc('stocktake/main').data?.status==='done'};}
 return {find,list,receive,setCost,valuation};
}
module.exports={make,SEARCH,ONE,mutation};