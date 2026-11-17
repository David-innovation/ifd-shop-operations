'use strict';
const {docPath}=require('./store');
const fail=message=>{throw {status:409,code:'travel_approval',message};};
const same=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
const postcode=j=>String(j.customer?.postcode||'').replace(/\s/g,'').toUpperCase();
const areas=j=>Math.max(Array.isArray(j.brief?.rooms)?j.brief.rooms.length:0,Object.keys(j.rooms||{}).length);
function check(j){
 const c=j.travelCheck||{};
 if(c.roadMiles===''||c.roadMiles==null||!Number.isFinite(Number(c.roadMiles))||Number(c.roadMiles)<0||Number(c.roadMiles)>1000||!c.routeChecked)fail('Check the one-way road mileage from the shop before booking this single-area measure.');
 if(!postcode(j)||c.postcode!==postcode(j))fail('Check the road mileage for this customer postcode.');
 const required=areas(j)===1&&Number(c.roadMiles)>20;
 if(required){if(!String(c.roughSizes||'').trim()||!c.customerInformed)fail('Record rough sizes and explain the full estimated price, including travel, before requesting approval.');for(const k of ['shopEstimate','fitterEstimate','fitterTravel'])if(c[k]===''||c[k]==null||!Number.isFinite(Number(c[k]))||Number(c[k])<0)fail('Enter materials/shop services, fitting and additional fitter travel estimates, using zero if none.');if(Number(c.shopEstimate)+Number(c.fitterEstimate)<=0)fail('Give the customer an estimated price before requesting a visit.');}
 return required;
}
function assertQuote(j,q){if(j.travelReview?.state!=='approved'||areas(j)!==1)return;const lines=(q?.lines||[]).filter(l=>l.key==='travel'||/distance.*travel|travel.*distance/i.test(l.label||''));if(lines.length!==1||Number(lines[0].price)!==40)fail('Include the agreed £40 distance travel charge exactly once in the quote.');}
function guard(before,j){
 if(before){
  if(!before.travelCheck&&!before.travelReview&&j.travelCheck){guard(null,j);return;}
  const newVisit=Object.entries(j.pre||{}).some(([k,v])=>v.status==='booked'&&!before.pre?.[k]);if(newVisit&&areas(j)===1&&!j.travelCheck)fail('Check road mileage using Book a measure before sending this single-area job to the estimator.');
  if(!same(before.travelReview,j.travelReview)||!same(before.travelCheck,j.travelCheck))fail('Use the travel approval controls; keep the original assessment and decision.');
  if(j.travelCheck&&postcode(before)!==postcode(j))fail('This postcode has a travel decision. Ask the owner to review the journey before changing the address.');
  if(areas(j)===1&&j.travelReview&&j.travelReview.state!=='approved'&&Object.values(j.pre||{}).some(v=>v.status==='booked'))fail('Owner approval is required before this measure can enter a diary.');
  if(j.travelReview?.state==='approved')for(const [k,q] of Object.entries(j.quotes||{}))if(!same(before.quotes?.[k],q))assertQuote(j,q);
  return;
 }
 if(j.travelReview&&j.travelReview.state!=='pending')fail('Only the owner can approve distant measures.');
 const hasVisit=Object.values(j.pre||{}).some(v=>v.status==='booked');
 if(areas(j)===1&&(j.source==='measure'||hasVisit||j.travelReview)){
  const distant=check(j);
  if(distant){if(hasVisit||j.travelReview?.state!=='pending'||!Object.keys(j.travelReview?.requestedVisits||{}).length)fail('Save this distant single-area measure for owner approval, without booking it.');}
  else if(j.travelReview)fail('This journey does not require distance approval.');
 }
}
function make({st,L,now,broadcast}){
 const staff=u=>{if(!['shop','owner'].includes(u.role))throw {status:403,message:'Shop access only.'};};
 function list(u){staff(u);return {owner:u.role==='owner',rows:st.list('jobs').filter(r=>r.data.status==='open'&&r.data.travelReview).map(r=>({id:r.id,ref:r.data.ref,customer:r.data.customer,check:r.data.travelCheck,review:r.data.travelReview,test:!!r.data.test}))};}
 function decide(u,b){if(u.role!=='owner')throw {status:403,message:'Only David’s owner account can approve or decline a distant measure.'};const d=docPath('jobs/'+b.id),j=st.getDoc(d?.path).data;if(!j?.travelReview)fail('Measure approval request not found.');if(j.travelReview.state!=='pending')return {ok:true,duplicate:true};if(!['approve','decline'].includes(b.action))fail('Choose approve or decline.');if(!String(b.reason||'').trim())fail('Record a reason for your decision.');if(!check(j))fail('The request no longer matches the distance rule.');
  const at=new Date(now()).toISOString(),review={...j.travelReview,state:b.action==='approve'?'approved':'declined',by:u.id,byName:u.name,at,reason:String(b.reason).trim().slice(0,1000),fee:b.action==='approve'?40:0},pre=j.pre||{};
  st.updateDoc(d,{travelReview:review,pre,log:{['travel_'+now()]:{at,by:u.id,text:review.state+' distant single-area measure: '+review.reason}}});st.audit(u.id,'distant measure '+review.state,b.id);broadcast('jobs');return {ok:true};
 }
 return {list,decide};
}
module.exports={make,guard,check,assertQuote,areas};

