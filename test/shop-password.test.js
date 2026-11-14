'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{make}=require('../lib/shop-password');
test('shared password is hashed, owner-managed, rate limited and revokes only shop sessions',async()=>{
 const db=new DatabaseSync(':memory:'),clock={t:1000},revoked=[],audits=[],shop={id:'shared',role:'shop',active:1},owner={id:'owner',role:'owner'};
 const a=make({db,now:()=>clock.t,shopUser:()=>shop,revoke:id=>revoked.push(id),audit:(...x)=>audits.push(x)}),password='Test-only cedar river lantern';
 try{
 assert.equal(a.status().configured,false);
 await assert.rejects(a.set(shop,{password,confirm:password}),e=>e.status===403);
 await assert.rejects(a.set(owner,{password:'short',confirm:'short'}),e=>e.status===400);
 await assert.rejects(a.set(owner,{password,confirm:'different'}),e=>e.code==='password_confirm');
 await a.set(owner,{password,confirm:password});assert.deepEqual(revoked,['shared']);assert.equal(a.status().configured,true);
 const row=db.prepare('SELECT * FROM shop_password').get();assert.notEqual(row.hash,password);assert.equal(row.hash.length,128);assert.ok(!JSON.stringify(audits).includes(password));
 assert.equal((await a.verify({username:'shop',password})).role,'shop');
 await assert.rejects(a.verify({username:'owner',password}),e=>e.status===401);
 for(let i=0;i<9;i++)await assert.rejects(a.verify({username:'shop',password:'wrong'}),e=>e.status===401);
 await assert.rejects(a.verify({username:'shop',password}),e=>e.status===429);
 clock.t+=15*60000+1;assert.equal((await a.verify({username:'shop',password})).id,'shared');
 const next='Test-only violet candle meadow';await a.set(owner,{password:next,confirm:next});await assert.rejects(a.verify({username:'shop',password}),e=>e.status===401);assert.equal((await a.verify({username:'shop',password:next})).id,'shared');
 shop.role='owner';await assert.rejects(a.verify({username:'shop',password:next}),e=>e.status===401);
 }finally{db.close();}
});

test('phone account migrates without losing password and survives restart without a mobile setting',async()=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,mobile TEXT UNIQUE,role TEXT,active INTEGER,created TEXT); CREATE TABLE sessions(user TEXT); CREATE TABLE codes(mobile TEXT); INSERT INTO users VALUES('old','Shop','+447700900002','shop',1,'now'); INSERT INTO sessions VALUES('old'); INSERT INTO codes VALUES('+447700900002');");const ensure=require('../lib/shared-shop').ensure,find=()=>db.prepare("SELECT * FROM users WHERE id='old'").get();const auth=make({db,now:()=>1000,shopUser:find,audit:()=>{},revoke:()=>{}}),password='Test-only copper oak lantern';await auth.set({role:'owner'},{password,confirm:password});assert.equal(ensure(db,'+447700900002','now'),'old');assert.equal(find().mobile,'password:shared-shop');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM codes').get().n,0);assert.equal(ensure(db,null,'later'),'old');assert.equal((await auth.verify({username:'shop',password})).id,'old');db.close();});
