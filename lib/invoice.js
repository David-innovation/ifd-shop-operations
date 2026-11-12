'use strict';
const {docPath}=require('./store'),{digest}=require('./quote-acceptance'),email=require('./quote-email');
const COMPANY={name:'Innovation Flooring Direct Limited',number:'SC791390',address:'71 Kilbowie Road, Clydebank, Scotland, G81 1BL',vat:'450384503',rate:20};
function make({st,L,now,broadcast}){
 const fail=message=>{throw {status:409,code:'invoice_review',message};};
 function source(job){
  const q=job.accepted&&job.quotes?.[job.accepted.q];if(!q)fail('Confirm the customer’s order first so the invoice uses the agreed quote.');
  const p=L.quoteParts(q);if(Math.abs(L.round2(Number(job.total)-L.fitterDue(job))-p.shopTotal)>0.01)fail('The order total differs from the accepted quote. Review the prices before invoicing.');
  if(!job.customer?.name||!job.customer?.address)fail('Add the customer’s name and billing address before invoicing.');
  return {q,p,signature:digest({lines:p.shop,customer:{name:job.customer.name,address:job.customer.address,postcode:job.customer.postcode||''},shopTotal:p.shopTotal})};
 }
 function create(b,user){
  const d=docPath('jobs/'+String(b.jobId||'')),job=d&&st.getDoc(d.path).data;if(!job)fail('Job not found.');if(job.status==='cancelled')fail('This job is cancelled.');
  const {q,p,signature}=source(job);
  if(job.invoice){if(job.invoice.signature!==signature)fail('This invoiced order has changed. A reviewed credit note or correction is required; the issued invoice cannot be overwritten.');return {invoice:job.invoice,duplicate:true};}
  if(!L.validISO(b.supplyDate)||!L.validISO(b.dueDate))fail('Enter the actual supply / tax-point date and payment due date.');
  if(b.supplyDate>new Date(now()).toISOString().slice(0,10))fail('The actual supply / tax-point date cannot be in the future.');
  const isTest=job.test===true||/\bZZ[ -]?TEST\b/i.test(job.customer?.name||'')||/^ZZ[- ]/i.test(job.ref||''),at=new Date(now()).toISOString(),year=at.slice(0,4),counter=docPath(isTest?'counters/testinvoices':'counters/invoices'),next=Number(st.getDoc(counter.path).data?.next||1),number=(isTest?'TEST-IFD-':'IFD-')+year+'-'+String(next).padStart(6,'0');
  const lines=p.shop.map(l=>{const gross=L.round2(l.price),net=L.round2(gross/1.2);return {description:l.label,quantity:1,unit:'quoted lot',net,vat:L.round2(gross-net),gross,rate:20};});
  const invoice={number,test:isTest,at,supplyDate:b.supplyDate,dueDate:b.dueDate,signature,quote:job.accepted.q,ref:job.ref,customer:JSON.parse(JSON.stringify(job.customer)),company:COMPANY,lines,total:p.shopTotal,net:L.round2(lines.reduce((n,l)=>n+l.net,0)),vat:L.round2(lines.reduce((n,l)=>n+l.vat,0)),fitterDue:p.fitTotal,by:user.id};
  const updated={...job,invoice,log:{...job.log,['invoice_'+number]:{at,by:user.id,text:'Created VAT invoice '+number+' for shop materials/services only. Fitting paid directly to fitter is excluded.'}}};
  st.db.exec('BEGIN IMMEDIATE');try{st.setDoc(counter,{next:next+1});st.setDoc(d,updated);st.db.exec('COMMIT');}catch(e){st.db.exec('ROLLBACK');throw e;}
  st.audit(user.id,'invoice created',number+' / '+d.id);broadcast('jobs');return {invoice};
 }
 function get(job){if(!job.invoice)fail('Create the invoice first.');if(source(job).signature!==job.invoice.signature)fail('The order changed after invoicing. Review the invoice before sending it again.');return job.invoice;}
 return {create,get};
}
function text(i,job,L){const paid=L.paidOf(job),balance=L.round2(i.total-paid);return ['Hello '+(L.firstName(i.customer.name)||'there')+',','Thank you for choosing Innovation Flooring Direct.',(i.test?'TEST ONLY — NOT A TAX INVOICE ':'VAT invoice ')+i.number,'Job reference: '+i.ref,'Invoice date: '+i.at.slice(0,10),'Supply / tax-point date: '+i.supplyDate,'Payment due: '+i.dueDate,'Bill to: '+i.customer.name+', '+i.customer.address+' '+(i.customer.postcode||''),'',...i.lines.map(l=>l.description+' — 1 quoted lot: '+L.money(l.net)+' net + '+L.money(l.vat)+' VAT = '+L.money(l.gross)),'Net: '+L.money(i.net),'VAT (20%): '+L.money(i.vat),'Invoice total: '+L.money(i.total),'Payments recorded: '+L.money(paid),balance>0?'Balance due to shop: '+L.money(balance):balance<0?'Credit on account: '+L.money(-balance):'Paid in full — thank you.',i.fitterDue?'Fitting of '+L.money(i.fitterDue)+' is excluded from this invoice and paid directly to your fitter on completion.':'','Materials must be paid before fitting is booked. Contact the shop to arrange payment.','',i.company.name,'Company '+i.company.number,i.company.address,'VAT GB'+i.company.vat,'sales@innovationflooringdirect.com'].filter(Boolean).join('\n');}
function html(i,job,L){
 const e=email.esc,paid=L.paidOf(job),balance=L.round2(i.total-paid),q={lines:i.lines.map(l=>({label:l.description,price:l.gross}))};
 const details=`<p style="font-size:14px;line-height:1.8">VAT invoice <strong>${e(i.number)}</strong><br>Invoice date: ${e(i.at.slice(0,10))}<br>Supply / tax-point date: ${e(i.supplyDate)}<br>Payment due: ${e(i.dueDate)}<br>Bill to: ${e(i.customer.name)}<br>${e(i.customer.address)} ${e(i.customer.postcode||'')}</p>`;
 const table=`<table width="100%" cellspacing="0" style="font-size:13px;line-height:1.5;border-collapse:collapse"><tr><th align="left">Description</th><th align="right">Net</th><th align="right">VAT 20%</th></tr>${i.lines.map(l=>`<tr><td style="padding:10px 0;border-bottom:1px solid #ddd">${e(l.description)}<br><small>1 quoted lot</small></td><td align="right">${e(L.money(l.net))}</td><td align="right">${e(L.money(l.vat))}</td></tr>`).join('')}</table><p style="font-size:15px;line-height:1.8">Net: ${e(L.money(i.net))}<br>VAT (20%): ${e(L.money(i.vat))}<br>Payments recorded: ${e(L.money(paid))}<br><strong>${balance>0?'Balance due to shop: '+e(L.money(balance)):balance<0?'Credit on account: '+e(L.money(-balance)):'Paid in full — thank you.'}</strong></p>${i.fitterDue?`<p style="font-size:14px;line-height:1.7">Fitting of ${e(L.money(i.fitterDue))} is excluded from this invoice and paid directly to your fitter on completion.</p>`:''}<p style="font-size:12px;line-height:1.8">${e(i.company.name)} · Company ${e(i.company.number)}<br>${e(i.company.address)}<br>VAT registration GB${e(i.company.vat)}</p>`;
 return email.html({job:{ref:i.number,customer:i.customer},q,L,body:i.fitterDue?require('./customer-signoff').paymentNotice:'',action:table,notice:i.test?'TEST ONLY — NOT A TAX INVOICE. No payment is due.':''}).replace('YOUR PERSONALISED QUOTE','YOUR VAT INVOICE').replace('<p style="font-size:12px;color:#555;margin:0 0 20px">REFERENCE: '+i.number+'-Q1</p>',details).replace('Your home. Our expertise.','Thank you for your business.').replace('We’ve put together your personalised quote, with everything clearly set out below. Our team will look after you from your first choice to the final fitting.','Here is your invoice for the agreed materials and shop services.').replace('Your total','Invoice total').replace('Your quote |','Your invoice |');
}
module.exports={make,html,text,COMPANY};
