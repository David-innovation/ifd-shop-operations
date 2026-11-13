'use strict';
const {docPath}=require('./store'),{esc}=require('./quote-email'),{validEmail}=require('./mail');
const MIN=5;
const monthOf=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit'}).format(new Date(t));
const testJob=j=>!!(j.test||j.testOnly)||/^ZZ(?:\b|[ _-])/i.test(j.ref||'')||/^(?:ZZ[ _-]*)?(?:TEST|PRACTICE)\b/i.test(j.customer?.name||'');
function make({st,users,now,mailer,broadcast}){
 const fail=(status,message)=>{throw {status,code:'performance',message};};
 const staff=u=>{if(!['owner','shop'].includes(u.role))fail(403,'Only shop staff can manage monthly emails.');};
 function rows(){
  const people=users().filter(u=>u.active&&u.role==='fitter');
  return st.list('jobs','', 'asc',0).flatMap(({id,data:j})=>testJob(j)?[]:Object.entries(j.customerFeedback||{}).flatMap(([event,r])=>{
   if(r.test||r.testOnly||!Number.isInteger(r.rating)||r.rating<1||r.rating>5||!Number.isFinite(Date.parse(r.at)))return [];
   const matches=people.filter(u=>r.fitterId?u.id===r.fitterId:u.name===r.fitter);
   if(matches.length!==1)return [];
   return [{jobId:id,event,ref:j.ref||id,fitterId:matches[0].id,at:r.at,month:monthOf(r.at),rating:r.rating,comment:String(r.comment||''),followUp:!!r.needsFollowUp,resolved:!!r.reviewed}];
  }));
 }
 function latest(list){const m=new Map();for(const r of list.sort((a,b)=>a.at.localeCompare(b.at)))m.set(r.jobId,r);return [...m.values()].sort((a,b)=>b.at.localeCompare(a.at));}
 function score(list){return {count:list.length,average:list.length?Math.round(list.reduce((s,r)=>s+r.rating,0)/list.length*100)/100:null};}
 function table(month){const list=latest(rows().filter(r=>r.month===month)),map=new Map();for(const r of list){if(!map.has(r.fitterId))map.set(r.fitterId,[]);map.get(r.fitterId).push(r);}return [...map].map(([id,reviews])=>({id,reviews,...score(reviews)})).filter(x=>x.count>=MIN).sort((a,b)=>b.average-a.average);}
 function own(u,month=monthOf(now())){
  if(u.role!=='fitter')fail(403,'This page is for your own fitter reviews.');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'Choose a month.');
  const all=rows().filter(r=>r.fitterId===u.id),monthly=latest(all.filter(r=>r.month===month)),ranked=table(month),me=ranked.find(x=>x.id===u.id),position=me?1+ranked.filter(x=>x.average>me.average).length:null;
  return {month,minimum:MIN,monthly:score(monthly),allTime:score(latest(all)),position,tied:!!me&&ranked.filter(x=>x.average===me.average).length>1,leader:position===1,provisional:month===monthOf(now()),reviews:monthly.map(({ref,at,rating,comment,followUp,resolved})=>({ref,at,rating,comment,followUp,resolved}))};
 }
 function report(u,month){const d=own(u,month),good=d.reviews.filter(r=>r.rating>=4),improve=d.reviews.filter(r=>r.rating<=3);const headline=d.leader?(d.tied?'Joint highest-rated fitter of the month':'Highest-rated fitter of the month'):'Your monthly fitting feedback';
  const sections=[['What customers appreciated',good],['Feedback to learn from',improve]];
  const intro='Thank you, '+u.name+', for the care you put into our customers’ homes. '+(d.leader?'Congratulations on your customer feedback this month. ':'Here is your private monthly review to help celebrate good work and improve the next job. ');
  const figures=d.monthly.count+' genuine job reviews · '+(d.monthly.average??'—')+'/5'+(d.position?' · '+(d.tied?'Joint ':'')+'position '+d.position:' · '+MIN+' reviews needed for a monthly position');
  const note='Scores exclude practice jobs. One review per job counts in each month. Equal scores share a position. Please discuss any product or shop issue with the team so the feedback has the right context. No cash or prize is promised by this email.';
  return {subject:headline+' · '+month,text:headline+'\n'+intro+'\n'+figures+'\n\n'+sections.map(([title,rs])=>title+'\n'+(rs.length?rs.map(r=>r.rating+'/5 · '+r.ref+'\n'+(r.comment||'No written comment.')).join('\n\n'):'No comments in this group.')).join('\n\n')+'\n\n'+note,html:'<!doctype html><html><body style="margin:0;background:#eee;font:16px/1.6 Arial"><main style="max-width:640px;margin:24px auto;background:white;border-top:4px solid #c51b32"><header style="background:#111;color:#fff;padding:28px;text-align:center">INNOVATION<br><span style="color:#cfb87d">FLOORING DIRECT</span></header><section style="padding:28px"><p>'+esc(month)+'</p><h1 style="font:30px Georgia;color:#9e752d">'+esc(headline)+'</h1><p>'+esc(intro)+'</p><p><strong>'+esc(figures)+'</strong></p>'+sections.map(([title,rs])=>'<h2>'+esc(title)+'</h2>'+(rs.length?rs.map(r=>'<p style="border-left:3px solid #c51b32;padding:12px"><strong>'+r.rating+'/5 · '+esc(r.ref)+'</strong><br>'+esc(r.comment||'No written comment.').replace(/\n/g,'<br>')+'</p>').join(''):'<p>No comments in this group.</p>')).join('')+'<p style="font-size:12px;color:#666">'+esc(note)+'</p></section></main></body></html>'};
 }
 function admin(u){staff(u);const cfg=st.getDoc('settings/fitterPerformance').data||{};return {minimum:MIN,contacts:users().filter(x=>x.active&&x.role==='fitter').map(x=>({id:x.id,name:x.name,email:cfg.contacts?.[x.id]?.email||''})),emails:st.list('fitterMonthly','', 'asc',0).map(r=>r.data).sort((a,b)=>b.month.localeCompare(a.month)),startMonth:cfg.startMonth||monthOf(now())};}
 function contact(u,b){staff(u);if(!users().some(x=>x.id===b.id&&x.active&&x.role==='fitter'))fail(400,'Choose an active fitter account.');const email=String(b.email||'').trim().toLowerCase();if(email&&!validEmail(email))fail(400,'Enter a valid fitter email address.');const p=docPath('settings/fitterPerformance');if(!st.getDoc(p.path).exists)st.setDoc(p,{startMonth:monthOf(now()),contacts:{}});st.updateDoc(p,{contacts:{[b.id]:{email}}});st.audit(u.id,'fitter monthly email address',b.id);return {ok:true};}
 let running=false,timer;
 async function poll(){if(running)return;running=true;try{
  const cfg=st.getDoc('settings/fitterPerformance').data||{},current=monthOf(now()),month=monthOf(Date.parse(current+'-01T12:00:00Z')-86400000);
  if(!cfg.startMonth||month<cfg.startMonth)return;
  for(const u of users().filter(x=>x.active&&x.role==='fitter')){
   const d=own(u,month);if(!d.monthly.count)continue;
   const m=report(u,month),board=docPath('fitterMessages/monthly_'+month+'_'+u.id);
   if(!st.getDoc(board.path).exists){st.setDoc(board,{fitterId:u.id,subject:m.subject,body:m.text,at:new Date(now()).toISOString(),by:'Innovation Flooring Direct',kind:'monthly',month,seenAt:'',ackAt:'',replies:{}});broadcast('fitterMessages');}
   const path=docPath('fitterMonthly/'+month+'_'+u.id),old=st.getDoc(path.path).data;
   if(old&&['sending','sent','unsure','failed'].includes(old.state))continue;
   const to=cfg.contacts?.[u.id]?.email||'',settings=st.getDoc('settings/main').data?.msgs||{},allowed=!(settings.testOnly??true)||(settings.allow||[]).includes(to);
   if(!validEmail(to)||!mailer.ready||!allowed){st.setDoc(path,{month,fitterId:u.id,name:u.name,state:!validEmail(to)?'board_only':'blocked',reason:!validEmail(to)?'Report is on the fitter message board; email is optional':!mailer.ready?'Email is not connected':'Test mode blocks this recipient'});continue;}
   st.setDoc(path,{month,fitterId:u.id,name:u.name,to,state:'sending',at:new Date(now()).toISOString(),subject:m.subject});
   try{const r=await mailer.send({to,...m});st.updateDoc(path,{state:'sent',providerRef:r.ref||''});}catch(e){st.updateDoc(path,{state:e.unsure?'unsure':'failed',reason:String(e.message||'Email sending failed').slice(0,250)});}
   broadcast('fitterMonthly');
  }
 }finally{running=false;}}
 function start(){const p=docPath('settings/fitterPerformance');if(!st.getDoc(p.path).exists)st.setDoc(p,{startMonth:monthOf(now()),contacts:{}});for(const r of st.list('fitterMonthly','', 'asc',0))if(r.data.state==='sending')st.updateDoc(docPath('fitterMonthly/'+r.id),{state:'unsure',reason:'Sending was interrupted. Check the Sent mailbox before sending again.'});timer=setInterval(()=>poll().catch(()=>{}),3600000);timer.unref();}
 return {own,admin,contact,report,poll,start,stop(){clearInterval(timer);}};
}
module.exports={make,testJob,monthOf};
