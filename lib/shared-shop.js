'use strict';
const crypto=require('node:crypto');
// A non-phone identifier makes this account password-only. Keep the existing
// user ID so its password hash and historical audit entries remain intact.
function ensure(db,legacyMobile,at){
 const marker='password:shared-shop';
 let u=db.prepare('SELECT * FROM users WHERE mobile=?').get(marker);
 if(u)return u.id;
 const old=legacyMobile&&db.prepare('SELECT * FROM users WHERE mobile=?').get(legacyMobile);
 if(old&&old.role==='shop'){
  db.prepare('UPDATE users SET mobile=? WHERE id=?').run(marker,old.id);
  db.prepare('DELETE FROM sessions WHERE user=?').run(old.id);
  db.prepare('DELETE FROM codes WHERE mobile=?').run(legacyMobile);
  return old.id;
 }
 const id='u_'+crypto.randomBytes(9).toString('hex');
 db.prepare('INSERT INTO users(id,name,mobile,role,active,created) VALUES(?,?,?,?,1,?)').run(id,'Shop',marker,'shop',at);
 return id;
}
module.exports={ensure};
