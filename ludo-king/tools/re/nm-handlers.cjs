// Dump the NetworkManager socket registration lines: for each `node.on(...)` inside
// the NetworkManager module, print the offset plus the resolved event name.
// usage: node tools/re/nm-handlers.cjs
const fs = require('fs'), vm = require('vm');
const s = fs.readFileSync('public/play/assets/main/index.606d4.js', 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(s.slice(0, s.indexOf('var a0_0x3b4a27')), ctx, { timeout: 30000 });
for (const src of [
  'function _0x179627(_0x5bccfa,_0x21400b,_0x44538a,_0x59a269){return a0_0x293ccb(_0x5bccfa-0x14c,_0x21400b-0xcc,_0x44538a,_0x59a269-0x162);}',
  'function _0x18603a(_0x23489e,_0x4443b7,_0x9e0ccf,_0x714731){return a0_0x293ccb(_0x23489e-0x176,_0x23489e- -0x6,_0x714731,_0x714731-0x166);}',
]) vm.runInContext(src, ctx);

const from = s.indexOf("'NetworkManager':[function");
const to = s.indexOf("'NetworkEventHandler'", from);
const scope = s.slice(from, to < 0 ? from + 300000 : to);
// `node.<...>on<...>](<GLYPH-EXPR>,function`
const re = /\]\[(?:\x27|\x22)on(?:\x27|\x22)\]\(([^,]{1,80}),function/g;
let m;
while ((m = re.exec(scope))) {
  const expr = m[1];
  let name;
  try { name = vm.runInContext('(' + expr + ')', ctx); } catch { name = '<' + expr + '>'; }
  console.log(`${from + m.index}\t${name}`);
}
