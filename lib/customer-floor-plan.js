'use strict';
const crypto=require('node:crypto'),{docPath}=require('./store'),D=require('./room-drawing'),V=require('./job-layout');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function issue(st,j,L,baseUrl,now){const rooms=L.roomsOf(j);if(!rooms.length||rooms.some(r=>!r.drawing||!D.measure(r.drawing).valid))return '';const token=crypto.randomBytes(32).toString('base64url');st.setDoc(docPath('customerFloorPlans/'+hash(token)),{html:V.render(j,L,{customer:true}),created:now(),expires:now()+365*86400000});return baseUrl.replace(/\/$/,'')+'/floor-plan/'+token;}
function read(st,token,now){if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const r=st.getDoc('customerFloorPlans/'+hash(token)).data;return r&&r.expires>now()?r.html:null;}
module.exports={issue,read};
