'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store');
const choices=['unknown','customer','team','other','not_required'];
const token=j=>crypto.createHash('sha256').update(JSON.stringify([j.rooms,j.brief,j.pre,j.customer,j.accepted,j.lines,j.review])).digest('hex');
function editable(j,L){return {version:token(j),rooms:L.roomsOf(j).map(r=>({key:r.k,name:r.name,len:r.len||'',wid:r.wid||'',hsl:L.hslOf(r)||null,note:r.note||'',requirements:r.requirements||'',want:r.want||'',spec:r.spec||{},responsibility:r.responsibility||{},takeoff:r.takeoff||{}})),choices:L.briefOf(j).choices.map(c=>({key:c.k,title:c.title})),visits:j.pre};}
function make({st,allowed,visitJob,L,now,broadcast}){
 const fail=(status,message)=>{throw {status,code:'estimator_details',message};};
 const clean=(v,max=2000)=>{if(typeof v!=='string'||v.length>max)fail(400,'Check the text fields and keep notes under '+max+' characters.');return v.trim();};
 return function save(b,u){
 const d=docPath('jobs/'+String(b.jobId||'')),rec=d&&st.getDoc(d.path),j=rec?.data,v=j&&visitJob(j,String(b.visitId||''));
 if(!rec?.exists||!v||!allowed(v,u)||!['owner','shop','estimator'].includes(u.role))fail(403,'This is not your assigned estimator visit.');
 if(j.status!=='open'||!['booked','done'].includes(j.pre[b.visitId].status))fail(409,'This visit is no longer open.');
 if(b.version!==token(j))fail(409,'The job changed. Reload it before saving; your changes were not applied.');
 if(!Array.isArray(b.rooms)||!b.rooms.length||b.rooms.length>60)fail(400,'Add the rooms being measured.');
 const at=new Date(now()).toISOString(),rooms={},seen=new Set(),keys=new Set(L.roomsOf(j).map(r=>r.k));
 for(const input of b.rooms){const key=String(input.key||'');if(!/^[\w-]{1,80}$/.test(key)||seen.has(key))fail(400,'Invalid room.');seen.add(key);const old=j.rooms?.[key]||{};if(!keys.has(key)&&!key.startsWith('survey_'))fail(400,'Invalid new room.');
 const name=clean(input.name,100);if(!name)fail(400,'Give every room a name.');const note=clean(input.note),requirements=clean(input.requirements),want=clean(input.want,100);if(want&&!L.briefOf(j).choices.some(c=>c.k===want))fail(400,'Choose a product already selected for this job.');
 const responsibility={};for(const k of ['furniture','uplift','disposal']){if(!choices.includes(input.responsibility?.[k]))fail(400,'Choose who is responsible for each preparation task.');responsibility[k]=input.responsibility[k];}responsibility.note=clean(input.responsibility?.note||'');
 const spec={...(old.spec||{})};for(const k of ['underlay','gripper','beading','old']){const a=input.spec?.[k];if(![true,false,null].includes(a))fail(400,'Check the room requirements.');spec[k]=a;}if(!['carpet','flooring',''].includes(input.spec?.floor||''))fail(400,'Choose the flooring type.');spec.floor=input.spec.floor||'';if(input.spec.bars){spec.bars={};for(const k of ['cc','cf','ff']){const n=Number(input.spec.bars[k]);if(!Number.isInteger(n)||n<0||n>100)fail(400,'Door bar quantities must be whole numbers from 0 to 100.');spec.bars[k]=n;}}
 // Keep pricing inputs in step with explicitly agreed responsibilities.
 spec.furniture=responsibility.furniture==='team'?true:responsibility.furniture==='unknown'?null:false;
 spec.uplift=responsibility.uplift==='team'?true:responsibility.uplift==='unknown'?null:false;
 const takeoff={};for(const k of ['underlayM2','gripperLengths','beadingLengths']){const value=input.takeoff?.[k];if(value===undefined||value===null||value===''){takeoff[k]=null;continue;}const n=Number(value);if(!Number.isFinite(n)||n<0||n>10000||(k!=='underlayM2'&&!Number.isInteger(n)))fail(400,'Enter valid measured material quantities.');takeoff[k]=n;}
 for(const [k,required] of [['underlayM2',spec.underlay],['gripperLengths',spec.gripper],['beadingLengths',spec.beading]])if(required===true&&takeoff[k]===0)fail(400,'A required material cannot have zero quantity. Enter the measured amount or leave it blank for review.');
 const r={takeoff,name,n:old.n||Object.keys(j.rooms||{}).length+Object.keys(rooms).length+1,note,requirements,want,spec,responsibility};
 if(input.hsl){const h={};for(const part of ['hall','landing','stairs']){const x=input.hsl[part];if(!x?.on){h[part]={on:false};continue;}h[part]={on:true};const names=part==='stairs'?['n','winders','wid','tread','riser','wdepth']:['len','wid'];for(const k of names){const n=Number(x[k]);if(!Number.isFinite(n)||n<0||n>1000)fail(400,'Check the hall, stairs and landing measurements.');h[part][k]=n;}if(part==='stairs'){if(!(h[part].n+h[part].winders>0&&h[part].wid>0&&h[part].tread>0&&h[part].riser>0))fail(400,'Complete the stair measurements.');}else if(!(h[part].len>0&&h[part].wid>0))fail(400,'Complete the hall / landing measurements.');}if(!Object.values(h).some(x=>x.on))fail(400,'Select a hall, landing or stairs section.');r.hsl=h;r.area=L.hslArea(h);r.len=0;r.wid=0;}else if(!L.hslOf(old)){const len=Number(input.len),wid=Number(input.wid);if(!(len>0&&len<=30&&wid>0&&wid<=30))fail(400,'Enter valid room measurements in metres.');r.len=len;r.wid=wid;r.area=Math.round(len*wid*100)/100;}
 if(b.submit===true){if(input.checked!==true)fail(400,'Confirm the sizes and details for every room before submitting.');Object.assign(r,{status:'verified',source:'estimator',verBy:u.name,verById:u.id,verRole:'estimator',verOn:at.slice(0,10),verAt:at,verVia:b.visitId});}else if(!old.name||L.roomChanged(old,{...old,...r}))r.status='unverified';
 r.hist={['survey_'+crypto.randomUUID()]:{at,by:u.id,len:old.len||0,wid:old.wid||0,area:old.area||0,status:old.status||'unverified',why:'Estimator updated job details',previous:{note:old.note||'',requirements:old.requirements||'',responsibility:old.responsibility||{},spec:old.spec||{}}}};rooms[key]=r;
 }
 const findings=b.findings||{},sub={};for(const k of ['type','condition','findings','prep','materials','access'])sub[k]=clean(findings[k]||'');
 if(!['','ok','prep','further','not_checked'].includes(findings.outcome||''))fail(400,'Choose the subfloor outcome.');sub.outcome=findings.outcome||'';if(sub.outcome==='not_checked'&&!sub.findings)fail(400,'Explain why the subfloor could not be checked.');if(sub.outcome==='prep'&&!sub.prep)fail(400,'Describe the required preparation.');
 const notes=clean(b.notes||''),visit={notes,sub,detailsSavedAt:at,detailsSavedBy:u.name};if(b.submit===true)Object.assign(visit,{status:'done',doneAt:at,doneBy:u.name,doneById:u.id,role:'estimator',verified:Object.fromEntries(Object.keys(rooms).map(k=>[k,true]))});
 const why='Estimator updated room details, products or preparation responsibilities. Review quantities, agreed services and pricing before booking or cutting.';
 const customer=b.customer?Object.fromEntries(['name','address','postcode','phone'].map(k=>[k,clean(b.customer[k]||'',k==='address'?500:100)])):null;
 st.updateDoc(d,{...(customer?{customer}:{}),rooms,pre:{[b.visitId]:visit},review:{on:true,at,by:u.id,why,what:'both',doneAt:'',doneBy:'',note:''},log:{['survey_'+crypto.randomUUID()]:{at,by:u.id,text:u.name+(b.submit?' submitted estimator findings.':' saved estimator details.')+' Shop review required.'}}});st.audit(u.id,'saved estimator details',d.path);broadcast('jobs');return {ok:true,submitted:b.submit===true};
 };
}
module.exports={editable,make,token};
