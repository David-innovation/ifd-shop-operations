'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'),L=require('../lib/rules').load(source),email=require('../lib/quote-email');
const job={type:'Fitting',status:'open',ref:'ZZ-PREP',customer:{name:'David Test'},brief:{choices:[{k:'hb',title:'Herringbone laminate',unit:'packs'},{k:'straight',title:'Straight laminate',unit:'packs'}]},rooms:{r1:{name:'Living room',want:'hb',len:4,wid:5,area:20,spec:{floor:'flooring',fitting:true}},r2:{name:'Bedroom',want:'straight',len:3,wid:3,area:9,spec:{floor:'flooring',fitting:true}}}};
const q={n:1,lines:[{label:'Flooring',price:500},{label:'Fitting',price:200}],total:700},shop={name:'Innovation Flooring Direct',phone:'01419525200',email:'sales@innovationflooringdirect.com'};
test('preparation estimates use only relevant measured rooms; no double billing or guessed unknown total',()=>{
 const e=L.preparationEstimate(job,q);assert.equal(e.area,20);assert.equal(e.screed,280);assert.equal(e.plywood,280);assert.equal(e.screedRate,14);assert.equal(e.plywoodRate,14);assert.equal(L.preparationEstimate({...job,type:'Quote'},q).screed,280);
 const n=L.preparationNotice(job,q);assert.match(n,/£280.00 for screed or £280.00 for plywood/);assert.match(n,/not included in your current quote total/);assert.match(n,/cannot proceed with the fitting/);assert.match(n,/may invalidate/);assert.match(n,/statutory rights/);assert.equal(q.total,700);
 const included=L.preparationNotice(job,{...q,lines:[...q.lines,{key:'prep',label:'Floor preparation',price:280}]});assert.match(included,/already includes £280.00/);assert.match(included,/not a second charge/);
 const unknown=L.preparationNotice({...job,rooms:{}},q);assert.match(unknown,/once the areas have been measured/);assert.doesNotMatch(unknown,/£0.00/);
 assert.equal(L.preparationNotice({...job,type:'Collection'},q),'');assert.equal(L.preparationNotice({...job,brief:{choices:[{k:'hb',title:'Straight laminate',unit:'packs'}]}},q),'');
});
test('customer email, print/acceptance template and booking notes carry the visible cost disclosure, without sizes or duplicate notice',()=>{
 const text=L.quoteMessage(job,q,shop);assert.match(text,/Herringbone preparation and possible costs/);assert.equal(L.hasSize(text,job),false);
 const html=email.html({job,q,L,body:text,url:'https://example.invalid/accept'});assert.match(html,/Preparing your floor — costs explained/);assert.equal((html.match(/We work to the highest standards/g)||[]).length,1);assert.ok(html.indexOf('Preparing your floor')<html.indexOf('ACCEPT MY QUOTE'));assert.doesNotMatch(html,/4\s*[x×]\s*5/);
 assert.ok(L.prepNotes(job,shop).some(x=>x.includes('£280.00')));
 for(const m of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

