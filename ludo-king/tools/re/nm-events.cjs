// Resolve the local decoder wrappers used by a specific module and dump the
// string-table entries that name socket events / protocol tokens.
// The NetworkManager module (offset ~881700) uses wrappers _0x179627 and
// _0x18603a, both of which delegate to the root decoder a0_0x293ccb.
// usage: node tools/re/nm-events.cjs
const fs = require('fs'), vm = require('vm');
const s = fs.readFileSync('public/play/assets/main/index.606d4.js', 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(s.slice(0, s.indexOf('var a0_0x3b4a27')), ctx, { timeout: 30000 });

function install(name) {
  const re = new RegExp(`function ${name}\\(([^)]*)\\)\\{return ([^{}]*?)\\}`);
  const m = re.exec(s);
  if (!m) throw new Error('missing ' + name);
  vm.runInContext(m[0], ctx);
  return m[0];
}
const wrappers = process.argv.slice(2);
if (!wrappers.length) wrappers.push('_0x179627', '_0x18603a');
for (const w of wrappers) console.error('installed:', install(w));

// Walk a table definition `T['key']=EXPR, ...` and print every resolved key
// followed by the concatenated plaintext of its value expression.
const table = process.argv[2] && /^_0x/.test(process.argv[2]) ? null : null;
const reEntry = /(_0x[0-9a-f]+)\[(['"])([_a-zA-Z0-9$]+)\2\]=([\s\S]*?),(?=_0x[0-9a-f]+\[['"])/g;
let m;
while ((m = reEntry.exec(s))) {
  const [, tbl, , key, expr] = m;
  if (!wrappers.length) continue;
  // Evaluate the expression: it is either a literal, a decoder call, or a
  // concatenation of both.
  let value;
  try { value = vm.runInContext('(' + expr + ')', ctx); } catch { continue; }
  if (typeof value !== 'string' || !value) continue;
  if (!/^[A-Za-z_]/.test(value)) continue;
  console.log(`${key}\t${JSON.stringify(value)}`);
}
