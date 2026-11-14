'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../lib/rules').load(fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8')),D=require('../lib/fitter-details');
test('job sheet preserves room and shared quantities, missing facts and estimator limitations',()=>{
 const j={type:'Fitting',total:500,fitterDue:200,customer:{name:'TEST',address:'TEST ADDRESS',postcode:'G81 1DX',phone:'TEST'},rooms:{a:{name:'Lounge',len:6,wid:3,area:18,spec:{old:true,uplift:false,furniture:false}},b:{name:'Hall',len:2,wid:2,area:4}},lines:{f:{title:'TEST flooring',qty:7,unit:'packs',rooms:'Lounge'},s:{title:'Shared flooring',qty:4,unit:'packs',rooms:'Lounge, Hall'},u:{title:'Foam underlay',qty:2,unit:'rolls',acc:{need:22,unit:'m²'}}},pre:{v:{notes:'Customer will clear room',sub:{findings:'Could not check subfloor: old carpet down'}}}};
 const d=D.details(j,L);assert.equal(d.customer.postcode,'G81 1DX');assert.equal(d.fitterDue,200);assert.equal(d.rooms[0].items[0].qty,7);assert.equal(d.rooms[1].items.length,0);assert.equal(d.rooms[0].sharedItems[0].qty,4);assert.equal(d.rooms[1].sharedItems[0].rooms,'Lounge, Hall');assert.equal(d.unallocatedItems[0].needQty,22);assert.match(d.visits[0].sub.findings,/old carpet/);assert.match(d.rooms[0].responsibilities.furniture,/not recorded separately/);assert.equal(D.details({},L).fitterDue,null);
});

test('pricing-only carpet and service rows are excluded from the fitter material list',()=>{const d=D.details({lines:{roll:{title:'Velvet Dreams',qty:117,unit:'m',w:4,hold:'draft'},priced:{title:'Carpet',qty:1,unit:'items',hold:'none'},underlay:{title:'Underlay',qty:34.15,unit:'m²',hold:'pick'},fit:{title:'Fitting',qty:1,hold:'none'}}},L);assert.equal(d.pickList.map(x=>x.title).join('|'),'Velvet Dreams|Underlay');assert.equal(d.pickList[0].cutLength,11.7);});

test('fitter receives only their collection amount, including nested products and preparation',()=>{
 const j={type:'Fitting',total:1147.16,fitterDue:440,customer:{name:'TEST'},notes:'Customer package £470; keep access clear',preparationRequired:{method:'plywood',area:20,rate:14,amount:280,note:'Lay plywood',quoteRev:'q'},rooms:{a:{name:'Lounge',len:4,wid:5,underlayProduct:{title:'Foam',price:45,packPrice:45,coverage:15},takeoff:{underlayM2:20,price:90}}},lines:{a:{title:'Oak',qty:12,unit:'packs',price:242.16}},quotes:{q:{total:1147.16}},pay:{a:{amount:707.16}}};
 const d=D.details(j,L),wire=JSON.stringify(d);
 assert.equal(d.fitterDue,440);assert.equal(d.preparation.area,20);assert.equal(d.preparation.amount,undefined);assert.equal(d.preparation.rate,undefined);assert.equal(d.rooms[0].underlayProduct.coverage,15);assert.equal(d.rooms[0].underlayProduct.price,undefined);assert.equal(d.items[0].qty,12);assert.doesNotMatch(wire,/1147.16|707.16|242.16|£470/);assert.equal(j.preparationRequired.amount,280);assert.equal(j.rooms.a.underlayProduct.price,45);
});
