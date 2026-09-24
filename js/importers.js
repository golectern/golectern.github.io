/* Lectern — turning files and links into slide items */
(function (H) {
  'use strict';
  const MAX_W = 1920, THUMB_W = 360;

  function canvasToBlob(c, type = 'image/jpeg', q = 0.86) {
    return new Promise((res) => c.toBlob(res, type, q));
  }
  async function loadImg(src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    return img;
  }
  async function thumbFrom(source, w, hgt) {
    const tw = THUMB_W, th = Math.round(THUMB_W * hgt / w) || 202;
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, tw, th);
    x.drawImage(source, 0, 0, tw, th);
    return canvasToBlob(c, 'image/jpeg', 0.75);
  }

  async function importPdf(file, onProgress) {
    const pdfjs = await H.need.pdf();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress && onProgress(p, doc.numPages);
      const page = await doc.getPage(p);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_W / v1.width, 3);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await canvasToBlob(c);
      const thumb = await thumbFrom(c, c.width, c.height);
      let title = '';
      try {
        const tc = await page.getTextContent();
        title = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 70);
      } catch (e) { /* no text layer */ }
      items.push({
        type: 'image', blobId: await H.store.putBlob(blob), thumbId: await H.store.putBlob(thumb),
        w: c.width, h: c.height, title: title || `${file.name} · ${p}`, source: file.name, fileNotes: '',
      });
      page.cleanup();
    }
    doc.destroy();
    return items;
  }

  async function importImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      const w = img.naturalWidth || 1600, hh = img.naturalHeight || 900;
      let blob = file;
      // Very large photos are shrunk so the stage stays fast.
      if (w > 2600 && !/svg|gif/.test(file.type)) {
        const s = 2600 / w;
        const c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(hh * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        blob = await canvasToBlob(c, 'image/jpeg', 0.88);
      }
      const thumb = await thumbFrom(img, w, hh);
      return [{
        type: 'image', blobId: await H.store.putBlob(blob), thumbId: await H.store.putBlob(thumb),
        w, h: hh, title: file.name.replace(/\.[^.]+$/, ''), source: file.name, fileNotes: '',
      }];
    } finally { URL.revokeObjectURL(url); }
  }

  const xmlText = (xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = Array.from(doc.getElementsByTagName('a:p')).map((p) =>
      Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent).join(''));
    return { doc, paras };
  };

  async function importPptx(file) {
    const JSZip = await H.need.zip();
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const pres = await zip.file('ppt/presentation.xml').async('string');
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
    const relMap = {};
    presRels.replace(/<Relationship\b[^>]*>/g, (tag) => {
      const id = (tag.match(/Id="([^"]+)"/) || [])[1];
      const tg = (tag.match(/Target="([^"]+)"/) || [])[1];
      if (id && tg) relMap[id] = tg.replace(/^\/?ppt\//, '').replace(/^\.\.\//, '');
      return tag;
    });
    const order = [];
    pres.replace(/<p:sldId\b[^>]*>/g, (tag) => {
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
      if (rid && relMap[rid]) order.push('ppt/' + relMap[rid]);
      return tag;
    });
    const sz = pres.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    const pw = sz ? +sz[1] : 16, ph = sz ? +sz[2] : 9;
    const srcId = await H.store.putBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    const items = [];
    for (let i = 0; i < order.length; i++) {
      const path = order[i];
      const f = zip.file(path);
      let title = '', notes = '', hidden = false;
      if (f) {
        const x = await f.async('string');
        hidden = /<p:sld\b[^>]*\bshow="0"/.test(x);
        const { paras } = xmlText(x);
        title = paras.find((p) => p.trim()) || '';
        const relPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
        const rel = zip.file(relPath);
        if (rel) {
          const rx = await rel.async('string');
          const nt = (rx.match(/Target="([^"]*notesSlide[^"]*)"/) || [])[1];
          if (nt) {
            const np = 'ppt/' + nt.replace(/^\.\.\//, '').replace(/^\/?ppt\//, '');
            const nf = zip.file(np);
            if (nf) {
              const nx = await nf.async('string');
              // Only take text from the notes body placeholder (skip slide number / header shapes).
              const doc = new DOMParser().parseFromString(nx, 'application/xml');
              const shapes = Array.from(doc.getElementsByTagName('p:sp'));
              const out = [];
              for (const sp of shapes) {
                const ph = sp.getElementsByTagName('p:ph')[0];
                const typ = ph && ph.getAttribute('type');
                if (ph && typ && typ !== 'body') continue;
                for (const p of Array.from(sp.getElementsByTagName('a:p'))) out.push(Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent).join(''));
              }
              notes = out.join('\n').trim();
            }
          }
        }
      }
      if (hidden) continue;
      items.push({ type: 'pptx', srcId, index: i, w: pw, h: ph, title: title.slice(0, 80) || `${file.name} · ${i + 1}`, source: file.name, fileNotes: notes });
    }
    return items;
  }

  async function importVideoFile(file) {
    return [{ type: 'video', platform: 'file', blobId: await H.store.putBlob(file), title: file.name, source: file.name }];
  }

  H.parseVideoUrl = function (url) {
    url = String(url || '').trim();
    let m;
    const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
    if ((m = url.match(yt))) {
      const t = (url.match(/[?&#](?:t|start)=(\d+)(?:s)?/) || [])[1];
      return { platform: 'youtube', vid: m[1], start: t ? +t : 0 };
    }
    if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) return { platform: 'vimeo', vid: m[1] };
    if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/i))) return { platform: 'gdrive', vid: m[1] };
    if (/^https?:\/\/.+\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)) return { platform: 'direct', src: url };
    return null;
  };

  H.importers = {
    accept: '.pdf,.pptx,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.mp4,.webm,.mov,.m4v,application/pdf,image/*,video/*',
    async fromFile(file, onProgress) {
      const n = file.name.toLowerCase();
      if (n.endsWith('.pdf') || file.type === 'application/pdf') return importPdf(file, onProgress);
      if (n.endsWith('.pptx')) return importPptx(file);
      if (n.endsWith('.ppt')) throw new Error(H.t('pptOld'));
      if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return importImage(file);
      if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(n)) return importVideoFile(file);
      throw new Error(H.t('unsupported', { name: file.name }));
    },
    fromVideoUrl(url) {
      const v = H.parseVideoUrl(url);
      if (!v) throw new Error(H.t('badVideo'));
      return [{ type: 'video', url, ...v, title: v.platform === 'youtube' ? 'YouTube video' : v.platform === 'vimeo' ? 'Vimeo video' : 'Video' }];
    },
    fromGoogleSlides(url, count) {
      const m = String(url).match(/presentation\/d\/(?:e\/)?([\w-]+)/);
      if (!m) throw new Error(H.t('badSlides'));
      const published = /\/d\/e\//.test(url);
      count = Math.max(1, Math.min(300, parseInt(count, 10) || 1));
      const out = [];
      for (let i = 1; i <= count; i++) out.push({ type: 'gslides', pid: m[1], published, n: i, title: `Google Slides · ${i}` });
      return out;
    },
    fromWeb(url) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      return [{ type: 'web', url, title: url.replace(/^https?:\/\//, '').slice(0, 60) }];
    },
    board(bg = 'white') { return [{ type: 'board', bg, title: H.t('whiteboard') }]; },
    async fromPhoto(dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      const f = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      const [it] = await importImage(f);
      it.title = H.t('photoFromPhone');
      return it;
    },
  };
})(window.Hub);
