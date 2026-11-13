'use strict';
function check(j,now){
 if(j.visitId||j.type!=='Fitting'||j.status!=='open'||!j.diary||!/^\d{4}-\d{2}-\d{2}$/.test(j.date||''))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 const today=parts.year+'-'+parts.month+'-'+parts.day,deadline=new Date(Date.parse(j.date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 const msgs=Object.values(j.msgs||{}).filter(m=>String(m.rev||'').startsWith('fit-slot:')&&m.channel==='sms'&&m.snap?.date===j.date&&m.snap?.slot).sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))),last=msgs.at(-1);
 const sent=!!last&&['sent','delivered'].includes(last.state);
 return {deadline,overdue:!sent&&(today>deadline||(today===deadline&&Number(parts.hour)>=12)),dueToday:today===deadline,sent,state:last?.state||'missing',past:j.date<today,missingPhone:!j.customer?.phone};
}
function shopList(st,now,tests=false){return st.list('jobs','', 'asc',0).flatMap(({id,data:j})=>{const test=require('./fitter-performance').testJob(j)||/^ZZ[ _-]/i.test(id);if(test&&!tests)return [];const d=check(j,now);return d?.overdue?[{id,ref:j.ref||id,customer:j.customer?.name||'Customer',phone:j.customer?.phone||'',fitter:j.fitter||'Unassigned',date:j.date,test,...d}]:[];}).sort((a,b)=>a.date.localeCompare(b.date));}
module.exports={check,shopList};
