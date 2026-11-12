'use strict';
const {docPath}=require('./store');
const slug=name=>'p-'+(String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'x');
const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
function read(st,u){const days={};for(const r of st.list('timeoff').filter(r=>r.data.name===u.name))Object.assign(days,r.data.days||{});return days;}
function save(st,u,b,now){
 const fail=m=>{throw {status:400,code:'availability',message:m};};
 if(!['fitter','estimator'].includes(u.role))throw {status:403,code:'forbidden',message:'Use your own fitter or estimator sign-in.'};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const start=b.start,end=b.end||start;if(!valid(start)||!valid(end)||start<today||end<start||end>shift(today,366))fail('Choose valid dates from today, within the next year.');
 if((Date.parse(end)-Date.parse(start))/86400000>=62)fail('Choose up to 62 days at a time.');
 if(typeof b.off!=='boolean')fail('Choose unavailable or available.');const note=String(b.note||'').trim();if(note.length>200)fail('Keep the reason to 200 characters.');
 const days=read(st,u),at=new Date(now).toISOString();for(let d=start;d<=end;d=shift(d,1))days[d]={off:b.off,note:b.off?note:'',at,by:u.id};
 // Update existing matching records too, so historical IDs cannot leave a second conflicting day-off record.
 const records=st.list('timeoff').filter(r=>r.data.name===u.name);if(!records.length)records.push({id:slug(u.name)});
 for(const r of records)st.setDoc(docPath('timeoff/'+r.id),{name:u.name,days});
 st.audit(u.id,b.off?'marked own days unavailable':'marked own days available',start+' to '+end);return {ok:true,days};
}
module.exports={read,save};
