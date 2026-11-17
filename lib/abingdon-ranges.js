'use strict';
const rows=require('./abingdon-prices.json'),{price}=require('./furlong-ranges');
function list(){return rows.map(row=>{
 const roll=['carpet','vinyl'].includes(row.category),pricingVerified=Number.isFinite(row.cost)&&row.category!=='accessory';
 const type={carpet:'Carpet roll',vinyl:'Sheet vinyl roll',laminate:'Laminate',engineered:'Engineered wood',accessory:'Accessory'}[row.category]||(/Click/.test(row.name)?'LVT click vinyl':'LVT glue-down');
 return {...row,displayName:row.name.replace('Hbone','Herringbone'),type,roll,widths:row.widths||[],ready:pricingVerified&&!!(roll?row.widths?.length:row.coverage),pricingVerified,
 sellingPrice:pricingVerified?price(row.cost,row.category):null,
 formula:pricingVerified?`${roll?'Cut-length':'Pack-rate'} cost per m² × 1.20 + £${['lvt','engineered'].includes(row.category)?20:10}/m²`:null,
 note:row.cost===null?'No cut price supplied. Confirm selling price before quoting.':row.category==='accessory'?'Supplier cost saved; selling price needs confirmation.':'',
 stockStatus:'Not counted — supplier range'};
});}
module.exports={list};
