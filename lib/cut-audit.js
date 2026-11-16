'use strict';
const text=x=>String(x??'').trim();
function pieces(line){return Array.isArray(line.cuts)&&line.cuts.length?line.cuts:[{length:Number(line.qty)/10,width:line.w,room:line.rooms||line.title}];}
function records(line,names,fallback,at,user,bay,signature){return pieces(line).map((c,i)=>{
 const name=text(names?.[i]??fallback);if(!name||name.length>60)throw Object.assign(Error('Enter the cutter’s name for cut '+(i+1)+'.'),{status:400,code:'invalid_argument'});
 return {index:i,label:c.label||'Cut '+(i+1),rooms:c.pieces?.map(p=>p.name).join(', ')||c.note||c.room||line.rooms||'',length:Number(c.length??c.len??Number(line.qty)/10),width:Number(c.width??c.w??line.w)||null,byName:name,at,recordedBy:user.id,recordedByName:user.name||'',bay,planSignature:signature||line.cuttingApproval||null};
});}
function history(job){return Object.entries(job.lines||{}).filter(([,l])=>!l.gone&&l.cutBy).flatMap(([key,l])=>(l.cutRecords?.length?l.cutRecords:pieces(l).map((c,i)=>({index:i,label:c.label||'Cut '+(i+1),rooms:c.room||l.rooms||'',length:c.length??c.len??Number(l.qty)/10,width:c.width??c.w??l.w,byName:l.cutBy,at:l.cutAt,bay:l.bay}))).map(r=>({...r,lineKey:key,product:l.title})));}
module.exports={pieces,records,history};
