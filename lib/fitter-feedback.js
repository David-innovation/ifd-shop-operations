'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store'),{esc}=require('./quote-email');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function make({st,now,broadcast,baseUrl}){
 const fail=(status,message)=>{throw {status,code:'feedback',message};};
 function issue(job,event){
  const record=job.customerSignoffs?.[event];
  if(job.status!=='done'||!record?.signed||record.outcome!=='clear')fail(409,'Feedback is available after completed customer sign-off.');
  const token=crypto.randomBytes(32).toString('base64url');
  st.setDoc(docPath('feedbackLinks/'+hash(token)),{jobId:job.id,event,fitter:record.fitter||job.fitter,fitterId:job.fitterId||'',expires:now()+90*86400000});
  return baseUrl.replace(/\/$/,'')+'/feedback/'+token;
 }
 function read(token){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail(404,'This feedback link is not available. Please contact the shop.');
  const link=st.getDoc('feedbackLinks/'+hash(token)).data,j=link&&st.getDoc('jobs/'+link.jobId).data;
  if(!j||link.expires<now())fail(410,'This feedback link has expired. Please call 0141 952 5200.');
  if(j.status!=='done'||!j.customerSignoffs?.[link.event]?.signed)fail(409,'This job is still being followed up. Please contact the shop if you need help.');
  return {link,j};
 }
 function submit(token,b){
  const {link,j}=read(token),rating=Number(b.rating),comment=String(b.comment||'').trim(),contact=b.contact==='yes';
  if(!Number.isInteger(rating)||rating<1||rating>5||!String(b.rating||'').match(/^[1-5]$/))fail(400,'Choose a rating from 1 to 5.');
  if(comment.length>2000)fail(400,'Please keep your comments under 2,000 characters.');
  if(j.customerFeedback?.[link.event])return {duplicate:true};
  const at=new Date(now()).toISOString(),month=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit'}).format(new Date(now()));
  st.updateDoc(docPath('jobs/'+link.jobId),{customerFeedback:{[link.event]:{at,month,rating,comment,contact,fitter:link.fitter,fitterId:link.fitterId,needsFollowUp:rating<=3||contact,reviewed:false}},log:{['feedback_'+link.event]:{at,by:'customer',text:'Private fitter feedback received: '+rating+'/5. '+(rating<=3||contact?'Shop follow-up required.':'Ready for monthly review.')}}});
  st.audit('customer','fitter feedback',link.jobId);broadcast('jobs');return {duplicate:false};
 }
 function review(b,user){
  if(!['owner','shop'].includes(user.role))fail(403,'Only shop staff can review customer feedback.');
  const d=docPath('jobs/'+String(b.jobId||'')),j=d&&st.getDoc(d.path).data,r=j?.customerFeedback?.[b.event],note=String(b.note||'').trim();
  if(!r)fail(404,'Feedback not found.');if(r.reviewed)return {duplicate:true};
  if(note.length<3||note.length>2000)fail(400,'Record your review or follow-up in up to 2,000 characters.');
  st.updateDoc(d,{customerFeedback:{[b.event]:{reviewed:true,reviewedAt:new Date(now()).toISOString(),reviewedBy:user.name,reviewNote:note}}});st.audit(user.id,'feedback reviewed',d.path);broadcast('jobs');return {ok:true};
 }
 function page(token){
  const {link,j}=read(token),done=j.customerFeedback?.[link.event],words=st.getDoc('settings/main').data?.words||{};
  const publicReview=()=>'<h2>Share your experience</h2><p>We welcome an honest review from every customer, whatever your rating.</p>'+[['Google',words.reviewUrl],['Facebook',words.facebookReviewUrl]].map(([name,url])=>/^https:\/\/[^\s]+$/.test(url||'')?'<p><a rel="noreferrer" href="'+esc(url)+'">Leave a '+name+' review</a></p>':'<p>Find Innovation Flooring Direct on '+name+' to leave a review or recommendation.</p>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Your fitter feedback | Innovation Flooring Direct</title><style>body{margin:0;background:#eeeae3;color:#171717;font:16px/1.65 Arial}main{max-width:600px;margin:24px auto;background:white;border-top:4px solid #b61930}header{padding:25px;background:#111;color:#fff;text-align:center;letter-spacing:2px}section{padding:28px}h1,h2{font-family:Georgia,serif}h1{font-size:32px}fieldset{border:0;padding:0;margin:20px 0}.ratings{display:flex;gap:8px}.ratings label{flex:1;border:1px solid #c4aa72;padding:12px 4px;text-align:center;border-radius:8px}input[type=radio]{display:block;margin:0 auto 5px;accent-color:#b61930}textarea{width:100%;box-sizing:border-box;min-height:130px;padding:12px;font:inherit}button{width:100%;background:#b61930;color:white;border:0;padding:16px;font:inherit;border-radius:8px;margin-top:20px}a{color:#9e1025}small{color:#666}footer{padding:22px;background:#111;color:white;text-align:center}footer a{color:white}@media(max-width:600px){main{margin:0}section{padding:22px}}</style></head><body><main><header>INNOVATION<br><small style="color:#cfb87d">FLOORING DIRECT</small></header><section>'+
  (done?'<h1>Thank you for your feedback.</h1><p>Your rating and comments have been saved privately for our shop team. They help us improve the service we provide.</p>'+publicReview():
  '<h1>How did your fitter do?</h1><p>Thank you for choosing us. Please tell us about your experience with <strong>'+esc(link.fitter)+'</strong>.</p><p><small>Job reference: '+esc(j.ref||link.jobId)+'. Your feedback goes privately to the shop team; it is not posted publicly.</small></p><form method="post" action="/feedback/'+esc(token)+'"><fieldset><legend>Rate your fitting experience</legend><div class="ratings">'+[1,2,3,4,5].map(n=>'<label><input required type="radio" name="rating" value="'+n+'">'+n+' ★</label>').join('')+'</div><small>1 = Poor · 5 = Excellent</small></fieldset><label for="comment">What went well, and what could we improve?</label><textarea id="comment" name="comment" maxlength="2000" placeholder="Your comments (optional)"></textarea><p><label><input type="checkbox" name="contact" value="yes"> I would like the shop to contact me about this.</label></p><button type="submit">Send my feedback</button></form>')+
  '</section><footer>Innovation Flooring Direct<br>2 South Elgin Place, Clydebank G81 1XP<br><a href="tel:01419525200">0141 952 5200</a> · <a href="mailto:sales@innovationflooringdirect.com">Contact the shop</a></footer></main></body></html>';
 }
 return {issue,read,submit,review,page};
}
module.exports={make};
