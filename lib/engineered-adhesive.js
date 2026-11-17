'use strict';
function orderNotes(delivery,L,getJob){
 const lines=L.dLines(delivery),seen=new Set(),notes=[];
 for(const line of lines){
  if(!line.jobId||seen.has(line.jobId))continue;
  const job=getJob(line.jobId);if(!job)continue;
  const source=job.lines?.[line.jobLine]||{};
  if(!L.floorKind(line.title||source.title,source.type||'').wood)continue;
  seen.add(line.jobId);
  const area=L.woodRooms(job,{}).area;if(!(area>0))continue;
  if(lines.some(l=>l.jobId===line.jobId&&/glue|adhesive/i.test(l.title||'')))continue;
  const adhesive=Object.values(job.lines||{}).filter(l=>!l.gone&&/glue|adhesive/i.test(l.title||''));
  if(adhesive.some(l=>l.deliveryId&&l.deliveryId!==delivery.id||l.hold==='stock'||['ordered','allocated','received'].includes(l.state)))continue;
  notes.push('Job '+(line.jobRef||job.ref||line.jobId)+': include compatible engineered wood full-spread adhesive covering '+L.fmtM(area)+' m² with the flooring. Confirm the adhesive product, tub coverage, number of tubs and supplier price before dispatch. Tub specification is awaiting the Canopy price list. This is the total job requirement; do not duplicate it across split flooring deliveries.');
 }
 return notes.length?['','ENGINEERED WOOD ADHESIVE — CONFIRM PRODUCT AND TUB QUANTITY',...notes]:[];
}
module.exports={orderNotes};

