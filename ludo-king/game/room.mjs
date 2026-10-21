import {randomInt} from 'node:crypto';

export const RULES = {
  maxPlayers: 4,
  diceFaces: 6,
  turnSeconds: Number(process.env.TURN_SECONDS || 15),
  startChips: 1000,
  home: 56,
};
export const SEAT_COLOURS = ['red', 'green', 'yellow', 'blue'];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
// The captured board has 51 shared path steps, followed by six private home cells.
export const boardCell = (seat, position) => position >= 0 && position < 51 ? (seat * 13 + position) % 52 : null;

export class Room {
  constructor(id, lobby) {
    Object.assign(this, {
      id, lobby, seats: [], players: new Map(), turn: 0, turnCounter: 0,
      dice: 0, started: false, finished: false, timer: null, ticker: null,
      pending: null, timerDeadline: 0, sixes: 0, ranks: 0,
    });
  }
  get isFull() { return this.seats.length >= this.lobby.iMaxPlayer; }
  seatFor(id) { return this.seats.find(s => s.userId === id) || null; }
  order() { return this.seats.slice().sort((a, b) => a.seat - b.seat); }
  current() { return this.order()[this.turn] || null; }

  add(player) {
    if (this.isFull || this.seatFor(player.userId)) return null;
    const used = new Set(this.seats.map(s => s.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const record = {
      ...player, seat, colour: SEAT_COLOURS[seat], tokens: [-1, -1, -1, -1],
      status: 'Playing', misses: 0, rank: 0,
    };
    this.seats.push(record);
    this.players.set(record.userId, record);
    return record;
  }

  remove(id) {
    const player = this.seatFor(id);
    if (!player) return null;
    this.seats.splice(this.seats.indexOf(player), 1);
    this.players.delete(id);
    if (this.turn >= this.seats.length) this.turn = 0;
    return player;
  }

  publicPlayers() {
    return this.order().map(s => ({
      _userId: s.userId, sName: s.sName, sImage: s.sImage || '0', sCountryCode: 0,
      iSeat: s.seat, iTurnId: s.seat + 1, eColor: s.colour,
      nChips: RULES.startChips, iChips: RULES.startChips,
      nTotalChips: RULES.startChips, nLevel: 1,
      bBot: !!s.isBot, bReady: true, eStatus: s.status,
      iMissTurn: s.misses, iWonRank: s.rank,
      aTokens: Object.fromEntries(s.tokens.map((position, index) => ['L' + index, position])),
    }));
  }

  tokenState() {
    return this.order().map(s => ({
      _userId: s.userId, eColor: s.colour, aTokens: s.tokens.slice(),
      iScore: s.tokens.filter(p => p === RULES.home).length,
    }));
  }

  tableInit() {
    return {
      _id: this.id, status: 200, eGameType: 'LUDO',
      eStatus: this.finished ? 'Finished' : this.started ? 'Running' : 'Waiting',
      eRoomMode: this.lobby.private ? 'Private' : 'Public',
      iLobbyId: this.lobby.iLobbyId || 0, iLobbyChips: this.lobby.iLobbyChips || 0,
      iMaxPlayer: this.lobby.iMaxPlayer, iTotalPlayer: this.lobby.iMaxPlayer,
      bUndo: 0, vPrivateCode: this.lobby.code || '',
      iTurnCounter: this.turnCounter, iTurnTimer: RULES.turnSeconds,
      iChance: this.turn, iDice: this.dice, iDiceValue: this.dice,
      iCurrentTurn: this.current()?.userId ?? null,
      iCurrentTurnId: (this.current()?.seat ?? 0) + 1,
      aPlayers: this.publicPlayers(), aTokens: this.tokenState(),
      aLegalTokenIds: this.sixes < 3 ? this.legalMoves().map(move => 'L' + move.index) : [],
      timestamp: this.timerDeadline || Date.now() + RULES.turnSeconds * 1000,
    };
  }

  // Two-player clients render their opponent in the opposite corner.
  cell(player, position) {
    return boardCell(this.lobby.iMaxPlayer === 2 ? player.seat * 2 : player.seat, position);
  }

  legalMoves(player = this.current()) {
    if (!player || player.status !== 'Playing' || !this.dice) return [];
    return player.tokens.flatMap((position, index) => {
      if (position === RULES.home || (position < 0 && this.dice !== 6) ||
          (position >= 0 && position + this.dice > RULES.home)) return [];
      const to = position < 0 ? 0 : position + this.dice;
      // A stack of opposing tokens on an unsafe cell blocks passage and landing.
      for (let step = Math.max(0, position + 1); step <= to; step++) {
        const cell = this.cell(player, step);
        if (cell === null || SAFE.has(cell)) continue;
        if (this.seats.some(s => s !== player && s.status === 'Playing' &&
            s.tokens.filter(p => this.cell(s, p) === cell).length >= 2)) return [];
      }
      return [{index, from: position, to, cell: this.cell(player, to)}];
    });
  }

  roll(random = () => randomInt(1, 7)) {
    this.dice = random();
    this.sixes = this.dice === 6 ? this.sixes + 1 : 0;
    return this.dice;
  }

  move(tokenId) {
    const token = /^L([0-3])$/.exec(tokenId || '');
    const move = token && this.legalMoves().find(m => m.index === Number(token[1]));
    if (!move || this.sixes >= 3) return null;
    const player = this.current();
    player.tokens[move.index] = move.to;
    const captured = [];
    if (move.cell !== null && !SAFE.has(move.cell)) {
      for (const opponent of this.seats) {
        if (opponent === player || opponent.status !== 'Playing') continue;
        for (let index = 0; index < 4; index++) {
          if (this.cell(opponent, opponent.tokens[index]) === move.cell) {
            opponent.tokens[index] = -1;
            captured.push({userId: opponent.userId, index});
          }
        }
      }
    }
    const home = move.to === RULES.home;
    if (player.tokens.every(p => p === RULES.home)) {
      player.status = 'Won';
      player.rank = ++this.ranks;
    }
    const left = this.seats.filter(s => s.status === 'Playing');
    if (left.length <= 1) {
      if (left[0]) { left[0].status = 'Lost'; left[0].rank = ++this.ranks; }
      this.finished = true;
    }
    return {
      ...move, captured, home,
      extra: player.status === 'Playing' && (this.dice === 6 || home || captured.length > 0),
    };
  }

  nextTurn(extra = false) {
    if (!extra) {
      this.sixes = 0;
      for (let i = 0; i < this.seats.length; i++) {
        this.turn = (this.turn + 1) % this.seats.length;
        if (this.current().status === 'Playing') break;
      }
    }
    this.turnCounter++;
    this.dice = 0;
  }
}

export class GameServer {
  constructor({log = console} = {}) {
    this.log = log;
    this.rooms = new Map();
    this.byUser = new Map();
    this.nextRoomId = 1;
  }
  room(id) { return this.rooms.get(String(id)) || null; }
  createRoom(lobby) {
    const room = new Room(String(this.nextRoomId++), {
      iLobbyId: lobby.iLobbyId || 0, iMaxPlayer: lobby.iMaxPlayer || 2,
      iLobbyChips: lobby.iLobbyChips || 0, private: !!lobby.private, code: lobby.code || '',
    });
    this.rooms.set(room.id, room);
    return room;
  }
  joinRoom(lobby, player) {
    let room;
    if (lobby.private && lobby.code) {
      room = [...this.rooms.values()].find(r => r.lobby.private && r.lobby.code === lobby.code && !r.started && !r.isFull);
    } else if (!lobby.private) {
      room = [...this.rooms.values()].find(r => !r.lobby.private && !r.started && !r.finished && !r.isFull &&
        r.lobby.iLobbyId === (lobby.iLobbyId || 0) && r.lobby.iMaxPlayer === (lobby.iMaxPlayer || 2));
    }
    if (lobby.private && lobby.code && !room) return {error: 'Room not found or already started'};
    if (!room) {
      room = this.createRoom(lobby);
      if (lobby.private) room.lobby.code = randomInt(100000, 1000000).toString();
    }
    const seat = room.add(player);
    this.byUser.set(player.userId, {roomId: room.id, socketId: player.socketId});
    return {room, seat};
  }
  leaveRoom(id) {
    const entry = this.byUser.get(id);
    if (!entry) return null;
    const room = this.room(entry.roomId);
    this.byUser.delete(id);
    if (!room) return null;
    const gone = room.remove(id);
    if (!room.seats.some(s => this.byUser.get(s.userId)?.roomId === room.id)) {
      this.stopTimer(room);
      for (const s of room.seats) clearTimeout(s.disconnectTimer);
      this.rooms.delete(room.id);
    }
    return gone;
  }
  startTimer(room, io, onExpire) {
    this.stopTimer(room);
    room.timerDeadline = Date.now() + RULES.turnSeconds * 1000;
    room.timer = setTimeout(onExpire, RULES.turnSeconds * 1000);
    room.timer.unref?.();
  }
  stopTimer(room) {
    clearTimeout(room.timer);
    clearInterval(room.ticker);
    clearTimeout(room.pending);
    room.timer = room.ticker = room.pending = null;
    room.timerDeadline = 0;
  }
}

export function rollBlocker(room, id) {
  if (!room.started || room.finished) return 'match-not-running';
  if (room.current()?.userId !== id) return 'not-your-turn';
  if (room.dice || room.pending) return 'already-rolled';
  return null;
}
export function actionBlocker(room, id, body) {
  if (!room.started || room.finished) return 'match-not-running';
  if (room.current()?.userId !== id) return 'not-your-turn';
  if (!room.dice || room.pending) return 'roll-first';
  if (body?.iTurnCounter !== room.turnCounter) return 'stale-turn';
  if (body?._tableId !== undefined && String(body._tableId) !== room.id) return 'wrong-table';
  return null;
}
