'use strict';
const {docPath}=require('./store'),R=require('./fitting-reminder');
module.exports=function(st,user,now,action){
 if(user.role!=='owner')throw Object.assign(Error('Only the shop owner can use this practice booking.'),{status:403,code:'forbidden'});
 const id='ZZ-REMINDER-OWNER-'+user.id,d=docPath('jobs/'+id),old=st.getDoc(d.path).data;
 if(old&&(!old.test||old.total!==0||Object.keys(old.lines||{}).length))throw Object.assign(Error('Only the empty reminder practice booking can be changed.'),{status:409,code:'test_only'});
 const date=n=>new Date(Date.parse(R.day(now)+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 if(action==='prepare'){
  if(old)throw Object.assign(Error('Practice booking already exists; history has been preserved.'),{status:409,code:'exists'});
  st.setDoc(d,{test:true,reminderTrial:false,status:'open',type:'Fitting',diary:true,date:date(3),ref:'ZZ AUTOMATIC REMINDER TEST',customer:{name:'David — TEST ONLY',email:'David@innovationflooringdirect.com',phone:user.mobile,address:'TEST ONLY — no appointment'},lines:{},total:0,fitterDue:0,notes:'TEST ONLY: automatic reminder proof. No stock, payment or real appointment.'});
 }else if(['move','due','stop'].includes(action)){
  if(!old)throw Object.assign(Error('Prepare the practice booking first.'),{status:409,code:'missing'});
  st.updateDoc(d,{date:action==='move'?date(5):action==='due'?date(3):old.date,reminderTrial:action!=='stop',status:action==='stop'?'cancelled':'open',log:{['reminderTrial_'+now]:{at:new Date(now).toISOString(),by:user.name,text:'TEST ONLY reminder check: '+action+'. No stock or money changed.'}}});
 }else if(action!=='status')throw Object.assign(Error('Unknown practice action.'),{status:400,code:'invalid_argument'});
 const j=st.getDoc(d.path).data;return {ok:true,id,date:j?.date||'',status:j?.status||'not prepared',enabled:!!j?.reminderTrial,messages:Object.values(j?.msgs||{}).filter(m=>String(m.rev||'').startsWith('reminder3:')).map(m=>({date:m.rev.slice(10),state:m.state,to:m.to,subject:m.subject,sentAt:m.sentAt||'',attempts:Object.keys(m.tries||{}).length})),issue:j?.fittingReminderIssue||''};
};
