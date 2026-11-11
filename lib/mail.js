'use strict';
/* Customer emails go out through a mailbox the shop already has, or any mail service, over SMTP.
   Until its details are in the environment nothing is sent, and the system says so rather than pretending.
   A message only counts as sent once the mail server has accepted it and given a reference. */
const net = require('node:net'), tls = require('node:tls'), crypto = require('node:crypto'), os = require('node:os');

function addrOf(s){ const m = /<([^<>\s]+@[^<>\s]+)>/.exec(String(s || '')); return (m ? m[1] : String(s || '')).trim(); }
function nameOf(s){ const m = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(String(s || '')); return m ? m[1].trim() : ''; }
function validEmail(s){ s = String(s || ''); return s.length <= 254 && /^[^@\s<>"',;:\\]+@[^@\s<>"',;:\\]+\.[^@\s<>"',;:\\]{2,}$/.test(s); }
function encWord(s){ s = String(s || '').replace(/[\r\n]+/g, ' '); return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?='; }
const fail = (message, code) => Object.assign(new Error(message), {code:code || 'mail_failed'});

/* one reply from the mail server at a time, however the bytes arrive */
function talker(socket){
  let buf = '', lines = [], dead = null; const ready = [], waiting = [];
  const give = r => { const w = waiting.shift(); if (w) w.resolve(r); else ready.push(r); };
  const stop = e => { if (dead) return; dead = e || fail('The mail server closed the connection.'); waiting.splice(0).forEach(w => w.reject(dead)); };
  socket.on('data', chunk => {
    buf += chunk.toString('utf8');
    for (;;){
      const i = buf.indexOf('\n'); if (i === -1) break;
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); lines.push(line);
      if (/^\d{3}( |$)/.test(line)){ give({code:Number(line.slice(0, 3)), text:lines.join(' ')}); lines = []; }
    }
  });
  socket.on('error', e => stop(fail('The mail server could not be reached: ' + (e && e.message || e))));
  socket.on('timeout', () => { stop(fail('The mail server did not answer in time.')); socket.destroy(); });
  socket.on('close', () => stop());
  const read = () => ready.length ? Promise.resolve(ready.shift()) : dead ? Promise.reject(dead) : new Promise((resolve, reject) => waiting.push({resolve, reject}));
  return { read, cmd: line => { if (dead) return Promise.reject(dead); socket.write(line + '\r\n'); return read(); } };
}
function want(reply, codes, step){
  if ([].concat(codes).indexOf(reply.code) !== -1) return reply;
  const text = String(reply.text || '').replace(/^\d{3}[ -]?/, '').slice(0, 200);
  if (step === 'sign-in') throw fail('The mail server refused the sign-in. Check the mailbox name and password in the hosting settings. (' + reply.code + ' ' + text + ')', 'mail_auth');
  if (step === 'recipient') throw fail('The mail server would not take that address: ' + reply.code + ' ' + text, 'mail_recipient');
  throw fail('The mail server refused the message at ' + step + ': ' + reply.code + ' ' + text);
}

function make(env, log){
  const host = env.SMTP_HOST || '', port = Number(env.SMTP_PORT) || 465, user = env.SMTP_USER || '', pass = env.SMTP_PASS || '';
  const from = env.EMAIL_FROM || user, fromAddr = addrOf(from), fromName = nameOf(from) || env.EMAIL_NAME || '', replyTo = addrOf(env.EMAIL_REPLY_TO || '');
  const mode = env.SMTP_SECURE || (port === 587 ? 'starttls' : 'tls');            /* tls, starttls, or off (tests only) */
  const ready = !!(host && validEmail(fromAddr) && (mode === 'off' || (user && pass)));
  const helo = (env.SMTP_HELO || fromAddr.split('@')[1] || os.hostname() || 'localhost').replace(/[^A-Za-z0-9.-]/g, '');
  const open = () => new Promise((resolve, reject) => {
    const s = mode === 'tls' ? tls.connect({host, port, servername:host}) : net.connect({host, port});
    s.setTimeout(20000);
    s.once('error', e => reject(fail('The mail server could not be reached: ' + (e && e.message || e))));
    s.once(mode === 'tls' ? 'secureConnect' : 'connect', () => resolve(s));
  });
  function build(m, id){
    const head = ['From: ' + (fromName ? encWord(fromName) + ' ' : '') + '<' + fromAddr + '>', 'To: <' + m.to + '>', 'Subject: ' + encWord(m.subject || ''), 'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
      'Message-ID: <' + id + '>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'];
    if (validEmail(replyTo)) head.push('Reply-To: <' + replyTo + '>');
    const body = Buffer.from(String(m.text || '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    return head.join('\r\n') + '\r\n\r\n' + body;
  }
  /* resolves with the reference the mail server gave once it has taken the message; rejects with a plain reason otherwise */
  async function send(m){
    if (!ready) throw fail('Email sending has not been set up yet.', 'not_set_up');
    if (!validEmail(m.to)) throw fail('That is not an email address.', 'mail_recipient');
    const id = crypto.randomBytes(12).toString('hex') + '@' + (fromAddr.split('@')[1] || 'localhost');
    let sock = await open(), t = talker(sock);
    try {
      want(await t.read(), 220, 'hello');
      want(await t.cmd('EHLO ' + helo), 250, 'hello');
      if (mode === 'starttls'){
        want(await t.cmd('STARTTLS'), 220, 'securing the line');
        sock = await new Promise((resolve, reject) => { const s = tls.connect({socket:sock, servername:host}); s.once('error', e => reject(fail('The line to the mail server could not be secured: ' + (e && e.message || e)))); s.once('secureConnect', () => resolve(s)); });
        t = talker(sock); want(await t.cmd('EHLO ' + helo), 250, 'hello');
      }
      if (user){
        want(await t.cmd('AUTH LOGIN'), 334, 'sign-in');
        want(await t.cmd(Buffer.from(user, 'utf8').toString('base64')), 334, 'sign-in');
        want(await t.cmd(Buffer.from(pass, 'utf8').toString('base64')), 235, 'sign-in');
      }
      want(await t.cmd('MAIL FROM:<' + fromAddr + '>'), 250, 'the sender');
      want(await t.cmd('RCPT TO:<' + m.to + '>'), [250, 251], 'recipient');
      want(await t.cmd('DATA'), 354, 'the message');
      const done = want(await t.cmd(build(m, id) + '\r\n.'), 250, 'the message');
      t.cmd('QUIT').catch(() => {});
      return {ref:'<' + id + '>', server:String(done.text || '').slice(0, 160)};
    } finally { setTimeout(() => { try { sock.destroy(); } catch (e) {} }, 200); }
  }
  return { ready, from:fromAddr, send };
}
module.exports = { make, validEmail, addrOf };
