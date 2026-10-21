import {chromium} from 'playwright-core';
import {encryptBlob, decryptBlob} from '../../tools/crypto-check.mjs';
const ORIGIN = process.env.LK_ORIGIN || 'http://127.0.0.1:8788/';
const b = await chromium.launch({headless: true});
const ctx = await b.newContext({viewport: {width: 900, height: 600}, bypassCSP: true});
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : String(e)));
await p.goto(ORIGIN, {waitUntil: 'domcontentloaded'});
await p.waitForTimeout(7000);
// join the lobby via the node event, then capture what the client does with a
// server `throwDice` broadcast (which is where the null reads happen).
await p.evaluate(() => {
  const c = cc.director.getScene().getChildByName('Canvas');
  const comps = [c].concat(c.children).flatMap(x => x._components || []);
  const nm = comps.find(x => typeof x.connectToServer === 'function');
  window.__nsp = () => { const m = window.io.managers; const k = Object.keys(m)[0]; return m[k].nsps['/']; };
  window.__nsp().emit('LUDO_public_room', {data: window.__enc({iMaxPlayer: 2, iLobbyId: 2})});
  window.__node = nm.node;
});
await p.waitForTimeout(2500);
// now send a throwDice broadcast directly from the page (simulating the server)
await p.evaluate(() => {
  const nsp = window.__nsp();
  // find the registered handler for throwDice and call it with a payload to see
  // which field is missing.
  const blob = window.__enc({_userId: window.__localGuestNum, _tableId: '1', iDice: 3, iTurnCounter: 1, aTokens: []});
  const cb = nsp._callbacks && nsp._callbacks['$throwDice'];
  console.log('throwDice handlers:', cb ? cb.length : 0);
  try { if (cb) for (const f of cb) f(blob); } catch (e) { console.log('HANDLER THREW:', e && e.stack ? e.stack.split('\n').slice(0, 8).join(' | ') : e); }
});
await p.waitForTimeout(1500);
await b.close();
