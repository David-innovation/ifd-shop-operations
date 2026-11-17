'use strict';
const {ONE}=require('./goods-in'),{docPath}=require('./store');
const fail=(message,status=409)=>{throw {status,code:'roll_end',message};};
function make({st,shop,now,broadcast}){
 st.db.exec('CREATE TABLE IF NOT EXISTS roll_ends(n INTEGER PRIMARY KEY AUTOINCREMENT,variant TEXT NOT NULL UNIQUE,json TEXT NOT NULL)');
 const all=()=>st.db.prepare('SELECT n,json FROM roll_ends ORDER BY n DESC').all().map(r=>({...JSON.parse(r.json),code:'RE-'+String(r.n).padStart(6,'0')}));
 const access=u=>{if(!['owner','shop','warehouse'].includes(u?.role))fail('Warehouse or shop access required.',403);};
 async function variant(id){if(!/^gid:\/\/(?:shopify\/ProductVariant\/\d+|floor-pilot\/ProductVariant\/CL-[A-F0-9]{8})$/.test(id||''))fail('Choose a carpet or vinyl roll.');const r=await shop.graphql(ONE,{id});if(r.errors?.length)fail(r.errors.map(x=>x.message).join('; '));const v=r.data?.productVariant;if(!v)fail('Roll no longer exists.');return v;}
 function figures(v){const locations=v.inventoryItem?.inventoryLevels?.nodes||[];return locations.map(x=>({id:x.location.id,name:x.location.name,...Object.fromEntries(x.quantities.map(q=>[q.name,q.quantity]))}));}
 async function create(u,b){access(u);const prior=all().find(r=>r.variantId===b.variantId);if(prior)return {...prior,duplicate:true};const v=await variant(b.variantId),width=Number(v.rollWidth?.value),length=Number(b.length),bay=String(b.bay||'').trim().toUpperCase();
  if(!v.inventoryItem?.tracked||!(width>0))fail('Choose a tracked carpet or vinyl roll with its width recorded.');
  if(!(length>0)||Math.abs(length*10-Math.round(length*10))>0.00001)fail('Enter the measured remaining length in metres, to the nearest 10 cm.');
  if(!(st.getDoc('settings/main').data?.bays||[]).includes(bay))fail('Choose its storage bay.');
  const stock=figures(v),live=stock.filter(x=>x.on_hand!==0||x.available!==0);
  if(live.length!==1)fail('The roll must be in one Shopify location. Ask the office to check its stock locations.');
  const f=live[0];if(f.on_hand!==f.available)fail('Part of this roll is still reserved for jobs. Finish those cuts and stock allocations before marking the remainder as a roll end.');
  if(Math.round(length*10)!==f.available)fail('The measured length does not match current stock ('+(f.available/10).toFixed(1)+' m). Have the office reconcile the stock count first. Nothing has changed.');
  const r={variantId:v.id,productId:v.product.id,title:v.product.title,originalVariant:v.title,originalRoll:v.rollNumber?.value||'',width,length,bay,locationId:f.id,location:f.name,at:new Date(now()).toISOString(),by:u.name,test:/^ZZ.*TEST/i.test(v.product.title)};
  try{st.db.prepare('INSERT INTO roll_ends(variant,json) VALUES(?,?)').run(v.id,JSON.stringify(r));}catch(e){const existing=all().find(r=>r.variantId===v.id);if(existing)return {...existing,duplicate:true};throw e;}
  const saved=all().find(x=>x.variantId===v.id);st.setDoc(docPath('bays/'+v.id.split('/').pop()),{bay});st.audit(u.id,'roll end labelled',saved.code+' '+v.id+' '+length+' x '+width+' m in '+bay+'. Stock quantity unchanged.');broadcast('bays');return saved;
 }
 async function list(u,q=''){access(u);const rows=all().filter(r=>[r.code,r.title,r.originalRoll,r.bay].join(' ').toLowerCase().includes(String(q).toLowerCase()));const out=[];for(const r of rows){try{const v=await variant(r.variantId),s=figures(v),available=s.reduce((n,x)=>n+x.available,0)/10;out.push({...r,available,status:available>0?'Available':'No free stock'});}catch(e){out.push({...r,available:null,status:'Stock check unavailable'});}}return {rows:out,bays:st.getDoc('settings/main').data?.bays||[]};}
 function query(op,variables){if(op!=='OpsSearch')return variables;const code=String(variables?.q||'').match(/RE-\d{6}/i)?.[0]?.toUpperCase(),r=code&&all().find(x=>x.code===code);return r?{...variables,q:'id:'+r.productId.split('/').pop()}:variables;}
 function decorate(data){const by=new Map(all().map(r=>[r.variantId,r]));function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return;}const r=by.get(x.id);if(r&&typeof x.title==='string'){x.title=(x.title==='Default Title'?'':x.title+' · ')+r.code+' · Roll end';if(x.rollStatus)x.rollStatus={value:'Remnant'};if(x.rollLocation)x.rollLocation={value:r.bay};}Object.values(x).forEach(walk);}walk(data);return data;}
 async function inspect(u,id){access(u);const v=await variant(id);return {title:v.product.title+' · '+v.title,width:Number(v.rollWidth?.value)||0,originalRoll:v.rollNumber?.value||'',stock:figures(v)};}
 return {create,list,query,decorate,inspect};
}
module.exports={make};
