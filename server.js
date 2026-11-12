'use strict';
/* IFD Shop Operations, hosted.
   One small server: sign-in by texted code, the shop's records, the line to Shopify, pictures, and live updates between screens.
   Nothing secret is in this file. Keys and phone numbers come from the hosting environment. */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const store = require('./lib/store'), shopifyLib = require('./lib/shopify'), sms = require('./lib/sms'), mail = require('./lib/mail'), rules = require('./lib/rules'), commands = require('./lib/commands');

const SHOP_ROLES = ['owner', 'shop'];                       /* full shop screens */
const ROLES = ['owner', 'shop', 'fitter', 'estimator'];
const CODE_MINUTES = 10, CODE_TRIES = 5, SENDS_PER_WINDOW = 3, WINDOW_MS = 15 * 60000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const SKEL = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>';

function create(opts){
  opts = opts || {};
  const env = opts.env || process.env, log = opts.log || console.log, fetchImpl = opts.fetch || fetch, now = opts.now || (() => Date.now());
  const dataDir = env.DATA_DIR || path.join(__dirname, 'data'), st = store.open(dataDir);
  const shop = shopifyLib.client(env, fetchImpl), sendText = opts.sendText || sms.sender(env, fetchImpl, log);
  const secure = env.INSECURE_COOKIES !== '1', pepper = env.SESSION_PEPPER || 'not-for-production';
  const hash = s => crypto.createHmac('sha256', pepper).update(String(s)).digest('hex');
  const iso = () => new Date(now()).toISOString();
  const pub = name => fs.readFileSync(path.join(__dirname, 'public', name), 'utf8');
  const appBody = fs.readFileSync(path.join(__dirname, 'app', 'ifd-shop-operations.html'), 'utf8');
  /* which build of the screens this is, so a screen left open can tell when it has been replaced */
  const VERSION = crypto.createHash('sha256').update(appBody + pub('shim.js')).digest('hex').slice(0, 12);
  const appHtml = () => SKEL + '<meta name="ifd-version" content="' + VERSION + '"><script src="/shim.js"></script><script src="/reschedule.js"></script></head><body>' + appBody + '</body></html>';
  const db = st.db;
  /* the same rules the screens use, and the two ways a message can leave: the text service and the mail server */
  const L = rules.load(appBody);
  const texter = opts.texter || sms.make(env, fetchImpl, log), mailer = opts.mailer || mail.make(env, log);
  const q = {
    userByMobile: db.prepare('SELECT * FROM users WHERE mobile = ?'), userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    addUser: db.prepare('INSERT INTO users(id, name, mobile, role, active, created) VALUES(?, ?, ?, ?, 1, ?)'),
    setUser: db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?'),
    users: db.prepare('SELECT id, name, role, active FROM users ORDER BY name'),
    code: db.prepare('SELECT * FROM codes WHERE mobile = ?'),
    putCode: db.prepare('INSERT INTO codes(mobile, hash, expires, tries, sent, win) VALUES(?, ?, ?, 0, ?, ?) ON CONFLICT(mobile) DO UPDATE SET hash = excluded.hash, expires = excluded.expires, tries = 0, sent = excluded.sent, win = excluded.win'),
    tryCode: db.prepare('UPDATE codes SET tries = tries + 1 WHERE mobile = ?'), dropCode: db.prepare('UPDATE codes SET hash = \'\', expires = 0 WHERE mobile = ?'),
    session: db.prepare('SELECT * FROM sessions WHERE hash = ?'), addSession: db.prepare('INSERT INTO sessions(hash, user, expires, created) VALUES(?, ?, ?, ?)'),
    dropSession: db.prepare('DELETE FROM sessions WHERE hash = ?'), dropSessionsOf: db.prepare('DELETE FROM sessions WHERE user = ?'), sweep: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    addAsset: db.prepare('INSERT INTO assets(id, type, size, by, at) VALUES(?, ?, ?, ?, ?)'), asset: db.prepare('SELECT * FROM assets WHERE id = ?'), dropAsset: db.prepare('DELETE FROM assets WHERE id = ?')
  };

  /* the people who may sign in to begin with: the owner and the shop's shared screen. Everyone else is added by the owner. */
  function ensureUser(name, mobile, role){
    const m = sms.normaliseMobile(mobile); if (!m) return null;
    const u = q.userByMobile.get(m);
    if (u){ if (u.name !== name || u.role !== role) q.setUser.run(name, role, u.active, u.id); return u.id; }
    const id = 'u_' + crypto.randomBytes(9).toString('hex'); q.addUser.run(id, name, m, role, iso()); return id;
  }
  ensureUser(env.OWNER_NAME || 'Owner', env.OWNER_MOBILE, 'owner');
  ensureUser('Shop', env.SHOP_MOBILE, 'shop');

  /* ---------- small helpers ---------- */
  const ipSends = new Map(), listeners = new Set();
  function send(res, status, body, headers){
    const h = Object.assign({'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':res.getHeader('referrer-policy')||'same-origin', 'x-frame-options':'DENY'}, headers || {});
    if (typeof body === 'object' && !Buffer.isBuffer(body)){ body = JSON.stringify(body); h['content-type'] = 'application/json; charset=utf-8'; }
    res.writeHead(status, h); res.end(body);
  }
  const page = (res, html, status) => send(res, status || 200, html, {'content-type':'text/html; charset=utf-8',
    'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  const fail = (res, status, code, message) => send(res, status, {error:{code:code, message:message}});
  function readBody(req, limit){
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > limit){ reject({status:413, code:'too_large', message:'That is too big to save.'}); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', () => reject({status:400, code:'bad_request', message:'The request was cut off.'}));
    });
  }
  async function readJson(req){ const b = await readBody(req, 2 * 1024 * 1024); try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch (e){ throw {status:400, code:'bad_request', message:'That could not be read.'}; } }
  function cookieOf(req){ const m = /(?:^|;\s*)ifd_s=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || ''); return m ? m[1] : ''; }
  function userOf(req){
    const t = cookieOf(req); if (!t) return null;
    const s = q.session.get(hash(t)); if (!s || s.expires < now()) return null;
    const estimatorTrial=s.user.startsWith('esttrial_');
    const restricted=s.user.startsWith('trial_');
    const u = q.userById.get(estimatorTrial?s.user.slice(9):restricted?s.user.slice(6):s.user);
    if(!u||!u.active)return null;
    if(estimatorTrial)return {...u,id:'esttrial_'+u.id,name:u.name+' - estimator trial',role:'estimator'};
    if(restricted)return {...u,id:'trial_'+u.id,name:u.name+' - fitter trial',role:'fitter'};
    // Permanently restrict legacy owner-trial sessions; removing a browser flag cannot restore owner access.
    if(u.role==='owner'&&/(?:^|;\s*)ifd_trial=1(?:;|$)/.test(req.headers.cookie||'')){
      db.prepare('UPDATE sessions SET user = ? WHERE hash = ?').run('trial_'+u.id,hash(t));
      return {...u,id:'trial_'+u.id,name:u.name+' - fitter trial',role:'fitter'};
    }
    return u;
  }
  function setSession(res, user){
    const token = crypto.randomBytes(32).toString('base64url'), days = SHOP_ROLES.indexOf(user.role) !== -1 ? 14 : 30;
    q.sweep.run(now()); q.addSession.run(hash(token), user.id, now() + days * 86400000, iso());
    res.setHeader('set-cookie', 'ifd_s=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + days * 86400 + (secure ? '; Secure' : ''));
  }
  /* a change has to come from this system's own pages, not from a link on another site */
  function sameSite(req){
    if (req.headers['x-ifd'] !== '1') return false;
    const o = req.headers.origin; if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch (e){ return false; }
  }
  function broadcast(coll){ const msg = 'event: change\ndata: ' + JSON.stringify({coll:coll}) + '\n\n'; listeners.forEach(r => { try { r.write(msg); } catch (e) {} }); }
  const quoteAcceptance=require('./lib/quote-acceptance').make({st,L,now,broadcast,baseUrl:env.PUBLIC_URL||env.RENDER_EXTERNAL_URL||'https://ifd-shop-operations.onrender.com'});
  const cmds = commands.make({st, L, texter, mailer, now, log, broadcast, quoteAcceptance, pollMs:opts.pollMs});
  cmds.start();
  const appointments = require('./lib/appointments').make({st,cmds,users:()=>q.users.all(),now,L,broadcast});

  const estimatorTools=require('./lib/estimator-tools').make({st,L,shop,now,broadcast,allowed:appointments.allowed,visitJob:appointments.visitJob,saveAsset:(id,type,buf,u,at)=>{fs.writeFileSync(path.join(dataDir,'assets',id),buf);q.addAsset.run(id,type,buf.length,u.id,at);}});
  /* ---------- sign-in by texted code ---------- */
  async function requestCode(req, res){
    const body = await readJson(req), mobile = sms.normaliseMobile(body.mobile), ip = req.socket.remoteAddress || '';
    const seen = ipSends.get(ip) || {n:0, at:now()}; if (now() - seen.at > WINDOW_MS){ seen.n = 0; seen.at = now(); }
    seen.n++; ipSends.set(ip, seen);
    if (!mobile) return fail(res, 400, 'bad_mobile', 'Enter a mobile number, for example 07700 900123.');
    if (seen.n > 10) return fail(res, 429, 'rate_limited', 'Too many tries. Wait a quarter of an hour.');
    const user = q.userByMobile.get(mobile);
    /* the answer is the same whether or not the number is known, so nobody can use this to find out who has an account */
    if (user && user.active){
      const c = q.code.get(mobile), fresh = !c || now() - c.win > WINDOW_MS, sent = fresh ? 1 : c.sent + 1;
      if (sent <= SENDS_PER_WINDOW){
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        q.putCode.run(mobile, hash(mobile + ':' + code + (body.mode==='fitter'?':fitter':'')), now() + CODE_MINUTES * 60000, sent, fresh ? now() : c.win);
        try { await sendText(mobile, 'IFD Shop Operations sign-in code: ' + code + '. It lasts ' + CODE_MINUTES + ' minutes. Nobody from the shop will ask you for it.'); }
        catch (e){ log('TEXT FAILED to ' + mobile + ': ' + (e && e.message)); }
      }
    }
    send(res, 200, {ok:true});
  }
  async function verifyCode(req, res){
    const body = await readJson(req), mobile = sms.normaliseMobile(body.mobile), code = String(body.code || '').replace(/\D/g, '');
    const bad = () => fail(res, 401, 'bad_code', 'That code is not right or has run out. Ask for a new one.');
    if (!mobile || code.length !== 6) return bad();
    const user = q.userByMobile.get(mobile), c = q.code.get(mobile);
    if (!user || !user.active || !c || !c.hash || c.expires < now() || c.tries >= CODE_TRIES) return bad();
    const want = Buffer.from(c.hash, 'hex'), got = Buffer.from(hash(mobile + ':' + code + (body.mode==='fitter'?':fitter':'')), 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)){ q.tryCode.run(mobile); return bad(); }
    q.dropCode.run(mobile);                                   /* a code works once */
    const signedUser=body.mode==='fitter'&&user.role==='owner'?{...user,id:'trial_'+user.id,role:'fitter'}:user;
    const previous=cookieOf(req);if(previous)q.dropSession.run(hash(previous));
    setSession(res, signedUser);
    res.setHeader('set-cookie',[res.getHeader('set-cookie'),'ifd_trial=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+(secure?'; Secure':'')]);
    st.audit(user.id, 'signed in', signedUser.role);
    send(res, 200, {ok:true, role:signedUser.role});
  }

  /* ---------- records ---------- */
  async function dbRoute(req, res, url, user, what){
    if (req.method === 'GET' && what === 'doc'){ const d = store.docPath(url.searchParams.get('path')); if (!d) return fail(res, 400, 'invalid_argument', 'Bad path.'); return send(res, 200, st.getDoc(d.path)); }
    if (req.method === 'GET' && what === 'list'){
      const c = store.collPath(url.searchParams.get('coll')); if (!c) return fail(res, 400, 'invalid_argument', 'Bad path.');
      return send(res, 200, {docs:st.list(c, url.searchParams.get('order') || '', url.searchParams.get('dir') || 'asc', Number(url.searchParams.get('limit')) || 0)});
    }
    if (req.method !== 'POST') return fail(res, 405, 'bad_request', 'Not allowed.');
    const body = await readJson(req);
    if (what === 'add'){
      const c = store.collPath(body.coll); if (!c || !body.data || typeof body.data !== 'object') return fail(res, 400, 'invalid_argument', 'Bad path.');
      const id = st.newId(), d = store.docPath(c + '/' + id); st.setDoc(d, body.data); st.audit(user.id, 'add', d.path); broadcast(c); return send(res, 200, {id:id});
    }
    const d = store.docPath(body.path); if (!d) return fail(res, 400, 'invalid_argument', 'Bad path.');
    if (what === 'delete'){ st.deleteDoc(d.path); st.audit(user.id, 'delete', d.path); broadcast(d.coll); return send(res, 200, {ok:true}); }
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return fail(res, 400, 'invalid_argument', 'Nothing to save.');
    /* money, messages and cutting have rules of their own, so these plain routes may not change them */
    if ((what === 'set' || what === 'update') && d.coll === 'jobs') cmds.guardJobWrite(d, body.data, what === 'set', user);
    if ((what === 'set' || what === 'update') && d.path === 'settings/main') cmds.guardSettings(d, body.data, what === 'set', user);
    if (what === 'set'){ st.setDoc(d, body.data); cmds.reconcile(d); st.audit(user.id, 'set', d.path); broadcast(d.coll); return send(res, 200, {ok:true}); }
    if (what === 'update'){
      if (!st.updateDoc(d, body.data)) return fail(res, 404, 'invalid_argument', 'That record does not exist.');
      cmds.reconcile(d); st.audit(user.id, 'update', d.path); broadcast(d.coll); return send(res, 200, {ok:true});
    }
    fail(res, 404, 'not_found', 'Not found.');
  }

  /* ---------- Shopify ---------- */
  async function shopifyRoute(req, res, user){
    const body = await readJson(req), kind = body.kind === 'mutation' ? 'mutation' : 'query', op = shopifyLib.allowed(body.query, kind);
    if (!op) return fail(res, 400, 'not_in_manifest', 'That Shopify request is not one this system makes.');
    if (kind === 'mutation') st.audit(user.id, 'shopify ' + op.name, JSON.stringify(body.variables || {}).slice(0, 600));
    try { send(res, 200, {body:await shop.graphql(body.query, body.variables)}); }
    catch (e){ send(res, 502, {error:{code:e.code || 'upstream_error', message:e.message || 'Shopify did not answer.', retryable:!!e.retryable, retryAfterMs:e.retryAfterMs || 0}}); }
  }

  /* ---------- pictures ---------- */
  async function assetUpload(req, res, user){
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (IMAGE_TYPES.indexOf(type) === -1) return fail(res, 415, 'unsupported_type', 'Only photos can be stored.');
    const buf = await readBody(req, 20 * 1024 * 1024); if (!buf.length) return fail(res, 400, 'invalid_request', 'The picture was empty.');
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(dataDir, 'assets', id), buf); q.addAsset.run(id, type, buf.length, user.id, iso());
    send(res, 200, {id:id, url:'/_blob/' + id, sizeBytes:buf.length, contentType:type});
  }

  /* ---------- where a postcode district is, to tell how far apart two jobs are ----------
     Only the first half of a postcode (G84) is ever looked up, never a customer's full postcode. Answers are kept. */
  async function geoRoute(res, url){
    const codes = Array.from(new Set(String(url.searchParams.get('codes') || '').toUpperCase().split(',').map(x => x.trim()).filter(x => /^[A-Z]{1,2}\d[A-Z\d]?$/.test(x)))).slice(0, 40), out = {};
    for (const c of codes){
      const d = store.docPath('geo/' + c); let rec = st.getDoc(d.path);
      const old = rec.exists && rec.data.none && now() - Date.parse(rec.data.at) > 7 * 86400000;
      if (!rec.exists || old){
        try {
          const r = await fetchImpl('https://api.postcodes.io/outcodes/' + c, {headers:{accept:'application/json'}, signal:AbortSignal.timeout(6000)}), j = await r.json().catch(() => null);
          const ok = !!(j && j.result && Number.isFinite(j.result.latitude) && Number.isFinite(j.result.longitude));
          if (ok || r.status === 404){ const data = ok ? {lat:j.result.latitude, lng:j.result.longitude, at:iso()} : {none:true, at:iso()}; st.setDoc(d, data); rec = {exists:true, data:data}; }
        } catch (e) { /* not known this time: the screens carry on without a distance */ }
      }
      if (rec.exists && !rec.data.none) out[c] = {lat:rec.data.lat, lng:rec.data.lng};
    }
    return send(res, 200, {codes:out});
  }

  /* ---------- the router ---------- */
  async function handle(req, res){
    const url = new URL(req.url, 'http://x'), p = url.pathname, authUser=userOf(req);
    const trial=authUser?.role==='owner'&&/(?:^|;\s*)ifd_trial=1(?:;|$)/.test(req.headers.cookie||'');
    const user=trial?{...authUser,id:'trial_'+authUser.id,name:authUser.name+' - fitter trial',role:'fitter',trial:true}:authUser, shopUser=user&&SHOP_ROLES.includes(user.role);
    if(p.startsWith('/quote/')){
      res.setHeader('referrer-policy','no-referrer');
      const token=p.slice(7);
      try{
        if(req.method==='POST'){
          if(req.headers.origin&&req.headers.origin!=='null'&&new URL(req.headers.origin).host!==req.headers.host)return fail(res,403,'forbidden','Please open the quote link and confirm there.');
          const form=new URLSearchParams((await readBody(req,2048)).toString('utf8'));
          if(form.get('confirm')!=='yes')return fail(res,400,'confirmation_required','Please tick the confirmation box.');
          quoteAcceptance.accept(token);res.writeHead(303,{location:'/quote/'+token,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end();
        }
        if(req.method!=='GET')return fail(res,405,'method','Method not allowed.');
        return page(res,quoteAcceptance.page(token));
      }catch(e){return page(res,'<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px/1.6 Arial;max-width:600px;margin:60px auto;padding:24px"><h1>Innovation Flooring Direct</h1><p>'+require('./lib/quote-email').esc(e.message||'Please contact the shop.')+'</p><a href="mailto:sales@innovationflooringdirect.com">Contact our sales team</a></body></html>',e.status||500);}
    }
    if (p === '/healthz') return send(res, 200, 'ok', {'content-type':'text/plain'});
    if (p === '/reschedule.js') return send(res,200,pub('reschedule.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/estimator-tools.js') return send(res,200,pub('estimator-tools.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/room-drawing-model.js') return send(res,200,fs.readFileSync(path.join(__dirname,'lib/room-drawing.js')),{"content-type":"text/javascript; charset=utf-8"});
    if (p === '/room-drawing-editor.js') return send(res,200,pub('room-drawing-editor.js'),{"content-type":"text/javascript; charset=utf-8"});
    if (p === '/room-drawing.css') return send(res,200,pub('room-drawing.css'),{"content-type":"text/css; charset=utf-8"});
    if (p === '/room-survey.js') return send(res,200,pub('room-survey.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/estimator-details.js') return send(res,200,pub('estimator-details.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/fitter-work.js') return send(res,200,pub('fitter-work.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/fitter-diary.js') return send(res,200,pub('fitter-diary.js'),{'content-type':'text/javascript; charset=utf-8'});
    if (p === '/crew-style.css') return send(res,200,pub('crew-style.css'),{'content-type':'text/css; charset=utf-8'});
    if (p === '/shop-after-dark.css') return send(res,200,pub('shop-after-dark.css'),{'content-type':'text/css; charset=utf-8'});
    if (p === '/after-dark.css') return send(res,200,pub('after-dark.css'),{'content-type':'text/css; charset=utf-8'});
    if (p === '/after-dark-wave.svg') return send(res,200,pub('after-dark-wave.svg'),{'content-type':'image/svg+xml'});
    if (p === '/shim.js') return send(res, 200, pub('shim.js'), {'content-type':'text/javascript; charset=utf-8'});
    if (p === '/fitter' && req.method === 'GET') return page(res,pub('login.html'));
    if (req.method === 'GET' && (p === '/' || p === '/login')){
      if (!user) return page(res, pub('login.html'));
      if (p === '/login'){ res.writeHead(302, {location:'/'}); return res.end(); }
      return page(res, shopUser ? appHtml() : ['fitter','estimator'].includes(user.role) ? pub('appointments.html') : pub('holding.html').replace('{{name}}', String(user.name).replace(/[<>&"]/g, '')));
    }
    if (p.startsWith('/api/') && req.method !== 'GET' && !sameSite(req)) return fail(res, 403, 'forbidden', 'That did not come from this system’s own pages.');
    if (p === '/api/login/code' && req.method === 'POST') return requestCode(req, res);
    if (p === '/api/login/verify' && req.method === 'POST') return verifyCode(req, res);
    if (p === '/api/logout' && req.method === 'POST'){ const t = cookieOf(req); if (t) q.dropSession.run(hash(t)); res.setHeader('set-cookie', 'ifd_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '')); return send(res, 200, {ok:true}); }
    if (!user && p === '/appointments' && req.method === 'GET') return page(res, pub('login.html'));
    if (!user) return fail(res, 401, 'signed_out', 'Sign in first.');
    if(p==='/document'&&req.method==='GET'){
      if(!shopUser)return fail(res,403,'forbidden','Only shop staff can view quotes and invoices.');
      const id=url.searchParams.get('job')||'';if(!/^[\w-]+$/.test(id))return fail(res,400,'job','Choose a job.');
      const job=st.getDoc('jobs/'+id).data;if(!job)return fail(res,404,'job','Job not found.');
      if(url.searchParams.get('kind')==='invoice'){
        const inv=require('./lib/invoice').make({st,L,now,broadcast}).get(job);return page(res,require('./lib/invoice').html(inv,job,L));
      }
      const q=L.quoteOf(job);if(!q)return fail(res,404,'quote','No saved quote.');
      const shop={name:'Innovation Flooring Direct',email:'sales@innovationflooringdirect.com',phone:'0141 952 5200',words:st.getDoc('settings/main').data?.words||{}};
      return page(res,require('./lib/quote-email').html({job,q,L,body:L.quoteMessage(job,q,shop),action:'<p style="text-align:center">Preview only — sending the email adds the customer’s secure Accept my quote button.</p>'}));
    }
    if(p==='/cutting-plan'&&req.method==='GET'){
      if(!shopUser)return fail(res,403,'forbidden','Only shop staff can print warehouse cutting plans.');
      const id=url.searchParams.get('job')||'';if(!/^[\w-]+$/.test(id))return fail(res,400,'invalid_job','Choose a job.');
      const rec=st.getDoc('jobs/'+id);if(!rec.exists)return fail(res,404,'not_found','Job not found.');
      if(!L.cuttingApproved(rec.data)||!rec.data.cuttingApproval?.plan?.bins?.length)return fail(res,409,'cutting_approval','Approve the current cutting plan before printing warehouse instructions.');
      return page(res,require('./lib/cutting-print').render({...rec.data,id}));
    }
    if(p==='/api/my-availability'&&req.method==='POST'){const result=require('./lib/my-availability').save(st,user,await readJson(req),now());broadcast('timeoff');return send(res,200,result);}
    if(p==='/api/my-signin-link'&&req.method==='POST'){
      if(!['owner','shop','fitter','estimator'].includes(user.role))return fail(res,403,'forbidden','This account cannot request a sign-in link.');
      const dest=store.docPath('stafflinks/'+user.id),old=st.getDoc(dest.path).data||{};
      if(['sending','unsure'].includes(old.state))return fail(res,409,'pending','The earlier text needs checking before sending again.');
      if(old.at&&now()-Date.parse(old.at)<60000)return fail(res,429,'rate_limited','The link was just sent. Please check your texts.');
      const body='Welcome to Innovation Flooring Direct. Your fitter diary: https://ifd-shop-operations.onrender.com/fitter Enter your mobile, tap Text me a code, then enter the new code to sign in. Your assigned jobs are ready to view.';
      st.setDoc(dest,{state:'sending',at:iso(),to:user.mobile});
      try{const result=await texter.send(user.mobile,body);st.setDoc(dest,{state:'sent',at:iso(),to:user.mobile,ref:result.ref});st.audit(user.id,'texted own sign-in link',result.ref);return send(res,200,{ok:true,state:'sent',ref:result.ref});}
      catch(e){st.setDoc(dest,{state:e.unsure?'unsure':'failed',at:iso(),to:user.mobile});return fail(res,502,'send_failed',e.message||'Text could not be sent.');}
    }
    if(p==='/api/fitter-practice'&&req.method==='POST'){
      const owner=user.role==='owner'?user:user.id.startsWith('trial_')?q.userById.get(user.id.slice(6)):null;
      if(!owner||owner.role!=='owner'||!owner.active)return fail(res,403,'forbidden','Practice jobs are only available for the owner trial.');
      const result=require('./lib/fitter-practice')(st,owner,now(),(await readJson(req)).scenario);st.audit(owner.id,'created fitter practice jobs','');broadcast('jobs');return send(res,200,result);
    }
    if(p==='/api/estimator-trial'&&req.method==='POST'){
      if(authUser.role!=='owner')return fail(res,403,'forbidden','Only the owner can open their estimator trial.');
      const id='ZZ-OWNER-ESTIMATOR-'+authUser.id,d=store.docPath('jobs/'+id),whoId='esttrial_'+authUser.id;
      if(!st.getDoc(d.path).exists){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));st.setDoc(d,{test:true,status:'open',type:'Fitting',diary:false,ref:'ZZ ESTIMATOR TRIAL',customer:{name:'ZZ TEST - David estimator trial',phone:authUser.mobile,email:'David@innovationflooringdirect.com',address:'64 King Street - TEST ONLY',postcode:'G81 1DX'},brief:{rooms:'Living room and bedroom',note:'TEST ONLY - measure rooms, accessories, preparation and concealed subfloor. No real order or stock.'},rooms:{},lines:{},total:0,notes:'OWNER ESTIMATOR TRIAL ONLY. No real appointment, stock or payment.',pre:{trial:{kind:'both',status:'booked',date,who:authUser.name+' - estimator trial',whoId,duration:60}}});broadcast('jobs');}
      q.dropSession.run(hash(cookieOf(req)));setSession(res,{...authUser,id:whoId,role:'estimator'});return send(res,200,{ok:true});
    }
    if(p==='/api/fitter-trial'&&req.method==='POST'){
      if(authUser.role!=='owner')return fail(res,403,'forbidden','Only the owner can open their fitter trial.');
      const b=await readJson(req);if(typeof b.enabled!=='boolean')return fail(res,400,'invalid_argument','Choose the shop or fitter trial.');
      const id='ZZ-OWNER-FITTER-'+authUser.id,d=store.docPath('jobs/'+id),fitterId='trial_'+authUser.id;
      if(b.enabled&&!st.getDoc(d.path).exists){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));st.setDoc(d,{test:true,status:'open',type:'Fitting',diary:true,date,fitter:authUser.name+' - fitter trial',fitterId,ref:'ZZ FITTER TRIAL',customer:{name:'ZZ TEST - David fitter trial',phone:authUser.mobile,email:'David@innovationflooringdirect.com',address:'TEST ONLY - no customer appointment'},sizeCheck:'verified',rooms:{lounge:{name:'Trial lounge',len:4,wid:3,area:12,status:'verified',source:'shop',verBy:'TEST ONLY',verRole:'shop',verOn:date}},lines:{floor:{title:'TEST ONLY laminate flooring',qty:4,unit:'packs',hold:'none'},beading:{title:'TEST ONLY beading',qty:6,unit:'lengths',hold:'none'},bars:{title:'TEST ONLY door bar',qty:1,unit:'each',hold:'none'}},total:0,fitterDue:0,notes:'OWNER FITTER TRIAL ONLY. No stock reserved, no real payment or appointment. Messages go to David only.',fitterWork:{profiles:['laminate'],version:0}});broadcast('jobs');}
      if(!b.enabled)return fail(res,403,'forbidden','Sign out and sign in separately for owner access.');
      q.dropSession.run(hash(cookieOf(req)));setSession(res,{...authUser,id:fitterId,role:'fitter'});
      res.setHeader('set-cookie',[res.getHeader('set-cookie'),'ifd_trial=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+(secure?'; Secure':'')]);return send(res,200,{ok:true,enabled:true});
    }
    if (p === '/api/me') return send(res, 200, {id:user.id, name:user.name, role:user.role});
    if (p === '/appointments' && req.method === 'GET') { if (!shopUser && !['fitter','estimator'].includes(user.role)) return fail(res,403,'forbidden','This page is for fitters, estimators and shop staff.'); return page(res,pub('appointments.html')); }
    if (p === '/api/appointments' && req.method === 'GET') return send(res,200,appointments.list(user));
    if (p === '/api/appointments/send' && req.method === 'POST') return send(res,200,await appointments.send(await readJson(req),user));
    if (p === '/api/appointments/signoff' && req.method === 'POST') return send(res,200,appointments.signoff(await readJson(req),user));
    if (p.startsWith('/api/appointments/work/') && req.method === 'POST') {
      const action=p.slice('/api/appointments/work/'.length);
      if(!['checklist','issue','approve','diary','schedule','notify','reschedule','reviewMove','calendar','visitCalendar','visitReschedule','visitReview','estimatorDetails','planCarpet'].includes(action))return fail(res,404,'not_found','Unknown fitting action.');
      return send(res,200,await appointments.work[action](await readJson(req),user));
    }
    if (p === '/api/appointments/test' && req.method === 'POST') return send(res,200,appointments.createTest(user,await readJson(req)));
    if(p.startsWith('/api/appointments/estimator/')&&req.method==='POST'){const action=p.split('/').pop();if(!['catalogue','selectProduct','attachment','drawing'].includes(action))return fail(res,404,'not_found','Unknown estimator action.');return send(res,200,await estimatorTools[action](await readJson(req),user));}
    if(p.startsWith('/api/appointments/drawing/')&&req.method==='GET'){
      const bits=p.slice('/api/appointments/drawing/'.length).split('/'),jobId=decodeURIComponent(bits[0]||''),roomKey=decodeURIComponent(bits[1]||''),j=st.getDoc('jobs/'+jobId).data;
      if(!j||!(appointments.allowed(j,user)||Object.keys(j.pre||{}).some(k=>{const v=appointments.visitJob(j,k);return v&&appointments.allowed(v,user);})))return fail(res,403,'forbidden','This is not your assigned job.');
      const r=j.rooms?.[roomKey];if(!r?.drawing)return fail(res,404,'not_found','Room drawing not found.');
      return send(res,200,require('./lib/room-drawing').svg(r.drawing,r.name),{'content-type':'image/svg+xml; charset=utf-8','cache-control':'private, no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"});
    }
    if(p.startsWith('/api/appointments/photo/')&&req.method==='GET'){
      const bits=p.slice('/api/appointments/photo/'.length).split('/'),jobId=decodeURIComponent(bits[0]||''),id=bits[1]||'';
      appointments.photo(jobId,id,user);const a=/^[0-9a-f]{32}$/.test(id)?q.asset.get(id):null;if(!a)return fail(res,404,'not_found','Photo not found.');
      return send(res,200,fs.readFileSync(path.join(dataDir,'assets',id)),{'content-type':a.type,'cache-control':'private, no-store'});
    }
    /* everything below is the shop's own screens. A fitter or estimator is refused here, whatever their page asks for. */
    if (!shopUser) return fail(res, 403, 'forbidden', 'This sign-in cannot use the shop’s screens.');
    if(p==='/api/fitter-access'&&req.method==='POST'){
      if(user.role!=='owner')return fail(res,403,'forbidden','Only the owner can manage fitter access.');
      const b=await readJson(req),name=String(b.name||'').trim(),mobile=sms.normaliseMobile(b.mobile);
      if(!name||name.length>60||!mobile)return fail(res,400,'invalid_argument','Enter the fitter name used in the diary and their mobile number.');
      const prior=q.userByMobile.get(mobile);
      if(prior&&prior.role!=='fitter')return fail(res,409,'forbidden','This number belongs to a different account role. No changes made.');
      if(q.users.all().some(x=>x.active&&x.role==='fitter'&&x.name===name&&x.id!==prior?.id))return fail(res,409,'duplicate','This fitter already has a sign-in. Use their existing number or ask the owner to review the account.');
      const id=ensureUser(name,mobile,'fitter');q.setUser.run(name,'fitter',1,id);q.dropSessionsOf.run(id);st.audit(user.id,'fitter access','Enabled fitter '+name+'; existing sessions revoked');
      return send(res,200,{ok:true,name});
    }
    if (p === '/api/users') return send(res, 200, {users:q.users.all().map(u => ({id:u.id, name:u.name, role:u.role, active:!!u.active}))});
    if (p.startsWith('/api/db/')) return dbRoute(req, res, url, user, p.slice(8));
    if (p === '/api/cmd' && req.method === 'POST'){ const body = await readJson(req); return send(res, 200, await cmds.run(String(body.cmd || ''), body, user)); }
    if (p === '/api/status') return send(res, 200, cmds.status());
    if (p === '/api/shopify' && req.method === 'POST') return shopifyRoute(req, res, user);
    if (p === '/api/shopify/status') return send(res, 200, {ready:shop.ready(), store:shop.store});
    if (p === '/api/geo' && req.method === 'GET') return geoRoute(res, url);
    if (p === '/api/assets' && req.method === 'POST') return assetUpload(req, res, user);
    if (p.startsWith('/api/assets/') && req.method === 'DELETE'){
      const id = p.slice(12); if (!/^[0-9a-f]{32}$/.test(id)) return fail(res, 400, 'invalid_request', 'Bad id.');
      const had = !!q.asset.get(id); q.dropAsset.run(id); try { fs.unlinkSync(path.join(dataDir, 'assets', id)); } catch (e) {}
      st.audit(user.id, 'picture removed', id); return send(res, 200, {deleted:had});
    }
    if (p.startsWith('/_blob/')){
      const id = p.slice(7), a = /^[0-9a-f]{32}$/.test(id) ? q.asset.get(id) : null; if (!a) return fail(res, 404, 'not_found', 'Not found.');
      return send(res, 200, fs.readFileSync(path.join(dataDir, 'assets', id)), {'content-type':a.type, 'cache-control':'private, max-age=86400'});
    }
    if (p === '/api/events'){
      res.writeHead(200, {'content-type':'text/event-stream', 'cache-control':'no-store', 'connection':'keep-alive', 'x-accel-buffering':'no'}); res.write(': connected\n\n');
      res.write('event: version\ndata: ' + JSON.stringify({v:VERSION}) + '\n\n');
      listeners.add(res); req.on('close', () => listeners.delete(res)); return;
    }
    fail(res, 404, 'not_found', 'Not found.');
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { if (res.headersSent) return res.end(); if (e && e.status) return send(res, e.status, {error:Object.assign({code:e.code, message:e.message}, e.more || {})}); log('ERROR ' + (e && e.stack || e)); fail(res, 500, 'server_error', 'Something went wrong on the server.'); });
  });
  const beat = setInterval(() => listeners.forEach(r => { try { r.write(': keep\n\n'); } catch (e) {} }), 25000); beat.unref();
  return { server, store:st, ensureUser, version:VERSION, rules:L, commands:cmds, dropLive(){ listeners.forEach(r => { try { r.end(); } catch (e) {} }); listeners.clear(); }, close(){ clearInterval(beat); cmds.stop(); listeners.forEach(r => { try { r.end(); } catch (e) {} }); server.closeAllConnections && server.closeAllConnections(); server.close(); st.close(); },
    /* for the owner's tools and the tests */
    disableUser(id){ const u = q.userById.get(id); if (u){ q.setUser.run(u.name, u.role, 0, id); q.dropSessionsOf.run(id); } } };
}

if (require.main === module){
  const app = create(), port = Number(process.env.PORT) || 3000;
  app.server.listen(port, () => console.log('IFD Shop Operations listening on ' + port));
}
module.exports = { create, ROLES, SHOP_ROLES };
