const test=require('node:test'),assert=require('node:assert/strict');
test('Invictus approved stock rates preserve coverage and private costs',()=>{
 const rows=require('../lib/invictus-ranges').list();
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(r=>r.sellingPrice),[30.79,31.39,30.79,33.79]);
 assert.deepEqual(rows.map(r=>r.coverage),[3.685,2.926,2.2,2.223]);
 for(const r of rows){assert.equal(r.ready,false);assert.equal(r.stockQuantity,undefined);}
 const privacy=require('../lib/owner-finance');assert.equal(privacy.hasPrivate(privacy.redact(rows)),false);
 assert.equal(require('../lib/supplier-ranges').list().filter(r=>r.id.startsWith('invictus-')).length,4);
});
