'use strict';
// Ramsey's stock-range quotation, 12 November 2025; retail approved by David 18 November 2026.
// August 2026 increase notice covers Primus/Maximus only, not these Fundamentals ranges.
const source=[
 ['dryback-55-plank','Fundamentals Dryback 55 straight plank','Plank',8.99,30.79,3.685,50,false],
 ['dryback-55-parquet','Fundamentals Dryback 55 parquet','Herringbone',9.49,31.39,2.926,50,false],
 ['click-30-plank','Fundamentals Click 30 straight plank','Plank',8.99,30.79,2.20,40,true],
 ['click-30-herringbone','Fundamentals Click 30 herringbone','Herringbone',11.49,33.79,2.223,42,true]
];
module.exports={list:()=>source.map(([id,name,pattern,cost,sellingPrice,coverage,stockBuyPacks,click])=>({
 id:'invictus-'+id,supplier:'Invictus / Associated Weavers',name,pattern,cost,sellingPrice,coverage,
 category:'lvt',type:click?'SPC click vinyl':'LVT glue-down',unit:'m²',roll:false,widths:[],
 ready:false,pricingVerified:true,sheetDate:'2025-11-12',priceBasis:'owner-confirmed',
 formula:'Stock cost per m² × 1.20 + £20/m²',stockBuyPacks,
 stockStatus:'Not counted — stock-buying rates',
 note:'Approved retail price. Exact colour/code requires matching before selection. Supplier quote based on '+stockBuyPacks+' packs; confirm cost for smaller orders.'
}))};
