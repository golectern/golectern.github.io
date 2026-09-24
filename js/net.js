/* Lectern — live connection layer (WebRTC via PeerJS; no account or server of your own needed) */
(function (H) {
  'use strict';
  const PREFIX = 'myhub-v1-';

  function peerOptions() {
    const o = { debug: 1 };
    const cfg = (H.CONFIG && H.CONFIG.peerServer) || H.settings.get('peerServer', null);
    // ?peer=host:port lets you point at a self-hosted PeerServer (used for testing too)
    const qp = new URLSearchParams(location.search).get('peer');
    const srv = qp ? { host: qp.split(':')[0], port: +(qp.split(':')[1] || 9000), path: '/', secure: false } : cfg;
    if (srv && srv.host) Object.assign(o, srv);
    o.config = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      ].concat((H.CONFIG && H.CONFIG.extraIce) || []),
      sdpSemantics: 'unified-plan',
    };
    return o;
  }

  /** Presenter side. handlers: onOpen(code), onConn(conn), onData(conn,msg), onClose(conn), onError(err), onStatus(s) */
  // PeerJS JSON channels refuse messages over ~16 KB, so bigger ones are split and re-joined here.
  const CHUNK = 14000;
  function sendRaw(conn, msg) {
    const s = JSON.stringify(msg);
    if (s.length <= CHUNK) { conn.send(msg); return; }
    const id = Math.random().toString(36).slice(2, 10), n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) conn.send({ t: '__c', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  function unchunk(conn, d) {
    if (!d || d.t !== '__c') return d;
    const box = (conn._chunks = conn._chunks || {});
    const c = (box[d.id] = box[d.id] || { parts: [], got: 0 });
    c.parts[d.i] = d.d; c.got++;
    if (c.got < d.n) return null;
    delete box[d.id];
    try { return JSON.parse(c.parts.join('')); } catch (e) { return null; }
  }
  H.net = {};
  H.net.host = function (code, handlers) {
    const conns = new Map();
    let peer, closed = false, retry = 0;
    const self = {
      code, conns,
      send(conn, msg) { try { if (conn && conn.open) sendRaw(conn, msg); } catch (e) { console.warn('send failed', e); } },
      broadcast(role, msg) { conns.forEach((c) => { if (!role || c.metadata && c.metadata.role === role) self.send(c, msg); }); },
      count(role) { let n = 0; conns.forEach((c) => { if (c.open && (!role || c.metadata && c.metadata.role === role)) n++; }); return n; },
      close() { closed = true; clearInterval(ping); try { peer && peer.destroy(); } catch (e) { /* ignore */ } },
    };
    function start() {
      peer = new window.Peer(PREFIX + self.code, peerOptions());
      peer.on('open', () => { retry = 0; handlers.onStatus && handlers.onStatus('online'); handlers.onOpen && handlers.onOpen(self.code); });
      peer.on('connection', (conn) => {
        conn._last = Date.now();
        conn.on('open', () => { conns.set(conn.connectionId, conn); handlers.onConn && handlers.onConn(conn); });
        conn.on('data', (d) => {
          conn._last = Date.now();
          d = unchunk(conn, d);
          if (!d) return;
          if (d && d.t === 'pong') return;
          handlers.onData && handlers.onData(conn, d);
        });
        const gone = () => { if (conns.delete(conn.connectionId)) handlers.onClose && handlers.onClose(conn); };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      peer.on('disconnected', () => {
        if (closed) return;
        handlers.onStatus && handlers.onStatus('reconnecting');
        setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } }, 1500);
      });
      peer.on('error', (err) => {
        if (closed) return;
        if (err.type === 'unavailable-id') {
          // Same code is still held by an old tab or the server hasn't released it yet
          if (retry++ < 2) { try { peer.destroy(); } catch (e) { /* ignore */ } setTimeout(start, 3000); return; }
          self.code = H.code();
          try { peer.destroy(); } catch (e) { /* ignore */ }
          handlers.onCodeChange && handlers.onCodeChange(self.code);
          retry = 0; setTimeout(start, 200); return;
        }
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          handlers.onStatus && handlers.onStatus('offline');
          setTimeout(() => { if (!closed) { try { peer.destroy(); } catch (e) { /* ignore */ } start(); } }, 4000);
          return;
        }
        handlers.onError && handlers.onError(err);
      });
    }
    // heartbeat: drop phones that vanished (locked screens, lost wifi)
    const ping = setInterval(() => {
      const now = Date.now();
      conns.forEach((c) => {
        if (now - c._last > 25000) { try { c.close(); } catch (e) { /* ignore */ } if (conns.delete(c.connectionId)) handlers.onClose && handlers.onClose(c); }
        else self.send(c, { t: 'ping' });
      });
    }, 5000);
    start();
    return self;
  };

  /** Phone side. handlers: onOpen(), onData(msg), onStatus(s) */
  H.net.join = function (code, meta, handlers) {
    let peer, conn, closed = false, timer;
    const self = {
      send(msg) { try { if (conn && conn.open) { sendRaw(conn, msg); return true; } } catch (e) { console.warn('send failed', e); } return false; },
      get open() { return !!(conn && conn.open); },
      close() { closed = true; clearTimeout(timer); try { peer && peer.destroy(); } catch (e) { /* ignore */ } },
      meta,
    };
    const status = (s) => handlers.onStatus && handlers.onStatus(s);
    function connect() {
      if (closed) return;
      clearTimeout(timer);
      status('connecting');
      conn = peer.connect(PREFIX + code, { metadata: meta, reliable: true, serialization: 'json' });
      const c = conn;
      const to = setTimeout(() => { if (!c.open) { try { c.close(); } catch (e) { /* ignore */ } retry(); } }, 12000);
      c.on('open', () => { clearTimeout(to); status('online'); handlers.onOpen && handlers.onOpen(); });
      c.on('data', (d) => {
        d = unchunk(c, d);
        if (!d) return;
        if (d && d.t === 'ping') { try { c.send({ t: 'pong' }); } catch (e) { /* ignore */ } return; }
        handlers.onData && handlers.onData(d);
      });
      c.on('close', () => { clearTimeout(to); if (c === conn) retry(); });
      c.on('error', () => { clearTimeout(to); if (c === conn) retry(); });
    }
    function retry() { if (closed) return; status('reconnecting'); clearTimeout(timer); timer = setTimeout(ensurePeer, 2500); }
    function ensurePeer() {
      if (closed) return;
      if (peer && !peer.destroyed && !peer.disconnected && peer.open) return connect();
      try { peer && peer.destroy(); } catch (e) { /* ignore */ }
      peer = new window.Peer(peerOptions());
      peer.on('open', connect);
      peer.on('error', (err) => {
        if (closed) return;
        if (err.type === 'peer-unavailable') { status('nohost'); retry(); return; }
        retry();
      });
      peer.on('disconnected', () => { if (!closed) retry(); });
    }
    // phones sleep: reconnect as soon as the page is visible again
    const vis = () => { if (document.visibilityState === 'visible' && !self.open) ensurePeer(); };
    document.addEventListener('visibilitychange', vis);
    const origClose = self.close;
    self.close = () => { document.removeEventListener('visibilitychange', vis); origClose(); };
    ensurePeer();
    return self;
  };
})(window.Hub);
