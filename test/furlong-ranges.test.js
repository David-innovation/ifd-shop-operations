'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {list,price}=require('../lib/furlong-ranges');
test('confirmed margin is added after VAT, with laminate separate from LVT and wood',()=>{
  for(const category of ['carpet','vinyl','laminate']) assert.equal(price(10,category),22);
  for(const category of ['lvt','engineered']) assert.equal(price(10,category),32);
  assert.equal(price(10.21,'carpet'),22.25);
  assert.equal(price(19.60,'lvt'),43.52);
});
test('unconfirmed accessory and carpet tile margins remain unpriced',()=>{
  assert.equal(price(10,'accessory'),null);
  assert.equal(price(10,'carpet-tile'),null);
});
test('all extracted ranges preserve the supplied cost and do not invent stock',()=>{
  const rows=list();assert.equal(rows.length,181);
  assert.equal(new Set(rows.map(r=>r.id)).size,181);
  assert.equal(rows.filter(r=>r.pricingVerified).length,126);
  for(const row of rows){
    assert.equal(row.stockStatus,'Not counted — supplier range');
    assert.equal(row.stockQuantity,undefined);
    if(row.category==='carpet'||row.category==='vinyl')assert.equal(row.priceBasis,'cut');
  }
});
