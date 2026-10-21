import {chromium} from 'playwright-core';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const OUT=p=>resolve(ROOT,'test-results',p);
await mkdir(resolve(ROOT,'test-results'),{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US'});
await context.addInitScript(()=>{
  window.__cap={utf8:[],hex:[],b64:[],cbc:[]};
  const hook=()=>{
    const a=window.aesjs;if(!a||!a.utils||a.utils.__hooked)return !!a;
    const U=a.utils;
    if(U.utf8){const o=U.utf8.toBytes;U.utf8.toBytes=function(s){window.__cap.utf8.push(String(s));return o.call(this,s);};}
    if(U.hex){const o=U.hex.toBytes;U.hex.toBytes=function(s){window.__cap.hex.push(String(s));return o.call(this,s);};}
    if(U.utf8&&U.utf8.fromBytes){const o=U.utf8.fromBytes;U.utf8.fromBytes=function(b){const r=o.call(this,b);window.__cap.utf8.push('FROM>'+r);return r;};}
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
await writeFile(OUT('aes-utils.json'),JSON.stringify({out,errors},null,2)+'\n');
console.log('utf8 calls:',out.utf8.length, JSON.stringify([...new Set(out.utf8)]).slice(0,800));
console.log('hex calls:',out.hex.length, JSON.stringify([...new Set(out.hex)]).slice(0,800));
console.log('cbc calls:',out.cbc.length);
for(const c of out.cbc){console.log('  key:',Buffer.from(c.k).toString('latin1'),'| iv:',Buffer.from(c.iv).toString('latin1'));}
console.log('ERRORS',JSON.stringify(errors));
await browser.close();
