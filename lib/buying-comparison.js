'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store');
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function calculate(b){
 const n=(k,positive=false)=>{const v=Number(b[k]);if(b[k]===''||b[k]==null||!Number.isFinite(v)||v<0||(positive&&v===0)||v>1000000)throw Error('Enter a valid '+k.replace(/([A-Z])/g,' $1').toLowerCase()+'.');return v;};
 const mode=b.mode;if(!['roll','pallet'].includes(mode))throw Error('Choose roll balance or pallet.');
 const normalRate=n('normalRate',true),bulkRate=n('bulkRate',true),normalDelivery=n('normalDelivery'),bulkDelivery=n('bulkDelivery');
 let requiredArea,boughtArea,extraUnits,requiredUnits,boughtUnits;
 if(mode==='roll'){const width=n('width',true);requiredUnits=n('requiredLength',true);boughtUnits=n('balanceLength',true);requiredArea=requiredUnits*width;boughtArea=boughtUnits*width;}
 else{requiredUnits=n('requiredPacks',true);const packs=n('packsPerPallet',true),pallets=n('pallets',true),coverage=n('coverage',true);if(![requiredUnits,packs,pallets].every(Number.isInteger))throw Error('Packs and pallets must be whole numbers.');boughtUnits=packs*pallets;requiredArea=requiredUnits*coverage;boughtArea=boughtUnits*coverage;}
 if(boughtUnits+1e-8<requiredUnits)throw Error('The offered stock is less than the job requires.');
 extraUnits=money(boughtUnits-requiredUnits);
 const normalCost=money(requiredArea*normalRate+normalDelivery),bulkCost=money(boughtArea*bulkRate+bulkDelivery),saving=money(normalCost-bulkCost),extraArea=money(boughtArea-requiredArea);
 return {mode,requiredUnits,boughtUnits,extraUnits,requiredArea:money(requiredArea),boughtArea:money(boughtArea),extraArea,normalCost,bulkCost,saving,surplusCost:money(extraArea*bulkRate),jobMaterialSaving:money(requiredArea*(normalRate-bulkRate)),normalRate,bulkRate};
}
function fingerprint(d){return crypto.createHash('sha256').update(JSON.stringify([d.supplier,d.lines])).digest('hex');}
function list(st,L){return st.list('deliveries').filter(r=>r.data.status!=='closed').map(r=>{const d=r.data;return {id:r.id,label:(d.orderRef||d.ref||r.id)+' · '+(d.supplier||'Supplier'),fingerprint:fingerprint(d),lines:L.dLines(d).filter(l=>!l.gone&&['m','metres','packs'].includes(l.unit)).map(l=>{const source=st.getDoc('jobs/'+l.jobId).data?.lines?.[l.jobLine]||{},name=l.orderingName||l.title||'',ranges=require('./supplier-ranges').list().filter(x=>new RegExp('\\b'+x.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(name));const range=ranges.length===1?ranges[0]:null;return {key:l.k,name,unit:l.unit,qty:l.qty,width:l.w||source.w||'',coverage:l.cov||source.cov||'',normalRate:range?.cost||'',bulkRate:range?.id==='cormar-zenith'?8.66:'',basis:range?'Supplier sheet — '+range.name:''};})};});}
function make({st,L,now}){return {
 get(){return {orders:list(st,L),saved:st.list('buyingComparisons').map(r=>({...r.data,id:r.id}))};},
 run(b,u){if(u.role!=='owner')throw Error('Shop access required.');const result=calculate(b.input||{});if(!b.save)return {result};
  const d=st.getDoc('deliveries/'+b.orderId).data;if(!d||d.status==='closed')throw Error('Choose an open supplier order to save this comparison.');if(b.fingerprint!==fingerprint(d))throw Error('The order changed. Reload and compare the current quantities.');
  if(!d.lines?.[b.lineKey]||d.lines[b.lineKey].gone)throw Error('Choose the order item.');
  const line=d.lines[b.lineKey],source=st.getDoc('jobs/'+line.jobId).data?.lines?.[line.jobLine]||{},roll=['m','metres'].includes(line.unit),required=Number(line.qty)/(line.unit==='m'?10:1);
  if((roll?'roll':'pallet')!==result.mode||Math.abs(required-result.requiredUnits)>0.00001)throw Error('Required quantity must match the selected order line.');
  if(!roll&&line.unit!=='packs')throw Error('Pallet comparison requires a packs order line.');
  if(roll&&Number(line.w||source.w)&&Number(b.input.width)!==Number(line.w||source.w))throw Error('Roll width must match the order.');
  if(!roll&&Number(line.cov||source.cov)&&Number(b.input.coverage)!==Number(line.cov||source.cov))throw Error('Pack coverage must match the order.');
  const reference=String(b.reference||'').trim();if(!reference)throw Error('Enter the supplier offer reference or note.');
  const key=crypto.randomUUID(),record={orderId:b.orderId,lineKey:b.lineKey,orderLabel:d.orderRef||d.ref||b.orderId,product:d.lines[b.lineKey].orderingName||d.lines[b.lineKey].title,fingerprint:fingerprint(d),input:b.input,result,reference:reference.slice(0,500),at:new Date(now()).toISOString(),by:u.id,byName:u.name||'Shop staff'};
  st.setDoc(docPath('buyingComparisons/'+key),record);st.audit(u.id,'saved supplier buying comparison',b.orderId);return {result,saved:true};
 }
};}
module.exports={calculate,make,fingerprint};