/* Lectern — shared UI pieces: slide thumbnails, "add content" bar, slide list editor */
(function (H) {
  'use strict';
  const { h, t } = H;
  H.ui = {};

  const TYPE_ICON = { image: '🖼️', pptx: '📊', video: '🎬', gslides: '🟨', web: '🌐', board: '⬜' };
  H.ui.typeIcon = (it) => (it.type === 'image' && /pdf$/i.test(it.source || '') ? '📄' : TYPE_ICON[it.type] || '📎');

  /** Thumbnail element for one item */
  H.ui.thumb = function (it, idx) {
    const box = h('div.thumb');
    if (it.thumbId || it.blobId && it.type === 'image') {
      H.store.blobUrl(it.thumbId || it.blobId).then((u) => { if (u) box.appendChild(h('img', { src: u, alt: '', loading: 'lazy' })); });
    } else if (it.type === 'video' && it.platform === 'youtube') {
      box.appendChild(h('img', { src: `https://img.youtube.com/vi/${it.vid}/mqdefault.jpg`, alt: '' }));
      box.appendChild(h('span.thumb-play', '▶'));
    } else if (it.type === 'board') {
      box.classList.add('board-' + (it.bg || 'white'));
      box.appendChild(h('span.thumb-ico', '✏️'));
    } else {
      box.appendChild(h('span.thumb-ico', H.ui.typeIcon(it)));
      if (it.type === 'pptx') box.appendChild(h('span.thumb-cap', it.title));
    }
    if (idx != null) box.appendChild(h('span.thumb-num', String(idx + 1)));
    return box;
  };

  /** Row of buttons for adding content. onAdd(itemsArray) */
  H.ui.adders = function (onAdd, opts = {}) {
    const fileIn = h('input', { type: 'file', multiple: true, accept: H.importers.accept, hidden: true });
    const status = h('div.import-status');
    async function handleFiles(files) {
      files = Array.from(files || []);
      if (!files.length) return;
      for (const f of files) {
        status.textContent = t('importing', { name: f.name });
        status.classList.add('on');
        try {
          const items = await H.importers.fromFile(f, (p, n) => { status.textContent = t('importingPage', { name: f.name, p, n }); });
          await onAdd(items);
        } catch (e) { console.error(e); H.toast(e.message || String(e), 'err'); }
      }
      status.classList.remove('on');
      fileIn.value = '';
    }
    fileIn.addEventListener('change', () => handleFiles(fileIn.files));
    const drop = h('div.dropzone', { tabindex: 0, role: 'button', on: {
      click: () => fileIn.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); },
    } },
    h('div.dz-icon', '⬆️'),
    h('div.dz-title', t('dropTitle')),
    h('div.dz-sub', t('dropSub')));

    const videoIn = h('input.input', { placeholder: t('videoPlaceholder') });
    const addVideo = () => {
      if (!videoIn.value.trim()) return;
      try { onAdd(H.importers.fromVideoUrl(videoIn.value)); videoIn.value = ''; } catch (e) { H.toast(e.message, 'err'); }
    };
    videoIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addVideo(); });

    const gsIn = h('input.input', { placeholder: t('slidesPlaceholder') });
    const gsCount = h('input.input.num', { type: 'number', min: 1, max: 300, value: 10, title: t('slidesCount') });
    const addGs = () => {
      if (!gsIn.value.trim()) return;
      try { onAdd(H.importers.fromGoogleSlides(gsIn.value, gsCount.value)); gsIn.value = ''; } catch (e) { H.toast(e.message, 'err'); }
    };

    const webIn = h('input.input', { placeholder: t('webPlaceholder') });
    const addWeb = () => { if (webIn.value.trim()) { onAdd(H.importers.fromWeb(webIn.value.trim())); webIn.value = ''; } };
    webIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWeb(); });

    return h('div.adders', drop, fileIn, status,
      h('div.or', t('orVideo')),
      h('div.row', videoIn, h('button.btn', { on: { click: addVideo } }, t('addVideo'))),
      h('div.or', t('orSlides')),
      h('div.row', gsIn, gsCount, h('button.btn', { on: { click: addGs } }, t('importSlides'))),
      h('p.hint', t('slidesHint')),
      opts.compact ? null : h('div.or', t('orMore')),
      opts.compact ? null : h('div.row', webIn, h('button.btn', { on: { click: addWeb } }, t('addWeb'))),
      h('div.row.wrap',
        h('button.btn.ghost', { on: { click: () => onAdd(H.importers.board('white')) } }, '⬜ ' + t('blankWhite')),
        h('button.btn.ghost', { on: { click: () => onAdd(H.importers.board('grid')) } }, '▦ ' + t('blankGrid')),
        h('button.btn.ghost', { on: { click: () => onAdd(H.importers.board('black')) } }, '⬛ ' + t('blankBlack'))));
  };

  /** Editable list of slide items. lesson.items is mutated; onChange() after each edit */
  H.ui.itemsEditor = function (lesson, onChange) {
    const list = h('div.items');
    let dragFrom = null;
    function render() {
      list.innerHTML = '';
      if (!lesson.items.length) { list.appendChild(h('p.empty', t('noSlidesYet'))); return; }
      lesson.items.forEach((it, i) => {
        const row = h('div.item', { draggable: true, on: {
          dragstart: (e) => { dragFrom = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; },
          dragend: () => row.classList.remove('dragging'),
          dragover: (e) => { e.preventDefault(); row.classList.add('drop-target'); },
          dragleave: () => row.classList.remove('drop-target'),
          drop: (e) => {
            e.preventDefault(); row.classList.remove('drop-target');
            if (dragFrom == null || dragFrom === i) return;
            const [m] = lesson.items.splice(dragFrom, 1);
            lesson.items.splice(i, 0, m); dragFrom = null; changed();
          },
        } },
        H.ui.thumb(it, i),
        h('div.item-main',
          h('div.item-title', h('span.badge', H.ui.typeIcon(it)), ' ', it.title || t('untitled')),
          h('div.item-sub', [it.source, (it.notes || it.fileNotes) ? '📝 ' + t('hasNotes') : null].filter(Boolean).join(' · '))),
        h('div.item-actions',
          h('button.icon-btn', { title: t('notes'), on: { click: () => editNotes(it) } }, '📝'),
          h('button.icon-btn', { title: t('rename'), on: { click: async () => { const v = await H.prompt(t('rename'), '', it.title); if (v != null) { it.title = v; changed(); } } } }, '✎'),
          h('button.icon-btn', { title: t('moveUp'), disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
          h('button.icon-btn', { title: t('moveDown'), disabled: i === lesson.items.length - 1, on: { click: () => move(i, 1) } }, '↓'),
          h('button.icon-btn', { title: t('duplicate'), on: { click: () => { lesson.items.splice(i + 1, 0, JSON.parse(JSON.stringify(it))); changed(); } } }, '⧉'),
          h('button.icon-btn.danger', { title: t('delete'), on: { click: () => { lesson.items.splice(i, 1); changed(); } } }, '✕')));
        list.appendChild(row);
      });
    }
    function move(i, d) { const j = i + d; if (j < 0 || j >= lesson.items.length) return; const [m] = lesson.items.splice(i, 1); lesson.items.splice(j, 0, m); changed(); }
    function changed() { render(); onChange && onChange(); }
    async function editNotes(it) {
      const body = [];
      if (it.fileNotes) body.push(h('label.lbl', t('notesFromFile')), h('div.notes-file', it.fileNotes));
      const ta = h('textarea.input', { rows: 6, placeholder: t('notesPlaceholder'), value: it.notes || '' });
      body.push(h('label.lbl', t('yourNotes')), ta);
      const m = H.modal(t('notes') + ' — ' + (it.title || ''), body, { actions: [
        h('button.btn.ghost', { on: { click: () => m.close() } }, t('cancel')),
        h('button.btn.primary', { on: { click: () => { it.notes = ta.value; m.close(); changed(); } } }, t('save')),
      ] });
    }
    render();
    list.refresh = render;
    return list;
  };

  /** Standard page header */
  H.ui.topbar = function (extra) {
    return h('header.topbar',
      h('a.brand', { href: '#/' }, h('span.logo', '◆'), ' Lectern'),
      h('div.top-actions', extra || null, H.langToggle()));
  };
})(window.Hub);
