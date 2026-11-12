'use strict';
// Explicit job projection: never return the shop ledger, private messages or other jobs.
const pics=x=>Object.values(x?.photos||{}).filter(p=>/^[0-9a-f]{32}$/.test(p.id||'')&&!p.gone).map(p=>({id:p.id,name:p.name||p.caption||'Drawing / photo'}));
function details(j,L){
 const rooms=L.roomsOf(j).map(r=>({name:r.name,size:L.roomSize(r),area:L.roomArea(r),status:r.status||'unverified',verifiedBy:r.verBy||'',verifiedOn:r.verOn||'',note:r.note||'',stairs:L.hslOf(r)?L.hslText(r):'',spec:r.spec||null,product:L.choiceOf(j,r)?.title||L.linesOf(j).find(l=>l.k===r.line)?.title||'',photos:pics(r),cuts:(r.cutPlan?.signature===L.cutPlanSignature(j,r)?r.cutPlan.cuts:[])||[]}));
 const visits=Object.values(j.pre||{}).map(v=>({kind:v.kind,date:v.date,status:v.status,who:v.doneBy||v.who,notes:v.notes||'',noVerify:v.noVerify||'',changes:v.changed||[],sub:v.sub?{type:v.sub.type,condition:v.sub.condition,findings:v.sub.findings,prep:v.sub.prep,materials:v.sub.materials,access:v.sub.access,outcome:v.sub.outcome,readings:Object.values(v.sub.readings||{})}:null,photos:pics(v)}));
 return {notes:j.notes||'',fitterDue:L.fitterDue(j),rooms,visits,photos:pics(j),items:L.linesOf(j).map(l=>({title:l.title,sub:l.sub||'',qty:l.qty,unit:l.unit,width:l.w,bay:l.bay||'',picked:!!l.picked,checked:!!l.checked,note:l.note||''})),requestedExtras:L.briefOf(j).also||[]};
}
function hasPhoto(j,id){return [j,...Object.values(j.rooms||{}),...Object.values(j.pre||{})].some(x=>pics(x).some(p=>p.id===id));}
module.exports={details,hasPhoto};
