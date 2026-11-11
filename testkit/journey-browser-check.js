'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT),{create}=require('../server'),fake=require('./fake-shopify'),{docPath}=require('../lib/store');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-journey-')),texts=[],shop=fake.make();
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',OWNER_NAME:'David',OWNER_MOBILE:'07700900001',SHOPIFY_STORE:'innovationflooring',SHOPIFY_CLIENT_ID:'test-id',SHOPIFY_CLIENT_SECRET:'test-secret'},fetch:shop.fetchImpl,sendText:async(to,body)=>texts.push(body),log:()=>{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 const job={id:'journey',v:1,ref:'ZZ-JOURNEY',source:'catalogue',status:'open',type:'Fitting',sizeCheck:'verified',customer:{name:'ZZ TEST Journey',phone:'07700900555'},brief:{choices:[{k:'c',title:'Silver twist carpet',unit:'m',w:4,variantId:'gid://shopify/ProductVariant/801'}]},rooms:{},lines:{},quotes:{},pre:{}};
 [[4,3.6],[3.5,3.2],[3,2.8],[3,2.6]].forEach((v,i)=>job.rooms['r'+i]={n:i+1,name:'Bedroom '+(i+1),len:v[0],wid:v[1],area:v[0]*v[1],want:'c',status:'verified',source:'estimator',verBy:'Test',spec:{floor:'carpet',underlay:true,gripper:true}});
 job.rooms.h={n:5,name:'Hall stairs landing',want:'c',status:'verified',source:'estimator',verBy:'Test',spec:{floor:'carpet',underlay:true,gripper:true,bars:{cc:4}},hsl:{hall:{on:true,len:3,wid:1.2},landing:{on:true,len:2,wid:2},stairs:{on:true,n:12,wid:0.9,tread:25,riser:20,winders:0}}};
 app.store.setDoc(docPath('jobs/journey'),job);app.store.setDoc(docPath('settings/main'),{fitters:['Lennox'],bays:['W4-01']});
 await page.goto(base);await page.fill('#mobile','07700900001');await page.click('#b1');await page.waitForSelector('#code:visible');await page.fill('#code',/code: (\d{6})/.exec(texts.at(-1))[1]);await page.click('#b2');await page.waitForFunction(()=>document.querySelector('#storeText')?.textContent==='Shopify live');
 await page.locator('#tabs').getByRole('button',{name:/Jobs/}).click();await page.locator('#view .row').filter({hasText:'ZZ TEST Journey'}).first().click();await page.locator('#sheet').getByRole('button',{name:'Price it',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#qcat0')?.textContent.includes('£10.00'));
 await page.selectOption('#qund1','12');await page.fill('#qquantity2','50');await page.fill('#quoteBy','David Test');
 await page.getByRole('button',{name:'Save the quote',exact:true}).click();await page.waitForSelector('#msgBody');
 const saved=app.store.getDoc('jobs/journey').data,q=Object.values(saved.quotes)[0];assert.equal(q.options.underlay,'12');assert.equal(q.supply.groups[0].cuts.length,7);assert.equal(q.lines.find(x=>x.key==='gripper').needQty,50);assert.match(q.lines.find(x=>x.key==='underlay').calc,/Superior 12mm/);
 await page.locator('#modal').getByRole('button',{name:'Done',exact:true}).click();await page.locator('#sheet').getByRole('button',{name:'Customer said yes',exact:true}).click();await page.waitForSelector('#accNeedQty2');
 assert.match(await page.locator('#modal').innerText(),/stairs:.*m ×/);assert.match(await page.locator('#modal').innerText(),/Superior 12mm/);
 const units=await page.locator('select[id^=accNeedUnit]').evaluateAll(es=>es.map(e=>e.value));assert.ok(units.includes('lengths'));
 await page.locator('#accType').getByRole('button',{name:'Fitting',exact:true}).click();await page.selectOption('#accFitter','Lennox');
 await page.locator('#modal').getByRole('button',{name:'Later',exact:true}).click();await page.locator('#modal .dstrip button:enabled').first().click();await page.fill('#accBy','David Test');
 await page.getByRole('button',{name:'Save: the customer said yes',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#modal').hidden);
 const accepted=app.store.getDoc('jobs/journey').data,cut=Object.values(accepted.lines).find(l=>l.unit==='m'),gripper=Object.values(accepted.lines).find(l=>l.title==='Gripper');
 assert.equal(cut.cuts.length,7);assert.equal(cut.qty,Math.round(q.supply.groups[0].cut*10));assert.equal(gripper.qty,50);assert.equal(gripper.unit,'lengths');assert.equal(accepted.diaryAuto,true);assert.equal(accepted.diary,false);assert.equal(shop.state.drafts,1);
 assert.equal(errors.length,0,errors.join(';'));console.log('PASS: quote creation, selected underlay, 50 gripper lengths, saved 7 room cuts and acceptance handover');
 }finally{await browser.close();app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
