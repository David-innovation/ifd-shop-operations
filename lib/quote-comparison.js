'use strict';
function comparison(job,q,L){
 const groups=q.supply?.groups,choices=job.brief?.choices||[],rows=require('./aw-ranges').list();
 if(!groups?.length||q.supply.problems?.length)return null;
 const items=[];for(const g of groups){const ch=choices.find(c=>c.k===g.choice),r=rows.find(r=>r.id===ch?.internalId),area=Number(g.sq);if(!r?.comparisonPrice||!(area>0))return null;items.push({name:ch.title||r.name,area,rate:r.comparisonPrice});}
 const lines=L.quoteLines(q).filter(l=>l.key==='carpet'||/^carpet$/i.test(l.label||''));
 if(lines.length!==1)return null;const actual=Number(lines[0].price),retail=L.round2(items.reduce((n,i)=>n+i.area*i.rate,0)),saving=L.round2(retail-actual);if(!(actual>0&&saving>0))return null;
 const area=L.round2(items.reduce((n,i)=>n+i.area,0));return {items,area,actual,retail,saving,total:L.quoteParts(q).total,comparisonTotal:L.round2(L.quoteParts(q).total+saving),unitRate:items.every(i=>i.rate===items[0].rate)?items[0].rate:null,ourUnitRate:L.round2(actual/area)};
}
module.exports={comparison};
