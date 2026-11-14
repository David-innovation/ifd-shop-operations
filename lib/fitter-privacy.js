'use strict';
// Defence in depth for the restricted diary. Quantities and work instructions stay;
// customer/shop financial records never belong in a fitter response.
const privateKey=/^(?:price|prices|rates?|amount|cost|total|subtotal|net|gross|vat|discount|balance|paid|shopTotal|fitTotal|fittingPackage|arrangement|deliveryFee|quotes?|invoices?|payments?|pay|ledger|charges|financial|unitPrice|packPrice|priceM2|costPrice|sellPrice)$/i;
function project(value){
 if(Array.isArray(value))return value.map(project);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey.test(key)).map(([key,item])=>[key,project(item)]));
 // Older operational notes may contain customer prices. Never expose those figures.
 if(typeof value==='string')return value.replace(/(?:£\s*|\bGBP\s*)\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:pounds|GBP)\b/gi,'[price held by shop]');
 return value;
}
module.exports={project};
