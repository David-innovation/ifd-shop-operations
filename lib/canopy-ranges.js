'use strict';
const rows=require('./canopy-prices.json');
const margins={laminate:10,lvt:20,engineered:20,solid:20};
function list(){return rows.map(r=>({...r,
 name:r.name+' — '+r.pattern+' — '+r.dimensions,
 colour:r.finish,
 type:r.category==='laminate'?'Laminate':r.category==='lvt'?'SPC click vinyl':r.category==='solid'?'Solid wood':'Engineered wood',
 roll:false,widths:[],ready:r.coverage>0,pricingVerified:true,
 sellingPrice:Math.round(Math.round(r.cost*100)*1.2+margins[r.category]*100)/100,
 formula:'Pack-rate cost per m² × 1.20 + £'+margins[r.category]+'/m²',
 stockStatus:'Not counted — supplier range',
 palletQuantityCheck:Math.abs(r.coverage*r.packsPerPallet-r.palletArea)>.02?'Confirm supplier pallet coverage before ordering a full pallet.':''
}));}
module.exports={list};
