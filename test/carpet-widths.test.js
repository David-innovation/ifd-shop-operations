const test=require('node:test'),assert=require('node:assert/strict'),E=require('../lib/cutting-engine'),W=require('../lib/carpet-widths');
test('supplier 3m and 2.5m rolls save area without rotating pile or removing allowance',()=>{
 for(const [id,ws,width,expected] of [['aw-sirius',[3,4,5],2.8,9.3],['abingdon-love-story-seduction',[2.5,4,5],2.3,7.75]]){
 const c={k:'c',internalId:id,title:'Practice carpet',widths:ws},j={brief:{choices:[c]},rooms:{r:{want:'c',name:'Bedroom',status:'verified',len:3,wid:width,spec:{floor:'carpet'}}},cuttingSpec:{material:'Practice',pattern:'plain',sameBatch:true,pileConfirmed:true,widths:ws}};
 const p=E.forJob(j);assert.equal(p.area,expected);assert.equal(p.bins[0].l,310);assert.equal(p.bins[0].pieces[0].pile,'down');assert.equal(p.bins[0].pieces[0].w,Math.round((width+.1)*100));
 j.cuttingSpec.widths=[2];assert.match(E.forJob(j).blocked,/not verified/);
 }
});
test('supplier widths override a forged choice width',()=>{assert.deepEqual(W.forChoice({internalId:'aw-sirius',widths:[2,6]}),[3,4,5]);});
