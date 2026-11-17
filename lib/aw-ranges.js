'use strict';
const rows=require('./aw-prices.json');
const special={SIRIUS:39.99,MAGNIFICUS:44.99,YUKON:69.99,ORION:34.99};
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function list(){return rows.flatMap(r=>{
 const verified=Number.isFinite(r.cost),offer={MAGNIFICUS:9.99,SIRIUS:9.99,YUKON:11.99}[r.name];
 const base={...r,sellingPrice:verified?money(r.cost*1.2+10):null,pricingVerified:verified,ready:verified&&r.widths.length>0,formula:'Cut cost (surcharge included) × 1.20 + £10/m²',note:!verified?'No standard cut price supplied. Confirm selling price before quoting.':!r.widths.length?'Confirm width and backing before quoting.':'',volumeOffer:offer?{cost:offer,minimumOrderValue:10000,condition:'Orders over £10,000; confirm eligibility with supplier. Surcharge included.'}:null};
 if(!special[r.name])return [base];
 const stockPrice=money(r.rollCost*1.2+10),orderPrice=money(stockPrice+5.99);
 const common={...base,stockPrice,orderPrice,orderSurcharge:5.99,comparisonPrice:special[r.name],comparisonLabel:'Retail comparison supplied by shop',comparisonSource:'David — 17 November 2026',formula:'Stockist roll cost (surcharge included) × 1.20 + £10/m²; ordered in adds £5.99/m²',stockStatus:'Stock quantities not yet counted; confirm available carpet before choosing stocked price'};
 return [{...common,sellingPrice:orderPrice,pricingSource:'order',stockedId:r.id+'-stocked'}, {...common,id:r.id+'-stocked',parentId:r.id,hiddenPricingVariant:true,sellingPrice:stockPrice,pricingSource:'stock',priceBasis:'stockist roll',cost:r.rollCost}];
 });}
module.exports={list};
