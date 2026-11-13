'use strict';
const {day}=require('./fitting-reminder'),crypto=require('node:crypto');
const prefix='estimate-reminder:';
function visits(j){return Object.entries(j.pre||{}).filter(([,v])=>['measure','both'].includes(v.kind)&&v.status==='booked');}
function trial(j){return j.test===true&&/^ZZ-EST-REMINDER-OWNER-/.test(j.id||'')&&j.estimatorReminderTrial===true&&j.total===0&&Object.keys(j.lines||{}).length===0&&String(j.customer?.email||'').toLowerCase()==='david@innovationflooringdirect.com';}
function eligible(j,visitId,now){
 const v=j.pre?.[visitId];if(j.status!=='open'||!v||!['measure','both'].includes(v.kind)||v.status!=='booked'||(require('./fitter-performance').testJob(j)&&!trial(j)))return false;
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
 return hour>=9&&v.date===new Date(Date.parse(day(now)+'T12:00:00Z')+86400000).toISOString().slice(0,10);
}
function rev(visitId,date){return prefix+crypto.createHash('sha256').update(visitId).digest('hex').slice(0,24)+':'+date;}
function current(j,m,now){return !!m.snap?.visitId&&eligible(j,m.snap.visitId,now)&&m.snap.date===j.pre[m.snap.visitId].date&&m.rev===rev(m.snap.visitId,m.snap.date)&&String(m.to||'').toLowerCase()===String(j.customer?.email||'').trim().toLowerCase();}
function text(j,visitId){const v=j.pre[visitId],date=new Date(v.date+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 return 'Hello '+(j.customer?.name||'there')+',\n\nThank you for choosing Innovation Flooring Direct. A friendly reminder that your estimator visit is booked for tomorrow, '+date+'.\nReference: '+(j.ref||j.id)+'\n\nYour arrival time\nYour estimator will text you an arrival time slot by 12 noon today, if they have not already done so.\n\nReady for your visit\nWe will measure the areas you would like us to quote for and talk through your flooring choices. Please make sure someone is available to let us in and that we can access the rooms to be measured. You do not need to lift your existing flooring for this visit.\n\nIf plans change\nVisits can occasionally take longer than expected. If your arrangements or arrival time change, we will send you a message with the updated details. If you need to rearrange your visit or have any questions, please contact our shop team.\n\nWe look forward to seeing you and helping you choose your new flooring.\nInnovation Flooring Direct\n0141 952 5200\nsales@innovationflooringdirect.com\n2 South Elgin Place, Clydebank G81 1XP';
}
function html(body){return require('./fitting-reminder').html(body,{label:'YOUR ESTIMATOR VISIT',title:'Your new floor starts here.'});}
module.exports={prefix,visits,eligible,rev,current,text,html};
