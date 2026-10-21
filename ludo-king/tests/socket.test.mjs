import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import ioClient from 'socket.io-client';
import socketio from 'socket.io';
import {createCloneServer,guestNumericId} from '../server.mjs';
import {attachGameServer} from '../game/socket-bridge.mjs';
import {encryptBlob,decryptBlob} from '../tools/crypto-check.mjs';
const lobby={iLobbyId:2,iMaxPlayer:2};
async function until(fn,ms=4000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out waiting for game event');}
async function fixture(t,opts={}){
 const server=createCloneServer(),io=socketio(server,{path:'/v7/socket.io'});
 const game=attachGameServer(io,{log:{},randomDice:()=>6,animationMs:5,reconnectMs:100,...opts,resolveUser:h=>{const gid=h.query.gid;return gid?{gid,userId:guestNumericId(gid),sName:gid}:null;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const clients=[];
 t.after(()=>{for(const r of game.rooms.values()){game.stopTimer(r);for(const s of r.seats)clearTimeout(s.disconnectTimer);}for(const c of clients)c.disconnect();io.close();server.close();});
 const connect=async gid=>{
  const socket=ioClient(`http://127.0.0.1:${server.address().port}`,{path:'/v7/socket.io',transports:['websocket'],forceNew:true,query:{gid}});clients.push(socket);
  const inbox={};for(const ev of ['tableInit','timer','throwDice','userAction','checkRunningGame']){inbox[ev]=[];socket.on(ev,p=>inbox[ev].push(ev==='timer'?p:decryptBlob(p)));}
  await once(socket,'connect');return {id:guestNumericId(gid),socket,inbox,send:(ev,b)=>new Promise(resolve=>socket.emit(ev,{data:encryptBlob(b)},ack=>resolve(decryptBlob(ack))))};
 };
 const pair=async()=>{const a=await connect('guest-aaaa'),b=await connect('guest-bbbb');await a.send('LUDO_public_room',lobby);await b.send('LUDO_public_room',lobby);await until(()=>[...game.rooms.values()][0]?.timer);return {a,b,room:[...game.rooms.values()][0]};};
 return {game,connect,pair};
}
test('native protocol sends raw ciphertext, a waiting table before running, and plaintext timers',async t=>{
 const {pair}=await fixture(t);const {a,b,room}=await pair();
 await until(()=>a.inbox.tableInit.at(-1).eStatus==='Running'&&b.inbox.timer.length);
 assert.equal(a.inbox.tableInit[0].eStatus,'Waiting');assert.equal(a.inbox.tableInit.at(-1).eStatus,'Running');assert.equal(a.inbox.tableInit.at(-1)._id,b.inbox.tableInit.at(-1)._id);
 assert.deepEqual(room.publicPlayers().map(p=>p.iTurnId),[1,2]);assert.equal(a.inbox.timer.at(-1).iCurrentTurnId,1);
 await a.send('checkRunningGame',{});await until(()=>a.inbox.checkRunningGame.length);assert.equal(a.inbox.checkRunningGame[0].status,200);
});
test('socket identity, duplicate rolls, stale moves and fabricated token positions are enforced',async t=>{
 const {pair}=await fixture(t);const {a,b,room}=await pair();
 const body={_tableId:room.id,iTurnCounter:room.turnCounter};
 assert.equal((await b.send('throwDice',{...body,_userId:a.id})).status,0);
 assert.equal((await a.send('userAction',{...body,iTokenId:'L0'})).status,0);
 assert.equal((await a.send('throwDice',body)).status,1);assert.equal((await a.send('throwDice',body)).status,0);
 assert.equal((await a.send('userAction',{...body,iTurnCounter:0,iTokenId:'L0'})).status,0);
 assert.equal((await a.send('userAction',{...body,aTokens:[55,55,55,55]})).status,0);
 assert.equal((await a.send('userAction',{...body,iTokenId:'L0',aTokens:[55,55,55,55],bFinishTurn:true})).status,1);
 assert.deepEqual(room.seatFor(a.id).tokens,[0,-1,-1,-1]);await until(()=>room.turnCounter===2);assert.equal(room.current().userId,a.id,'six earns another roll');
});
test('ordinary moves pass the turn and both clients receive native token events',async t=>{
 let roll=6;const {pair}=await fixture(t,{randomDice:()=>roll});const {a,b,room}=await pair();
 await a.send('throwDice',{iTurnCounter:1});await a.send('userAction',{iTurnCounter:1,iTokenId:'L0'});await until(()=>room.turnCounter===2);
 roll=1;await a.send('throwDice',{iTurnCounter:2});await a.send('userAction',{iTurnCounter:2,iTokenId:'L0'});await until(()=>room.turnCounter===3);
 assert.equal(room.current().userId,b.id);assert.equal(b.inbox.userAction.at(-1).iTokenId,'L0');assert.equal(b.inbox.userAction.at(-1).iDiceValue,1);assert.equal(room.seatFor(a.id).tokens[0],1);
});
test('four-player matching waits for capacity and separates player counts and private codes',async t=>{
 const {game,connect}=await fixture(t);const players=[];
 for(const gid of ['guest-a','guest-b','guest-c','guest-d']){const p=await connect(gid);players.push(p);await p.send('LUDO_public_room',{...lobby,iMaxPlayer:4});if(players.length<4)assert.equal([...game.rooms.values()][0].started,false);}
 await until(()=>[...game.rooms.values()][0].timer);assert.equal(game.rooms.size,1);
 const e=await connect('guest-e');await e.send('LUDO_public_room',lobby);assert.equal(game.rooms.size,2);
 const f=await connect('guest-f');const privateRoom=await f.send('LUDO_private_room',lobby);assert.match(privateRoom.vPrivateCode,/^\d{6}$/);
 const g=await connect('guest-g');assert.equal((await g.send('LUDO_private_room',{...lobby,vPrivateCode:'000000'})).status,0);
 const joined=await g.send('LUDO_private_room',{...lobby,vPrivateCode:privateRoom.vPrivateCode});assert.equal(joined._id,privateRoom._id);
});
test('reconnection keeps a seat and a stale socket cannot remove the replacement',async t=>{
 const {connect,pair}=await fixture(t,{reconnectMs:500});const {a,b,room}=await pair();a.socket.disconnect();const replacement=await connect('guest-aaaa');
 await replacement.send('checkRunningGame',{});assert.equal(room.seatFor(a.id).socketId,replacement.socket.id);await new Promise(r=>setTimeout(r,550));assert.equal(room.seatFor(a.id).status,'Playing');
 await replacement.send('leaveRoom',{});assert.equal(room.finished,true);assert.equal(room.seatFor(b.id).rank,1);
});
test('all disconnected players dissolve the room and stop timers',async t=>{
 const {game,pair}=await fixture(t);const {a,b,room}=await pair();a.socket.disconnect();b.socket.disconnect();await until(()=>game.rooms.size===0);assert.equal(room.timer,null);assert.equal(room.ticker,null);
});

test('a replacement connection rejects actions from the still-connected old socket',async t=>{
 const {connect,pair}=await fixture(t);const {a,room}=await pair();const replacement=await connect('guest-aaaa');
 assert.equal((await a.send('throwDice',{iTurnCounter:1})).status,0);
 assert.equal((await replacement.send('throwDice',{iTurnCounter:1})).status,1);
 a.socket.disconnect();await new Promise(r=>setTimeout(r,150));assert.equal(room.seatFor(a.id).socketId,replacement.socket.id);
});

test('a no-move roll passes the turn, and timeout auto-moves consume the five-skip allowance',async t=>{
 const {RULES}=await import('../game/room.mjs');const originalSeconds=RULES.turnSeconds;RULES.turnSeconds=0.12;t.after(()=>{RULES.turnSeconds=originalSeconds;});
 const {pair}=await fixture(t,{randomDice:()=>1});const {a,b,room}=await pair();
 await a.send('throwDice',{iTurnCounter:1});await until(()=>room.turnCounter===2);assert.equal(room.current().userId,b.id);
 // B has an open token, so a timeout must move it rather than stall.
 room.seatFor(b.id).tokens=[0,-1,-1,-1];
 await until(()=>room.turnCounter>=3);assert.equal(room.seatFor(b.id).tokens[0],1);assert.equal(room.seatFor(b.id).misses,1);
 room.seatFor(a.id).misses=4;
 await until(()=>room.finished);assert.equal(room.seatFor(a.id).status,'AutoExit');assert.equal(room.seatFor(b.id).status,'Won');
});

test('a finished match can be replaced with a new match and its old room is removed',async t=>{
 const {game,pair}=await fixture(t);const {a,b,room}=await pair();room.current().tokens=[55,56,56,56];
 // The final move must be a one, not the fixture default six.
 room.dice=1;await a.send('userAction',{iTurnCounter:1,iTokenId:'L0'});await until(()=>room.finished);
 await a.send('LUDO_public_room',lobby);await b.send('LUDO_public_room',lobby);
 await until(()=>[...game.rooms.values()].some(r=>r.id!==room.id&&r.timer));
 assert.equal(game.room(room.id),null);assert.equal(game.rooms.size,1);const next=[...game.rooms.values()][0];
 assert.deepEqual(next.seatFor(a.id).tokens,[-1,-1,-1,-1]);assert.equal(next.turnCounter,1);
});
