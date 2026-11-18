const test=require('node:test'),assert=require('node:assert/strict');
const rows=require('../lib/canopy-ranges').list(),source=require('../lib/canopy-prices.json');
test('Canopy imports all unique products at agreed pack-rate pricing',()=>{
 assert.equal(rows.length,164);assert.equal(new Set(rows.map(r=>r.id)).size,164);
 for(const [category,count] of Object.entries({laminate:29,lvt:32,engineered:87,solid:16}))assert.equal(rows.filter(r=>r.category===category).length,count);
 for(const r of rows){assert.equal(r.sellingPrice,Math.round((r.cost*1.2+(r.category==='laminate'?10:20)+Number.EPSILON)*100)/100);assert.ok(r.ready);assert.ok(r.coverage>0);assert.equal(r.roll,false);assert.match(r.stockStatus,/Not counted/);}
});
test('Canopy preserves supplier codes, coverage and separate pallet costs',()=>{
 for(const s of source){const r=rows.find(r=>r.id===s.id);assert.equal(r.code,s.code);assert.equal(r.coverage,s.coverage);assert.equal(r.palletCost,s.palletCost);assert.equal(r.packsPerPallet,s.packsPerPallet);assert.ok(r.name.includes(s.pattern));}
 assert.ok(rows.some(r=>r.palletQuantityCheck));
 assert.equal(require('../lib/supplier-ranges').list().filter(r=>r.supplier==='Canopy').length,164);
});
test('staff catalogue retains selling prices but removes all supplier cost fields',()=>{
 const privacy=require('../lib/owner-finance'),publicRows=privacy.redact(rows);
 assert.equal(privacy.hasPrivate(publicRows),false);
 for(let i=0;i<rows.length;i++){assert.equal(publicRows[i].sellingPrice,rows[i].sellingPrice);assert.equal(publicRows[i].coverage,rows[i].coverage);for(const key of ['cost','palletCost','packCost','palletTotalCost','formula'])assert.equal(publicRows[i][key],undefined);}
});
