'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT),{create}=require('../server'),fake=require('./fake-shopify'),{docPath}=require('../lib/store');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-packs-')),texts=[],shop=fake.make();
 const app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',OWNER_NAME:'David',OWNER_MOBILE:'07700900001',SHOPIFY_STORE:'innovationflooring',SHOPIFY_CLIENT_ID:'test-id',SHOPIFY_CLIENT_SECRET:'test-secret'},fetch:shop.fetchImpl,sendText:async(to,body)=>texts.push(body),log:()=>{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 app.store.setDoc(docPath('settings/main'),{fitters:['Lennox'],bays:['W4-01']});
 for(const scenario of ['laminate','wood','shortage']){
 const wood=scenario==='wood', shortage=scenario==='shortage';if(shortage)shop.state.avail=1;
 const id=scenario,variant='gid://shopify/ProductVariant/'+(wood?'702':'701');
 const job={id,v:1,ref:'ZZ-'+id,source:'catalogue',status:'open',type:'Fitting',sizeCheck:'verified',customer:{name:'ZZ TEST '+id,phone:'07700900555'},brief:{choices:[{k:'c',title:wood?'Harbour Engineered Herringbone':'Royale Oak 12mm Herringbone Laminate',unit:'packs',variantId:variant}]},rooms:{},lines:{},quotes:{},pre:{}};
 [[4,3],[4,2]].forEach((v,i)=>job.rooms['r'+i]={n:i+1,name:'Room '+(i+1),len:v[0],wid:v[1],area:v[0]*v[1],want:'c',status:'verified',source:'estimator',verBy:'Test',spec:{floor:'flooring',underlay:!wood,beading:true}});
 app.store.setDoc(docPath('jobs/'+id),job);
 if(scenario==='laminate'){await page.goto(base);await page.fill('#mobile','07700900001');await page.click('#b1');await page.waitForSelector('#code:visible');await page.fill('#code',/code: (\d{6})/.exec(texts.at(-1))[1]);await page.click('#b2');}else await page.reload();
 await page.waitForFunction(()=>document.querySelector('#storeText')?.textContent==='Shopify live');
 await page.locator('#tabs').getByRole('button',{name:/Jobs/}).click();await page.locator('#view .row').filter({hasText:'ZZ TEST '+id}).first().click();await page.locator('#sheet').getByRole('button',{name:'Price it',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#qcat0')?.textContent.includes('packs'));
 if(!wood)await page.selectOption('select[id^=qundf]','gid://shopify/ProductVariant/9101');
 await page.fill('#quoteBy','David Test');await page.getByRole('button',{name:'Save the quote',exact:true}).click();await page.waitForSelector('#msgBody');
 const q=Object.values(app.store.getDoc('jobs/'+id).data.quotes)[0],count=wood?19:12;
 assert.equal(q.packs.groups[0].packs,count);assert.equal(q.packs.groups[0].variantId,variant);if(wood){assert.equal(q.lines.find(l=>l.key==='glue').price,100);assert.equal(q.lines.find(l=>l.key==='prep').price,280);}
 await page.locator('#modal').getByRole('button',{name:'Done',exact:true}).click();await page.locator('#sheet').getByRole('button',{name:'Customer said yes',exact:true}).click();
 await page.waitForFunction(()=>/packs available/.test(document.querySelector('#accSt0')?.textContent));
 assert.equal(await page.locator('#accLen0').inputValue(),String(count));assert.equal(await page.locator('#accLen0').getAttribute('readonly'),'');
 await page.locator('#accType').getByRole('button',{name:'Fitting',exact:true}).click();await page.selectOption('#accFitter','Lennox');if(!shortage){await page.locator('#modal').getByRole('button',{name:'Later',exact:true}).click();await page.locator('#modal .dstrip button:enabled').first().click();}await page.fill('#accBy','David Test');
 await page.getByRole('button',{name:'Save: the customer said yes',exact:true}).click();await page.waitForTimeout(1500); if(!(await page.locator('#modal').evaluate(e=>e.hidden))) throw Error(await page.locator('#modal').innerText());
 const accepted=app.store.getDoc('jobs/'+id).data,lines=Object.values(accepted.lines),floor=lines.find(l=>l.variantId===variant),beading=lines.find(l=>l.title==='Beading');
 assert.equal(floor.qty,count);assert.equal(floor.unit,'packs');assert.equal(floor.cov,wood?1.2:1.836);assert.equal(floor.hold,shortage?'supplier':'draft');assert.equal(accepted.total,q.total);assert.equal(accepted.fitterDue,q.lines.find(l=>l.key==='fitting').price);assert.equal(beading.unit,'lengths');assert.equal(accepted.diary,false);assert.equal(accepted.diaryAuto,true);if(shortage)assert.equal(accepted.date,'');
 if(!wood){const under=lines.find(l=>l.variantId==='gid://shopify/ProductVariant/9101');assert.equal(under.qty,2);assert.equal(under.hold,'draft');}
 const draft=Object.values(shop.state.docs).at(-1);assert.equal(draft.total,Math.round((q.total-accepted.fitterDue)*100)/100);if(shortage)assert.equal(draft.input.lineItems.find(l=>l.variantId===variant),undefined);else assert.equal(draft.input.lineItems.find(l=>l.variantId===variant).quantity,count);
 console.log('PASS '+id+': quote -> exact packs, accessories, Shopify reservation, unchanged total, separate fitter payment');
 }
 assert.equal(errors.length,0,errors.join(';'));assert.equal(shop.state.drafts,3);
 }finally{await browser.close();app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});


