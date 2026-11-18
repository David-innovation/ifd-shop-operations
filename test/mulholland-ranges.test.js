const test=require('node:test'),assert=require('node:assert/strict');
const rows=require('../lib/mulholland-ranges').list();
test('John Mulholland uses exact owner prices without formula markups',()=>{
 assert.deepEqual(rows.map(r=>[r.cost,r.sellingPrice]),[[6.5,15.99],[11.99,22],[4.5,10.99],[15,29.99],[22,38.99]]);
 assert.equal(new Set(rows.map(r=>r.id)).size,5);
 for(const r of rows){assert.equal(r.pricingVerified,true);assert.equal(r.ready,false);assert.equal(r.coverage,null);assert.equal(r.stockQuantity,undefined);}
});
test('supplier import keeps SPC Yukon separate from AW carpet and hides costs from staff',()=>{
 const all=require('../lib/supplier-ranges').list();assert.equal(all.filter(r=>r.supplier==='John Mulholland').length,5);
 assert.equal(all.find(r=>r.id==='mulholland-yukon-spc').type,'SPC click vinyl');
 assert.equal(all.find(r=>r.id==='aw-yukon').category,'carpet');
 const p=require('../lib/owner-finance'),staff=p.redact(rows);assert.equal(p.hasPrivate(staff),false);
 assert.deepEqual(staff.map(r=>r.sellingPrice),[15.99,22,10.99,29.99,38.99]);
});

