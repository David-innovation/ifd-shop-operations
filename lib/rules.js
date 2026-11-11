'use strict';
/* The shop's rules and sums live in one place: the first script of the screens. The server loads that same code,
   so a rule cannot be one thing on the screen and another on the server. It has no screen code in it. */
const vm = require('node:vm');
function load(appHtml){
  const m = /<script>([\s\S]*?)<\/script>/.exec(String(appHtml || ''));
  if (!m || m[1].indexOf('window.IFDLogic') === -1) throw new Error('The rules could not be found in the screens.');
  const box = {window:{}};
  vm.runInNewContext(m[1], box, {timeout:5000, filename:'ifd-rules.js'});
  if (!box.window.IFDLogic) throw new Error('The rules did not load.');
  return box.window.IFDLogic;
}
module.exports = { load };
