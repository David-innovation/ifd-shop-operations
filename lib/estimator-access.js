'use strict';
const {docPath}=require('./store');
module.exports.make=({st,q,ensureUser,appointments,now,broadcast,texter,baseUrl})=>{
 const fail=(status,message)=>{throw {status,code:'estimator_access',message};};
 const list=()=>({users:q.users.all().filter(u=>u.role==='estimator').map(u=>({...u,mobile:q.userById.get(u.id).mobile})),visits:st.list('jobs').flatMap(r=>Object.entries(r.data.pre||{}).filter(([,v])=>['measure','both'].includes(v.kind)&&v.status==='booked').map(([key,v])=>({jobId:r.id,key,name:r.data.customer?.name,address:r.data.customer?.address,who:v.who,date:v.date})))});
 const find=b=>{const u=q.userById.get(String(b.userId||''));if(!u||u.role!=='estimator'||!u.active)fail(400,'Choose an active estimator.');return u;};
 async function action(b,owner){
  if(b.action==='save'){
   const name=String(b.name||'').trim(),mobile=require('./sms').normaliseMobile(b.mobile);
   if(!name||name.length>60||!mobile)fail(400,'Enter name and mobile.');
   const old=q.userByMobile.get(mobile);if(old&&old.role!=='estimator')fail(409,'This mobile belongs to another role. No changes made.');
   if(q.users.all().some(u=>u.active&&u.role==='estimator'&&u.name===name&&u.id!==old?.id))fail(409,'Another estimator already uses this name.');
   const id=ensureUser(name,mobile,'estimator');q.setUser.run(name,'estimator',1,id);q.dropSessionsOf.run(id);st.audit(owner.id,'estimator access','Enabled '+name);return {ok:true,id};
  }
  const u=find(b);
  if(b.action==='challenge-text'){
   const jobs=appointments.list(u).jobs.filter(j=>j.id.startsWith('ZZ-EST-CHALLENGE-20261117-'));if(u.name!=='Davy Snr'||jobs.length!==3)fail(409,'Check all three challenge measures are assigned to Davy.');
   const d=docPath('settings/davy-challenge-text-20261117'),old=st.getDoc(d.path).data;if(old?.state==='sent')return {ok:true,...old};if(old?.state)fail(409,'Check the previous send before retrying.');
   const body='Hi Davy, 3 new practice measures are in your diary for 18-20 Nov, ready to try. Please work through them and let us know anything not working or confusing. Thanks, David';
   st.setDoc(d,{state:'sending',to:u.mobile,body});try{const out=await texter.send(u.mobile,body);const saved={state:'sent',to:u.mobile,body,ref:out.ref,at:new Date(now()).toISOString()};st.setDoc(d,saved);st.audit(owner.id,'sent estimator challenge notice',u.id);return {ok:true,...saved};}catch(e){st.setDoc(d,{state:'unsure',to:u.mobile,body});throw e;}
  }
  if(b.action==='preview'){const data=appointments.list(u);return {role:u.role,name:u.name,jobs:data.jobs,inspections:data.inspections};}
  if(b.action==='prepare'){
   const d=docPath('jobs/'+String(b.jobId||'')),r=d&&st.getDoc(d.path),j=r?.data;
   if(!j||!(j.test===true||/^ZZ TEST/i.test(j.customer?.name||''))||j.orderId||j.accepted||j.diary||Object.keys(j.pay||{}).length)fail(409,'Choose the uncommitted practice measure. No orders or payments may be changed.');
   const selected=Object.entries(j.pre||{}).filter(([,v])=>['measure','both'].includes(v.kind)&&v.status==='booked'&&v.who===u.name);
   if(selected.length!==1)fail(409,'The measure must have one booked visit assigned to this estimator.');
   const name=String(b.customerName||'').trim(),notes=String(b.notes||'').trim();if(!name||!notes)fail(400,'Enter the customer name and job notes.');
   const at=new Date(now()).toISOString(),changes=[];
   for(const other of st.list('jobs')){if(other.id===d.id)continue;const pre={};for(const [k,v]of Object.entries(other.data.pre||{})){if(v.who===u.name&&['measure','both'].includes(v.kind)&&v.status==='booked'){pre[k]={who:'',whoId:'',unassignedAt:at};changes.push(other.id);}}if(Object.keys(pre).length)st.updateDoc(docPath('jobs/'+other.id),{pre,log:{['unassign_'+now()]:{at,by:owner.id,text:'Owner cleared estimator assignment for '+u.name+'. Visit retained for shop review.'}}});}
   const clean=t=>String(t||'').replace(/\s*[—-]\s*trial (?:choice|selection)(?:; confirm colour on visit)?/gi,'').trim();
   const brief=structuredClone(j.brief||{});if(Array.isArray(brief.choices))brief.choices.forEach(c=>{c.title=clean(c.title);});if(Array.isArray(brief.rooms))brief.rooms.forEach(x=>{if(x.title)x.title=clean(x.title);});if(brief.note)brief.note=notes;
   const [key,v]=selected[0];st.updateDoc(d,{test:true,customer:{name},notes,brief,pre:{[key]:{whoId:u.id}},log:{['presentation_'+now()]:{at,by:owner.id,text:'Customer-facing measure details updated. Internal practice classification retained.'}}});
   st.audit(owner.id,'prepared estimator diary',JSON.stringify({job:d.id,user:u.id,unassigned:changes}));broadcast('jobs');return {ok:true,unassigned:changes,preview:appointments.list(u).jobs};
  }
  if(b.action==='send'){
   const data=appointments.list(u);if(data.jobs.length!==1)fail(409,'Check the diary contains only the intended measure before sending.');
   const j=data.jobs[0];if(/ZZ TEST|trial|practice/i.test(j.name))fail(409,'Remove practice wording first.');
   const to=b.copy?require('./sms').normaliseMobile(owner.mobile):u.mobile,ref='estimator-invite-'+u.id+(b.copy?'-copy':''),d=docPath('settings/'+ref),prior=st.getDoc(d.path).data;
   if(prior?.state==='sent')return {ok:true,duplicate:true,...prior};if(prior?.state==='sending'||prior?.state==='unsure')fail(409,'The earlier send needs checking before retrying.');
   const body='Hi '+u.name+', your estimator diary is ready: '+baseUrl.replace(/\/$/,'')+'/estimator\nEnter your own mobile number and the code texted to you. Open '+j.ref+' at '+j.address+'. Measure all six rooms, save plans, sizes and site notes, complete the checklist and measure sign-off, then send to the shop for price review. You can only access your own measures. Innovation Flooring Direct';
   st.setDoc(d,{state:'sending',to,at:new Date(now()).toISOString()});try{const out=await texter.send(to,body);st.setDoc(d,{state:'sent',to,body,ref:out.ref,at:new Date(now()).toISOString()});st.audit(owner.id,'estimator instructions sent',to+' '+out.ref);return {ok:true,state:'sent',to,ref:out.ref};}catch(e){st.setDoc(d,{state:'unsure',to,at:new Date(now()).toISOString()});throw e;}
  }
  fail(400,'Choose an action.');
 }
 return {list,action};
};
