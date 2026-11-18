'use strict';
const {docPath}=require('./store');
function example(L){
 const ranges=require('./plusfloor-ranges').list(),main=ranges.find(r=>r.code==='PLF7100GH'),border=ranges.find(r=>r.code==='PLF7100G'),strip=require('./feature-strips').list().find(r=>r.code==='PLFS100');
 const length=5,width=4,borderWidth=.187,plankLength=1.227,stripWidth=.005,waste=10,area=length*width;
 const centreLength=length-2*(borderWidth+stripWidth),centreWidth=width-2*(borderWidth+stripWidth),centreArea=centreLength*centreWidth;
 const mainPacks=Math.ceil(centreArea*1.1/main.coverage-1e-9),planksPerPack=Math.round(border.coverage/(borderWidth*plankLength));
 const borderPlanks=2*Math.ceil(length/plankLength)+2*Math.ceil(width/plankLength),borderWithWaste=Math.ceil(borderPlanks*1.1),borderPacks=Math.ceil(borderWithWaste/planksPerPack);
 const stripRun=2*(length+width)-8*borderWidth-4*stripWidth,stripQty=Math.ceil(stripRun*1.1);
 const mainPrice=L.round2(main.coverage*main.sellingPrice),borderPrice=L.round2(border.coverage*border.sellingPrice);
 return {main,border,strip,length,width,area,borderWidth,plankLength,stripWidth,waste,centreLength,centreWidth,centreArea,mainPacks,planksPerPack,borderPlanks,borderWithWaste,borderPacks,stripRun,stripQty,mainPrice,borderPrice};
}
function create({st,L,user,now}){
 if(user.role!=='owner')throw {status:403,message:'Owner practice only.'};
 const id='ZZ-LVT-BORDER-PREP-' +user.id,found=st.getDoc('jobs/'+id);if(found.exists)return {id,job:{...found.data,id},existing:true};
 const x=example(L),at=new Date(now()).toISOString(),choice=(r,k)=>({k,title:'PlusFloor '+r.name,type:r.type,unit:'packs',internalId:r.id,internalKey:r.id,coverage:r.coverage,colour:r.colour});
 const j={id,ref:'LVT-BORDER-PREP',test:true,status:'open',type:'Fitting',source:'catalogue',diary:false,date:'',fitter:'',customer:{name:'David Woodcock',phone:'07497557253',email:'David@innovationflooringdirect.com',postcode:'G81 1DX',address:'Practice quotation'},rooms:{living:{name:'Living room',len:5,wid:4,area:20,want:'main',status:'done',spec:{floor:'flooring',fitting:true,border:true,featureStrip:{code:x.strip.code,metres:Math.round(x.stripRun*1.1*10000)/10000,compatible:true}},note:'Practice: one full-width straight-plank border, mitred corners, silver feature strip between border and herringbone. Border width 187mm. No real booking.'}},brief:{choices:[choice(x.main,'main'),choice(x.border,'border')]},lines:{},pay:{},msgs:{},pre:{},quotes:{},notes:'Isolated calculated practice quote. Border quantities manually reviewed; not an automatic border-builder test. Confirm layout and reprice before any real order.',borderPractice:{length:x.length,width:x.width,centreLength:x.centreLength,centreWidth:x.centreWidth,centreArea:x.centreArea,borderWidth:x.borderWidth,borderPlanks:x.borderPlanks,borderWithWaste:x.borderWithWaste,planksPerPack:x.planksPerPack,stripRun:x.stripRun,waste:x.waste},log:{created:{at,by:user.id,text:'Owner-requested border quote practice. No stock, payment or fitting booking created.'}}};
 const calc=L.catalogue(j,{}, {main:{cov:x.main.coverage,pack:x.mainPrice},border:{cov:x.border.coverage,pack:x.borderPrice}},{lvtBorder:true});
 if(calc.fitting.amount!==600)throw Error('Border fitting must be 20 square metres at £30.');
 const lines=[
 {key:'flooring',label:'PlusFloor Vero Florence herringbone — '+x.mainPacks+' boxes',price:L.round2(x.mainPacks*x.mainPrice),needQty:x.mainPacks,needUnit:'packs'},
 {key:'borderMaterial',label:'Matching Vero Florence straight-plank border — '+x.borderPacks+' boxes',price:L.round2(x.borderPacks*x.borderPrice),needQty:x.borderPacks,needUnit:'packs'},
 {key:'featureStrip_living',label:'Silver feature strips — '+x.stripQty+' lengths',price:L.round2(x.stripQty*x.strip.sellingPrice),needQty:x.stripQty,needUnit:'lengths',calc:calc.featureStrip_living.text},
 {key:'lvtGlue',label:'Full-spread LVT adhesive',price:60},
 {key:'prep',label:'Mandatory subfloor preparation',price:calc.prep.amount,calc:calc.prep.text},
 {key:'fitting',label:'Herringbone and straight-plank border fitting',price:calc.fitting.amount,calc:calc.fitting.text},
 {key:'arrangement',label:'Fitting arrangement and support',price:40},
 {key:'delivery',label:'Delivery',price:25}];
 const q={n:1,at,by:user.id,byName:user.name||'David',lines,total:L.round2(lines.reduce((n,l)=>n+l.price,0)),rates:L.priceList({}),options:{lvtBorder:true},charges:{version:1,orderType:'Fitting'},supply:L.supplyPlan(j),packs:{signature:L.packSignature(j),problems:[],groups:[{choice:'main',internalId:x.main.id,internalKey:x.main.id,title:'PlusFloor '+x.main.name,area:L.round2(x.centreArea),required:L.round2(x.centreArea*1.1),cov:x.main.coverage,packs:x.mainPacks,waste:10,names:['Living room — herringbone centre']},{choice:'border',internalId:x.border.id,internalKey:x.border.id,title:'PlusFloor '+x.border.name,area:L.round2(20-(5-.374)*(4-.374)),cov:x.border.coverage,packs:x.borderPacks,waste:10,names:['Living room — straight-plank perimeter border']} ]}};
 j.quotes.borderpractice=q;st.setDoc(docPath('jobs/'+id),j);st.audit(user.id,'created border practice quotation',id);return {id,job:j,existing:false};
}
module.exports={example,create};
