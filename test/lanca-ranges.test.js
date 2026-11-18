'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rows=require('../lib/lanca-ranges').list();
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
test('all 49 Lanca designs preserve format, approved pricing and pack sizes',()=>{
 assert.equal(rows.length,49);assert.equal(new Set(rows.map(r=>r.id)).size,49);
 for(const r of rows){assert.equal(r.sellingPrice,Math.round(r.cost*120+2000)/100);assert.ok(r.ready);assert.ok(r.colour);assert.ok(r.finish);assert.equal(r.type,'LVT glue-down');assert.equal(r.stockQuantity,undefined);}
 for(const [prefix,count,cov,price] of [['standard-plank',10,3.9,35.59],['standard-herringbone',10,3.34,36.79],['tile',4,2.97,36.79],['premium-plank',5,3.62,37.99],['premium-herringbone',5,3.62,39.19],['chevron',5,3.37,39.19],['basket-weave',10,3.92,39.19]]){
  const group=rows.filter(r=>r.id.startsWith('lanca-'+prefix+'-'));assert.equal(group.length,count);for(const r of group){assert.equal(r.coverage,cov);assert.equal(r.sellingPrice,price);}
 }
 assert.equal(rows.filter(r=>r.colour==='Sugar Rush').length,2);
 assert.ok(rows.find(r=>r.id==='lanca-premium-herringbone-firelight').palletQuantityCheck);
 const privacy=require('../lib/owner-finance'),staff=privacy.redact(rows);assert.equal(privacy.hasPrivate(staff),false);assert.equal(staff[0].cost,undefined);assert.equal(staff[0].coverage,3.9);
 assert.equal(require('../lib/supplier-ranges').list().filter(r=>r.supplier==='Lanca').length,49);
});
test('different Lanca formats retain colours and pack quantities through saved quote and fitter details',()=>{
 const selected=[rows.find(r=>r.id==='lanca-premium-plank-sugar-rush'),rows.find(r=>r.id==='lanca-chevron-sugar-rush')];
 const j={type:'Fitting',test:true,status:'open',customer:{name:'Practice'},brief:{choices:[]},rooms:{},lines:{}};const goods={};
 selected.forEach((r,i)=>{const k='choice'+i;j.brief.choices.push({k,internalId:r.id,internalKey:r.id+'|'+r.colour,title:'Lanca '+r.name,type:r.type,unit:'packs',coverage:r.coverage});j.rooms['r'+i]={name:'Room '+i,want:k,len:4,wid:5,area:20,spec:{floor:'flooring',fitting:true,underlay:false}};goods[k]={cov:r.coverage,pack:L.round2(r.sellingPrice*r.coverage),ppm:r.sellingPrice,type:r.type};});
 const plan=JSON.parse(JSON.stringify(L.packPlan(j,goods,{waste:10})));assert.deepEqual(plan.problems,[]);assert.deepEqual(plan.groups.map(g=>g.packs),[7,7]);assert.deepEqual(plan.groups.map(g=>g.cov),[3.62,3.37]);
 const cat=L.catalogue(j,{waste:10},goods,{});assert.equal(cat.flooring.amount,L.round2(7*goods.choice0.pack+7*goods.choice1.pack));assert.match(cat.flooring.text,/Sugar Rush/);assert.match(cat.flooring.text,/Chevron/);
 const saved=JSON.parse(JSON.stringify({...j,accepted:{packs:plan},quotes:{q:{packs:plan,lines:[{key:'flooring',label:cat.flooring.text,price:cat.flooring.amount}]}}}));
 saved.accepted.packs.groups.forEach((g,i)=>saved.lines['p'+i]={internalId:g.internalId,internalKey:g.internalKey,title:g.title,qty:g.packs,cov:g.cov,unit:'packs',rooms:g.names.join(', '),hold:'order',sub:g.cov+' m² per pack'});
 const details=require('../lib/fitter-details').details(saved,L);assert.equal(details.rooms.length,2);for(const r of details.rooms){assert.match(r.product,/Sugar Rush/);assert.equal(r.items.length,1);assert.equal(r.items[0].qty,7);assert.equal(r.items[0].unit,'packs');assert.match(r.items[0].sub,/m² per pack/);}assert.notEqual(details.rooms[0].product,details.rooms[1].product);
});

