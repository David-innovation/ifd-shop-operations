'use strict';
const {docPath}=require('./store');
function make({st,L,cmds,mailer,now,broadcast}){
 const fail=m=>{throw {status:409,code:'retail_balance',message:m};};
 const access=u=>{if(!['owner','shop'].includes(u?.role))throw {status:403,message:'Shop access is required.'};};
 const test=j=>j.test===true||/^ZZ[- ]/i.test(j.ref||'')||/\bZZ[ -]?(TEST|PRACTICE)\b/i.test(j.customer?.name||'');
 function read(id){const d=docPath('jobs/'+String(id));if(!d)fail('Choose a retail job.');const r=st.getDoc(d.path);if(!r.exists)fail('Retail job not found.');return {...r.data,id};}
 function eligible(j){return j.status!=='cancelled'&&(j.accepted||j.invoice||['shop','web'].includes(j.source)||L.paidOf(j)>0);}
 function summary(j){if(!eligible(j))fail('This is an unaccepted quote or cancelled job, not a balance to chase.');return {channel:'retail',id:j.id,number:j.invoice?.number||j.ref||j.id,customer:j.customer?.name||'Customer',email:j.customer?.email||'',total:L.shopTotal(j),paid:L.paidOf(j),balance:L.balanceOf(j),dueDate:j.invoice?.dueDate||'',test:test(j),payments:Object.entries(j.pay||{}).map(([key,p])=>({key,...p})),reminders:j.paymentReminders||{}};}
 const reminder=require('./payment-reminder').make({now,mailer,read,summary,write:(id,patch)=>{st.updateDoc(docPath('jobs/'+id),patch);broadcast('jobs');},allowed:email=>{const cfg=st.getDoc('settings/main').data?.msgs||{};if(cfg.testOnly!==false&&!(cfg.allow||[]).some(s=>String(s).toLowerCase()===email.toLowerCase()))fail('Customer messaging is in test mode.');}});
 function list(u,tests=false){access(u);return st.list('jobs').map(x=>({...x.data,id:x.id})).filter(j=>eligible(j)&&(tests||!test(j))).map(summary).filter(s=>s.balance>0).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));}
 async function action(u,b){access(u);const j=read(b.id);summary(j);if(b.action==='preview')return reminder.inspect(b.id);if(b.action==='send')return reminder.send(b.id,b,u);if(b.action==='resolve')return reminder.resolve(b.id,b,u);if(b.action==='pay')return cmds.run('pay',{jobId:b.id,key:b.key,amount:b.amount,method:b.method,note:b.reference,kind:'payment',byName:u.name||'Shop staff'},u);if(b.action==='void')return cmds.run('pay',{jobId:b.id,payK:b.key,kind:'void',reason:b.reason,byName:u.name||'Shop staff'},u);fail('Choose a payment action.');}
 return {list,action};
}
module.exports={make};
