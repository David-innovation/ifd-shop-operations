'use strict';
const {docPath}=require('./store');
function create({st,L,user,now}){
 if(user.role!=='owner')throw Error('Owner practice only.');
 const id='ZZ-SKIRTING-'+user.id,existing=st.getDoc('jobs/'+id);if(existing.exists)return {ok:true,id,existing:true};
 const source=st.getDoc('jobs/ZZ-HOUSE-PRACTICE-'+user.id).data;if(!source?.test||!source.rooms?.bed1)throw Error('Choose the owner house practice first.');
 const at=new Date(now()).toISOString(),j={...structuredClone(source),id,ref:'SKIRTING-PRACTICE',test:true,customer:{...source.customer,name:'David Woodcock — skirting practice'},status:'open',diary:false,date:'',fitter:'',fitterDue:0,accepted:null,customerAcceptance:null,lines:{},pay:{},drafts:{},quotes:{},componentCutting:{},cuttingApproval:null,pre:{skirting:{kind:'measure',status:'booked',who:user.name,whoId:user.id,date:at.slice(0,10)}},notes:'Practice copy of your house job. Bedroom 1: remove and refit 12 metres of existing skirting. Original job unchanged.',log:{created:{at,by:user.id,text:'Owner authorised skirting practice copy; no stock or payments.'}}};
 st.setDoc(docPath('jobs/'+id),j);
 const W=require('./estimator-workflow').make({st,L,now,broadcast:()=>{},allowed:()=>true,visitJob:()=>({})});
 W.visitNotes({jobId:id,visitId:'skirting',version:require('./estimator-details').token(j),notes:j.notes,rooms:[{key:'bed1',uplift:'customer',disposal:'customer',furniture:'customer',skirting:true,skirtingMetres:12}]},user);
 const updated=st.getDoc('jobs/'+id).data,scope={...updated,rooms:{bed1:updated.rooms.bed1}},calc=L.catalogue(scope,{},{}).skirting;
 if(calc?.amount!==60)throw Error('Skirting calculation failed.');
 const q={n:1,at,by:user.id,scopeRooms:['bed1'],scopeLabel:'Skirting-only practice: other flooring and fitting are excluded',incomplete:true,lines:[{key:'skirting',label:'Skirting removal and refitting',price:calc.amount,calc:calc.text}],total:calc.amount,areas:[{name:'Bedroom 1',total:calc.amount,lines:[{label:'Skirting removal and refitting',amount:calc.amount,detail:calc.text}]}]};
 st.updateDoc(docPath('jobs/'+id),{quotes:{skirting:q}});st.audit(user.id,'created skirting workflow practice',id);return {ok:true,id,metres:12,price:60};
}
module.exports={create};
