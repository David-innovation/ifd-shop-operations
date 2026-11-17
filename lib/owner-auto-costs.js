'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store');
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=l=>hash([l.variantId||l.internalId||l.internalKey||l.title,l.unit,l.w||0,l.cov||0]);
function calculate(st,L,j,totals,id){
 const rates=st.getDoc('ownerCostRates/default').data||{},ranges=require('./supplier-ranges').list();
 const table=st.db.prepare("SELECT name FROM sqlite_master WHERE name='goods_costs'").get();
 const lines=L.linesOf(j).filter(l=>!l.gone&&!/travel|fitting|arrangement|delivery|prep|screed|plywood/i.test(l.title||''));
 const items=lines.map(l=>{
  const qty=Number(l.qty),area=l.unit==='m'?qty/10*Number(l.w):l.unit==='packs'?qty*Number(l.cov):['m²','m2','sqm'].includes(l.unit)?qty:NaN;
  const range=ranges.find(r=>r.id===(l.internalId||String(l.internalKey||'').split('|')[0]));
  let c=table&&l.variantId?st.db.prepare('SELECT json FROM goods_costs WHERE variant=?').get(l.variantId):null;
  c=c?JSON.parse(c.json):null;
  const purchases=st.list('buyingPurchases').filter(p=>!p.data.void).map(p=>p.data).filter(p=>{const d=st.getDoc('deliveries/'+p.orderId).data?.lines?.[p.lineKey];return d?.jobId===id&&d?.jobLine===l.k;});
  if(purchases.length===1&&purchases[0].result?.boughtArea>0)c={amount:purchases[0].result.bulkCost/purchases[0].result.boughtArea,basis:'m²',bulk:true};
  const receipts=st.db.prepare("SELECT name FROM sqlite_master WHERE name='goods_receipts'").get();
  if(receipts&&l.variantId){const matches=st.db.prepare('SELECT json FROM goods_receipts').all().map(r=>JSON.parse(r.json)).filter(r=>r.variantId===l.variantId&&r.clearanceCost);if(matches.length===1&&String(l.variantId).startsWith('gid://floor-pilot/'))c=matches[0].clearanceCost;}
  if(l.surplusCode){const lot=st.list('surplusLots').find(r=>r.data.code===l.surplusCode)?.data,p=lot&&!lot.needsReview?st.getDoc('buyingPurchases/'+lot.purchaseId).data:null;c=p&&!p.void&&p.result?.boughtArea>0?{amount:p.result.bulkCost/p.result.boughtArea,basis:'m²',bulk:true}:{amount:NaN,basis:'m²'};}
  const saved=rates.items?.[key(l)];let rate,units,source='Cost pending';
  if(saved){rate=saved.amount;units=saved.basis==='m²'?area:qty;source='Saved purchase cost';}
  else if(c){rate=c.amount;units=c.basis==='m²'?area:c.basis==='pack'&&l.unit==='packs'?qty:c.basis==='item'&&['items','each'].includes(l.unit)?qty:NaN;source=c.bulk?'Confirmed roll/pallet purchase, cost allocated by area':'Saved stock purchase cost';}
  else if(range&&Number.isFinite(range.cost)){rate=range.cost;units=area;source='Supplier price list';}
  const valid=Number.isFinite(rate)&&rate>=0&&Number.isFinite(units)&&units>0&&Number.isFinite(qty)&&qty>0;
  return {key:key(l),name:l.title||'Material',quantity:qty,unit:l.unit,area:Number.isFinite(area)?round(area):null,amount:valid?round(rate*units):null,basis:source,rate:valid?rate:null,units:valid?units:null};
 });
 // A missing accessory/service allocation must not silently become free stock.
 const reconciled=Math.abs(lines.reduce((s,l)=>s+(Number(l.price)||0),0)-totals.materials)<0.02;
 const costs={materials:totals.materials===0&&lines.length===0?0:items.length&&reconciled&&items.every(x=>x.amount!==null)?round(items.reduce((s,l)=>s+l.amount,0)):null,prep:totals.prep===0?0:null,arrangement:0,delivery:totals.delivery===0?0:rates.delivery??null,travel:!totals.travel?0:rates.travel??null};
 const q=L.quoteOf(j),prep=q?.preparation||j.preparationRequired;
 if(totals.prep>0&&prep){const method=String(prep.method||'').toLowerCase(),r=/ply/.test(method)?rates.plywood:/screed/.test(method)?rates.screed:null;if(r&&Number(prep.area)>0)costs.prep=round(Number(prep.area)*(r.material+r.labour));}
 return {costs,items,reconciled,complete:Object.values(costs).every(x=>x!==null),fingerprint:hash([j.total,j.fitterDue,q,lines.map(l=>[l.k,l.variantId,l.internalId,l.internalKey,l.qty,l.unit,l.w,l.cov,l.price]),prep])};
}
function resolve(st,L,j,id,totals,now){
 const result=calculate(st,L,j,totals,id),old=st.getDoc('ownerAutoCosts/'+id).data;
 if(old){if(old.fingerprint===result.fingerprint)return {...old,frozen:true};return {...result,complete:false,changed:true};}
 if(result.complete&&Math.abs(Object.values(totals).reduce((a,b)=>a+b,0)-L.shopTotal(j))<0.01&&(j.status==='done'||j.collectionReceipt)&&!L.payList(j).some(p=>!p.void&&p.kind==='refund'))st.setDoc(docPath('ownerAutoCosts/'+id),{...result,at:new Date(now()).toISOString()});
 return result;
}
module.exports={calculate,resolve,key};

