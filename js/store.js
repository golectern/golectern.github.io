/* Lectern — local storage (IndexedDB): lessons, file blobs, quizzes, results */
(function (H) {
  'use strict';
  const DB_NAME = 'myhub', VER = 1;
  let dbp;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['lessons', 'blobs', 'quizzes', 'results']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Storage aborted (disk full?)'));
    });
  }
  const api = (store) => ({
    get: (id) => tx(store, 'readonly', (s) => s.get(id)),
    all: () => tx(store, 'readonly', (s) => s.getAll()),
    put: (obj) => tx(store, 'readwrite', (s) => s.put(obj)),
    del: (id) => tx(store, 'readwrite', (s) => s.delete(id)),
    keys: () => tx(store, 'readonly', (s) => s.getAllKeys()),
  });

  H.store = {
    lessons: api('lessons'),
    blobs: api('blobs'),
    quizzes: api('quizzes'),
    results: api('results'),

    async putBlob(blob, id) {
      id = id || 'b_' + H.uid(12);
      await this.blobs.put({ id, blob, size: blob.size, type: blob.type });
      return id;
    },
    _urlCache: new Map(),
    async blobUrl(id) {
      if (!id) return null;
      if (this._urlCache.has(id)) return this._urlCache.get(id);
      const r = await this.blobs.get(id);
      if (!r) return null;
      const u = URL.createObjectURL(r.blob);
      this._urlCache.set(id, u);
      return u;
    },
    async getBlob(id) { const r = await this.blobs.get(id); return r ? r.blob : null; },

    /** Blob ids referenced by a lesson */
    lessonBlobIds(lesson) {
      const ids = new Set();
      for (const it of lesson.items || []) for (const k of ['blobId', 'thumbId', 'srcId']) if (it[k]) ids.add(it[k]);
      return ids;
    },
    async lessonSize(lesson) {
      let n = 0;
      for (const id of this.lessonBlobIds(lesson)) { const r = await this.blobs.get(id); if (r) n += r.size || 0; }
      return n;
    },
    async deleteLesson(id) {
      const l = await this.lessons.get(id);
      if (!l) return;
      const keep = new Set();
      for (const o of await this.lessons.all()) if (o.id !== id) this.lessonBlobIds(o).forEach((b) => keep.add(b));
      for (const b of this.lessonBlobIds(l)) if (!keep.has(b)) await this.blobs.del(b);
      await this.lessons.del(id);
    },
    async saveLesson(l) { l.updated = Date.now(); await this.lessons.put(l); return l; },

    async usage() {
      let used = 0, quota = 0;
      try { const e = await navigator.storage.estimate(); used = e.usage || 0; quota = e.quota || 0; } catch (e) { /* unsupported */ }
      return { used, quota };
    },
    async persist() { try { return await navigator.storage.persist(); } catch (e) { return false; } },

    /** Backup everything into a single .myhub (zip) file */
    async backup() {
      const JSZip = await H.need.zip();
      const z = new JSZip();
      const lessons = await this.lessons.all(), quizzes = await this.quizzes.all(), results = await this.results.all();
      z.file('data.json', JSON.stringify({ app: 'myhub', v: 1, at: Date.now(), lessons, quizzes, results }));
      const ids = new Set();
      lessons.forEach((l) => this.lessonBlobIds(l).forEach((i) => ids.add(i)));
      for (const id of ids) {
        const r = await this.blobs.get(id);
        if (r) z.file('blobs/' + id, r.blob, { binary: true, comment: r.type || '' });
      }
      const meta = {};
      for (const id of ids) { const r = await this.blobs.get(id); if (r) meta[id] = r.type || ''; }
      z.file('blobs.json', JSON.stringify(meta));
      return z.generateAsync({ type: 'blob', compression: 'STORE' });
    },
    async restore(file) {
      const JSZip = await H.need.zip();
      const z = await JSZip.loadAsync(file);
      const data = JSON.parse(await z.file('data.json').async('string'));
      if (data.app !== 'myhub') throw new Error('Not a Lectern backup file');
      const meta = z.file('blobs.json') ? JSON.parse(await z.file('blobs.json').async('string')) : {};
      const files = z.folder('blobs');
      const tasks = [];
      files.forEach((rel, f) => tasks.push((async () => {
        const buf = await f.async('arraybuffer');
        await this.blobs.put({ id: rel, blob: new Blob([buf], { type: meta[rel] || '' }), size: buf.byteLength, type: meta[rel] || '' });
      })()));
      await Promise.all(tasks);
      for (const l of data.lessons || []) await this.lessons.put(l);
      for (const q of data.quizzes || []) await this.quizzes.put(q);
      for (const r of data.results || []) await this.results.put(r);
      return { lessons: (data.lessons || []).length, quizzes: (data.quizzes || []).length };
    },
  };
})(window.Hub);
