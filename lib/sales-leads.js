'use strict';
const {docPath}=require('./store'),crypto=require('node:crypto');
const stages=['new','contacted','waiting','closed','do-not-contact'];
const clean=(v,n=200)=>String(v||'').trim().slice(0,n);
function make({st,L,now,broadcast}){
 const iso=()=>new Date(now()).toISOString(),today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
 const staff=u=>{if(!u||!['owner','shop'].includes(u.role))throw {status:403,message:'Shop staff only.'};};
 const get=id=>{const d=/^[a-zA-Z0-9_-]+$/.test(id||'')&&st.getDoc('leads/'+id).data;if(!d)throw {status:404,message:'Lead not found.'};return {...d,id};};
 function view(r){const j=st.getDoc('jobs/lead_'+r.id).data;let stage=r.stage;if(j){stage=j.status==='cancelled'?'closed':j.accepted||L.linesOf(j).length?'won':L.quoteOf(j)?'quoted':L.preOf(j).some(v=>v.status==='booked')?'measure booked':'job started';}const needsContact=!['closed','do-not-contact','won','quoted','measure booked','job started'].includes(stage)&&(stage==='new'||!r.nextContact||r.nextContact<=today());return {...r,stage,needsContact,jobId:j?'lead_'+r.id:'',jobRef:j?.ref||''};}
 function list(u){staff(u);return {connection:'pending',connectionMessage:'Facebook and enquiry-email connection pending. Leads can be added manually now. No automatic customer messages are sent.',rows:st.list('leads').map(r=>view({...r.data,id:r.id})).sort((a,b)=>Number(b.needsContact)-Number(a.needsContact)||String(a.nextContact||a.createdAt).localeCompare(b.nextContact||b.createdAt))};}
 function action(u,b){staff(u);const by=clean(b.by,80);if(!by)throw {status:400,message:'Enter your staff name so the contact history is clear.'};
  if(b.action==='add'){
   const customer=Object.fromEntries(['name','phone','email','address','postcode'].map(k=>[k,clean(b.customer?.[k],k==='address'?500:200)]));
   if(!customer.name||(!customer.phone&&!customer.email))throw {status:400,message:'Enter a name and a phone number or email.'};
   if(customer.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))throw {status:400,message:'Check the email address.'};
   const id=clean(b.key,80);if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id))throw {status:400,message:'Refresh and try again.'};
   if(st.getDoc('leads/'+id).exists)return {ok:true,id,duplicate:true};
   const norm=s=>String(s||'').replace(/\D/g,'').replace(/^44/,'0');
   const match=st.list('leads').find(r=>!['closed','do-not-contact'].includes(r.data.stage)&&((customer.email&&r.data.customer.email.toLowerCase()===customer.email.toLowerCase())||(customer.phone&&norm(r.data.customer.phone)===norm(customer.phone))));
   if(match)return {ok:false,duplicate:true,id:match.id,message:'An existing lead has this phone or email. Open it to keep the history together.'};
   st.setDoc(docPath('leads/'+id),{customer,source:clean(b.source,80)||'Manual enquiry',enquiry:clean(b.enquiry,5000),assignedTo:by,stage:'new',test:b.test===true,createdAt:iso(),nextContact:today(),history:[{at:iso(),by,text:'Lead added'}],version:1});broadcast('leads');return {ok:true,id};
  }
  const r=get(b.id);
  if(b.action==='update'){
   if(r.version!==b.version)throw {status:409,message:'Another staff member changed this lead. Refresh before saving.'};
   if(!stages.includes(b.stage))throw {status:400,message:'Choose a contact status.'};
   if(b.nextContact&&!L.validISO(b.nextContact))throw {status:400,message:'Choose a valid follow-up date.'};
   const note=clean(b.note,3000);if(!note)throw {status:400,message:'Record what happened or why this lead is being closed.'};
   if(['contacted','waiting'].includes(b.stage)&&!b.nextContact)throw {status:400,message:'Set a next contact date so this enquiry is not missed.'};
   st.updateDoc(docPath('leads/'+r.id),{stage:b.stage,nextContact:clean(b.nextContact,10),assignedTo:clean(b.assignedTo,80)||by,version:r.version+1,history:[...r.history,{at:iso(),by,text:note,stage:b.stage,nextContact:b.nextContact||''}]});broadcast('leads');return {ok:true};
  }
  throw {status:400,message:'Unknown lead action.'};
 }
 function convert(u,b){staff(u);const r=get(b.id),id='lead_'+r.id;
  if(['closed','do-not-contact'].includes(r.stage))throw {status:409,message:'Reopen this lead before creating a job.'};
  if(st.getDoc('jobs/'+id).exists)throw {status:409,message:'This lead already has a job. Open the existing job from Sales leads.'};
  const j=b.job;if(!j||j.leadId!==r.id||j.status!=='open'||j.diary||Object.keys(j.lines||{}).length||Object.keys(j.pay||{}).length||j.accepted||j.quotes||Number(j.total))throw {status:400,message:'Start with an unpriced enquiry or measure only.'};
  if(!j.customer?.name||(!j.customer.phone&&!j.customer.email))throw {status:400,message:'Customer details are required.'};
  j.id=id;j.leadId=r.id;j.test=r.test===true;j.leadSource=r.source;j.leadEnquiry=r.enquiry;j.notes=[j.notes,r.enquiry?'Original enquiry: '+r.enquiry:''].filter(Boolean).join('\n');
  // Synchronous SQLite writes are atomic; a repeated click never creates or overwrites a second job.
  st.db.exec('BEGIN IMMEDIATE');try{st.setDoc(docPath('jobs/'+id),j);st.setDoc(docPath('leads/'+r.id),{...r,jobId:id,version:r.version+1,history:[...r.history,{at:iso(),by:u.name,text:'Started '+j.ref}]});st.db.exec('COMMIT');}catch(e){st.db.exec('ROLLBACK');throw e;}
  broadcast('jobs');broadcast('leads');return {ok:true,id};
 }
 return {list,action,convert};
}
module.exports={make};
