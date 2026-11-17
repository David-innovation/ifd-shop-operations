'use strict';
const rows=require('./abingdon-prices.json'),{price}=require('./furlong-ranges');
function list(){return rows.map(row=>{
 const roll=['carpet','vinyl'].includes(row.category),rollOnly=['Stainfree Euphoria','Stainfree Majesty','Love Story Mosaic Felt'].includes(row.name),cost=rollOnly?row.rollCost:row.cost,pricingVerified=Number.isFinite(cost)&&row.category!=='accessory';
 const type={carpet:'Carpet roll',vinyl:'Sheet vinyl roll',laminate:'Laminate',engineered:'Engineered wood',accessory:'Accessory'}[row.category]||(/Click/.test(row.name)?'LVT click vinyl':'LVT glue-down');
 return {...row,cost,rollOnly,priceBasis:rollOnly?'roll':row.priceBasis,displayName:row.name.replace('Hbone','Herringbone'),type,roll,widths:row.widths||[],ready:pricingVerified&&!!(roll?row.widths?.length:row.coverage),pricingVerified,
 sellingPrice:pricingVerified?price(cost,row.category):null,
 formula:pricingVerified?`${rollOnly?'Roll':roll?'Cut-length':'Pack-rate'} cost per m² × 1.20 + £${['lvt','engineered'].includes(row.category)?20:10}/m²`:null,
 note:rollOnly?'Roll-only range stocked by the shop; quantity awaiting stocktake.':row.category==='accessory'?'Supplier cost saved; selling price needs confirmation.':'',
 stockStatus:rollOnly?'Stocked — quantity not counted':'Not counted — supplier range'};
});}
module.exports={list};
