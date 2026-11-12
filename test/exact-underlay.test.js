'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),L=require('../lib/rules').load(fs.readFileSync('app/ifd-shop-operations.html','utf8'));
test('exact room coverage survives quote and accepted pick quantities independently of roll cuts',()=>{
const j={status:'open',type:'Fitting',rooms:{bed:{name:'Bedroom',len:2.5,wid:2.8,area:7,spec:{floor:'carpet',underlay:true},takeoff:{underlayM2:10}}},lines:{carpet:{title:'Carpet',unit:'m',qty:26,w:4,rooms:'Bedroom'}}};
assert.equal(L.underlayArea(j.rooms.bed),7);assert.equal(L.pricingOf(j).underlayCarpet,7);assert.equal(L.catalogue(j,{},{}).underlay.amount,7*L.priceList({}).underlay10);
const picks=L.quoteNeeds(j,{lines:[{label:'Underlay',price:35}],options:{underlay:'10'}});assert.equal(picks[0].qty,7);assert.equal(picks[0].unit,'m²');j.lines.underlay={title:'Super Soft underlay',qty:picks[0].qty,unit:picks[0].unit,rooms:'Bedroom'};
const d=require('../lib/fitter-details').details(j,L);assert.equal(d.rooms[0].takeoff.underlayM2,7);assert.equal(d.items.find(x=>x.key==='underlay').qty,7);assert.equal(d.items.find(x=>x.key==='carpet').cutLength,2.6);assert.equal(L.cutSize(4.1,4),'4.1 × 4.0m');assert.equal(j.rooms.bed.len,2.5);
});
test('stairs retain separately measured underlay and never inherit carpet cutting allowance',()=>{const r={hsl:{stairs:{on:true,n:13,winders:0,wid:0.9,tread:27,riser:18}},takeoff:{underlayM2:3.51}};assert.equal(L.underlayArea(r),3.51);delete r.takeoff;assert.equal(L.underlayArea(r),3.16);});
