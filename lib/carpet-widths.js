'use strict';
const valid=w=>Number.isFinite(Number(w))&&Number(w)>=0.5&&Number(w)<=6;
const clean=ws=>[...new Set((ws||[]).map(Number).filter(valid))].sort((a,b)=>a-b);
function forChoice(c){if(!c)return [];
 const r=c.internalId&&require('./supplier-ranges').list().find(r=>r.id===c.internalId);
 if(r){let widths=clean(r.widths);if(r.colours?.length){const colour=String(c.colour||c.color||c.title?.split(' — ').slice(1).join(' — ')||'').trim().toLowerCase();const matches=r.colours.filter(x=>colour===String(x.code).toLowerCase()||colour===x.name.toLowerCase()||colour===(x.name+' '+x.code).toLowerCase());const colours=matches.length?matches:r.colours;widths=widths.filter(w=>colours.every(x=>x.widths.includes(w)));}return widths;}
 return clean([...(c.widths||[]),c.w]);
}
module.exports={valid,clean,forChoice};
