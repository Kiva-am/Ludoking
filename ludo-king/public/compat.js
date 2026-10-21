// Local adapters only: original Cocos scenes, sprites and rules stay intact.
// No external requests, account credentials, tracking scripts or production sockets.
(() => {
  const origin = location.origin;
  window.__localEvents = [];
  // One-click local guest identity: generated once per tab, no prompt, no
  // real account. The id is shared by the REST profile, the socket session and
  // the table so all three agree.
  // Per-tab: sessionStorage is not shared between tabs, so two local tabs are
  // two players. A reload of the same tab keeps its id.
  const guestId = (() => {
    let id = null;
    try { id = sessionStorage.getItem('lk.localGuestId'); } catch {}
    if (!id) {
      id = 'guest-' + Math.random().toString(16).slice(2, 6);
      try { sessionStorage.setItem('lk.localGuestId', id); } catch {}
    }
    return id;
  })();
  window.__localGuestId = guestId;
  // The captured client stores its current table globally. Two tabs finishing
  // the same match can otherwise clear each other's table before the final
  // event is handled. Keep match navigation state in the tab's session store.
  const matchKeys = new Set(['LAST_TABLE_ID', 'LAST_ONLINE_MODE']);
  const storageGet = Storage.prototype.getItem;
  const storageSet = Storage.prototype.setItem;
  const storageRemove = Storage.prototype.removeItem;
  Storage.prototype.getItem = function (key) {
    return storageGet.call(this === localStorage && matchKeys.has(String(key)) ? sessionStorage : this, key);
  };
  Storage.prototype.setItem = function (key, value) {
    return storageSet.call(this === localStorage && matchKeys.has(String(key)) ? sessionStorage : this, key, value);
  };
  Storage.prototype.removeItem = function (key) {
    return storageRemove.call(this === localStorage && matchKeys.has(String(key)) ? sessionStorage : this, key);
  };
  window.__localGuestName = 'Player-' + guestId.replace(/^guest-/, '').toUpperCase();
  // Also expose the guest id as a cookie so requests the client builds without a
  // query string (e.g. GET /api/vN/player/profile) still resolve one identity.
  try { document.cookie = 'lk_guest=' + encodeURIComponent(guestId) + ';path=/;SameSite=Lax'; } catch {}
  // The socket protocol carries a numeric `_userId`; derive a stable integer from
  // the guest id so REST profile, socket session and table all use one identity.
  window.__localGuestNum = (() => {
    let h = 0;
    for (const ch of guestId) h = (h * 31 + ch.charCodeAt(0)) % 1000000;
    return 100000 + (h % 900000);
  })();
  // Send the guest id in every Socket.IO handshake. Cookies are shared by all
  // tabs of one browser profile and are per host (localhost != 127.0.0.1), so
  // they cannot identify a player on their own. The client's socket.io is a
  // UMD that assigns window.io, so wrap it on assignment.
  let realIo;
  Object.defineProperty(window, 'io', {
    configurable: true,
    enumerable: true,
    get() { return realIo; },
    set(fn) {
      realIo = typeof fn === 'function' ? new Proxy(fn, {
        apply(target, self, args) {
          const [uri, opts] = args;
          const next = {...(opts || {})};
          next.query = {...(next.query || {}), gid: guestId};
          // The client's static config can still hold the captured LAN host
          // (192.168.1.31:3001) when it connects, and that host is blocked. Always
          // use the origin this page was served from (localhost or 127.0.0.1).
          let host = uri;
          try { if (new URL(String(uri), location.href).host !== location.host) host = location.origin; } catch { host = location.origin; }
          const socket = Reflect.apply(target, self, [host, next, ...args.slice(2)]);
          socket.on('localLobbyCounts', counts => {
            window.__localLobbyCounts = counts;
            window.dispatchEvent(new CustomEvent('local-lobby-counts', {detail: counts}));
          });
          return socket;
        },
      }) : fn;
    },
  });
  const record = (type, detail) => {
    window.__localEvents.push({type, detail, at:Date.now()});
    if (window.__localEvents.length > 100) window.__localEvents.shift();
  };
  function map(raw) {
    try {
      const url = new URL(raw, location.href);
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') return raw;
      if (url.pathname === '/api/v2/json/get/LK/1.0/7') return '/local-config';
      // Guest login: the h5google sign-in REST is served locally (never the
      // real misc-services host). See POST /local-auth in server.mjs.
      if (/^\/api\/v\d+\/auth\/h5google$/.test(url.pathname)) return '/local-auth';
      if (/^\/api\/v\d+\/utility\/utcTime$/.test(url.pathname)) return '/local-utc';
      if (/^\/api\/v\d+\/player\/profile$/.test(url.pathname)) return '/local-profile';
      record('blocked-request', url.origin + url.pathname);
      return '/unavailable-service';
    } catch { return raw; }
  }
  // Guest proxy: the profile endpoint gets the guest id so the REST profile and
  // the socket session agree on one identity.
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method,url,...rest) {
    let mapped = map(String(url));
    try {
      const u = new URL(mapped, location.href);
      const isProfile = u.pathname === '/local-profile' || /^\/api\/v\d+\/player\/profile$/.test(u.pathname);
      if (isProfile && !u.searchParams.get('gid')) {
        u.searchParams.set('gid', guestId);
        // Same-origin requests are passed through untouched by map(); keep the
        // guest id attached so profile and socket share one identity.
        if (u.origin === origin) mapped = u.pathname + u.search;
      }
    } catch {}
    return originalOpen.call(this, method, mapped, ...rest);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input,options) => originalFetch(typeof input === 'string' || input instanceof URL ? map(String(input)) : new Request(map(input.url),input),options);
  navigator.sendBeacon = () => true;
  window.open = () => { record('blocked-navigation','popup'); return null; };
  const originalSocket = window.WebSocket;
  window.WebSocket = class extends originalSocket {
    constructor(url,protocols) {
      const target = new URL(url,location.href);
      // Local netplay study: allow loopback sockets (the local room/match server),
      // still block every external backend.
      const isLoopback = ['127.0.0.1','localhost','::1'].includes(target.hostname);
      if (target.host !== location.host && !isLoopback) {
        record('blocked-socket',target.origin+target.pathname);
        throw new Error('External sockets are disabled. Use this server origin for local multiplayer.');
      }
      super(url,protocols);
    }
  };
  const facadeLocation = new Proxy({}, {
    get(_,key) {
      if (key === 'hostname' || key === 'host') return 'ludoking.com';
      if (key === 'origin') return 'https://ludoking.com';
      if (key === 'href' || key === 'toString') return key === 'toString' ? ()=>'https://ludoking.com/play/' : 'https://ludoking.com/play/';
      if (key === 'assign' || key === 'replace' || key === 'reload') return ()=>record('blocked-navigation','client redirect');
      const value = location[key];
      return typeof value === 'function' ? value.bind(location) : value;
    },
    set(_,key) { record('blocked-navigation',String(key)); return true; }
  });
  let facade;
  facade = new Proxy(window, {
    get(target,key) {
      if (key === 'location') return facadeLocation;
      if (['window','self','top','parent'].includes(key)) return facade;
      const value = Reflect.get(target,key,target);
      return ['addEventListener','removeEventListener','dispatchEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval','atob','btoa'].includes(key) && typeof value === 'function' ? value.bind(target) : value;
    },
    set(target,key,value) { return Reflect.set(target,key,value,target); }
  });
  window.__localClientWindow = facade;
  window.adsbygoogle = [];
  window.adConfig = () => {};
  window.adBreak = options => {
    record('local-ad-skip',options?.type || 'ad');
    if (options?.adBreakDone) setTimeout(()=>options.adBreakDone({breakStatus:'notReady'}),0);
  };
  window.gtag = () => {};
  window.isUserGLoggedIn = false;
  window.onClickLoginCloseBtn = () => { document.getElementById('glogincont').style.display='none'; };
  // Guest sign-in: builds a locally-signed (alg:none) guest JWT and hands it to
  // the original SessionManager, so the client runs its own login flow against
  // the local endpoints. No Google, no third-party call.
  window.localGuestLogin = () => {
    const cc = window.cc;
    if (!cc || !cc.director) return false;
    let token;
    try {
      const base64url = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      token = base64url({alg:'none', typ:'JWT'}) + '.' +
        base64url({sub: guestId, name: window.__localGuestName, picture: '', email: 'guest@local',
          lkId: window.__localGuestNum}) + '.local';
    } catch { return false; }
    // NetworkManager / SessionManager live on the Canvas/NetworkManager node.
    const scene = cc.director.getScene();
    if (!scene) return false;
    const canvas = scene.getChildByName('Canvas');
    const nmNode = canvas && canvas.getChildByName('NetworkManager');
    if (!nmNode) return false;
    const nm = nmNode._components.find(c => typeof c.connectToServer === 'function');
    const sm = nmNode._components.find(c => typeof c.loginCall === 'function');
    if (!nm || !sm) return false;
    window.isUserGLoggedIn = true;
    // Point the client at this same origin: one server serves assets, REST and
    // the authoritative socket, so online play stays on loopback/LAN.
    nm.serverType = 3;
    nm.globalURL = location.origin;
    sm.microURI = location.origin + '/api/v3';
    sm.serverLoginAPIForFB = '/auth/h5google';
    record('guest-login', guestId);
    try { sm.loginCall(token); } catch (e) { record('guest-login-error', String(e)); return false; }
    return true;
  };
  // Auto-run once the game scene is up so "Play as Guest" needs no prompt.
  const autoGuest = setInterval(() => {
    if (window.__localGuestStarted) { clearInterval(autoGuest); return; }
    if (window.localGuestLogin && window.localGuestLogin()) {
      window.__localGuestStarted = true;
      clearInterval(autoGuest);
    }
  }, 250);
  setTimeout(() => clearInterval(autoGuest), 60000);
})();
