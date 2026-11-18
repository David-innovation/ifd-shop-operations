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
function list(){return source.map(([id,name,category,cost,sellingPrice])=>({
 id:'mulholland-'+id,supplier:'John Mulholland',name,category,cost,sellingPrice,
 unit:'m²',type:category==='laminate'?'Laminate':'SPC click vinyl',
 roll:false,widths:[],coverage:null,ready:false,pricingVerified:true,
 priceBasis:'owner-confirmed',sheetDate:'2026-11-18',
 formula:'Fixed selling price confirmed by David; no additional markup',
 stockStatus:'Not counted — stocked range, quantities pending',
 note:'Selling price confirmed. Confirm pack coverage and exact colour/product identity before quoting box quantities.'
}));}
module.exports={list};

