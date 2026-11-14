'use strict';
const {docPath}=require('./store');
function make({st,texter,mailer,now,broadcast}){
 let timer,busy=false;const path='settings/textCredit',iso=()=>new Date(now()).toISOString();
 function status(){return st.getDoc(path).data||{state:'unknown',message:'Text credit has not been checked yet.'};}
 async function check(){if(busy)return status();busy=true;try{
  const prev=status();let next;try{const b=await texter.balance();next={balance:b.balance,currency:b.currency,checkedAt:iso(),state:b.balance<=5?'urgent':b.balance<=10?'low':'ok',warning:10,critical:5};}catch(e){next={...prev,state:'unknown',checkedAt:iso(),message:'Could not check Twilio credit. Check the balance in Twilio before relying on texts.'};}
  st.setDoc(docPath(path),next);broadcast('settings');
  if(next.state!=='ok'&&mailer.ready){const day=new Date(now()).toLocaleDateString('en-CA',{timeZone:'Europe/London'});for(const to of ['admin@innovationflooringdirect.com','david@innovationflooringdirect.com']){
   const key=next.state+'_'+day+'_'+to,recPath='textCreditNotices/'+key;if(st.getDoc(recPath).exists)continue;
   st.setDoc(docPath(recPath),{state:'sending',at:iso(),to});
   try{const r=await mailer.send({to,subject:'Floor Pilot: '+(next.state==='urgent'?'urgent — ':'')+'text credit needs attention',text:next.state==='unknown'?next.message:'Twilio text credit is '+next.currency+' '+next.balance.toFixed(2)+'. Please top up in Twilio so customer messages and sign-in codes can continue.\n\nhttps://console.twilio.com/\n\nThis reminder repeats daily while credit remains low. No automatic payment has been made.'});st.updateDoc(docPath(recPath),{state:'sent',ref:r.ref});}catch(e){st.updateDoc(docPath(recPath),{state:e.unsure?'uncertain':'failed'});st.updateDoc(docPath(path),{emailIssue:'Credit reminder email could not be confirmed. Check Twilio directly.'});}
  }}return status();
 }finally{busy=false;}}
 function start(){if(!texter.ready||typeof texter.balance!=='function')return;timer=setInterval(check,15*60*1000);timer.unref();check().catch(()=>{});}function stop(){clearInterval(timer);}
 return {check,status,start,stop};
}
module.exports={make};
