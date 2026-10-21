// Authoritative-server tests: room lifecycle, seating, dice and turn order
// (pure game state, no sockets). Socket-level behaviour is in socket.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room, GameServer, RULES, SEAT_COLOURS} from '../game/room.mjs';
import {decryptBlob, encryptBlob} from '../tools/crypto-check.mjs';

test('rooms seat players, assign colours and report capacity', () => {
  const room = new Room('1', {iLobbyId: 2, iMaxPlayer: 2, iLobbyChips: 500});
  const a = room.add({userId: 11, socketId: 's1', sName: 'A'});
  const b = room.add({userId: 22, socketId: 's2', sName: 'B'});
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
  assert.equal(a.colour, SEAT_COLOURS[0]);
  assert.equal(b.colour, SEAT_COLOURS[1]);
  assert.equal(room.isFull, true);
  assert.equal(room.add({userId: 33, socketId: 's3'}), null);
});

test('seating reuses the lowest free seat after a player leaves', () => {
  const room = new Room('1', {iLobbyId: 2, iMaxPlayer: 4});
  room.add({userId: 11, socketId: 's1'});
  room.add({userId: 22, socketId: 's2'});
  room.remove(11);
  const c = room.add({userId: 33, socketId: 's3'});
  assert.equal(c.seat, 0);
});

test('tableInit carries the fields the client reads', () => {
  const room = new Room('7', {iLobbyId: 3, iMaxPlayer: 2, iLobbyChips: 1000});
  room.add({userId: 11, socketId: 's1', sName: 'A', sImage: ''});
  room.turnCounter = 1;
  const ti = room.tableInit();
  assert.equal(ti._id, '7');
  assert.equal(ti.eRoomMode, 'Public');
  assert.equal(ti.iTurnCounter, 1);
  assert.equal(ti.aPlayers.length, 1);
  assert.equal(ti.aPlayers[0]._userId, 11);
  assert.ok(Array.isArray(ti.aTokens));
});

test('quick-match reuses an open public room at the same stake', () => {
  const game = new GameServer({log: {}});
  const lobby = {iLobbyId: 2, iMaxPlayer: 2, iLobbyChips: 500};
  const first = game.joinRoom(lobby, {userId: 1, socketId: 'a'});
  const second = game.joinRoom(lobby, {userId: 2, socketId: 'b'});
  assert.equal(first.room.id, second.room.id, 'both players share one table');
  const third = game.joinRoom(lobby, {userId: 3, socketId: 'c'});
  assert.notEqual(third.room.id, first.room.id, 'a full table forces a new room');
  assert.equal(game.byUser.get(1).roomId, first.room.id);
});

test('leaving dissolves an empty room', () => {
  const game = new GameServer({log: {}});
  const {room} = game.joinRoom({iLobbyId: 2, iMaxPlayer: 2}, {userId: 1, socketId: 'a'});
  game.leaveRoom(1);
  assert.equal(game.room(room.id), null);
});

test('encrypted envelopes round-trip through the wire format', () => {
  const payload = {_userId: 119894, eGameType: 'LUDO', _tableId: ''};
  const blob = encryptBlob(payload);
  assert.equal(blob[0], '2');
  assert.equal(blob[1], '7');
  assert.deepEqual(decryptBlob(blob), payload);
});

test('turn order cycles through seated players in seat order', () => {
  const room = new Room('1', {iLobbyId: 2, iMaxPlayer: 4});
  room.add({userId: 11, socketId: 's1'});
  room.add({userId: 22, socketId: 's2'});
  room.add({userId: 33, socketId: 's3'});
  assert.equal(room.current().userId, 11);
  room.turn = 1;
  assert.equal(room.current().userId, 22);
  room.turn = 2;
  assert.equal(room.current().userId, 33);
});

test('moves require a six to leave the yard and exact rolls to reach home',()=>{
 const r=new Room('1',{iMaxPlayer:2});r.add({userId:1});r.add({userId:2});r.started=true;
 r.dice=5;assert.deepEqual(r.legalMoves(),[]);assert.equal(r.move('L0'),null);
 r.dice=6;assert.equal(r.move('L0').to,0);assert.deepEqual(r.current().tokens,[0,-1,-1,-1]);
 r.current().tokens=[55,56,56,56];r.dice=2;assert.equal(r.move('L0'),null);r.dice=1;const win=r.move('L0');assert.equal(win.home,true);assert.equal(r.finished,true);assert.equal(r.current().rank,1);
});
test('capture uses opposite board starts in two-player matches and safe stars protect tokens',()=>{
 const r=new Room('1',{iMaxPlayer:2});const a=r.add({userId:1}),b=r.add({userId:2});
 a.tokens=[25,-1,-1,-1];b.tokens=[1,-1,-1,-1];r.dice=2;assert.equal(r.move('L0').captured.length,1);assert.equal(b.tokens[0],-1);
 a.tokens[0]=24;b.tokens[0]=0;r.dice=2;assert.equal(r.move('L0').captured.length,0);assert.equal(b.tokens[0],0);
});
test('unsafe doubles block passage and three consecutive sixes cannot move',()=>{
 const r=new Room('1',{iMaxPlayer:4});const a=r.add({userId:1}),b=r.add({userId:2});
 a.tokens=[12,-1,-1,-1];b.tokens=[1,1,-1,-1];r.dice=3;assert.equal(r.move('L0'),null);
 b.tokens=[-1,-1,-1,-1];r.roll(()=>6);r.roll(()=>6);r.roll(()=>6);assert.equal(r.move('L0'),null);
});
test('quick-match separates two-player and four-player rooms',()=>{
 const g=new GameServer({log:{}});const a=g.joinRoom({iLobbyId:1,iMaxPlayer:2},{userId:1});const b=g.joinRoom({iLobbyId:1,iMaxPlayer:4},{userId:2});assert.notEqual(a.room.id,b.room.id);
});
