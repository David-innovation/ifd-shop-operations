'use strict';
function check(j,now){
 if((j.visitId&&j.pre?.[j.visitId]?.status!=='booked')||j.type!=='Fitting'||j.status!=='open'||!j.diary||!/^\d{4}-\d{2}-\d{2}$/.test(j.date||''))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 const today=parts.year+'-'+parts.month+'-'+parts.day,deadline=new Date(Date.parse(j.date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 const msgs=Object.values(j.msgs||{}).filter(m=>String(m.rev||'').startsWith(j.visitId?'visit-slot:'+encodeURIComponent(j.visitId)+':':'fit-slot:')&&(!j.visitId||m.snap?.visitId===j.visitId)&&m.channel==='sms'&&m.snap?.date===j.date&&m.snap?.slot).sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))),last=msgs.at(-1);
 const sent=!!last&&['sent','delivered'].includes(last.state);
 return {deadline,overdue:!sent&&(today>deadline||(today===deadline&&Number(parts.hour)>=12)),dueToday:today===deadline,sent,state:last?.state||'missing',past:j.date<today,missingPhone:!j.customer?.phone};
}
function shopList(st,now,tests=false){return st.list('jobs','', 'asc',0).flatMap(({id,data:j})=>{const test=require('./fitter-performance').testJob(j)||/^ZZ[ _-]/i.test(id);if(test&&!tests)return [];const visits=Object.entries(j.pre||{}).filter(([k,v])=>['measure','both'].includes(v.kind)&&v.status==='booked').map(([visitId,v])=>({...j,visitId,date:v.date,fitter:v.who,type:'Fitting',diary:true}));return [j,...visits].flatMap(v=>{const d=check(v,now);return d?.overdue?[{id,visitId:v.visitId||'',kind:v.visitId?'Estimator visit':'Fitting',role:v.visitId?'Estimator':'Fitter',ref:j.ref||id,customer:j.customer?.name||'Customer',phone:j.customer?.phone||'',fitter:v.fitter||'Unassigned',date:v.date,test,...d}]:[];});}).sort((a,b)=>a.date.localeCompare(b.date));}
module.exports={check,shopList};
