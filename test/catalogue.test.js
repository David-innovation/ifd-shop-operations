'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../app/ifd-shop-operations.html'),'utf8'),L=require('../lib/rules').load(html);
function harness(){class N{constructor(tag,p={},kids=[]){this.tag=tag;this.p=p;Object.assign(this,p);this.value=p.value||'';this.checked=!!p.checked;this.kids=kids.flat(Infinity).filter(Boolean);}append(...x){this.kids.push(...x.flat(Infinity).filter(Boolean));}replaceChildren(...x){this.kids=x.flat(Infinity).filter(Boolean);}}
 const h=(tag,p,...kids)=>new N(tag,p||{},kids),walk=n=>[n,...(n.kids||[]).filter(x=>typeof x==='object').flatMap(walk)],saved=[];let modal,review;
 const box={window:{IFDMeasures:require("../lib/walkin-measures")},L,VIEWS:{},S:{prices:{fitLaminate:5,fitStraightMin:0},me:{id:'owner'}},PRODUCT_FIELDS:'id',Q_SEARCH:'search',h,btn:(text,onclick)=>h('button',{text,onclick}),field:(text,node)=>h('label',{text},node),variantTitle:(p,v)=>p.title,openModal:n=>{modal=n;},dlg:(title,body,buttons)=>h('dialog',{text:title},body,buttons),closeModal(){},sq:async()=>({products:{nodes:[]}}),uid:()=> 'fixture',nowISO:()=> '2026-11-11T12:00:00Z',createJob:async(id,j)=>saved.push(j),quoteDialog:j=>review=j,explain:e=>e.message};
 vm.runInNewContext(html.slice(html.indexOf('/* Catalogue: Shopify remains'),html.indexOf('/* ---------- Jobs ---------- */')),box);
 return {box,saved,get review(){return review;},nodes:()=>walk(modal),input:(label,value)=>{const n=walk(modal).find(n=>n.p['aria-label']===label||n.p.id===label);assert.ok(n,label);n.value=value;n.p.oninput?.({target:n});},text:()=>walk(modal).map(n=>n.text||'').join(' '),button:label=>walk(modal).find(n=>n.tag==='button'&&n.text===label)};
}
test('catalogue calculator rounds whole packs, recalculates changed sizes and saves unverified lead for review',async()=>{const x=harness(),p={title:'Oak laminate',productType:'laminate',coverage:{value:'2'},status:'ACTIVE'},v={id:'gid://shopify/ProductVariant/1',title:'Default Title',price:'20'};x.box.catalogueQuote(p,v);x.input('Length value for room 1','3');x.input('Width value for room 1','4');assert.match(x.text(),/7 packs/);assert.match(x.text(),/Estimated total: £200.00/);x.input('Length value for room 1','4');assert.match(x.text(),/9 packs/);assert.match(x.text(),/Estimated total: £260.00/);await x.button('Save sizes and review quote').onclick();assert.equal(x.saved.length,0);x.input('catalogueCustomer','ZZ TEST calculator');x.input('cataloguePhone','07700900555');await x.button('Save sizes and review quote').onclick();assert.equal(x.saved.length,1);assert.equal(x.saved[0].rooms.r0.status,'unverified');assert.equal(x.saved[0].diary,false);assert.ok(L.toPrice(x.saved[0]));assert.equal(x.review.source,'catalogue');});
test('missing pack coverage is flagged and cannot create a calculator job',async()=>{const x=harness();x.box.catalogueQuote({title:'Oak laminate',productType:'laminate'},{id:'v',price:'20'});x.input('Length value for room 1','3');x.input('Width value for room 1','4');assert.match(x.text(),/Pack coverage is missing/);assert.doesNotMatch(x.text(),/Estimated total:/);x.input('catalogueCustomer','Test');x.input('cataloguePhone','07700900555');await x.button('Save sizes and review quote').onclick();assert.equal(x.saved.length,0);});
test('engineered estimate includes website fitting, glue and preparation allowance',()=>{const x=harness();x.box.catalogueQuote({title:'Engineered herringbone oak',productType:'wood',coverage:{value:'2'}},{id:'v',price:'40'});x.input('Length value for room 1','3');x.input('Width value for room 1','4');assert.match(x.text(),/Fitting: £360.00/);assert.match(x.text(),/Full-spread glue: £60.00/);assert.match(x.text(),/Floor preparation: £168.00/);assert.match(x.text(),/Estimated total/);});
test('catalogue API queries are read-only allowlisted',()=>{const {allowed}=require('../lib/shopify');assert.ok(allowed('query OpsCatalogue{products{nodes{id}}}','query'));assert.ok(allowed('query OpsCatalogueVariants{product{id}}','query'));assert.equal(allowed('mutation OpsCatalogue{productCreate{id}}','mutation'),null);});
test('supplier ordering names stay separate from customer quote product names',()=>{const x=harness(),p={title:'Riverstone Oak',productType:'laminate',actualName:{value:'AGT Effect Elvaris'},supplierCode:{value:'ABC123'}};assert.equal(x.box.catalogueOrdering(p).text,'Order as: AGT Effect Elvaris · Supplier code: ABC123');assert.equal(x.box.catalogueChoice(p,{id:'v'}).title,'Riverstone Oak');assert.equal(x.box.catalogueGoods(p,{price:'20'}).title,'Riverstone Oak');assert.equal(x.box.catalogueOrdering({actualName:{value:'ted todd'}}).incomplete,true);assert.equal(x.box.catalogueOrdering({}).incomplete,true);assert.equal(x.box.catalogueOrdering({supplierFloor:{value:'EGGER EL202F'}}).name,'EGGER EL202F');});
test('catalogue waits for connection then loads automatically on direct navigation',async()=>{const x=harness();let ready=false,calls=0;x.box.shopOK=()=>ready;x.box.sq=async()=>{calls++;return {products:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}};};const view=x.box.VIEWS.catalogue();view.refresh();assert.equal(calls,0);ready=true;view.refresh();await Promise.resolve();assert.equal(calls,1);view.refresh();assert.equal(calls,1);});

test('website fitting rates distinguish pattern, printed effect and click vinyl, with one minimum per job',()=>{
 const calc=(title,area=6)=>L.catalogue({rooms:{a:{k:'a',name:'Room',len:area,wid:1,area,want:'c',spec:{floor:'flooring'}}},brief:{choices:[{k:'c',title,unit:'packs'}]}},{},{c:{cov:2,pack:20}},{});
 assert.equal(calc('Oak straight laminate').fitting.amount,120);
 assert.equal(calc('Oak herringbone laminate').fitting.amount,200);
 assert.equal(calc('Oak herringbone laminate',20).fitting.amount,440);
 assert.equal(calc('EGGER Rillington herringbone effect laminate').fitting.amount,120);
 assert.equal(calc('Oak SPC herringbone').fitting.amount,200);
 assert.equal(calc('Straight glue-down LVT').fitting.amount,200);
 assert.equal(L.priceList({fitLaminate:0,fitLvt:0}).fitLaminate,10);
});

test('glue-down LVT uses website pattern rates, per-job minimums and three-pound adhesive',()=>{
 const make=(tags,area=20)=>({rooms:{a:{name:'Room',area,want:'c',spec:{floor:'flooring'}}},brief:{choices:[{k:'c',title:'Natural Oak',unit:'packs',type:'LVT Flooring method:glue '+tags,variantId:'v'}]}});
 for(const [tag,price] of [['',360],['format_herringbone',500],['format_chevron',500],['format_tile_effect',400],['format_basket_weave',700]]){
  const j=make(tag),cat=L.catalogue(j,{}, {c:{cov:2,pack:40}},{});
  assert.equal(cat.fitting.amount,price);assert.equal(cat.glue.amount,60);assert.equal(cat.prep.amount,280);assert.equal(cat.glue.needQty,20);
  assert.equal(L.quoteRows(j).filter(r=>r.must).length,2);
 }
 const small=make('',3),cat=L.catalogue(small,{}, {c:{cov:2,pack:40}},{});
 assert.equal(cat.fitting.amount,200);assert.equal(cat.prep.amount,150);assert.equal(cat.glue.amount,9);
 small.rooms.b={name:'Second',area:3,want:'c',spec:{floor:'flooring'}};
 const two=L.catalogue(small,{}, {c:{cov:2,pack:40}},{});assert.equal(two.fitting.amount,200);assert.equal(two.prep.amount,150);assert.equal(two.glue.amount,18);
 assert.equal(L.catalogue(make('format_herringbone'),{}, {c:{cov:2,pack:40}},{lvtBorder:true}).fitting.amount,600);
 assert.equal(L.catalogue(make('format_basket_weave'),{}, {c:{cov:2,pack:40}},{lvtBorder:true}).fitting.amount,700);
 assert.equal(L.floorKind('Oak SPC','click vinyl').glueDown,false);
 assert.equal(L.floorKind('Engineered Oak','method:glue').glueDown,false);
 const x=harness();x.box.catalogueQuote({title:'Natural Oak',productType:'LVT',fittingMethod:{value:'glue down'},tags:['format_herringbone'],coverage:{value:'2'}},{id:'v',price:'40'});x.input('Length value for room 1','4');x.input('Width value for room 1','5');assert.match(x.text(),/Fitting: £500.00/);assert.match(x.text(),/Full-spread glue: £60.00/);assert.match(x.text(),/Floor preparation: £280.00/);
});
test('customer arrival wording never infers a time from the internal AM/PM booking',()=>{
 for(const slot of ['AM','PM','']){const j={status:'open',type:'Fitting',diary:true,date:'2026-11-20',slot,ref:'ZZ-TIME',customer:{name:'Test'},total:0};assert.match(L.arrivalLine(j),/fitter will text/);assert.doesNotMatch(L.arrivalLine(j),/morning|afternoon/);assert.doesNotMatch(L.confirmText(j,{name:'Innovation',phone:'01419525200'}),/morning|afternoon/);}
 const confirmed={status:'open',type:'Fitting',diary:true,date:'2026-11-20',arrival:{slot:'2-4pm',forDate:'2026-11-20'}};assert.match(L.arrivalLine(confirmed),/2-4pm/);
});

test('walk-in mixed units preserve customer inputs and convert before pricing',async()=>{const x=harness();x.box.catalogueQuote({title:'Oak laminate',productType:'laminate',coverage:{value:'2'}},{id:'v',price:'20'});const unit=(label,value)=>x.nodes().find(n=>n.p['aria-label']===label).p.onchange({target:{value}});unit('Length unit for room 1','ftin');x.input('Length value for room 1','12');x.input('Length inches for room 1','6');unit('Width unit for room 1','cm');x.input('Width value for room 1','300');x.input('catalogueCustomer','ZZ TEST mixed units');x.input('cataloguePhone','07700900555');await x.button('Save sizes and review quote').onclick();const j=x.saved[0];assert.equal(j.rooms.r0.len,3.81);assert.equal(j.rooms.r0.wid,3);assert.equal(j.rooms.r0.area,11.43);assert.equal(j.rooms.r0.inputMeasurements.length.unit,'ftin');assert.equal(j.rooms.r0.inputMeasurements.width.value,'300');assert.equal(j.walkin,true);assert.equal(j.diary,false);});
