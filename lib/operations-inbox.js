'use strict';
const crypto=require('node:crypto'),{validEmail}=require('./mail');
const clean=(v,n=500)=>String(v||'').trim().slice(0,n),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const deny=(message,status=400)=>{throw {status,message};};
function accounts(env){return [
 {id:'office',label:'Sales / admin',user:env.SMTP_USER,pass:env.SMTP_PASS},
 {id:'help',label:'Help',user:env.HELP_IMAP_USER||'help@innovationflooringdirect.com',pass:env.HELP_IMAP_PASS}
];}
// Bounded, read-only IMAP: never mark Gmail read, move mail or delete it.
async function readAccount(account,cursors,consume,saveCursor){
 const {ImapFlow}=require('imapflow'),{simpleParser}=require('mailparser');
 const c=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:account.user,pass:account.pass},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,disableAutoIdle:true});c.on('error',()=>{});
 try{await c.connect();const folders=await c.list(),spam=folders.find(f=>f.specialUse==='\\Junk');
  for(const folder of ['INBOX',...(spam?[spam.path]:[])]){
   const box=await c.mailboxOpen(folder,{readOnly:true}),validity=String(box.uidValidity),old=cursors[folder];
   const last=old?.validity===validity?Number(old.uid):0;
   const ids=(await c.search(last?{uid:(last+1)+':*'}:{since:new Date(Date.now()-30*86400000)},{uid:true})||[]).filter(n=>n>last).sort((a,b)=>a-b);
   for(const uid of ids.slice(0,40)){
    const meta=await c.fetchOne(uid,{size:true,envelope:true},{uid:true});if(!meta)continue;
    let m;
    if(meta.size>1024*1024){const e=meta.envelope||{};m={messageId:e.messageId,from:e.from?.[0]?.address,fromName:e.from?.[0]?.name,to:(e.to||[]).map(a=>a.address),subject:e.subject,text:'This email is over 1 MB. Open it in Gmail to read its content and attachments.',at:e.date,large:true,attachments:[]};}
    else{const raw=await c.fetchOne(uid,{source:true},{uid:true});if(!raw)continue;const p=await simpleParser(raw.source,{skipHtmlToText:false,skipImageLinks:true});m={messageId:p.messageId,from:p.from?.value?.[0]?.address,fromName:p.from?.value?.[0]?.name,to:[...(p.to?.value||[]),...(p.cc?.value||[])].map(a=>a.address),replyTo:p.replyTo?.value?.[0]?.address,subject:p.subject,text:p.text||'',at:p.date,attachments:(p.attachments||[]).map(a=>({name:clean(a.filename||'Attachment',200),size:a.size||0})),references:p.references||[]};}
    consume({...m,uid,folder,validity,spam:folder!=='INBOX'});saveCursor(folder,{validity,uid});
   }
  }
 }finally{await c.logout().catch(()=>c.close());}
}
function make({st,env,now=Date.now,broadcast=()=>{},mailer,salesLeads,reader=readAccount}){
 const db=st.db,iso=()=>new Date(now()).toISOString();let busy=false,timer,first;
 db.exec(`CREATE TABLE IF NOT EXISTS operations_mail(id TEXT PRIMARY KEY,account TEXT NOT NULL,received TEXT NOT NULL,state TEXT NOT NULL,json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS operations_mail_received ON operations_mail(received DESC);
 CREATE TABLE IF NOT EXISTS operations_mail_settings(id TEXT PRIMARY KEY,json TEXT NOT NULL);`);
 const getSetting=id=>JSON.parse(db.prepare('SELECT json FROM operations_mail_settings WHERE id=?').get(id)?.json||'{}');
 const setSetting=(id,value)=>db.prepare('INSERT INTO operations_mail_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id,JSON.stringify(value));
 const get=id=>{const r=db.prepare('SELECT json FROM operations_mail WHERE id=?').get(id);if(!r)deny('Email not found.',404);return JSON.parse(r.json);};
 const put=m=>db.prepare('INSERT INTO operations_mail VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,json=excluded.json').run(m.id,m.account,m.at,m.state,JSON.stringify(m));
 const staff=u=>{if(!['owner','shop'].includes(u?.role))deny('Shop staff only.',403);};
 for(const r of db.prepare("SELECT json FROM operations_mail WHERE json LIKE '%\"sending\"%'").all()){const m=JSON.parse(r.json);for(const s of m.replies||[])if(s.state==='sending')s.state='uncertain';put(m);}
 function ingest(account,m){
  const id=hash(account.id+'|'+(m.messageId||[m.validity,m.folder,m.uid].join('|'))),previous=db.prepare('SELECT id FROM operations_mail WHERE id=?').get(id);if(previous)return false;
  const stamp=new Date(m.at||now());const row={id,account:account.id,from:clean(m.from,254).toLowerCase(),fromName:clean(m.fromName,200),to:(m.to||[]).map(x=>clean(x,254)),replyTo:clean(m.replyTo,254),subject:clean(m.subject||'(No subject)',500),text:clean(m.text,80000),truncated:String(m.text||'').length>80000,at:Number.isFinite(stamp.getTime())?stamp.toISOString():iso(),receivedAt:iso(),messageId:clean(m.messageId,998),spam:!!m.spam,large:!!m.large,attachments:m.attachments||[],state:'new',assigned:'',version:1,readBy:[],notes:[],replies:[]};put(row);return true;
 }
 function status(u){staff(u);return {enabled:getSetting('config').enabled===true,accounts:accounts(env).map(a=>({id:a.id,label:a.label,address:a.user||'',configured:!!(a.user&&a.pass),...getSetting('status:'+a.id)})),busy,pending:db.prepare("SELECT count(*) n FROM operations_mail WHERE state!='done'").get().n};}
 async function poll(){if(busy)return {busy:true};if(!getSetting('config').enabled)return {enabled:false};busy=true;try{for(const a of accounts(env)){
   if(!a.user||!a.pass){setSetting('status:'+a.id,{ok:false,error:'Mailbox connection required.'});continue;}
   const cursors=getSetting('cursor:'+a.id);let imported=0;
   try{await reader(a,cursors,m=>{if(ingest(a,m))imported++;},(folder,cursor)=>{cursors[folder]=cursor;setSetting('cursor:'+a.id,cursors);});setSetting('status:'+a.id,{ok:true,at:iso(),imported});}
   catch{setSetting('status:'+a.id,{ok:false,at:iso(),error:'Could not check this mailbox. Check its app password and mailbox access.'});}
  }broadcast('operationsInbox');return {ok:true};}finally{busy=false;}}
 function list(u,params={}){staff(u);const q='%'+clean(params.q,200).toLowerCase()+'%',filter=['new','waiting','done'].includes(params.state)?params.state:'';
  const rows=db.prepare('SELECT json FROM operations_mail WHERE (?=\'\' OR state=?) AND (?=\'\' OR account=?) AND lower(json) LIKE ? ORDER BY received DESC LIMIT 100').all(filter,filter,params.account||'',params.account||'',q).map(r=>{const m=JSON.parse(r.json);return {id:m.id,account:m.account,from:m.from,fromName:m.fromName,subject:m.subject,at:m.at,state:m.state,assigned:m.assigned,spam:m.spam,read:m.readBy.length>0,excerpt:m.text.slice(0,180),leadId:m.leadId||'',replyIssue:m.replies.some(r=>['failed','uncertain','sending'].includes(r.state))};});return {...status(u),rows};}
 function detail(u,id){staff(u);const m=get(id),jobs=st.list('jobs').filter(r=>m.from&&String(r.data.customer?.email||'').toLowerCase()===m.from).map(r=>({id:r.id,ref:r.data.ref,name:r.data.customer?.name}));return {...m,jobs};}
 async function action(u,b){staff(u);
  if(b.action==='enable'){if(u.role!=='owner')deny('Only the owner can enable mailbox monitoring.',403);setSetting('config',{enabled:b.enabled===true,by:u.id,at:iso()});if(b.enabled)void poll();return status(u);}
  if(b.action==='check'){void poll();return status(u);}
  const m=get(b.id);
  if(b.action==='read'){if(!m.readBy.includes(u.id)){m.readBy.push(u.id);put(m);}return detail(u,b.id);}
  const by=clean(b.by,80);if(!by)deny('Enter your staff name.');
  if(b.action==='save'){
   if(m.version!==b.version)deny('Another staff member updated this email. Reopen it before saving.',409);
   if(!['new','waiting','done'].includes(b.state))deny('Choose a valid status.');
   if(b.state==='done'&&m.replies.some(r=>['uncertain','sending'].includes(r.state)))deny('Settle the uncertain send before marking this dealt with.',409);
   m.state=b.state;m.assigned=clean(b.assigned,80);m.version++;m.notes.push({at:iso(),by,text:clean(b.note,3000)||'Status: '+b.state});put(m);return {ok:true};
  }
  if(b.action==='lead'){
   if(m.leadId)return {ok:true,id:m.leadId};const r=salesLeads.action(u,{action:'add',by,key:'mail_'+m.id.slice(0,40),source:'Email — '+m.account,enquiry:m.subject+'\n'+m.text.slice(0,4500),customer:b.customer});if(r.id){m.leadId=r.id;put(m);}return {...r,linked:!!r.id};
  }
  if(b.action==='settle'){
   const s=m.replies.find(r=>r.id===b.replyId);if(s?.state!=='uncertain'||!['sent','failed'].includes(b.outcome)||!clean(b.note))deny('Record the mailbox check and its result.');s.state=b.outcome;s.resolvedBy=by;s.resolvedAt=iso();s.resolution=clean(b.note,3000);put(m);return {ok:true};
  }
  if(b.action==='reply'){
   if(m.replies.some(r=>['sending','uncertain'].includes(r.state)))deny('Check the previous send before sending again.',409);
   if(!/^[a-zA-Z0-9_-]{8,100}$/.test(b.key||''))deny('Refresh the reply form.');
   if(m.replies.some(r=>r.id===b.key))return {ok:true,duplicate:true};
   const to=m.replyTo||m.from,text=clean(b.text,15000);if(!validEmail(to)||!text)deny('Check the recipient and write a reply.');
   if(!mailer?.ready)deny('Email sending is not connected.',409);
   const cfg=st.getDoc('settings/main').data?.msgs||{};if(cfg.testOnly!==false&&!(cfg.allow||[]).some(x=>String(x).toLowerCase()===to.toLowerCase()))deny('Test mode only permits approved email addresses.',409);
   const s={id:b.key,state:'sending',by,at:iso(),to,text};m.replies.push(s);m.version++;put(m);
   try{const result=await mailer.send({to,subject:/^re:/i.test(m.subject)?m.subject:'Re: '+m.subject,text:text+'\n\nInnovation Flooring Direct\nLuxury made affordable\nsales@innovationflooringdirect.com',inReplyTo:m.messageId});s.state='sent';s.ref=result.ref;}
   catch(e){s.state=e.unsure?'uncertain':'failed';s.error=s.state==='uncertain'?'Not known if it went. Check Sent mail before sending again.':'Reply was not accepted. Check email settings.';}
   // Preserve any other staff notes saved while SMTP was in flight.
   const latest=get(m.id);latest.replies=latest.replies.map(r=>r.id===s.id?s:r);if(s.state==='sent')latest.state='waiting';latest.version++;put(latest);broadcast('operationsInbox');return {ok:s.state==='sent',state:s.state};
  }
  deny('Unknown inbox action.');
 }
 function start(){first=setTimeout(()=>void poll(),10000);first.unref();timer=setInterval(()=>void poll(),120000);timer.unref();}
 function stop(){clearTimeout(first);clearInterval(timer);}
 return {list,detail,action,status,poll,ingest,start,stop};
}
module.exports={make,accounts,readAccount};