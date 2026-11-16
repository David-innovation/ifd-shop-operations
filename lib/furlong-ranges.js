'use strict';
const rows = require('./furlong-prices.json');
// Owner confirmed 16 November 2026. Add the margin AFTER VAT.
const margins = Object.freeze({carpet:10, vinyl:10, laminate:10, lvt:20, engineered:20});
function price(cost, category) {
  if (!Object.hasOwn(margins, category)) return null;
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Invalid supplier cost');
  return Math.round(Math.round(cost * 100) * 1.2 + margins[category] * 100) / 100;
}
function list() {
  return rows.map(row => {const spec=require('./furlong-specs')[row.name]||{},roll=['carpet','vinyl'].includes(row.category),coverage=spec.coverage||row.coverage||Number(row.name.match(/([\d.]+)\s*sq\.m/)?.[1])||null;
    const type=row.category==='carpet'?'Carpet roll':row.category==='vinyl'?'Sheet vinyl roll':row.category==='engineered'?'Engineered wood':row.category==='laminate'?'Laminate':row.category==='lvt'?(/^Endura/.test(row.name)?'SPC click vinyl':'LVT glue-down'):row.category;
    return {...row,...spec,coverage,type,widths:spec.widths||[],roll,
    displayName:row.name.replace(/\s+\d+(?:\.\d+)?x[\s\S]*$/,'').replace(/\s+[\d.]+\s*sq\.m[\s\S]*$/,''),
    integratedUnderlay:/^(Fusion|Uberwood|Endura)/.test(row.name),
    ready:!!(roll?spec.widths?.length:coverage||spec.formats?.length),
    sellingPrice:price(row.cost,row.category),
    formula:Object.hasOwn(margins,row.category)
      ? `${row.priceBasis === 'cut' ? 'Cut-length' : 'Pack-rate'} cost per m² × 1.20 + £${margins[row.category]}/m²`
      : null,
    pricingVerified:Object.hasOwn(margins,row.category),
    stockStatus:'Not counted — supplier range'};});
}
module.exports={list,price,margins};
