'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store'),template=require('./quote-email');
const digest=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function make({st,L,now,broadcast,baseUrl}){
 function issue(job,q){
  if(!q||q.k!==L.quoteOf(job)?.k)throw {status:409,code:'old_quote',message:'Use the latest saved quote.'};
  const token=crypto.randomBytes(32).toString('base64url');
  st.setDoc(docPath('quoteLinks/'+digest(token)),{jobId:job.id,rev:q.k,signature:digest(q),expires:now()+30*86400000});
  return baseUrl.replace(/\/$/,'')+'/quote/'+token;
 }
 function read(token){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw {status:404,message:'This quote link is not available. Please contact the shop.'};
  const link=st.getDoc('quoteLinks/'+digest(token)).data,job=link&&st.getDoc('jobs/'+link.jobId).data;
  if(!job||link.expires<now())throw {status:410,message:'This quote link has expired. Please ask the shop for a new quote email.'};
  const q=L.quoteOf(job);
  if(job.status!=='open'||!q||q.k!==link.rev||digest(q)!==link.signature)throw {status:409,message:'This quote has been updated or is no longer available. Please contact the shop for the latest version.'};
  if(L.roomsOf(job).some(r=>r.spec?.floor==='carpet')&&!L.cuttingApproved(job))throw {status:409,message:'The shop is reviewing this quote. Please contact us before accepting.'};
  return {link,job:{...job,id:link.jobId},q};
 }
 function accepted(job,q){return job.customerAcceptance?.rev===q.k||job.accepted?.q===q.k;}
 function accept(token){
  const {link,job,q}=read(token);
  if(accepted(job,q))return {duplicate:true};
  // Synchronous read/write: repeated taps create one event, with no booking, money or stock mutation.
  const at=new Date(now()).toISOString(),id='online_'+digest(job.id+'|'+q.k).slice(0,24),p=L.quoteParts(q);
  st.updateDoc(docPath('jobs/'+job.id),{customerAcceptance:{at,rev:q.k,signature:link.signature,total:p.total,source:'email',pending:true},chase:{[id]:{at,outcome:'yes',by:'customer',byName:'Customer online',note:'Customer accepted quote '+L.quoteRef(job,q)+' online. Shop to confirm order, materials payment and fitting arrangements.',quoteRev:q.k}},log:{[id]:{at,by:'customer',text:'Customer accepted '+L.quoteRef(job,q)+' online. Sales follow-up required. No payment or diary booking created.'}}});
  st.audit('customer','quote accepted',job.id+' / '+q.k);broadcast('jobs');return {duplicate:false};
 }
 function page(token){
  const {job,q}=read(token),done=accepted(job,q);
  const action=done?'<p style="text-align:center;font-size:18px;line-height:1.6">Thank you — your acceptance is recorded. Our sales team will contact you about the next steps. Your fitting date is confirmed only after materials are paid and the shop agrees the booking.</p>':`<form method="post" action="/quote/${template.esc(token)}"><label style="display:block;font-size:15px;line-height:1.7;margin:0 0 20px"><input type="checkbox" name="confirm" value="yes" required> I would like to go ahead with quote ${template.esc(L.quoteRef(job,q))} for ${template.esc(L.money(L.quoteParts(q).total))}. I understand this does not take payment or confirm a fitting date.</label><button type="submit" style="width:100%;border:0;background:#ac1020;color:white;padding:19px;font-size:16px;letter-spacing:1px;cursor:pointer">CONFIRM ACCEPTANCE</button></form>`;
  const body=L.quoteMessage(job,q,{name:'Innovation Flooring Direct',email:'sales@innovationflooringdirect.com',phone:'0141 952 5200'});
  return template.html({job,q,L,body,action,notice:done?'Your acceptance has been received.':'Please review your quote below before confirming.'});
 }
 return {issue,read,accept,page};
}
module.exports={make,digest};
