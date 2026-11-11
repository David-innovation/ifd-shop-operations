'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../app/ifd-shop-operations.html'),'utf8');
test('Today cards preserve actionable queues, isolate test jobs and open full lists',()=>{
 class N{constructor(tag,p={},kids=[]){this.tag=tag;this.p=p;this.kids=kids.flat(Infinity).filter(Boolean);}replaceChildren(...kids){this.kids=kids.flat(Infinity).filter(Boolean);}querySelector(){return {scrollIntoView(){}};}}
 const h=(t,p,...kids)=>new N(t,p||{},kids),row=j=>h('row',{id:j.id||j.job?.id});
 const job=(id,extra={})=>({id,status:'open',customer:{name:id},...extra});
 const real=job('real'),hidden=job('test',{customer:{name:'ZZ TEST sample'}}),ready=job('ready',{stock:true}),visit=job('visit',{pre:[{kind:'measure',who:'Sam',status:'booked',date:'2026-11-11'}]}),many=Array.from({length:18},(_,i)=>job('attention'+i));
 const S={ui:{},tasks:Array.from({length:11},(_,i)=>({id:'task'+i})),inbox:{state:'ok'}},called=[];
 const box={VIEWS:{},S,h,add:(n,k)=>n.kids.push(...k.flat(Infinity).filter(Boolean)),btn:(label,fn)=>h('button',{text:label,onclick:fn}),L:{todayISO:()=> '2026-11-11',fmtDay:x=>x,quoteWait:j=>({state:j.state}),checksOutstanding:()=>[],stockLines:j=>j.stock?[1]:[],allAllocated:()=>true,linesOf:()=>[1],preOf:j=>j.pre||[],toPrice:()=>false,quoted:()=>false,balanceOf:j=>j.id==='real'?10:0,PRE_KINDS:{measure:'Measure'}},openJobs:()=>[real,hidden,ready,visit,...many],jobsArr:()=>[real,hidden,ready,visit,...many],toPriceJobs:()=>[real,hidden],quotedJobs:()=>[job('unsent',{state:'unsent'}),job('chase',{state:'ring'}),job('waiting',{state:'waiting'})],confirmJobs:()=>[real],failedMsgs:()=>[{job:real}],actNowJobs:()=>[],attentionJobs:()=>many,inboxList:()=>[{id:'web'}],toOrderJobs:()=>[real],onOrderJobs:()=>[real],cutAll:()=>[{job:real}],contactItems:()=>[{job:real}],banners:()=>[h('warning',{text:'Stock unverified'})],listOf:x=>x,refreshInbox(){},measureDialog(){},saleDialog(){},openSheet:id=>called.push(id),go:x=>called.push(x)};
 for(const key of ['priceRow','quotedRow','confirmRow','failedRow','actRow','inboxRow','jobRow','checkRow','orderRow','onOrderRow','cutRow','taskRow','ringRow'])box[key]=row;
 const source=html.slice(html.indexOf('VIEWS.today = function(){'),html.indexOf('/* Catalogue: Shopify remains'));
 vm.runInNewContext(source,box);const view=box.VIEWS.today();view.refresh();const root=view.nodes[0],walk=n=>[n,...(n.kids||[]).filter(x=>typeof x==='object').flatMap(walk)],find=fn=>walk(root).filter(fn),card=i=>find(n=>n.p?.class?.startsWith('simple-work'))[i];
 assert.equal(find(n=>n.p?.class?.startsWith('simple-work')).length,4);assert.equal(find(n=>n.p?.id==='workList').length,0);
 card(0).p.onclick();assert.deepEqual(find(n=>n.tag==='row').map(n=>n.p.id),['real']);
 card(1).p.onclick();assert.ok(find(n=>n.p?.id==='failedSec').length);assert.ok(find(n=>n.p?.id==='confirmSec').length);assert.ok(find(n=>n.p?.id==='quotedSec').length);
 card(2).p.onclick();for(const id of ['chaseSec','ringSec','waitingSec'])assert.ok(find(n=>n.p?.id===id).length,id);
 card(3).p.onclick();for(const id of ['inboxSec','readySec','orderSec','onOrderSec','cutSec','owedSec','tasksSec','attentionFailedSec'])assert.ok(find(n=>n.p?.id===id).length,id);
 assert.equal(find(n=>n.tag==='row'&&/^attention/.test(n.p.id)).length,18);assert.equal(find(n=>n.tag==='row'&&/^task/.test(n.p.id)).length,11);
 find(n=>n.tag==='input')[0].p.onchange({target:{checked:true}});card(0).p.onclick();assert.ok(find(n=>n.tag==='row'&&n.p.id==='test').length);
 assert.ok(find(n=>n.p?.id==='visitsSec').length);assert.ok(find(n=>n.tag==='warning').length);
});
test('all embedded scripts parse',()=>{for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
