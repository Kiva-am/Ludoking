# Ludo King: original-client local multiplayer

This project runs the captured Cocos Creator client with its original scenes,
artwork, board, dice, token animations, sounds, and computer opponents. A Node
server supplies local guest profiles and multiplayer matches.

## Run

Requires Node.js 22 or newer. The captured assets are already in `public/play/`.

```sh
npm install
npm start
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
Open **http://127.0.0.1:8788/**. Guest sign-in happens automatically; dismiss the
original empty Login dialog if it appears. No Google account is needed.

## Play multiplayer

1. Open a separate tab for each player, or open the server from other devices on
   the same LAN. Each tab has its own guest identity; reloading retains it.
2. Choose **Online**, select **2 players** or **4 players**, and choose a lobby.
3. Press **Play** in each tab. Players with the same lobby and player count are
   matched together. A match starts when all seats are filled.
4. Dismiss the first-game turn-skip explanation, then click the dice and an
   available token. The client can move automatically when only one choice exists.

For LAN play, use the host machine's LAN address with port 8788 on every device.
The server currently binds to `0.0.0.0`; local firewall settings determine LAN
access. Set `PORT` to change the port. Computer mode remains available from the
original menu.

The server owns dice, legal moves, captures, safe cells, blocked cells, extra
turns, and rankings. A six releases a token; home requires an exact roll. Three
consecutive sixes forfeit the roll. Turns last 15 seconds by default
(`TURN_SECONDS` overrides this). Timeouts automatically roll/move or pass; the
fifth missed turn removes the player. A disconnected player has 30 seconds to
reconnect while another player remains connected. Fully abandoned matches are
removed immediately.

## Implementation

- `server.mjs`: static assets, encrypted guest/profile REST endpoints, Socket.IO
  at `/v7/socket.io` on the same origin.
- `game/room.mjs`: in-memory rooms and authoritative Ludo rules.
- `game/socket-bridge.mjs`: the original client's encrypted event protocol,
  matchmaking, timers, reconnects, and match completion.
- `public/compat.js`: local request routing, guest identity, and per-tab match
  storage. External provider services, ads, analytics, and popups are blocked.
- `public/multiplayer.js`: requests dice before animation completion, waits for
  their authoritative values, restricts token activation to legal choices, and
  updates local lobby counts.

The archived bundle stays unchanged on disk. Its served response replaces the
single observed host-redirect assignment and wraps the bundle in a local Window
facade. Other adaptations are separate scripts. See [protocol notes](docs/MULTIPLAYER.md).

## Verification

```sh
npm test
npm run test:multiplayer
npm run test:multiplayer:four
```

Browser tests use installed Chrome by default. Set `BROWSER_PATH` to another
Chromium executable. Each test owns an isolated server and browser profile;
no separately running server or external reference site is required.

The browser harness uses tabs sharing cookies and localStorage, enters the
original Online flow, clicks real dice/tokens, verifies synchronized tables,
reloads a player, and checks the original result screens. Its final-state test
seeds a near-finish **server fixture**; it does not play an entire random match.
Reports and screenshots are written to `test-results/`.

`npm run test:visual` is the older bot/reference comparison and requires a
running local server plus access to the live reference site. Its historical
1440x900 captures had identical canvas bounds and 92.7-96.8% exactly equal
pixels, with animation-phase differences. Pixel equality across every screen
has not been established.

## Scope

Public two-player and four-player matches are supported locally. Private-room
creation, code separation, and host start exist at the protocol layer; their
original menu/invitation flow has not been validated end to end. Chat, gifts,
accounts, purchases, undo mode, and the production provider backend are not
reconstructed. Match state and guest balances are temporary and reset when the
server restarts; balances are local display values rather than a persistent
wallet.

To recreate the asset capture from a separate source tree, run
`python tools/prepare.py <capture-assets-directory>`. The preparation script
copies game files and public configuration, downloads manifest-listed missing
public assets, and records hashes in `asset-manifest.json`. It does not import
captured cookies, credentials, or HTTP headers. Existing historical capture
notes are retained in `docs/ONLINE-MULTIPLAYER-FINDINGS.md`.

Captured code, artwork, fonts, and trademarks belong to third parties. This is
for local study; redistribution rights have not been established. The server
uses local guest identities and is not an authenticated public hosting service.
