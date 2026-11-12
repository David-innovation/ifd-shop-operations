'use strict';
function cleanPlan(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Check the room plan.');
 const text=(v,n=150)=>{if(typeof v!=='string'||v.length>n)throw Error('Check the room plan text.');return v.trim();};
 const num=(v,max=30)=>{if(v===''||v==null)return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>max)throw Error('Check the room plan measurements.');return n;};
 const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw Error('Too many room plan entries.');return v;};
 const shape=text(p.shape||'rectangle');if(!['rectangle','lshape','other','stairs'].includes(shape))throw Error('Choose a room shape.');
 return {shape,direction:text(p.direction||''),walls:list(p.walls||[],30).map(w=>({label:text(w.label||''),length:num(w.length)})),doors:list(p.doors||[],20).map(d=>{const bar=text(d.bar||'unknown');if(!['unknown','no','cc','cf','ff'].includes(bar))throw Error('Choose the door bar requirement.');return {wall:text(d.wall||''),position:text(d.position||''),width:num(d.width,5),bar,product:text(d.product||''),finish:text(d.finish||'')};}),turns:list(p.turns||[],20).map(t=>{const count=num(t.count,100);if(count!==null&&!Number.isInteger(count))throw Error('Turning steps must be a whole number.');return {name:text(t.name||''),count,width:num(t.width),depth:num(t.depth),note:text(t.note||'',500)};})};
}
function summary(p){if(!p)return '';return [ 'Room shape: '+p.shape, p.direction&&'Laying / pile direction: '+p.direction,...(p.walls||[]).map(w=>'Wall '+w.label+': '+(w.length==null?'not measured':w.length+'m')),...(p.doors||[]).map((d,i)=>'Door '+(i+1)+': wall '+(d.wall||'?')+'; '+(d.position||'position not recorded')+'; width '+(d.width==null?'not measured':d.width+'m')+'; '+({unknown:'bar to confirm',no:'no bar needed',cc:'carpet-to-carpet bar',cf:'carpet-to-flooring bar',ff:'flooring-to-flooring bar'}[d.bar])+'; '+[d.product,d.finish].filter(Boolean).join(' ')),...(p.turns||[]).map(t=>t.name+': '+(t.count??'?')+' turning steps; width '+(t.width??'?')+'m; maximum depth '+(t.depth??'?')+'m; '+t.note)].filter(Boolean).join('\n');}
module.exports={cleanPlan,summary};
