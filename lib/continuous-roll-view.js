'use strict';
// Presentation only: preserve every approved piece, orientation and cut identifier.
function rolls(plan){
 const groups=new Map();
 for(const b of plan.bins||[]){
  const key=JSON.stringify([b.material||plan.material,b.w,b.batch||'']);
  const r=groups.get(key)||{id:'Continuous '+(b.w/100).toFixed(2)+'m roll',material:b.material||plan.material,w:b.w,l:0,pieces:[],segments:[]};
  r.segments.push({id:b.id,start:r.l,length:b.l});
  r.pieces.push(...b.pieces.map(p=>({...p,name:b.id+' · '+p.name,y:p.y+r.l})));
  r.l+=b.l;groups.set(key,r);
 }
 return [...groups.values()];
}
module.exports={rolls};
