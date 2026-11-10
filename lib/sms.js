'use strict';
/* Texts go out through Twilio. Until its details are in the environment the text is written to the service log instead,
   which only the owner can read, so the system can be proved before any paid text is sent. */
function normaliseMobile(input){
  let s = String(input || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('07') && s.length === 11) s = '+44' + s.slice(1);
  if (s.startsWith('447') && s.length === 12) s = '+' + s;
  return /^\+\d{10,15}$/.test(s) ? s : '';
}
function sender(env, fetchImpl, log){
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM;
  if (!sid || !token || !from) return async (to, body) => { log('TEXT NOT SENT (Twilio not set up). To ' + to + ': ' + body); return {sent:false, logged:true}; };
  return async (to, body) => {
    const res = await fetchImpl('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json', {
      method:'POST', headers:{'authorization':'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({To:to, From:from, Body:body}).toString() });
    if (!res.ok){ const t = await res.text().catch(() => ''); throw new Error('Twilio refused the text: ' + res.status + ' ' + t.slice(0, 200)); }
    return {sent:true};
  };
}
module.exports = { normaliseMobile, sender };
