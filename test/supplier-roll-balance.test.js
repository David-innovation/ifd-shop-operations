'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),B=require('../lib/supplier-roll-balance');
test('10m threshold sums matching carpet only, respects width, batch and legacy units',()=>{
 const line={title:'Zenith Caribou carpet',unit:'m',w:4,variantId:'one'};
 assert.deepEqual(B.requests([{...line,qty:99}]),[]);
 assert.equal(B.requests([{...line,qty:100}])[0].length,10);
 assert.equal(B.requests([{...line,qty:51},{...line,qty:49}])[0].length,10);
 assert.deepEqual(B.requests([{...line,qty:50},{...line,qty:50,w:5}]),[]);
 assert.deepEqual(B.requests([{...line,qty:50},{...line,qty:50,title:'Zenith Grey carpet'}]),[]);
 assert.deepEqual(B.requests([{...line,qty:50,batch:'a'},{...line,qty:50,batch:'b'}]),[]);
 assert.equal(B.requests([{...line,w:undefined,qty:100}],()=>({w:4}))[0].width,4);
 assert.equal(B.requests([{...line,unit:'metres',qty:10}])[0].length,10);
 assert.deepEqual(B.requests([{...line,qty:100,title:'Sheet vinyl'}]),[]);
 assert.match(B.wording(B.requests([{...line,qty:100}])).join('\n'),/extra quantity or cost requires our approval/);
});
test('continuous roll view keeps every piece and pile placement, without changing approved data',()=>{
 const p=require('../lib/cutting-engine').forJob(require('../lib/practice-cutting').buildHouse({id:'test'},Date.now));
 const before=JSON.stringify(p),rolls=require('../lib/continuous-roll-view').rolls(p);
 assert.equal(rolls.length,2);assert.equal(rolls.find(r=>r.w===400).l,2100);assert.equal(rolls.find(r=>r.w===500).l,1080);
 assert.equal(rolls.reduce((n,r)=>n+r.pieces.length,0),42);assert.equal(JSON.stringify(p),before);
 assert.equal(rolls.reduce((n,r)=>n+r.w*r.l/10000,0),138);
});
