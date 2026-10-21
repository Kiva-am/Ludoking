// Extract a named string-table object (e.g. _0x4163a4) from the bundle and
// evaluate every entry into plaintext, so obfuscated socket event names are
// readable. The table is defined as `var T={'a':X,'b':Y,...};`.
// usage: node tools/re/dump-table.cjs _0x4163a4 [tableOffset]
const fs = require('fs'), vm = require('vm');
const s = fs.readFileSync('public/play/assets/main/index.606d4.js', 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(s.slice(0, s.indexOf('var a0_0x3b4a27')), ctx, { timeout: 30000 });

const table = process.argv[2];
const from = process.argv[3] ? Number(process.argv[3]) : 0;
// The NetworkManager module redefines the decoder wrappers in its own scope; the
// alias names repeat across modules with different offsets. Bind them explicitly.
const MODULE_WRAPPERS = [
  'function _0x179627(_0x5bccfa,_0x21400b,_0x44538a,_0x59a269){return a0_0x293ccb(_0x5bccfa-0x14c,_0x21400b-0xcc,_0x44538a,_0x59a269-0x162);}',
  'function _0x18603a(_0x23489e,_0x4443b7,_0x9e0ccf,_0x714731){return a0_0x293ccb(_0x23489e-0x176,_0x23489e- -0x6,_0x714731,_0x714731-0x166);}',
];
for (const src of MODULE_WRAPPERS) { try { vm.runInContext(src, ctx); } catch (e) { console.error(e.message); } }
let start = s.indexOf(`var ${table}=`, from);
if (start < 0) start = s.indexOf(`${table}=`, from);
if (start < 0) throw new Error('table not found: ' + table);
// Table body ends at the matching `};`
let i = s.indexOf('{', start), depth = 0, end = -1;
for (let p = i; p < s.length; p++) {
  if (s[p] === '{') depth++;
  else if (s[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
}
const body = s.slice(i + 1, end);
// Install every decoder wrapper defined anywhere in the module that contains the
// table (they delegate to a root decoder installed above), so entries resolve.
const moduleStart = Math.max(0, s.lastIndexOf("'NetworkManager':[function", start));
const scope = s.slice(moduleStart, start);
const reFn = /function (_0x[0-9a-f]+)\(([^)]*)\)\{return ([^;]+);\}/g;
let m;
while ((m = reFn.exec(scope))) { try { vm.runInContext(m[0], ctx); } catch {} }

// Split entries on top-level commas.
const parts = []; let d = 0, last = 0;
for (let p = 0; p < body.length; p++) {
  const c = body[p];
  if ('{[('.includes(c)) d++;
  else if ('}])'.includes(c)) d--;
  else if (c === ',' && d === 0) { parts.push(body.slice(last, p)); last = p + 1; }
}
parts.push(body.slice(last));
for (const part of parts) {
  const mm = /^\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z0-9_$]+))\s*:\s*([\s\S]*)$/.exec(part);
  if (!mm) continue;
  const key = mm[1] ?? mm[2] ?? mm[3];
  let val;
  try { val = vm.runInContext('(' + mm[4] + ')', ctx); } catch { val = '<unresolved>'; }
  console.log(`${key}\t${typeof val === 'string' ? JSON.stringify(val) : val}`);
}
