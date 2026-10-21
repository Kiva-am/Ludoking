> Historical investigation notes: these describe the earlier bot-only stage. The current local guest/multiplayer implementation and verified wire contract are documented in [MULTIPLAYER.md](MULTIPLAYER.md). In particular, later recovery established two one-character crypto selectors, raw encrypted server events, and status 200 for resume responses.

# Ludo King â€” online multiplayer reverse-engineering findings

Evidence gathered with REA/Playwright against the running local clone
(`http://127.0.0.1:8788/`). All class names, event names and field names below
were read from the live client (Cocos Creator 2.x, minified bundle
`public/play/assets/main/index.606d4.js`) or from its decoded string table.

## 1. Class names survive minification

Cocos keeps class names for serialization; `cc.js.getClassName()` returns the
real script class names. Recovered network/game classes:

| Class | Role |
|---|---|
| `NetworkManager` | outbound socket + REST client (`connectToServer`, `emitTableInit`, `emitTurnTriggerTimerPlusTen`, `emitCheckRunningGame`, `sendChatOrGift`, `getUserDataREST`, `assignSocketAfterReconnect`, â€¦) |
| `NetworkEventHandler` | **inbound** event handlers (`onTableInit`, `onthrowDice`/`onThrowDiceSNL`, `onUserAction`, `onTimer`, `setTriggerTimer`, `gameFinished`, `onLeave`, `setResumeGameData`, `emitForResumeTableInit`, `onGift`, `onPresetChat`, `onCustomChat`, â€¦) |
| `NetworkActionsReceived` | applies inbound actions (`onDiceRoll`, `onTokenClicked`) |
| `TurnHandler` | `initGame`, `activateTurn`, `isPlayerWon`, `showGameWin` |
| `SetBoardData` | `setTableData`, `setPosition`, `setTokenPositionAndScale`, `setCrown`, `onGameFinished`, `emitPingPong` |
| `PlayersSetup` | `initGame`, `initPlayerData`, `emitForLateJoining`, `initLocalPlayerData`, `setPlayerName` |
| `Player` | `initData`, `getActiveTokens`, `moveNetworkToken`, `setTableData` |
| `Token` | `initData`, `setActive`, `emitTokenClicked`, `decideActivation`, `setTableData` |
| `Dice` | `onDiceRoll`, `setDiceValue`, `enableDice`, `disableDice` |
| `MoveAction` | `moveObject`, `onStepMoveComplete`, `backtrackMove` |
| `UIButtonHandler` | menu routing: `onClickOnlineMultiplayer`, `onClickLocalMultiplayer`, `onClickPrivateMultipayer`, `onClickPublicMultiPlayerPlay`, `onClickComputer`, â€¦ |
| `GameWinHandler` | `showGameWin`, `showGameWinMP` |

## 2. The online mode is gated on Google login

`window.isUserGLoggedIn` is a boolean, `false` in the local clone. Calling
`UIButtonHandler.onClickOnlineMultiplayer()` with it `true` advances the menu to
the **"Connecting to server..."** state. With it `false` the handler is a no-op
(matches the README: the login provider is intentionally absent).

Even with the flag forced, no socket/REST request is issued: the flow expects a
completed Google sign-in to populate the user profile first, which the stub does
not produce.

## 3. Transport = Socket.IO 1.x + AES-CBC payloads

- `public/play/src/assets/scripts/socket.io.f7b34.js` is a UMD socket.io v1
  client that installs `window.io` (`io.protocol === 4`).
- Config (`NetworkManager`): `LKServerIP=services.ludokingapi.com`,
  `LKLoginAPI=misc-services.ludokingapi.com`, plus staging/dev hosts. Keys
  `isLive`, `serverType`, `globalURL`.
- The server URL is taken from a decrypted static config:
  `staticJsonData.server_config.configs[N].socketUrl`, and the client appends
  `socketVerCode`.
- Message bodies are **AES-CBC encrypted** (`aesjs`) and sent as
  `socket.emit(EVENT, {data: fnAesEncrypt(payload)})`. `fnAesEncrypt` /
  `fnAesDecrypt` pick a key/IV pair by a 16-char id embedded at
  `blob.substr(1,16)` / `blob.substr(17,16)`; the key and IV tables are local to
  the bundle's crypto module.

## 4. Recovered protocol vocabulary (decoded string table, 9717 strings)

Socket events / server action tags:

```
STARTGAME  DICEROLL  TOKENMOVE  TOKENKILL  TOKENHOME  SKIPPED  WIN
JOIN_LUDO_*  LUDO_Public  LUDO_Private  LUDO_lobby  LUDO_PMP_l*  LUDO_UNDO_*
```

REST routes / paths: `/socket.io`, `/get/LK/`, `/list`, `/challenge`,
`/count?gam*`, `/player/fi*`, `/player/pr*`, `/report/cl*`, `/rv/chips`,
`/utility/u*`, `/onlinePla*`, `/picture?w*`.

State / payload fields:

```
_tableId  _userId  _token  authToken  socketUrl  socketVerCode
aPlayers  aTokens  aLastGame  userData  userProfile
iTurnId  myTurnID  nTurns  playerTurn  isLastTurn
bDiceRolled  dicevalue  lastDiceValue  myDiceValue  DICEROLL
tokenColor  bTokenMoved  playerType  playerCode  nTokenCaptured
nGameToken  bTableFinished  bGameCompleted  bResumeGame  bPingPong
won_game  lost_game  MatchMaking  gameTypeP*  GameMode  GAME_TYPE
```

Mode blobs stored in `localStorage`:

```json
PMPModeData        = {"gameType":0,"tokenColor":0,"nPlayers":2,"lobby":0}
PRIVATEMPModeData  = {"gameType":0,"tokenColor":0,"lobby":0}
COMPUTERModeData   = {"tokenColor":0,"nPlayers":4}
GAME_TYPE          = "LUDO"
LAST_TABLE_ID      = <id>
STATIC_JSON_DATA_<v> = <AES base64 blob>
```

## 4b. Crypto recovered at runtime (decisive)

Hooking `aesjs.ModeOfOperation.cbc` and `aesjs.utils.utf8.toBytes` in the page
yielded the real socket-message crypto:

- **AES-128-CBC key** (ASCII): `OIgV0wAjxgb08Wq1`
- **IV** (bytes): `15 16 17 18 19 1a 1b 1c 1d 1e 1f 20 21 22 23 24`

Message framing: `socket.emit(EVENT, {data: <AES-CBC ciphertext, base64>})`.

The decrypted static config (from `localStorage.STATIC_JSON_DATA_*`, format
`[1 selector][16 key-id][16 iv-id][base64 ct]`) contains the full server list,
including a **native local-server entry**:

```json
{"server_config":{"configs":[
  {"comment":"production","serverType":0,"httpType":"https","socketUrl":"services.ludokingapi.com","socketVerCode":7,"loginUrl":"misc-services.ludokingapi.com","loginVerCode":3},
  {"comment":"staging","serverType":1,...},
  {"comment":"development","serverType":2,...},
  {"comment":"local","serverType":3,"httpType":"http","socketUrl":"192.168.1.31:3001","socketVerCode":7,"loginUrl":"192.168.1.31:3001","loginVerCode":7}
]}}
```

So the original client natively speaks plain `http` Socket.IO to a
`host:port` when `serverType === 3`. That is the hook for a local server.

## 4c. The connect path is gated on a completed login

`UIButtonHandler.onClickOnlineMultiplayer()`:

- `isUserGLoggedIn === false` â†’ handler is a **no-op**.
- `isUserGLoggedIn === true` â†’ advances the menu to the **"Connecting to
  server..."** state.

But with the flag forced true, **no socket, XHR or WebSocket to any backend is
ever attempted** (only `/local-config` is fetched). The connect call
(`NetworkManager.connectToServer`) is not reached because the flow waits on a
user profile (id / `authToken`) that only a completed sign-in populates. Values
are read through a **module-scope singleton** (not reachable as a component or
window global), which is why page-level probing cannot force it.

**Verified by probe:** `tools/re/trace-connect.mjs` â€” 114 requests on the online
flow, none to a socket backend.

## 5. What this means for building netplay

The client's networking is a **complete, recoverable request/response surface**:
outbound via `NetworkManager` socket emits, inbound via `NetworkEventHandler`
handlers. The genuine server protocol is Socket.IO + AES-CBC with server-side
authority, but the *client* does not verify the server's identity or signature â€”
it only decrypts `{data:...}` with a key embedded in the bundle.

Two viable build paths (see plan): replicate the encrypted Socket.IO protocol
against a local authoritative server, or bypass the crypto and drive the
client's own `NetworkEventHandler` handlers with plaintext messages over a local
socket. Both keep the original visuals and logic.

