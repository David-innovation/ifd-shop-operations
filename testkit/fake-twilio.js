'use strict';
/* A stand-in for the text service for the tests: takes a text, gives it a reference, and says where it has got to when
   asked. It can be told to refuse a number, or to report a text as never reaching the handset. No text is ever sent. */
const resp = (status, obj) => ({ok:status >= 200 && status < 300, status:status, json:async () => obj, text:async () => JSON.stringify(obj)});
function make(o){
  const sid = (o && o.sid) || 'ACtest', token = (o && o.token) || 'tw-test-token';
  const state = {sent:[], refuse:{}, undeliverable:{}, down:false, n:0};
  const handles = url => String(url).indexOf('/2010-04-01/Accounts/') !== -1;
  async function fetchImpl(url, init){
    if (state.down) throw new Error('network down');
    if ((init.headers || {}).authorization !== 'Basic ' + Buffer.from(sid + ':' + token).toString('base64')) return resp(401, {code:20003, message:'Authenticate'});
    const u = String(url), one = /\/Messages\/(SM[0-9a-f]+)\.json$/.exec(u);
    if (one){
      const t = state.sent.find(x => x.sid === one[1]); if (!t) return resp(404, {code:20404, message:'Not found'});
      t.asked++; t.status = t.final;
      return resp(200, {sid:t.sid, status:t.status, error_code:t.status === 'undelivered' ? 30003 : null, error_message:t.status === 'undelivered' ? 'Unreachable destination handset' : null});
    }
    if (/\/Messages\.json$/.test(u) && init.method === 'POST'){
      const b = new URLSearchParams(init.body), to = b.get('To');
      if (state.refuse[to] > 0){ state.refuse[to]--; return resp(400, {code:21211, message:'The To number is not a valid phone number', status:400}); }
      const t = {sid:'SM' + (++state.n).toString(16).padStart(32, '0'), to:to, from:b.get('From'), body:b.get('Body'), status:'queued', final:state.undeliverable[to] ? 'undelivered' : 'delivered', asked:0};
      state.sent.push(t); return resp(201, {sid:t.sid, status:'queued'});
    }
    return resp(404, {message:'Not found'});
  }
  return {handles, fetchImpl, state, env:{TWILIO_ACCOUNT_SID:sid, TWILIO_AUTH_TOKEN:token, TWILIO_FROM:'+447700900900'}};
}
module.exports = { make };
