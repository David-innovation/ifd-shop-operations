'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../server'),{docPath}=require('../lib/store'),D=require('../lib/room-drawing'),F=require('../lib/fitter-details'),P=require('../lib/cutting-print');
test('approved shaped cuts update quote and planned stock once and preserve the full fitter / print plan',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shape-handover-')),app=create({env:{DATA_DIR:dir,SESSION_PEPPER:'test'},log:()=>{},pollMs:3600000}),owner={id:'shape-test',name:'Practice owner',role:'owner'},id='shape-practice',d=docPath('jobs/'+id);
 try{
 const vertices=[[0,0],[3.8,0],[3.8,1],[1.8,1],[1.8,3.8],[0,3.8]],drawing=D.clean({points:vertices.map(([x,y])=>({x:x*100+25,y:y*100+25})),lengths:vertices.map(([x,y],i)=>{const b=vertices[(i+1)%vertices.length];return Math.abs(x-b[0])+Math.abs(y-b[1]);}),closed:true});
 const rooms={a:{name:'Recessed bedroom',want:'same',status:'verified',spec:{floor:'carpet',underlay:true},drawing,len:3.8,wid:3.8},b:{name:'Landing',want:'same',status:'verified',spec:{floor:'carpet',underlay:true},len:2.5,wid:1.6}};
 app.store.setDoc(d,{test:true,status:'open',type:'Fitting',ref:'SHAPE PRACTICE',customer:{name:'Practice only'},fitterDue:100,rooms,brief:{choices:[{k:'same',title:'Zenith — Caribou',widths:[4]}]},cuttingSpec:{material:'Zenith — Caribou',pattern:'plain',sameBatch:true,pileConfirmed:true,widths:[4],baselineArea:26},quotes:{initial:{n:1,at:'2026-11-16T12:00:00Z',options:{carpetRate:20},lines:[{key:'carpet',label:'Carpet',price:520},{key:'underlay',label:'Underlay',price:40},{key:'bars',label:'Door bars',price:16.99},{key:'fitting',label:'Fitting',price:100}],total:676.99}}});
 const get=()=>({...app.store.getDoc(d.path).data,id}),before=JSON.stringify(get().rooms),net=app.rules.pricingOf(get()).underlayCarpet;
 const preview=await app.commands.run('cutting.preview',{jobId:id},owner);assert.equal(preview.plan.area,15.6);
 const approved=await app.commands.run('cutting.approve',{jobId:id,version:preview.version,rate:20},owner),j=get(),q=app.rules.quoteOf(j);
 assert.equal(q.lines.find(x=>x.key==='carpet').price,312);assert.equal(q.total,468.99);assert.equal(q.lines.find(x=>x.key==='underlay').price,40);assert.equal(app.rules.pricingOf(j).underlayCarpet,net);assert.equal(JSON.stringify(j.rooms),before);
 assert.equal(app.rules.supplyPlan(j).groups[0].sq,15.6);assert.equal(app.rules.supplyPlan(j).groups[0].cut,3.9);assert.equal(app.rules.linesOf(j).filter(x=>x.cuttingApproval)[0].qty,39);assert.equal(app.rules.linesOf(j).filter(x=>x.cuttingApproval)[0].hold,'none');
 const again=await app.commands.run('cutting.preview',{jobId:id},owner);assert.equal((await app.commands.run('cutting.approve',{jobId:id,version:again.version,rate:20},owner)).duplicate,true);assert.equal(Object.keys(get().quotes).length,2);
 const details=F.details(j,app.rules);assert.equal(details.cuttingPlan.status,'approved');assert.match(details.cuttingPlan.bins[0].shapeDiagram,/<path/);assert.equal(details.cuttingPlan.bins[0].shapeEdges.length,6);assert.equal(details.fitterDue,100);assert.equal(details.rooms[0].drawing.points.length,6);
 const html=P.render(j);assert.match(html,/Exact shape edges/);assert.match(html,/P1\.6/);assert.match(html,/outer size/);assert.match(html,/TEST JOB/);assert.equal(approved.cuttingApproval.supply.groups[0].cuts[0].pieces.some(x=>x.shape),true);
 app.store.updateDoc(d,{rooms:{a:{drawing:{...drawing,lengths:[3.9,...drawing.lengths.slice(1)]}}}});assert.equal(app.rules.cuttingApproved(get()),false);
 }finally{app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
