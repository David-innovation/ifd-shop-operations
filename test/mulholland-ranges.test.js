const test=require('node:test'),assert=require('node:assert/strict');
const rows=require('../lib/mulholland-ranges').list();
test('John Mulholland uses exact owner prices without formula markups',()=>{
 assert.equal(new Set(rows.map(r=>r.id)).size,16);
 for(const [key,cost,price] of [['agt',6.5,15.99],['krono',11.99,22],['step',4.5,10.99],['duoro',15,29.99],['yukon',22,38.99]])for(const r of rows.filter(r=>r.id.startsWith('mulholland-'+key))){assert.equal(r.cost,cost);assert.equal(r.sellingPrice,price);assert.equal(r.stockQuantity,undefined);}
 assert.equal(rows.filter(r=>r.ready).length,14);
 for(const r of rows.filter(r=>r.ready)){assert.equal(r.coverage,r.id.includes('step-')?2.849:r.id.includes('yukon-')?2.269:r.pattern==='Herringbone'?1.8:2.196);assert.ok(r.colour);assert.ok(r.specificationSource);assert.equal(r.integratedUnderlay,r.category==='lvt');}
 for(const r of rows.filter(r=>!r.ready))assert.equal(r.coverage,null);
});
test('supplier import keeps SPC Yukon separate from AW carpet and hides costs from staff',()=>{
 const all=require('../lib/supplier-ranges').list();assert.equal(all.filter(r=>r.supplier==='John Mulholland').length,16);
 assert.equal(all.find(r=>r.id.startsWith('mulholland-yukon-spc')).type,'SPC click vinyl');
 assert.equal(all.find(r=>r.id==='aw-yukon').category,'carpet');
 const p=require('../lib/owner-finance'),staff=p.redact(rows);assert.equal(p.hasPrivate(staff),false);
 assert.deepEqual(staff.map(r=>r.sellingPrice),rows.map(r=>r.sellingPrice));
});

