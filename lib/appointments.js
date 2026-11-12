'use strict';
const {docPath} = require('./store');
const slots = ['8-10am','10am-12pm','11am-1pm','1-3pm','2-4pm','3-5pm'];
const fail = (status, message) => { throw {status,code:'appointment',message}; };
function make({st,cmds,users,now,L,broadcast}) {
  const shop = u => ['owner','shop'].includes(u.role);
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
  function allowed(j,u) {
    if(shop(u)) return true;
    const role=j.visitId?'estimator':'fitter';
    if(u.role !== role) return false;
    if(j.fitterId) return j.fitterId === u.id;
    // Owner trial identities are virtual, so they are absent from the users table.
    // Allow only explicitly named trial work for that owner's existing trial identity.
    if(role==='fitter' && u.id.startsWith('trial_') && /^ZZ[ -]?TEST/i.test(j.customer?.name||'')){
      const owner=users().find(x=>x.id===u.id.slice(6)&&x.active&&x.role==='owner');
      return !!owner && j.fitter===owner.name+' - fitter trial' && u.name===j.fitter;
    }
    // Existing jobs assign fitters by name. Ambiguous names never grant access.
    return j.fitter === u.name && users().filter(x=>x.active && x.role===role && x.name===u.name).length===1;
  }
  const eligible = j => j.status==='open' && j.type==='Fitting' && j.diary===true && /^\d{4}-\d{2}-\d{2}$/.test(j.date||'') && j.date>=today();
  const work=require('./fitter-work').make({st,cmds,allowed,L,now,broadcast,slots});
  function visitJob(j,id){
    const v=j.pre?.[id];
    if(!v||!['measure','both'].includes(v.kind))return null;
    return {...j,visitId:id,date:v.date,fitter:v.who,fitterId:v.whoId,type:'Fitting',diary:v.status==='booked'};
  }
  const prefix=j=>j.visitId?'visit-slot:'+encodeURIComponent(j.visitId)+':':'fit-slot:';
  function text(j,slot,delay=false) {
    const date = new Date(j.date+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short'});
    const person=j.visitId?'estimator':'fitter';
    const test = /^ZZ[ -]?TEST/i.test((j.customer||{}).name||'') ? 'STAFF TEST - ' : '';
    if(delay)return test+'Innovation Flooring: Sorry, your '+person+' is delayed. New arrival: '+date+', '+slot+'. Thank you for your patience. No SMS replies.';
    return test+'Innovation Flooring: Your '+person+' will arrive '+date+', '+slot+'. For changes call 01419525200. No SMS replies. Thank you!';
  }
  const messages = j => Object.values(j.msgs||{}).filter(m=>String(m.rev||'').startsWith(prefix(j)));
  function list(u){
    if(!shop(u)&&!['fitter','estimator'].includes(u.role)) fail(403,'Only fitters, estimators and shop staff can use this page.');
    return {today:today(),availability:require("./my-availability").read(st,u),canSetAvailability:["fitter","estimator"].includes(u.role),name:u.name,shop:shop(u),owner:u.role==='owner',trial:!!u.trial,testOnly:cmds.status().testOnly,slots,jobs:st.list('jobs','', 'asc',0).flatMap(r=>[r,...Object.keys(r.data.pre||{}).map(id=>({id:r.id,data:visitJob(r.data,id)})).filter(r=>r.data)]).filter(r=>(eligible(r.data)||(r.data.status==='open'&&r.data.type==='Fitting'&&r.data.diary&&r.data.date<=today()))&&allowed(r.data,u)).map(r=>{
      const j=r.data,c=j.customer||{}; return {id:r.id,visitId:j.visitId||'',kind:j.visitId?'Estimator visit':'Fitting',visitVersion:j.visitId?(j.pre[j.visitId].rescheduleVersion||0):0,visitDuration:j.visitId?(j.pre[j.visitId].duration||60):0,ref:j.ref,name:c.name,date:j.date,fitter:j.fitter,address:[c.address,c.postcode].filter(Boolean).join(', '),phone:c.phone,arrivalSlot:messages(j).filter(m=>['sent','delivered'].includes(m.state)&&m.snap?.date===j.date).at(-1)?.snap?.slot||'',canSign:!j.visitId&&j.date<=today()&&!Object.values(j.customerSignoffs||{}).some(x=>x.date===j.date&&x.outcome==='clear'&&x.signed),signStatement:require('./customer-signoff').statement,issueStatement:require('./customer-signoff').issueStatement,paymentNotice:require('./customer-signoff').paymentNotice,completionProblems:[...L.canComplete(j).why,...require('./fitter-work').completionProblems(j)],
        estimator:j.visitId?require('./estimator-details').editable(st.getDoc('jobs/'+r.id).data,L):null,details:require('./fitter-details').details(st.getDoc('jobs/'+r.id).data,L),work:j.visitId?null:{...require('./fitter-work').view(j),items:L.linesOf(j).map(x=>({title:x.title,qty:x.qty,unit:x.unit})),rooms:L.roomsOf(j).map(x=>({name:x.name,len:x.len,wid:x.wid,area:x.area}))},workProfiles:require('./fitter-work').profiles,workReasons:require('./fitter-work').reasons,
        previews:slots.map(s=>text(j,s)),delayPreviews:slots.map(s=>text(j,s,true)),canDelay:messages(j).some(m=>['sent','delivered'].includes(m.state)&&m.snap?.date===j.date),messages:messages(j).map(m=>({state:m.state,body:m.body,at:m.at,byName:m.byName,error:m.err||''}))};
    }).sort((a,b)=>a.date.localeCompare(b.date))};
  }
  function signoff(b,u){
    const d=docPath('jobs/'+String(b.jobId||'')),r=d&&st.getDoc(d.path);
    if(!r?.exists||!allowed(r.data,u)||b.visitId)fail(403,'This is not your assigned fitting.');
    return cmds.customerSignoff(b,u);
  }
  async function send(b,u){
    const d=docPath('jobs/'+String(b.jobId||'')),r=d&&st.getDoc(d.path);
    if(!r||!r.exists)fail(403,'This is not an assigned job.');
    const j=b.visitId?visitJob(r.data,String(b.visitId)):r.data;
    if(!j||!allowed(j,u))fail(403,'This is not an assigned visit or job.');
    if(!eligible(j)) fail(409,'This appointment is not booked for today or a future date.');
    if(b.date!==j.date) fail(409,'The appointment date changed. Refresh before sending.');
    if(!slots.includes(b.slot)) fail(400,'Choose one of the six arrival slots.');
    if(['body','to','byName','again'].some(k=>Object.hasOwn(b,k))) fail(400,'Message wording and recipient are set by the job, not the sender.');
    const pending=messages(j).find(m=>['queued','unsure'].includes(m.state));
    if(pending) fail(409,'A previous slot message is still sending or uncertain. Ask the shop to check it before sending another.');
    const mode=b.mode||'arrival';
    if(!['arrival','delay'].includes(mode))fail(400,'Choose an arrival or delay notice.');
    const accepted=messages(j).filter(m=>['sent','delivered'].includes(m.state)&&m.snap?.date===j.date).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
    if(mode==='delay'&&!accepted.length)fail(409,'Send the original arrival time before a delay notice.');
    if(mode==='delay'&&accepted.at(-1).snap?.slot===b.slot)fail(409,'Choose a different arrival slot for the delay.');
    const body=text(j,b.slot,mode==='delay'),rev=prefix(j)+j.date+':'+b.slot+(mode==='delay'?':delay':'');
    return cmds.run('msg.send',{jobId:b.jobId,kind:'other',channel:'sms',to:(j.customer||{}).phone,body,rev,byName:u.name,key:b.key,snap:{date:j.date,slot:b.slot,fitter:j.fitter,visitId:j.visitId||''}},u);
  }
  function createTest(u,b={}){
    if(u.role!=='owner'||!cmds.status().testOnly) fail(403,'Only the owner can create this test while test mode is on.');
    const estimator=b.kind==='estimator';
    const id=(estimator?'ZZ-ESTIMATOR-SLOTS-':'ZZ-SLOT-BUTTONS-')+today(),d=docPath('jobs/'+id);
    if(!st.getDoc(d.path).exists)st.setDoc(d,{status:'open',type:'Fitting',diary:true,date:new Date(Date.parse(today()+'T12:00:00Z')+86400000).toISOString().slice(0,10),fitter:'STAFF TEST',ref:id,customer:{name:'ZZ TEST arrival buttons',phone:u.mobile,address:'TEST ONLY - no appointment'},total:0,fitterDue:0,lines:{},notes:'Owner-authorised message test. No stock, payment or real fitting.'});
    if(estimator&&!st.getDoc(d.path).data.pre)st.updateDoc(d,{type:'Quote',diary:false,pre:{test:{kind:'measure',status:'booked',who:'STAFF TEST',date:new Date(Date.parse(today()+'T12:00:00Z')+86400000).toISOString().slice(0,10)}}});
    return {ok:true,id};
  }
  work.planCarpet=(b,u)=>{
 const d=docPath('jobs/'+String(b.jobId||'')),r=d&&st.getDoc(d.path),j=r?.data,v=j&&visitJob(j,String(b.visitId||''));if(!r?.exists||!v||!allowed(v,u)||!['owner','shop','estimator'].includes(u.role))fail(403,'Only the assigned estimator or shop can prepare this plan.');if(j.status!=='open')fail(409,'This job is closed.');if(b.version!==require('./estimator-details').token(j))fail(409,'The measurements changed. Reload before planning.');if(b.confirmed!==true)fail(400,'Confirm plain carpet, matching dye batch and pile direction.');if(!Array.isArray(b.widths)||!b.widths.length||b.widths.some(w=>![4,5].includes(w)))fail(400,'Choose available roll widths.');
 const first=L.roomsOf(j)[0],choice=first&&(L.choiceOf(j,first)||L.linesOf(j).find(l=>l.k===first.line));const spec={material:choice?.title||'Selected carpet',pattern:'plain',sameBatch:true,pileConfirmed:true,widths:b.widths};const proposal=require('./cutting-engine').forJob({...j,cuttingSpec:spec});if(proposal.blocked)fail(409,proposal.blocked);st.updateDoc(d,{cuttingSpec:spec,log:{['cutplan_'+now()]:{at:new Date(now()).toISOString(),by:u.id,text:'Draft cutting proposal prepared. No quote, stock or accepted cut changes.'}}});broadcast('jobs');return {ok:true};
 };
  work.estimatorDetails=require('./estimator-details').make({st,allowed,visitJob,L,now,broadcast});
  Object.assign(work,require('./estimator-reschedule')({st,allowed,visitJob,cmds,L,now,broadcast}));
  function photo(jobId,id,u){const r=st.getDoc('jobs/'+jobId);if(!r.exists||!(allowed(r.data,u)||Object.keys(r.data.pre||{}).some(k=>{const v=visitJob(r.data,k);return v&&allowed(v,u);}))||!require('./fitter-details').hasPhoto(r.data,id))fail(403,'This photo is not on your assigned job.');return true;}
  return {list,send,createTest,signoff,work,photo};
}
module.exports={make,slots};
