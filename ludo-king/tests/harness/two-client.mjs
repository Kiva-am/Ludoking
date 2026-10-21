// End-to-end native Cocos test. Owns an isolated server and uses real mouse
// input for dice and tokens. The terminal-state check seeds a server fixture.
import {chromium} from 'playwright-core';
import {once} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import socketio from 'socket.io';
import {createCloneServer,guestNumericId,guestName} from '../../server.mjs';
import {attachGameServer} from '../../game/socket-bridge.mjs';
import {RULES} from '../../game/room.mjs';
import {encryptBlob} from '../../tools/crypto-check.mjs';
RULES.turnSeconds=60;
const playerCount=Number(process.argv.find(arg=>arg.startsWith('--players='))?.split('=')[1]||process.env.LK_PLAYERS||2);
assert.ok([2,4].includes(playerCount));
const server=createCloneServer(),io=socketio(server,{path:'/v7/socket.io'});
const dice=[6,1,6,2,6,3,6,4];let rolls=0, forcedDice;
const messages=[];
const game=attachGameServer(io,{log:{info:m=>messages.push(m)},randomDice:()=>forcedDice??dice[rolls++%dice.length],resolveUser:h=>{const gid=h.query.gid;return gid?{gid,userId:guestNumericId(gid),sName:guestName(gid)}:null;}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const pages=await Promise.all(Array.from({length:playerCount},()=>context.newPage()));
const errors=[],summary={ok:false,playerCount,steps:[],errors};
const step=(name,detail)=>{summary.steps.push({name,detail});console.log(name,JSON.stringify(detail));};
const until=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+label);};
const state=p=>p.evaluate(()=>{const c=window.__require('config');return {id:c.myNetworkID,turn:c.curTurnID,myTurn:c.myTurnID,counter:c.currentTurnCounter,loaded:c.bGameSceneLoaded,finished:c.bTableFinished,table:c.tableInitData,players:cc.find('Canvas/screenInGame/rootGame/Players').children.filter(n=>n.getComponent('Player')).map(n=>{const p=n.getComponent('Player');return {name:n.name,active:n.activeInHierarchy,tokens:(p.openTokens||[]).map(t=>({id:t.tokenID,index:t.currentIndex,open:t.isOpen}))};})};});
async function click(p,target){
 const point=await p.evaluate(target=>{
  const nodes=[];const walk=n=>{nodes.push(n);for(const c of n.children||[])walk(c);};walk(cc.director.getScene());
  let n;
  if(target==='dice')n=nodes.find(n=>n.activeInHierarchy&&n.getComponent('Dice')&&n.getComponent('Dice').player.getComponent('Player').myIndex===0);
  else if(target==='token')n=nodes.find(n=>n.activeInHierarchy&&n.getComponent('TokenInputHandler')?.enabled&&n.getComponent('Token')?.player.getComponent('Player').myIndex===0);
  else n=nodes.find(n=>n.activeInHierarchy&&n.name===target);
  if(!n)throw new Error('No visible '+target);
  const world=n.convertToWorldSpaceAR(cc.v2(0,0)),size=cc.view.getVisibleSize(),rect=document.querySelector('canvas').getBoundingClientRect();
  return {x:rect.x+world.x/size.width*rect.width,y:rect.y+(1-world.y/size.height)*rect.height};
 },target);
 await p.mouse.click(point.x,point.y);return point;
}
try{
 for(const [i,p]of pages.entries())p.on('pageerror',e=>{errors.push({client:i,message:e.stack});console.log('PAGE ERROR',i,e.message);});
 await Promise.all(pages.map(async p=>{
  await p.goto(origin);await p.waitForFunction(()=>{try{return window.__require('config').isGlobalConnect&&window.__localGuestStarted;}catch{return false;}},{},{timeout:60000});
  await p.evaluate(()=>{window.onClickLoginCloseBtn();window.component=name=>{let result;const walk=n=>{for(const c of n._components||[])if(cc.js.getClassName(c)===name)result=c;for(const child of n.children||[])walk(child);};walk(cc.director.getScene());return result;};});
 }));
 step('guests',await Promise.all(pages.map(p=>p.evaluate(()=>window.__localGuestId))));
 assert.notEqual(await pages[0].evaluate(()=>window.__localGuestId),await pages[1].evaluate(()=>window.__localGuestId));
 for(const p of pages){
  await click(p,'onlineMP');await p.waitForTimeout(300);
  await p.evaluate(count=>{window.component('UIButtonHandler').onClickPlayerSelection(null,count);window.component('UIPublicMPMode').onNextToLobby();},playerCount);await p.waitForTimeout(300);
  await p.evaluate(()=>window.component('UIPublicMPMode').onPlayToSearchPlayer());
 }
 await until(async()=>{const states=await Promise.all(pages.map(state));return states.every(s=>s.loaded&&s.table.eStatus==='Running'&&s.players[0].tokens.length===4);},'both boards loaded',30000);
 for(const p of pages)await p.evaluate(()=>{const c=window.component('UITurnSkip');if(c?.node.activeInHierarchy)c.OnBackKeyPressed();});
 await pages[0].waitForTimeout(2500);
 for(const p of pages)assert.equal(await p.evaluate(()=>window.__require('config').serverUserData._id),await p.evaluate(()=>window.__require('config').myNetworkID),'profile remains per-tab despite shared cookies');
 const room=[...game.rooms.values()][0],initial=await Promise.all(pages.map(state));
 step('boards',initial.map(s=>({id:s.id,turn:s.turn,myTurn:s.myTurn,counter:s.counter,table:s.table._id})));
 assert.ok(initial.every(s=>s.table._id===initial[0].table._id));assert.equal(room.seats.length,playerCount);
 for(let action=0;action<playerCount*2-1;action++){
  const id=room.current().userId,index=initial.findIndex(s=>s.id===id),p=pages[index],counter=room.turnCounter;
  await until(async()=>(await state(p)).counter===counter,'client current turn');
  step('clickDice',{client:index,counter,point:await click(p,'dice')});
  await until(()=>room.dice!==0,'dice request received');
  await until(async()=>room.pending||room.turnCounter>counter||p.evaluate(()=>cc.find('Canvas/screenInGame/rootGame/Players').children.some(n=>(n.getComponent('Player')?.openTokens||[]).some(t=>t.getComponent('TokenInputHandler')?.enabled&&t.player.getComponent('Player').myIndex===0))),'token activation or native automatic move');
  if(!room.pending&&room.turnCounter===counter){
   try{step('clickToken',{client:index,counter,dice:room.dice,point:await click(p,'token')});}
   catch(error){
    // The original client may auto-select between observing activation and
    // locating the token. Only accept that race after the server got the move.
    if(!String(error).includes('No visible token')||(!room.pending&&room.turnCounter===counter))throw error;
    step('automaticToken',{client:index,counter});
   }
  }else step('automaticToken',{client:index,counter});
  await until(()=>room.turnCounter>counter,'move and next turn');
  await until(async()=>(await Promise.all(pages.map(state))).every(s=>s.counter===room.turnCounter),'both clients advanced');
  const expected=room.publicPlayers();
  for(const q of pages){const s=await state(q);assert.deepEqual(s.table.aPlayers.map(p=>p.aTokens),expected.map(p=>p.aTokens));}
  step('move',{counter:room.turnCounter,turn:room.current().userId,tokens:room.tokenState()});
 }
 // A reload uses the same per-tab guest and restores the authoritative board.
 const reconnecting=pages[0],oldId=initial[0].id;
 await reconnecting.reload();await reconnecting.waitForFunction(()=>{try{return window.__require('config').isGlobalConnect;}catch{return false;}},{},{timeout:60000});
 await reconnecting.evaluate(()=>window.onClickLoginCloseBtn());
 await until(async()=>{const s=await state(reconnecting);return s.loaded&&s.counter===room.turnCounter;},'resume board',30000);
 await reconnecting.waitForTimeout(2000);
 assert.equal((await state(reconnecting)).id,oldId);assert.equal(room.seats.length,playerCount);step('reconnected',{id:oldId,counter:room.turnCounter});
 // Seed a near-finish SERVER fixture to exercise the native win screen without
 // spending hundreds of random turns; all final input still uses the UI.
 forcedDice=1;
 const winner=room.current();winner.tokens=[55,56,56,56];
 for(const s of room.seats.filter(s=>s!==winner).slice(1)){s.tokens=[56,56,56,56];s.status='Won';s.rank=++room.ranks;}
 room.turnCounter++;
 const snapshot=room.tableInit();for(const s of room.seats)io.to(s.socketId).emit('tableInit',encryptBlob(snapshot));
 await until(async()=>(await Promise.all(pages.map(state))).every(s=>s.counter===room.turnCounter),'near-finish table');
 const winnerPage=pages[initial.findIndex(s=>s.id===winner.userId)];
 await click(winnerPage,'dice');await until(()=>room.dice===1,'final roll');await winnerPage.waitForTimeout(1800);
 await until(async()=>room.finished||room.pending||winnerPage.evaluate(()=>{const ns=cc.find('Canvas/screenInGame/rootGame/Players').children;return ns.some(n=>(n.getComponent('Player')?.openTokens||[]).some(t=>t.getComponent('TokenInputHandler')?.enabled));}),'final token enabled or automatic finish');
 if(!room.finished&&!room.pending){
  try{await click(winnerPage,'token');}
  catch(error){if(!String(error).includes('No visible token')||(!room.finished&&!room.pending))throw error;}
 }
 await until(()=>room.finished,'match finished');
 await until(async()=>(await Promise.all(pages.map(state))).every(s=>s.finished),'both finish screens');
 await winnerPage.waitForTimeout(2500);step('finished',{winner:winner.userId,ranks:room.publicPlayers().map(p=>p.iWonRank)});
 await Promise.all(pages.map((p,i)=>p.screenshot({path:`test-results/${playerCount===2?'two':'four'}-client-${String.fromCharCode(65+i)}.png`})));
 assert.deepEqual(errors,[]);summary.ok=true;step('done',{ok:true});
}catch(e){summary.error=e.stack;summary.serverEvents=messages.slice(-30);console.error(e,summary.serverEvents);for(const [i,p]of pages.entries()){summary['state'+i]=await state(p).catch(e=>String(e));await p.screenshot({path:`test-results/two-client-failed-${i}.png`,timeout:5000}).catch(()=>{});}}
finally{for(const r of game.rooms.values())game.stopTimer(r);await browser.close();io.close();server.close();await mkdir('test-results',{recursive:true});await writeFile(`test-results/${playerCount===2?'two':'four'}-client-summary.json`,JSON.stringify(summary,null,2));}
process.exitCode=summary.ok?0:1;

