'use strict';
const {docPath}=require('./store');
module.exports=function(st,owner,now,scenario){
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(scenario==='area'){
  const original=docPath('jobs/ZZ-OWNER-FITTER-'+owner.id),row=st.getDoc(original.path);
  if(!row.exists||row.data.test!==true||row.data.fitterId!=='trial_'+owner.id)throw {status:409,message:'Open the owner fitter trial first.'};
  st.updateDoc(original,{customer:{postcode:'G81 1DX'}});
  const id='ZZ-FITTER-PRACTICE-'+owner.id+'-area';
  if(!st.getDoc('jobs/'+id).exists)st.setDoc(docPath('jobs/'+id),{test:true,status:'open',type:'Fitting',diary:true,date:new Date(Date.parse(date+'T12:00:00Z')+7*86400000).toISOString().slice(0,10),fitter:owner.name+' - fitter trial',fitterId:'trial_'+owner.id,ref:'ZZ PRACTICE G81 AREA',customer:{name:'ZZ TEST - Nearby G81 finishing visit',postcode:'G81 2AA',address:'MADE-UP PRACTICE JOB - no real visit',phone:owner.mobile,email:owner.mobile?'David@innovationflooringdirect.com':''},lines:{bar:{title:'TEST ONLY door bar finishing',qty:1,unit:'each',hold:'none'}},total:0,fitterDue:0,fitterWork:{profiles:['laminate'],version:0,slot:'8-10am',duration:60,purpose:'return'},notes:'Owner-authorised area calendar trial. No real customer, stock or payment.'});
  return {ok:true,ids:[original.id,id]};
 }
 const cases=[['carpet',1,'Bedroom carpet','Carpet, underlay, gripper and door bar'],['laminate',4,'Lounge laminate','Laminate, underlay, beading and door bar'],['glue',6,'Kitchen glue-down LVT','Glue-down LVT, adhesive and floor preparation']];
 const ids=[];
 for(const [profile,days,name,product] of cases){
  const id='ZZ-FITTER-PRACTICE-'+owner.id+'-'+profile;ids.push(id);if(st.getDoc('jobs/'+id).exists)continue;
  const booked=new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
  st.setDoc(docPath('jobs/'+id),{test:true,status:'open',type:'Fitting',diary:true,date:booked,fitter:owner.name+' - fitter trial',fitterId:'trial_'+owner.id,ref:'ZZ PRACTICE '+profile.toUpperCase(),customer:{name:'ZZ TEST - '+name,phone:owner.mobile,email:'David@innovationflooringdirect.com',address:'PRACTICE ONLY - no real visit'},sizeCheck:'verified',rooms:{room:{name,len:4,wid:3,area:12,status:'verified',source:'shop',verBy:'TEST ONLY',verRole:'shop',verOn:date}},lines:{floor:{title:'TEST ONLY - '+product,qty:12,unit:'m2',hold:'none'}},total:0,fitterDue:0,notes:'David authorised fitter practice. No stock or payment. All customer messages go to David. Try arrival slots, checklist and recording unfinished work before agreeing a return visit.',fitterWork:{profiles:[profile],version:0}});
 }
 return {ok:true,ids};
};
