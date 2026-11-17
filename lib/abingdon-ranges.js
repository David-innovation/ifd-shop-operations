'use strict';
const rows=require('./abingdon-prices.json'),{price}=require('./furlong-ranges');
function list(){return rows.flatMap(row=>{
 const roll=['carpet','vinyl'].includes(row.category),rollOnly=['Stainfree Euphoria','Stainfree Majesty','Love Story Mosaic Felt'].includes(row.name),cost=rollOnly?row.rollCost:row.cost,pricingVerified=Number.isFinite(cost)&&row.category!=='accessory';
 const type={carpet:'Carpet roll',vinyl:'Sheet vinyl roll',laminate:'Laminate',engineered:'Engineered wood',accessory:'Accessory'}[row.category]||(/Click/.test(row.name)?'LVT click vinyl':'LVT glue-down');
 const base={...row,cost,rollOnly,priceBasis:rollOnly?'roll':row.priceBasis,displayName:row.name.replace('Hbone','Herringbone'),type,roll,widths:row.widths||[],ready:pricingVerified&&!!(roll?row.widths?.length:row.coverage),pricingVerified,
 sellingPrice:pricingVerified?price(cost,row.category):null,
 formula:pricingVerified?`${rollOnly?'Roll':roll?'Cut-length':'Pack-rate'} cost per m² × 1.20 + £${['lvt','engineered'].includes(row.category)?20:10}/m²`:null,
 note:rollOnly?'Roll-only range stocked by the shop; quantity awaiting stocktake.':row.category==='accessory'?'Supplier cost saved; selling price needs confirmation.':'',
 stockStatus:rollOnly?'Stocked — quantity not counted':'Not counted — supplier range'};
 const prices={'Stainfree Pure Elegance':[24.99,28.25],'Stainfree Cottage Herringbone':[18.99,20.79],'Stainfree Euphoria':[14.99,17.19],'Stainfree Majesty':[15.99,17.19],'Love Story Velvet Dreams':[22.99,27.04]};
 if(row.name==='Artisan Click (LVT)')return [{...base,sellingPrice:34.99,formula:'Shop selling price set by David — 17 November 2026'}];
 const pair=prices[row.name];if(!pair)return [base];
 const [stockPrice,orderPrice]=pair,common={...base,stockPrice,orderPrice,orderSurcharge:Math.round((orderPrice-stockPrice)*100)/100,formula:'Shop stocked and ordered-in selling prices set by David — 17 November 2026'};
 return [{...common,sellingPrice:orderPrice,pricingSource:'order',stockedId:row.id+'-stocked'},{...common,id:row.id+'-stocked',parentId:row.id,hiddenPricingVariant:true,sellingPrice:stockPrice,pricingSource:'stock',cost:row.rollCost??cost}];
});}
module.exports={list};
