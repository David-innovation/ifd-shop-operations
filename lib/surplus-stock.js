'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store'),{ONE}=require('./goods-in');
function expected(st,c,purchaseId){
 if(!(c.result.extraUnits>0))return null;
 const key='surplus_'+crypto.createHash('sha256').update(c.orderId+'|'+c.lineKey).digest('hex').slice(0,12),d=st.getDoc('deliveries/'+c.orderId).data,l=d?.lines?.[c.lineKey];if(!l)return null;
 if(d.lines[key]){const old=st.getDoc('surplusLots/'+key).data;if(old&&Math.abs(old.quantity-(c.result.mode==='roll'?Math.round(c.result.extraUnits*10):c.result.extraUnits))>0.001)st.updateDoc(docPath('surplusLots/'+key),{needsReview:true,reason:'Purchase quantity corrected. Reconcile existing receipts and surplus before reuse.'});return key;}
 const code=(c.result.mode==='roll'?'RE-':'PP-')+key.slice(8).toUpperCase(),qty=c.result.mode==='roll'?Math.round(c.result.extraUnits*10):c.result.extraUnits;
 // Never re-add stock already received on an undivided order line.
 const received=Object.values(l.recs||{}).reduce((n,r)=>n+(Number(r.qty)||0),0),required=c.result.mode==='roll'?Math.round(c.result.requiredUnits*10):c.result.requiredUnits;
 const needsReview=received>required||Object.entries(d.lines).some(([id,x])=>id!==c.lineKey&&x.variantId&&x.variantId===l.variantId&&!x.jobId&&!x.gone);
 st.setDoc(docPath('surplusLots/'+key),{orderId:c.orderId,lineKey:key,sourceLine:c.lineKey,code,purchaseId,quantity:qty,unit:c.result.mode==='roll'?'m':'packs',title:l.title,variantId:l.variantId||'',width:Number(c.input.width)||0,coverage:Number(c.input.coverage)||0,needsReview,reason:needsReview?'Delivery already has receipts. Office must reconcile surplus before adding any stock.':''});
 if(!needsReview)st.updateDoc(docPath('deliveries/'+c.orderId),{lines:{[key]:{n:999,title:l.title,orderingName:l.orderingName||l.title,sub:'SURPLUS '+code+' — store separately for future jobs',unit:c.result.mode==='roll'?'m':'packs',qty,variantId:l.variantId||'',w:Number(c.input.width)||0,cov:Number(c.input.coverage)||0,kind:'available',jobId:'',surplusCode:code,purchaseId}}});
 return key;
}
function make({st,shop,L}){
 function rows(){return st.list('surplusLots').map(r=>{const lot={...r.data,id:r.id},d=st.getDoc('deliveries/'+lot.orderId).data,line=d?.lines?.[lot.lineKey],receipts=Object.values(line?.recs||{}).filter(r=>r.applied&&r.shop==='ok'&&r.put&&L.isFinalBay(r.bay)),received=lot.unit==='m'?Math.max(0,...receipts.map(r=>Number(r.qty)||0)):receipts.reduce((n,r)=>n+(Number(r.qty)||0),0);let used=0;for(const job of st.list('jobs'))if(job.data.status!=='cancelled')for(const l of L.linesOf(job.data))if(l.surplusCode===lot.code)used+=Number(l.qty)||0;return {...lot,variantId:line?.variantId||lot.variantId,bays:[...new Set(receipts.map(r=>r.bay))],received,remaining:Math.max(0,Math.min(lot.quantity,received)-used),state:lot.needsReview?'Office review needed':!line?.variantId?'Catalogue mapping required':received<=0?'Awaiting warehouse receipt / put-away':used>=received?'Used / reserved':'Available — checked again against live stock before use'};});}
 async function plan(lines){if(!Array.isArray(lines)||lines.length>200)throw Error('Invalid sale lines.');const lots=rows().filter(r=>!r.needsReview&&r.remaining>0&&r.variantId),byVariant=new Map(),budget=new Map();
  for(const lot of lots){if(!byVariant.has(lot.variantId)){const data=await shop.graphql(ONE,{id:lot.variantId}),v=data.data?.productVariant;if(data.errors?.length||!v?.inventoryItem?.tracked)throw Error('Could not verify leftover stock. Try again before ordering.');const available=(v.inventoryItem.inventoryLevels?.nodes||[]).reduce((n,l)=>n+Number(l.quantities.find(q=>q.name==='available')?.quantity||0),0);byVariant.set(lot.variantId,v);budget.set(lot.variantId,Math.max(0,available));}}
  // The budget is consumed in line order, including existing stock allocations.
  const output=[],used=[];for(const raw of lines){let line={...raw};if(line.kind!=='stock'||!['supplier','stock'].includes(line.source)||!line.variantId){output.push(line);continue;}
   for(const lot of lots.filter(l=>l.variantId===line.variantId&&l.unit===line.unit)){
    const available=Math.min(lot.remaining,budget.get(lot.variantId)||0),required=line.roll?Math.round(Number(line.qty)*10):Number(line.qty);if(!(available>0&&required>0))continue;
    let take=0,cuts=[];
    if(line.roll){if(Number(line.widthM)!==Number(lot.width)||!Array.isArray(line.cuts)||!line.cuts.length)continue;let left=available;for(const cut of line.cuts){const q=Math.ceil(Number(cut.len)*10-1e-9);if(q>0&&q<=left&&(!cut.w||Number(cut.w)===lot.width)){take+=q;left-=q;cuts.push(cut);}}}else if(Number(line.cov)>0&&Number(line.cov)===Number(lot.coverage))take=Math.min(required,Math.floor(available));
    if(!(take>0)||take>required)continue;const qty=line.roll?take/10:take,stock={...line,key:(line.key||'line')+'_'+lot.id,source:'stock',qty:String(qty),surplusCode:lot.code,sub:(line.sub||'')+' · '+lot.code+' · '+lot.bays.join(', '),available:budget.get(lot.variantId),tracked:true};
    if(line.roll){stock.cuts=cuts;stock.price=Math.round(Number(line.price||0)*take/required*100)/100;line.cuts=line.cuts.filter(c=>!cuts.includes(c));line.price=Math.round((Number(line.price||0)-stock.price)*100)/100;}
    output.push(stock);line.qty=String(line.roll?(required-take)/10:required-take);budget.set(lot.variantId,budget.get(lot.variantId)-take);lot.remaining-=take;used.push({code:lot.code,quantity:qty,unit:line.roll?'metres':'packs'});
   }
   if(Number(line.qty)>0){output.push(line);if(line.source==='stock'&&budget.has(line.variantId))budget.set(line.variantId,Math.max(0,budget.get(line.variantId)-(line.roll?Math.ceil(Number(line.qty)*10-1e-9):Number(line.qty))));}
  }return {lines:output,used};
 }
 return {rows,plan};
}
module.exports={expected,make};
