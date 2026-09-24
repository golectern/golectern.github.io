/* Lectern — home (library & uploader), lesson editor, settings */
(function (H) {
  'use strict';
  const { h, t } = H;

  H.newLesson = (title) => ({ id: 'l_' + H.uid(), title: title || '', items: [], created: Date.now(), updated: Date.now(), ink: {} });

  async function gcBlobs() {
    // remove files no longer used by any lesson (e.g. an upload that was never saved)
    const used = new Set();
    for (const l of await H.store.lessons.all()) H.store.lessonBlobIds(l).forEach((b) => used.add(b));
    if (H.draft) H.store.lessonBlobIds(H.draft).forEach((b) => used.add(b));
    for (const k of await H.store.blobs.keys()) if (!used.has(k)) await H.store.blobs.del(k);
  }

  // ---------------- HOME ----------------
  H.routes.home = async function (app) {
    document.title = 'Lectern';
    const lessons = (await H.store.lessons.all()).sort((a, b) => b.updated - a.updated);
    const quizzes = (await H.store.quizzes.all()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const results = (await H.store.results.all()).sort((a, b) => b.at - a.at);
    if (!H.draft) { await gcBlobs().catch(() => {}); H.draft = H.newLesson(); }
    const draft = H.draft;
    const usage = await H.store.usage();

    const page = h('div.page');
    app.appendChild(H.ui.topbar(h('button.btn.ghost.sm', { on: { click: openSettings } }, '⚙ ' + t('settings'))));
    app.appendChild(page);

    // hero + stats
    page.appendChild(h('section.hero',
      h('div', h('h1', t('heroTitle')), h('p.muted', t('heroSub'))),
      h('div.hero-actions',
        h('button.btn.primary', { on: { click: () => H.$('#uploader').scrollIntoView({ behavior: 'smooth' }) } }, '+ ' + t('newLesson')),
        h('a.btn', { href: '#/quiz/new' }, '🧠 ' + t('newQuiz')))));
    const pct = usage.quota ? Math.min(100, usage.used / usage.quota * 100) : 0;
    page.appendChild(h('div.stats',
      stat(t('lessons'), String(lessons.length)),
      stat(t('quizzes'), String(quizzes.length)),
      stat(t('sessionsRun'), String(results.length)),
      h('div.stat', h('div.stat-top', h('span', t('storage')), h('b', H.fmtBytes(usage.used) + (usage.quota ? ' / ' + H.fmtBytes(usage.quota) : ''))),
        h('div.bar', h('i', { style: { width: Math.max(pct, 1) + '%' } })))));

    // uploader
    const titleIn = h('input.input.title-in', { placeholder: t('lessonTitlePh'), value: draft.title });
    titleIn.addEventListener('input', () => { draft.title = titleIn.value; });
    const startBtn = h('button.btn.primary.lg');
    const saveBtn = h('button.btn.lg');
    const refreshBtns = () => {
      startBtn.textContent = '▶ ' + t('startLesson', { n: draft.items.length });
      startBtn.disabled = saveBtn.disabled = !draft.items.length;
      saveBtn.textContent = '💾 ' + t('saveToLibrary');
    };
    const itemsEd = H.ui.itemsEditor(draft, refreshBtns);
    const commit = async () => {
      if (!draft.title.trim()) draft.title = (draft.items[0] && (draft.items[0].source || draft.items[0].title)) || t('untitled');
      await H.store.saveLesson(draft);
      const id = draft.id; H.draft = null; return id;
    };
    startBtn.addEventListener('click', async () => { const id = await commit(); H.router.go('/present/' + id); });
    saveBtn.addEventListener('click', async () => { await commit(); H.toast(t('saved'), 'ok'); H.router.render(); });
    refreshBtns();
    page.appendChild(h('section.card#uploader',
      h('div.card-head', h('h2', '⬆️ ' + t('uploader')), h('span.muted', t('uploaderSub'))),
      titleIn,
      H.ui.adders(async (items) => { draft.items.push(...items); itemsEd.refresh(); refreshBtns(); }),
      itemsEd,
      h('div.row.end', saveBtn, startBtn)));

    // library
    const lib = h('section.card', h('div.card-head', h('h2', '📚 ' + t('library')), h('span.muted', t('libraryCount', { n: lessons.length }))));
    if (!lessons.length) lib.appendChild(h('p.empty', t('noLessons')));
    for (const l of lessons) {
      const size = h('span.muted.sm', '…');
      H.store.lessonSize(l).then((n) => { size.textContent = H.fmtBytes(n); });
      lib.appendChild(h('div.lesson-row',
        l.items[0] ? H.ui.thumb(l.items[0]) : h('div.thumb', h('span.thumb-ico', '📁')),
        h('div.lesson-main',
          h('div.lesson-title', l.title || t('untitled')),
          h('div.muted.sm', t('nSlides', { n: l.items.length }), ' · ', H.fmtDate(l.updated), ' · ', size)),
        h('div.lesson-actions',
          h('a.btn.success', { href: '#/present/' + l.id }, '▶ ' + t('present')),
          h('a.btn.ghost', { href: '#/lesson/' + l.id }, '✎ ' + t('edit')),
          h('button.icon-btn', { title: t('duplicate'), on: { click: async () => {
            const c = JSON.parse(JSON.stringify(l)); c.id = 'l_' + H.uid(); c.title = l.title + ' (2)'; c.created = Date.now();
            await H.store.saveLesson(c); H.router.render();
          } } }, '⧉'),
          h('button.icon-btn.danger', { title: t('delete'), on: { click: async () => {
            if (await H.confirm(t('deleteLesson'), t('deleteLessonTxt', { name: l.title }), true)) { await H.store.deleteLesson(l.id); H.router.render(); }
          } } }, '✕'))));
    }
    page.appendChild(lib);

    // quizzes
    const qz = h('section.card', h('div.card-head', h('h2', '🧠 ' + t('quizzes')),
      h('div.row',
        h('a.btn.sm', { href: '#/quiz/new' }, '+ ' + t('newQuiz')),
        h('button.btn.ghost.sm', { on: { click: () => H.quizIO.importDialog(() => H.router.render()) } }, '📥 ' + t('importExcel')),
        h('button.btn.ghost.sm', { on: { click: () => H.quizIO.template() } }, '⬇ ' + t('template')))));
    if (!quizzes.length) qz.appendChild(h('p.empty', t('noQuizzes')));
    for (const q of quizzes) {
      qz.appendChild(h('div.lesson-row',
        h('div.thumb.quiz-thumb', h('span.thumb-ico', '🧠')),
        h('div.lesson-main', h('div.lesson-title', q.title || t('untitled')),
          h('div.muted.sm', t('nQuestions', { n: (q.questions || []).length }), q.subject ? ' · ' + q.subject : '')),
        h('div.lesson-actions',
          h('a.btn.ghost', { href: '#/quiz/' + q.id }, '✎ ' + t('edit')),
          h('button.icon-btn', { title: t('exportExcel'), on: { click: () => H.quizIO.exportQuiz(q) } }, '⬇'),
          h('button.icon-btn.danger', { title: t('delete'), on: { click: async () => {
            if (await H.confirm(t('delete'), q.title, true)) { await H.store.quizzes.del(q.id); H.router.render(); }
          } } }, '✕'))));
    }
    page.appendChild(qz);

    // results
    const rs = h('section.card', h('div.card-head', h('h2', '📊 ' + t('pastSessions'))));
    if (!results.length) rs.appendChild(h('p.empty', t('noResults')));
    for (const r of results.slice(0, 50)) {
      rs.appendChild(h('div.lesson-row',
        h('div.thumb.quiz-thumb', h('span.thumb-ico', r.kind === 'attendance' ? '🧑‍🎓' : '🏆')),
        h('div.lesson-main', h('div.lesson-title', r.title || t('untitled')),
          h('div.muted.sm', H.fmtDate(r.at), ' · ', t('nPeople', { n: (r.people || []).length }))),
        h('div.lesson-actions',
          r.kind !== 'attendance' ? h('button.btn.ghost.sm', { on: { click: () => H.exports.resultsXlsx(r) } }, 'Excel') : null,
          r.kind !== 'attendance' ? h('button.btn.ghost.sm', { on: { click: () => H.exports.resultsPdf(r) } }, 'PDF') : null,
          r.kind === 'attendance' ? h('button.btn.ghost.sm', { on: { click: () => H.exports.attendanceXlsx(r) } }, 'Excel') : null,
          h('button.icon-btn.danger', { on: { click: async () => { await H.store.results.del(r.id); H.router.render(); } } }, '✕'))));
    }
    page.appendChild(rs);

    // backup
    const restoreIn = h('input', { type: 'file', accept: '.lectern,.myhub,.zip', hidden: true });
    restoreIn.addEventListener('change', async () => {
      const f = restoreIn.files[0]; if (!f) return;
      try { const r = await H.store.restore(f); H.toast(t('restored', r), 'ok'); H.router.render(); } catch (e) { H.toast(e.message, 'err'); }
    });
    page.appendChild(h('section.card.subtle',
      h('div.card-head', h('h2', '🛟 ' + t('backup')), h('span.muted', t('backupSub'))),
      h('div.row.wrap',
        h('button.btn', { on: { click: async () => {
          H.toast(t('preparing'));
          const b = await H.store.backup();
          H.download(b, `Lectern-backup-${new Date().toISOString().slice(0, 10)}.lectern`);
        } } }, '⬇ ' + t('downloadBackup')),
        h('button.btn.ghost', { on: { click: () => restoreIn.click() } }, '⬆ ' + t('restoreBackup')), restoreIn)));

    page.appendChild(h('footer.foot', 'Lectern · ', h('a', { href: '#/help' }, t('help'))));
    H.store.persist();

    function stat(label, val) { return h('div.stat', h('div.stat-top', h('span', label), h('b', val))); }
  };

  // ---------------- LESSON EDITOR ----------------
  H.routes.lesson = async function (app, [id]) {
    const lesson = await H.store.lessons.get(id);
    if (!lesson) throw new Error(t('notFound'));
    document.title = (lesson.title || 'Lesson') + ' · Lectern';
    const save = H.debounce(() => H.store.saveLesson(lesson).then(() => { saved.textContent = t('saved') + ' ✓'; }), 400);
    const saved = h('span.muted.sm');
    const changed = () => { saved.textContent = '…'; save(); };
    const titleIn = h('input.input.title-in', { value: lesson.title, placeholder: t('lessonTitlePh') });
    titleIn.addEventListener('input', () => { lesson.title = titleIn.value; changed(); });
    const ed = H.ui.itemsEditor(lesson, changed);
    app.appendChild(H.ui.topbar(h('a.btn.success.sm', { href: '#/present/' + lesson.id }, '▶ ' + t('present'))));
    app.appendChild(h('div.page',
      h('a.back', { href: '#/' }, '← ' + t('library')),
      h('section.card', h('div.card-head', h('h2', '✎ ' + t('editLesson')), saved), titleIn, ed),
      h('section.card', h('div.card-head', h('h2', '+ ' + t('addContent'))),
        H.ui.adders(async (items) => { lesson.items.push(...items); ed.refresh(); changed(); })),
      lesson.ink && Object.keys(lesson.ink).length ? h('section.card.subtle', h('div.row',
        h('span', '✏️ ' + t('savedDrawings', { n: Object.keys(lesson.ink).length })),
        h('button.btn.ghost.sm', { on: { click: () => { lesson.ink = {}; changed(); H.router.render(); } } }, t('clearDrawings')),
        h('button.btn.ghost.sm', { on: { click: () => H.exports.lessonPdf(lesson) } }, '⬇ ' + t('exportPdf')))) :
        h('section.card.subtle', h('div.row', h('button.btn.ghost.sm', { on: { click: () => H.exports.lessonPdf(lesson) } }, '⬇ ' + t('exportPdf'))))));
  };

  // ---------------- SETTINGS ----------------
  function openSettings() {
    const url = h('input.input', { value: H.settings.get('publicUrl', ''), placeholder: 'https://golectern.github.io/' });
    const code = H.settings.get('classCode', '');
    const qtime = h('input.input.num', { type: 'number', min: 0, max: 600, value: H.settings.get('defaultTime', 30) });
    const qpts = h('input.input.num', { type: 'number', min: 0, max: 10000, value: H.settings.get('defaultPoints', 1000) });
    const autoHide = h('input', { type: 'checkbox', checked: H.settings.get('autoHideBar', true) });
    const reactions = h('input', { type: 'checkbox', checked: H.settings.get('showReactions', true) });
    const m = H.modal('⚙ ' + t('settings'), [
      h('label.lbl', t('publicUrl')), url, h('p.hint', t('publicUrlHint')),
      h('label.lbl', t('classCode')),
      h('div.row', h('code.code-pill', code || '—'), h('button.btn.ghost.sm', { on: { click: () => { H.settings.set('classCode', H.code()); m.close(); openSettings(); } } }, t('newCode'))),
      h('p.hint', t('classCodeHint')),
      h('div.grid2',
        h('div', h('label.lbl', t('defaultTime')), qtime),
        h('div', h('label.lbl', t('defaultPoints')), qpts)),
      h('label.check', autoHide, ' ', t('autoHideBar')),
      h('label.check', reactions, ' ', t('showReactions')),
    ], { actions: [
      h('button.btn.ghost', { on: { click: () => m.close() } }, t('cancel')),
      h('button.btn.primary', { on: { click: () => {
        H.settings.set('publicUrl', url.value.trim());
        H.settings.set('defaultTime', +qtime.value || 0);
        H.settings.set('defaultPoints', +qpts.value || 0);
        H.settings.set('autoHideBar', autoHide.checked);
        H.settings.set('showReactions', reactions.checked);
        m.close(); H.toast(t('saved'), 'ok');
      } } }, t('save')),
    ] });
  }
  H.openSettings = openSettings;

  // ---------------- HELP ----------------
  H.routes.help = async function (app) {
    app.appendChild(H.ui.topbar());
    const sec = (title, lines) => h('section.card', h('h2', title), h('ul.help', lines.map((l) => h('li', { html: l }))));
    app.appendChild(h('div.page', h('a.back', { href: '#/' }, '← ' + t('library')),
      sec(t('helpKeys'), [
        '<kbd>→</kbd> <kbd>Space</kbd> <kbd>PageDown</kbd> — ' + t('next') + ' · <kbd>←</kbd> <kbd>PageUp</kbd> — ' + t('prev'),
        '<kbd>Home</kbd>/<kbd>End</kbd> — ' + t('first') + ' / ' + t('last') + ' · <kbd>G</kbd> — ' + t('overview'),
        '<kbd>L</kbd> ' + t('laser') + ' · <kbd>P</kbd> ' + t('draw') + ' · <kbd>H</kbd> ' + t('highlight') + ' · <kbd>E</kbd> ' + t('erase') + ' · <kbd>T</kbd> ' + t('textbox') + ' · <kbd>S</kbd> ' + t('spotlight') + ' · <kbd>Z</kbd> ' + t('zoom'),
        '<kbd>B</kbd> ' + t('black') + ' · <kbd>W</kbd> ' + t('white') + ' · <kbd>C</kbd> ' + t('clear') + ' · <kbd>Ctrl</kbd>+<kbd>Z</kbd> ' + t('undo'),
        '<kbd>F</kbd> ' + t('fullScreen') + ' · <kbd>N</kbd> ' + t('notes') + ' · <kbd>Q</kbd> ' + t('quiz') + ' · <kbd>R</kbd> ' + t('randomPicker') + ' · <kbd>Esc</kbd> ' + t('selectNone'),
      ]),
      sec(t('helpPhones'), [t('helpPhones1'), t('helpPhones2'), t('helpPhones3')])));
  };
})(window.Hub);
