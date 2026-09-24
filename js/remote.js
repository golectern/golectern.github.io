/* Lectern — phone remote: controller + presenter view */
(function (H) {
  'use strict';
  const { h, t } = H;
  const TOOLS = [['none', '👆', 'selectNone'], ['laser', '🔴', 'laser'], ['pen', '✏️', 'draw'], ['hl', '🖍️', 'highlight'], ['erase', '🧽', 'erase'],
    ['text', '🔤', 'textbox'], ['num', '①', 'number'], ['shape', '⬚', 'shape'], ['spot', '🔦', 'spotlight'], ['zoom', '🔍', 'zoom']];

  H.routes.remote = async function (app, _p, q) {
    const code = String(q.s || '').toUpperCase();
    document.body.className = 'phone remote-page';
    document.title = 'Remote · Lectern';
    if (!code) { app.appendChild(h('div.phone-msg', h('h2', t('missingSession')), h('a.btn', { href: '#/' }, t('backHome')))); return; }

    let st = null, authed = false, tab = H.settings.get('remoteTab', 'notes');
    const thumbs = {};
    const statusDot = h('span.dot');
    const statusTxt = h('span.status-txt', t('connecting'));
    const root = h('div.remote');
    app.appendChild(root);

    const conn = H.net.join(code, { role: 'remote' }, {
      onStatus: (s) => { statusDot.className = 'dot ' + s; statusTxt.textContent = s === 'online' ? '' : t('net_' + s); if (s !== 'online') authed = false; },
      onOpen: () => { const p = H.settings.get('pin:' + code, ''); if (p) conn.send({ t: 'auth', pin: p }); else renderPin(); },
      onData: (m) => {
        if (m.t === 'auth') {
          if (m.ok) { authed = true; } else { authed = false; H.settings.set('pin:' + code, ''); renderPin(m.reason === 'pin' ? t('pinChanged') : H.settings.get('triedPin', false) ? t('wrongPin') : ''); }
          H.settings.set('triedPin', false);
        } else if (m.t === 'state') { st = m; if (!built) renderCtrl(); else update(); }
        else if (m.t === 'thumb') { thumbs[m.uid] = m.data || ''; update(); }
        else if (m.t === 'list') { slideList = m.items; if (tab === 'slides') renderTab(); }
        else if (m.t === 'photoOk') { H.toast('📷 ' + t('photoAdded'), 'ok'); camBusy = false; renderTab(); }
      },
    });

    let built = false;
    function renderPin(err) {
      built = false;
      root.innerHTML = '';
      const inp = h('input.input.pin-in', { inputmode: 'numeric', maxlength: 6, placeholder: '••••', autocomplete: 'one-time-code' });
      const go = () => { const p = inp.value.trim(); if (!p) return; H.settings.set('pin:' + code, p); H.settings.set('triedPin', true); conn.send({ t: 'auth', pin: p }); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      root.append(h('div.pin-card',
        h('div.brand-sm', '◆ Lectern'), h('h2', '🔒 ' + t('enterPin')), h('p.muted', t('enterPinSub')),
        inp, err ? h('p.err', err) : null, h('button.btn.primary.lg.block', { on: { click: go } }, t('unlock')),
        h('div.muted.sm', h('span', statusDot, ' ', statusTxt), ' · ', t('sessionCode'), ' ', h('b', code))));
      setTimeout(() => inp.focus(), 50);
    }

    // ---------- controller ----------
    let pad, padCanvas, padImg, countEl, titleEl, nextEl, timerEl, toolRow, optRow, tabBox, videoRow, screenRow;
    let slideList = null;
    function renderCtrl() {
      built = true;
      root.innerHTML = '';
      countEl = h('b.r-count');
      titleEl = h('div.r-title');
      timerEl = h('button.r-timer', { on: { click: () => setTab('timer') } });
      padImg = h('div.pad-bg');
      padCanvas = h('canvas.pad-canvas');
      pad = h('div.pad', padImg, padCanvas);
      nextEl = h('div.r-next');
      toolRow = h('div.tool-row');
      optRow = h('div.r-opts');
      videoRow = h('div.video-row');
      screenRow = h('div.screen-row');
      tabBox = h('div.r-tabbox');
      root.append(
        h('div.r-top', h('span', statusDot), titleEl, timerEl, countEl),
        pad,
        h('div.r-nav',
          h('button.r-prev', { on: { click: () => { buzz(); conn.send({ t: 'prev' }); } } }, '◀ ' + t('prev')),
          h('button.r-next-btn', { on: { click: () => { buzz(); conn.send({ t: 'next' }); } } }, t('next') + ' ▶')),
        nextEl, videoRow, toolRow, optRow, screenRow,
        h('div.r-tabs', [['notes', '📝', 'notes'], ['slides', '▦', 'slides'], ['live', '👥', 'liveTab'], ['timer', '⏱', 'timer'], ['camera', '📷', 'camera']].map(([k, ic, l]) =>
          h('button.r-tab', { 'data-k': k, on: { click: () => setTab(k) } }, ic, h('span', t(l))))),
        tabBox);
      bindPad();
      update();
      renderTab();
    }
    function buzz() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* ignore */ } }

    let lastIdx = -1, lastTab = null;
    function update() {
      if (!st || !pad) return;
      countEl.textContent = `${st.idx + 1}/${st.total}`;
      titleEl.textContent = st.cur.title || st.title || '';
      // pad size to slide aspect
      const asp = st.cur.aspect || 16 / 9;
      let w = (root.clientWidth || 360) - 24, hh = w / asp;
      const maxH = Math.max(160, window.innerHeight * 0.42);
      if (hh > maxH) { hh = maxH; w = hh * asp; }
      pad.style.width = w + 'px'; pad.style.height = hh + 'px'; pad.style.alignSelf = 'center';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      padCanvas.width = Math.round(pad.clientWidth * dpr); padCanvas.height = Math.round(hh * dpr);
      // background
      const th = thumbs[st.cur.uid];
      if (th === undefined) { thumbs[st.cur.uid] = null; conn.send({ t: 'thumb', i: st.idx }); }
      padImg.style.backgroundImage = th ? `url("${th}")` : '';
      padImg.className = 'pad-bg type-' + st.cur.type + (st.cur.bg ? ' board-' + st.cur.bg : '');
      padImg.textContent = th ? '' : ({ pptx: '📊', video: '🎬', gslides: '🟨', web: '🌐', board: '' }[st.cur.type] || '');
      pad.dataset.tool = st.tool;
      H.ink.render(padCanvas, st.ink, liveOp);
      // next slide
      if (st.next) {
        const nt = thumbs[st.next.uid];
        if (nt === undefined) { thumbs[st.next.uid] = null; conn.send({ t: 'thumb', i: st.idx + 1 }); }
        nextEl.innerHTML = '';
        nextEl.append(h('span.muted.sm', t('nextSlide') + ':'), nt ? h('img', { src: nt, alt: '' }) : null, h('span.r-next-title', st.next.title || ''));
      } else nextEl.innerHTML = `<span class="muted sm">${H.esc(t('lastSlide'))}</span>`;
      // tools
      toolRow.innerHTML = '';
      TOOLS.forEach(([k, ic, l]) => toolRow.appendChild(h('button.rt' + (st.tool === k ? '.on' : ''), { title: t(l), on: { click: () => { st.tool = st.tool === k && k !== 'none' ? 'none' : k; conn.send({ t: 'tool', tool: k }); update(); } } }, k === 'shape' ? { rect: '▭', circle: '◯', arrow: '➜', line: '╱' }[st.shapeKind] : ic, h('small', t(l)))));
      optRow.innerHTML = '';
      optRow.append(
        h('div.swatches', H.ink.COLORS.map((c) => h('button.swatch' + (c === st.color ? '.on' : ''), { style: { background: c }, on: { click: () => { st.color = c; conn.send({ t: 'set', color: c }); update(); } } }))),
        h('div.row',
          ['S', 'M', 'L'].map((s, i) => h('button.chip.sm' + (st.sizeIx === i ? '.on' : ''), { on: { click: () => { st.sizeIx = i; conn.send({ t: 'set', sizeIx: i }); update(); } } }, s)),
          h('button.chip.sm', { on: { click: () => conn.send({ t: 'undo' }) } }, '↶ ' + t('undo')),
          h('button.chip.sm', { on: { click: () => conn.send({ t: 'clear' }) } }, '🗑 ' + t('clear'))));
      if (st.tool === 'shape') optRow.append(h('div.row', ['rect', 'circle', 'arrow', 'line'].map((k) => h('button.chip.sm' + (st.shapeKind === k ? '.on' : ''), { on: { click: () => { st.shapeKind = k; conn.send({ t: 'set', shapeKind: k }); update(); } } }, { rect: '▭', circle: '◯', arrow: '➜', line: '╱' }[k])),
        h('label.check', h('input', { type: 'checkbox', checked: st.shapeFill, on: { change: (e) => conn.send({ t: 'set', shapeFill: e.target.checked }) } }), ' ', t('shapeFilled'))));
      if (st.tool === 'laser') {
        const lt = h('input.input', { placeholder: t('laserWritePlaceholder'), value: st.laserText || '' });
        lt.addEventListener('change', () => conn.send({ t: 'set', laserText: lt.value }));
        optRow.append(h('div.row', h('span.lbl', '✍️ ' + t('laserWrite')), lt, h('button.chip.sm', { on: { click: () => { lt.value = ''; conn.send({ t: 'set', laserText: '' }); } } }, '✕')));
      }
      if (st.tool === 'spot') optRow.append(h('div.row', h('span.lbl', t('spotlightSize')), [0.1, 0.16, 0.24, 0.34].map((r, i) => h('button.chip.sm' + (Math.abs(st.spotR - r) < 0.01 ? '.on' : ''), { on: { click: () => conn.send({ t: 'set', spotR: r }) } }, ['S', 'M', 'L', 'XL'][i]))));
      if (st.tool === 'zoom') optRow.append(h('div.row', h('span.lbl', t('zoomHint')), [1, 1.5, 2, 3].map((z) => h('button.chip.sm' + (Math.abs(st.zoom - z) < 0.05 ? '.on' : ''), { on: { click: () => conn.send({ t: 'zoom', level: z, x: zoomAt[0], y: zoomAt[1] }) } }, z + '×'))));
      // video
      videoRow.innerHTML = '';
      if (st.cur.type === 'video') {
        videoRow.append(h('span.lbl', '🎬'),
          [['play', '▶'], ['pause', '⏸'], ['restart', '⏮'], ['mute', '🔇'], ['unmute', '🔊']].concat(st.cur.platform === 'file' || st.cur.platform === 'direct' ? [['back10', '−10s'], ['fwd10', '+10s']] : [])
            .map(([a, l]) => h('button.chip', { on: { click: () => conn.send({ t: 'video', a }) } }, l)));
      }
      // screen
      screenRow.innerHTML = '';
      screenRow.append(
        h('button.chip' + (st.screen === 'black' ? '.on' : ''), { on: { click: () => conn.send({ t: 'screen', mode: 'black' }) } }, '⬛ ' + t('black')),
        h('button.chip' + (st.screen === 'white' ? '.on' : ''), { on: { click: () => conn.send({ t: 'screen', mode: 'white' }) } }, '⬜ ' + t('white')),
        h('button.chip', { on: { click: () => conn.send({ t: 'fullscreen' }) } }, '⛶'));
      // timer
      const tm = st.timer;
      if (tm) {
        const el = (Date.now() - tm.at) / 1000;
        const v = tm.paused ? tm.left : tm.mode === 'down' ? Math.max(0, tm.left - el) : tm.left + el;
        timerEl.textContent = (tm.paused ? '⏸ ' : '⏱ ') + H.fmtTime(tm.mode === 'down' ? Math.ceil(v) : v);
        timerEl.classList.toggle('low', tm.mode === 'down' && v <= 10);
      } else { timerEl.textContent = '⏱'; timerEl.classList.remove('low'); }
      if (st.idx !== lastIdx) { lastIdx = st.idx; if (tab === 'notes' || tab === 'slides') renderTab(); }
      else if (tab === 'live' && !(tabBox.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) renderTab();
      H.$$('.r-tab', root).forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      if (tab !== lastTab) { lastTab = tab; }
    }
    setInterval(() => { if (st && st.timer && !st.timer.paused) update(); }, 1000);

    function setTab(k) { tab = k; H.settings.set('remoteTab', k); renderTab(); update(); }
    let camBusy = false;
    function renderTab() {
      if (!tabBox || !st) return;
      tabBox.innerHTML = '';
      H.$$('.r-tab', root).forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      if (tab === 'notes') {
        const ta = h('textarea.input', { rows: 5, placeholder: t('notesPlaceholder'), value: st.cur.notes || '' });
        const sv = h('span.muted.sm');
        const idx = st.idx;
        ta.addEventListener('input', H.debounce(() => { conn.send({ t: 'notes', i: idx, text: ta.value }); sv.textContent = t('saved') + ' ✓'; }, 600));
        tabBox.append(st.cur.fileNotes ? h('div', h('div.lbl', t('notesFromFile')), h('div.notes-file.big', st.cur.fileNotes)) : null,
          h('div.lbl', t('yourNotes')), ta, sv);
      } else if (tab === 'slides') {
        if (!slideList) { conn.send({ t: 'list' }); tabBox.append(h('p.muted', '…')); return; }
        tabBox.append(h('div.r-slides', slideList.map((s, i) => h('button.r-slide' + (i === st.idx ? '.on' : ''), { on: { click: () => { conn.send({ t: 'goto', i }); } } },
          h('b', String(i + 1)), h('span', s.title || s.type)))));
      } else if (tab === 'timer') {
        const custom = h('input.input.num', { type: 'number', min: 1, max: 180, value: 5 });
        tabBox.append(
          h('div.chips', [1, 2, 3, 5, 10, 15, 20, 30].map((n) => h('button.chip', { on: { click: () => conn.send({ t: 'timer', a: 'start', sec: n * 60 }) } }, n + ' ' + t('minShort')))),
          h('div.row', custom, h('button.btn', { on: { click: () => conn.send({ t: 'timer', a: 'start', sec: +custom.value * 60 }) } }, t('start'))),
          h('div.row.wrap',
            h('button.btn.ghost', { on: { click: () => conn.send({ t: 'timer', a: 'start', sec: 0 }) } }, '⏱ ' + t('stopwatch')),
            h('button.btn.ghost', { on: { click: () => conn.send({ t: 'timer', a: 'pause' }) } }, '⏯ ' + t('pause')),
            h('button.btn.danger', { on: { click: () => conn.send({ t: 'timer', a: 'stop' }) } }, t('clearTimer'))));
      } else if (tab === 'camera') {
        const inp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
        inp.addEventListener('change', async () => { if (inp.files[0]) { camBusy = true; renderTab(); await sendPhoto(inp.files[0]); } });
        tabBox.append(h('p.muted', t('cameraHint')), inp,
          h('button.btn.primary.lg.block', { disabled: camBusy, on: { click: () => inp.click() } }, camBusy ? t('sending') : '📷 ' + t('takePhoto')));
      } else if (tab === 'live') {
        const L = st.live || {};
        const sec = (title, ...k) => h('div.r-sec', h('div.lbl', title), ...k);
        const lv = (a, extra) => conn.send(Object.assign({ t: 'live', a }, extra || {}));
        const qz = L.quiz;
        tabBox.append(
          h('div.r-live-stats', h('span', '👥 ' + (L.count || 0)), h('span', '✋ ' + ((L.hands || []).length)), h('span', '😵 ' + (L.lost || 0)), h('span', '🐢 ' + (L.fast || 0)), h('span', '❓ ' + ((L.qna || []).length))),
          sec(t('onScreen'), h('div.row.wrap',
            h('button.chip' + (L.stage === 'join' ? '.on' : ''), { on: { click: () => lv('showJoin') } }, '📺 ' + t('joinQr')),
            h('button.chip' + (L.stage === 'qna' ? '.on' : ''), { on: { click: () => lv('qnaShow') } }, '❓ ' + t('qna')),
            h('button.chip', { on: { click: () => lv('pick') } }, '🎲 ' + t('randomPicker')),
            h('button.chip' + (L.reactions ? '.on' : ''), { on: { click: () => lv('reactions') } }, '💬 ' + t('reactionsTip')),
            L.stage ? h('button.chip', { on: { click: () => lv('hide') } }, '🏠 ' + t('backToSlides')) : null)),
          qz ? sec('🧠 ' + (qz.title || t('liveQuiz')) + ' · ' + t('phase_' + qz.phase),
            qz.text ? h('div.r-qtext', `${qz.qi + 1}/${qz.n} · ${qz.text}`) : null,
            h('div.muted.sm', t('nAnswered', { n: qz.answered })),
            h('div.row.wrap',
              qz.phase === 'lobby' ? h('button.btn.primary', { on: { click: () => lv('next') } }, '▶ ' + t('beginQuiz')) : null,
              qz.phase === 'q' ? h('button.btn.primary', { on: { click: () => lv('reveal') } }, '👁 ' + t('revealNow')) : null,
              ['reveal', 'board'].includes(qz.phase) ? h('button.btn.primary', { on: { click: () => lv('next') } }, '⏭ ' + (qz.qi + 1 >= qz.n ? t('finish') : t('nextQ'))) : null,
              qz.phase === 'reveal' ? h('button.btn', { on: { click: () => lv('board') } }, '🏆') : null,
              qz.phase === 'reveal' && ['open', 'cloud', 'ideas'].includes(qz.type) ? h('button.btn', { on: { click: () => lv('spotlight') } }, '🎲') : null,
              h('button.btn.ghost', { on: { click: () => lv('showQuiz') } }, '📺'),
              h('button.btn.danger', { on: { click: () => lv('end') } }, '✕ ' + t('endQuiz'))))
            : sec('🧠 ' + t('startAQuiz'), (L.quizzes || []).length ? h('div.r-list', L.quizzes.map((z) => h('button.r-li', { on: { click: () => lv('startQuiz', { id: z.id }) } }, h('span', z.title), h('small.muted', t('nQuestions', { n: z.n })), h('b', '▶')))) : h('p.muted.sm', t('noQuizzesRemote'))),
          (L.hands || []).length ? sec('✋ ' + t('handsUp'), h('div', L.hands.join(', ')), h('button.chip', { on: { click: () => lv('lowerHands') } }, t('lowerHands'))) : null,
          (L.lost || L.fast) ? sec(t('paceSignals'), h('div', `😵 ${t('paceLost')}: ${L.lost} · 🐢 ${t('paceFast')}: ${L.fast}`), h('button.chip', { on: { click: () => lv('resetPace') } }, t('resetPace'))) : null,
          (L.qna || []).length ? sec('❓ ' + t('qna'), h('div.r-list', L.qna.map((x) => h('div.r-li', h('b', '▲' + x.votes), h('span.grow', x.text),
            h('button.chip.sm', { on: { click: () => lv('qnaFocus', { id: x.id }) } }, '📺'),
            h('button.chip.sm', { on: { click: () => lv('qnaAnswered', { id: x.id }) } }, '✓'))))) : null);
      }
    }

    // ---------- photo to screen ----------
    async function sendPhoto(file) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image(); img.src = url; await img.decode();
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.8);
        const id = H.uid(6), CH = 48000, n = Math.ceil(data.length / CH);
        for (let i = 0; i < n; i++) { conn.send({ t: 'photo', id, i, n, part: data.slice(i * CH, (i + 1) * CH) }); if (i % 4 === 3) await H.sleep(30); }
      } catch (e) { H.toast(t('error'), 'err'); camBusy = false; renderTab(); } finally { URL.revokeObjectURL(url); }
    }

    // ---------- pad gestures ----------
    let liveOp = null, zoomAt = [0.5, 0.5];
    function bindPad() {
      let drag = null, buf = [], flushT = 0, lastPtr = 0;
      const pos = (e) => { const r = padCanvas.getBoundingClientRect(); return [H.clamp((e.clientX - r.left) / r.width, 0, 1), H.clamp((e.clientY - r.top) / r.height, 0, 1)]; };
      const flush = () => { if (drag && buf.length) { conn.send({ t: 'ink', a: 'pts', id: drag.id, pts: buf }); buf = []; } };
      padCanvas.addEventListener('pointerdown', (e) => {
        if (!st) return;
        e.preventDefault();
        padCanvas.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        const tool = st.tool;
        const size = (k) => (H.ink.SIZES[k] || H.ink.SIZES.pen)[st.sizeIx];
        if (tool === 'none') { drag = { swipe: true, x0: e.clientX, y0: e.clientY }; return; }
        if (tool === 'laser' || tool === 'spot') { drag = { ptr: true }; conn.send({ t: 'ptr', x, y, on: true }); return; }
        if (tool === 'pen' || tool === 'hl') {
          const id = H.uid(6);
          liveOp = { k: 'stroke', tool, c: st.color, w: size(tool), pts: [x, y] };
          drag = { id };
          conn.send({ t: 'ink', a: 'start', id, op: JSON.parse(JSON.stringify(liveOp)) });
          flushT = setInterval(flush, 45);
          return;
        }
        if (tool === 'shape') {
          const id = H.uid(6);
          liveOp = { k: 'shape', kind: st.shapeKind, c: st.color, w: size('shape'), fill: st.shapeFill, x1: x, y1: y, x2: x, y2: y };
          drag = { id, shape: true };
          conn.send({ t: 'ink', a: 'start', id, op: liveOp });
          return;
        }
        if (tool === 'erase') { drag = { erase: true }; conn.send({ t: 'erase', x, y, r: size('erase') }); return; }
        if (tool === 'num') { conn.send({ t: 'op', op: { k: 'num', x, y, c: st.color, s: size('text') } }); return; }
        if (tool === 'zoom') { zoomAt = [x, y]; conn.send({ t: 'zoom', level: st.zoom > 1 ? 1 : 2.2, x, y }); return; }
        if (tool === 'text') {
          H.prompt(t('textbox'), '', '', { placeholder: t('labelPlaceholder'), multiline: true }).then((v) => {
            if (v && v.trim()) conn.send({ t: 'op', op: { k: 'text', x, y, text: v.trim(), c: st.color, s: size('text') } });
          });
        }
      });
      padCanvas.addEventListener('pointermove', (e) => {
        if (!drag) return;
        e.preventDefault();
        const [x, y] = pos(e);
        if (drag.ptr) { const n = performance.now(); if (n - lastPtr > 28) { lastPtr = n; conn.send({ t: 'ptr', x, y, on: true }); } return; }
        if (drag.erase) { const n = performance.now(); if (n - lastPtr > 60) { lastPtr = n; conn.send({ t: 'erase', x, y, r: (H.ink.SIZES.erase)[st.sizeIx] }); } return; }
        if (drag.shape && liveOp) { liveOp.x2 = x; liveOp.y2 = y; H.ink.render(padCanvas, st.ink, liveOp); const n = performance.now(); if (n - lastPtr > 40) { lastPtr = n; conn.send({ t: 'ink', a: 'shape', id: drag.id, op: { x2: x, y2: y } }); } return; }
        if (drag.id && liveOp) { liveOp.pts.push(x, y); buf.push(x, y); H.ink.render(padCanvas, st.ink, liveOp); }
      });
      const end = (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        if (d.swipe) {
          const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { buzz(); conn.send({ t: dx < 0 ? 'next' : 'prev' }); }
          else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { buzz(); conn.send({ t: 'next' }); }
          return;
        }
        if (d.ptr) { if (st.tool === 'spot' || !H.settings.get('stickyLaser', false)) conn.send({ t: 'ptr', x: 0, y: 0, on: false }); return; }
        if (d.id) {
          clearInterval(flushT); flush();
          const op = liveOp; liveOp = null;
          if (d.shape && op && Math.abs(op.x2 - op.x1) < 0.01 && Math.abs(op.y2 - op.y1) < 0.01) {
            const a = st.cur.aspect || 16 / 9, w = 0.14, hh = w * a * (op.kind === 'rect' ? 0.6 : 1);
            if (op.kind === 'line' || op.kind === 'arrow') { op.x1 -= w / 2; op.x2 = op.x1 + w; op.y2 = op.y1; } else { op.x1 -= w / 2; op.y1 -= hh / 2; op.x2 = op.x1 + w; op.y2 = op.y1 + hh; }
          }
          conn.send({ t: 'ink', a: 'end', id: d.id, op: d.shape && op ? { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 } : undefined });
        }
      };
      padCanvas.addEventListener('pointerup', end);
      padCanvas.addEventListener('pointercancel', end);
    }

    // stay awake
    let wake = null;
    const reqWake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } };
    reqWake();
    document.addEventListener('visibilitychange', reqWake);
    const onResize = H.debounce(update, 150);
    window.addEventListener('resize', onResize);
    root.append(h('div.phone-msg', h('div.spinner'), h('p', t('connecting')), h('p.muted.sm', t('sessionCode') + ' ' + code)));

    return () => { conn.close(); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', reqWake); try { wake && wake.release(); } catch (e) { /* ignore */ } };
  };
})(window.Hub);
