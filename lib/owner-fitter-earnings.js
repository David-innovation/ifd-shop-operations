'use strict';
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function report(jobs,L,month=''){
 const people=new Map();
 for(const {id,data:j} of jobs){if(j.test||j.testOnly||j.accepted?.practice||/^ZZ|TEST|PRACTICE/i.test(id)||/\bZZ[- ]?TEST\b/i.test(j.customer?.name||'')||j.status==='cancelled'||j.type!=='Fitting')continue;
  const original=Object.values(j.snagHistory||{}).filter(x=>x.completionRecord?.at).sort((a,b)=>a.completionRecord.at.localeCompare(b.completionRecord.at))[0]?.completionRecord;
  const done=original||(j.status==='done'?j.completionRecord:null),name=done?.fitter||j.fitter;if(!name)continue;
  const date=done?.at||j.date||'',amount=Number(done?.fitterDue??L.fitterDue(j));if(month&&!date.startsWith(month))continue;
  const key=name.trim().toLowerCase(),person=people.get(key)||{id:key,name,completed:0,booked:0,held:0,jobs:[]};
  const incomplete=j.ret==='needed'||Object.values(j.fitterWork?.issues||{}).some(x=>x.state!=='resolved');
  const bucket=done?'completed':incomplete?'held':j.diary?'booked':null;if(!bucket)continue;
  person[bucket]+=amount;person.jobs.push({id,ref:j.ref||id,customer:j.customer?.name||'Customer',date,amount:money(amount),status:done?(original?'Completed — snag return adds no second earning':'Completed — agreed fitting amount'):incomplete?'Incomplete — payment held':'Booked — not earned yet',payment:'Receipt of money not recorded'});people.set(key,person);
 }
 return [...people.values()].map(p=>({...p,completed:money(p.completed),booked:money(p.booked),held:money(p.held)})).sort((a,b)=>a.name.localeCompare(b.name));
}
module.exports={report};