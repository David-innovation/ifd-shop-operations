'use strict';
// David's explicit purchase and retail prices, 18 November 2026.
// Do not apply a formula to these fixed selling prices or infer pack sizes from similar ranges.
const source=[
 ['agt-8mm','AGT 8mm laminate','laminate',6.50,15.99],
 ['krono-amazone-10mm','Krono Amazone 10mm laminate','laminate',11.99,22],
 ['step-click-7mm','Step Click 7mm laminate','laminate',4.50,10.99],
 ['duoro-spc','Duoro SPC','lvt',15,29.99],
 ['yukon-spc','Yukon SPC','lvt',22,38.99]
];
function base(){return source.map(([id,name,category,cost,sellingPrice])=>({
 id:'mulholland-'+id,supplier:'John Mulholland',name,category,cost,sellingPrice,
 unit:'m²',type:category==='laminate'?'Laminate':'SPC click vinyl',
 roll:false,widths:[],coverage:null,ready:false,pricingVerified:true,
 priceBasis:'owner-confirmed',sheetDate:'2026-11-18',
 formula:'Fixed selling price confirmed by David; no additional markup',
 stockStatus:'Not counted — stocked range, quantities pending',
 note:'Selling price confirmed. Confirm pack coverage and exact colour/product identity before quoting box quantities.'
}));}
const website='https://innovationflooringdirect.com';
function list(){
 const rows=base(),out=rows.slice(0,2);
 function variant(baseId,colour,pattern,coverage,path,integratedUnderlay=false){
  const r=rows.find(r=>r.id==='mulholland-'+baseId);
  out.push({...r,id:r.id+'-'+(colour+'-'+pattern).toLowerCase().replace(/[^a-z0-9]+/g,'-'),
   name:(baseId==='duoro-spc'?'Douro SPC':r.name)+' '+colour+' — '+pattern,
   colour,finish:colour,pattern,coverage,integratedUnderlay,ready:true,
   specificationSource:website+path,specificationChecked:'2026-11-18',
   note:'Pack coverage and colour matched to shop website. Physical stock count remains unconfirmed.'});
 }
 for(const colour of ['Nile Oak','Meltem Grey','Poznan Oak','Devine Oak'])variant('step-click-7mm',colour,'Plank',2.849,'/collections/in-stock-flooring-deals/sale-laminate');
 for(const colour of ['Dusty Grey','Glow','Honey','Black Pepper','Peanut'])variant('duoro-spc',colour,'Plank',2.196,'/collections/spc-click-flooring',true);
 for(const colour of ['Dusty Grey','Glow','Honey','Peanut'])variant('duoro-spc',colour,'Herringbone',1.8,'/collections/waterproof-herringbone',true);
 variant('yukon-spc','Silver Grey','Herringbone',2.269,'/products/yukon-silver-grey-herringbone-lvt',true);
 return out;
}
module.exports={list};

