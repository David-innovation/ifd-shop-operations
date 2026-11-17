'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const rows=require('../lib/abingdon-ranges').list(),get=n=>rows.find(r=>r.rangeName===n);
test('Abingdon source covers all 68 rows, with no invented prices or stock',()=>{
 assert.equal(rows.length,68);assert.equal(new Set(rows.map(r=>r.id)).size,68);
 assert.equal(rows.filter(r=>r.ready).length,61);
 for(const r of rows){assert.equal(r.stockQuantity,undefined);assert.equal(r.sheetDate,'2026-11-16');}
 for(const n of ['Euphoria','Majesty','Mosaic Felt']){assert.equal(get(n).cost,get(n).rollCost);assert.equal(get(n).sellingPrice,n==='Mosaic Felt'?13.59:17.19);assert.equal(get(n).ready,true);assert.equal(get(n).priceBasis,'roll');}
 for(const r of rows.filter(r=>r.category==='accessory'))assert.equal(r.sellingPrice,null);
});
test('cut rates, widths and pack sizes retain supplier distinctions',()=>{
 assert.deepEqual(get('Tweed').widths,[2,2.5,4,5]);assert.deepEqual(get('Seduction').widths,[2.5,4,5]);assert.deepEqual(get('Wilton Balmoral').widths,[4]);
 assert.equal(get('Seduction').sellingPrice,28.94);assert.equal(get('Velvet Dreams').sellingPrice,27.04);assert.equal(get('Signa Laminate').sellingPrice,19.59);
 assert.equal(get('Artisan Dryback (LVT)').sellingPrice,35.59);assert.equal(get('Simply Nature 12/2 Plank').sellingPrice,47.59);
 assert.equal(get('Artisan Click (LVT)').coverage,1.875);assert.match(get('Artisan Click (LVT)').type,/click/);assert.match(get('Artisan Dryback (LVT)').type,/glue-down/);
 for(const r of rows.filter(r=>r.category==='vinyl'))assert.deepEqual(r.widths,[2,3,4]);
});
test('Abingdon carpet price uses full selected width while underlay uses room area',()=>{
 const L=require('../lib/rules').load(fs.readFileSync(require('node:path').join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
 const r=get('Seduction'),c={k:'ab',internalId:r.id,title:r.name+' — Practice colour',unit:'m',w:2.5,widths:r.widths,typed:true};
 const j={status:'open',type:'Fitting',brief:{choices:[c]},rooms:{bed:{name:'Bedroom',want:'ab',len:3,wid:2.2,spec:{floor:'carpet',underlay:true,fitting:true}}}};
 const cat=L.catalogue(j,{underlay10:5},{ab:{ppm:r.sellingPrice,type:r.type}},{underlay:'10'});
 assert.equal(cat.underlay.amount,33);assert.ok(cat.carpet.amount>=3*2.5*r.sellingPrice);assert.equal(L.briefOf(j).choices[0].internalId,r.id);
});
