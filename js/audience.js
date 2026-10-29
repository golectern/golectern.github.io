/* Lectern — audience (student) page: join, live quiz, Q&A, reactions, hand, pace, question bank */
(function (H) {
  'use strict';
  const { h, t } = H;
  const REACTS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🤔', '🎉', '💯', '🙏'];

  H.routes.join = async function (app, _p, q) {
    const code = String(q.s || '').toUpperCase();
    document.body.className = 'phone aud-page';
    document.title = 'Join · Lectern';
    if (!code) return askCode(app);

    let pid = H.settings.get('pid', '');
    if (!pid) { pid = 'p_' + H.uid(12); H.settings.set('pid', pid); }
    let me = H.settings.get('me', { name: '', emoji: '' });
    let st = null, tab = 'quiz', status = 'connecting';
    const drafts = { ask: '', open: '', idea: '', cloud: [], comment: {}, bank: { type: 'mcq', text: '', options: ['', '', '', ''], correct: 0 } };
    let lastKey = '', lastQid = null, sentFor = {};

    const root = h('div.aud');
    app.appendChild(root);
    const conn = H.net.join(code, { role: 'aud', pid, name: me.name, emoji: me.emoji }, {
      onStatus: (s) => { status = s; renderHead(); },
      onOpen: () => { if (me.name) conn.send({ t: 'join', name: me.name, emoji: me.emoji }); },
      onData: (m) => {
        if (m.t === 'aud') {
          const prevPicked = st && st.you && st.you.picked; st = m;
          // the teacher chooses the students' language
          if (m.lang && m.lang !== H.lang) { H.setLang(m.lang); const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName); lastKey = ''; renderBody(true); if (typing && !me.name) { const ni = H.$('input.input.big', body); if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); } } }
          onState(prevPicked);
        }
        else if (m.t === 'kicked' || m.t === 'locked') { conn.close(); st = null; root.innerHTML = ''; root.appendChild(h('div.center-msg', h('div.big-emoji', m.t === 'kicked' ? '🚪' : '🔐'), h('h3', t(m.t === 'kicked' ? 'kickedMsg' : 'lockedMsg')))); }
      },
    });

    const head = h('header.aud-head');
    const tabsEl = h('nav.aud-tabs');
    const body = h('main.aud-body');
    const foot = h('footer.aud-foot');
    root.append(head, tabsEl, body, foot);

    function renderHead() {
      head.innerHTML = '';
      head.append(
        h('div.aud-brand', '◆ Lectern', h('span.dot.' + status)),
        st && st.you && st.you.team ? h('span.aud-team', st.you.team) : null,
        me.name ? h('button.aud-me', { on: { click: editMe } }, (me.emoji || H.emojiFor(pid)) + ' ' + me.name + (st && st.you && st.you.score ? ' · ' + st.you.score + ' ' + t('pts') : '')) : null,
        h('button.btn.ghost.sm.a11y-btn', { title: t('display'), 'aria-label': t('display'), on: { click: displayMenu } }, 'Aa'),
        null);
      if (status !== 'online') head.append(h('div.aud-status', status === 'nohost' ? t('waitingHost') : t('net_' + status)));
    }
    function renderTabs() {
      tabsEl.innerHTML = '';
      const tabs = [['quiz', t('tabQuiz')], ['qna', t('tabQna')], ['react', t('tabReact')]];
      if (st && st.bank && st.bank.open) tabs.push(['bank', t('tabBank')]);
      tabs.forEach(([k, l]) => tabsEl.appendChild(h('button' + (tab === k ? '.on' : ''), { on: { click: () => { tab = k; renderTabs(); lastKey = ''; renderBody(true); } } }, l,
        k === 'quiz' && st && st.quiz && st.quiz.phase === 'q' && tab !== 'quiz' ? h('i.pulse') : null)));
    }
    function renderFoot() {
      const you = (st && st.you) || {};
      foot.innerHTML = '';
      foot.append(
        h('button.pace' + (you.hand ? '.on' : ''), { on: { click: () => { conn.send({ t: 'hand', up: !you.hand }); buzz(); } } }, '✋ ' + (you.hand ? t('lowerHand') : t('raiseHand'))),
        h('button.pace' + (you.pace === 'lost' ? '.on' : ''), { on: { click: () => conn.send({ t: 'pace', v: you.pace === 'lost' ? null : 'lost' }) } }, '😵 ' + t('imLost')),
        h('button.pace' + (you.pace === 'fast' ? '.on' : ''), { on: { click: () => conn.send({ t: 'pace', v: you.pace === 'fast' ? null : 'fast' }) } }, '🐢 ' + t('slowDown')));
    }
    function buzz(ms = 15) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

    // ---------- name / emoji ----------
    const nameDraft = {}; // keeps what the student typed if the screen is redrawn (e.g. language change)
    function nameForm(first) {
      const name = h('input.input.big', { value: nameDraft.name != null ? nameDraft.name : me.name, maxlength: 30, placeholder: t('namePlaceholder'), autocomplete: 'nickname' });
      name.addEventListener('input', () => { nameDraft.name = name.value; });
      let emoji = nameDraft.emoji != null ? nameDraft.emoji : me.emoji || '';
      const grid = h('div.emoji-grid');
      const cats = Object.keys(H.EMOJI);
      let cat = cats[0];
      const catRow = h('div.chips');
      const drawGrid = () => {
        grid.innerHTML = ''; catRow.innerHTML = '';
        cats.forEach((c) => catRow.appendChild(h('button.chip.sm' + (c === cat ? '.on' : ''), { on: { click: () => { cat = c; drawGrid(); } } }, t('emo_' + c))));
        H.EMOJI[cat].forEach((e) => grid.appendChild(h('button.emo' + (e === emoji ? '.on' : ''), { on: { click: () => { emoji = e; nameDraft.emoji = e; drawGrid(); } } }, e)));
      };
      drawGrid();
      const go = () => {
        const n = name.value.trim();
        if (!n) { name.focus(); name.classList.add('shake'); setTimeout(() => name.classList.remove('shake'), 500); return; }
        me = { name: n, emoji }; H.settings.set('me', me); nameDraft.name = nameDraft.emoji = null;
        conn.send({ t: 'join', name: n, emoji });
        renderHead(); lastKey = ''; renderBody(true);
      };
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div.card.join-card',
        h('h2', first ? '👋 ' + t('yourName') : t('editProfile')), name,
        h('div.lbl', t('pickEmoji')), catRow, grid,
        h('button.btn.primary.lg.block', { on: { click: go } }, first ? t('join') : t('save')));
    }
    function editMe() { body.innerHTML = ''; body.appendChild(nameForm(false)); lastKey = 'edit'; }

    // ---------- state → view ----------
    function onState(prevPicked) {
      renderHead(); renderTabs(); renderFoot();
      const qz = st.quiz;
      if (qz && qz.q && qz.q.id !== lastQid && qz.phase === 'q') { lastQid = qz.q.id; tab = 'quiz'; renderTabs(); buzz(40); drafts.open = ''; drafts.cloud = []; }
      if (qz && qz.self) spBase = { left: qz.self.left, qLeft: qz.self.qLeft, at: performance.now() };
      if (st.you && st.you.picked && !prevPicked) { buzz(300); pickedOverlay(); }
      renderBody();
    }
    function sliceKey() {
      if (!st) return 'none';
      const s = { tab, lang: H.lang, me: me.name };
      if (tab === 'quiz') { const qz = st.quiz ? JSON.parse(JSON.stringify(st.quiz)) : null; if (qz && qz.q) delete qz.q.left; if (qz && qz.self) { delete qz.self.left; delete qz.self.qLeft; } s.q = qz; s.you = st.you && { score: st.you.score, rank: st.you.rank }; }
      if (tab === 'qna') s.qna = st.qna;
      if (tab === 'bank') s.bank = st.bank;
      return JSON.stringify(s);
    }
    function renderBody(force) {
      if (lastKey === 'edit' && !force) return;
      if (!me.name) { if (lastKey !== 'name') { body.innerHTML = ''; body.appendChild(nameForm(true)); lastKey = 'name'; } return; }
      if (!st) { body.innerHTML = ''; body.appendChild(h('div.center-msg', h('div.spinner'), h('p', status === 'nohost' ? t('waitingHost') : t('connecting')), h('p.muted.sm', t('sessionCode') + ' ' + code))); lastKey = ''; return; }
      const key = sliceKey();
      if (!force && key === lastKey) { updateTimer(); return; }
      // don't wipe what the student is typing
      const ae = document.activeElement;
      if (!force && ae && body.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName) && tab !== 'quiz') return;
      if (!force && ae && body.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName) && tab === 'quiz' && st.quiz && st.quiz.phase === 'q' && lastKey.includes(st.quiz.q && st.quiz.q.id)) { lastKey = key; updateIdeasOnly(); return; }
      if (!force && ae && body.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName) && tab === 'quiz' && st.quiz && st.quiz.phase === 'self' && spViewing && spCurrentId() === spViewing) { lastKey = key; return; }
      lastKey = key;
      body.innerHTML = '';
      if (tab === 'quiz') body.appendChild(quizView());
      else if (tab === 'qna') body.appendChild(qnaView());
      else if (tab === 'react') body.appendChild(reactView());
      else if (tab === 'bank') body.appendChild(bankView());
      updateTimer();
    }

    // ---------- quiz ----------
    let timerStart = 0, timerLeft0 = null, timerTotal = 0;
    function updateTimer() {
      const bar = H.$('.q-timer i', body), num = H.$('.q-timer b', body);
      if (!st || !st.quiz || !st.quiz.q || st.quiz.phase !== 'q' || !st.quiz.q.time) return;
      if (st.quiz.q.left != null) { timerLeft0 = st.quiz.q.left; timerStart = performance.now(); timerTotal = st.quiz.q.time; }
      if (!bar) return;
      const left = Math.max(0, timerLeft0 - (performance.now() - timerStart) / 1000);
      bar.style.width = (left / timerTotal * 100) + '%';
      num.textContent = Math.ceil(left);
      bar.parentNode.classList.toggle('low', left <= 5);
    }
    const tmr = setInterval(updateTimer, 200);

    function quizView() {
      const qz = st.quiz;
      const you = st.you || {};
      if (!qz) return h('div.center-msg', h('div.big-emoji', '🧠'), h('h3', t('noQuiz')), h('p.muted', t('noQuizSub')));
      if (qz.phase === 'lobby') return h('div.center-msg', h('div.big-emoji', me.emoji || H.emojiFor(pid)), h('h3', t('youAreIn') + ' ' + me.name), h('p.muted', t('waitingStart')), h('div.spinner'));
      if (qz.phase === 'self') return selfView(qz.self);
      if (qz.phase === 'gap') return h('div.center-msg', h('div.big-emoji', '✓'), h('h3', t('answerSaved')), h('p.muted', t('nextComing')), h('div.spinner'));
      if (qz.phase === 'board' || qz.phase === 'done') {
        return h('div.aud-board',
          h('h2', qz.phase === 'done' ? t('quizFinished') : '🏆 ' + t('leaderboard')),
          you.rank ? h('div.your-rank', t('yourRank') + ': ', h('b', '#' + you.rank), ' · ' + (you.score || 0) + ' ' + t('pts')) : null,
          qz.teams ? h('ol.board-list.teams', qz.teams.map((x) => h('li' + (x.label === you.team ? '.me' : ''), h('span', x.label), h('b', String(x.score))))) : null,
          qz.review ? reviewList(qz.review) : null,
          h('ol.board-list', (qz.board || []).map((r) => h('li' + (r.name === me.name ? '.me' : ''), h('span', r.emoji + ' ' + r.name), h('b', String(r.score))))));
      }
      const q = qz.q;
      const box = h('div.aud-q');
      box.append(h('div.q-meta', h('span', t('question') + ' ' + (qz.qi + 1) + '/' + qz.n), q.points && ['mcq', 'tf', 'open'].includes(q.type) ? h('span', '🏆 ' + q.points) : null));
      if (qz.phase === 'q' && q.time) box.append(h('div.q-timer', h('i'), h('b')));
      box.append(h('div.q-text', q.text));
      if (q.image) box.append(h('img.q-img', { src: q.image, alt: '' }));
      const my = qz.my;
      const rev = qz.phase === 'reveal';
      // exam: once answered, hide the options so neighbours can't see the choice
      if (qz.exam && (my || sentFor[q.id]) && !['cloud', 'ideas'].includes(q.type)) { box.append(h('div.locked.exam-locked', '🔒 ' + t('answerSaved'))); return box; }

      if (['mcq', 'tf', 'poll'].includes(q.type)) {
        const tiles = h('div.tiles' + (q.options.length > 4 ? '.many' : ''));
        const max = rev && qz.reveal.c ? Math.max(1, ...qz.reveal.c) : 1;
        const order = q.shuffle ? shuffleOrder(q.id, q.options.length) : q.options.map((_, i) => i);
        order.forEach((i) => {
          const o = q.options[i];
          const chosen = my && my.v === i;
          const good = rev && q.type !== 'poll' && i === qz.reveal.correct;
          tiles.appendChild(h('button.tile' + (qz.exam ? '.plain' : '') + (chosen ? '.chosen' : '') + (good ? '.good' : '') + (rev && q.type !== 'poll' && !good ? '.dim' : ''), {
            style: qz.exam ? null : { '--c': H.live.TILE[i % 8] }, disabled: !!my || rev || sentFor[q.id],
            on: { click: () => { sentFor[q.id] = true; conn.send({ t: 'answer', qid: q.id, v: i }); buzz(30); lastKey = ''; st.quiz.my = { v: i }; renderBody(true); } },
          }, qz.exam ? null : h('span.tile-shape', H.live.SHAPES[i % 8]), o.image ? h('img', { src: o.image, alt: '' }) : null, h('span.tile-text', o.text),
          rev && qz.reveal.c ? h('span.tile-count', String(qz.reveal.c[i])) : null,
          rev && qz.reveal.c ? h('span.tile-bar', h('i', { style: { width: qz.reveal.c[i] / max * 100 + '%' } })) : null));
        });
        box.append(tiles);
      } else if (q.type === 'order') {
        // arrange with ↑ ↓; the answer is the list of positions in the order received
        const n = q.options.length;
        const key = 'order:' + q.id;
        if (!drafts[key] || drafts[key].length !== n) drafts[key] = shuffleOrder(q.id + '#o', n).slice();
        const cur = drafts[key];
        const done = !!my || rev || sentFor[q.id];
        const list = h('div.order-list');
        const draw = () => {
          list.innerHTML = '';
          cur.forEach((j, pos) => list.appendChild(h('div.order-row' + (qz.exam ? '.plain' : ''),
            h('b.order-pos', String(pos + 1)), h('span.order-text', q.options[j].text),
            done ? null : h('button.order-btn', { disabled: pos === 0, 'aria-label': '↑', on: { click: () => { [cur[pos - 1], cur[pos]] = [cur[pos], cur[pos - 1]]; draw(); } } }, '↑'),
            done ? null : h('button.order-btn', { disabled: pos === n - 1, 'aria-label': '↓', on: { click: () => { [cur[pos + 1], cur[pos]] = [cur[pos], cur[pos + 1]]; draw(); } } }, '↓'))));
        };
        draw();
        box.append(list);
        if (!done) box.append(h('button.btn.primary.lg.block', { on: { click: () => { sentFor[q.id] = true; conn.send({ t: 'answer', qid: q.id, v: cur.slice() }); buzz(30); st.quiz.my = { v: cur.slice() }; lastKey = ''; renderBody(true); } } }, t('send')));
        if (rev && qz.reveal.order) box.append(h('div.muted', t('correctAnswer') + ': ', h('b', qz.reveal.order.join(' → '))));
      } else if (q.type === 'scale') {
        const n = q.scaleMax || 5, labels = String(q.scaleLabels || '').split('|');
        box.append(h('div.scale-btns', Array.from({ length: n }, (_, i) => h('button.sbtn' + (my && my.v === i + 1 ? '.chosen' : ''), { disabled: !!my || rev, on: { click: () => { sentFor[q.id] = true; conn.send({ t: 'answer', qid: q.id, v: i + 1 }); buzz(30); st.quiz.my = { v: i + 1 }; lastKey = ''; renderBody(true); } } }, String(i + 1)))),
        h('div.scale-labels', h('span', labels[0] || ''), h('span', labels[1] || '')));
        if (rev && qz.reveal.avg) box.append(h('p.center', t('average') + ': ', h('b', qz.reveal.avg.toFixed(2))));
      } else if (q.type === 'open') {
        if (!my && !rev) {
          const ta = h('textarea.input', { rows: 3, maxlength: 500, placeholder: t('typeAnswer'), value: drafts.open });
          ta.addEventListener('input', () => { drafts.open = ta.value; });
          box.append(ta, h('button.btn.primary.lg.block', { on: { click: () => { if (!ta.value.trim()) return; conn.send({ t: 'answer', qid: q.id, v: ta.value.trim() }); buzz(30); st.quiz.my = { v: ta.value.trim() }; lastKey = ''; renderBody(true); } } }, t('send')));
        } else if (my) box.append(h('div.my-answer', '“' + my.v + '”'));
      } else if (q.type === 'cloud') {
        if (!rev) {
          const n = q.maxPer || 3;
          const ins = Array.from({ length: n }, (_, i) => { const x = h('input.input', { maxlength: 40, placeholder: t('wordN', { n: i + 1 }), value: drafts.cloud[i] || (my && my.v && my.v[i]) || '' }); x.addEventListener('input', () => { drafts.cloud[i] = x.value; }); return x; });
          box.append(h('div.cloud-ins', ins), h('button.btn.primary.lg.block', { on: { click: () => { const v = ins.map((x) => x.value.trim()).filter(Boolean); if (!v.length) return; conn.send({ t: 'answer', qid: q.id, v }); buzz(30); H.toast(t('sent') + ' ✓', 'ok'); } } }, my ? t('update') : t('send')));
        } else if (my) box.append(h('div.my-answer', (my.v || []).join(', ')));
      } else if (q.type === 'ideas') {
        box.append(ideasBox(q, rev));
      }
      // feedback
      if (my && !rev && !['ideas', 'cloud'].includes(q.type)) box.append(h('div.locked', '🔒 ' + t('answerLocked')));
      if (rev) {
        if (['mcq', 'tf', 'order'].includes(q.type) || (q.type === 'open' && my && my.ok != null)) {
          if (!my) box.append(h('div.fb.none', t('noAnswer')));
          else box.append(h('div.fb' + (my.ok ? '.ok' : '.bad'), my.ok ? t('correct') : t('incorrect'), my.score ? h('b', ' +' + my.score + ' ' + t('pts')) : null, my.ok && my.streak >= 2 ? h('div.streak', '🔥 ' + t('streakN', { n: my.streak })) : null));
          if (['mcq', 'tf'].includes(q.type) && q.options[qz.reveal.correct]) box.append(h('div.muted', t('correctAnswer') + ': ', h('b', q.options[qz.reveal.correct].text)));
        }
        if (qz.reveal.source) box.append(h('div.source', '📖 ' + t('source') + ': ' + qz.reveal.source));
        if (you.rank) box.append(h('div.muted.center', t('yourRank') + ' #' + you.rank + ' · ' + (you.score || 0) + ' ' + t('pts')));
      }
      return box;
    }
    // exam: same option order for this student every time (seeded by student id + question id)
    const orders = {};
    function shuffleOrder(qid, n) {
      const key = qid + ':' + n;
      if (orders[key]) return orders[key];
      let seed = 2166136261;
      for (const c of pid + '|' + qid) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
      const a = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return (orders[key] = a);
    }
    // ---------------- self-paced exam ----------------
    let spIdx = 0, spReview = false, spViewing = null, spBase = null;
    const spCurrentId = () => { const S = st.quiz && st.quiz.self; if (!S || !S.questions || !S.questions.length) return null; return S.noBack ? S.questions[0].id : (S.questions[Math.min(spIdx, S.questions.length - 1)] || {}).id; };
    const spTimer = setInterval(() => {
      const el = H.$('.sp-timer', body);
      if (!el || !spBase) return;
      const gone = (performance.now() - spBase.at) / 1000;
      const v = spBase.qLeft != null ? spBase.qLeft - gone : spBase.left != null ? spBase.left - gone : null;
      if (v == null) { el.textContent = ''; return; }
      el.textContent = '⏱ ' + H.fmtTime(Math.max(0, v));
      el.classList.toggle('low', v <= (spBase.qLeft != null ? 5 : 60));
    }, 300);
    function spSend(qid, v) {
      conn.send({ t: 'sp', a: 'answer', qid, v });
      st.quiz.self.answers[qid] = v; buzz(25); lastKey = ''; renderBody(true);
    }
    function selfView(S) {
      if (!S || S.waiting) return h('div.center-msg', h('div.spinner'), h('p', t('waitingStart')));
      if (S.submitted) return h('div.center-msg', h('div.big-emoji', '✅'), h('h3', t('submitted')), h('p.muted', t('submittedSub')));
      const box = h('div.aud-q.sp');
      const Q = S.questions;
      if (!Q.length) return h('div.center-msg', h('div.spinner'));
      const n = S.n;
      if (!S.noBack && spReview) {
        const un = S.questions.filter((q) => S.answers[q.id] === undefined).length;
        box.append(h('div.q-meta', h('span', t('reviewSubmit')), h('span.sp-timer')),
          h('div.sp-chips.big', Q.map((q, i) => h('button.sp-chip' + (S.answers[q.id] !== undefined ? '.done' : '') + (S.flags.includes(q.id) ? '.flag' : ''), { on: { click: () => { spIdx = i; spReview = false; lastKey = ''; renderBody(true); } } }, String(i + 1)))),
          h('p.muted', un ? t('nUnanswered', { n: un }) : t('allAnswered')),
          S.flags.length ? h('p.muted', '🚩 ' + t('nFlagged', { n: S.flags.length })) : null,
          h('button.btn.lg.block', { on: { click: () => { spReview = false; lastKey = ''; renderBody(true); } } }, (H.lang === 'ku' ? '▶ ' : '◀ ') + t('backToQuestions')),
          h('button.btn.primary.lg.block', { on: { click: async () => { if (await H.confirm(t('submitExam'), un ? t('submitWarn', { n: un }) : t('submitSure'))) { conn.send({ t: 'sp', a: 'submit' }); buzz(60); } } } }, '📨 ' + t('submitExam')));
        spViewing = null;
        return box;
      }
      const i = S.noBack ? 0 : Math.min(spIdx, Q.length - 1);
      const q = Q[i];
      const pos = S.noBack ? S.cur : i;
      spViewing = q.id;
      const mine = S.answers[q.id];
      box.append(h('div.q-meta', h('span', t('question') + ' ' + (pos + 1) + '/' + n), h('span.sp-timer')));
      if (!S.noBack) box.append(h('div.sp-chips', Q.map((x, k) => h('button.sp-chip' + (k === i ? '.cur' : '') + (S.answers[x.id] !== undefined ? '.done' : '') + (S.flags.includes(x.id) ? '.flag' : ''), { 'aria-label': String(k + 1), on: { click: () => { spIdx = k; lastKey = ''; renderBody(true); } } }, String(k + 1)))));
      box.append(h('div.q-text', q.text));
      if (q.image) box.append(h('img.q-img', { src: q.image, alt: '' }));
      const locked = S.noBack && mine !== undefined;
      if (locked) box.append(h('div.locked.exam-locked', '🔒 ' + t('answerSaved')));
      else if (['mcq', 'tf', 'poll'].includes(q.type)) {
        const order = q.shuffle ? shuffleOrder(q.id, q.options.length) : q.options.map((_, k) => k);
        box.append(h('div.tiles' + (q.options.length > 4 ? '.many' : ''), order.map((k) => h('button.tile.plain' + (mine === k ? '.chosen' : ''), { on: { click: () => spSend(q.id, k) } },
          q.options[k].image ? h('img', { src: q.options[k].image, alt: '' }) : null, h('span.tile-text', q.options[k].text)))));
      } else if (q.type === 'scale') {
        box.append(h('div.scale-btns', Array.from({ length: q.scaleMax || 5 }, (_, k) => h('button.sbtn' + (mine === k + 1 ? '.chosen' : ''), { on: { click: () => spSend(q.id, k + 1) } }, String(k + 1)))));
      } else if (q.type === 'open') {
        const dk = 'sp:' + q.id;
        if (drafts[dk] == null) drafts[dk] = mine || '';
        const ta = h('textarea.input', { rows: 3, maxlength: 500, placeholder: t('typeAnswer'), value: drafts[dk] });
        ta.addEventListener('input', () => { drafts[dk] = ta.value; });
        box.append(ta, h('button.btn.primary.block', { on: { click: () => { if (ta.value.trim()) spSend(q.id, ta.value.trim()); } } }, mine !== undefined ? '✓ ' + t('update') : t('save')));
      } else if (q.type === 'cloud') {
        const ins = Array.from({ length: q.maxPer || 3 }, (_, k) => h('input.input', { maxlength: 40, placeholder: t('wordN', { n: k + 1 }), value: (mine && mine[k]) || '' }));
        box.append(h('div.cloud-ins', ins), h('button.btn.primary.block', { on: { click: () => { const v = ins.map((x) => x.value.trim()).filter(Boolean); if (v.length) spSend(q.id, v); } } }, t('save')));
      } else if (q.type === 'order') {
        const dk = 'sp-order:' + q.id, m = q.options.length;
        if (!drafts[dk] || drafts[dk].length !== m) drafts[dk] = Array.isArray(mine) ? mine.slice() : shuffleOrder(q.id + '#o', m).slice();
        const cur = drafts[dk];
        const list = h('div.order-list');
        const draw = () => { list.innerHTML = ''; cur.forEach((j, p2) => list.appendChild(h('div.order-row.plain', h('b.order-pos', String(p2 + 1)), h('span.order-text', q.options[j].text),
          h('button.order-btn', { disabled: p2 === 0, on: { click: () => { [cur[p2 - 1], cur[p2]] = [cur[p2], cur[p2 - 1]]; draw(); } } }, '↑'),
          h('button.order-btn', { disabled: p2 === m - 1, on: { click: () => { [cur[p2 + 1], cur[p2]] = [cur[p2], cur[p2 + 1]]; draw(); } } }, '↓')))); };
        draw();
        box.append(list, h('button.btn.primary.block', { on: { click: () => spSend(q.id, cur.slice()) } }, mine !== undefined ? '✓ ' + t('update') : t('save')));
      }
      if (!S.noBack) {
        if (mine !== undefined) box.append(h('p.muted.center.sm', '✓ ' + t('answerSaved')));
        box.append(h('div.sp-nav',
          h('button.btn', { disabled: i === 0, on: { click: () => { spIdx = i - 1; lastKey = ''; renderBody(true); } } }, H.lang === 'ku' ? '▶' : '◀'),
          h('button.btn' + (S.flags.includes(q.id) ? '.flagged' : '.ghost'), { on: { click: () => { conn.send({ t: 'sp', a: 'flag', qid: q.id }); const f = S.flags; const x = f.indexOf(q.id); if (x >= 0) f.splice(x, 1); else f.push(q.id); lastKey = ''; renderBody(true); } } }, '🚩 ' + t('flag')),
          i < Q.length - 1 ? h('button.btn.primary', { on: { click: () => { spIdx = i + 1; lastKey = ''; renderBody(true); } } }, H.lang === 'ku' ? '◀' : '▶') : h('button.btn.primary', { on: { click: () => { spReview = true; lastKey = ''; renderBody(true); } } }, t('reviewSubmit'))));
      }
      return box;
    }
    function reviewList(items) {
      return h('div.review', h('h3', '📋 ' + t('review')), items.map((r, i) => h('div.rv-item' + (r.ok === true ? '.ok' : r.ok === false ? '.bad' : ''),
        h('div.rv-q', h('b', (i + 1) + '. '), r.text),
        h('div.rv-line', t('yourAnswer') + ': ', h('b', r.mine == null || r.mine === '' ? '—' : r.mine), r.ok === true ? ' ✅' : r.ok === false ? ' ❌' : '', r.score ? h('span.rv-pts', ' +' + r.score + ' ' + t('pts')) : null),
        r.correct != null && r.ok !== true ? h('div.rv-line', t('correctAnswerLbl') + ': ', h('b', r.correct)) : null,
        r.source ? h('div.rv-src', '📖 ' + r.source) : null)));
    }
    function ideasBox(q, closed) {
      const wrapI = h('div.ideas-box');
      const qz = st.quiz;
      const mine = (qz.ideas || []).filter((i) => i.mine).length;
      if (!closed && mine < (q.maxPer || 3)) {
        const ta = h('textarea.input', { rows: 2, maxlength: 300, placeholder: t('ideaPh'), value: drafts.idea });
        ta.addEventListener('input', () => { drafts.idea = ta.value; });
        wrapI.append(ta, h('button.btn.primary.block', { on: { click: () => { if (!ta.value.trim()) return; conn.send({ t: 'idea', qid: q.id, text: ta.value.trim() }); drafts.idea = ''; ta.value = ''; buzz(20); } } }, '💡 ' + t('postIdea')),
          h('p.hint', t('ideasLeft', { n: (q.maxPer || 3) - mine })));
      }
      const list = h('div.ideas-list');
      wrapI.append(list);
      fillIdeas(list, q, closed);
      return wrapI;
    }
    function fillIdeas(list, q, closed) {
      list.innerHTML = '';
      const L = st.quiz.ideas || [];
      if (!L.length) list.append(h('p.muted', t('noIdeasYet')));
      L.forEach((i) => {
        const cIn = h('input.input.sm', { placeholder: t('commentPh'), maxlength: 200, value: drafts.comment[i.id] || '' });
        cIn.addEventListener('input', () => { drafts.comment[i.id] = cIn.value; });
        list.append(h('div.idea' + (i.mine ? '.mine' : ''),
          h('div.idea-text', i.text), h('div.idea-by', i.emoji + ' ' + i.by),
          h('div.idea-actions',
            h('button.chip.sm' + (i.myReact ? '.on' : ''), { disabled: i.mine || closed, on: { click: () => conn.send({ t: 'ideaReact', qid: q.id, id: i.id, e: '❤️' }) } }, '❤ ' + i.reacts),
            h('span.muted.sm', '💬 ' + i.comments.length)),
          i.comments.length ? h('div.idea-comments', i.comments.map((c) => h('div', h('b', c.by + ': '), c.text))) : null,
          !closed ? h('div.row', cIn, h('button.chip.sm', { on: { click: () => { if (!cIn.value.trim()) return; conn.send({ t: 'ideaComment', qid: q.id, id: i.id, text: cIn.value.trim() }); drafts.comment[i.id] = ''; cIn.value = ''; } } }, t('send'))) : null));
      });
    }
    function updateIdeasOnly() {
      const list = H.$('.ideas-list', body);
      const q = st.quiz && st.quiz.q;
      if (list && q && q.type === 'ideas') {
        const ae = document.activeElement;
        if (ae && list.contains(ae)) return; // typing a comment
        fillIdeas(list, q, st.quiz.phase !== 'q');
      }
    }

    // ---------- Q&A ----------
    function qnaView() {
      const Q = st.qna;
      const box = h('div.aud-qna');
      if (Q.open) {
        const ta = h('textarea.input', { rows: 3, maxlength: 280, placeholder: t('askQuestion'), value: drafts.ask });
        ta.addEventListener('input', () => { drafts.ask = ta.value; });
        box.append(ta, h('button.btn.primary.block', { on: { click: () => {
          if (!ta.value.trim()) return;
          conn.send({ t: 'ask', text: ta.value.trim() }); drafts.ask = ''; ta.value = ''; H.toast(t('sent') + ' ✓', 'ok'); buzz(20);
        } } }, t('sendQuestion')), h('p.hint', '🕶 ' + t('anonHint')));
      } else box.append(h('p.muted', t('questionsClosed')));
      if (!Q.list.length) box.append(h('p.muted', t('noQuestionsYet')));
      Q.list.forEach((x) => box.append(h('div.qna-card' + (x.answered ? '.done' : '') + (x.mine ? '.mine' : ''),
        h('button.vote' + (x.voted ? '.on' : ''), { disabled: x.mine, on: { click: () => conn.send({ t: 'vote', id: x.id }) } }, '▲', h('b', String(x.votes))),
        h('div.grow', x.text, x.answered ? h('div.muted.sm', '✓ ' + t('answered')) : null))));
      return box;
    }

    // ---------- reactions ----------
    function reactView() {
      return h('div.aud-react', h('p.muted.center', t('tapReact')),
        h('div.react-grid', REACTS.map((e) => h('button.react', { on: { click: (ev) => {
          conn.send({ t: 'react', e }); buzz(10);
          const b = ev.currentTarget; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        } } }, e))));
    }

    // ---------- question bank ----------
    function bankView() {
      const B = st.bank, d = drafts.bank;
      const box = h('div.aud-bank', h('p.muted', t('bankIntro')));
      if (B.mine.length >= B.max) box.append(h('p.fb.none', t('bankLimitReached')));
      else {
        const type = h('div.chips', ['mcq', 'tf'].map((ty) => h('button.chip' + (d.type === ty ? '.on' : ''), { on: { click: () => { d.type = ty; d.correct = 0; lastKey = ''; renderBody(true); } } }, ty === 'mcq' ? t('bankMCQ') : t('bankTrueFalse'))));
        const text = h('textarea.input', { rows: 2, maxlength: 200, placeholder: t('bankQuestionPlaceholder'), value: d.text });
        text.addEventListener('input', () => { d.text = text.value; });
        const opts = h('div.opts');
        const labels = d.type === 'tf' ? [t('true'), t('false')] : d.options;
        labels.forEach((o, i) => {
          const inp = d.type === 'tf' ? h('span.opt-fixed', o) : h('input.input', { value: o, maxlength: 120, placeholder: t('optionN', { n: i + 1 }) });
          if (d.type !== 'tf') inp.addEventListener('input', () => { d.options[i] = inp.value; });
          opts.append(h('div.opt-row', h('button.radio' + (d.correct === i ? '.on' : ''), { on: { click: () => { d.correct = i; lastKey = ''; renderBody(true); } } }, d.correct === i ? '✓' : ''), inp));
        });
        if (d.type === 'mcq' && d.options.length < 6) opts.append(h('button.chip.sm', { on: { click: () => { d.options.push(''); lastKey = ''; renderBody(true); } } }, t('bankAddOption')));
        box.append(h('div.lbl', t('bankType')), type, text, h('p.hint', t('bankMarkCorrect')), opts,
          h('button.btn.primary.block', { on: { click: () => {
            if (!d.text.trim()) return;
            const q = d.type === 'tf' ? { type: 'tf', text: d.text, correct: d.correct } : { type: 'mcq', text: d.text, options: d.options.filter((o) => o.trim()).map((o) => ({ text: o })), correct: d.correct };
            if (q.type === 'mcq' && q.options.length < 2) { H.toast(t('needOptions'), 'err'); return; }
            conn.send({ t: 'bank', q });
            drafts.bank = { type: d.type, text: '', options: ['', '', '', ''], correct: 0 };
            H.toast(t('bankSent'), 'ok'); lastKey = ''; renderBody(true);
          } } }, t('bankSubmit')));
      }
      if (B.mine.length) box.append(h('div.lbl', t('bankYourQuestions') + ` (${B.mine.length}/${B.max})`), h('ul', B.mine.map((m) => h('li', m.text))));
      return box;
    }

    function pickedOverlay() {
      const o = h('div.picked-overlay', { on: { click: () => o.remove() } }, h('div.big-emoji', '🎲'), h('h2', t('youWerePicked')), h('p', t('tapToClose')));
      document.body.appendChild(o);
      H.confetti(o, 60);
      setTimeout(() => o.remove(), 6000);
    }

    // display options (per phone): text size and high contrast
    function applyDisplay() {
      document.documentElement.style.fontSize = document.body.style.fontSize = (15 * H.settings.get('audFont', 1)) + 'px';
      document.body.classList.toggle('hc', !!H.settings.get('audContrast', false));
    }
    function displayMenu() {
      const m = H.modal('Aa ' + t('display'), [
        h('div.lbl', t('textSize')),
        h('div.chips', [[1, 'A'], [1.15, 'A+'], [1.3, 'A++'], [1.5, 'A+++']].map(([v, l]) => h('button.chip' + (H.settings.get('audFont', 1) === v ? '.on' : ''), { on: { click: () => { H.settings.set('audFont', v); applyDisplay(); m.close(); displayMenu(); } } }, l))),
        h('label.check', h('input', { type: 'checkbox', checked: !!H.settings.get('audContrast', false), on: { change: (e) => { H.settings.set('audContrast', e.target.checked); applyDisplay(); } } }), ' ', t('highContrast')),
      ]);
    }
    applyDisplay();
    // exam: tell the teacher if the student leaves the quiz screen during a question
    const onHide = () => { if (document.visibilityState === 'hidden' && st && st.quiz && st.quiz.exam && (st.quiz.phase === 'q' || (st.quiz.phase === 'self' && st.quiz.self && !st.quiz.self.submitted))) conn.send({ t: 'away', qid: spViewing }); };
    document.addEventListener('visibilitychange', onHide);
    renderHead(); renderTabs(); renderBody(); renderFoot();
    return () => { conn.close(); clearInterval(tmr); clearInterval(spTimer); document.removeEventListener('visibilitychange', onHide); document.documentElement.style.fontSize = document.body.style.fontSize = ''; document.body.classList.remove('hc'); };
  };

  function askCode(app) {
    const inp = h('input.input.big.code-in', { maxlength: 8, placeholder: 'ABC123', autocapitalize: 'characters' });
    const go = () => { const c = inp.value.trim().toUpperCase(); if (c) H.router.go('/join?s=' + c); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    app.appendChild(h('div.aud', h('div.card.join-card', h('div.aud-brand', '◆ Lectern'), h('h2', t('enterCode')), inp, h('button.btn.primary.lg.block', { on: { click: go } }, t('join')))));
  }
})(window.Hub);
