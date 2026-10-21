import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptBlob,encryptBlob} from './tools/crypto-check.mjs';
import socketio from 'socket.io';
import {attachGameServer} from './game/socket-bridge.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.mp3':'audio/mpeg','.wav':'audio/wav','.ico':'image/x-icon'};
// Deterministic guest display name derived from the local guest id.
export function guestName(gid){return 'Player-'+String(gid||'local').replace(/^guest-/i,'').slice(0,4).toUpperCase();}
// Stable numeric identity for the guest id (the socket protocol carries numbers).
export function guestNumericId(gid){let h=0;for(const ch of String(gid||'guest-local'))h=(h*31+ch.charCodeAt(0))%1000000;return 100000+(h%900000);}
// Resolve the guest id for a request: explicit ?gid= wins, else the lk_guest cookie.
function guestIdFrom(url,req){
  const q=url.searchParams.get('gid');
  if(q) return q;
  const m=/(?:^|;\s*)lk_guest=([^;]+)/.exec(req.headers.cookie||'');
  return m?decodeURIComponent(m[1]):null;
}
export function createCloneServer(){return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; frame-src 'none'; form-action 'none'");
  try{
    const url=new URL(req.url,'http://local');
    // Native local API surface. The guest adapter points the client's
    // `microURI` at this origin, so the client calls the real paths
    // (/api/vN/...) and they land here — no third-party host is ever contacted.
    if(url.pathname==='/api/v3/auth/h5google'&&req.method==='POST'){
      const chunks=[];for await(const c of req)chunks.push(c);
      const raw=Buffer.concat(chunks).toString('utf8');
      let reqFields={};
      try{
        let blob=raw;
        try{const j=JSON.parse(raw);if(j&&typeof j.data==='string')blob=j.data;}catch{}
        reqFields=decryptBlob(blob);
      }catch{console.log('[api/auth] undecryptable:',raw.slice(0,300));}
      const gid=reqFields.gid||'guest-local';
      const num=guestNumericId(gid);
      const response={
        ...reqFields,
        _id:num,_userId:num,userId:num,
        sName:reqFields.sName||guestName(gid),sImage:reqFields.sImage||'',sCountryCode:0,
        name:reqFields.sName||guestName(gid),image:'',country:'',gid,
        LCL:'1000',LCW:'1000',coins:1000,chips:1000,xp:0,level:1,
        nTotalChips:1000,nTotalGems:0,nExp:0,nLevel:1,
        nLUDORatings:0,nLUDOWinStats:0,nTokenCaptured:0,
        eNoAds:'0',eVideoPack:'0',nTempChipsLimit:0,nChipsVideoCap:0,
      };
      console.log('[api/auth] guest %s (%s)',gid,num);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(encryptBlob(response));
    }
    if(/^\/api\/v\d+\/player\/profile/.test(url.pathname)){
      const gid=guestIdFrom(url,req)||'guest-local';
      const num=guestNumericId(gid);
      const profile={
        _id:num,LKID:num,sName:guestName(gid),sImage:'',sCountryCode:0,gid,
        nChips:1000,LCL:'1000',LCW:'1000',coins:1000,chips:1000,
        nChipsVideoCap:0,xp:0,level:1,
        nTotalChips:1000,nTotalGems:0,
        nExp:0,nLevel:1,nLUDORatings:0,nLUDOWinStats:0,nTokenCaptured:0,
        eNoAds:'0',eVideoPack:'0',nTempChipsLimit:0,
      };
      console.log('[api/profile] gid=%s',gid);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(encryptBlob(profile));
    }
    if(/^\/api\/v\d+\/utility\/utcTime/.test(url.pathname)){
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
      return res.end(String(Date.now()));
    }
    if(url.pathname==='/local-utc'){
      // getUTCTimeStamp stores responseText RAW and emits {data} — plain epoch ms.
      console.log('[local-utc] %s',req.method);
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
      return res.end(String(Date.now()));
    }
    if(url.pathname==='/local-profile'){
      // getUserDataREST: fnAesDecrypt(responseText) -> _2f957a.serverUserData
      // Field names recovered from the bundle: getUserDataREST assigns the whole
      // decrypted object to `serverUserData`, and the UI reads
      // `serverUserData.nTotalChips.toLocaleString()` (crashes when missing).
      // The guest adapter passes its id as ?gid=... so profile and socket agree.
      const gid=url.searchParams.get('gid')||'guest-local';
      const profile={
        _id:guestNumericId(gid),LKID:guestNumericId(gid),
        sName:guestName(gid),sImage:'',sCountryCode:0,
        gid,
        nChips:1000,LCL:'1000',LCW:'1000',coins:1000,chips:1000,
        nChipsVideoCap:0,xp:0,level:1,
        // serverUserData numeric fields read by lobby/profile UI
        nTotalChips:1000,nTotalGems:0,
        nExp:0,nLevel:1,nLUDORatings:0,nLUDOWinStats:0,nTokenCaptured:0,
        eNoAds:'0',eVideoPack:'0',nTempChipsLimit:0,
      };
      console.log('[local-profile] %s -> %s',req.method,JSON.stringify(profile));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(encryptBlob(profile));
    }
    if(req.method==='POST'&&url.pathname==='/local-auth'){
      const chunks=[];for await(const c of req)chunks.push(c);
      const raw=Buffer.concat(chunks).toString('utf8');
      let reqFields={};
      try{
        // Client wraps the encrypted blob as JSON: {"data": "<kid+iid+base64>"}
        let blob=raw;
        try{const j=JSON.parse(raw);if(j&&typeof j.data==='string')blob=j.data;}catch{}
        reqFields=decryptBlob(blob);
        console.log('[local-auth] request:',JSON.stringify(reqFields));
      }
      catch{console.log('[local-auth] undecryptable request:',raw.slice(0,400));}
      const response={
        ...reqFields,
        _userId:reqFields.gid||reqFields._userId||1001,userId:reqFields.gid||reqFields._userId||1001,
        sName:reqFields.sName||'Guest',sImage:reqFields.sImage||'',sCountryCode:reqFields.sCountryCode??0,
        name:reqFields.sName||'Guest',image:'',country:'',
        LCL:'1000',LCW:'1000',coins:1000,chips:1000,
        xp:0,level:1,
      };
      console.log('[local-auth] response:',JSON.stringify(response));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(encryptBlob(response));
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    if(url.pathname==='/unavailable-service') {res.writeHead(501,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'External service not reconstructed.'}));}
    const relative=url.pathname==='/local-config' ? '/config.json' : ['/','/play/','/play/index.html'].includes(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
    const path=resolve(root,'.'+relative);
    if(!path.startsWith(root+sep)){res.writeHead(404);return res.end();}
    let data=await readFile(path);
    if(relative==='/play/assets/main/index.606d4.js') {
      const redirect='_0x444c3b[_0x36d6d8][_0x12d343]=_0x2f86b3;';
      const source=data.toString();
      if(source.split(redirect).length!==2) throw new Error('Original-client redirect signature changed. Reinspect before serving.');
      // Keep the archived file byte-identical. Serve it with a lexical Window
      // facade so its original hosting checks/navigation cannot leave localhost.
      // This exact assignment was observed in the beforeunload debugger stack.
      const local=source.replace(redirect,"window.__localEvents.push({type:'blocked-navigation',detail:'observed-host-redirect'});");
      data=Buffer.from('(function(window){\n'+local+'\n})(window.__localClientWindow);\n');
    }
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createCloneServer();
  const PORT=Number(process.env.PORT||8788);
  const io=socketio(server,{path:'/v7/socket.io',pingInterval:25000,pingTimeout:60000});
  // Resolve the original client's numeric player id from the local guest
  // adapter; the captured lobby payload does not include the player identity.
  attachGameServer(io,{
    log:console,
    // Per-tab id from the handshake query (set by compat.js); the cookie is only
    // a fallback because it is shared by every tab of a browser profile.
    resolveUser:(handshake)=>{
      const fromQuery=handshake?.query?.gid;
      const m=/(?:^|;\s*)lk_guest=([^;]+)/.exec(handshake?.headers?.cookie||'');
      const raw=typeof fromQuery==='string'?fromQuery:(m?decodeURIComponent(m[1]):null);
      if(!raw||!/^guest-[a-z0-9]{1,16}$/i.test(raw)) return null;
      return {gid:raw,userId:guestNumericId(raw),sName:guestName(raw)};
    },
  });
  server.listen(PORT,'0.0.0.0',()=>console.log('Original-client local study: http://127.0.0.1:'+PORT+' (socket path /v7/socket.io)'));
}
