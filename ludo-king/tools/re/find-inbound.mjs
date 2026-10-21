// Locate the NetworkManager's inbound socket `.on(...)` registration block and
// dump each registered event + its handler span so we can see which payload
// fields the client reads on `throwDice` / `userAction`.
import fs from 'node:fs';
const s = fs.readFileSync('public/play/assets/main/index.606d4.js', 'utf8');
const re = /(\w[\w$]*)\['on'\]\((_0x4163a4\[[^\]]+\]|_0x4e877d\[[^\]]+\])/g;
let m, n = 0;
while ((m = re.exec(s)) && n < 60) {
  console.log('@', m.index, m[1], m[2], JSON.stringify(s.slice(m.index, m.index + 60)));
  n++;
}
console.log('total', n);
