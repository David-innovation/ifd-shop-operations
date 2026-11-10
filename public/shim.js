/* Gives the shop's screens the same building blocks they had inside Claude, but backed by this system's own server:
   records with live updates, the line to Shopify, who is signed in, file downloads and pictures. */
(function(){
  'use strict';
  async function call(method, url, body, raw){
    const headers = {'x-ifd':'1'}; let payload;
    if (raw){ headers['content-type'] = raw.type; payload = raw.blob; } else if (body !== undefined){ headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, {method:method, headers:headers, body:payload, credentials:'same-origin'}); }
    catch (e){ throw {code:'upstream_error', message:'No connection to the shop system. Check the internet and try again.'}; }
    if (res.status === 401){ location.href = '/login'; throw {code:'signed_out', message:'Signed out.'}; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign({code:'upstream_error', message:'Something went wrong.'}, data.error || {});
    return data;
  }
  /* ---- records: every screen that is open hears about a change and reads the fresh copy ---- */
  const subs = new Map(); let es = null, opened = false;
  function listen(){
    if (es) return;
    es = new EventSource('/api/events');
    es.addEventListener('change', e => { try { (subs.get(JSON.parse(e.data).coll) || []).forEach(fn => fn()); } catch (x) {} });
    es.addEventListener('open', () => { if (opened) subs.forEach(set => set.forEach(fn => fn())); opened = true; });   /* after a dropped connection, catch up on everything */
  }
  function watch(coll, read, next, err){
    listen(); let seq = 0, live = true;
    const run = () => { const n = ++seq; read().then(r => { if (live && n === seq) next(r); }, e => { if (live && n === seq && err) err(e); }); };
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
      let live = true;
      const run = () => mcp.callTool(server, tool, args).then(result => { if (live) handler({type:'data', result:result}); }, error => { if (live) handler({type:'error', error:error}); });
      run(); const t = setInterval(() => { if (!document.hidden) run(); }, (o && o.refetchInterval) || 120000);
      return () => { live = false; clearInterval(t); };
    },
    invalidate: async () => {}, listTools: async () => ({servers:[]})
  };
  /* ---- who is signed in ---- */
  let meP = null; const me = () => meP || (meP = call('GET', '/api/me'));
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
  const caps = {db:db, mcp:mcp, user:user, downloads:downloads, assets:assets};
  window.claude = {use: async name => caps[name] || null};
  /* a way out, since the shop's screen is shared */
  window.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.top-in'); if (!bar) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = 'Sign out';
    b.addEventListener('click', () => call('POST', '/api/logout', {}).then(() => { location.href = '/login'; }, () => { location.href = '/login'; }));
    bar.append(b);
  });
})();
