'use strict';
const rows=require('./aw-prices.json');
function list(){return rows.map(r=>{const verified=Number.isFinite(r.cost),offer={MAGNIFICUS:9.99,SIRIUS:9.99,YUKON:11.99}[r.name];return {...r,sellingPrice:verified?Math.round((r.cost*1.2+10)*100)/100:null,pricingVerified:verified,ready:verified&&r.widths.length>0,formula:'Cut cost (surcharge included) × 1.20 + £10/m²',note:!verified?'No standard cut price supplied. Confirm selling price before quoting.':!r.widths.length?'Confirm width and backing before quoting.':'',volumeOffer:offer?{cost:offer,minimumOrderValue:10000,condition:'Orders over £10,000; confirm eligibility with supplier. Surcharge included.'}:null};});}
module.exports={list};
