/* Gives the shop's screens the same building blocks they had inside Claude, but backed by this system's own server:
   records with live updates, the line to Shopify, who is signed in, file downloads and pictures. */
(function(){
  'use strict';
  async function call(method, url, body, raw){
    const headers = {'x-ifd':'1'}; let payload;
    if (raw){ headers['content-type'] = raw.type; payload = raw.blob; } else if (body !== undefined){ headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, {method:method, headers:headers, body:payload, credentials:'same-origin'}); }
    catch (e){ throw {code:'upstream_error', lost:true, message:'No connection to the shop system. Check the internet and try again.'}; }   /* lost: no answer came back, so what happened is not known */
    if (res.status === 401){ location.href = '/login'; throw {code:'signed_out', message:'Signed out.'}; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign({code:'upstream_error', message:'Something went wrong.'}, data.error || {});
    return data;
  }
  /* ---- records: every screen that is open hears about a change and reads the fresh copy ---- */
  const subs = new Map(); let es = null, opened = false, retry = null;
  function listen(){
    if (es) return;
    es = new EventSource('/api/events');
    es.addEventListener('change', e => { try { (subs.get(JSON.parse(e.data).coll) || []).forEach(fn => fn()); } catch (x) {} });
    es.addEventListener('version', e => { try { const v = JSON.parse(e.data).v, mine = (document.querySelector('meta[name="ifd-version"]') || {}).content; if (v && mine && v !== mine) outOfDate(); } catch (x) {} });
    es.addEventListener('open', () => { if (opened) subs.forEach(set => set.forEach(fn => fn())); opened = true; });   /* after a dropped connection, catch up on everything */
    /* the browser gives up for good if the server refuses once, which happens for a minute during an update: keep trying */
    es.addEventListener('error', () => { if (es && es.readyState === 2){ es = null; clearTimeout(retry); retry = setTimeout(listen, 3000); } });
  }
  /* ---- a newer build of the screens is running: bring this screen up to date without losing anything half typed ---- */
  let stale = false, reloading = false;
  /* Only refresh once the new build is the one answering, and has answered twice running a few seconds apart. During an
     update the old server and the new one overlap for a minute or two, and a refresh in that gap lands on an error page. */
  let tries = 0;
  function safeReload(){
    if (reloading) return; reloading = true;
    const mine = (document.querySelector('meta[name="ifd-version"]') || {}).content || '';
    const again = () => { reloading = false; setTimeout(safeReload, 3000); };
    const look = () => fetch('/', {cache:'no-store', credentials:'same-origin'}).then(r => r.ok ? r.text() : Promise.reject(new Error('not ready'))).then(t => {
      const m = /<meta name="ifd-version" content="([^"]*)"/.exec(t);
      if (!m) return 'signed-out';                                  /* the sign-in page: nothing to wait for */
      if (m[1] === mine && tries < 40) throw new Error('old build'); /* still the old server: wait for the new one */
      return m[1];
    });
    /* the records have to be answering too, not only the page */
    const api = () => fetch('/api/me', {headers:{'x-ifd':'1'}, cache:'no-store', credentials:'same-origin'}).then(r => { if (!r.ok && r.status !== 401) throw new Error('not ready'); });
    tries++;
    look().then(v => v === 'signed-out' ? location.reload() : new Promise(res => setTimeout(res, 4000)).then(look).then(v2 => { if (v2 !== v) throw new Error('changed'); return api(); }).then(() => location.reload(), again), again);
  }
  function outOfDate(){
    if (stale) return; stale = true;
    const idle = () => {
      const m = document.getElementById('modal'), sh = document.getElementById('sheet'), a = document.activeElement;
      const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button';
      return (!m || m.hidden) && (!sh || sh.hidden) && !typing;
    };
    if (idle()){ safeReload(); return; }
    const bar = document.createElement('div'), b = document.createElement('button');
    bar.id = 'staleBar'; bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#1b5683;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;font:600 15px system-ui,sans-serif';
    b.type = 'button'; b.textContent = 'Refresh now'; b.style.cssText = 'font:inherit;border:0;border-radius:8px;padding:8px 14px;background:#fff;color:#14181a;cursor:pointer';
    b.addEventListener('click', safeReload);
    bar.append('This screen has been updated. It refreshes by itself when you close what you are working on.', b);
    document.body.appendChild(bar);
    setInterval(() => { if (idle()) safeReload(); }, 2000);
  }
  function watch(coll, read, next, err){
    listen(); let seq = 0, live = true;
    /* a read that fails is tried again every few seconds: after an update the first read can land while the server is still starting */
    const run = () => { const n = ++seq; read().then(r => { if (live && n === seq) next(r); }, e => { if (!live || n !== seq) return; if (err) err(e); if (e && e.code === 'signed_out') return; setTimeout(() => { if (live && n === seq) run(); }, 3000); }); };
    if (!subs.has(coll)) subs.set(coll, new Set());
    subs.get(coll).add(run); run();
    return () => { live = false; subs.get(coll).delete(run); };
  }
  const meta = {fromCache:false, hasPendingWrites:false};
  const docSnap = (id, r) => ({id:id, exists:!!r.exists, data:() => (r.exists ? r.data : undefined), metadata:meta});
  function docRef(path){
    const parts = path.split('/'), id = parts[parts.length - 1], coll = parts.slice(0, -1).join('/'), url = '/api/db/doc?path=' + encodeURIComponent(path);
    return { id:id, path:path,
      get: async () => docSnap(id, await call('GET', url)),
      set: data => call('POST', '/api/db/set', {path:path, data:data}),
      update: data => call('POST', '/api/db/update', {path:path, data:data}),
      delete: () => call('POST', '/api/db/delete', {path:path}),
      onSnapshot: (next, err) => watch(coll, () => call('GET', url), r => next(docSnap(id, r)), err) };
  }
  function colRef(coll, order, dir, lim){
    const url = () => '/api/db/list?coll=' + encodeURIComponent(coll) + (order ? '&order=' + encodeURIComponent(order) + '&dir=' + (dir || 'asc') : '') + (lim ? '&limit=' + lim : '');
    const snap = r => { const docs = r.docs.map(d => ({id:d.id, exists:true, data:() => d.data, metadata:meta})); return {docs:docs, size:docs.length, empty:!docs.length, metadata:meta, docChanges:() => []}; };
    return { path:coll, doc: id => docRef(coll + '/' + id),
      add: async data => docRef(coll + '/' + (await call('POST', '/api/db/add', {coll:coll, data:data})).id),
      orderBy: (f, d) => colRef(coll, f, d || 'asc', lim), limit: n => colRef(coll, order, dir, n), where: () => colRef(coll, order, dir, lim),
      get: async () => snap(await call('GET', url())),
      onSnapshot: (next, err) => watch(coll, () => call('GET', url()), r => next(snap(r)), err) };
  }
  const db = {doc:docRef, collection:p => colRef(p)};
  /* ---- Shopify: the screen names the question or change, the server holds the key ---- */
  const mcp = {
    callTool: async (server, tool, args) => ({payload:(await call('POST', '/api/shopify', {kind:tool === 'graphql_mutation' ? 'mutation' : 'query', query:args.query, variables:args.variables})).body}),
    watchTool: (server, tool, args, handler, o) => {
      let live = true, quick = 0;
      /* a question that fails is asked again a few seconds later, three times, before waiting for the next round */
      const run = () => mcp.callTool(server, tool, args).then(result => { quick = 0; if (live) handler({type:'data', result:result}); },
        error => { if (!live) return; handler({type:'error', error:error}); if (quick++ < 3) setTimeout(() => { if (live) run(); }, 5000); });
      run(); const t = setInterval(() => { if (!document.hidden) run(); }, (o && o.refetchInterval) || 120000);
      return () => { live = false; clearInterval(t); };
    },
    invalidate: async () => {}, listTools: async () => ({servers:[]})
  };
  /* ---- who is signed in ---- */
  let meP = null; const me = () => meP || (meP = call('GET', '/api/me').catch(e => { meP = null; throw e; }));   /* a failed answer is not kept */
  const user = {
    me: async () => { const m = await me(); return {id:m.id, name:m.name, isOwner:m.role === 'owner', canEdit:true, role:m.role}; },
    id: async () => (await me()).id,
    profiles: async ids => { const r = await call('GET', '/api/users'), o = {}; [].concat(ids).forEach(i => { const u = r.users.find(x => x.id === i); o[i] = {id:i, name:u ? u.name : ''}; }); return o; }
  };
  const downloads = { save: async f => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.data], {type:'application/octet-stream'})); a.download = f.filename || 'download';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return {status:'saved'}; } };
  const assets = {
    upload: (blob, o) => call('POST', '/api/assets', undefined, {type:(o && o.type) || blob.type, blob:blob}),
    delete: ref => call('DELETE', '/api/assets/' + String(ref).replace(/^.*\//, '')),
    list: async () => ({assets:[], usage:{files:0, bytes:0, maxFiles:0, maxBytes:0}})
  };
  /* changes the server checks against the shop's rules before it makes them: cutting, money, messages */
  const cmd = { run: (name, body) => call('POST', '/api/cmd', Object.assign({cmd:name}, body || {})), status: () => call('GET', '/api/status') };
  const geo = { lookup: codes => call('GET', '/api/geo?codes=' + encodeURIComponent((codes || []).join(','))).then(r => r.codes || {}) };
  const caps = {db:db, mcp:mcp, user:user, downloads:downloads, assets:assets, geo:geo, cmd:cmd};
  window.claude = {use: async name => caps[name] || null};
  /* a way out, since the shop's screen is shared. This file can arrive late, after the page is already drawn */
  const wayOut = () => {
    const bar = document.querySelector('.top-in'); if (!bar || bar.querySelector('#signOut')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.id = 'signOut'; b.textContent = 'Sign out';
    b.addEventListener('click', () => call('POST', '/api/logout', {}).then(() => { location.href = '/login'; }, () => { location.href = '/login'; }));
    bar.append(b);
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', wayOut); else wayOut();
})();
