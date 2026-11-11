'use strict';
/* Texts go out through Twilio. Until its details are in the environment a sign-in code is written to the service log
   instead, which only the owner can read. Customer messages are never logged in place of sending: without Twilio the
   system says texting is not set up. A text counts as delivered only when Twilio reports the handset took it. */
function normaliseMobile(input){
  let s = String(input || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('07') && s.length === 11) s = '+44' + s.slice(1);
  if (s.startsWith('447') && s.length === 12) s = '+' + s;
  return /^\+\d{10,15}$/.test(s) ? s : '';
}
function make(env, fetchImpl, log){
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM, ready = !!(sid && token && from);
  const base = (env.TWILIO_BASE || 'https://api.twilio.com') + '/2010-04-01/Accounts/' + encodeURIComponent(sid || '') + '/Messages';
  const auth = {'authorization':'Basic ' + Buffer.from(sid + ':' + token).toString('base64')};
  /* resolves with Twilio's own reference once it has accepted the text; rejects with a plain reason otherwise */
  async function send(to, body){
    if (!ready) throw Object.assign(new Error('Texting has not been set up yet.'), {code:'not_set_up'});
    let res;
    try { res = await fetchImpl(base + '.json', {method:'POST', headers:Object.assign({'content-type':'application/x-www-form-urlencoded'}, auth), body:new URLSearchParams({To:to, From:from, Body:body}).toString(), signal:AbortSignal.timeout(20000)}); }
    catch (e){ throw new Error('The text service could not be reached.'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.sid) throw new Error('The text service refused it: ' + (j.message || res.status) + (j.code ? ' (code ' + j.code + ')' : ''));
    return {sent:true, ref:j.sid, status:j.status || 'queued'};
  }
  /* where a text has got to: queued, sent, delivered, undelivered or failed */
  async function status(ref){
    if (!ready || !/^[A-Za-z0-9]{10,64}$/.test(String(ref || ''))) return {status:''};
    try {
      const res = await fetchImpl(base + '/' + ref + '.json', {headers:auth, signal:AbortSignal.timeout(15000)}), j = await res.json().catch(() => ({}));
      return res.ok ? {status:String(j.status || ''), err:j.error_message || (j.error_code ? 'code ' + j.error_code : '')} : {status:''};
    } catch (e){ return {status:''}; }
  }
  return { ready, send, status };
}
/* the sign-in code path: never fails the sign-in page, and falls back to the log until Twilio is set up */
function sender(env, fetchImpl, log){
  const t = make(env, fetchImpl, log);
  if (!t.ready) return async (to, body) => { log('TEXT NOT SENT (Twilio not set up). To ' + to + ': ' + body); return {sent:false, logged:true}; };
  return (to, body) => t.send(to, body);
}
module.exports = { normaliseMobile, sender, make };
