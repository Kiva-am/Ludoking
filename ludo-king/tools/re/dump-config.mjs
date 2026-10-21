import {chromium} from 'playwright-core';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US'});
await context.addInitScript(()=>{
  window.__cap={utf8:[],cbc:[]};
  const hook=()=>{
    const a=window.aesjs;if(!a||!a.utils||a.utils.__hooked)return !!a;
    const U=a.utils;
    if(U.utf8){const o=U.utf8.toBytes;U.utf8.toBytes=function(s){window.__cap.utf8.push(String(s));return o.call(this,s);};}
    const M=a.ModeOfOperation;if(M){const OC=M.cbc;M.cbc=function(k,iv){window.__cap.cbc.push({k:Array.from(k||[]),iv:Array.from(iv||[])});return new OC(k,iv);};}
    U.__hooked=true;return true;};
  let n=0;const t=setInterval(()=>{if(hook()||++n>3000)clearInterval(t);},1);
});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8788/',{waitUntil:'domcontentloaded'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'domcontentloaded'});
await page.locator('#loginCloseBtn').waitFor({state:'visible',timeout:60000});
await page.locator('#loginCloseBtn').click();
await page.waitForTimeout(3000);
const out=await page.evaluate(()=>window.__cap);
console.log('=== KEY ==');
for(const c of out.cbc)console.log('  ',Buffer.from(c.k).toString('latin1'),'| iv bytes:',Array.from(c.iv).map(x=>x.toString(16)).join(' '));
console.log('=== DECRYPTED CONFIG ===');
for(const s of out.utf8){if(s.startsWith('{'))console.log(s);}
console.log('=== OTHER utf8 strings ===',JSON.stringify(out.utf8.filter(s=>!s.startsWith('{'))));
console.log('ERRORS',JSON.stringify(errors));
await browser.close();
