'use strict';
const statement='I have reviewed the work with the fitter. My choice and any outstanding issues below reflect what I have seen today. Signing does not waive my statutory rights or cover defects that are not apparent today.';
function validate(b){
 const fail=m=>{throw {status:400,code:'signoff',message:m};};
 if(!['clear','issues'].includes(b.outcome))fail('Choose completed or issue needs attention.');
 const note=String(b.note||'').trim();if(note.length>2000)fail('Keep the issue details under 2,000 characters.');
 if(b.outcome==='issues'&&!note)fail('Explain what needs attention.');
 const name=String(b.name||'').trim(),reason=String(b.reason||'').trim();
 if(name.length>100||reason.length>500)fail('The name or reason is too long.');
 const strokes=b.strokes||[];
 if(!Array.isArray(strokes)||strokes.length>100||JSON.stringify(strokes).length>60000)fail('Please clear the signature and sign again.');
 let points=0;for(const s of strokes){if(!Array.isArray(s)||s.length<2||s.length>2000)fail('Please sign again.');for(const p of s){if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))fail('Invalid signature.');points++;}}
 if(points>5000)fail('Please clear the signature and sign again.');
 if(strokes.length){if(!name||b.agreed!==true)fail('The customer must enter their name and confirm the statement.');if(reason)fail('Choose a signature or a reason it is unavailable.');}
 else if(!reason)fail('Ask the customer to sign, or record why they cannot sign.');
 return {outcome:b.outcome,note,name,reason,strokes,statement,version:1,signed:strokes.length>0};
}
module.exports={statement,validate};
