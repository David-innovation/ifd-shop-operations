'use strict';
/* A stand-in mail server for the tests. It speaks enough of the mail protocol to take a message, keeps exactly what it
   was given, and can be told to refuse an address or the sign-in. Nothing here ever leaves the machine. */
const net = require('node:net');
function make(){
  const state = {got:[], refuse:{}, down:false, badAuth:false, signIns:0};
  const server = net.createServer(sock => {
    if (state.down){ sock.destroy(); return; }
    let buf = '', mode = 'cmd', auth = 0, cur = {from:'', to:[]};
    const say = l => { try { sock.write(l + '\r\n'); } catch (e) {} };
    say('220 fake.mail ready');
    sock.on('error', () => {});
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      for (;;){
        if (mode === 'data'){
          const end = buf.indexOf('\r\n.\r\n'); if (end === -1) return;
          const raw = buf.slice(0, end); buf = buf.slice(end + 5); mode = 'cmd';
          const cutAt = raw.indexOf('\r\n\r\n'), head = raw.slice(0, cutAt), body = raw.slice(cutAt + 4);
          const h = name => (new RegExp('^' + name + ': (.*)$', 'mi').exec(head) || [])[1] || '';
          const plain = s => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (m, b) => Buffer.from(b, 'base64').toString('utf8'));
          state.got.push({from:cur.from, to:cur.to.slice(), subject:plain(h('Subject')), fromHeader:plain(h('From')), replyTo:h('Reply-To'), id:h('Message-ID'),
            text:Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n'), head:head});
          say('250 2.0.0 OK queued as FAKE' + state.got.length); cur = {from:'', to:[]}; continue;
        }
        const i = buf.indexOf('\r\n'); if (i === -1) return;
        const line = buf.slice(0, i), up = line.toUpperCase(); buf = buf.slice(i + 2);
        if (auth === 1){ auth = 2; say('334 UGFzc3dvcmQ6'); continue; }
        if (auth === 2){ auth = 0; state.signIns++; say(state.badAuth ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted'); continue; }
        if (up.startsWith('EHLO')) sock.write('250-fake.mail\r\n250 AUTH LOGIN\r\n');
        else if (up === 'AUTH LOGIN'){ auth = 1; say('334 VXNlcm5hbWU6'); }
        else if (up.startsWith('MAIL FROM:')){ cur.from = (/<([^>]*)>/.exec(line) || [])[1] || ''; say('250 OK'); }
        else if (up.startsWith('RCPT TO:')){
          const to = (/<([^>]*)>/.exec(line) || [])[1] || '';
          if (state.refuse[to] > 0){ state.refuse[to]--; say('550 5.1.1 No such mailbox here'); } else { cur.to.push(to); say('250 OK'); }
        }
        else if (up === 'DATA'){ mode = 'data'; say('354 Go ahead'); }
        else if (up === 'QUIT'){ say('221 Bye'); sock.end(); return; }
        else say('500 Not understood');
      }
    });
  });
  return {state, listen:() => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))), close:() => new Promise(r => server.close(() => r()))};
}
module.exports = { make };
