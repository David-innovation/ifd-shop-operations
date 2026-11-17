'use strict';
// A linked cupboard is part of one piece, never an independently packed offcut.
const D=require('./room-drawing'),S=require('./cutting-shapes');
function groups(rooms){
 const result=[],seen=new Set();
 for(const key of Object.keys(rooms)){if(rooms[key].gone||seen.has(key))continue;const keys=[],queue=[key];
  while(queue.length){const k=queue.shift();if(seen.has(k))continue;seen.add(k);keys.push(k);for(const d of rooms[k].drawing?.doors||[])if(d.intoCupboard){const [other,id]=(d.partner||'').split(':');const r=rooms[other],back=r?.drawing?.doors?.find(x=>x.id===id);if(!r||r.gone||!back?.intoCupboard||back.partner!==k+':'+d.id)throw Error('Link both sides of the cupboard doorway before cutting.');queue.push(other);}}
  if(keys.length>1)result.push(keys);
 }return result;
}
function piece(rooms,keys){
 const nodes=new Map(keys.map(k=>{const r=rooms[k],m=D.measure(r.drawing);if(!m.valid)throw Error(r.name+': '+m.reason);if(r.hsl||r.walkinStairs)throw Error('Review continuous cupboard carpet beside stairs manually.');const direction=r.drawing.direction||'';if(direction&&!/^(down|top to bottom|top-to-bottom|↓|Same pile direction as .+; continue carpet into cupboard\.)$/i.test(direction))throw Error('Confirm the same top-to-bottom pile direction for '+r.name);return[k,{r,m,x:null,y:null}];}));
 const opening=(n,d)=>{const a=n.m.vertices[d.wall],b=n.m.vertices[(d.wall+1)%n.m.vertices.length];if(!a||!b||d.offset==null)throw Error('Set the exact cupboard doorway position.');const len=Math.hypot(b.x-a.x,b.y-a.y);if(d.offset<0||d.width<=0||d.offset+d.width>len+.001)throw Error('Check cupboard doorway width and position.');const t=(d.offset+d.width/2)/len;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,dx:(b.x-a.x)/len,dy:(b.y-a.y)/len};};
 const root=nodes.get(keys[0]);root.x=0;root.y=0;const queue=[keys[0]];
 while(queue.length){const k=queue.shift(),n=nodes.get(k);for(const d of n.r.drawing.doors.filter(d=>d.intoCupboard)){const [other,id]=d.partner.split(':'),o=nodes.get(other),od=o.r.drawing.doors.find(d=>d.id===id),a=opening(n,d),b=opening(o,od);if(Math.abs(a.dx+b.dx)>.001||Math.abs(a.dy+b.dy)>.001)throw Error('Align bedroom and cupboard drawings in the same pile direction; do not rotate or reverse carpet.');if(Math.abs(d.width-od.width)>.001||(n.r.drawing.level||'')!==(o.r.drawing.level||''))throw Error('Check the linked cupboard doorway and floor.');const x=n.x+a.x-b.x,y=n.y+a.y-b.y;if(o.x!==null){if(Math.hypot(o.x-x,o.y-y)>.001)throw Error('Conflicting cupboard doorway positions.');}else{o.x=x;o.y=y;queue.push(other);}}}
 const raw=[];let netArea=0;
 for(const n of nodes.values()){const shape=S.fromDrawing({...n.r.drawing,direction:'down'});if(shape.conservative)throw Error('Review the angled continuous cupboard cut manually.');const minX=Math.min(...n.m.vertices.map(p=>p.x)),minY=Math.min(...n.m.vertices.map(p=>p.y));raw.push(...shape.rects.map(r=>({...r,x:r.x+Math.round((n.x+minX)*100),y:r.y+Math.round((n.y+minY)*100)})));netArea+=n.m.area;}
 const x=Math.min(...raw.map(r=>r.x)),y=Math.min(...raw.map(r=>r.y)),rects=S.union(raw.map(r=>({...r,x:r.x-x,y:r.y-y}))),outlines=S.outlines(rects);if(outlines.length!==1)throw Error('The cupboard must connect to the bedroom as one continuous shape.');
 const w=Math.max(...rects.map(r=>r.x+r.w)),l=Math.max(...rects.map(r=>r.y+r.l));
 return{id:keys[0],source:keys[0],sources:keys,name:keys.map(k=>rooms[k].name).join(' + ')+' — ONE PIECE / NO JOIN',width:w/100,length:l/100,shape:{version:1,allowanceCm:5,rects,outlines,w,l,area:rects.reduce((n,r)=>n+r.w*r.l,0),netArea:Math.round(netArea*100)/100,continuous:true}};
}
function combine(rooms,pieces){for(const keys of groups(rooms)){const own=pieces.filter(p=>keys.includes(p.source));if(own.length!==keys.length)throw Error('Every continuous-carpet area needs one measured room outline.');const p=piece(rooms,keys);pieces=pieces.filter(p=>!keys.includes(p.source));pieces.push(p);}return pieces;}
module.exports={groups,piece,combine};
