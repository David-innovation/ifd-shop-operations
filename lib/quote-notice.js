'use strict';
const {docPath}=require('./store'),{normaliseMobile}=require('./sms'),crypto=require('node:crypto');
function make({st,L,send,now}){
 let busy=false;
 function enqueue(id,email){if(email.kind!=='quote'||email.channel!=='email')return;const key=crypto.createHash('sha256').update(id+'|'+email.rev).digest('hex').slice(0,24),p=docPath('quoteTextQueue/'+key);if(!st.getDoc(p.path).exists)st.setDoc(p,{jobId:id,rev:email.rev,at:new Date(now()).toISOString(),state:'pending',key});}
 async function poll(){if(busy)return;busy=true;try{for(const row of st.list('quoteTextQueue')){const x=row.data;if(x.state!=='pending')continue;const j=st.getDoc('jobs/'+x.jobId).data,p=docPath('quoteTextQueue/'+row.id);if(!j||j.status!=='open'||j.accepted||j.customerAcceptance||L.quoteOf(j)?.k!==x.rev){st.updateDoc(p,{state:'skipped'});continue;}
 const to=normaliseMobile(j.customer?.phone);if(!to){st.updateDoc(p,{state:'no-mobile'});continue;}
 const rev='quote-notice:'+x.rev;if(L.msgsOf(j).some(m=>m.rev===rev&&m.channel==='sms')){st.updateDoc(p,{state:'recorded'});continue;}
 const first=String(j.customer?.name||'').trim().split(/\s+/)[0].replace(/[^A-Za-z-]/g,'').slice(0,18),body='Hi'+(first?' '+first:'')+', your quote from Innovation Flooring Direct has been emailed. Please check your inbox and junk folder. Thank you!';
 try{await send({jobId:x.jobId,key:'qn_'+x.key,kind:'other',channel:'sms',to,body,rev,byName:'Automatic quote notification'},{id:'system',name:'System',role:'owner'});st.updateDoc(p,{state:'recorded'});}catch(e){st.updateDoc(p,{error:String(e.message||'Notification could not be sent')});}
 }}finally{busy=false;}}
 return {enqueue,poll};
}
module.exports={make};
