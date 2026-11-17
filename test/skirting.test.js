'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{create}=require('../server'),{docPath}=require('../lib/store');
test('skirting estimator request flows to quote, fitter details and email without stock or duplicate charges',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skirting-')),app=create({env:{DATA_DIR:dir,SESSION_PEPPER:'test'},log:()=>{},pollMs:3600000});try{
 const user={id:'owner',name:'David',role:'owner'},source={test:true,type:'Fitting',status:'open',customer:{name:'David Woodcock'},rooms:{bed1:{name:'Bedroom 1',len:4,wid:3,area:12,spec:{floor:'flooring',fitting:true,beading:true}}},lines:{},pay:{}};
 app.store.setDoc(docPath('jobs/ZZ-HOUSE-PRACTICE-owner'),source);
 const deps={st:app.store,L:app.rules,user,now:Date.now},M=require('../lib/skirting-practice'),r=M.create(deps),j=app.store.getDoc('jobs/'+r.id).data,q=j.quotes.skirting;
 assert.equal(j.rooms.bed1.spec.skirtingMetres,12);assert.equal(j.rooms.bed1.spec.beading,false);assert.equal(q.total,60);assert.equal(app.rules.quoteParts(q).fitTotal,60);assert.equal(app.rules.quoteParts(q).shopTotal,0);
 assert.match(require('../lib/fitter-details').details(j,app.rules).rooms[0].requirements,/12 metres/);
 const html=require('../lib/quote-email').html({job:j,q,L:app.rules});assert.match(html,/Filling nail holes/);assert.match(html,/£60.00/);
 assert.deepEqual(j.lines,{});assert.deepEqual(j.pay,{});assert.equal(M.create(deps).existing,true);assert.equal(Object.keys(app.store.getDoc('jobs/'+r.id).data.quotes).length,1);assert.deepEqual(app.store.getDoc('jobs/ZZ-HOUSE-PRACTICE-owner').data,source);
 j.rooms.bed1.spec.skirtingMetres=15;assert.equal(app.rules.catalogue(j,{},{}).skirting.amount,75);j.rooms.bed1.spec.skirting=false;assert.equal(app.rules.catalogue(j,{},{}).skirting,undefined);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
