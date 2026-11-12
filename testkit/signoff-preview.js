'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT),{create}=require('../server'),{docPath}=require('../lib/store');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifd-sign-')),texts=[],app=create({env:{DATA_DIR:dir,INSECURE_COOKIES:'1',SESSION_PEPPER:'test',OWNER_MOBILE:'07700900001'},now:()=>Date.parse('2026-11-11T12:00:00Z'),sendText:async(t,b)=>texts.push(b),log:()=>{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{app.ensureUser('TEST FITTER','07700900003','fitter');app.store.setDoc(docPath('jobs/mobile'),{status:'open',type:'Fitting',diary:true,date:'2026-11-11',fitter:'TEST FITTER',ref:'ZZ-TEST-SIGN',customer:{name:'David — TEST EXAMPLE',phone:'07700900555',address:'TEST ONLY'},sizeCheck:'verified',rooms:{r:{name:'Living room',len:4,wid:3,area:12,status:'verified'}},lines:{l:{title:'Laminate',unit:'pack',qty:5,state:'allocated',bay:'TEST',picked:true,checked:true}},fitterWork:{profiles:['laminate'],checks:Object.fromEntries(require('../lib/fitter-work').checks(['laminate']).map(c=>[c.id,{state:'done'}]))}});
await page.goto('http://127.0.0.1:'+app.server.address().port);await page.fill('#mobile','07700900003');await page.click('#b1');await page.waitForSelector('#code:visible');await page.fill('#code',/code: (\d{6})/.exec(texts.at(-1))[1]);await page.click('#b2');await page.locator('.diary-job').first().click();await page.getByRole('button',{name:'Open customer sign-off',exact:true}).click();await page.getByRole('textbox',{name:'Customer name',exact:true}).fill('David — TEST EXAMPLE');
const section=page.getByRole('dialog',{name:'Customer sign-off',exact:true});
await section.screenshot({style:'#crewBottom {visibility:hidden!important}',path:'../../outputs/customer-signoff-clean-mobile.png'});
await page.getByRole('button',{name:'Return to fitter controls',exact:true}).click();await page.getByRole('button',{name:'Record unfinished work',exact:true}).last().click();await page.getByPlaceholder('What needs finishing and what was agreed?').fill('Door bar needs finishing — return visit to be agreed.');await page.getByRole('button',{name:'Show customer visit record',exact:true}).click();
await section.screenshot({style:'#crewBottom {visibility:hidden!important}',path:'../../outputs/customer-signoff-issue-clean-mobile.png'});
await page.getByRole('button',{name:'Return to fitter controls',exact:true}).click();
await page.getByRole('button',{name:'Open customer sign-off',exact:true}).click();
assert.equal(await page.locator('dialog:modal').count(),1);
assert.equal(await section.getByRole('button',{name:'Record unfinished work',exact:true}).count(),0);
await page.getByRole('button',{name:'Confirm & sign off',exact:true}).click();await page.getByText('Please enter your name.',{exact:true}).waitFor();
await page.getByRole('textbox',{name:'Customer name',exact:true}).fill('TEST CUSTOMER');
await page.getByRole('button',{name:'Confirm & sign off',exact:true}).click();await page.getByText('Please add your signature.',{exact:true}).waitFor();
const box=await page.locator('canvas').boundingBox();await page.mouse.move(box.x+30,box.y+40);await page.mouse.down();await page.mouse.move(box.x+120,box.y+90,{steps:15});await page.mouse.up();
await page.getByRole('button',{name:'Confirm & sign off',exact:true}).click();await page.getByText('Your completed fitting has been signed off. Thank you for choosing Innovation Flooring Direct.',{exact:true}).waitFor();
assert.equal(app.store.getDoc('jobs/mobile').data.status,'done');assert.deepEqual(errors,[]);console.log('PASS: clean mobile customer screens, separate fitter controls, name and signature required, successful simulated completion.');

}finally{await browser.close();app.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});


