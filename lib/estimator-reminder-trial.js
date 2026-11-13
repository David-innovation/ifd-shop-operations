'use strict';
const {docPath}=require('./store'),{day}=require('./fitting-reminder');
module.exports=function(st,user,now,action){
 if(user.role!=='owner')throw Object.assign(Error('Only the shop owner can use this practice visit.'),{status:403,code:'forbidden'});
 const id='ZZ-EST-REMINDER-OWNER-'+user.id,d=docPath('jobs/'+id),old=st.getDoc(d.path).data;
 if(old&&(!old.test||old.total!==0||Object.keys(old.lines||{}).length))throw Object.assign(Error('Only the empty estimator reminder practice job can be changed.'),{status:409,code:'test_only'});
 const date=n=>new Date(Date.parse(day(now)+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 if(action==='prepare'){
  if(old)throw Object.assign(Error('Practice visit already exists; history has been preserved.'),{status:409,code:'exists'});
  st.setDoc(d,{test:true,estimatorReminderTrial:false,status:'open',type:'Quote',diary:false,ref:'ZZ ESTIMATOR REMINDER TEST',customer:{name:'David — TEST ONLY',email:'David@innovationflooringdirect.com',phone:user.mobile,address:'TEST ONLY — no appointment'},pre:{reminder:{kind:'measure',status:'booked',date:date(1),who:user.name+' - estimator trial',whoId:'esttrial_'+user.id}},lines:{},total:0,notes:'TEST ONLY: automatic estimator reminder proof. No stock, payment or real appointment.'});
 }else if(['move','due','stop'].includes(action)){
  if(!old)throw Object.assign(Error('Prepare the practice visit first.'),{status:409,code:'missing'});
  st.updateDoc(d,{pre:{reminder:{date:action==='move'?date(3):action==='due'?date(1):old.pre.reminder.date,status:action==='stop'?'cancelled':'booked'}},estimatorReminderTrial:action!=='stop',status:action==='stop'?'cancelled':'open',log:{['estimatorReminderTrial_'+now]:{at:new Date(now).toISOString(),by:user.name,text:'TEST ONLY estimator reminder check: '+action+'. No stock or money changed.'}}});
 }else if(action!=='status')throw Object.assign(Error('Unknown practice action.'),{status:400,code:'invalid_argument'});
 const j=st.getDoc(d.path).data;return {ok:true,id,date:j?.pre?.reminder?.date||'',status:j?.status||'not prepared',enabled:!!j?.estimatorReminderTrial,messages:Object.values(j?.msgs||{}).filter(m=>String(m.rev||'').startsWith('estimate-reminder:')).map(m=>({date:m.snap?.date,state:m.state,to:m.to,subject:m.subject,sentAt:m.sentAt||'',attempts:Object.keys(m.tries||{}).length})),issue:j?.estimatorReminderIssue||''};
};
