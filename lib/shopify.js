'use strict';
/* The system's own line to Shopify. The key never leaves the server: screens send a named question or change,
   and only the ones on this list are passed on. */
const API_VERSION = '2026-10';
const READS = ['OpsShop', 'OpsInbox', 'OpsSearch', 'OpsVariants', 'OpsProduct', 'OpsCustomers', 'OpsDraft', 'OpsOrder', 'OpsDraftByTag', 'OpsStocked', 'OpsCatalogue', 'OpsCatalogueVariants'];
const WRITES = ['OpsDraftCreate', 'OpsDraftDelete', 'OpsAdjust', 'OpsSet'];
function operationOf(query){ const m = /^\s*(query|mutation)\s+([A-Za-z0-9_]+)/.exec(String(query || '')); return m ? {kind:m[1], name:m[2]} : null; }
function allowed(query, kind){
  const op = operationOf(query);
  if (!op || op.kind !== kind) return null;
  if (/\b(mutation|subscription)\b/.test(String(query).replace(/^\s*(query|mutation)\s+/, '')) ) return null;   /* one operation per request */
  return (kind === 'query' ? READS : WRITES).indexOf(op.name) !== -1 ? op : null;
}
function client(env, fetchImpl){
  const store = String(env.SHOPIFY_STORE || '').replace(/\.myshopify\.com$/, ''), id = env.SHOPIFY_CLIENT_ID, secret = env.SHOPIFY_CLIENT_SECRET;
  const base = env.SHOPIFY_BASE || 'https://' + store + '.myshopify.com';
  let token = '', until = 0, pending = null;
  const ready = () => !!(store && id && secret);
  async function fresh(){
    const res = await fetchImpl(base + '/admin/oauth/access_token', {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'client_credentials', client_id:id, client_secret:secret}).toString()});
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw {code:'needs_reauth', message:'Shopify would not give this system a key (' + res.status + (body.error ? ', ' + body.error : '') + ').'};
    token = body.access_token; until = Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 300) * 1000;
  }
  async function getToken(force){
    if (!force && token && Date.now() < until) return token;
    if (!pending) pending = fresh().finally(() => { pending = null; });
    await pending; return token;
  }
  async function graphql(query, variables){
    if (!ready()) throw {code:'server_not_connected', message:'Shopify has not been connected to this system yet.'};
    for (let attempt = 0; attempt < 2; attempt++){
      const t = await getToken(attempt === 1);
      let res;
      try { res = await fetchImpl(base + '/admin/api/' + API_VERSION + '/graphql.json', {method:'POST', headers:{'content-type':'application/json', 'x-shopify-access-token':t}, body:JSON.stringify({query, variables:variables || {}})}); }
      catch (e){ throw {code:'upstream_error', message:'Shopify did not answer.'}; }
      if (res.status === 401 && attempt === 0) continue;                       /* the key ran out early: fetch a new one, once */
      if (res.status === 429) throw {code:'rate_limited', message:'Shopify is busy. Try again in a moment.', retryable:true, retryAfterMs:2000};
      if (res.status >= 500) throw {code:'upstream_error', message:'Shopify did not answer (' + res.status + ').'};
      const body = await res.json().catch(() => null);
      if (!body) throw {code:'unreadable', message:'Shopify answered in a form this system could not read.'};
      return body;                                                             /* {data, errors}: user errors stay inside data for the screen to show */
    }
    throw {code:'needs_reauth', message:'Shopify refused this system’s key.'};
  }
  return { ready, graphql, store };
}
module.exports = { client, allowed, operationOf, API_VERSION, READS, WRITES };
