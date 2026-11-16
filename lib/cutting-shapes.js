'use strict';
// Rectilinear cutting masks in integer centimetres. No rotation or mirroring.
const D=require('./room-drawing');
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.l&&b.y<a.y+a.l;
function union(rects){
 const ys=[...new Set(rects.flatMap(r=>[r.y,r.y+r.l]))].sort((a,b)=>a-b),out=[];
 for(let k=0;k<ys.length-1;k++){const y=ys[k],l=ys[k+1]-y,spans=rects.filter(r=>r.y<=y&&r.y+r.l>=y+l).map(r=>[r.x,r.x+r.w]).sort((a,b)=>a[0]-b[0]),merged=[];
  for(const s of spans){const last=merged.at(-1);if(last&&s[0]<=last[1])last[1]=Math.max(last[1],s[1]);else merged.push(s.slice());}
  for(const [x,end] of merged){const prev=out.find(r=>r.x===x&&r.w===end-x&&r.y+r.l===y);if(prev)prev.l+=l;else out.push({x,y,w:end-x,l});}
 }return out;
}
function outlines(rects){
 const xs=[...new Set(rects.flatMap(r=>[r.x,r.x+r.w]))].sort((a,b)=>a-b),ys=[...new Set(rects.flatMap(r=>[r.y,r.y+r.l]))].sort((a,b)=>a-b),edges=new Map(),key=p=>p.x+','+p.y;
 const edge=(a,b)=>{const reverse=key(b)+'>'+key(a);if(edges.has(reverse))edges.delete(reverse);else edges.set(key(a)+'>'+key(b),{a,b});};
 for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){const x=xs[i],y=ys[j],right=xs[i+1],bottom=ys[j+1];if(!rects.some(r=>x>=r.x&&right<=r.x+r.w&&y>=r.y&&bottom<=r.y+r.l))continue;const a={x,y},b={x:right,y},c={x:right,y:bottom},d={x,y:bottom};edge(a,b);edge(b,c);edge(c,d);edge(d,a);}
 const paths=[];while(edges.size){const first=edges.values().next().value,path=[first.a];let at=first.a;for(let n=0;n<10000;n++){const entry=[...edges].find(([,e])=>key(e.a)===key(at));if(!entry)throw Error('Cutting outline could not be traced.');edges.delete(entry[0]);at=entry[1].b;if(key(at)===key(path[0]))break;path.push(at);}
  let changed=true;while(changed&&path.length>4){changed=false;for(let i=0;i<path.length;i++){const a=path[(i+path.length-1)%path.length],b=path[i],c=path[(i+1)%path.length];if((a.x===b.x&&b.x===c.x)||(a.y===b.y&&b.y===c.y)){path.splice(i,1);changed=true;break;}}}paths.push(path);
 }return paths;
}
function fromDrawing(drawing){
 const p=D.clean(drawing),m=D.measure(p);if(!m.valid)throw Error(m.reason);
 if(p.direction&&!/^(down|top to bottom|top-to-bottom|↓)$/i.test(p.direction))throw Error('Confirm pile runs from top to bottom of this drawing before shape nesting.');
 if(m.vertices.some((a,i)=>{const b=m.vertices[(i+1)%m.vertices.length];return Math.abs(a.x-b.x)>1e-7&&Math.abs(a.y-b.y)>1e-7;}))throw Error('Wall measurements must close exactly before nesting the shape.');
 const minX=Math.min(...m.vertices.map(p=>p.x)),minY=Math.min(...m.vertices.map(p=>p.y)),v=m.vertices.map(p=>({x:(p.x-minX)*100,y:(p.y-minY)*100}));
 const ys=[...new Set(v.map(p=>p.y))].sort((a,b)=>a-b),rects=[];
 for(let k=0;k<ys.length-1;k++){const y=ys[k],bottom=ys[k+1],mid=(y+bottom)/2,xs=[];for(let i=0;i<v.length;i++){const a=v[i],b=v[(i+1)%v.length];if(a.x===b.x&&mid>Math.min(a.y,b.y)&&mid<Math.max(a.y,b.y))xs.push(a.x);}xs.sort((a,b)=>a-b);if(xs.length%2)throw Error('Check the room shape.');for(let i=0;i<xs.length;i+=2){const x=Math.floor(xs[i]+1e-7),right=Math.ceil(xs[i+1]-1e-7),top=Math.floor(y+1e-7),end=Math.ceil(bottom-1e-7);rects.push({x,y:top,w:right-x+10,l:end-top+10});}}
 // Translation by +5 means [x-5,x+w+5] becomes [x,x+w+10].
 // Every exposed edge has at least 5cm trim allowance; recesses shrink accordingly.
 const mask=union(rects),w=Math.max(...mask.map(r=>r.x+r.w)),l=Math.max(...mask.map(r=>r.y+r.l));
 return {version:1,allowanceCm:5,rects:mask,outlines:outlines(mask),w,l,area:mask.reduce((n,r)=>n+r.w*r.l,0),netArea:m.area};
}
const rects=p=>p.shape?.rects||[{x:0,y:0,w:p.w,l:p.l}];
const absolute=p=>rects(p).map(r=>({...r,x:r.x+p.x,y:r.y+p.y}));
function fits(piece,x,y,bin){if(x<0||y<0||x+piece.w>bin.w||y+piece.l>bin.l)return false;const proposed=rects(piece).map(r=>({...r,x:r.x+x,y:r.y+y}));return !bin.pieces.some(p=>absolute(p).some(a=>proposed.some(b=>overlap(a,b))));}
function free(bin){let space=[{x:0,y:0,w:bin.w,l:bin.l}];for(const p of bin.pieces)for(const cut of absolute(p)){const next=[];for(const r of space){if(!overlap(r,cut)){next.push(r);continue;}const x=Math.max(r.x,cut.x),y=Math.max(r.y,cut.y),right=Math.min(r.x+r.w,cut.x+cut.w),bottom=Math.min(r.y+r.l,cut.y+cut.l);if(y>r.y)next.push({x:r.x,y:r.y,w:r.w,l:y-r.y});if(bottom<r.y+r.l)next.push({x:r.x,y:bottom,w:r.w,l:r.y+r.l-bottom});if(x>r.x)next.push({x:r.x,y,w:x-r.x,l:bottom-y});if(right<r.x+r.w)next.push({x:right,y,w:r.x+r.w-right,l:bottom-y});}space=next;}return union(space);}
function nest(pieces,widths,baseline){
 let best={cost:Math.round(baseline.area*10000),bins:baseline.bins},attempts=0,limited=false;
 const placed=(p,x,y)=>({id:p.id,name:p.name,source:p.source||'',x,y,w:p.w,l:p.l,pile:'down',...(p.shape?{shape:p.shape}:{})});
 for(const sorter of [(a,b)=>b.l-a.l||b.w-a.w,(a,b)=>(b.shape?.area||b.w*b.l)-(a.shape?.area||a.w*a.l)]){
  let states=[{cost:0,bins:[]}];for(const p of [...pieces].sort((a,b)=>sorter(a,b)||a.id.localeCompare(b.id))){const next=[];
   for(const state of states){for(let bi=0;bi<state.bins.length;bi++){const bin=state.bins[bi],xs=new Set([0,bin.w-p.w]),ys=new Set([0,bin.l-p.l]),own=rects(p);
    for(const other of bin.pieces)for(const a of absolute(other))for(const b of own){xs.add(a.x+a.w-b.x);xs.add(a.x-b.x-b.w);ys.add(a.y+a.l-b.y);ys.add(a.y-b.y-b.l);}
    const xx=[...xs].filter(x=>x>=0&&x+p.w<=bin.w).sort((a,b)=>a-b),yy=[...ys].filter(y=>y>=0&&y+p.l<=bin.l).sort((a,b)=>a-b);let added=0;
    outer:for(const y of yy)for(const x of xx){if(++attempts>150000){limited=true;break outer;}if(!fits(p,x,y,bin))continue;const bins=state.bins.slice();bins[bi]={...bin,pieces:[...bin.pieces,placed(p,x,y)]};next.push({cost:state.cost,bins});if(++added>=4)break outer;}
   }
   for(const w of widths)if(p.w<=w){const l=Math.ceil(p.l/10)*10,cost=state.cost+w*l;if(cost<=best.cost)next.push({cost,bins:[...state.bins,{w,l,pieces:[placed(p,0,0)]}]});}
   }next.sort((a,b)=>a.cost-b.cost||a.bins.length-b.bins.length);const seen=new Set();states=[];for(const s of next){const k=JSON.stringify(s.bins.map(b=>[b.w,b.l,b.pieces.map(p=>[p.id,p.x,p.y])]));if(seen.has(k))continue;seen.add(k);states.push(s);if(states.length===8)break;}if(limited||!states.length)break;
  }const complete=states.filter(s=>s.bins.reduce((n,b)=>n+b.pieces.length,0)===pieces.length);if(complete[0]&&complete[0].cost<best.cost)best=complete[0];if(limited)break;
 }
 // Preserve actual shapes even when the conservative rectangular arrangement wins.
 const byId=new Map(pieces.map(p=>[p.id,p]));best.bins=best.bins.map((b,i)=>{const bin={...b,id:'CUT '+(i+1),pieces:b.pieces.map(p=>({...p,...(byId.get(p.id).shape?{shape:byId.get(p.id).shape}:{})}))};bin.free=free(bin);return bin;});
 const used=pieces.reduce((n,p)=>n+(p.shape?.area||p.w*p.l),0);return {...baseline,area:best.cost/10000,bins:best.bins,pieceArea:used/10000,waste:(best.cost-used)/10000,saving:baseline.baselineArea?Math.round((baseline.baselineArea-best.cost/10000)*100)/100:null,rectangularArea:baseline.area,shapeSaving:Math.round((baseline.area-best.cost/10000)*100)/100,shapeNesting:true,searchLimited:limited,allowances:'Shaped rooms / landings: at least 5cm beyond EVERY exposed edge (10cm overall); recesses reduced by the same allowance. Straight stairs: +5cm along pile, +10cm width. Turning blanks: +10cm each direction. Included already. No rotation, reversal, mirroring or added joins. Trace the numbered shape edges, NOT its outer rectangle.'};
}
module.exports={fromDrawing,union,outlines,rects,absolute,fits,free,nest};
