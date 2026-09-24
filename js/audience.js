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
      onData: (m) => { if (m.t === 'aud') { const prevPicked = st && st.you && st.you.picked; st = m; onState(prevPicked); } },
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
        me.name ? h('button.aud-me', { on: { click: editMe } }, (me.emoji || H.emojiFor(pid)) + ' ' + me.name + (st && st.you && st.you.score ? ' · ' + st.you.score + ' ' + t('pts') : '')) : null,
        H.langToggle(() => { renderHead(); renderTabs(); lastKey = ''; renderBody(true); renderFoot(); }));
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
    function nameForm(first) {
      const name = h('input.input.big', { value: me.name, maxlength: 30, placeholder: t('namePlaceholder'), autocomplete: 'nickname' });
      let emoji = me.emoji || '';
      const grid = h('div.emoji-grid');
      const cats = Object.keys(H.EMOJI);
      let cat = cats[0];
      const catRow = h('div.chips');
      const drawGrid = () => {
        grid.innerHTML = ''; catRow.innerHTML = '';
        cats.forEach((c) => catRow.appendChild(h('button.chip.sm' + (c === cat ? '.on' : ''), { on: { click: () => { cat = c; drawGrid(); } } }, t('emo_' + c))));
        H.EMOJI[cat].forEach((e) => grid.appendChild(h('button.emo' + (e === emoji ? '.on' : ''), { on: { click: () => { emoji = e; drawGrid(); } } }, e)));
      };
      drawGrid();
      const go = () => {
        const n = name.value.trim();
        if (!n) { name.focus(); name.classList.add('shake'); setTimeout(() => name.classList.remove('shake'), 500); return; }
        me = { name: n, emoji }; H.settings.set('me', me);
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
      if (st.you && st.you.picked && !prevPicked) { buzz(300); pickedOverlay(); }
      renderBody();
    }
    function sliceKey() {
      if (!st) return 'none';
      const s = { tab, lang: H.lang, me: me.name };
      if (tab === 'quiz') { const qz = st.quiz ? JSON.parse(JSON.stringify(st.quiz)) : null; if (qz && qz.q) delete qz.q.left; s.q = qz; s.you = st.you && { score: st.you.score, rank: st.you.rank }; }
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
      if (qz.phase === 'board' || qz.phase === 'done') {
        return h('div.aud-board',
          h('h2', qz.phase === 'done' ? t('quizFinished') : '🏆 ' + t('leaderboard')),
          you.rank ? h('div.your-rank', t('yourRank') + ': ', h('b', '#' + you.rank), ' · ' + (you.score || 0) + ' ' + t('pts')) : null,
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

      if (['mcq', 'tf', 'poll'].includes(q.type)) {
        const tiles = h('div.tiles' + (q.options.length > 4 ? '.many' : ''));
        const max = rev && qz.reveal.c ? Math.max(1, ...qz.reveal.c) : 1;
        q.options.forEach((o, i) => {
          const chosen = my && my.v === i;
          const good = rev && q.type !== 'poll' && i === qz.reveal.correct;
          tiles.appendChild(h('button.tile' + (chosen ? '.chosen' : '') + (good ? '.good' : '') + (rev && q.type !== 'poll' && !good ? '.dim' : ''), {
            style: { '--c': H.live.TILE[i % 8] }, disabled: !!my || rev || sentFor[q.id],
            on: { click: () => { sentFor[q.id] = true; conn.send({ t: 'answer', qid: q.id, v: i }); buzz(30); lastKey = ''; st.quiz.my = { v: i }; renderBody(true); } },
          }, h('span.tile-shape', H.live.SHAPES[i % 8]), o.image ? h('img', { src: o.image, alt: '' }) : null, h('span.tile-text', o.text),
          rev && qz.reveal.c ? h('span.tile-count', String(qz.reveal.c[i])) : null,
          rev && qz.reveal.c ? h('span.tile-bar', h('i', { style: { width: qz.reveal.c[i] / max * 100 + '%' } })) : null));
        });
        box.append(tiles);
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
        if (['mcq', 'tf'].includes(q.type) || (q.type === 'open' && my && my.ok != null)) {
          if (!my) box.append(h('div.fb.none', t('noAnswer')));
          else box.append(h('div.fb' + (my.ok ? '.ok' : '.bad'), my.ok ? t('correct') : t('incorrect'), my.score ? h('b', ' +' + my.score + ' ' + t('pts')) : null));
          if (['mcq', 'tf'].includes(q.type) && q.options[qz.reveal.correct]) box.append(h('div.muted', t('correctAnswer') + ': ', h('b', q.options[qz.reveal.correct].text)));
        }
        if (qz.reveal.source) box.append(h('div.source', '📖 ' + t('source') + ': ' + qz.reveal.source));
        if (you.rank) box.append(h('div.muted.center', t('yourRank') + ' #' + you.rank + ' · ' + (you.score || 0) + ' ' + t('pts')));
      }
      return box;
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

    renderHead(); renderTabs(); renderBody(); renderFoot();
    return () => { conn.close(); clearInterval(tmr); };
  };

  function askCode(app) {
    const inp = h('input.input.big.code-in', { maxlength: 8, placeholder: 'ABC123', autocapitalize: 'characters' });
    const go = () => { const c = inp.value.trim().toUpperCase(); if (c) H.router.go('/join?s=' + c); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    app.appendChild(h('div.aud', h('div.card.join-card', h('div.aud-brand', '◆ Lectern'), h('h2', t('enterCode')), inp, h('button.btn.primary.lg.block', { on: { click: go } }, t('join')), H.langToggle())));
  }
})(window.Hub);
