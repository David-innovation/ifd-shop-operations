'use strict';
function comparison(job,q,L){
 const groups=[...(q.supply?.groups||[]).map(g=>({...g,kind:'carpet'})),...(q.packs?.groups||[]).map(g=>({...g,sq:Number(g.packs)*Number(g.cov),kind:'flooring'}))],choices=job.brief?.choices||[],rows=require('./aw-ranges').list();
 if(!groups.length||q.supply?.problems?.length||q.packs?.problems?.length)return null;
 const items=[];for(const g of groups){const ch=choices.find(c=>c.k===g.choice),r=rows.find(r=>r.id===ch?.internalId),area=Number(g.sq),rate=Number(ch?.clearanceRef?ch.clearanceRrp:r?.comparisonPrice);if(!(rate>0&&area>0))return null;items.push({name:ch.title||r.name,area,rate});}
 const lines=L.quoteLines(q).filter(l=>['carpet','flooring'].includes(l.key)||/^(carpet|flooring)$/i.test(l.label||''));
 if(!lines.length||lines.length!==new Set(groups.map(g=>g.kind)).size)return null;const actual=lines.reduce((n,l)=>n+Number(l.price),0),retail=L.round2(items.reduce((n,i)=>n+i.area*i.rate,0)),saving=L.round2(retail-actual);if(!(actual>0&&saving>0))return null;
 const area=L.round2(items.reduce((n,i)=>n+i.area,0));return {items,area,actual,retail,saving,total:L.quoteParts(q).total,comparisonTotal:L.round2(L.quoteParts(q).total+saving),unitRate:items.every(i=>i.rate===items[0].rate)?items[0].rate:null,ourUnitRate:L.round2(actual/area)};
}
module.exports={comparison};
