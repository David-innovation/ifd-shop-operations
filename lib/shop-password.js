'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util');
const derive=promisify(crypto.scrypt),fail=(status,code,message)=>({status,code,message});
function make({db,now,shopUser,audit,revoke}){
 db.exec('CREATE TABLE IF NOT EXISTS shop_password(user TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS password_attempts(key TEXT PRIMARY KEY,started INTEGER NOT NULL,attempts INTEGER NOT NULL);');
 const get=db.prepare('SELECT * FROM shop_password WHERE user=?'),put=db.prepare('INSERT INTO shop_password VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,updated=excluded.updated'),attempt=db.prepare('SELECT * FROM password_attempts WHERE key=?'),setAttempt=db.prepare('INSERT INTO password_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET started=excluded.started,attempts=excluded.attempts');
 const current=()=>{const u=shopUser();return u?.active&&u.role==='shop'?u:null;};
 let saving=false,busy=0;
 function status(){const u=current();return {configured:!!(u&&get.get(u.id)),username:'shop'};}
 async function set(user,body){
  if(user?.role!=='owner')throw fail(403,'forbidden','Only the owner can set the shared shop password.');
  const u=current();if(!u)throw fail(409,'shop_missing','Set up the shared shop account first.');
  const p=body.password;if(typeof p!=='string'||p.length<15||p.length>128||p.trim().length<15)throw fail(400,'password_length','Use a passphrase of 15 to 128 characters. Several unrelated words work well.');
  if(p!==body.confirm)throw fail(400,'password_confirm','The passwords do not match.');
  if(/^(.)\1+$/.test(p)||/^(password|innovation|floorpilot|123456|qwerty)[\s\d!._-]*$/i.test(p))throw fail(400,'password_weak','Choose a less predictable passphrase.');
  if(saving)throw fail(409,'busy','A password change is already being saved.');saving=true;
  try{const salt=crypto.randomBytes(24).toString('hex'),hash=await derive(p,salt,64);put.run(u.id,salt,hash.toString('hex'),now());revoke(u.id);db.prepare('DELETE FROM password_attempts').run();audit(user.id,'shop password changed','Shared shop password set; previous shop sessions revoked.');return {ok:true};}finally{saving=false;}
 }
 async function verify(body,ip){
  const u=current(),key='shop',window=15*60000,old=attempt.get(key),n=old&&now()-old.started<window?old.attempts:0;
  if(n>=10)throw fail(429,'password_rate','Too many attempts. Wait 15 minutes or ask the owner to reset the shop password.');
  setAttempt.run(key,n?old.started:now(),n+1);
  if(busy>=2)throw fail(429,'password_busy','Another sign-in is being checked. Please try again in a moment.');
  const p=body.password;if(typeof p!=='string'||p.length>128)throw fail(401,'password_invalid','The shop sign-in details are not correct.');
  const row=u&&get.get(u.id);busy++;
  try{const hash=await derive(p,row?.salt||'unconfigured-shop-password-salt',64);if(!row||body.username!=='shop'||!crypto.timingSafeEqual(hash,Buffer.from(row.hash,'hex')))throw fail(401,'password_invalid','The shop sign-in details are not correct.');
   // Do not let a concurrent reset grant a session with the old password.
   if(get.get(u.id)?.hash!==row.hash)throw fail(401,'password_invalid','The password was changed. Please sign in again.');
   const fresh=current();if(!fresh||fresh.id!==u.id)throw fail(401,'password_invalid','The shop account changed. Please contact the owner.');
   db.prepare('DELETE FROM password_attempts WHERE key=?').run(key);
   audit(u.id,'signed in','shop password');return fresh;
  }finally{busy--;}
 }
 return {status,set,verify};
}
module.exports={make};
