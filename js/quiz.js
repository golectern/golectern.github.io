/* Lectern — quiz builder, quiz page, Excel import/export */
(function (H) {
  'use strict';
  const { h, t } = H;
  const TYPES = ['mcq', 'tf', 'poll', 'open', 'cloud', 'ideas', 'scale'];
  const TYPE_ICON = { mcq: '🔘', tf: '✅', poll: '📊', open: '✍️', cloud: '☁️', ideas: '💡', scale: '🎚️' };

  H.quizNew = () => ({ id: 'z_' + H.uid(), title: '', subject: '', questions: [], created: Date.now(), updated: Date.now() });
  const blankQ = (type = 'mcq') => ({
    id: 'q_' + H.uid(6), type, text: '', image: '',
    options: type === 'tf' ? [{ text: t('true') }, { text: t('false') }] : ['mcq', 'poll'].includes(type) ? [{ text: '' }, { text: '' }, { text: '' }, { text: '' }] : [],
    correct: 0, time: type === 'ideas' ? 0 : H.settings.get('defaultTime', 30), points: ['poll', 'cloud', 'scale'].includes(type) ? 0 : H.settings.get('defaultPoints', 1000),
    scoring: 'auto', speedBonus: true, source: '', accept: '', maxPer: 3, scaleMax: 5, scaleLabels: '',
  });

  async function imageToDataUrl(file, max = 720) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } finally { URL.revokeObjectURL(url); }
  }
  function imagePicker(get, set) {
    const inp = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const urlIn = h('input.input', { placeholder: t('imageUrlPh'), value: /^data:/.test(get() || '') ? '' : get() || '' });
    const prev = h('div.img-prev');
    const show = () => { prev.innerHTML = ''; if (get()) prev.append(h('img', { src: get(), alt: '' }), h('button.icon-btn', { on: { click: () => { set(''); urlIn.value = ''; show(); } } }, '✕')); };
    urlIn.addEventListener('change', () => { set(urlIn.value.trim()); show(); });
    inp.addEventListener('change', async () => { if (inp.files[0]) { set(await imageToDataUrl(inp.files[0])); urlIn.value = ''; show(); } });
    show();
    return h('div.img-pick', h('div.row', urlIn, h('button.btn.ghost.sm', { on: { click: () => inp.click() } }, '🖼 ' + t('upload')), inp), prev);
  }

  /** Quiz builder. opts: { compact, onSave(quiz), onStart(quiz), bank: () => [] } */
  H.quizBuilder = function (root, quiz, opts = {}) {
    let form = blankQ('mcq'), editing = -1;
    const listBox = h('div.q-list'), formBox = h('div.q-form');
    const titleIn = h('input.input', { placeholder: t('quizTitlePh'), value: quiz.title || '' });
    titleIn.addEventListener('input', () => { quiz.title = titleIn.value; });
    const subjIn = h('input.input', { placeholder: t('subjectPh'), value: quiz.subject || '' });
    subjIn.addEventListener('input', () => { quiz.subject = subjIn.value; });

    function renderList() {
      listBox.innerHTML = '';
      if (!quiz.questions.length) { listBox.appendChild(h('p.empty', t('noQuestions'))); return; }
      quiz.questions.forEach((q, i) => listBox.appendChild(h('div.q-item' + (i === editing ? '.editing' : ''),
        h('span.q-num', String(i + 1)),
        h('div.grow',
          h('div.q-text', TYPE_ICON[q.type] + ' ' + (q.text || '—')),
          h('div.muted.sm', [t('qt_' + q.type), q.time ? '⏱ ' + q.time + 's' : null, q.points ? '🏆 ' + q.points : null,
            ['mcq', 'tf'].includes(q.type) && q.options[q.correct] ? '✓ ' + q.options[q.correct].text : null].filter(Boolean).join(' · '))),
        h('button.icon-btn', { title: t('edit'), on: { click: () => { editing = i; form = JSON.parse(JSON.stringify(q)); renderForm(); renderList(); formBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } } }, '✎'),
        h('button.icon-btn', { title: t('moveUp'), disabled: !i, on: { click: () => { quiz.questions.splice(i - 1, 0, quiz.questions.splice(i, 1)[0]); renderList(); } } }, '↑'),
        h('button.icon-btn', { title: t('duplicate'), on: { click: () => { const c = JSON.parse(JSON.stringify(q)); c.id = 'q_' + H.uid(6); quiz.questions.splice(i + 1, 0, c); renderList(); } } }, '⧉'),
        h('button.icon-btn.danger', { title: t('delete'), on: { click: () => { quiz.questions.splice(i, 1); if (editing === i) { editing = -1; form = blankQ(form.type); renderForm(); } renderList(); } } }, '✕'))));
    }

    function renderForm() {
      formBox.innerHTML = '';
      const q = form;
      const typeRow = h('div.chips', TYPES.map((ty) => h('button.chip' + (q.type === ty ? '.on' : ''), { on: { click: () => {
        const keep = q.text;
        form = Object.assign(blankQ(ty), { text: keep, id: q.id, image: q.image, source: q.source });
        if (['mcq', 'poll'].includes(ty) && ['mcq', 'poll'].includes(q.type)) form.options = q.options;
        renderForm();
      } } }, TYPE_ICON[ty] + ' ' + t('qt_' + ty))));
      const text = h('textarea.input', { rows: 2, placeholder: t('askQuestionPh'), value: q.text });
      text.addEventListener('input', () => { q.text = text.value; });
      formBox.append(h('div.lbl', t('questionType')), typeRow, h('p.hint', t('qh_' + q.type)), h('div.lbl', t('question')), text,
        h('details.more', h('summary', '🖼 ' + t('addImage')), imagePicker(() => q.image, (v) => { q.image = v; })));

      if (['mcq', 'poll', 'tf'].includes(q.type)) {
        const opts = h('div.opts');
        const draw = () => {
          opts.innerHTML = '';
          q.options.forEach((o, i) => {
            const inp = h('input.input', { value: o.text, placeholder: t('optionN', { n: i + 1 }), readOnly: q.type === 'tf' });
            inp.addEventListener('input', () => { o.text = inp.value; });
            opts.appendChild(h('div.opt-row', { style: { '--c': H.live.TILE[i % 8] } },
              q.type !== 'poll' ? h('button.radio' + (q.correct === i ? '.on' : ''), { title: t('markCorrect'), on: { click: () => { q.correct = i; draw(); } } }, q.correct === i ? '✓' : '') : h('span.opt-shape', H.live.SHAPES[i % 8]),
              inp,
              q.type !== 'tf' ? h('details.opt-img', h('summary', '🖼'), imagePicker(() => o.image, (v) => { o.image = v; })) : null,
              q.type !== 'tf' && q.options.length > 2 ? h('button.icon-btn', { on: { click: () => { q.options.splice(i, 1); if (q.correct >= q.options.length) q.correct = 0; draw(); } } }, '✕') : null));
          });
          if (q.type !== 'tf' && q.options.length < 8) opts.appendChild(h('button.btn.ghost.sm', { on: { click: () => { q.options.push({ text: '' }); draw(); } } }, '+ ' + t('addOption')));
        };
        draw();
        formBox.append(h('div.lbl', t('answers')), q.type !== 'poll' ? h('p.hint', t('correctMark')) : null, opts);
      }
      if (q.type === 'open') {
        const acc = h('input.input', { value: q.accept || '', placeholder: t('acceptPh') });
        acc.addEventListener('input', () => { q.accept = acc.value; });
        formBox.append(h('div.lbl', t('acceptLbl')), acc, h('p.hint', t('acceptHint')));
      }
      if (['cloud', 'ideas'].includes(q.type)) {
        const mp = h('input.input.num', { type: 'number', min: 1, max: 10, value: q.maxPer || 3 });
        mp.addEventListener('input', () => { q.maxPer = +mp.value || 3; });
        formBox.append(h('div.row', h('span.lbl', q.type === 'cloud' ? t('wordsPerStudent') : t('ideasPerStudent')), mp));
      }
      if (q.type === 'scale') {
        const mx = h('select.input.num', [5, 7, 10].map((n) => h('option', { value: n, selected: q.scaleMax === n }, '1–' + n)));
        mx.addEventListener('change', () => { q.scaleMax = +mx.value; });
        const lb = h('input.input', { value: q.scaleLabels || '', placeholder: t('scaleLabelsPh') });
        lb.addEventListener('input', () => { q.scaleLabels = lb.value; });
        formBox.append(h('div.row', h('span.lbl', t('scaleMax')), mx), lb);
      }
      // time & scoring
      const timeSel = h('select.input', [0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300].map((s) => h('option', { value: s, selected: +q.time === s }, s ? s + ' s' : t('noLimit'))));
      if (![0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300].includes(+q.time)) timeSel.appendChild(h('option', { value: q.time, selected: true }, q.time + ' s'));
      timeSel.addEventListener('change', () => { q.time = +timeSel.value; });
      const pts = h('input.input.num', { type: 'number', min: 0, max: 10000, step: 50, value: q.points || 0 });
      pts.addEventListener('input', () => { q.points = +pts.value || 0; });
      const scoreRow = [];
      if (['mcq', 'tf', 'open'].includes(q.type) || q.type === 'ideas') {
        const sc = h('select.input',
          h('option', { value: 'auto', selected: q.scoring !== 'manual' && q.speedBonus !== false }, '🤖 ' + t('autoSpeed')),
          h('option', { value: 'flat', selected: q.scoring !== 'manual' && q.speedBonus === false }, '🤖 ' + t('autoFlat')),
          ['open', 'ideas'].includes(q.type) ? h('option', { value: 'manual', selected: q.scoring === 'manual' }, '✍️ ' + t('manual05')) : null);
        sc.addEventListener('change', () => { q.scoring = sc.value === 'manual' ? 'manual' : 'auto'; q.speedBonus = sc.value !== 'flat'; });
        scoreRow.push(h('div', h('div.lbl', t('scoring')), sc));
      }
      formBox.append(h('div.grid3',
        q.type !== 'ideas' ? h('div', h('div.lbl', '⏱ ' + t('timeLimit')), timeSel) : null,
        !['poll', 'cloud', 'scale'].includes(q.type) ? h('div', h('div.lbl', '🏆 ' + t('worth')), pts) : null,
        scoreRow));
      const src = h('input.input', { value: q.source || '', placeholder: t('sourcePh') });
      src.addEventListener('input', () => { q.source = src.value; });
      formBox.append(h('details.more', h('summary', '📖 ' + t('sourceLbl')), src));

      const add = h('button.btn.primary', { on: { click: () => {
        if (!q.text.trim()) { H.toast(t('needText'), 'err'); text.focus(); return; }
        if (['mcq', 'poll'].includes(q.type)) {
          q.options = q.options.filter((o) => o.text.trim() || o.image);
          if (q.options.length < 2) { H.toast(t('needOptions'), 'err'); renderForm(); return; }
          if (q.correct >= q.options.length) q.correct = 0;
        }
        if (editing >= 0) quiz.questions[editing] = q; else quiz.questions.push(q);
        editing = -1; form = blankQ(q.type); renderForm(); renderList();
        opts.onChange && opts.onChange();
      } } }, editing >= 0 ? '✓ ' + t('updateQuestion') : '+ ' + t('addToQuiz'));
      const cancel = editing >= 0 ? h('button.btn.ghost', { on: { click: () => { editing = -1; form = blankQ(q.type); renderForm(); renderList(); } } }, t('cancel')) : null;
      formBox.append(h('div.row.end', cancel, add));
    }

    function bankList() {
      const b = opts.bank ? opts.bank() : [];
      if (!b.length) return null;
      return h('details.more.bank', h('summary', '📥 ' + t('fromStudents') + ' (' + b.length + ')'),
        b.map((x) => h('div.bank-item', h('div.grow', h('b', x.q.text), h('div.muted.sm', (x.author || '') + ' · ' + x.q.options.map((o, i) => (i === x.q.correct ? '✓' : '') + o.text).join(' / '))),
          h('button.btn.sm', { on: { click: () => { form = Object.assign(blankQ(x.q.type), JSON.parse(JSON.stringify(x.q)), { id: 'q_' + H.uid(6) }); editing = -1; renderForm(); } } }, t('use')))));
    }

    const saveBtn = h('button.btn', { on: { click: async () => {
      if (!quiz.title.trim()) quiz.title = t('quiz') + ' ' + new Date().toLocaleDateString();
      quiz.updated = Date.now();
      await H.store.quizzes.put(JSON.parse(JSON.stringify(quiz)));
      H.toast(t('saved'), 'ok');
      opts.onSave && opts.onSave(quiz);
    } } }, '💾 ' + t('save'));
    const startBtn = opts.onStart ? h('button.btn.success', { on: { click: () => {
      if (!quiz.questions.length && form.text.trim()) { quiz.questions.push(form); }
      if (!quiz.questions.length) { H.toast(t('quizEmpty'), 'err'); return; }
      opts.onStart(quiz);
    } } }, '▶ ' + t('startQuiz')) : null;

    root.innerHTML = '';
    root.append(
      h('div.grid2', h('div', h('div.lbl', t('quizTitle')), titleIn), h('div', h('div.lbl', t('subjectLbl')), subjIn)),
      h('div.lbl', t('questions')), listBox,
      bankList(),
      h('div.q-form-wrap', h('h4', editing >= 0 ? t('editQuestion') : t('addQuestion')), formBox),
      h('div.row.end.sticky-actions', saveBtn, startBtn));
    renderList(); renderForm();
  };

  // ---------------- quiz page ----------------
  H.routes.quiz = async function (app, [id]) {
    let quiz = id && id !== 'new' ? await H.store.quizzes.get(id) : null;
    const isNew = !quiz;
    if (!quiz) quiz = H.quizNew();
    document.title = (quiz.title || t('newQuiz')) + ' · Lectern';
    app.appendChild(H.ui.topbar());
    const box = h('div');
    app.appendChild(h('div.page', h('a.back', { href: '#/' }, '← ' + t('library')),
      h('section.card', h('div.card-head', h('h2', '🧠 ' + (isNew ? t('newQuiz') : t('editQuiz'))),
        h('span.muted.sm', t('quizPageHint'))), box)));
    H.quizBuilder(box, quiz, { onSave: (q) => { if (isNew) history.replaceState(null, '', '#/quiz/' + q.id); } });
  };

  // ---------------- Excel import / export ----------------
  const COLS = ['Type', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Correct', 'Time (s)', 'Points', 'Accepted answers', 'Source'];
  const TYPE_NAMES = { mcq: 'MCQ', tf: 'TF', poll: 'Poll', open: 'Open', cloud: 'Cloud', ideas: 'Ideas', scale: 'Scale' };
  H.quizIO = {
    async template() {
      const X = await H.need.xlsx();
      const rows = [COLS,
        ['MCQ', 'Which word means "very big"?', 'tiny', 'enormous', 'narrow', 'quiet', '', '', 'B', 20, 1000, '', 'Oxford Learner\'s Dictionary'],
        ['TF', 'A noun can be the subject of a sentence.', '', '', '', '', '', '', 'A', 15, 500, '', ''],
        ['Poll', 'How confident do you feel today?', 'Very', 'Somewhat', 'Not yet', '', '', '', '', 20, 0, '', ''],
        ['Open', 'Give a synonym of "happy".', '', '', '', '', '', '', '', 45, 1000, 'glad, joyful, cheerful, content', ''],
        ['Cloud', 'One word that describes this lesson', '', '', '', '', '', '', '', 60, 0, '', ''],
        ['Ideas', 'How could we practise vocabulary outside class?', '', '', '', '', '', '', '', 0, 500, '', ''],
        ['Scale', 'Rate the difficulty of this unit (1 = easy, 5 = hard)', '', '', '', '', '', '', '', 30, 0, '', ''],
      ];
      const ws = X.utils.aoa_to_sheet(rows);
      ws['!cols'] = COLS.map((c, i) => ({ wch: i === 1 ? 50 : i === 11 ? 30 : 14 }));
      const help = X.utils.aoa_to_sheet([['How to fill this sheet'],
        ['Type: MCQ (multiple choice), TF (True/False), Poll, Open (typed answer), Cloud (word cloud), Ideas (idea wall), Scale (rating 1–5)'],
        ['Correct: the letter of the right option (A, B, C…). For TF use A = True, B = False.'],
        ['Time: seconds (0 = no limit). Points: how much a correct answer is worth (speed bonus applies).'],
        ['Accepted answers (Open only): comma-separated answers that are marked right automatically.'],
        ['Sheet name becomes the quiz title. You can put several quizzes in one file (one per sheet).']]);
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'My quiz');
      X.utils.book_append_sheet(wb, help, 'Help');
      X.writeFile(wb, 'Lectern-quiz-template.xlsx');
    },
    async parse(file) {
      const X = await H.need.xlsx();
      const wb = X.read(await file.arrayBuffer());
      const quizzes = [];
      for (const name of wb.SheetNames) {
        if (/^help$/i.test(name)) continue;
        const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        if (!rows.length) continue;
        const head = rows[0].map((x) => String(x).toLowerCase());
        const col = (re, d) => { const i = head.findIndex((x) => re.test(x)); return i >= 0 ? i : d; };
        const cT = col(/^type/, 0), cQ = col(/question/, 1), cC = col(/correct|answer$/, 8), cTime = col(/time/, 9), cP = col(/point|worth/, 10), cA = col(/accept/, 11), cS = col(/source/, 12);
        const optCols = head.map((x, i) => (/^option|^choice/.test(x) ? i : -1)).filter((i) => i >= 0);
        const qz = H.quizNew(); qz.title = name;
        for (const r of rows.slice(1)) {
          const text = String(r[cQ] || '').trim();
          if (!text) continue;
          const tn = String(r[cT] || 'mcq').toLowerCase().replace(/[^a-z]/g, '');
          const type = { mcq: 'mcq', multiplechoice: 'mcq', tf: 'tf', truefalse: 'tf', poll: 'poll', open: 'open', typed: 'open', cloud: 'cloud', wordcloud: 'cloud', ideas: 'ideas', idea: 'ideas', ideawall: 'ideas', scale: 'scale', rating: 'scale' }[tn] || 'mcq';
          const q = blankQ(type);
          q.text = text;
          if (['mcq', 'poll'].includes(type)) q.options = (optCols.length ? optCols : [2, 3, 4, 5, 6, 7]).map((i) => ({ text: String(r[i] || '').trim() })).filter((o) => o.text);
          const cor = String(r[cC] || '').trim();
          if (['mcq', 'tf'].includes(type) && cor) {
            const L = cor.toUpperCase().charCodeAt(0) - 65;
            if (/^[A-H]$/i.test(cor)) q.correct = L;
            else if (type === 'tf') q.correct = /^(f|false|no|0|b)/i.test(cor) ? 1 : 0;
            else { const i = q.options.findIndex((o) => o.text.toLowerCase() === cor.toLowerCase()); q.correct = i >= 0 ? i : (parseInt(cor, 10) - 1 || 0); }
          }
          if (r[cTime] !== '' && r[cTime] != null) q.time = parseInt(r[cTime], 10) || 0;
          if (r[cP] !== '' && r[cP] != null) q.points = parseInt(r[cP], 10) || 0;
          if (r[cA]) q.accept = String(r[cA]);
          if (r[cS]) q.source = String(r[cS]);
          if (['mcq', 'poll'].includes(type) && q.options.length < 2) continue;
          qz.questions.push(q);
        }
        if (qz.questions.length) quizzes.push(qz);
      }
      return quizzes;
    },
    importDialog(done) {
      const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.ods', hidden: true });
      inp.addEventListener('change', async () => {
        try {
          const qs = await this.parse(inp.files[0]);
          if (!qs.length) throw new Error(t('importNone'));
          for (const q of qs) await H.store.quizzes.put(q);
          H.toast(t('importedQuizzes', { n: qs.length, q: qs.reduce((a, b) => a + b.questions.length, 0) }), 'ok');
          done && done();
        } catch (e) { H.toast(e.message, 'err'); }
      });
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
    },
    async exportQuiz(q) {
      const X = await H.need.xlsx();
      const rows = [COLS].concat(q.questions.map((x) => {
        const o = (x.options || []).map((y) => y.text);
        return [TYPE_NAMES[x.type], x.text, o[0] || '', o[1] || '', o[2] || '', o[3] || '', o[4] || '', o[5] || '',
          ['mcq', 'tf'].includes(x.type) ? String.fromCharCode(65 + (x.correct || 0)) : '', x.time || 0, x.points || 0, x.accept || '', x.source || ''];
      }));
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), (q.title || 'Quiz').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
      X.writeFile(wb, (q.title || 'quiz').replace(/[^\w\- ]+/g, '') + '.xlsx');
    },
  };
})(window.Hub);
