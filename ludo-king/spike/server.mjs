// Spike: local socket.io server that mimics the Ludo King game server enough to
// observe what the original client sends. Logs every connection, event and ack.
// Also serves the login REST endpoint (/api/vN/auth/h5google) locally so the
// client's sign-in flow NEVER touches misc-services.ludokingapi.com.
import {createServer} from 'node:http';
import socketio from 'socket.io';
import {decryptBlob, encryptBlob} from '../tools/crypto-check.mjs';

const PORT = Number(process.env.PORT || 3001);
// Response returned to the client for the h5google login REST call.
// Override with LOGIN_RESPONSE='{"key":...}' env var for experiments.
const LOGIN_RESPONSE = process.env.LOGIN_RESPONSE
  ? JSON.parse(process.env.LOGIN_RESPONSE)
  : {
      // Fill in real fields as discovered; encrypted before sending.
      _userId: 1001,
      sName: 'Player 8F3A',
      sImage: '',
    };

const CORS = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:8788',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Accept, Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8',
};

const http = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.method === 'OPTIONS') {
      console.log('[http] OPTIONS %s', req.url);
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    // Login REST: /api/v{N}/auth/h5google
    if (/^\/api\/v\d+\/auth\/h5google$/.test(req.url) && req.method === 'POST') {
      console.log('[http] POST %s bodyLen=%d', req.url, body.length);
      try {
        const dec = decryptBlob(body);
        console.log('[http] login request (decrypted): %s', JSON.stringify(dec));
      } catch (e) {
        console.log('[http] login request (raw, undecryptable): %s', body.slice(0, 500));
      }
      const blob = encryptBlob(LOGIN_RESPONSE);
      console.log('[http] login response (plaintext): %s', JSON.stringify(LOGIN_RESPONSE));
      res.writeHead(200, CORS);
      res.end(blob);
      return;
    }
    // Minimal REST surface the client might poke at. Log it.
    console.log('[http]', req.method, req.url, 'bodyLen=' + body.length);
    if (body) console.log('[http] body: %s', body.slice(0, 400));
    res.writeHead(200, CORS);
    res.end(JSON.stringify({status: 'ok'}));
  });
});

const io = socketio(http, {path: '/v7/socket.io', pingInterval: 25000, pingTimeout: 60000});
io.on('connection', (socket) => {
  console.log('[socket.io] connection id=%s transport=%s', socket.id, socket.conn.transport.name);
  // socket.io 1.x: intercept the internal packet dispatcher to observe EVERY
  // inbound event, even ones with no registered server handler.
  const origOnevent = socket.onevent.bind(socket);
  socket.onevent = function(packet) {
    const data = packet.data || [];
    console.log('[recv] %s %s', data[0], truncate(data.slice(1)));
    origOnevent(packet);
  };
  // Observe server->client emits too.
  const origEmit = socket.emit.bind(socket);
  socket.emit = function(event, ...args) {
    console.log('[send] %s %s', event, truncate(args));
    return origEmit(event, ...args);
  };
  socket.on('disconnect', (reason) => console.log('[socket.io] disconnect %s (%s)', socket.id, reason));
});

function truncate(a) {
  try { return JSON.stringify(a).slice(0, 1200); }
  catch { return String(a).slice(0, 300); }
}

http.listen(PORT, '0.0.0.0', () => console.log('[spike] listening on http://127.0.0.1:' + PORT));
