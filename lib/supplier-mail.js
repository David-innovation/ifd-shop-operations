'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store'),{validEmail}=require('./mail');
const fail=m=>{throw {status:409,code:'supplier',message:m};};
const refFor=id=>'IFD-PO-'+crypto.createHash('sha256').update(id).digest('hex').slice(0,10).toUpperCase();
function parseReply(text){
 // Only explicit fields in the new reply count; quoted original requests must not become confirmations.
 const fresh=String(text||'').split(/\n(?:On .+wrote:|From:|[- ]*Original Message|>)/i)[0];
 const dates=[...fresh.matchAll(/^Delivery date:\s*(\d{4}-\d{2}-\d{2})\s*$/gmi)].map(x=>x[1]);
 const confirmed=/^Order status:\s*confirmed\s*$/mi.test(fresh),date=dates[0];
 const stamp=date&&new Date(date+'T12:00:00Z');
 const valid=stamp&&Number.isFinite(stamp.getTime())&&stamp.toISOString().slice(0,10)===date;
 if(!confirmed||dates.length!==1||!valid)return null;
 return {date,ref:(/^Supplier reference:\s*([^\r\n]{1,80})$/mi.exec(fresh)||[])[1]||''};
}
async function readMailbox(env,orders,seen){
 const {ImapFlow}=require('imapflow'),{simpleParser}=require('mailparser');
 const client=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,disableAutoIdle:true});
 client.on('error',()=>{});const messages=[];try{
  await client.connect();const box=await client.mailboxOpen('INBOX',{readOnly:true});
  for(const order of orders){
   const ids=await client.search({from:order.supplierEmail,subject:order.orderRef,since:new Date(order.at||Date.now()-30*86400000)},{uid:true});
   for(const uid of (ids||[]).slice(-10)){
    const key=order.id+'_'+box.uidValidity+'_'+uid;if(seen(key))continue;
    const info=await client.fetchOne(uid,{size:true},{uid:true});
    if(!info||info.size>512000){messages.push({key,orderId:order.id,problem:'Supplier reply is too large for automatic processing. Open it in the mailbox.'});continue;}
    const raw=await client.fetchOne(uid,{source:true},{uid:true}),mail=await simpleParser(raw.source,{skipHtmlToText:false,skipImageLinks:true});
    const auth=mail.headerLines.find(h=>h.key==='authentication-results')?.line||'';
    messages.push({key,orderId:order.id,from:mail.from?.value?.[0]?.address?.toLowerCase(),subject:mail.subject||'',text:(mail.text||'').slice(0,16000),authenticated:/mx\.google\.com/i.test(auth)&&/dmarc=pass/i.test(auth),at:mail.date?.toISOString()||new Date().toISOString()});
   }
  }
  return messages;
 }finally{await client.logout().catch(()=>client.close());}
}
function make({st,L,env,now,broadcast,mailer,reader=readMailbox}){
 let busy=false,timer,offset=0;const iso=()=>new Date(now()).toISOString(),staff=u=>{if(!['owner','shop'].includes(u.role))throw {status:403,message:'Shop staff only.'};};
 function order(id){const data=st.getDoc('deliveries/'+id).data;if(!data)fail('Supplier order not found.');return {...data,id};}
 const adhesiveNotes=d=>require('./engineered-adhesive').orderNotes(d,L,id=>st.getDoc('jobs/'+id).data);
 const signature=d=>crypto.createHash('sha256').update(JSON.stringify({supplier:d.supplier,adhesive:adhesiveNotes(d),lines:L.dLines(d).map(l=>[l.k,l.qty,l.unit,l.variantId,l.jobRef,l.orderingName||l.title,l.w||st.getDoc('jobs/'+l.jobId).data?.lines?.[l.jobLine]?.w,l.batch])})).digest('hex');
 function draft(b,u){staff(u);if(order(b.id).supplierSend&&['sending','sent','uncertain'].includes(order(b.id).supplierSend.state))fail('This order has already been sent or its send needs checking. Do not place it twice.');const d=order(b.id),email=String(b.email||d.supplierEmail||'').trim().toLowerCase();if(!validEmail(email))fail('Enter the supplier’s confirmed email address.');const orderRef=d.orderRef||refFor(d.id);const names={};for(const l of L.dLines(d)){const name=String(b.names?.[l.k]||l.orderingName||l.title).trim();if(!name)fail('Confirm every supplier product name.');names[l.k]={orderingName:name};}
  const balance=require('./supplier-roll-balance'),rollRequests=balance.requests(L.dLines(d).map(l=>({...l,...names[l.k]})),l=>st.getDoc('jobs/'+l.jobId).data?.lines?.[l.jobLine]);
  const text=['Hello '+d.supplier+',','', 'Please confirm availability and supply the following order.','Our reference: '+orderRef,'',...L.dLines(d).map(l=>L.fmtQty(l.qty,l.unit)+' — '+names[l.k].orderingName+(l.jobRef?' — job '+l.jobRef:'')), ...balance.wording(rollRequests), ...adhesiveNotes(d), ...(L.dLines(d).some(l=>l.unit==='packs')?['','PALLET PRICE ENQUIRY — ALTERNATIVE ONLY','For the flooring packs listed above, please also quote the nearest full-pallet option covering the required packs. Confirm packs per pallet, total packs and m², price per m², and any delivery charges. Extra packs or a pallet substitution require our approval before supply.']:[]), '', 'Delivery to Innovation Flooring Direct, 2 South Elgin Place, Clydebank G81 1XP.', '', 'Please keep our reference in your reply subject and complete these three lines:', 'Order status: confirmed','Delivery date: YYYY-MM-DD','Supplier reference: your reference','', 'Please tell us about any shortages, substitutions or changes separately. Do not substitute products without our agreement.','Thank you,','Innovation Flooring Direct','sales@innovationflooringdirect.com'].join('\n');
  st.updateDoc(docPath('deliveries/'+d.id),{orderRef,lines:names,supplierEmail:email,orderDraft:{at:iso(),to:email,subject:'Supplier order '+orderRef,body:text,signature:signature({...d,lines:Object.fromEntries(L.dLines(d).map(l=>[l.k,{...l,...names[l.k]}]))})},mailState:'prepared'});broadcast('deliveries');return {to:email,subject:'Supplier order '+orderRef,body:text,ref:orderRef,at:st.getDoc('deliveries/'+d.id).data.orderDraft.at};
 }
 function guard(data,current){const keys=['supplierSend','orderDraft','mailReplies','mailState','replyNeedsReview','lastReplyAt'];if(keys.some(k=>Object.hasOwn(data||{},k)))fail('Use the supplier email controls to change email records.');if(current?.supplierSend&&['sending','uncertain','sent'].includes(current.supplierSend.state)&&Object.hasOwn(data||{},'supplierEmail'))fail('Keep the original supplier email for reply matching.');}
 function contacts(b,u){staff(u);const rows=st.getDoc('settings/supplierContacts').data?.rows||{};
  if(b.action==='contact.save'){const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),phone=String(b.phone||'').trim();if(!name||!validEmail(email))fail('Enter the supplier name and a valid order email.');const key=crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0,24);rows[key]={id:key,name,email,phone,at:iso(),by:u.id};st.setDoc(docPath('settings/supplierContacts'),{rows});broadcast('settings');}
  return {rows:Object.values(rows)};
 }
 for(const row of st.list('deliveries')){if(row.data.supplierSend?.state==='sending')st.updateDoc(docPath('deliveries/'+row.id),{supplierSend:{state:'uncertain',error:'Sending was interrupted. Check Sent mail before trying again.'}});}
 async function send(b,u){staff(u);const d=order(b.id),prior=d.supplierSend;
  if(prior?.state==='sent')return {ok:true,duplicate:true,ref:prior.ref};
  if(prior&&['sending','uncertain'].includes(prior.state))fail('Do not send again: check Sent mail and settle the uncertain order first.');
  if(d.status==='closed'||d.placedAt)fail('This order is closed or already placed. Do not place it twice.');
  const byName=String(b.byName||'').trim();if(!byName)fail('Enter your staff name.');const draft=d.orderDraft;if(!draft||!validEmail(draft.to))fail('Prepare and check the order first.');
  if(draft.signature!==signature(d))fail('The order items changed. Prepare a fresh preview before sending.');
  if(b.draftAt!==draft.at)fail('The order preview changed. Open it again before sending.');if(!mailer?.ready)fail('Email connection is not ready. Nothing sent.');
  const cfg=st.getDoc('settings/main').data?.msgs||{};if(cfg.testOnly!==false&&!(cfg.allow||[]).some(x=>String(x).toLowerCase()===draft.to))fail('Test mode only permits approved test email addresses.');
  const saved={state:'sending',at:iso(),to:draft.to,subject:draft.subject,body:draft.body,byName,by:u.id};st.updateDoc(docPath('deliveries/'+d.id),{supplierSend:saved});broadcast('deliveries');
  let result;try{result=await mailer.send({to:draft.to,subject:draft.subject,text:draft.body});}catch(e){const state=e.unsure?'uncertain':'failed';st.updateDoc(docPath('deliveries/'+d.id),{supplierSend:{state,error:String(e.message||'Email failed'),ref:e.ref||''}});broadcast('deliveries');return {ok:false,state,message:state==='uncertain'?'Not known if the order went. Check Sent mail before sending again.':'Order email failed. Check the email connection and try again.'};}
  st.updateDoc(docPath('deliveries/'+d.id),{supplierSend:{state:'sent',ref:result.ref,sentAt:iso()},mailState:'sent',orderedMethod:'email',orderedDate:iso().slice(0,10),orderedByName:byName,orderedBy:u.id,placedAt:iso(),orderHistory:{['sent_'+crypto.randomUUID()]:{at:iso(),by:u.id,byName,action:'Order email sent',expected:d.expected||'',ref:d.orderRef,method:'email'}}});
  st.setDoc(docPath('settings/supplierMail'),{enabled:true,by:u.id,at:iso()});broadcast('deliveries');return {ok:true,ref:result.ref};
 }
 function settle(b,u){staff(u);const d=order(b.id);if(d.supplierSend?.state!=='uncertain')fail('Only uncertain sends need settling.');const reason=String(b.reason||'').trim();if(!reason||!['sent','not-sent'].includes(b.outcome))fail('Record the Sent-mail check and result.');const sent=b.outcome==='sent';st.updateDoc(docPath('deliveries/'+d.id),{supplierSend:{state:sent?'sent':'failed',resolvedBy:u.id,resolvedAt:iso(),resolution:reason},...(sent?{placedAt:iso(),orderedMethod:'email',orderedByName:d.supplierSend.byName,orderedDate:d.supplierSend.at.slice(0,10)}:{})});broadcast('deliveries');return {ok:true};}
 function record(b,u){staff(u);const d=order(b.id),byName=String(b.byName||'').trim(),reason=String(b.reason||'').trim(),ref=String(b.ref||'').trim(),expected=String(b.expected||'').trim();
  if(!byName)fail('Enter the staff member’s name.');if(expected&&!L.validISO(expected))fail('Enter a valid expected delivery date.');
  const patch={expected,ref},at=iso(),key=crypto.randomUUID();
  if(b.action==='placed'){
   if(!['phone','email'].includes(b.method))fail('Choose phone or email.');if(!L.validISO(b.orderedDate)||b.orderedDate>at.slice(0,10))fail('Enter the actual order date.');if(!ref)fail('Enter the supplier reference.');
   Object.assign(patch,{orderedMethod:b.method,orderedDate:b.orderedDate,orderedByName:byName,orderedBy:u.id,placedAt:at});
  }else if(!reason)fail('Enter why the expected delivery has changed.');
  const event={at,by:u.id,byName,action:b.action,from:d.expected||'',expected,ref,reason,method:b.method||'',orderedDate:b.orderedDate||''};patch.orderHistory={[key]:event};
  st.updateDoc(docPath('deliveries/'+d.id),patch);
  for(const l of L.dLines(d)){if(!l.jobId)continue;const j=st.getDoc('jobs/'+l.jobId).data;if(!j||j.status!=='open'||!j.lines?.[l.jobLine])continue;
   st.updateDoc(docPath('jobs/'+l.jobId),{lines:{[l.jobLine]:{due:expected,supplierReference:ref,...(b.action==='placed'?{orderedDate:b.orderedDate,orderedByName:byName,orderedMethod:b.method}:{})}},log:{['supplier_'+key]:{at,by:u.id,text:byName+': '+(b.action==='placed'?'Ordered by '+b.method+' on '+b.orderedDate:'Delivery estimate changed: '+reason)+'. Supplier reference '+ref+'. Expected '+(expected||'not confirmed')+'. Stock is not marked received; job date unchanged.'}}});
  }broadcast('deliveries');broadcast('jobs');return {ok:true};
 }
 function ingest(m){const d=order(m.orderId);if(d.mailReplies?.[m.key])return false;
  const matched=m.from===d.supplierEmail&&m.subject.includes(d.orderRef)&&m.authenticated;
  let parsed;try{parsed=matched?parseReply(m.text):null;}catch{};
  // Any shortage, change or cancellation requires staff review, even when a date is present.
  if(/\b(roll.balance|extra|additional|price|cost|shortage|short|unavailable|out of stock|substitut|cancel|partial|part delivery|back.?order)\w*\b/i.test(String(m.text||'').split(/\nOn .+wrote:|\n>/i)[0]))parsed=null;
  const rec={at:iso(),receivedAt:m.at||iso(),from:m.from||'',subject:m.subject||'',excerpt:String(m.text||m.problem||'').slice(0,5000),state:parsed?'confirmed':'review'};
  const patch={mailReplies:{[m.key]:rec},replyNeedsReview:!parsed||!!d.replyNeedsReview,mailState:parsed?'confirmed':'review',lastReplyAt:iso()};
  if(parsed){patch.expected=parsed.date;if(parsed.ref)patch.ref=parsed.ref;}
  st.updateDoc(docPath('deliveries/'+d.id),patch);
  for(const l of L.dLines(d)){if(!l.jobId)continue;const j=st.getDoc('jobs/'+l.jobId).data;if(!j||j.status!=='open'||!j.lines?.[l.jobLine])continue;const lp={supplierReply:rec.state};if(parsed){lp.due=parsed.date;lp.supplierReference=parsed.ref;}
   st.updateDoc(docPath('jobs/'+l.jobId),{lines:{[l.jobLine]:lp},log:{['supplier_'+crypto.createHash('sha256').update(m.key).digest('hex').slice(0,20)]:{at:iso(),by:'system',text:parsed?'Supplier confirmed '+d.orderRef+', expected '+parsed.date+'. Goods have not been received.':'Supplier reply for '+d.orderRef+' needs shop review.'}}});
  }broadcast('deliveries');broadcast('jobs');return true;
 }
 async function poll(){if(busy)return {busy:true};const config=st.getDoc('settings/supplierMail').data||{};if(!config.enabled)return {enabled:false};busy=true;try{
  const orders=st.list('deliveries').filter(r=>r.data.status!=='closed'&&r.data.orderRef&&r.data.supplierEmail).map(r=>({...r.data,id:r.id}));
  const batch=orders.slice(offset,offset+30);offset=offset+30>=orders.length?0:offset+30;
  const messages=await reader(env,batch,key=>orders.some(d=>d.mailReplies?.[key]));let count=0;for(const m of messages)if(ingest(m))count++;
  st.setDoc(docPath('settings/supplierMailStatus'),{at:iso(),ok:true,matched:count,orders:orders.length});broadcast('settings');return {ok:true,matched:count};
 }catch(e){st.setDoc(docPath('settings/supplierMailStatus'),{at:iso(),ok:false,error:'Could not check supplier replies. Check mailbox access and connection.'});broadcast('settings');return {ok:false,error:'Could not connect to the supplier-reply mailbox.'};}finally{busy=false;}}
 async function enable(b,u){if(u.role!=='owner')throw {status:403,message:'Only the owner can enable incoming supplier mail.'};st.setDoc(docPath('settings/supplierMail'),{enabled:b.enabled===true,by:u.id,at:iso()});return poll();}
 function start(){timer=setInterval(()=>poll(),120000);timer.unref();}function stop(){clearInterval(timer);}
 return {draft,send,settle,contacts,guard,record,ingest,poll,enable,start,stop};
}
module.exports={make,parseReply,refFor,readMailbox};

