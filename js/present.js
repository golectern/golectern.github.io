/* Lectern — presenter screen: slides, annotation tools, phone remote host */
(function (H) {
  'use strict';
  const { h, t } = H;

  const TOOLS = [
    ['none', '🖱️', 'selectNone', 'Escape'], ['laser', '🔴', 'laser', 'L'], ['pen', '✏️', 'draw', 'P'], ['hl', '🖍️', 'highlight', 'H'],
    ['erase', '🧽', 'erase', 'E'], ['text', '🔤', 'textbox', 'T'], ['num', '①', 'number', 'N#'], ['shape', '⬚', 'shape', ''],
    ['spot', '🔦', 'spotlight', 'S'], ['zoom', '🔍', 'zoom', 'Z'],
  ];

  H.routes.present = async function (app, [id]) {
    const lesson = await H.store.lessons.get(id);
    if (!lesson) throw new Error(t('notFound'));
    if (!lesson.items.length) { H.router.go('/lesson/' + id); return; }
    lesson.ink = lesson.ink || {};
    let dirty = false;
    lesson.items.forEach((it) => { if (!it.uid) { it.uid = H.uid(8); dirty = true; } });
    if (dirty) await H.store.saveLesson(lesson);
    document.title = (lesson.title || 'Lesson') + ' · Lectern';
    document.body.className = 'presenting';

    const S = {
      idx: Math.min(H.settings.get('pos:' + id, 0), lesson.items.length - 1),
      tool: 'none', color: '#ef4444', sizeIx: 1, shapeKind: 'rect', shapeFill: false,
      screen: 'none', zoom: { level: 1, x: 0.5, y: 0.5 }, spotR: 0.16, laserSize: 1,
      laser: { x: 0.5, y: 0.5, on: false, text: '' }, timer: null, notesOpen: false,
      undo: [], live: {}, remotes: 0, pinOk: new Set(),
    };
    const saveInk = H.debounce(() => H.store.saveLesson(lesson), 800);
    const cur = () => lesson.items[S.idx];
    const opsOf = (i) => { const it = lesson.items[i]; return (lesson.ink[it.uid] = lesson.ink[it.uid] || []); };

    // ---------- DOM ----------
    const slideLayer = h('div.slide-layer');
    const canvas = h('canvas.ink-canvas');
    const laserDot = h('div.laser-dot');
    const laserText = h('div.laser-text');
    const spot = h('div.spotlight');
    const fx = h('div.fx-layer', spot, laserDot, laserText);
    const zoomBox = h('div.zoom-box', slideLayer, canvas, fx);
    const stage = h('div.stage', zoomBox);
    const cover = h('div.screen-cover');
    const hudCount = h('div.hud-count');
    const timerPill = h('button.timer-pill', { on: { click: () => timerMenu() } });
    const sessBadge = h('button.sess-badge', { on: { click: () => openSession() } });
    const signals = h('div.signals');
    const notesPanel = h('aside.notes-panel');
    const wrap = h('div.stage-wrap', stage, cover,
      h('div.hud.hud-tl', hudCount), h('div.hud.hud-tr', signals, timerPill, sessBadge), notesPanel);
    const toolbar = h('div.toolbar');
    app.appendChild(wrap);
    app.appendChild(toolbar);

    // ---------- live connection ----------
    let code = H.settings.get('classCode', '') || H.code();
    H.settings.set('classCode', code);
    let pin = H.settings.get('pin', '') || H.pin();
    H.settings.set('pin', pin);
    let netStatus = 'connecting';
    const net = H.net.host(code, {
      onOpen: () => { netStatus = 'online'; updateBadge(); },
      onStatus: (s) => { netStatus = s; updateBadge(); },
      onCodeChange: (c) => { code = c; H.settings.set('classCode', c); updateBadge(); if (sessModal) { sessModal.close(); openSession(); } },
      onConn: (conn) => {
        const role = conn.metadata && conn.metadata.role;
        if (role === 'aud') live.join(conn);
        updateBadge();
      },
      onClose: (conn) => {
        const role = conn.metadata && conn.metadata.role;
        if (role === 'aud') live.leave(conn);
        S.pinOk.delete(conn.connectionId);
        updateBadge();
      },
      onData: (conn, msg) => {
        const role = conn.metadata && conn.metadata.role;
        if (role === 'remote') onRemote(conn, msg);
        else if (role === 'aud') live.data(conn, msg);
      },
      onError: (e) => console.warn('net', e),
    });

    const live = H.live.create({
      net, wrap, lesson, getCode: () => code,
      onChange: () => { pushRemote(); updateBadge(); },
    });

    function remotesOnline() { let n = 0; net.conns.forEach((c) => { if (S.pinOk.has(c.connectionId) && c.open) n++; }); return n; }
    function updateBadge() {
      const r = remotesOnline(), a = live.count();
      sessBadge.className = 'sess-badge ' + netStatus;
      sessBadge.innerHTML = '';
      sessBadge.append(h('span.dot'), h('span', code), h('span.sep', '·'), h('span', '📱 ' + r), h('span', '👥 ' + a));
      sessBadge.title = t('sessionTip');
      const sig = live.signals();
      signals.innerHTML = '';
      if (sig.hands) signals.append(h('span.sig', { title: t('handsUp') }, '✋ ' + sig.hands));
      if (sig.lost) signals.append(h('span.sig.warn', { title: t('paceLost') }, '😵 ' + sig.lost));
      if (sig.fast) signals.append(h('span.sig.warn', { title: t('paceFast') }, '🐢 ' + sig.fast));
      if (sig.qna) signals.append(h('button.sig', { title: t('qna'), on: { click: () => live.openQna() } }, '❓ ' + sig.qna));
    }

    // ---------- layout ----------
    function aspectOf(it) {
      if (it && it.w && it.h) return it.w / it.h;
      return 16 / 9;
    }
    function layout() {
      const vw = wrap.clientWidth, vh = wrap.clientHeight;
      const a = aspectOf(cur());
      let w = vw, hh = vw / a;
      if (hh > vh) { hh = vh; w = vh * a; }
      stage.style.width = w + 'px'; stage.style.height = hh + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
      fitPptx();
      redraw();
    }
    const ro = new ResizeObserver(() => layout());
    ro.observe(wrap);

    function redraw() { H.ink.render(canvas, opsOf(S.idx), Object.values(S.live)); }

    // ---------- slide rendering ----------
    const pptxCache = new Map();
    async function getPptx(srcId, it) {
      if (pptxCache.has(srcId)) return pptxCache.get(srcId);
      const p = (async () => {
        const lib = await H.need.pptx();
        const holder = h('div.pptx-holder');
        const bw = 1280, bh = Math.round(1280 * (it.h || 9) / (it.w || 16));
        holder.style.width = bw + 'px'; holder.style.height = bh + 'px';
        holder._bw = bw; holder._bh = bh;
        const hidden = h('div', { style: { position: 'absolute', left: '-99999px', top: 0 } }, holder);
        document.body.appendChild(hidden);
        const pv = lib.init(holder, { width: bw, height: bh, mode: 'slide' });
        const blob = await H.store.getBlob(srcId);
        await pv.load(await blob.arrayBuffer());
        return { pv, holder, hidden };
      })();
      pptxCache.set(srcId, p);
      return p;
    }
    function fitPptx() {
      const holder = slideLayer.querySelector('.pptx-holder');
      if (!holder) return;
      const s = stage.clientWidth / holder._bw;
      holder.style.transform = `scale(${s})`;
    }
    function ytSrc(it) {
      const o = location.protocol.startsWith('http') ? '&origin=' + encodeURIComponent(location.origin) : '';
      return `https://www.youtube.com/embed/${it.vid}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1${it.start ? '&start=' + it.start : ''}${o}`;
    }
    function gsSrc(it) {
      const base = it.published ? `https://docs.google.com/presentation/d/e/${it.pid}` : `https://docs.google.com/presentation/d/${it.pid}`;
      return `${base}/embed?start=false&loop=false&delayms=600000&rm=minimal&slide=${it.n}#slide=${it.n}`;
    }

    let renderToken = 0;
    async function show(i, opts = {}) {
      i = H.clamp(i, 0, lesson.items.length - 1);
      const changed = i !== S.idx || opts.force;
      S.idx = i;
      H.settings.set('pos:' + id, i);
      const it = cur();
      const token = ++renderToken;
      if (changed || !slideLayer.firstChild) {
        S.live = {};
        if (S.zoom.level !== 1) setZoom(1);
        // put back any pptx holder we borrowed
        const old = slideLayer.querySelector('.pptx-holder');
        if (old && old._home) old._home.appendChild(old);
        slideLayer.innerHTML = '';
        slideLayer.className = 'slide-layer type-' + it.type;
        layout();
        if (it.type === 'image') {
          const u = await H.store.blobUrl(it.blobId);
          if (token !== renderToken) return;
          slideLayer.appendChild(h('img.slide-img', { src: u, alt: it.title || '', draggable: false }));
        } else if (it.type === 'pptx') {
          const spin = h('div.slide-loading', t('loadingSlide'));
          slideLayer.appendChild(spin);
          try {
            const c = await getPptx(it.srcId, it);
            if (token !== renderToken) return;
            c.pv.renderSingleSlide(it.index);
            c.holder._home = c.hidden;
            spin.remove();
            slideLayer.appendChild(c.holder);
            fitPptx();
          } catch (e) { console.error(e); spin.textContent = t('pptxFail'); }
        } else if (it.type === 'video') {
          let el;
          if (it.platform === 'youtube') el = h('iframe.slide-frame', { src: ytSrc(it), allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture', allowfullscreen: true });
          else if (it.platform === 'vimeo') el = h('iframe.slide-frame', { src: `https://player.vimeo.com/video/${it.vid}?api=1&playsinline=1`, allow: 'autoplay; fullscreen', allowfullscreen: true });
          else if (it.platform === 'gdrive') el = h('iframe.slide-frame', { src: `https://drive.google.com/file/d/${it.vid}/preview`, allow: 'autoplay; fullscreen', allowfullscreen: true });
          else {
            const src = it.platform === 'file' ? await H.store.blobUrl(it.blobId) : it.src;
            if (token !== renderToken) return;
            el = h('video.slide-video', { src, controls: true, playsInline: true, preload: 'auto' });
          }
          slideLayer.appendChild(el);
        } else if (it.type === 'gslides') {
          slideLayer.appendChild(h('iframe.slide-frame', { src: gsSrc(it), allowfullscreen: true }));
        } else if (it.type === 'web') {
          slideLayer.appendChild(h('iframe.slide-frame', { src: it.url, allow: 'fullscreen; autoplay', referrerpolicy: 'no-referrer-when-downgrade' }));
          slideLayer.appendChild(h('a.web-open', { href: it.url, target: '_blank', rel: 'noopener' }, '↗ ' + t('openInTab')));
        } else if (it.type === 'board') {
          slideLayer.appendChild(h('div.board.board-' + (it.bg || 'white')));
        }
      }
      redraw();
      hudCount.textContent = `${S.idx + 1} / ${lesson.items.length}`;
      renderNotes();
      refreshToolbar();
      pushRemote();
      preload(S.idx + 1);
    }
    async function preload(i) {
      const it = lesson.items[i];
      if (it && it.type === 'image') { const u = await H.store.blobUrl(it.blobId); const im = new Image(); im.src = u; }
    }
    const next = () => show(S.idx + 1);
    const prev = () => show(S.idx - 1);

    // ---------- video control ----------
    function videoCmd(a) {
      const f = slideLayer.querySelector('iframe'), v = slideLayer.querySelector('video');
      const it = cur();
      if (v) {
        if (a === 'play') v.play().catch(() => { v.muted = true; v.play(); H.toast(t('tapForSound')); });
        if (a === 'pause') v.pause();
        if (a === 'toggle') v.paused ? v.play() : v.pause();
        if (a === 'mute') v.muted = true;
        if (a === 'unmute') v.muted = false;
        if (a === 'restart') { v.currentTime = 0; v.play(); }
        if (a === 'back10') v.currentTime = Math.max(0, v.currentTime - 10);
        if (a === 'fwd10') v.currentTime += 10;
        return;
      }
      if (!f || it.type !== 'video') return;
      if (it.platform === 'youtube') {
        const map = { play: ['playVideo'], pause: ['pauseVideo'], toggle: [S.ytPlaying ? 'pauseVideo' : 'playVideo'], mute: ['mute'], unmute: ['unMute'], restart: ['seekTo', [it.start || 0, true]] };
        if (a === 'toggle') S.ytPlaying = !S.ytPlaying; if (a === 'play') S.ytPlaying = true; if (a === 'pause') S.ytPlaying = false;
        const m = map[a]; if (!m) return;
        f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: m[0], args: m[1] || [] }), '*');
      } else if (it.platform === 'vimeo') {
        const map = { play: ['play'], pause: ['pause'], mute: ['setVolume', 0], unmute: ['setVolume', 1], restart: ['setCurrentTime', 0] };
        if (a === 'toggle') { S.vmPlaying = !S.vmPlaying; a = S.vmPlaying ? 'play' : 'pause'; }
        const m = map[a]; if (!m) return;
        f.contentWindow.postMessage(JSON.stringify({ method: m[0], value: m[1] }), '*');
      }
    }

    // ---------- tools ----------
    function setTool(tl) {
      S.tool = S.tool === tl && tl !== 'none' ? 'none' : tl;
      stage.dataset.tool = S.tool;
      if (S.tool !== 'spot') spot.classList.remove('on');
      if (S.tool !== 'laser') { laserDot.classList.remove('on'); laserText.classList.remove('on'); }
      if (S.tool !== 'zoom' && S.zoom.level !== 1) setZoom(1);
      refreshToolbar(); pushRemote();
    }
    function setZoom(level, x, y) {
      S.zoom.level = H.clamp(level, 1, 5);
      if (x != null) { S.zoom.x = x; S.zoom.y = y; }
      zoomBox.style.transformOrigin = `${S.zoom.x * 100}% ${S.zoom.y * 100}%`;
      zoomBox.style.transform = S.zoom.level === 1 ? '' : `scale(${S.zoom.level})`;
      pushRemote();
    }
    function setScreen(m) { S.screen = S.screen === m ? 'none' : m; cover.className = 'screen-cover ' + S.screen; refreshToolbar(); pushRemote(); }
    function showLaser(x, y, on) {
      S.laser.x = x; S.laser.y = y; S.laser.on = on;
      if (S.tool === 'spot') {
        spot.classList.toggle('on', on);
        spot.style.setProperty('--x', x * 100 + '%'); spot.style.setProperty('--y', y * 100 + '%');
        spot.style.setProperty('--r', S.spotR * stage.clientHeight + 'px');
        return;
      }
      laserDot.classList.toggle('on', on);
      laserDot.style.left = x * 100 + '%'; laserDot.style.top = y * 100 + '%';
      laserDot.style.setProperty('--c', S.color);
      laserDot.style.setProperty('--s', [10, 16, 26][S.sizeIx] + 'px');
      laserText.classList.toggle('on', on && !!S.laser.text);
      laserText.textContent = S.laser.text;
      laserText.style.left = x * 100 + '%'; laserText.style.top = y * 100 + '%';
      laserText.classList.toggle('flip', x > 0.7);
    }
    function addOp(op, idx = S.idx) {
      if (op.k === 'num') op.n = opsOf(idx).filter((o) => o.k === 'num').length + 1;
      opsOf(idx).push(op);
      S.undo.push({ a: 'add', uid: lesson.items[idx].uid, op });
      if (S.undo.length > 200) S.undo.shift();
      if (idx === S.idx) redraw();
      saveInk(); pushRemote();
    }
    function eraseAt(x, y, r) {
      const ops = opsOf(S.idx);
      const i = H.ink.hit(ops, x, y, r || 0.02, stage.clientWidth / stage.clientHeight);
      if (i < 0) return false;
      const [op] = ops.splice(i, 1);
      S.undo.push({ a: 'del', uid: cur().uid, op, i });
      redraw(); saveInk(); pushRemote();
      return true;
    }
    function undo() {
      const u = S.undo.pop();
      if (!u) return;
      const ops = (lesson.ink[u.uid] = lesson.ink[u.uid] || []);
      if (u.a === 'add') { const i = ops.lastIndexOf(u.op); if (i >= 0) ops.splice(i, 1); }
      else if (u.a === 'del') ops.splice(Math.min(u.i, ops.length), 0, u.op);
      else if (u.a === 'clear') lesson.ink[u.uid] = u.ops;
      redraw(); saveInk(); pushRemote();
    }
    function clearInk() {
      const it = cur();
      const ops = opsOf(S.idx);
      if (!ops.length) return;
      S.undo.push({ a: 'clear', uid: it.uid, ops: ops.slice() });
      lesson.ink[it.uid] = [];
      redraw(); saveInk(); pushRemote();
    }
    const sizeOf = (tool) => (H.ink.SIZES[tool] || H.ink.SIZES.pen)[S.sizeIx];

    // pointer on the stage (mouse / touch screen / pen)
    let drag = null;
    const norm = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (S.tool === 'none') return;
      const [x, y] = norm(e);
      canvas.setPointerCapture(e.pointerId);
      if (S.tool === 'pen' || S.tool === 'hl') {
        drag = { id: 'local', op: { k: 'stroke', tool: S.tool, c: S.color, w: sizeOf(S.tool), pts: [x, y] } };
        S.live.local = drag.op; redraw();
      } else if (S.tool === 'shape') {
        drag = { op: { k: 'shape', kind: S.shapeKind, c: S.color, w: sizeOf('shape'), fill: S.shapeFill, x1: x, y1: y, x2: x, y2: y } };
        S.live.local = drag.op;
      } else if (S.tool === 'erase') { drag = { erase: true }; eraseAt(x, y, sizeOf('erase')); }
      else if (S.tool === 'text') { e.preventDefault(); placeText(x, y); }
      else if (S.tool === 'num') addOp({ k: 'num', x, y, c: S.color, s: sizeOf('text') });
      else if (S.tool === 'zoom') setZoom(S.zoom.level > 1 ? 1 : 2.2, x, y);
      else if (S.tool === 'laser' || S.tool === 'spot') showLaser(x, y, true);
    });
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = norm(e);
      if ((S.tool === 'laser' || S.tool === 'spot') && e.pointerType === 'mouse') { showLaser(x, y, true); return; }
      if (!drag) { if (S.tool === 'laser' || S.tool === 'spot') showLaser(x, y, true); return; }
      if (drag.erase) { eraseAt(x, y, sizeOf('erase')); return; }
      if (drag.op && drag.op.k === 'stroke') { drag.op.pts.push(x, y); redraw(); }
      if (drag.op && drag.op.k === 'shape') { drag.op.x2 = x; drag.op.y2 = y; redraw(); }
    });
    const endDrag = (e) => {
      if (S.tool === 'laser' || S.tool === 'spot') { if (e.pointerType !== 'mouse') showLaser(S.laser.x, S.laser.y, false); }
      if (!drag) return;
      const d = drag; drag = null; delete S.live.local;
      if (d.op && d.op.k === 'stroke') addOp(d.op);
      if (d.op && d.op.k === 'shape') {
        const o = d.op;
        if (Math.abs(o.x2 - o.x1) < 0.01 && Math.abs(o.y2 - o.y1) < 0.01) { // quick tap = default size
          const w = 0.14, hh = w * stage.clientWidth / stage.clientHeight * (o.kind === 'rect' ? 0.6 : 1);
          if (o.kind === 'line' || o.kind === 'arrow') { o.x1 -= w / 2; o.x2 = o.x1 + w; o.y2 = o.y1; }
          else { o.x1 -= w / 2; o.y1 -= hh / 2; o.x2 = o.x1 + w; o.y2 = o.y1 + hh; }
        }
        addOp(o);
      }
      redraw();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => { if (S.tool === 'laser' || S.tool === 'spot') showLaser(S.laser.x, S.laser.y, false); });
    canvas.addEventListener('wheel', (e) => {
      if (S.tool !== 'zoom') return;
      e.preventDefault();
      const [x, y] = norm(e);
      setZoom(S.zoom.level * (e.deltaY < 0 ? 1.15 : 1 / 1.15), S.zoom.level === 1 ? x : S.zoom.x, S.zoom.level === 1 ? y : S.zoom.y);
    }, { passive: false });

    function placeText(x, y) {
      const inp = h('textarea.text-place', { rows: 1, placeholder: t('labelPlaceholder') });
      inp.style.left = x * 100 + '%'; inp.style.top = y * 100 + '%'; inp.style.color = S.color;
      fx.appendChild(inp);
      inp.focus();
      let done = false;
      const fin = () => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (v) addOp({ k: 'text', x, y, text: v, c: S.color, s: sizeOf('text') }); };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fin(); } if (e.key === 'Escape') { inp.value = ''; fin(); } });
      inp.addEventListener('blur', fin);
    }

    // ---------- timer ----------
    function startTimer(sec) {
      if (sec > 0) S.timer = { mode: 'down', end: Date.now() + sec * 1000, total: sec };
      else S.timer = { mode: 'up', start: Date.now() };
      S.timer.alerted = false;
      pushRemote();
    }
    function stopTimer() { S.timer = null; pushRemote(); }
    function pauseTimer() {
      const tm = S.timer; if (!tm) return;
      if (tm.paused) {
        if (tm.mode === 'down') tm.end = Date.now() + tm.left * 1000; else tm.start = Date.now() - tm.elapsed * 1000;
        tm.paused = false;
      } else {
        if (tm.mode === 'down') tm.left = Math.max(0, (tm.end - Date.now()) / 1000); else tm.elapsed = (Date.now() - tm.start) / 1000;
        tm.paused = true;
      }
      pushRemote();
    }
    const timerLeft = () => { const tm = S.timer; if (!tm) return null; if (tm.mode === 'down') return tm.paused ? tm.left : Math.max(0, (tm.end - Date.now()) / 1000); return tm.paused ? tm.elapsed : (Date.now() - tm.start) / 1000; };
    const tick = setInterval(() => {
      const tm = S.timer;
      if (!tm) { timerPill.className = 'timer-pill idle'; timerPill.textContent = '⏱'; return; }
      const v = timerLeft();
      timerPill.textContent = (tm.paused ? '⏸ ' : '⏱ ') + H.fmtTime(tm.mode === 'down' ? Math.ceil(v) : v);
      const low = tm.mode === 'down' && v <= 10;
      timerPill.className = 'timer-pill ' + (tm.mode === 'down' && v <= 0 ? 'done' : low ? 'low' : '');
      if (tm.mode === 'down' && v <= 0 && !tm.alerted) { tm.alerted = true; H.beep(740, 260, 3); pushRemote(); }
    }, 250);
    function timerMenu() {
      const custom = h('input.input.num', { type: 'number', min: 1, max: 180, value: 5 });
      const m = H.modal('⏱ ' + t('timer'), [
        h('div.chips', [1, 2, 3, 5, 10, 15, 20, 30].map((n) => h('button.chip', { on: { click: () => { startTimer(n * 60); m.close(); } } }, n + ' ' + t('minShort')))),
        h('div.row', custom, h('span', t('minutesLabel')), h('button.btn', { on: { click: () => { startTimer(+custom.value * 60); m.close(); } } }, t('start'))),
        h('div.row.wrap',
          h('button.btn.ghost', { on: { click: () => { startTimer(0); m.close(); } } }, '⏱ ' + t('stopwatch')),
          S.timer ? h('button.btn.ghost', { on: { click: () => { pauseTimer(); m.close(); } } }, S.timer.paused ? '▶ ' + t('resume') : '⏸ ' + t('pause')) : null,
          S.timer ? h('button.btn.danger', { on: { click: () => { stopTimer(); m.close(); } } }, t('clearTimer')) : null),
      ]);
    }

    // ---------- notes ----------
    function renderNotes() {
      notesPanel.classList.toggle('open', S.notesOpen);
      if (!S.notesOpen) return;
      const it = cur();
      const ta = h('textarea.input', { rows: 8, placeholder: t('notesPlaceholder'), value: it.notes || '' });
      const st = h('span.muted.sm');
      ta.addEventListener('input', H.debounce(async () => { it.notes = ta.value; await H.store.saveLesson(lesson); st.textContent = t('saved') + ' ✓'; pushRemote(); }, 500));
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      notesPanel.innerHTML = '';
      notesPanel.append(
        h('div.np-head', h('b', '📝 ' + t('notes')), h('button.icon-btn', { on: { click: () => { S.notesOpen = false; renderNotes(); } } }, '✕')),
        it.fileNotes ? h('div', h('div.lbl', t('notesFromFile')), h('div.notes-file', it.fileNotes)) : null,
        h('div.lbl', t('yourNotes')), ta, st, h('p.hint', t('notesKeepUntilRemoved')));
    }

    // ---------- overview grid ----------
    function overview() {
      const grid = h('div.overview-grid');
      lesson.items.forEach((it, i) => grid.appendChild(h('button.ov-item' + (i === S.idx ? '.cur' : ''), { on: { click: () => { m.close(); show(i); } } }, H.ui.thumb(it, i), h('span.ov-title', it.title || ''))));
      const m = H.modal('▦ ' + t('overview'), grid, { wide: true });
    }

    // ---------- session panel (QR codes) ----------
    let sessModal = null;
    function openSession() {
      const ready = H.isPublicReady();
      const rUrl = H.remoteUrl(code), jUrl = H.joinUrl(code);
      const body = h('div.sess',
        !ready ? h('div.warn-box', t('notPublicWarn'), ' ', h('button.btn.sm', { on: { click: () => { sessModal.close(); H.openSettings(); } } }, t('settings'))) : null,
        h('div.sess-grid',
          h('div.sess-col',
            h('h4', '📱 ' + t('scanToControl')),
            H.qrSvg(rUrl),
            h('div.pin-row', h('span', '🔒 ' + t('controlPin')), h('b.pin', pin),
              h('button.btn.ghost.sm', { on: { click: () => { pin = H.pin(); H.settings.set('pin', pin); S.pinOk.clear(); net.broadcast('remote', { t: 'auth', ok: false, reason: 'pin' }); sessModal.close(); openSession(); } } }, t('newPin'))),
            h('p.hint', t('pinHint')),
            h('div.row.wrap',
              h('button.btn.ghost.sm', { on: { click: () => copy(rUrl) } }, '🔗 ' + t('copyLink')),
              h('button.btn.ghost.sm', { on: { click: () => window.open(H.appBase().startsWith('http') && !ready ? location.href.replace(/#.*/, '') + '#/remote?s=' + code : rUrl, 'myhub-remote', 'width=420,height=860') } }, '🖥️ ' + t('testRemote'))),
            h('div.muted.sm', remotesOnline() ? '● ' + t('remotesConnected', { n: remotesOnline() }) : t('noRemote'))),
          h('div.sess-col',
            h('h4', '👥 ' + t('audienceJoin')),
            H.qrSvg(jUrl),
            h('div.pin-row', h('span', t('sessionCode')), h('b.pin', code)),
            h('p.hint', t('audienceHint')),
            h('div.row.wrap',
              h('button.btn.ghost.sm', { on: { click: () => copy(jUrl) } }, '🔗 ' + t('copyLink')),
              h('button.btn.primary.sm', { on: { click: () => { sessModal.close(); live.showJoin(); } } }, '📺 ' + t('showJoinScreen'))),
            h('div.muted.sm', t('nJoined', { n: live.count() })))),
        h('div.row.wrap.sess-foot',
          h('span.muted.sm', t('status') + ': ' + t('net_' + netStatus)),
          h('button.btn.ghost.sm', { on: { click: () => { sessModal.close(); live.openPeople(); } } }, '🧑‍🎓 ' + t('people'))));
      sessModal = H.modal(t('session'), body, { wide: true, onClose: () => { sessModal = null; } });
    }
    function copy(txt) { navigator.clipboard && navigator.clipboard.writeText(txt).then(() => H.toast(t('copied'), 'ok'), () => H.prompt(t('copyLink'), '', txt)); }

    // ---------- toolbar ----------
    function tb(icon, title, onClick, cls) { return h('button.tb' + (cls ? '.' + cls : ''), { title, 'aria-label': title, on: { click: (e) => { e.stopPropagation(); onClick(e); } } }, icon); }
    function refreshToolbar() {
      toolbar.innerHTML = '';
      const colorBtn = h('button.tb.color-btn', { title: t('color'), on: { click: (e) => { e.stopPropagation(); colorPop(colorBtn); } } }, h('i', { style: { background: S.color } }));
      const sizeBtn = tb(['S', 'M', 'L'][S.sizeIx], t('size'), () => { S.sizeIx = (S.sizeIx + 1) % 3; refreshToolbar(); pushRemote(); });
      toolbar.append(
        h('div.tb-group',
          tb('⟨', t('prev'), prev), h('span.tb-count', `${S.idx + 1}/${lesson.items.length}`), tb('⟩', t('next'), next)),
        h('div.tb-group', TOOLS.map(([k, ic, lab]) => {
          const b = tb(k === 'shape' ? { rect: '▭', circle: '◯', arrow: '➜', line: '╱' }[S.shapeKind] : ic, t(lab), (e) => (k === 'shape' && S.tool === 'shape' ? shapePop(e.currentTarget) : setTool(k)), S.tool === k ? 'on' : '');
          return b;
        })),
        h('div.tb-group', colorBtn, sizeBtn, tb('↶', t('undo'), undo), tb('🗑', t('clear'), clearInk)),
        h('div.tb-group', tb('⬛', t('black'), () => setScreen('black'), S.screen === 'black' ? 'on' : ''), tb('⬜', t('white'), () => setScreen('white'), S.screen === 'white' ? 'on' : '')),
        cur().type === 'video' ? h('div.tb-group', tb('⏯', t('play'), () => videoCmd('toggle')), tb('⏮', t('reset'), () => videoCmd('restart')), tb('🔇', t('mute'), () => videoCmd('mute')), tb('🔊', t('unmute'), () => videoCmd('unmute'))) : null,
        h('div.tb-group',
          tb('⏱', t('timer'), timerMenu), tb('📝', t('notes'), () => { S.notesOpen = !S.notesOpen; renderNotes(); }, S.notesOpen ? 'on' : ''), tb('▦', t('overview'), overview)),
        h('div.tb-group',
          tb('🧠', t('quiz'), () => live.openQuiz()), tb('❓', t('qna'), () => live.openQna()), tb('🎲', t('randomPicker'), () => live.pick()), tb('💬', t('reactionsTip'), () => live.toggleReactions(), live.reactionsOn() ? 'on' : '')),
        h('div.tb-group',
          tb('📱', t('session'), openSession), tb('⛶', t('fullScreen'), fullscreen), tb('✕', t('exit'), exit)));
    }
    function colorPop(anchor) {
      closePops();
      const pop = h('div.pop', H.ink.COLORS.map((c) => h('button.swatch' + (c === S.color ? '.on' : ''), { style: { background: c }, on: { click: () => { S.color = c; closePops(); refreshToolbar(); pushRemote(); } } })));
      placePop(pop, anchor);
    }
    function shapePop(anchor) {
      closePops();
      const pop = h('div.pop.col',
        h('div.row', ['rect', 'circle', 'arrow', 'line'].map((k) => h('button.chip' + (S.shapeKind === k ? '.on' : ''), { on: { click: () => { S.shapeKind = k; closePops(); refreshToolbar(); } } }, { rect: '▭', circle: '◯', arrow: '➜', line: '╱' }[k] + ' ' + t('shape_' + k)))),
        h('label.check', h('input', { type: 'checkbox', checked: S.shapeFill, on: { change: (e) => { S.shapeFill = e.target.checked; } } }), ' ', t('shapeFilled')));
      placePop(pop, anchor);
    }
    function placePop(pop, anchor) {
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
      pop.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }
    function closePops() { H.$$('.pop').forEach((p) => p.remove()); }
    document.addEventListener('click', closePops);

    // auto-hide toolbar
    let hideT;
    const poke = () => {
      toolbar.classList.remove('hidden'); document.body.classList.remove('idle');
      clearTimeout(hideT);
      if (H.settings.get('autoHideBar', true)) hideT = setTimeout(() => { if (!toolbar.matches(':hover') && !H.$('.pop')) { toolbar.classList.add('hidden'); document.body.classList.add('idle'); } }, 3200);
    };
    document.addEventListener('mousemove', poke);
    poke();

    function fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
    function exit() { if (document.fullscreenElement) document.exitFullscreen(); H.router.go('/'); }

    // ---------- keyboard (and presentation clickers) ----------
    function onKey(e) {
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (H.$('.modal-wrap') && e.key !== 'Escape') return;
      const k = e.key;
      if (e.ctrlKey || e.metaKey) { if (k.toLowerCase() === 'z') { e.preventDefault(); undo(); } return; }
      const map = {
        ArrowRight: next, ArrowDown: next, PageDown: next, ' ': next, Enter: next,
        ArrowLeft: prev, ArrowUp: prev, PageUp: prev, Backspace: prev,
        Home: () => show(0), End: () => show(lesson.items.length - 1),
        l: () => setTool('laser'), p: () => setTool('pen'), d: () => setTool('pen'), h: () => setTool('hl'), e: () => setTool('erase'),
        t: () => setTool('text'), s: () => setTool('spot'), z: () => setTool('zoom'),
        b: () => setScreen('black'), '.': () => setScreen('black'), w: () => setScreen('white'), ',': () => setScreen('white'),
        c: clearInk, f: fullscreen, g: overview, n: () => { S.notesOpen = !S.notesOpen; renderNotes(); refreshToolbar(); },
        q: () => live.openQuiz(), r: () => live.pick(), k: () => videoCmd('toggle'),
        Escape: () => { if (H.$('.modal-wrap')) return; if (S.screen !== 'none') setScreen(S.screen); else setTool('none'); },
      };
      const fn = map[k] || map[k.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); poke(); }
    }
    document.addEventListener('keydown', onKey);

    // ---------- phone remote ----------
    const thumbCache = new Map();
    async function thumbData(i) {
      const it = lesson.items[i];
      if (!it) return null;
      if (thumbCache.has(it.uid)) return thumbCache.get(it.uid);
      let d = null;
      if (it.thumbId) {
        const b = await H.store.getBlob(it.thumbId);
        if (b) d = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
      } else if (it.type === 'video' && it.platform === 'youtube') d = `https://img.youtube.com/vi/${it.vid}/mqdefault.jpg`;
      thumbCache.set(it.uid, d);
      return d;
    }
    function remoteState() {
      const it = cur(), nx = lesson.items[S.idx + 1];
      return {
        t: 'state', title: lesson.title, idx: S.idx, total: lesson.items.length,
        cur: { type: it.type, platform: it.platform, title: it.title, notes: it.notes || '', fileNotes: it.fileNotes || '', uid: it.uid, aspect: stage.clientWidth / stage.clientHeight || aspectOf(it), bg: it.bg },
        next: nx ? { title: nx.title, type: nx.type, uid: nx.uid } : null,
        ink: opsOf(S.idx),
        tool: S.tool, color: S.color, sizeIx: S.sizeIx, shapeKind: S.shapeKind, shapeFill: S.shapeFill,
        screen: S.screen, zoom: S.zoom.level, spotR: S.spotR, laserText: S.laser.text,
        timer: S.timer ? { mode: S.timer.mode, left: timerLeft(), paused: !!S.timer.paused, at: Date.now() } : null,
        live: live.summary(),
      };
    }
    const pushRemote = H.debounce(() => {
      const st = remoteState();
      net.conns.forEach((c) => { if (S.pinOk.has(c.connectionId)) net.send(c, st); });
    }, 60);

    function onRemote(conn, m) {
      if (!m || !m.t) return;
      if (m.t === 'auth') {
        if (String(m.pin) === String(pin)) {
          S.pinOk.add(conn.connectionId);
          net.send(conn, { t: 'auth', ok: true });
          net.send(conn, remoteState());
          updateBadge();
          H.toast('📱 ' + t('remoteConnected'), 'ok');
        } else net.send(conn, { t: 'auth', ok: false });
        return;
      }
      if (!S.pinOk.has(conn.connectionId)) { net.send(conn, { t: 'auth', ok: false }); return; }
      switch (m.t) {
        case 'next': next(); break;
        case 'prev': prev(); break;
        case 'goto': show(+m.i); break;
        case 'tool': setTool(m.tool); break;
        case 'set':
          if (m.color) S.color = m.color;
          if (m.sizeIx != null) S.sizeIx = m.sizeIx;
          if (m.shapeKind) S.shapeKind = m.shapeKind;
          if (m.shapeFill != null) S.shapeFill = m.shapeFill;
          if (m.spotR) S.spotR = m.spotR;
          if (m.laserText != null) { S.laser.text = m.laserText; showLaser(S.laser.x, S.laser.y, S.laser.on); }
          refreshToolbar(); pushRemote(); break;
        case 'ptr': showLaser(m.x, m.y, !!m.on); break;
        case 'ink':
          if (m.a === 'start') { S.live[m.id] = m.op; redraw(); }
          else if (m.a === 'pts' && S.live[m.id]) { S.live[m.id].pts.push(...m.pts); redraw(); }
          else if (m.a === 'shape' && S.live[m.id]) { Object.assign(S.live[m.id], m.op); redraw(); }
          else if (m.a === 'end' && S.live[m.id]) { const op = S.live[m.id]; delete S.live[m.id]; if (m.op) Object.assign(op, m.op); addOp(op); }
          else if (m.a === 'cancel') { delete S.live[m.id]; redraw(); }
          break;
        case 'op': addOp(m.op); break;
        case 'erase': eraseAt(m.x, m.y, m.r); break;
        case 'undo': undo(); break;
        case 'clear': clearInk(); break;
        case 'screen': setScreen(m.mode); break;
        case 'zoom': if (m.level === 1) setZoom(1); else setZoom(m.level || 2.2, m.x, m.y); break;
        case 'video': videoCmd(m.a); break;
        case 'timer': if (m.a === 'start') startTimer(m.sec || 0); else if (m.a === 'pause') pauseTimer(); else stopTimer(); break;
        case 'notes': { const it = lesson.items[m.i]; if (it) { it.notes = m.text; H.store.saveLesson(lesson); if (m.i === S.idx) renderNotes(); } break; }
        case 'thumb': thumbData(m.i).then((d) => net.send(conn, { t: 'thumb', i: m.i, uid: (lesson.items[m.i] || {}).uid, data: d })); break;
        case 'list': net.send(conn, { t: 'list', items: lesson.items.map((it) => ({ title: it.title, type: it.type, uid: it.uid })) }); break;
        case 'photo': receivePhoto(conn, m); break;
        case 'live': live.remote(m); break;
        case 'fullscreen': fullscreen(); break;
        default: break;
      }
    }
    const photoParts = {};
    async function receivePhoto(conn, m) {
      const P = (photoParts[m.id] = photoParts[m.id] || { parts: [], got: 0 });
      P.parts[m.i] = m.part; P.got++;
      if (P.got < m.n) return;
      delete photoParts[m.id];
      try {
        const item = await H.importers.fromPhoto(P.parts.join(''));
        item.uid = H.uid(8);
        lesson.items.splice(S.idx + 1, 0, item);
        await H.store.saveLesson(lesson);
        H.toast('📷 ' + t('photoAdded'), 'ok');
        show(S.idx + 1);
        net.send(conn, { t: 'photoOk' });
      } catch (e) { console.error(e); H.toast(t('error'), 'err'); }
    }

    // keep the screen awake while presenting
    let wake = null;
    const reqWake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ } };
    reqWake();
    document.addEventListener('visibilitychange', reqWake);

    // go
    updateBadge();
    await show(S.idx, { force: true });
    if (!H.settings.get('seenPresentTip', false)) { H.toast(t('presentTip')); H.settings.set('seenPresentTip', true); }

    return function cleanup() {
      clearInterval(tick); clearTimeout(hideT); ro.disconnect();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', poke);
      document.removeEventListener('click', closePops);
      document.removeEventListener('visibilitychange', reqWake);
      try { wake && wake.release(); } catch (e) { /* ignore */ }
      live.destroy(); net.close();
      pptxCache.forEach((p) => p.then((c) => { try { c.pv.destroy(); } catch (e) { /* ignore */ } c.hidden.remove(); }).catch(() => {}));
      H.store.saveLesson(lesson);
      closePops();
      document.body.className = '';
    };
  };
})(window.Hub);
