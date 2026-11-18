const test=require('node:test'),assert=require('node:assert/strict');
const rows=require('../lib/plusfloor-ranges').list();
test('PlusFloor separates 87 glue-down and 28 click options at agreed VAT-inclusive rates',()=>{
 assert.equal(rows.length,115);assert.equal(new Set(rows.map(r=>r.code)).size,115);
 assert.equal(rows.filter(r=>r.integratedUnderlay).length,28);
 for(const r of rows){assert.equal(r.sellingPrice,Math.round(r.cost*120+(r.integratedUnderlay?1500:2000))/100);assert.ok(r.coverage>0);assert.ok(r.colour);assert.ok(r.ready);assert.equal(r.stockQuantity,undefined);}
 for(const [code,price,coverage] of [['PLF7100G',39.14,4.13],['PLF7100GH',40.34,.87],['PLF5201',37.74,2.5],['PLF3080',41.34,1.95],['PLF3080CH',44.94,1.31]]){
 const r=rows.find(r=>r.code===code);assert.equal(r.sellingPrice,price);assert.equal(r.coverage,coverage);}
});
test('shared supplier catalogue includes PlusFloor and protects supplier costs',()=>{
 assert.equal(require('../lib/supplier-ranges').list().filter(r=>r.supplier==='PlusFloor'&&r.category!=='feature-strip').length,115);
 const p=require('../lib/owner-finance'),staff=p.redact(rows);assert.equal(p.hasPrivate(staff),false);
 for(let i=0;i<rows.length;i++){assert.equal(staff[i].sellingPrice,rows[i].sellingPrice);assert.equal(staff[i].coverage,rows[i].coverage);assert.equal(staff[i].cost,undefined);assert.equal(staff[i].formula,undefined);}
});

