import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Scripts live in tools/; test-results/ is at the project root.
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const OUT=p=>resolve(ROOT,'test-results',p);

await mkdir(resolve(ROOT,'test-results'),{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const report={localErrors:[],localExternalRequests:[],screens:[]};
try{
  for(const [name,url] of [['reference','https://ludoking.com/play/'],['local','http://127.0.0.1:8788/']]){
    const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',reducedMotion:'reduce'});
    const page=await context.newPage();
    const reference=name==='reference';
    await page.route('**/*',route=>{
      const host=new URL(route.request().url()).hostname;
      if(reference ? ['ludoking.com','json.ludokingapi.com'].includes(host) : host==='127.0.0.1') return route.continue();
      if(!reference)report.localExternalRequests.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    if(!reference){
      page.on('pageerror',error=>report.localErrors.push(error.message));
      page.on('response',response=>{if(response.status()>=400)report.localErrors.push(`${response.status()} ${response.url()}`)});
    }
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginCloseBtn').waitFor({state:'visible',timeout:60000});
    await page.locator('#loginCloseBtn').click();
    await page.waitForTimeout(1000);
    const canvas=page.locator('#GameCanvas');
    report.screens.push({name,canvas:await canvas.boundingBox()});
    await canvas.screenshot({path:OUT(`${name}-menu-canvas.png`)});
    await page.mouse.click(720,735);await page.waitForTimeout(500);
    await canvas.screenshot({path:OUT(`${name}-players-canvas.png`)});
    await page.mouse.click(720,645);await page.waitForTimeout(500);
    await canvas.screenshot({path:OUT(`${name}-colors-canvas.png`)});
    await page.mouse.click(720,645);await page.waitForTimeout(1500);
    await canvas.screenshot({path:OUT(`${name}-board-canvas.png`)});
    if(!reference){
      assert.ok(page.url().startsWith('http://127.0.0.1:8788/'),'Local client navigated away.');
      for(let i=0;i<8;i++){
        await page.mouse.click(590,750);await page.waitForTimeout(650);
        // Select the first blue yard token if the roll makes it available.
        await page.mouse.click(535,550);await page.waitForTimeout(650);
      }
      await canvas.screenshot({path:OUT('local-after-turns-canvas.png')});
      report.scene=await page.evaluate(()=>cc.director.getScene().name);
      report.localEvents=await page.evaluate(()=>window.__localEvents);
    }
    await context.close();
  }
  const {readFile}=await import('node:fs/promises');
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8788/');
  report.comparison=[];
  for(const screen of ['menu','players','colors','board']){
    const images=await Promise.all(['reference','local'].map(async name=>(await readFile(OUT(`${name}-${screen}-canvas.png`))).toString('base64')));
    const difference=await page.evaluate(async images=>{
      const decoded=await Promise.all(images.map(raw=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.src='data:image/png;base64,'+raw;})));
      const canvas=document.createElement('canvas');canvas.width=decoded[0].width;canvas.height=decoded[0].height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const pixels=decoded.map(image=>{context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height).data});
      let exact=0,close=0;
      for(let i=0;i<pixels[0].length;i+=4){let max=0;for(let channel=0;channel<3;channel++)max=Math.max(max,Math.abs(pixels[0][i+channel]-pixels[1][i+channel]));if(max===0)exact++;if(max<=8)close++;}
      const count=canvas.width*canvas.height;
      return{width:canvas.width,height:canvas.height,exactPercent:100*exact/count,within8Percent:100*close/count};
    },images);
    report.comparison.push({screen,...difference});
  }
  assert.deepEqual(report.localErrors,[],'Local browser errors.');
  assert.deepEqual(report.localExternalRequests,[],'Local requests reached outside localhost.');
  console.log(JSON.stringify(report,null,2));
}finally{
  await writeFile(OUT('original-client-check.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
