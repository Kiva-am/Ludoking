// Original-client contract: incoming {data: ciphertext}; outgoing raw ciphertext.
// The timer event and the local lobby-count extension are plaintext.
import {readFileSync} from 'node:fs';
import {encryptBlob, decryptBlob} from '../tools/crypto-check.mjs';
import {GameServer, rollBlocker, actionBlocker} from './room.mjs';

const publicLobbies = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url))).LOBBY_COUNT_SETTING.Public;
const decode = raw => {
  try {
    if (typeof raw === 'string') return decryptBlob(raw);
    return typeof raw?.data === 'string' ? decryptBlob(raw.data) : raw;
  } catch { return null; }
};

export function attachGameServer(io, {
  log = console, resolveUser = null, randomDice, animationMs = 1200, reconnectMs = 30000,
} = {}) {
  const game = new GameServer({log});
  const emit = (socket, event, body) => socket.emit(event, encryptBlob(body));

  const counts = () => {
    const rooms = [...game.rooms.values()].filter(room => !room.finished);
    const count = room => room.seats.filter(seat => seat.status === 'Playing').length;
    const classic = Array.from({length: 8}, () => 0);
    for (const room of rooms) {
      if (!room.lobby.private) classic[room.lobby.iLobbyId - 1] = (classic[room.lobby.iLobbyId - 1] || 0) + count(room);
    }
    io.sockets.emit('localLobbyCounts', {
      LUDO_Public: rooms.filter(room => !room.lobby.private).reduce((n, room) => n + count(room), 0),
      LUDO_Private: rooms.filter(room => room.lobby.private).reduce((n, room) => n + count(room), 0),
      arrayLobbyClassic: classic, arrayLobbyPopular: classic,
    });
  };

  const broadcast = (room, event, body) => {
    for (const seat of room.seats) {
      const entry = game.byUser.get(seat.userId);
      // A player may have left this table and already entered another match.
      if (entry && entry.roomId !== room.id) continue;
      io.to(seat.socketId).emit(event, event === 'timer' ? body : encryptBlob(body));
    }
  };
  const table = room => { broadcast(room, 'tableInit', room.tableInit()); counts(); };
  const timers = room => {
    if (!room.started || room.finished) return;
    broadcast(room, 'timer', {
      iTurnCounter: room.turnCounter, iCurrentTurnId: room.current().seat + 1,
      currentPlayerTimerleft: Math.max(0, room.timerDeadline - Date.now()),
    });
  };
  const later = (room, fn, delay = animationMs) => {
    clearTimeout(room.timer);
    clearTimeout(room.pending);
    room.pending = setTimeout(() => { room.pending = null; fn(); }, delay);
    room.pending.unref?.();
  };
  const finish = room => { game.stopTimer(room); table(room); };
  const dissolve = room => {
    game.stopTimer(room);
    for (const seat of room.seats) {
      clearTimeout(seat.disconnectTimer);
      if (game.byUser.get(seat.userId)?.roomId === room.id) game.byUser.delete(seat.userId);
    }
    game.rooms.delete(room.id);
    counts();
  };
  const next = (room, extra = false) => {
    if (room.finished) return finish(room);
    room.nextTurn(extra);
    startTurn(room);
  };
  const dicePayload = (room, auto = false) => ({
    _userId: room.current().userId, _tableId: room.id,
    iCurrentTurnId: room.current().seat + 1, iDice: room.dice, iDiceValue: room.dice,
    iTurnCounter: room.turnCounter, bAutoStatus: auto ? 1 : 0,
  });
  const play = (room, tokenId, auto = false) => {
    const payload = {...dicePayload(room, auto), iTokenId: tokenId, bCanMove: 1};
    const result = room.move(tokenId);
    if (!result) return false;
    broadcast(room, 'userAction', payload);
    // Let the captured client's move animation finish before applying a snapshot.
    later(room, () => next(room, result.extra), animationMs + Math.max(1, result.to - result.from) * 180);
    return true;
  };
  const startTurn = room => {
    if (room.finished) return finish(room);
    game.startTimer(room, io, () => {
      const current = room.current();
      if (!current) return;
      current.misses++;
      if (current.misses >= 5) {
        current.status = 'AutoExit';
        game.byUser.delete(current.userId);
        const left = room.seats.filter(seat => seat.status === 'Playing');
        if (left.length <= 1) {
          if (left[0]) { left[0].status = 'Won'; left[0].rank = ++room.ranks; }
          room.finished = true;
          finish(room);
        } else next(room);
        return;
      }
      if (!room.dice) {
        room.roll(randomDice);
        table(room);
        broadcast(room, 'throwDice', dicePayload(room, true));
      }
      const legal = room.legalMoves();
      if (legal.length && room.sixes < 3) play(room, 'L' + legal[0].index, true);
      else later(room, () => next(room));
    });
    table(room);
    timers(room);
    room.ticker = setInterval(() => timers(room), 1000);
    room.ticker.unref?.();
  };
  const remove = socket => {
    const userId = socket.data.userId;
    const entry = game.byUser.get(userId);
    const room = entry && game.room(entry.roomId);
    if (!room || room.seatFor(userId)?.socketId !== socket.id) return;
    const seat = room.seatFor(userId);
    clearTimeout(seat.disconnectTimer);
    if (room.started && !room.finished) {
      // Keep turn ids stable while a running match still has other players.
      seat.status = 'Exit';
      game.byUser.delete(userId);
      const left = room.seats.filter(s => s.status === 'Playing');
      if (left.length <= 1) {
        if (left[0]) { left[0].status = 'Won'; left[0].rank = ++room.ranks; }
        room.finished = true;
        finish(room);
      } else if (room.current() === seat) next(room);
      else table(room);
    } else {
      game.leaveRoom(userId);
      if (game.room(room.id)) table(room);
    }
    if (room.seats.every(s => !io.sockets.connected[s.socketId] || s.socketId === socket.id)) dissolve(room);
  };

  io.on('connection', socket => {
    socket.data = {};
    const who = resolveUser?.(socket.handshake);
    if (who) Object.assign(socket.data, who);
    log.info?.(`[socket] connected ${socket.id} guest=${who?.gid || 'unknown'}`);
    counts();
    const entry = game.byUser.get(socket.data.userId);
    const resumed = entry && game.room(entry.roomId);
    const seat = resumed?.seatFor(socket.data.userId);
    if (seat) {
      clearTimeout(seat.disconnectTimer);
      seat.socketId = socket.id;
      entry.socketId = socket.id;
    }
    if (seat && resumed.started && !resumed.finished) {
      // Client handlers are registered immediately after creating the socket.
      const resume = setTimeout(() => {
        if (socket.connected) emit(socket, 'checkRunningGame', resumed.tableInit());
      }, 100);
      resume.unref?.();
    }

    const original = socket.onevent.bind(socket);
    socket.onevent = packet => {
      const [event, raw] = packet.data || [];
      const body = decode(raw);
      const ack = packet.id != null ? socket.ack(packet.id) : null;
      const reply = obj => ack?.(encryptBlob(obj));
      const send = (event, obj) => { reply(obj); emit(socket, event, obj); };
      const userId = socket.data.userId;
      const entry = game.byUser.get(userId);
      const room = entry && game.room(entry.roomId);
      log.info?.(`[recv] ${event} ${JSON.stringify(body)}`);
      if (!userId) { reply({status: 0, sMessage: 'Guest identity required'}); return; }
      if (room && room.seatFor(userId)?.socketId !== socket.id) {
        reply({status: 0, sMessage: 'Session replaced'});
        return;
      }
      switch (event) {
        case 'checkRunningGame':
          send(event, room && !room.finished ? room.tableInit() : {status: 0});
          return;
        case 'LUDO_public_room':
        case 'LUDO_private_room': {
          if (room && !room.finished) { reply(room.tableInit()); emit(socket, 'tableInit', room.tableInit()); return; }
          if (room) game.leaveRoom(userId);
          if (!body || ![2, 4].includes(Number(body.iMaxPlayer))) {
            reply({status: 0, sMessage: 'Choose two or four players'});
            return;
          }
          const lobby = {
            iLobbyId: Number(body.iLobbyId) || 0, iMaxPlayer: Number(body.iMaxPlayer),
            iLobbyChips: publicLobbies.find(l => l.id === Number(body.iLobbyId))?.amt || 0,
            private: event === 'LUDO_private_room', code: String(body.vPrivateCode || ''),
          };
          const result = game.joinRoom(lobby, {
            userId, socketId: socket.id, sName: socket.data.sName || 'Guest', sImage: '0',
          });
          if (result.error) { reply({status: 0, sMessage: result.error}); return; }
          const joined = result.room;
          reply(joined.tableInit());
          table(joined);
          if (joined.isFull && !joined.lobby.private) {
            joined.started = true;
            joined.turnCounter = 1;
            later(joined, () => startTurn(joined), 250);
          }
          return;
        }
        case 'startPvtTableGame':
        case 'startPrivateGame':
          if (room?.lobby.private && room.seats[0]?.userId === userId && room.seats.length >= 2 && !room.started) {
            room.lobby.iMaxPlayer = room.seats.length;
            room.started = true;
            room.turnCounter = 1;
            startTurn(room);
            reply({status: 1});
          } else reply({status: 0});
          return;
        case 'tableInit':
        case 'assignSocket':
        case 'assignSocketAfterReconnect':
          if (room) { reply(room.tableInit()); emit(socket, 'tableInit', room.tableInit()); }
          else reply({status: 0});
          return;
        case 'throwDiceEmit':
        case 'throwDice': {
          if (!room || rollBlocker(room, userId) || body?.iTurnCounter !== room.turnCounter ||
              (body?._tableId !== undefined && String(body._tableId) !== room.id)) {
            reply({status: 0});
            return;
          }
          room.roll(randomDice);
          table(room);
          broadcast(room, 'throwDice', dicePayload(room));
          reply({status: 1});
          if (room.sixes >= 3 || !room.legalMoves().length) {
            broadcast(room, 'userAction', {...dicePayload(room, true), bCanMove: 0, iTokenId: 'L0'});
            later(room, () => next(room));
          }
          return;
        }
        case 'userActionEmit':
        case 'userAction':
          if (!room || actionBlocker(room, userId, body)) { reply({status: 0}); return; }
          reply({status: play(room, body?.iTokenId) ? 1 : 0});
          return;
        case 'pingTimerOnTurnStart':
        case 'triggerTimer':
          if (room) timers(room);
          reply({status: 1});
          return;
        case 'leaveRoom': remove(socket); reply({status: 1}); return;
        case 'pingPong': reply({status: 1}); return;
        default: original(packet);
      }
    };
    socket.on('disconnect', () => {
      const entry = game.byUser.get(socket.data.userId);
      const room = entry && game.room(entry.roomId);
      const seat = room?.seatFor(socket.data.userId);
      if (!seat || seat.socketId !== socket.id) return;
      if (!room.started || room.finished) { remove(socket); return; }
      if (!room.seats.some(s => s.status === 'Playing' && io.sockets.connected[s.socketId])) { dissolve(room); return; }
      seat.disconnectTimer = setTimeout(() => remove(socket), reconnectMs);
      seat.disconnectTimer.unref?.();
    });
  });
  return game;
}
