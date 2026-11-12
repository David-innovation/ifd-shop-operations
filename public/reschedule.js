'use strict';
window.IFDReschedule={form(j,send,done){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;},box=el('div');box.className='reschedule-form';
 const input=(type,value)=>{const n=el('input');n.type=type;n.value=value||'';n.className='in';return n;};
 const label=(text,n)=>{const l=el('label',text);l.style.display='block';l.style.margin='12px 0';n.style.display='block';n.style.width='100%';l.append(n);return l;};
 const select=(options,value)=>{const n=el('select');n.className='in';for(const [v,t] of options){const o=el('option',t);o.value=v;n.append(o);}n.value=value||options[0][0];return n;};
 const date=input('date',j.newDate||j.date),slot=select(['8-10am','10am-12pm','11am-1pm','1-3pm','2-4pm','3-5pm'].map(s=>[s,s]),j.slot),duration=select([['480','Full day'],['60','1 hour'],['120','2 hours'],['180','3 hours'],['240','4 hours'],['300','5 hours'],['360','6 hours'],['420','7 hours']],String(j.duration||480));
 if(!duration.value){const o=el('option',j.duration+' minutes');o.value=j.duration;duration.append(o);duration.value=j.duration;}
 const reason=select([['','Choose a reason'],...['Customer requested a change','Fitter delayed / previous job overran','Fitter illness / emergency','Materials not ready','Floor preparation / drying needed','No access / room not cleared','Other'].map(x=>[x,x])]),note=el('textarea'),agreed=input('checkbox'),save=el('button','Reschedule and notify customer'),status=el('p');status.setAttribute('role','status');note.maxLength=1000;save.type='button';save.className='pri';agreed.style.width='auto';
 box.append(el('p','Current booking: '+j.date),label('New fitting date',date),label('Arrival window',slot),label('Time needed after arrival',duration),label('Reason for moving',reason),label('Extra details (required for Other)',note),label('Customer has agreed the new date and arrival window',agreed),el('small','The customer receives the new booking details by text and email where available. Your internal reason is kept on the job.'),save,status);
 let key=crypto.randomUUID(),busy=false;
 save.onclick=async()=>{if(busy)return;if(!date.value||!reason.value||!agreed.checked){status.textContent='Choose a date and reason, and confirm customer agreement.';return;}busy=true;save.disabled=true;status.textContent='Saving...';try{const r=await send({jobId:j.id,date:j.date,version:j.version,key,newDate:date.value,slot:slot.value,duration:Number(duration.value),reason:reason.value,note:note.value,agreed:agreed.checked});status.textContent='Job rescheduled.';await done(r);}catch(e){status.textContent=e.message||'Could not save. Please try again.';save.disabled=false;busy=false;}};
 return box;
}};
