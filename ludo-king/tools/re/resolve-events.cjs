// Resolve `_0x4163a4[<glyph>]` / `_0x4e877d[<glyph>]` style string tables inside the
// NetworkManager module into their concatenated plaintext, then evaluate the
// calls that actually name socket events so the wire protocol is readable.
// usage: node tools/re/resolve-events.cjs [moduleStart]
const fs = require('fs'), vm = require('vm');
const s = fs.readFileSync('public/play/assets/main/index.606d4.js', 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(s.slice(0, s.indexOf('var a0_0x3b4a27')), ctx, { timeout: 30000 });

// Wrapper decoders defined by the bundle: install every 4-arg alias we can find
// in the whole file so calls inside the module resolve.
const reFn = /function (_0x[0-9a-f]+)\((_0x[0-9a-f]+),(_0x[0-9a-f]+),(_0x[0-9a-f]+),(_0x[0-9a-f]+)\)\{return (_0x[0-9a-f]+)\(([^;]*)\);\}/g;
let m, n = 0;
const srcs = [];
while ((m = reFn.exec(s))) srcs.push(m[0]);
for (const src of srcs) { try { vm.runInContext(src, ctx); n++; } catch {} }
console.error('installed wrapper decoders: %d', n);

// Extract `<table>[<idx>]` string-table definitions of the form
//   var T={};T['k']='a',T['k2']='b';
// then print the ones whose evaluated value looks like a protocol token.
const wanted = process.argv[2];
const tokens = new Set();
const reStr = /(_0x[0-9a-f]+)\['(_0x[0-9a-f]+)'\]=/g;
const tableNames = new Set();
while ((m = reStr.exec(s))) tableNames.add(m[1]);

const reDecl = /var (_0x[0-9a-f]+)=\{\};((?:[^\n]{0,4000}?))\n/g;
function evalCall(name, args) {
  try { return ctx[name](...args); } catch { return null; }
}
const out = [];
const reCall = /([_a-zA-Z][_a-zA-Z0-9$]*)\(((?:0x[0-9a-fA-F]+)(?:\s*,\s*(?:0x[0-9a-fA-F]+)){3})\)/g;
while ((m = reCall.exec(s))) {
  const name = m[1];
  if (typeof ctx[name] !== 'function') continue;
  const args = m[2].split(',').map(x => Number(x.trim()));
  const v = evalCall(name, args);
  if (typeof v === 'string' && v.length > 1) out.push([m.index, m[0], v]);
}
const filtered = wanted ? out.filter(r => new RegExp(wanted).test(r[2])) : out;
for (const [off, call, v] of filtered) console.log(`${off}\t${call}\t${JSON.stringify(v)}`);
