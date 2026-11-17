'use strict';
// Floor Pilot owns these batches. Their identifiers must never be sent to Shopify.
const crypto=require('node:crypto');
const PREFIX='gid://floor-pilot/';
const local=id=>String(id||'').startsWith(PREFIX);
const fail=message=>{throw {status:409,code:'local_stock',message};};
function make({st,remote}){
 const db=st.db;
 db.exec('CREATE TABLE IF NOT EXISTS local_stock(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS local_stock_sales(tag TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS local_stock_changes(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const all=()=>db.prepare('SELECT json FROM local_stock').all().map(r=>JSON.parse(r.json));
 const sales=()=>db.prepare('SELECT json FROM local_stock_sales').all().map(r=>JSON.parse(r.json));
 const get=id=>all().find(r=>[r.id,r.productId,r.itemId].includes(id));
 const save=r=>db.prepare('INSERT INTO local_stock VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(r.id,JSON.stringify(r));
 const saveSale=r=>db.prepare('INSERT INTO local_stock_sales VALUES(?,?) ON CONFLICT(tag) DO UPDATE SET json=excluded.json').run(r.tag,JSON.stringify(r));
 const held=id=>sales().filter(s=>!['released','fulfilled','rejected'].includes(s.state)).reduce((n,s)=>n+(s.items[id]||0),0);
 function figures(r){const reserved=held(r.id);return {on_hand:r.onHand,available:r.onHand-reserved,reserved,committed:0};}
 function product(r){const b=r.input,m=value=>({value:String(value)});return {id:r.productId,title:b.name+' — '+b.colour+' · '+r.code,status:'ACTIVE',productType:{carpet:'Carpet roll',vinyl:'Vinyl roll',laminate:'Laminate Flooring',spc:'SPC Flooring',lvt:'LVT Flooring',wood:'Engineered Wood'}[b.kind],tags:['Floor Pilot clearance',r.code],vendor:b.supplier,supplier:m(b.supplier),actualName:m(b.name+' — '+b.colour),coverage:m(b.coverage||0),ppm:m(JSON.stringify({amount:b.selling,currency_code:'GBP'})),clearanceRrp:m(b.rrp),clearanceRef:m(r.code),fittingMethod:m(b.kind==='lvt'?'glue down':''),variants:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[variant(r,false)]}};}
 function variant(r,withProduct=true){const b=r.input,f=figures(r),m=value=>({value:String(value)});return {id:r.id,title:b.colour,sku:r.code,price:String(Math.round((b.roll?b.selling*b.width/10:b.selling*b.coverage)*100)/100),inventoryQuantity:f.available,inventoryPolicy:'DENY',rollWidth:b.roll?m(b.width):null,rollNumber:b.roll?m(r.code):null,rollLocation:m(b.bay),rollStatus:b.roll?m('Clearance'):null,inventoryItem:{id:r.itemId,tracked:true,inventoryLevels:{nodes:[{location:{id:b.locationId,name:'Floor Pilot warehouse'},quantities:Object.entries(f).map(([name,quantity])=>({name,quantity}))}]}},...(withProduct?{product:product(r)}:{})};}
 function add(r){const id=PREFIX+'ProductVariant/'+r.code;if(get(id))return get(id);const row={id,productId:PREFIX+'Product/'+r.code,itemId:PREFIX+'InventoryItem/'+r.code,code:r.code,input:r.input,onHand:r.input.quantity};save(row);return row;}
 function matches(r,q){const text=[r.code,r.input.name,r.input.colour,r.input.supplier,product(r).productType].join(' ').toLowerCase();let term=String(q||'').toLowerCase();if(/status:(draft|archived)/.test(term))return false;if(/inventory_total:>0/.test(term)&&figures(r).available<=0)return false;const types=[...term.matchAll(/product_type:\s*["']([^"']+)["']/g)].map(x=>x[1]);if(types.length&&!types.some(t=>product(r).productType.toLowerCase().includes(t)))return false;term=term.replace(/\w+:(?:"[^"]*"|'[^']*'|[^\s)]+)/g,' ').replace(/\b(and|or)\b/g,' ').replace(/[()*"']/g,' ');return term.split(/\s+/).filter(Boolean).every(w=>text.includes(w));}
 function syncDraft(d){if(!d?.id)return;for(const s of sales().filter(s=>s.draft?.id===d.id))syncSale(s,d.order);}
 function syncSale(s,o){if(!o||['released','fulfilled','rejected'].includes(s.state))return;if(o.displayFulfillmentStatus==='FULFILLED'){db.exec('BEGIN IMMEDIATE');try{for(const [id,qty] of Object.entries(s.items)){const r=get(id);if(!r||r.onHand<qty)fail('Clearance stock needs office reconciliation.');r.onHand-=qty;save(r);}s.state='fulfilled';s.orderId=o.id;saveSale(s);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}else if(o.cancelledAt){s.state='released';s.orderId=o.id;saveSale(s);}else if(o.id){s.orderId=o.id;saveSale(s);}}
 async function createDraft(query,v){const input=v.input,items={};for(const l of input.lineItems||[])if(local(l.variantId)){const r=get(l.variantId),qty=Number(l.quantity);if(!r||!Number.isInteger(qty)||qty<=0)fail('Invalid clearance stock quantity.');items[r.id]=(items[r.id]||0)+qty;}
  if(!Object.keys(items).length)return remote.graphql(query,v);
  const tag=(input.tags||[]).find(t=>/^ops-/.test(t));if(!tag)fail('A unique sale reference is required.');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');let s=sales().find(s=>s.tag===tag);
  if(s){if(s.fingerprint!==fingerprint)fail('This sale reference was already used with different details.');if(s.draft)return {data:{draftOrderCreate:{draftOrder:s.draft,userErrors:[]}}};fail('This clearance sale is awaiting confirmation. Check its saved sale reference before trying again.');}
  db.exec('BEGIN IMMEDIATE');try{for(const [id,qty] of Object.entries(items))if(figures(get(id)).available<qty)fail('Not enough free clearance stock. Refresh the stock figure.');s={tag,fingerprint,items,state:'sending',at:new Date().toISOString()};saveSale(s);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  const rewritten={...input,lineItems:input.lineItems.map(l=>{if(!local(l.variantId))return l;const r=get(l.variantId),out={title:product(r).title,quantity:l.quantity,requiresShipping:true,originalUnitPriceWithCurrency:l.priceOverride||{amount:Number(variant(r).price),currencyCode:'GBP'},customAttributes:[{key:'Floor Pilot stock',value:r.code}]};if(l.appliedDiscount)out.appliedDiscount=l.appliedDiscount;return out;})};
  try{const response=await remote.graphql(query,{...v,input:rewritten}),out=response.data?.draftOrderCreate;if(out?.userErrors?.length){s.state='rejected';saveSale(s);return response;}if(!out?.draftOrder?.id)throw Error('Sale confirmation missing');s.state='reserved';s.draft=out.draftOrder;saveSale(s);return response;}catch(e){s.state='uncertain';saveSale(s);throw e;}
 }
 function adjust(query,v,set){const changes=set?v.input.quantities:v.input.changes,root=set?'inventorySetQuantities':'inventoryAdjustQuantities',name=v.input.name,key=query.match(/@idempotent\(key:"([^"]+)"\)/)?.[1];if(!key)fail('Stock change needs a unique reference.');if(!['available','on_hand'].includes(name))fail('Use the clearance sale or cancellation to change reserved stock.');const fingerprint=JSON.stringify(v),prior=db.prepare('SELECT json FROM local_stock_changes WHERE id=?').get(key);if(prior){if(JSON.parse(prior.json).fingerprint!==fingerprint)fail('Stock change reference already used.');return JSON.parse(prior.json).response;}
  db.exec('BEGIN IMMEDIATE');try{for(const c of changes){const r=get(c.inventoryItemId);if(!r||c.locationId!==r.input.locationId)fail('Choose the clearance stock location.');const before=figures(r)[name];if(c.changeFromQuantity!==before)fail('Stock has changed. Reload before adjusting.');const after=set?Number(c.quantity):before+Number(c.delta);if(!Number.isInteger(after)||after<0)fail('Stock cannot become negative.');r.onHand=name==='available'?after+held(r.id):after;if(r.onHand<held(r.id))fail('This stock is reserved for a job.');save(r);}const response={data:{[root]:{inventoryAdjustmentGroup:{id:PREFIX+'StockChange/'+key},userErrors:[]}}};db.prepare('INSERT INTO local_stock_changes VALUES(?,?)').run(key,JSON.stringify({fingerprint,response}));db.exec('COMMIT');return response;}catch(e){db.exec('ROLLBACK');throw e;}
 }
 async function graphql(query,v={}){const op=query.match(/(?:query|mutation)\s+(\w+)/)?.[1];
  if(op==='OpsDraftCreate')return createDraft(query,v);
  if(['OpsAdjust','OpsSet','GoodsInReceive'].includes(op)){const changes=v.input?.changes||v.input?.quantities||[];if(changes.some(c=>local(c.inventoryItemId))){if(changes.some(c=>!local(c.inventoryItemId)))fail('Receive local and Shopify stock separately.');return adjust(query,v,op==='OpsSet');}}
  if(['OpsProduct','OpsCatalogueVariants'].includes(op)&&local(v.id)){const r=get(v.id);return {data:{product:r?product(r):null}};}
  if(['GoodsInVariant','OpsEstimatorVariant'].includes(op)&&local(v.id)){const r=get(v.id);return {data:{productVariant:r?variant(r):null}};}
  if(op==='OpsVariants'&&v.ids?.some(local)){const remoteIds=v.ids.filter(id=>!local(id)),result=remoteIds.length?await remote.graphql(query,{...v,ids:remoteIds}):{data:{nodes:[]}};if(result.errors)return result;result.data.nodes=v.ids.map(id=>local(id)?(get(id)?variant(get(id)):null):result.data.nodes.find(n=>n?.id===id));return result;}
  // Any other path carrying an internal identifier is refused, never forwarded.
  if(JSON.stringify(v).includes(PREFIX))fail('This action is not available for Floor Pilot stock.');
  const result=await remote.graphql(query,v);if(result.errors||!result.data)return result;
  if(['OpsCatalogue','OpsSearch','OpsStocked','OpsEstimatorCatalogue'].includes(op)&&!v.after){result.data.products.nodes.unshift(...all().filter(r=>matches(r,v.q||(op==='OpsStocked'?'inventory_total:>0':''))).map(product));}
  if(op==='GoodsInSearch'&&!v.after)result.data.productVariants.nodes.unshift(...all().filter(r=>matches(r,v.q||'')).map(r=>variant(r)));
  if(op==='OpsDraft')syncDraft(result.data.draftOrder);
  if(op==='OpsOrder')for(const s of sales().filter(s=>s.orderId===v.id))syncSale(s,result.data.order);
  if(op==='OpsDraftByTag'){for(const d of result.data.draftOrders?.nodes||[]){const tag=String(v.q||'').replace(/^tag:/,''),s=sales().find(s=>s.tag===tag);if(s&&!s.draft){s.draft=d;s.state='reserved';saveSale(s);}}}
  if(op==='OpsDraftDelete'&&result.data.draftOrderDelete?.deletedId){for(const s of sales().filter(s=>s.draft?.id===result.data.draftOrderDelete.deletedId)){if(s.state!=='fulfilled'){s.state='released';saveSale(s);}}}
  return result;
 }
 return {add,all,get,figures,product,variant,graphql,ready:remote.ready,store:remote.store};
}
module.exports={make,local,PREFIX};
