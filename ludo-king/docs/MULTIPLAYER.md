# Local multiplayer protocol and verification

## Current contract

The captured client is `public/play/assets/main/index.606d4.js` (Cocos Creator
2.x). Field names and timing were recovered from its network, player, token,
and dice handlers, then checked against real browser clients. Historical
exploration notes predate the completed adapter and contain superseded crypto
and backend assumptions.

Transport is Socket.IO 1.7.4 at `/v7/socket.io`.

- Client messages normally use `{data: blob}`. Private-room messages can also
  arrive as plain objects in the captured client.
- `blob` is one key-selector character, one IV-selector character, then base64
  AES-128-CBC ciphertext of PKCS7-padded JSON. The selectors/tables and a captured
  test vector are implemented in `tools/crypto-check.mjs`.
- Server `tableInit`, `checkRunningGame`, `throwDice`, and `userAction` events,
  plus their encrypted acknowledgements, carry the **raw blob**, without a
  `{data: ...}` wrapper. `timer` is plaintext.
- Successful resume/table payloads need `status: 200`. Table `eStatus` is
  `Waiting`, `Running`, or `Finished`; player status uses `Playing`, `Won`,
  `Lost`, `Exit`, or `AutoExit`.
- Player turn identifiers are 1-based `iTurnId`; the active seat is
  `iCurrentTurnId`. Numeric guest `_userId` is a separate identity.
- Each player's `aTokens` is an object from `L0` through `L3` to path positions:
  -1 for the yard, 0 for the first board cell, 56 for home. The captured paths
  contain 57 entries: 51 shared steps followed by six private home cells.
- Moves supply `iTokenId`, `iTurnCounter`, and `_tableId`. Dice and move
  notifications include `iDiceValue`, `iCurrentTurnId`, and `iTurnCounter`.
  Move notifications also include numeric `bCanMove` and `bAutoStatus`.

The server ignores claimed token arrays, identities, dice values, and extra-turn
flags. It computes results from the current socket session and board. Stale
turns, replacement sockets, duplicate rolls, illegal token choices, and
cross-table requests are rejected. Matchmaking separates lobby, player count,
and private-room code, and never adds a late player to a started public match.

The board's safe shared cells are 0, 8, 13, 21, 26, 34, 39, and 47. Two-player
matches use opposite starts. Opponent doubles block unsafe cells; captures and
home grant an extra turn. Rankings continue until only one player remains.

## Local adapter differences

`public/multiplayer.js` requests the server dice at roll start, before the
original animation completion handler reads `tableInitData.iDiceValue`. It
suppresses the client's duplicate completion request and waits if the response
is delayed. It also applies the server's `aLegalTokenIds` extension when
activating the local player's tokens. Computer/local modes use their original
handlers.

`public/compat.js` attaches the tab's guest id to both native profile URLs and
the Socket.IO handshake. `LAST_TABLE_ID` and `LAST_ONLINE_MODE` are backed by
sessionStorage so tabs cannot clear each other's match navigation state.
`localLobbyCounts` is a plaintext local extension used by the adapter; it does
not claim compatibility with a production event.

On reconnect, a seat is rebound to the new socket and a delayed
`checkRunningGame` event restores the original board flow. Explicit leaving and
reconnect-grace expiry retain exited seats' turn ids while a match continues.
When all active players disconnect, the room and its timers are dissolved.

## Checks

`npm test` covers captured asset integrity, local endpoint isolation, room
capacity, matching, encryption round trips, legal moves, exact home, captures,
safe cells, blocked doubles, consecutive sixes, native event shapes, session
identity, stale/duplicate actions, timeout movement and elimination, reconnects,
cleanup, and starting a replacement match.

`npm run test:multiplayer` and `npm run test:multiplayer:four` run original
Cocos clients in one shared browser context, using distinct per-tab guests.
They exercise every seat, compare received board snapshots, verify that REST
profiles retain the correct tab identity, reload one player, and verify final
result processing with no page errors. Dice/token actions use real mouse input.
Menu setup uses the original handlers after entering Online with a real click.
The finish check seeds an authoritative near-finish server fixture rather than
claiming an entire random game was played. Screenshots visually confirm the
original ranking/result panels.

Provider accounts, social/invitation UI, chat/gifts, production compatibility,
persistent balances, and public deployment remain outside this implementation.
