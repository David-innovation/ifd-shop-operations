'use strict';
const crypto=require('node:crypto');
const fail=(status,message)=>{throw {status,code:'clearance',message};};
const money=n=>Math.round(n*100)/100;
function validate(b,bays){
 const out={};for(const k of ['supplier','reference','line','name','colour','locationId','bay']){out[k]=String(b[k]||'').trim();if(!out[k]||out[k].length>150)fail(400,'Complete '+k+'.');}
 if(!bays.includes(out.bay))fail(400,'Choose a storage bay.');
 if(!['carpet','vinyl','laminate','spc','lvt','wood'].includes(b.kind))fail(400,'Choose the product type.');out.kind=b.kind;out.roll=['carpet','vinyl'].includes(b.kind);
 for(const k of ['selling','rrp']){out[k]=Number(b[k]);if(!Number.isFinite(out[k])||out[k]<=0||out[k]>10000)fail(400,'Enter valid selling and comparison prices per m².');out[k]=money(out[k]);}if(out.rrp<out.selling)fail(400,'The comparison price must not be below the selling price.');
 if(out.roll){out.width=Number(b.width);out.length=Number(b.length);if(!(out.width>=0.5&&out.width<=6&&out.length>0&&out.length<=1000)||Math.abs(out.length*10-Math.round(out.length*10))>1e-6)fail(400,'Enter the roll width and length in metres; length must be in 10 cm increments.');out.quantity=Math.round(out.length*10);out.area=money(out.width*out.length);}
 else{out.pallets=Number(b.pallets);out.packsPerPallet=Number(b.packsPerPallet);out.quantity=Number(b.quantity);out.coverage=Number(b.coverage);if(!Number.isInteger(out.pallets)||out.pallets<1||!Number.isInteger(out.packsPerPallet)||out.packsPerPallet<1||!Number.isInteger(out.quantity)||out.quantity<1||out.quantity>100000||!(out.coverage>0&&out.coverage<=100))fail(400,'Enter pallets, packs per pallet, actual whole packs and coverage per pack.');out.area=money(out.quantity*out.coverage);}
 return out;
}
function make({st,localStock,goodsIn,now,broadcast}){
 const db=st.db;db.exec('CREATE TABLE IF NOT EXISTS clearance_intakes(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,json TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT json FROM clearance_intakes ORDER BY rowid DESC').all().map(x=>JSON.parse(x.json));
 const access=u=>{if(!['shop','owner'].includes(u?.role))fail(403,'The office sets clearance products and selling prices.');};
 async function list(u){access(u);return {bays:goodsIn.list(u).bays,locations:[{id:'gid://floor-pilot/Location/warehouse',name:'Floor Pilot warehouse'}],receipts:rows().map(r=>({...r,local:r.local===true,stock:r.local?localStock.figures(localStock.get(r.variantId)):null})).slice(0,100)};}
 async function receive(u,b){access(u);if(!/^[\w-]{8,100}$/.test(b.key||''))fail(400,'Reload the clearance form.');
 const input=validate(b,goodsIn.list(u).bays);if(input.locationId!=='gid://floor-pilot/Location/warehouse')fail(400,'Choose the Floor Pilot warehouse.');
 const fingerprint=crypto.createHash('sha256').update([input.supplier,input.reference,input.line].map(x=>x.toLowerCase()).join('|')).digest('hex');
 db.exec('BEGIN IMMEDIATE');let r;try{const prior=rows().find(r=>r.id===b.key||r.fingerprint===fingerprint);if(prior){if(JSON.stringify(prior.input)!==JSON.stringify(input))fail(409,'This delivery line already exists with different details. Check its saved receipt.');if(!prior.local)fail(409,'This earlier Shopify attempt needs office review. Use a separate confirmed Floor Pilot intake.');db.exec('COMMIT');return {...prior,duplicate:true};}
 if(db.prepare('SELECT id FROM goods_receipts WHERE fingerprint=? OR id=?').get(fingerprint,b.key))fail(409,'This delivery line has already been received. Check Deliveries.');
 const code='CL-'+crypto.randomBytes(4).toString('hex').toUpperCase();r={id:b.key,fingerprint,code,input,state:'received',local:true,at:new Date(now()).toISOString(),by:u.name};const product=localStock.add(r);r.productId=product.productId;r.variantId=product.id;
 db.prepare('INSERT INTO clearance_intakes VALUES(?,?,?)').run(r.id,fingerprint,JSON.stringify(r));const receipt={id:r.id,fingerprint,variantId:r.variantId,title:input.name+' — '+input.colour+' · '+code,unit:input.roll?'roll':'packs',coverage:input.coverage||0,quantity:input.quantity,length:input.length||0,width:input.width||0,roll:input.roll?code:'',supplier:input.supplier,reference:input.reference,line:input.line,bay:input.bay,locationId:input.locationId,locationName:'Floor Pilot warehouse',state:'received',local:true,at:r.at,by:r.by,test:/^ZZ.*TEST/i.test(input.name)};db.prepare('INSERT INTO goods_receipts VALUES(?,?,?)').run(r.id,fingerprint,JSON.stringify(receipt));st.setDoc(require('./store').docPath('bays/'+code),{bay:input.bay});st.audit(u.id,'clearance stock received',code+' '+input.quantity+' units in '+input.bay);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}broadcast('catalogue');broadcast('bays');return r;}
 async function reconcile(u){access(u);fail(409,'This is an earlier Shopify attempt. No automatic product creation will be retried.');}
 return {list,receive,reconcile};
}
module.exports={make,validate};
