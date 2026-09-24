/* Lectern — live audience engine (runs on the presenter's computer)
   participants, live quizzes (MCQ, True/False, poll, open, word cloud, idea wall, rating scale),
   Q&A, reactions, raised hands, pace signals, student question bank, random picker, attendance */
(function (H) {
  'use strict';
  const { h, t } = H;
  const TILE = ['#e11d48', '#2563eb', '#d97706', '#059669', '#7c3aed', '#db2777', '#0891b2', '#65a30d'];
  const SHAPES = ['▲', '◆', '●', '■', '★', '⬟', '⬢', '✚'];
  H.live = {};
  H.live.TILE = TILE; H.live.SHAPES = SHAPES;

  H.live.create = function ({ net, wrap, lesson, getCode, onChange }) {
    const P = {};              // participants by pid
    const connPid = new Map(); // connectionId -> pid
    const qna = [];            // {id,pid,text,at,votes:Set,answered}
    const bank = [];           // student-submitted questions
    let qnaOpen = true, bankOpen = true, bankMax = 3, reactOn = H.settings.get('showReactions', true);
    let run = null;            // running quiz
    let stageMode = null;      // 'join' | 'quiz' | 'qna' | 'pick' | null
    let qnaFocus = null, pickedPid = null;
    const lastReact = {};
    const sessionStart = Date.now();

    const stage = h('div.live-stage');
    const reactLayer = h('div.react-layer');
    wrap.appendChild(stage); wrap.appendChild(reactLayer);

    const changed = () => { onChange && onChange(); pushAud(); renderStage(); refreshPanel(); };

    // ---------------- participants ----------------
    function join(conn) {
      const md = conn.metadata || {};
      const pid = String(md.pid || conn.peer).slice(0, 40);
      connPid.set(conn.connectionId, pid);
      const p = P[pid] || (P[pid] = { pid, name: '', emoji: '', joinedAt: Date.now(), score: 0, correct: 0, incorrect: 0, hand: false, pace: null, conns: new Set(), picks: 0 });
      p.conns.add(conn.connectionId);
      if (md.name) p.name = String(md.name).slice(0, 30);
      if (md.emoji) p.emoji = String(md.emoji).slice(0, 8);
      p.lastSeen = Date.now();
      sendTo(pid);
      changed();
    }
    function leave(conn) {
      const pid = connPid.get(conn.connectionId);
      connPid.delete(conn.connectionId);
      const p = P[pid];
      if (p) { p.conns.delete(conn.connectionId); if (!p.conns.size) { p.hand = false; p.pace = null; } }
      changed();
    }
    const online = () => Object.values(P).filter((p) => p.conns.size);
    const named = () => Object.values(P).filter((p) => p.name);
    const nameOf = (pid) => (P[pid] && P[pid].name) || t('anonymous');
    const emojiOf = (pid) => (P[pid] && P[pid].emoji) || H.emojiFor(pid);

    // ---------------- messages from phones ----------------
    function data(conn, m) {
      const pid = connPid.get(conn.connectionId);
      const p = P[pid];
      if (!p || !m) return;
      p.lastSeen = Date.now();
      switch (m.t) {
        case 'join':
          p.name = String(m.name || '').trim().slice(0, 30);
          p.emoji = String(m.emoji || '').slice(0, 8);
          break;
        case 'answer': answer(p, m); break;
        case 'ask':
          if (!qnaOpen) return;
          if (qna.filter((q) => q.pid === pid).length >= 10) return;
          qna.push({ id: H.uid(8), pid, text: String(m.text || '').trim().slice(0, 280), at: Date.now(), votes: new Set(), answered: false });
          H.beep(1200, 60);
          break;
        case 'vote': { const q = qna.find((x) => x.id === m.id); if (q && q.pid !== pid) q.votes.has(pid) ? q.votes.delete(pid) : q.votes.add(pid); break; }
        case 'react':
          if (Date.now() - (lastReact[pid] || 0) < 600) return;
          lastReact[pid] = Date.now();
          if (reactOn) floatEmoji(String(m.e || '👍').slice(0, 8));
          return; // no state change
        case 'hand': p.hand = !!m.up; if (p.hand) H.beep(660, 90); break;
        case 'pace': p.pace = ['lost', 'fast'].includes(m.v) ? m.v : null; break;
        case 'bank': {
          if (!bankOpen) return;
          const mine = bank.filter((b) => b.pid === pid).length;
          if (mine >= bankMax) return;
          const q = sanitizeQ(m.q);
          if (!q) return;
          bank.push({ id: H.uid(8), pid, author: p.name, q, at: Date.now() });
          break;
        }
        case 'idea': ideaPost(p, m); break;
        case 'ideaComment': ideaComment(p, m); break;
        case 'ideaReact': ideaReact(p, m); break;
        default: return;
      }
      changed();
    }
    function sanitizeQ(q) {
      if (!q || !q.text) return null;
      const type = q.type === 'tf' ? 'tf' : 'mcq';
      const options = type === 'tf' ? [{ text: t('true') }, { text: t('false') }] : (q.options || []).slice(0, 6).map((o) => ({ text: String(o.text || o || '').slice(0, 120) })).filter((o) => o.text.trim());
      if (type === 'mcq' && options.length < 2) return null;
      const correct = H.clamp(parseInt(q.correct, 10) || 0, 0, options.length - 1);
      return { id: 'q_' + H.uid(6), type, text: String(q.text).slice(0, 200), options, correct };
    }

    // ---------------- quiz runtime ----------------
    const curQ = () => run && run.quiz.questions[run.qi];
    const isScored = (q) => q && ['mcq', 'tf'].includes(q.type) || q && q.type === 'open' && (q.accept || q.scoring === 'manual');
    function startQuiz(quiz, opts = {}) {
      if (!quiz || !(quiz.questions || []).length) { H.toast(t('quizEmpty'), 'err'); return; }
      run = { quiz: JSON.parse(JSON.stringify(quiz)), qi: -1, phase: 'lobby', answers: {}, ideas: {}, confetti: true, subject: opts.subject || quiz.subject || '', startedAt: Date.now(), spotlight: null };
      Object.values(P).forEach((p) => { p.score = 0; p.correct = 0; p.incorrect = 0; });
      stageMode = 'quiz';
      changed();
    }
    function nextQ() {
      if (!run) return;
      if (run.phase === 'q') { reveal(); return; }
      if (run.qi + 1 >= run.quiz.questions.length) { finish(); return; }
      run.qi++;
      run.phase = 'q';
      run.t0 = Date.now();
      run.spotlight = null;
      const q = curQ();
      run.answers[q.id] = run.answers[q.id] || {};
      if (q.type === 'ideas') run.ideas[q.id] = run.ideas[q.id] || [];
      clearTimeout(run.timer);
      if (q.time > 0 && !['ideas'].includes(q.type)) run.timer = setTimeout(() => { if (run && curQ() === q && run.phase === 'q') reveal(); }, q.time * 1000 + 400);
      stageMode = 'quiz';
      H.beep(520, 90);
      changed();
    }
    function reveal() {
      if (!run || run.phase !== 'q') return;
      clearTimeout(run.timer);
      run.phase = 'reveal';
      const q = curQ();
      const correctCount = Object.values(run.answers[q.id] || {}).filter((a) => a.ok).length;
      if (run.confetti && ['mcq', 'tf'].includes(q.type) && correctCount) H.confetti(stage, 90);
      changed();
    }
    function board() { if (!run) return; clearTimeout(run.timer); if (run.phase === 'q') reveal(); run.phase = 'board'; changed(); }
    function finish() {
      if (!run) return;
      clearTimeout(run.timer);
      run.phase = 'done';
      if (run.confetti) H.confetti(stage, 180);
      saveResults();
      changed();
    }
    function endQuiz() { if (run && run.phase !== 'done' && run.qi >= 0) saveResults(); run = null; if (stageMode === 'quiz') stageMode = null; changed(); }
    function timeLeft(q) { if (!run || !q || !(q.time > 0)) return null; return Math.max(0, q.time - (Date.now() - run.t0) / 1000); }

    function answer(p, m) {
      const q = curQ();
      if (!run || run.phase !== 'q' || !q || m.qid !== q.id) return;
      if (q.time > 0 && (Date.now() - run.t0) / 1000 > q.time + 1.5) return;
      const A = run.answers[q.id];
      if (q.type === 'cloud') {
        const words = (Array.isArray(m.v) ? m.v : [m.v]).map((w) => String(w || '').trim().slice(0, 40)).filter(Boolean).slice(0, q.maxPer || 3);
        if (!words.length) return;
        A[p.pid] = { v: words, at: Date.now() };
        return;
      }
      if (q.type === 'ideas') return;
      if (A[p.pid] && !q.allowChange) return;
      const a = { v: m.v, at: Date.now() };
      if (q.type === 'open') a.v = String(m.v || '').trim().slice(0, 500);
      if (q.type === 'scale') a.v = H.clamp(parseInt(m.v, 10) || 0, 1, q.scaleMax || 5);
      if (['mcq', 'tf', 'poll'].includes(q.type)) a.v = parseInt(m.v, 10);
      if (['mcq', 'tf'].includes(q.type)) {
        a.ok = a.v === q.correct;
        a.score = a.ok ? autoScore(q, a.at) : 0;
      } else if (q.type === 'open' && q.accept) {
        const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
        a.ok = String(q.accept).split(/[,;\n]/).map(norm).filter(Boolean).includes(norm(a.v));
        a.score = a.ok ? autoScore(q, a.at) : 0;
      }
      A[p.pid] = a;
      recompute();
      // everyone answered? reveal automatically
      const expected = online().filter((x) => x.name).length;
      if (expected && Object.keys(A).length >= expected && q.autoReveal !== false && ['mcq', 'tf', 'poll', 'scale'].includes(q.type)) setTimeout(() => { if (run && curQ() === q && run.phase === 'q') reveal(); }, 700);
    }
    function autoScore(q, at) {
      const pts = q.points == null ? 1000 : +q.points;
      if (q.scoring === 'manual') return 0;
      if (!(q.time > 0) || q.speedBonus === false) return pts;
      const el = (at - run.t0) / 1000;
      return Math.round(pts * (1 - 0.5 * H.clamp(el / q.time, 0, 1)));
    }
    function manualScore(qid, pid, n) {
      const q = run.quiz.questions.find((x) => x.id === qid);
      const a = run.answers[qid] && run.answers[qid][pid];
      if (!q || !a) return;
      a.manual = n;
      a.score = Math.round((q.points == null ? 1000 : +q.points) * n / 5);
      a.ok = n >= 3;
      recompute(); changed();
    }
    function recompute() {
      if (!run) return;
      Object.values(P).forEach((p) => { p.score = 0; p.correct = 0; p.incorrect = 0; });
      for (const q of run.quiz.questions) {
        const A = run.answers[q.id] || {};
        for (const pid in A) {
          const p = P[pid]; if (!p) continue;
          const a = A[pid];
          p.score += a.score || 0;
          if (isScored(q) && a.ok != null) { if (a.ok) p.correct++; else p.incorrect++; }
        }
        for (const idea of run.ideas[q.id] || []) if (idea.score && P[idea.pid]) P[idea.pid].score += Math.round((q.points == null ? 1000 : +q.points) * idea.score / 5);
      }
    }
    function ranking() {
      return named().filter((p) => run ? Object.values(run.answers).some((A) => A[p.pid]) || Object.values(run.ideas).some((L) => L.some((i) => i.pid === p.pid)) || p.conns.size : true)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .map((p, i) => ({ pid: p.pid, name: p.name, emoji: emojiOf(p.pid), score: p.score, correct: p.correct, incorrect: p.incorrect, rank: i + 1 }));
    }
    function counts(q) {
      const A = run.answers[q.id] || {};
      const n = q.type === 'scale' ? (q.scaleMax || 5) : (q.options || []).length;
      const c = new Array(n).fill(0);
      let sum = 0, cnt = 0;
      for (const pid in A) {
        const v = A[pid].v;
        if (q.type === 'scale') { if (v >= 1) { c[v - 1]++; sum += v; cnt++; } } else if (v >= 0 && v < n) c[v]++;
      }
      return { c, total: Object.keys(A).length, avg: cnt ? sum / cnt : 0 };
    }
    function cloudWords(q) {
      const f = {};
      for (const a of Object.values(run.answers[q.id] || {})) for (const w of a.v || []) { const k = w.toLowerCase(); f[k] = f[k] || { w, n: 0 }; f[k].n++; }
      return Object.values(f).sort((a, b) => b.n - a.n).slice(0, 80);
    }
    // ideas
    function ideaPost(p, m) {
      const q = curQ();
      if (!run || !q || q.type !== 'ideas' || m.qid !== q.id || run.phase === 'done') return;
      const L = run.ideas[q.id];
      if (L.filter((i) => i.pid === p.pid).length >= (q.maxPer || 3)) return;
      const text = String(m.text || '').trim().slice(0, 300);
      if (text) L.push({ id: H.uid(8), pid: p.pid, text, at: Date.now(), comments: [], reacts: {} });
    }
    function ideaComment(p, m) {
      const q = curQ(); if (!run || !q || q.type !== 'ideas') return;
      const i = (run.ideas[q.id] || []).find((x) => x.id === m.id);
      const text = String(m.text || '').trim().slice(0, 200);
      if (i && text && i.comments.filter((c) => c.pid === p.pid).length < 5) i.comments.push({ pid: p.pid, text, at: Date.now() });
    }
    function ideaReact(p, m) {
      const q = curQ(); if (!run || !q || q.type !== 'ideas') return;
      const i = (run.ideas[q.id] || []).find((x) => x.id === m.id);
      if (!i) return;
      if (i.reacts[p.pid] === m.e) delete i.reacts[p.pid]; else i.reacts[p.pid] = String(m.e || '👍').slice(0, 8);
    }
    const ideaRank = (i) => Object.keys(i.reacts).length + i.comments.length;
    function ideasSorted(q) { return (run.ideas[q.id] || []).slice().sort((a, b) => ideaRank(b) - ideaRank(a) || a.at - b.at); }

    function saveResults() {
      if (!run || run.saved) return;
      run.saved = true;
      recompute();
      const qs = run.quiz.questions;
      const people = ranking().map((r) => ({
        ...r, answers: qs.map((q) => {
          const a = (run.answers[q.id] || {})[r.pid];
          if (!a) return null;
          let shown = a.v;
          if (['mcq', 'tf', 'poll'].includes(q.type)) shown = q.options[a.v] ? q.options[a.v].text : '';
          if (Array.isArray(shown)) shown = shown.join(', ');
          return { v: shown, ok: a.ok, score: a.score || 0, manual: a.manual };
        }),
      }));
      const res = {
        id: 'r_' + H.uid(), kind: 'quiz', at: Date.now(), title: run.quiz.title || t('liveQuiz'), subject: run.subject, lesson: lesson.title,
        questions: qs.map((q) => {
          const o = { id: q.id, type: q.type, text: q.text, options: (q.options || []).map((x) => x.text), correct: q.correct, points: q.points, source: q.source };
          if (['mcq', 'tf', 'poll', 'scale'].includes(q.type)) { const c = counts(q); o.counts = c.c; o.avg = c.avg; }
          if (q.type === 'cloud') o.words = cloudWords(q).map((w) => w.w + ' (' + w.n + ')');
          if (q.type === 'ideas') o.ideas = ideasSorted(q).map((i) => ({ text: i.text, by: nameOf(i.pid), reactions: Object.keys(i.reacts).length, comments: i.comments.map((c) => nameOf(c.pid) + ': ' + c.text) }));
          return o;
        }),
        people,
      };
      H.store.results.put(res);
      run.resultId = res.id;
      run.result = res;
    }
    function saveAttendance() {
      const people = named().map((p) => ({ name: p.name, emoji: emojiOf(p.pid), joinedAt: p.joinedAt, lastSeen: p.lastSeen, online: !!p.conns.size }));
      if (!people.length) return;
      H.store.results.put({ id: 'a_' + H.uid(), kind: 'attendance', at: sessionStart, title: (lesson.title || '') + ' — ' + t('attendance'), people });
    }

    // ---------------- per-phone state ----------------
    function audState(pid) {
      const p = P[pid];
      const rk = run ? ranking() : [];
      const me = rk.find((r) => r.pid === pid);
      const st = {
        t: 'aud', code: getCode(),
        you: p ? { name: p.name, emoji: p.emoji, score: p.score, rank: me ? me.rank : null, hand: p.hand, pace: p.pace, picked: pickedPid === pid } : null,
        qna: { open: qnaOpen, list: qna.slice().sort((a, b) => b.votes.size - a.votes.size || b.at - a.at).slice(0, 60).map((q) => ({ id: q.id, text: q.text, votes: q.votes.size, voted: q.votes.has(pid), answered: q.answered, mine: q.pid === pid })) },
        bank: { open: bankOpen, max: bankMax, mine: bank.filter((b) => b.pid === pid).map((b) => ({ text: b.q.text, type: b.q.type })) },
        quiz: null,
      };
      if (run) {
        const q = curQ();
        const qz = { phase: run.phase, qi: run.qi, n: run.quiz.questions.length, title: run.quiz.title };
        if (q && run.phase !== 'lobby') {
          qz.q = { id: q.id, type: q.type, text: q.text, image: q.image || '', options: (q.options || []).map((o) => ({ text: o.text, image: o.image || '' })), time: q.time || 0, left: timeLeft(q), points: q.points, scaleMax: q.scaleMax || 5, maxPer: q.maxPer || 3, scaleLabels: q.scaleLabels || '' };
          const a = (run.answers[q.id] || {})[pid];
          qz.my = a ? { v: a.v, ok: run.phase === 'q' ? undefined : a.ok, score: run.phase === 'q' ? undefined : a.score } : null;
          if (run.phase !== 'q') {
            qz.reveal = { correct: q.correct, source: q.source || '' };
            if (['mcq', 'tf', 'poll', 'scale'].includes(q.type)) Object.assign(qz.reveal, counts(q));
          }
          if (q.type === 'ideas') {
            qz.ideas = ideasSorted(q).map((i) => ({ id: i.id, text: i.text, by: nameOf(i.pid), emoji: emojiOf(i.pid), mine: i.pid === pid, reacts: Object.keys(i.reacts).length, myReact: i.reacts[pid] || null, comments: i.comments.slice(-8).map((c) => ({ by: nameOf(c.pid), text: c.text })) }));
          }
        }
        if (run.phase === 'board' || run.phase === 'done') qz.board = rk.slice(0, 10).map((r) => ({ name: r.name, emoji: r.emoji, score: r.score }));
        st.quiz = qz;
      }
      return st;
    }
    function sendTo(pid) {
      const p = P[pid]; if (!p) return;
      const st = audState(pid);
      net.conns.forEach((c) => { if (connPid.get(c.connectionId) === pid) net.send(c, st); });
    }
    const pushAud = H.debounce(() => Object.keys(P).forEach(sendTo), 120);

    // ---------------- stage (projector) ----------------
    let stageTick = null;
    function renderStage() {
      stage.className = 'live-stage' + (stageMode ? ' on mode-' + stageMode : '');
      document.body.classList.toggle('live-on', !!stageMode);
      stage.innerHTML = '';
      clearInterval(stageTick);
      if (!stageMode) return;
      const close = h('button.stage-close', { title: t('backToSlides'), on: { click: () => { stageMode = null; if (run && run.phase === 'done') run = null; changed(); } } }, '🏠 ' + t('backToSlides'));
      if (stageMode === 'join') stage.append(joinView(true), close);
      else if (stageMode === 'qna') stage.append(qnaView(), close);
      else if (stageMode === 'quiz' && run) { stage.append(quizView(), quizBar()); }
      else if (stageMode === 'pick') stage.append(pickView(), close);
      else { stageMode = null; stage.className = 'live-stage'; }
    }
    function joinView(big) {
      const url = H.joinUrl(getCode());
      const people = named();
      return h('div.join-view' + (big ? '.big' : ''),
        h('div.join-left',
          h('h1', run ? (run.quiz.title || t('liveQuiz')) : t('joinTitle')),
          h('div.join-url', t('joinAt'), ' ', h('b', url.replace(/^https?:\/\//, '').replace(/#.*/, '')), ' · ', t('code'), ' ', h('b.code-big', getCode())),
          H.qrSvg(url),
          h('div.join-count', t('nJoined', { n: people.length }))),
        h('div.join-people', people.slice(-60).map((p) => h('span.person-chip', emojiOf(p.pid) + ' ' + p.name))));
    }
    function quizBar() {
      const q = curQ();
      const b = (label, fn, cls) => h('button.btn' + (cls ? '.' + cls : ''), { on: { click: fn } }, label);
      const A = q && run.answers[q.id] ? Object.keys(run.answers[q.id]).length : 0;
      return h('div.quiz-bar',
        h('span.qb-info', run.phase === 'lobby' ? t('nJoined', { n: named().length }) : q ? `${t('question')} ${run.qi + 1}/${run.quiz.questions.length} · ${t('nAnswered', { n: q.type === 'ideas' ? (run.ideas[q.id] || []).length : A })}` : ''),
        run.phase === 'lobby' ? b('▶ ' + t('beginQuiz'), nextQ, 'primary') : null,
        run.phase === 'q' && q.type !== 'ideas' ? b('👁 ' + t('revealNow'), reveal, 'primary') : null,
        run.phase === 'q' && q.type === 'ideas' ? b('✓ ' + t('closeIdeas'), reveal, 'primary') : null,
        run.phase === 'reveal' ? b('🏆 ' + t('leaderboard'), board) : null,
        run.phase === 'reveal' && ['open', 'cloud', 'ideas'].includes(q.type) ? b('🎲 ' + t('spotlightAnswer'), spotlightAnswer) : null,
        (run.phase === 'reveal' || run.phase === 'board') ? b((run.qi + 1 >= run.quiz.questions.length ? '🏁 ' + t('finish') : '⏭ ' + t('nextQ')), nextQ, 'primary') : null,
        run.phase === 'done' ? b('⬇ Excel', () => H.exports.resultsXlsx(run.result)) : null,
        run.phase === 'done' ? b('⬇ PDF', () => H.exports.resultsPdf(run.result)) : null,
        b(run.confetti ? '🎊' : '🚫🎊', () => { run.confetti = !run.confetti; changed(); }, 'ghost'),
        b('📋', openQuiz, 'ghost'),
        b('🏠', () => { stageMode = null; changed(); }, 'ghost'),
        b('✕ ' + t('endQuiz'), async () => { if (await H.confirm(t('endQuiz'), t('endQuizTxt'))) endQuiz(); }, 'danger'));
    }
    function quizView() {
      const q = curQ();
      if (run.phase === 'lobby') return joinView(true);
      if (run.phase === 'board' || run.phase === 'done') return boardView(run.phase === 'done');
      const box = h('div.qv');
      const head = h('div.qv-head', h('span.qv-num', `${run.qi + 1}/${run.quiz.questions.length}`), h('span.qv-type', t('qt_' + q.type)));
      const tl = timeLeft(q);
      if (run.phase === 'q' && tl != null) {
        const ring = h('div.qv-timer');
        head.appendChild(ring);
        const upd = () => { const v = timeLeft(q); ring.textContent = Math.ceil(v); ring.style.setProperty('--p', (v / q.time * 100) + '%'); ring.classList.toggle('low', v <= 5); };
        upd(); stageTick = setInterval(upd, 250);
      }
      const A = run.answers[q.id] || {};
      head.appendChild(h('span.qv-answered', '👥 ' + (q.type === 'ideas' ? (run.ideas[q.id] || []).length : Object.keys(A).length) + '/' + named().filter((p) => p.conns.size).length));
      box.appendChild(head);
      box.appendChild(h('div.qv-text', q.text));
      if (q.image) box.appendChild(h('img.qv-img', { src: q.image, alt: '' }));
      const shownJoin = h('div.qv-join', t('code') + ' ', h('b', getCode()));
      box.appendChild(shownJoin);
      if (['mcq', 'tf', 'poll'].includes(q.type)) {
        const rev = run.phase === 'reveal';
        const c = rev ? counts(q) : null;
        const max = c ? Math.max(1, ...c.c) : 1;
        box.appendChild(h('div.qv-opts' + (rev ? '.rev' : ''), q.options.map((o, i) => {
          const good = rev && q.type !== 'poll' && i === q.correct;
          return h('div.qv-opt' + (good ? '.good' : rev && q.type !== 'poll' ? '.dim' : ''), { style: { '--c': TILE[i % TILE.length] } },
            h('span.qv-shape', SHAPES[i % SHAPES.length]),
            o.image ? h('img.opt-img', { src: o.image, alt: '' }) : null,
            h('span.qv-otext', o.text),
            rev ? h('span.qv-bar', h('i', { style: { width: (c.c[i] / max * 100) + '%' } })) : null,
            rev ? h('b.qv-cnt', String(c.c[i])) : null,
            good ? h('span.qv-check', '✓') : null);
        })));
      } else if (q.type === 'scale') {
        const n = q.scaleMax || 5;
        const rev = run.phase === 'reveal';
        const c = counts(q);
        const max = Math.max(1, ...c.c);
        const labels = String(q.scaleLabels || '').split('|');
        box.appendChild(h('div.scale-view',
          h('div.scale-bars', c.c.map((v, i) => h('div.sb', h('div.sb-bar', h('i', { style: { height: rev ? (v / max * 100) + '%' : '4%' } })), h('b', String(i + 1)), rev ? h('span.muted', String(v)) : null))),
          h('div.scale-labels', h('span', labels[0] || ''), h('span', labels[1] || '')),
          rev ? h('div.scale-avg', t('average') + ': ', h('b', c.avg.toFixed(2)), ' / ' + n) : null));
      } else if (q.type === 'cloud') {
        const words = cloudWords(q);
        const max = Math.max(1, ...words.map((w) => w.n));
        box.appendChild(h('div.cloud', words.length ? words.map((w, i) => h('span.cw', { style: { fontSize: (1 + w.n / max * 3.2) + 'rem', color: TILE[i % TILE.length], opacity: 0.55 + 0.45 * w.n / max } }, w.w)) : h('p.muted', t('waitingAnswers'))));
      } else if (q.type === 'open') {
        const list = Object.entries(A).sort((a, b) => a[1].at - b[1].at);
        box.appendChild(h('div.cards', list.length ? list.map(([pid, a]) => h('div.acard' + (run.spotlight === pid ? '.spot' : '') + (a.ok ? '.good' : ''),
          h('div.acard-text', run.phase === 'q' && q.hideUntilReveal ? '•••' : a.v),
          h('div.acard-by', emojiOf(pid) + ' ' + nameOf(pid), a.manual != null ? ' · ' + '★'.repeat(a.manual) : ''))) : h('p.muted', t('waitingAnswers'))));
      } else if (q.type === 'ideas') {
        const L = ideasSorted(q);
        box.appendChild(h('div.cards.ideas', L.length ? L.map((i, k) => h('div.acard' + (run.spotlight === i.id ? '.spot' : '') + (k === 0 && ideaRank(i) ? '.top' : ''),
          h('div.acard-text', i.text),
          h('div.acard-by', emojiOf(i.pid) + ' ' + nameOf(i.pid)),
          h('div.acard-meta', '❤ ' + Object.keys(i.reacts).length + '  💬 ' + i.comments.length, i.score ? ' · ' + '★'.repeat(i.score) : ''),
          i.comments.length ? h('div.acard-comments', i.comments.slice(-2).map((c) => h('div', h('b', nameOf(c.pid) + ': '), c.text))) : null)) : h('p.muted', t('noIdeasYet'))));
      }
      if (run.phase === 'reveal' && q.source) box.appendChild(h('div.qv-source', '📖 ' + q.source));
      return box;
    }
    function boardView(final) {
      const rk = ranking();
      const top = rk.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      return h('div.board-view',
        h('h1', final ? '🏁 ' + t('quizFinished') : '🏆 ' + t('leaderboard')),
        h('div.podium', order.map((r, i) => r ? h('div.pod.p' + ([2, 1, 3][i]), h('div.pod-emoji', r.emoji), h('div.pod-name', r.name), h('div.pod-score', String(r.score)), h('div.pod-block', String([2, 1, 3][i]))) : h('div.pod.empty'))),
        h('ol.board-list', { start: 4 }, rk.slice(3, 10).map((r) => h('li', h('span', r.emoji + ' ' + r.name), h('b', String(r.score))))),
        !rk.length ? h('p.muted', t('noParticipants')) : null);
    }
    function spotlightAnswer() {
      const q = curQ(); if (!q) return;
      let pool = [];
      if (q.type === 'ideas') pool = (run.ideas[q.id] || []).map((i) => i.id);
      else pool = Object.keys(run.answers[q.id] || {});
      if (!pool.length) return;
      run.spotlight = pool[Math.floor(Math.random() * pool.length)];
      changed();
    }
    function qnaView() {
      const list = qna.filter((q) => !q.answered).sort((a, b) => b.votes.size - a.votes.size || a.at - b.at);
      const focus = qna.find((q) => q.id === qnaFocus);
      return h('div.qna-view',
        h('h1', '❓ ' + t('qna'), h('span.muted.sm', ' · ' + t('code') + ' ' + getCode())),
        focus ? h('div.qna-focus', h('div', focus.text), h('div.muted', '▲ ' + focus.votes.size)) : null,
        h('div.qna-list', list.length ? list.slice(0, 12).map((q) => h('div.qna-item' + (q.id === qnaFocus ? '.on' : ''), h('b.votes', '▲ ' + q.votes.size), h('span', q.text))) : h('p.muted', t('noQuestionsYet'))));
    }
    function pickView() {
      const p = P[pickedPid];
      return h('div.pick-view', h('div.pick-card', h('div.pick-emoji', p ? emojiOf(p.pid) : '🎲'), h('div.pick-name', p ? p.name : '…')),
        h('div.row.center', h('button.btn.primary', { on: { click: pick } }, '🎲 ' + t('pickAgain'))));
    }

    // ---------------- random picker ----------------
    function pick() {
      const pool = named().filter((p) => p.conns.size);
      if (!pool.length) { H.toast(t('noParticipants'), 'err'); return; }
      const least = Math.min(...pool.map((p) => p.picks));
      const fair = pool.filter((p) => p.picks === least); // everyone gets a turn before repeats
      const winner = fair[Math.floor(Math.random() * fair.length)];
      stageMode = 'pick'; pickedPid = null;
      renderStage();
      const nameEl = H.$('.pick-name', stage), emo = H.$('.pick-emoji', stage);
      let i = 0; const spins = 18 + Math.floor(Math.random() * 6);
      const step = () => {
        const p = pool[i % pool.length];
        if (nameEl) { nameEl.textContent = p.name; emo.textContent = emojiOf(p.pid); }
        H.beep(300 + (i % 5) * 60, 40);
        if (++i < spins) setTimeout(step, 50 + i * i * 0.9);
        else {
          winner.picks++; pickedPid = winner.pid;
          H.beep(880, 200, 2); H.confetti(stage, 80);
          changed();
          setTimeout(() => { if (pickedPid === winner.pid) { pickedPid = null; pushAud(); } }, 8000);
        }
      };
      step();
    }

    // ---------------- reactions ----------------
    function floatEmoji(e) {
      const el = h('span.float-emoji', { style: { left: 6 + Math.random() * 88 + '%', animationDuration: 3 + Math.random() * 1.5 + 's' } }, e);
      reactLayer.appendChild(el);
      setTimeout(() => el.remove(), 4800);
    }

    // ---------------- host panels ----------------
    let panel = null, panelRender = null;
    function showPanel(title, render, busy) {
      if (panel) { panel._keep = true; panel.close(); }
      const holder = h('div.panel-holder', render());
      panelRender = busy ? null : render;
      const me = H.modal(title, holder, { wide: true, onClose: () => { if (panel === me && !me._keep) { panel = null; panelRender = null; } } });
      me.holder = holder;
      panel = me;
      return me;
    }
    function refreshPanel() {
      if (!panel || !panelRender || !document.body.contains(panel.el)) return;
      const y = panel.holder.parentNode.scrollTop;
      panel.holder.replaceChildren(panelRender());
      panel.holder.parentNode.scrollTop = y;
    }
    function openQuiz() {
      if (run) { showPanel('🧠 ' + t('liveQuiz'), runPanel); return; }
      buildPanel();
    }
    function runPanel() {
        const q = curQ();
        if (!run) return h('p.muted', t('quizEnded'));
        return h('div.quiz-run',
          h('div.row', h('b', run.quiz.title || t('liveQuiz')), h('span.muted', ` · ${t('phase_' + run.phase)} · ${t('nJoined', { n: named().length })}`)),
          h('div.row.wrap',
            run.phase === 'lobby' ? h('button.btn.primary', { on: { click: () => { stageMode = 'quiz'; nextQ(); } } }, '▶ ' + t('beginQuiz')) : null,
            run.phase === 'q' ? h('button.btn.primary', { on: { click: reveal } }, '👁 ' + t('revealNow')) : null,
            ['reveal', 'board'].includes(run.phase) ? h('button.btn.primary', { on: { click: nextQ } }, '⏭ ' + t('nextQ')) : null,
            run.phase === 'reveal' ? h('button.btn', { on: { click: board } }, '🏆 ' + t('leaderboard')) : null,
            h('button.btn.ghost', { on: { click: () => { stageMode = 'quiz'; changed(); } } }, '📺 ' + t('showOnScreen')),
            run.phase === 'done' ? h('button.btn', { on: { click: () => H.exports.resultsXlsx(run.result) } }, '⬇ Excel') : null,
            run.phase === 'done' ? h('button.btn', { on: { click: () => H.exports.resultsPdf(run.result) } }, '⬇ PDF') : null,
            h('button.btn.danger', { on: { click: endQuiz } }, '✕ ' + t('endQuiz'))),
          q && q.type === 'open' ? manualList(q) : null,
          q && q.type === 'ideas' ? ideaScoreList(q) : null);
    }
    function buildPanel() {
      const subject = h('input.input', { placeholder: t('subjectPh'), value: H.settings.get('lastSubject', '') });
      subject.addEventListener('input', () => H.settings.set('lastSubject', subject.value));
      const saved = h('div.saved-quizzes', h('p.muted', '…'));
      H.store.quizzes.all().then((qs) => {
        saved.innerHTML = '';
        if (!qs.length) saved.appendChild(h('p.muted', t('noQuizzes')));
        qs.sort((a, b) => (b.updated || 0) - (a.updated || 0)).forEach((qz) => saved.appendChild(h('div.lesson-row',
          h('div.lesson-main', h('div.lesson-title', qz.title || t('untitled')), h('div.muted.sm', t('nQuestions', { n: qz.questions.length }))),
          h('div.lesson-actions', h('button.btn.success', { on: { click: () => { panel.close(); startQuiz(qz, { subject: subject.value }); } } }, '▶ ' + t('start'))))));
      });
      const draft = H.quizNew();
      const builderBox = h('div');
      H.quizBuilder(builderBox, draft, {
        compact: true, bank: () => bank,
        onStart: (qz) => { panel.close(); startQuiz(qz, { subject: subject.value }); },
      });
      const bankBox = h('div.bank-box',
        h('div.row.wrap',
          h('label.check', h('input', { type: 'checkbox', checked: bankOpen, on: { change: (e) => { bankOpen = e.target.checked; pushAud(); } } }), ' ', t('bankOpen')),
          h('label.row', t('maxPerStudent'), ' ', h('input.input.num', { type: 'number', min: 1, max: 20, value: bankMax, on: { change: (e) => { bankMax = +e.target.value || 3; pushAud(); } } }))),
        bank.length ? bank.map((b) => h('div.bank-item', h('div', h('b', b.q.text), h('div.muted.sm', (b.author || '') + ' · ' + t('qt_' + b.q.type) + ' · ' + b.q.options.map((o, i) => (i === b.q.correct ? '✓' : '') + o.text).join(' / '))))) : h('p.muted', t('bankEmpty')));
      const tabs = h('div.tabs');
      const views = { saved, build: builderBox, bank: bankBox };
      const content = h('div.tab-content');
      const setTab = (k) => { content.innerHTML = ''; content.appendChild(views[k]); H.$$('.tab', tabs).forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
      [['saved', '📚 ' + t('savedQuizzes')], ['build', '⚡ ' + t('buildNow')], ['bank', '📥 ' + t('questionBank') + ' (' + bank.length + ')']].forEach(([k, l]) => tabs.appendChild(h('button.tab', { 'data-k': k, on: { click: () => setTab(k) } }, l)));
      showPanel('🧠 ' + t('liveQuiz'), () => h('div', h('label.lbl', t('subjectLbl')), subject, tabs, content), true); // not auto-refreshed while typing
      setTab('saved');
    }
    function manualList(q) {
      const A = run.answers[q.id] || {};
      return h('div.manual', h('h4', '✍️ ' + t('manualScoring')), Object.entries(A).map(([pid, a]) => h('div.manual-row',
        h('div', h('b', emojiOf(pid) + ' ' + nameOf(pid)), h('div', a.v)),
        h('div.stars', [0, 1, 2, 3, 4, 5].map((n) => h('button.star' + (a.manual === n ? '.on' : ''), { on: { click: () => manualScore(q.id, pid, n) } }, n ? '★' + n : '0'))))));
    }
    function ideaScoreList(q) {
      return h('div.manual', h('h4', '✍️ ' + t('scoreIdeas')), ideasSorted(q).map((i) => h('div.manual-row',
        h('div', h('b', emojiOf(i.pid) + ' ' + nameOf(i.pid)), h('div', i.text), h('div.muted.sm', '❤ ' + Object.keys(i.reacts).length + ' 💬 ' + i.comments.length)),
        h('div.stars', [0, 1, 2, 3, 4, 5].map((n) => h('button.star' + ((i.score || 0) === n ? '.on' : ''), { on: { click: () => { i.score = n; recompute(); changed(); } } }, n ? '★' + n : '0'))),
        h('button.btn.ghost.sm', { on: { click: () => { run.spotlight = i.id; stageMode = 'quiz'; changed(); } } }, '🔦'))));
    }
    function openQna() { showPanel('❓ ' + t('qna'), qnaPanel); }
    function qnaPanel() {
      const list = qna.slice().sort((a, b) => a.answered - b.answered || b.votes.size - a.votes.size || a.at - b.at);
      const body = h('div',
        h('div.row.wrap',
          h('label.check', h('input', { type: 'checkbox', checked: qnaOpen, on: { change: (e) => { qnaOpen = e.target.checked; changed(); } } }), ' ', t('qnaOpen')),
          h('button.btn.sm', { on: { click: () => { stageMode = stageMode === 'qna' ? null : 'qna'; changed(); } } }, stageMode === 'qna' ? '🏠 ' + t('backToSlides') : '📺 ' + t('showOnScreen'))),
        list.length ? list.map((q) => h('div.qna-row' + (q.answered ? '.done' : ''),
          h('b.votes', '▲ ' + q.votes.size), h('span.grow', q.text),
          h('button.btn.ghost.sm', { title: t('highlight'), on: { click: () => { qnaFocus = qnaFocus === q.id ? null : q.id; stageMode = 'qna'; changed(); } } }, '🔦'),
          h('button.btn.ghost.sm', { on: { click: () => { q.answered = !q.answered; changed(); } } }, q.answered ? '↺' : '✓'),
          h('button.btn.ghost.sm.danger', { on: { click: () => { qna.splice(qna.indexOf(q), 1); changed(); } } }, '✕'))) : h('p.muted', t('noQuestionsYet')));
      return body;
    }
    function openPeople() { showPanel('🧑‍🎓 ' + t('people'), peoplePanel); }
    function peoplePanel() {
      const ps = Object.values(P).sort((a, b) => a.joinedAt - b.joinedAt);
      const body = h('div',
        h('div.row.wrap',
          h('button.btn.sm', { on: { click: () => H.exports.attendanceXlsx({ title: (lesson.title || '') + ' — ' + t('attendance'), at: sessionStart, people: named().map((p) => ({ name: p.name, emoji: emojiOf(p.pid), joinedAt: p.joinedAt, lastSeen: p.lastSeen, online: !!p.conns.size })) }) } }, '⬇ ' + t('attendance') + ' (Excel)'),
          h('button.btn.ghost.sm', { on: { click: () => { Object.values(P).forEach((p) => { p.hand = false; }); changed(); } } }, '✋ ' + t('lowerHands')),
          h('button.btn.ghost.sm', { on: { click: () => { Object.values(P).forEach((p) => { p.pace = null; }); changed(); } } }, t('resetPace'))),
        h('table.people', h('tr', h('th', ''), h('th', t('name')), h('th', t('joined')), h('th', t('score')), h('th', '')),
          ps.map((p) => h('tr' + (p.conns.size ? '' : '.off'),
            h('td', emojiOf(p.pid)), h('td', p.name || '—'), h('td', new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
            h('td', String(p.score || 0)),
            h('td', (p.hand ? '✋ ' : '') + (p.pace === 'lost' ? '😵 ' : p.pace === 'fast' ? '🐢 ' : '') + (p.conns.size ? '🟢' : '⚪'))))));
      return body;
    }

    // ---------------- remote control of live features ----------------
    function remote(m) {
      switch (m.a) {
        case 'showJoin': stageMode = stageMode === 'join' ? null : 'join'; break;
        case 'hide': stageMode = null; break;
        case 'qnaShow': stageMode = stageMode === 'qna' ? null : 'qna'; break;
        case 'qnaFocus': qnaFocus = m.id; stageMode = 'qna'; break;
        case 'qnaAnswered': { const q = qna.find((x) => x.id === m.id); if (q) q.answered = !q.answered; break; }
        case 'pick': pick(); return;
        case 'startQuiz': H.store.quizzes.get(m.id).then((qz) => qz && startQuiz(qz, { subject: H.settings.get('lastSubject', '') })); return;
        case 'next': nextQ(); return;
        case 'reveal': reveal(); return;
        case 'board': board(); return;
        case 'end': endQuiz(); return;
        case 'showQuiz': stageMode = 'quiz'; break;
        case 'spotlight': spotlightAnswer(); return;
        case 'confetti': H.confetti(stage, 120); return;
        case 'lowerHands': Object.values(P).forEach((p) => { p.hand = false; }); break;
        case 'resetPace': Object.values(P).forEach((p) => { p.pace = null; }); break;
        case 'reactions': reactOn = !reactOn; break;
        default: return;
      }
      changed();
    }
    let quizList = [];
    const loadQuizList = () => H.store.quizzes.all().then((qs) => { quizList = qs.map((q) => ({ id: q.id, title: q.title || t('untitled'), n: q.questions.length })); onChange && onChange(); });
    loadQuizList();
    function summary() {
      const q = curQ();
      const sig = signals();
      return {
        count: named().filter((p) => p.conns.size).length, hands: named().filter((p) => p.hand).map((p) => emojiOf(p.pid) + ' ' + p.name),
        lost: sig.lost, fast: sig.fast, stage: stageMode, reactions: reactOn,
        qna: qna.filter((x) => !x.answered).sort((a, b) => b.votes.size - a.votes.size).slice(0, 20).map((x) => ({ id: x.id, text: x.text, votes: x.votes.size })),
        quizzes: quizList,
        quiz: run ? { title: run.quiz.title, phase: run.phase, qi: run.qi, n: run.quiz.questions.length, text: q ? q.text : '', type: q ? q.type : '', answered: q ? (q.type === 'ideas' ? (run.ideas[q.id] || []).length : Object.keys(run.answers[q.id] || {}).length) : 0 } : null,
      };
    }
    function signals() {
      const ps = online();
      return { hands: ps.filter((p) => p.hand).length, lost: ps.filter((p) => p.pace === 'lost').length, fast: ps.filter((p) => p.pace === 'fast').length, qna: qna.filter((q) => !q.answered).length };
    }

    // re-send timer info to phones every second while a timed question runs
    const tickAll = setInterval(() => { if (run && run.phase === 'q' && curQ() && curQ().time > 0) pushAud(); }, 1000);

    return {
      join, leave, data, remote, summary, signals, pick, startQuiz,
      count: () => named().filter((p) => p.conns.size).length,
      openQuiz, openQna, openPeople,
      showJoin: () => { stageMode = 'join'; changed(); },
      toggleReactions: () => { reactOn = !reactOn; H.settings.set('showReactions', reactOn); changed(); },
      reactionsOn: () => reactOn,
      destroy() { document.body.classList.remove('live-on'); clearInterval(tickAll); clearInterval(stageTick); if (run && run.qi >= 0) saveResults(); saveAttendance(); stage.remove(); reactLayer.remove(); },
    };
  };
})(window.Hub);
