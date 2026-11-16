'use strict';
const {docPath}=require('./store');
const crypto=require('node:crypto');
module.exports=function({st,L,allowed,now,broadcast}){
 const fail=(status,message)=>{throw {status,code:'inspection',message};};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
 const ranges={'8-10am':[480,600],'10am-12pm':[600,720],'11am-1pm':[660,780],'1-3pm':[780,900],'2-4pm':[840,960],'3-5pm':[900,1020]};
 function calendar(b,u){
  const {j}=get(b,u),duration=Number(b.duration||60);if(!Number.isInteger(duration)||duration<30||duration>120)fail(400,'Allow 30 to 120 minutes for the inspection.');
  const postcode=String(b.postcode||j.customer?.postcode||'').trim().toUpperCase();if(postcode&&!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(postcode))fail(400,'Enter a valid customer postcode.');
  const area=L.outwardOf(postcode),off=st.list('timeoff').filter(r=>r.data.name===j.fitter).flatMap(r=>Object.entries(r.data.days||{}).filter(([,v])=>v.off).map(([d])=>d)),visits=[];
  for(const r of st.list('jobs')){const x=r.data;if(x.status!=='open')continue;const visible=allowed(x,u),common={name:visible?x.customer?.name||x.ref:'Booked',area:visible?L.outwardOf(x.customer?.postcode):''};if(x.diary&&x.fitter===j.fitter)visits.push({...common,date:x.date,slot:x.fitterWork?.slot||x.arrival?.slot||'',duration:x.fitterWork?.duration||0});for(const v of Object.values(x.pre||{})){if(v.status==='booked'&&v.who===j.fitter&&!(r.id===b.jobId&&v.herringbone))visits.push({...common,date:v.date,slot:v.arrival?.slot||v.rescheduleSlot||v.slot||'',duration:v.duration||0});}}
  const [hour,minute]=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now())).split(':').map(Number),days=[];
  for(let i=0;i<366;i++){const date=new Date(Date.parse(today()+'T12:00:00Z')+i*86400000).toISOString().slice(0,10),jobs=visits.filter(v=>v.date===date);const slots=Object.keys(ranges).filter(s=>{const [start,end]=ranges[s],finish=end+duration;return !off.includes(date)&&!(j.diary&&j.date&&date>=j.date)&&finish<=1200&&!(date===today()&&start<hour*60+minute)&&!jobs.some(v=>!ranges[v.slot]||!v.duration||(start<ranges[v.slot][1]+v.duration&&finish>ranges[v.slot][0]));});days.push({date,jobs,slots,off:off.includes(date),sameArea:!!area&&jobs.some(v=>v.area===area),visits:0});}
  return {today:today(),area,postcode,days};
 }
 function get(b,u){const d=docPath('jobs/'+String(b.jobId||'')),r=d&&st.getDoc(d.path);if(!r?.exists||!['owner','shop','fitter'].includes(u.role)||!allowed(r.data,u))fail(403,'This inspection is not assigned to you.');if(r.data.status!=='open'||!L.herringboneInspection(r.data).required)fail(409,'This job does not need a herringbone inspection.');if(!r.data.fitter)fail(409,'The shop must assign the fitting team first.');return {d,j:r.data};}
 function list(u){if(!['owner','shop','fitter'].includes(u.role))return [];return st.list('jobs').filter(r=>r.data.status==='open'&&allowed(r.data,u)&&L.herringboneInspection(r.data).required).map(r=>{const j=r.data,s=L.herringboneInspection(j);return {details:require('./fitter-details').details(j,L),id:r.id,ref:j.ref,name:j.customer?.name,phone:j.customer?.phone,address:[j.customer?.address,j.customer?.postcode].filter(Boolean).join(', '),fitter:j.fitter,state:s.state,reason:s.reason,visit:s.visit||(s.state==='prep_booked'?{k:'preparation',date:j.date,slot:j.fitterWork?.slot||''}:null),version:crypto.createHash('sha256').update(JSON.stringify([j.fitter,j.fitterId,j.customer,j.pre,j.rooms,j.brief,j.lines,j.fitterWork?.purpose,j.preparationRequired,j.quotes])).digest('hex')};});}
 function save(b,u){if(b.action==='calendar')return calendar(b,u);const {d,j}=get(b,u),row=list(u).find(x=>x.id===d.id);if(b.version!==row.version)fail(409,'The job changed. Refresh before saving.');const at=new Date(now()).toISOString(),id='hb_'+crypto.randomUUID(),pre={},patch={},history=id;
 if(b.action==='practice_result'){
  if(u.role!=='owner'||j.test!==true||!/^ZZ[ -]?TEST/i.test(j.customer?.name||'')||j.accepted||j.customerAcceptance||j.diary||j.orderId||Object.keys(j.pay||{}).length||L.linesOf(j).length)fail(403,'Only an owner may simulate this inspection on an unaccepted, unbooked practice quote with no stock or payments.');
  if(j.preparationRequired)return {ok:true,duplicate:true};
  const room=L.roomsOf(j).find(r=>Math.abs(L.roomArea(r)-20)<0.001);if(!room)fail(409,'This practice scenario requires a measured 20 m² room.');
  const note='TEST ONLY — simulated inspection: '+room.name+' requires 20 m² of plywood preparation before herringbone fitting. Shop to approve the additional cost and obtain customer agreement.';
  pre[id]={kind:'subfloor',herringbone:true,status:'done',date:today(),who:j.fitter,whoId:j.fitterId||'',doneAt:at,doneBy:u.id,inspectionScope:L.herringboneScope(j),practice:true,sub:{outcome:'prep',condition:note,prep:'20 m² plywood'}};
  patch.preparationRequired={method:'plywood',area:20,note,visitId:id,recordedAt:at,recordedBy:u.id,quoteRev:null,practice:true};patch.review={on:true,what:'prep',why:note,at,by:u.id};
  st.updateDoc(d,{...patch,pre,log:{[history]:{at,by:u.id,text:u.name+': '+note}}});st.audit(u.id,'simulated practice inspection',d.path);broadcast('jobs');return {ok:true};
 }else if(b.action==='price'){
  if(!['owner','shop'].includes(u.role))fail(403,'Only the shop can approve a preparation price.');
  const p=j.preparationRequired,q=L.quoteOf(j);if(!p||!q)fail(409,'Record the preparation findings and save a quote first.');
  const findings=L.preOf(j).filter(v=>v.status==='done'&&v.herringbone).sort((a,b)=>String(a.doneAt||'').localeCompare(String(b.doneAt||''))).at(-1);if(!findings||findings.k!==p.visitId||findings.sub?.outcome!=='prep'||findings.inspectionScope!==L.herringboneScope(j))fail(409,'The inspection or job has changed. Review the current preparation findings before pricing.');
  if(j.accepted||j.customerAcceptance?.pending)fail(409,'This order has already been accepted. The shop must agree an order variation before changing its price.');
  if(p.quoteRev===q.k)return {ok:true,duplicate:true};
  if(L.quoteLines(q).some(l=>l.key==='prep'||/preparation|screed|plywood/i.test(l.label)))fail(409,'This quote already includes preparation. Review that allowance before adding any further charge.');
  const rate=L.priceList(q.rates)[p.method==='plywood'?'prepPlywood':'prepScreed'],amount=L.round2(p.area*rate);
  if(!(amount>0))fail(409,'The preparation rate needs checking.');
  const label=(p.method==='plywood'?'Plywood':'Screed')+' floor preparation',line={key:'prep',label,price:amount,calc:p.area+' m² × '+L.money(rate)+' per m². '+p.note};
  const next=structuredClone(q);delete next.k;next.n=L.quotesOf(j).length+1;next.at=at;next.by=u.id;next.byName=u.name;next.lines=[...L.quoteLines(q),line];next.total=L.round2(next.lines.reduce((s,l)=>s+l.price,0));
  // A separate section keeps the room totals and the added preparation total reconciled.
  if(next.areas)next.areas.push({name:'Required floor preparation',total:amount,lines:[{label,amount,detail:"Required following inspection; customer agreement needed before work."}]});
  next.preparation={...p,rate,amount};const rev='qprep_'+crypto.randomUUID();
  st.updateDoc(d,{quotes:{[rev]:next},preparationRequired:{...p,rate,amount,quoteRev:rev,pricedAt:at,pricedBy:u.id},log:{[history]:{at,by:u.id,text:u.name+': Preparation priced at '+L.money(amount)+' on revised quote. Customer agreement is still required; no stock, payment or fitting booking changed.'}}});st.audit(u.id,'preparation quote',d.path);broadcast('jobs');return {ok:true,amount,total:next.total};
 }else if(b.action==='book'){
  if(!L.validISO(b.date)||b.date<today()||Date.parse(b.date)>now()+366*86400000)fail(400,'Choose a valid future inspection date within a year.');
  if(b.agreed!==true)fail(400,'Call the customer and agree the visit first.');
  if(!['8-10am','10am-12pm','11am-1pm','1-3pm','2-4pm','3-5pm'].includes(b.slot))fail(400,'Choose an arrival slot.');
  if(st.list('timeoff').some(r=>r.data.name===j.fitter&&r.data.days?.[b.date]?.off))fail(409,'The fitter is unavailable that day.');
  if(j.date&&j.diary&&b.date>=j.date)fail(409,'The inspection must happen before fitting. Ask the shop to move the fitting if needed.');
  const cal=calendar(b,u);if(!cal.days.find(x=>x.date===b.date)?.slots.includes(b.slot))fail(409,'That inspection slot is no longer available. Refresh the diary and choose a free slot.');
  if(b.postcode)patch.customer={postcode:cal.postcode};
  for(const v of L.preOf(j))if(v.herringbone&&v.status==='booked')pre[v.k]={status:'cancelled',cancelledAt:at};
  pre[id]={n:Math.max(0,...L.preOf(j).map(v=>v.n||0))+1,kind:'subfloor',herringbone:true,status:'booked',date:b.date,slot:b.slot,duration:Number(b.duration||60),who:j.fitter,whoId:j.fitterId||'',at,by:u.id,customerAgreed:true};
 }else if(b.action==='result'){
  const preparation=b.visitId==='preparation'&&L.herringboneInspection(j).state==='prep_booked';const v=preparation?{kind:'subfloor',status:'booked',who:j.fitter,date:j.date}:j.pre?.[b.visitId];if(!v||!L.isInspection(v)||v.status!=='booked'||v.who!==j.fitter||v.date>today())fail(409,'Complete the assigned inspection on or after its booked date.');
  if(!['suitable','prep','not_checked','further'].includes(b.outcome))fail(400,'Record the inspection outcome.');
  const note=String(b.note||'').trim();if(note.length<10||note.length>2000)fail(400,'Record the subfloor condition and advice given (10–2,000 characters).');
  if(b.outcome==='suitable'&&b.checked!==true)fail(400,'Confirm the subfloor was exposed and checked against the flooring requirements.');
  if(b.outcome==='prep'&&b.preparation){const p=b.preparation,area=Number(p.area);if(!['screed','plywood'].includes(p.method)||!Number.isFinite(area)||area<=0||area>10000)fail(400,'Choose screed or plywood and enter the measured area needing preparation.');patch.preparationRequired={method:p.method,area:L.round2(area),note,visitId:b.visitId,recordedAt:at,recordedBy:u.id,quoteRev:null};}
  pre[preparation?id:b.visitId]={...(preparation?{n:Math.max(0,...L.preOf(j).map(v=>v.n||0))+1,kind:'subfloor',who:j.fitter,whoId:j.fitterId||'',date:j.date,at,by:u.id,checkedDuringPreparation:true}:{}),status:'done',doneAt:at,doneBy:u.id,inspectionScope:L.herringboneScope(j),sub:{outcome:b.outcome,condition:note,concealed:b.outcome==='not_checked'},herringbone:true};
  if(b.outcome!=='suitable')patch.review={on:true,what:'prep',why:'Herringbone inspection: '+note,at,by:u.id};
 }else fail(400,'Choose book or record findings.');
 st.updateDoc(d,{...patch,pre,log:{[history]:{at,by:u.id,text:u.name+': Herringbone inspection '+(b.action==='book'?'agreed with customer for '+b.date+' '+b.slot:'findings recorded: '+b.outcome+'. '+b.note)}}});st.audit(u.id,'herringbone inspection',d.path);broadcast('jobs');return {ok:true};
 }
 return {list,save};
};
