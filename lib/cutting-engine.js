'use strict';
// Integer-centimetre guillotine packing. Fixed orientation: no piece rotation or pile reversal.
const crypto=require('node:crypto');
const cm=x=>Math.round(Number(x)*100),area=b=>b.w*b.l;
function plan(input){
 const signature=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
 if(!input||!input.material||input.pattern!=='plain'||input.sameBatch!==true||input.pileConfirmed!==true)return {blocked:'Confirm a plain carpet, same dye batch and pile direction before planning.',signature};
 const widths=[...new Set(input.widths||[])].map(cm).filter(w=>[400,500].includes(w));
 if(!widths.length||!Array.isArray(input.pieces)||!input.pieces.length||input.pieces.length>60)return {blocked:'Provide between 1 and 60 measured pieces and available 4m / 5m widths.',signature};
 const pieces=input.pieces.map(p=>({...p,w:cm(p.width),l:cm(p.length)}));
 if(new Set(pieces.map(p=>p.id)).size!==pieces.length||pieces.some(p=>!p.id||!p.name||!Number.isFinite(p.w)||!Number.isFinite(p.l)||p.w<=0||p.l<=0||p.l>3000||p.w>Math.max(...widths)))return {blocked:'A piece is missing measurements, too wide, or has a duplicate label. Review it manually.',signature};
 pieces.sort((a,b)=>b.l-a.l||b.w-a.w||a.id.localeCompare(b.id,undefined,{numeric:true}));
 let beam=[{bins:[],cost:0}];
 for(const p of pieces){const next=[];
 for(const state of beam){
 const options=[];state.bins.forEach((b,bi)=>b.free.forEach((r,ri)=>{if(p.w<=r.w&&p.l<=r.l)options.push({bi,ri});}));
 for(const w of widths)if(p.w<=w)options.push({w});
 for(const o of options){const s={cost:state.cost,bins:state.bins.map(b=>({...b,free:b.free.map(r=>({...r})),pieces:b.pieces.slice()}))};let bi=o.bi,ri=o.ri;
 if(o.w){bi=s.bins.length;ri=0;const l=Math.ceil(p.l/10)*10;s.bins.push({w:o.w,l,pieces:[],free:[{x:0,y:0,w:o.w,l}]});s.cost+=o.w*l;}
 const b=s.bins[bi],r=b.free.splice(ri,1)[0];b.pieces.push({id:p.id,name:p.name,x:r.x,y:r.y,w:p.w,l:p.l,source:p.source||'',pile:'down'});
 // Two non-overlapping offcuts, each cuttable with straight guillotine cuts.
 if(r.w>p.w)b.free.push({x:r.x+p.w,y:r.y,w:r.w-p.w,l:r.l});
 if(r.l>p.l)b.free.push({x:r.x,y:r.y+p.l,w:p.w,l:r.l-p.l});next.push(s);
 }
 }
 next.sort((a,b)=>a.cost-b.cost||a.bins.length-b.bins.length);const seen=new Set();beam=[];for(const s of next){const k=JSON.stringify(s.bins.map(b=>[b.w,b.l,b.free]));if(seen.has(k))continue;seen.add(k);beam.push(s);if(beam.length===64)break;}
 }
 const best=beam[0],used=pieces.reduce((n,p)=>n+p.w*p.l,0),baseline=Number(input.baselineArea)||0;
 return {signature,status:'proposal',material:input.material,area:best.cost/10000,pieceArea:used/10000,waste:(best.cost-used)/10000,baselineArea:baseline,saving:baseline?Math.round((baseline-best.cost/10000)*100)/100:null,bins:best.bins.map((b,i)=>({...b,id:'CUT '+(i+1)})),pieceCount:pieces.length,notes:'Proposal only. Check measurements, allowances, roll availability, dye batch, stair template and pile arrows before approval. No stock or quote changes. This search finds a practical plan; it does not guarantee the absolute minimum.'};
}
function forJob(j){
 const spec=j.cuttingSpec;if(!spec)return null;
 const identities=Object.values(j.rooms||{}).filter(r=>!r.gone).map(r=>r.want||(r.line?j.lines?.[r.line]?.title:null));if(identities.some(x=>!x)||new Set(identities).size!==1)return {blocked:'Assign the same carpet to every room in this plan. Different carpets must be planned separately.'};
 const pieces=[];for(const [key,r] of Object.entries(j.rooms||{})){
  if(r.gone)continue;
  if(r.status!=='verified')return {blocked:'Check and verify every room measurement before planning.'};
  if(r.hsl){for(const part of ['hall','landing']){const x=r.hsl[part];if(x?.on)pieces.push({id:key+'-'+part,name:r.name+' '+part,length:Number(x.len)+0.10,width:Number(x.wid)+0.10,source:key});}if(!r.hsl.stairs?.on)continue;}
  if(r.hsl?.stairs?.on){const st=r.hsl.stairs,sections=r.drawing?.stairs?.length?r.drawing.stairs:[{kind:'straight',count:st.n,width:st.wid,tread:st.tread,riser:st.riser},{kind:'turn',count:st.winders,width:st.wid}];let sn=0,wn=0;for(const section of sections){for(let n=0;n<(section.count||0);n++){if(section.kind==='turn'){const id=key+'-winder-'+(++wn),t=spec.winderTemplates?.[id];if(!t||t.confirmed!==true||!(t.width>0&&t.length>0))return {blocked:'Winders require individually measured templates; enter each turning-step cutting blank before configuring.'};pieces.push({id,name:r.name+' turning step '+wn,length:Number(t.length)+0.10,width:Number(t.width)+0.10,source:key});}else pieces.push({id:key+'-'+(++sn),name:r.name+' stair '+sn,length:(Number(section.tread)+Number(section.riser))/100+0.05,width:Number(section.width)+0.10,source:key});}}}

  else {if(!r.len||!r.wid)return {blocked:'Complete all exact room measurements first.'};pieces.push({id:key,name:r.name,length:Number(r.len)+0.10,width:Number(r.wid)+0.10,source:key});}
 }
 return plan({...spec,pieces});
}
module.exports={plan,forJob};
