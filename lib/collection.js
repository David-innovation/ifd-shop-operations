'use strict';
const {esc}=require('./quote-email'),{validEmail}=require('./mail');
const METHODS=['Cash','Card','Bank transfer'];
const fail=(message,status=409)=>{throw {status,code:'collection',message};};
function make({st,L,now,jobOf,save,pay,msgSend}){
 const system={id:'system',name:'The system',role:'system'};let busy=false;
 async function complete(b,user){
  if(!['owner','shop'].includes(user.role))fail('Only shop staff can confirm collection.',403);
  let {d,job}=jobOf(b.jobId);
  if(job.type!=='Collection'||job.status==='cancelled')fail('Choose an active collection order.');
  if(job.collectionReceipt)return {ok:true,duplicate:true};
  if(job.status==='done')fail('This collection was already completed. Review its existing history first.');
  const ready=L.canComplete(job);if(!ready.ok)fail(ready.why.join(' '));
  if(L.fitterDue(job)>0)fail('Review this as a collection order without fitting first.');
  if(!String(b.byName||'').trim())fail('Enter your name.');
  const acceptedQuote=job.quotes?.[job.accepted?.q],acceptedParts=acceptedQuote?L.quoteParts(acceptedQuote):null;
  if(acceptedParts&&Math.abs(acceptedParts.shopTotal-L.shopTotal(job))>0.01)fail('The accepted quote and order total differ. Check the prices before collection.');
  if(L.payList(job).filter(p=>!p.void).some(p=>!p.method||p.method==='Other'))fail('Check the payment history and record how each payment was received before collection.');
  const balance=L.balanceOf(job);
  if(balance>0.004){
   if(!METHODS.includes(b.method))fail('Choose how the customer paid: cash, card or bank transfer.');
   if(b.paymentReceived!==true)fail('Confirm that the payment has actually been received.');
   if(Math.abs(Number(b.amount)-balance)>0.004)fail('The balance changed. Reopen collection and check the amount.');
   pay({jobId:b.jobId,key:b.key,kind:'payment',amount:balance,method:b.method,byName:b.byName,note:'Payment received at collection'},user);
   job=jobOf(b.jobId).job;
  }
  const payments=L.payList(job).filter(p=>!p.void);
  if(payments.some(p=>!p.method||p.method==='Other'))fail('Check the payment history and record how each payment was received before collection.');
  if(L.balanceOf(job)>0.004)fail('Record the outstanding payment before completing collection.');
  const at=new Date(now()).toISOString(),q=job.quotes?.[job.accepted?.q],parts=q?L.quoteParts(q):null;
  const items=L.linesOf(job).filter(l=>!parts||l.hold!=='none').map(l=>({title:l.title,quantity:l.unit==='m'?Number(l.qty)/10:Number(l.qty),unit:l.unit==='m'?'m of '+Number(l.w||l.width||0)+' m wide carpet':l.unit||'items'}));
  const prices=parts?.shop?.map(l=>({label:l.label,price:Number(l.price)}))||L.linesOf(job).map(l=>({label:l.title,price:Number(l.price)||0}));
  if(parts&&Math.abs(parts.shopTotal-L.shopTotal(job))>0.01)fail('The accepted quote and order total differ. Check the prices before collection.');
  const receipt={at,by:user.id,byName:b.byName,ref:job.ref||job.id,customer:job.customer?.name||'Customer',items,prices,total:L.shopTotal(job),paid:L.paidOf(job),payments:payments.map(p=>({method:p.method,amount:p.amount,kind:p.kind||'payment',at:p.at})),test:job.test===true||/^ZZ[- ]/i.test(job.ref||'')||/^ZZ.*TEST/i.test(job.customer?.name||'')};
  save(d,{status:'done',doneAt:at,doneAs:'Collected',collectionReceipt:receipt,collectionEmailRequired:true},user,'Collected by customer. Payment methods recorded; itemised receipt email queued.');
  await sendOne(b.jobId);
  return {ok:true};
 }
 async function sendOne(id){
  const {d,job}=jobOf(id),r=job.collectionReceipt;if(!r||!job.collectionEmailRequired||job.status!=='done'||job.type!=='Collection')return;
  const issue=message=>{if(job.collectionEmailIssue!==message)save(d,{collectionEmailIssue:message},system,null);};
  if(L.balanceOf(job)>0.004){issue('Collection receipt held: payment needs checking.');return;}
  const existing=Object.values(job.msgs||{}).find(m=>m.rev==='collection:'+id);
  if(existing){issue(['sent','delivered'].includes(existing.state)?'':existing.state==='failed'?'Collection receipt failed. Open Messages and retry.':existing.state==='unsure'?'Collection receipt may have sent. Check before retrying.':'Collection receipt is sending.');return;}
  const to=String(job.customer?.email||'').trim();if(!validEmail(to)){issue('Add the customer email address to send their collection receipt.');return;}
  const body=text(r,L);
  try{const result=await msgSend({jobId:id,key:'collection-'+require('node:crypto').createHash('sha256').update(id).digest('hex').slice(0,40),kind:'receipt',channel:'email',to,subject:(r.test?'TEST · ':'')+'Thank you for visiting · Your collection receipt '+r.ref,body,rev:'collection:'+id,byName:'The system'},system);issue(result.ok?'':'Collection receipt needs attention. Open Messages.');}catch(e){issue(e.message||'Collection receipt could not be sent.');}
 }
 async function poll(){if(busy)return;busy=true;try{for(const r of st.list('jobs'))if(r.data.collectionEmailRequired)await sendOne(r.id);}finally{busy=false;}}
 return {complete,poll};
}
function text(r,L){return [(r.test?'TEST RECEIPT — NO PAYMENT TAKEN\n':''),'Hello '+r.customer+',','Thank you for visiting Innovation Flooring Direct. It was lovely to help you choose your flooring. Here is a copy of the items you collected.','Collection reference: '+r.ref,'Collected: '+r.at.slice(0,10),'','Your items',...r.items.map(i=>i.title+' — '+i.quantity+' '+i.unit),'',...(r.prices.length?['Agreed prices',...r.prices.map(p=>p.label+' — '+L.money(p.price))]:[]),'Order total: '+L.money(r.total),'Payments recorded',...r.payments.map(p=>(p.kind==='refund'?'Refund · ':'')+p.method+' — '+L.money(p.amount)),'Paid in full — thank you.','','We hope you love your new flooring. If you need any help, simply reply to this email or call 0141 952 5200.','Your experience matters to us. Please find Innovation Flooring Direct on Google or Facebook to leave an honest review or recommendation. We welcome feedback from every customer.','','Thank you for supporting our shop.','Innovation Flooring Direct','2 South Elgin Place, Clydebank G81 1XP','sales@innovationflooringdirect.com','0141 952 5200'].join('\n');}
function html(body){const lines=String(body).split('\n');return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#efeeeb;font:15px/1.7 Arial;color:#222"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:640px;background:white;border-collapse:collapse"><tr><td style="padding:32px;background:#111;border-top:4px solid #bb1834;color:white;text-align:center;letter-spacing:2px">INNOVATION FLOORING DIRECT<br><span style="color:#cfb87d;font:italic 30px Georgia">Thank you for visiting.</span></td></tr><tr><td style="padding:28px">'+lines.map(l=>l==='Your items'||l==='Agreed prices'||l==='Payments recorded'?'<h2 style="font:italic 25px Georgia;color:#856b36;border-bottom:1px solid #d0bd90;padding-bottom:12px">'+esc(l)+'</h2>':/^Order total:|^Paid in full/.test(l)?'<p style="padding:15px;background:#f7f4ec;font-weight:bold">'+esc(l)+'</p>':l?'<p style="margin:9px 0">'+esc(l)+'</p>':'<br>').join('')+'</td></tr><tr><td style="background:#111;color:#cfb87d;text-align:center;padding:24px">A local shop. Here to help.<br><a style="color:white" href="https://innovationflooringdirect.com">innovationflooringdirect.com</a></td></tr></table></td></tr></table></body></html>';}
module.exports={make,text,html,METHODS};

