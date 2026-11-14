'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),L=require('../lib/rules').load(fs.readFileSync(require('node:path').join(__dirname,'../app/ifd-shop-operations.html'),'utf8'));
const job=(title='Oak laminate',floor='flooring',type='Fitting')=>({type,rooms:{r:{name:'Living room',len:4,wid:5,area:20,want:'a',spec:{floor,fitting:true}}},brief:{choices:[{k:'a',title,unit:floor==='carpet'?'m':'packs',w:4,variantId:'v'}]}});
test('arrangement charges use fitted area and correct product rate, without changing fitting',()=>{
 for(const [title,floor,fee] of [['Carpet','carpet',20],['Sheet vinyl','carpet',20],['Oak laminate','flooring',30],['Click vinyl SPC','flooring',30],['Engineered oak','flooring',40],['Glue-down LVT','flooring',40]]){
  const j=job(title,floor),c=L.catalogue(j,{}, {a:{cov:2,pack:30,ppm:22}}),baseline=L.catalogue({...j,type:undefined},{},{a:{cov:2,pack:30,ppm:22}});
  assert.equal(c.arrangement.amount,fee,title);assert.equal(c.delivery.amount,25);assert.equal(c.fitting?.amount,baseline.fitting?.amount);
 }
 const j=job('Carpet','carpet');Object.assign(j.rooms.r,{len:2.5,wid:2.8,area:7});assert.equal(L.jobFees(j).arrangement.amount,7,'dead measured area, not roll area or fitting minimum');
});
test('mixed rooms total once; supply-only rooms, collections and repeat visits do not add fitting fees',()=>{
 const j=job();j.rooms.s={...j.rooms.r,name:'Second',want:'b',spec:{floor:'flooring',fitting:true}};j.brief.choices.push({k:'b',title:'Engineered oak',unit:'packs'});assert.equal(L.jobFees(j).arrangement.amount,70);assert.equal(L.jobFees(j).delivery.amount,25);
 j.rooms.s.spec.fitting=false;assert.equal(L.jobFees(j).arrangement.amount,30);
 j.type='Collection';assert.deepEqual(Object.keys(L.jobFees(j)),[]);
 j.type='Delivery';assert.equal(L.jobFees(j).arrangement,undefined);assert.equal(L.jobFees(j).delivery.amount,25);
 j.type='Quote';assert.equal(L.jobFees(j).arrangement.amount,30);assert.equal(L.jobFees(j).delivery.amount,25);
 const q={lines:[{label:'Fitting',price:440},{key:'arrangement',label:'Fitting arrangement & support',price:30},{key:'delivery',label:'Delivery',price:25}]};j.quotes={q};j.fitterWork={purpose:'return'};assert.equal(L.quoteTotal(q),495);assert.equal(L.quoteFitting(q),440);assert.equal(L.quoteParts(q).shopTotal,55);assert.equal(L.quoteNeeds(j,q).filter(x=>x.kind!=='service').length,0);
 assert.equal(L.discounted('Fitting arrangement & support',30,20),30);assert.equal(L.discounted('Delivery',25,20),25);
});
test('saved quotes are immutable and branded email explains included charges without increasing fitter payment',()=>{
 const j=job(),q={lines:[{label:'Flooring',price:242.16},{label:'Underlay',price:90},{label:'Beading',price:40},{label:'Plywood floor preparation',price:280},{label:'Fitting',price:440},{key:'arrangement',label:'Fitting arrangement & support',price:30},{key:'delivery',label:'Delivery',price:25}]},before=JSON.stringify(q);
 assert.equal(L.quoteParts(q).total,1147.16);assert.equal(L.quoteParts(q).shopTotal,707.16);assert.equal(L.quoteFitting(q),440);
 const html=require('../lib/quote-email').html({job:j,q,L});assert.match(html,/already included in your quoted total/);assert.match(html,/not an additional charge/);assert.match(html,/£707.16/);assert.match(html,/£440.00/);assert.match(html,/Fitting arrangement &amp; support/);assert.equal(JSON.stringify(q),before);
 const old={lines:[{label:'Flooring',price:100},{label:'Fitting',price:120}]};assert.equal(L.quoteParts(old).total,220);assert.equal(L.quoteFeeNotice(old),'');
});
