'use strict';
// Quantities in the legacy `m` unit are tenths of a metre, not metres.
function requests(lines,resolve=()=>({})){
 const groups=new Map();
 for(const l of lines){
  if(l.gone||!['m','metres'].includes(l.unit))continue;
  const source=resolve(l)||{},width=Number(l.w||source.w),length=Number(l.qty)/(l.unit==='m'?10:1);
  if(!(width>0&&length>0))continue;
  const name=String(l.orderingName||l.title||'').trim();
  if(/vinyl|underlay/i.test(name+' '+(source.type||'')))continue;
  const key=JSON.stringify([name,width,l.variantId||source.variantId||'',l.batch||source.batch||'']);
  const g=groups.get(key)||{name,width,length:0};g.length+=length;groups.set(key,g);
 }
 return [...groups.values()].filter(g=>Math.round(g.length*100)>=1000).map(g=>({...g,length:Math.round(g.length*100)/100}));
}
function wording(groups){return groups.length?['','ROLL-BALANCE REQUEST — PLEASE CONFIRM BEFORE SUPPLY',...groups.map(g=>g.name+': minimum usable length '+g.length.toFixed(2)+'m × '+g.width.toFixed(2)+'m wide. Please offer your closest suitable carpet roll balance at roll price.'),'The balance must cover the full required length and width, with the correct colour and matching dye batch. Please confirm the actual balance length, price per m² and total cost. Any extra quantity or cost requires our approval before supply. Do not replace the listed cuts or supply a balance without our confirmation.']:[];}
module.exports={requests,wording};
