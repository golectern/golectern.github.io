/* Lectern — core helpers, router, i18n glue */
window.Hub = window.Hub || {};
(function (H) {
  'use strict';

  // ---------- DOM helpers ----------
  // append()/prepend() that skip null/false and accept arrays (used with conditional children everywhere)
  for (const fn of ['append', 'prepend']) {
    const orig = Element.prototype[fn];
    Element.prototype[fn] = function (...a) { return orig.apply(this, a.flat(Infinity).filter((x) => x != null && x !== false)); };
  }
  H.$ = (sel, root) => (root || document).querySelector(sel);
  H.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** h('div.cls#id', {attrs, on:{click}}, children...) */
  H.h = function (tag, attrs, ...kids) {
    const m = String(tag).match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, p, n) => {
      if (p === '.') el.classList.add(n); else el.id = n;
    });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'on') { for (const e in v) el.addEventListener(e, v[e]); }
        else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) return k.forEach(add);
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  };

  H.uid = (n = 10) => {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    const r = crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  };
  H.code = (n = 6) => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    const r = crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  };
  H.pin = () => String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));

  H.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  H.fmtBytes = (b) => {
    if (!b) return '0 KB';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + ' ' + u[i];
  };
  H.fmtTime = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    const hh = Math.floor(m / 60);
    return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  H.fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  H.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  H.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- lazy script loader ----------
  const loaded = {};
  H.loadScript = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  }));
  H.need = {
    pdf: async () => {
      await H.loadScript('vendor/pdf.min.js');
      // Load the worker as a plain script so pdf.js can run it in the main thread when
      // real workers are unavailable (e.g. when opened straight from the disk).
      if (location.protocol === 'file:') await H.loadScript('vendor/pdf.worker.min.js');
      else window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      return window.pdfjsLib;
    },
    zip: async () => { await H.loadScript('vendor/jszip.min.js'); return window.JSZip; },
    pptx: async () => { await H.loadScript('vendor/pptx-preview.umd.js'); return window.pptxPreview; },
    xlsx: async () => { await H.loadScript('vendor/xlsx.full.min.js'); return window.XLSX; },
    jspdf: async () => { await H.loadScript('vendor/jspdf.umd.min.js'); return window.jspdf.jsPDF; },
  };

  // ---------- local settings ----------
  H.settings = {
    get(k, d) { try { const v = localStorage.getItem('myhub:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('myhub:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  // ---------- i18n ----------
  H.lang = H.settings.get('lang', 'en');
  H.t = (key, vars) => {
    const d = (H.I18N[H.lang] && H.I18N[H.lang][key]) || H.I18N.en[key] || key;
    return vars ? d.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '')) : d;
  };
  H.setLang = (l) => {
    H.lang = l; H.settings.set('lang', l);
    document.documentElement.lang = l === 'ku' ? 'ckb' : 'en';
    document.documentElement.dir = l === 'ku' ? 'rtl' : 'ltr';
  };
  H.langToggle = (onChange) => H.h('button.btn.ghost.sm.lang-toggle', {
    title: 'English / کوردی',
    on: { click: () => { H.setLang(H.lang === 'en' ? 'ku' : 'en'); onChange ? onChange() : H.router.render(); } },
  }, H.lang === 'en' ? 'کوردی' : 'English');

  // ---------- toast & modal ----------
  H.toast = (msg, kind) => {
    let box = H.$('#toasts');
    if (!box) { box = H.h('div#toasts'); document.body.appendChild(box); }
    const el = H.h('div.toast' + (kind ? '.' + kind : ''), msg);
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3300);
  };

  /** Simple modal. Returns {el, close}. body can be Node or array. */
  H.modal = (title, body, opts = {}) => {
    const close = () => { wrap.remove(); opts.onClose && opts.onClose(); };
    const wrap = H.h('div.modal-wrap', { on: { mousedown: (e) => { if (e.target === wrap && !opts.sticky) close(); } } },
      H.h('div.modal' + (opts.wide ? '.wide' : ''),
        H.h('div.modal-head', H.h('h3', title), H.h('button.icon-btn', { on: { click: close }, 'aria-label': 'Close' }, '✕')),
        H.h('div.modal-body', body),
        opts.actions ? H.h('div.modal-actions', opts.actions) : null));
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close };
  };
  H.prompt = (title, label, value = '', opts = {}) => new Promise((res) => {
    const inp = H.h(opts.multiline ? 'textarea.input' : 'input.input', { value, placeholder: opts.placeholder || '', rows: opts.multiline ? 4 : null });
    let done = false;
    const m = H.modal(title, [label ? H.h('label.lbl', label) : null, inp], {
      onClose: () => { if (!done) res(null); },
      actions: [
        H.h('button.btn.ghost', { on: { click: () => m.close() } }, H.t('cancel')),
        H.h('button.btn.primary', { on: { click: ok } }, H.t('ok')),
      ],
    });
    function ok() { done = true; res(inp.value); m.close(); }
    if (!opts.multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
  H.confirm = (title, text, danger) => new Promise((res) => {
    let done = false;
    const m = H.modal(title, H.h('p.muted', text), {
      onClose: () => { if (!done) res(false); },
      actions: [
        H.h('button.btn.ghost', { on: { click: () => m.close() } }, H.t('cancel')),
        H.h('button.btn' + (danger ? '.danger' : '.primary'), { on: { click: () => { done = true; res(true); m.close(); } } }, H.t('ok')),
      ],
    });
  });

  // ---------- QR ----------
  H.qrSvg = (text, opts = {}) => {
    const qr = window.qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = opts.margin == null ? 2 : opts.margin, sz = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
    const el = H.h('div.qr');
    el.innerHTML = `<svg viewBox="0 0 ${sz} ${sz}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${sz}" height="${sz}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    return el;
  };

  // ---------- public URL (for phones) ----------
  H.appBase = () => {
    const custom = H.settings.get('publicUrl', '') || (H.CONFIG && H.CONFIG.publicUrl) || '';
    if (location.protocol.startsWith('http') && !/^(localhost|127\.)/.test(location.hostname) && !custom) {
      return location.origin + location.pathname.replace(/index\.html$/, '');
    }
    if (custom) return custom.replace(/#.*$/, '').replace(/index\.html$/, '').replace(/\/?$/, '/');
    return location.href.replace(/#.*$/, '').replace(/index\.html$/, '');
  };
  H.remoteUrl = (code) => H.appBase() + '#/remote?s=' + code;
  H.joinUrl = (code) => H.appBase() + '#/join?s=' + code;
  H.isPublicReady = () => /^https:\/\//.test(H.appBase());

  // ---------- download ----------
  H.download = (blob, name) => {
    const a = H.h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };

  // ---------- sound ----------
  let actx;
  H.beep = (freq = 880, ms = 180, times = 1) => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = actx.createOscillator(), g = actx.createGain();
        const t0 = actx.currentTime + i * (ms / 1000 + 0.12);
        o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
        o.start(t0); o.stop(t0 + ms / 1000 + 0.05);
      }
    } catch (e) { /* audio blocked */ }
  };

  // ---------- confetti ----------
  H.confetti = (host, n = 140) => {
    host = host || document.body;
    const layer = H.h('div.confetti-layer');
    host.appendChild(layer);
    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
    for (let i = 0; i < n; i++) {
      const p = H.h('i', { style: {
        left: Math.random() * 100 + '%', background: colors[i % colors.length],
        animationDelay: Math.random() * 0.6 + 's', animationDuration: 2.2 + Math.random() * 1.8 + 's',
        transform: `rotate(${Math.random() * 360}deg)`, width: 6 + Math.random() * 6 + 'px', height: 10 + Math.random() * 8 + 'px',
      } });
      layer.appendChild(p);
    }
    setTimeout(() => layer.remove(), 4800);
  };

  // ---------- emoji sets ----------
  H.EMOJI = {
    People: '😀 😎 🤓 🥳 😇 🤠 🧐 😺 🙂 😜 🤩 🥸 👻 🤖 👽 🦸 🧙 🧑‍🎓 🧑‍🏫 🧑‍🚀'.split(' '),
    Animals: '🐶 🐱 🦊 🐼 🐨 🐯 🦁 🐸 🐵 🐧 🦉 🦄 🐝 🐢 🐙 🐬 🦋 🐞 🦒 🐘'.split(' '),
    Nature: '🌸 🌻 🌵 🍀 🍁 🌈 ⭐ 🔥 ⚡ 🌙 🍎 🍉 🍕 🍩 ⚽ 🎸 🎨 🚀 💎 🎯'.split(' '),
  };
  H.emojiFor = (id) => {
    const all = H.EMOJI.Animals;
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return all[h % all.length];
  };

  // ---------- router ----------
  H.routes = {};
  H.router = {
    cleanup: null,
    parse() {
      const raw = location.hash.replace(/^#/, '') || '/';
      const [path, qs] = raw.split('?');
      const q = {};
      new URLSearchParams(qs || '').forEach((v, k) => { q[k] = v; });
      return { path, q };
    },
    go(path) { location.hash = '#' + path; },
    async render() {
      if (this.cleanup) { try { this.cleanup(); } catch (e) { console.warn(e); } this.cleanup = null; }
      const { path, q } = this.parse();
      const app = H.$('#app');
      app.innerHTML = '';
      document.body.className = '';
      const parts = path.split('/').filter(Boolean);
      const name = parts[0] || 'home';
      const fn = H.routes[name] || H.routes.home;
      try {
        const c = await fn(app, parts.slice(1), q);
        if (typeof c === 'function') this.cleanup = c;
      } catch (e) {
        console.error(e);
        app.appendChild(H.h('div.page', H.h('div.card.error-card', H.h('h3', H.t('error')), H.h('p', String(e.message || e)),
          H.h('a.btn', { href: '#/' }, H.t('backHome')))));
      }
    },
  };
  window.addEventListener('hashchange', () => H.router.render());
  window.addEventListener('DOMContentLoaded', () => { H.setLang(H.lang); H.router.render(); });
})(window.Hub);
