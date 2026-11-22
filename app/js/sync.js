/* Z Note · sync folder — keeps the notebook in a folder (for example inside OneDrive) so several PCs share it.
   Layout inside the chosen folder:
     Z Note notebook/pages/<id>.json      one file per page
     Z Note notebook/images/<id>.<ext>    pictures, each with <id>.json describing it
     Z Note notebook/deleted/*.del        records of pages (p_) and pictures (i_) deleted for good
   Rule: for each page or picture, the copy that was changed last wins. */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui, db = ZN.db;

  const SUB = 'Z Note notebook';
  const KEEP_DELETED = 180 * 864e5;
  const modOf = x => +x.mod || +x.updated || +x.created || 0;
  const extOf = mime => (/jpe?g/.test(mime) ? 'jpg' : /gif/.test(mime) ? 'gif' : /webp/.test(mime) ? 'webp' : 'png');
  const SAFE_ID = /^[a-z0-9]{4,40}$/i;
  const SAFE_IMG = /^[a-z0-9]{4,40}\.(png|jpg|gif|webp)$/i;

  let busy = false, again = false, banner = null;
  const pageCache = new Map();     // file name → { lm, size, id, mod }
  const imgCache = new Map();      // file name → { lm, size, meta }

  const sync = (ZN.sync = {
    supported: typeof window.showDirectoryPicker === 'function',
    dir: null,           // the folder the user chose
    state: 'none',       // none · ready · locked (the browser wants a click first) · error
    lastAt: 0,
    lastError: ''
  });

  /* ---------- small file helpers ---------- */
  async function permission(ask) {
    try {
      if (!sync.dir.queryPermission) return 'ready';
      const o = { mode: 'readwrite' };
      if ((await sync.dir.queryPermission(o)) === 'granted') return 'ready';
      if (ask && (await sync.dir.requestPermission(o)) === 'granted') return 'ready';
    } catch (e) { console.warn('[Z Note] sync folder permission', e); }
    return 'locked';
  }
  async function writeFile(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return fh.getFile();
  }
  const writeJSON = (dir, name, obj) => writeFile(dir, name, new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  async function readJSON(dir, name) { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); }
  async function remove(dir, name) { try { await dir.removeEntry(name); } catch (e) { /* already gone */ } }
  async function folders() {
    const root = await sync.dir.getDirectoryHandle(SUB, { create: true });
    return {
      pages: await root.getDirectoryHandle('pages', { create: true }),
      images: await root.getDirectoryHandle('images', { create: true }),
      deleted: await root.getDirectoryHandle('deleted', { create: true })
    };
  }

  /* what the folder holds: page id → { mod, name, extra: [older duplicate files, e.g. OneDrive conflict copies] } */
  async function scanPages(dir) {
    const out = new Map(), seen = new Set();
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind !== 'file' || !/\.json$/i.test(name)) continue;
      seen.add(name);
      let f;
      try { f = await hnd.getFile(); } catch (e) { continue; }
      let c = pageCache.get(name);
      if (!c || c.lm !== f.lastModified || c.size !== f.size) {
        try {
          const raw = JSON.parse(await f.text());
          if (!raw || !SAFE_ID.test(String(raw.id))) continue;
          c = { lm: f.lastModified, size: f.size, id: String(raw.id), mod: modOf(raw) };
          pageCache.set(name, c);
        } catch (e) { continue; }                 // still arriving or unreadable: look again next time
      }
      const cur = out.get(c.id);
      if (!cur) out.set(c.id, { mod: c.mod, name, extra: [] });
      else if (c.mod > cur.mod) { cur.extra.push(cur.name); cur.mod = c.mod; cur.name = name; }
      else cur.extra.push(name);
    }
    pageCache.forEach((v, k) => { if (!seen.has(k)) pageCache.delete(k); });
    return out;
  }

  /* picture id → { mod, name (its .json), meta } */
  async function scanImages(dir) {
    const out = new Map(), seen = new Set();
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind !== 'file' || !/\.json$/i.test(name)) continue;
      seen.add(name);
      let f;
      try { f = await hnd.getFile(); } catch (e) { continue; }
      let c = imgCache.get(name);
      if (!c || c.lm !== f.lastModified || c.size !== f.size) {
        try {
          const meta = JSON.parse(await f.text());
          if (!meta || !SAFE_ID.test(String(meta.id)) || !SAFE_IMG.test(String(meta.file))) continue;
          c = { lm: f.lastModified, size: f.size, meta };
          imgCache.set(name, c);
        } catch (e) { continue; }
      }
      const id = String(c.meta.id), mod = modOf(c.meta);
      const cur = out.get(id);
      if (!cur || mod > cur.mod) out.set(id, { mod, name, meta: c.meta });
    }
    imgCache.forEach((v, k) => { if (!seen.has(k)) imgCache.delete(k); });
    return out;
  }

  /* deletion records are just file names: p_<id>_<time>.del / i_<id>_<time>.del */
  async function readDeleted(dir) {
    const at = {}, files = {};
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind !== 'file') continue;
      const m = /^([pi])_([a-z0-9]+)_(\d+)\.del$/i.exec(name);
      if (!m) continue;
      const key = m[1].toLowerCase() + ':' + m[2];
      (files[key] = files[key] || []).push(name);
      if (!(at[key] >= +m[3])) at[key] = +m[3];
    }
    return { at, files };
  }

  /* ---------- one round of syncing ---------- */
  async function run() {
    if (!sync.dir || sync.state === 'locked' || sync.state === 'none') return false;
    if (busy) { again = true; return false; }
    busy = true;
    again = false;
    S.emit('sync');
    let ok = false;
    try {
      await S.flush();
      const f = await folders();
      const now = Date.now();

      /* 1 · deletions: this PC and the folder tell each other what was deleted for good */
      const gone = await readDeleted(f.deleted);
      const tomb = S.settings.tomb || (S.settings.tomb = {});
      let tombChanged = false;
      for (const key in gone.at) if (!(tomb[key] >= gone.at[key])) { tomb[key] = gone.at[key]; tombChanged = true; }
      for (const key of Object.keys(tomb)) {
        if (now - tomb[key] > KEEP_DELETED) {
          delete tomb[key];
          tombChanged = true;
          for (const n of gone.files[key] || []) await remove(f.deleted, n);
        } else if (!(gone.at[key] >= tomb[key])) {
          await writeFile(f.deleted, key.replace(':', '_') + '_' + tomb[key] + '.del', new Blob(['']));
        }
      }
      if (tombChanged) S.saveSettings();
      const dead = (kind, id, mod) => tomb[kind + ':' + id] >= mod;

      /* 2 · pages: take what is newer in the folder … */
      const remote = await scanPages(f.pages);
      const puts = [], dels = [];
      for (const [id, r] of Array.from(remote)) {
        const l = S.get(id);
        if (dead('p', id, r.mod)) {
          for (const n of [r.name].concat(r.extra)) { await remove(f.pages, n); pageCache.delete(n); }
          remote.delete(id);
          if (l && dead('p', id, modOf(l))) dels.push(id);
          continue;
        }
        if ((!l || r.mod > modOf(l)) && !S.isDirty(id)) {
          try {
            const pg = ZN.settings.normalizePage(await readJSON(f.pages, r.name));
            if (pg && pg.id === id) puts.push(pg);
          } catch (e) { /* not readable yet: next round */ }
        }
      }
      S.pages.forEach(p => { if (!remote.has(p.id) && dead('p', p.id, modOf(p)) && dels.indexOf(p.id) < 0) dels.push(p.id); });
      await S.applyRemote(puts, dels);

      /* … and write what is newer here */
      for (const p of Array.from(S.pages.values())) {
        const mod = modOf(p);
        if (dead('p', p.id, mod)) continue;
        const r = remote.get(p.id), canon = p.id + '.json';
        if (!r || mod > r.mod || (r.name !== canon && mod >= r.mod)) {
          const file = await writeJSON(f.pages, canon, p);
          pageCache.set(canon, { lm: file.lastModified, size: file.size, id: p.id, mod });
          if (r && r.name !== canon) { await remove(f.pages, r.name); pageCache.delete(r.name); }
        }
        if (r) for (const n of r.extra) { await remove(f.pages, n); pageCache.delete(n); }
      }

      /* 3 · pictures, the same way */
      const rImgs = await scanImages(f.images);
      const have = new Map((await S.listBlobs()).map(b => [b.id, b]));
      for (const [id, r] of Array.from(rImgs)) {
        const l = have.get(id);
        if (dead('i', id, r.mod)) {
          await remove(f.images, r.name);
          await remove(f.images, r.meta.file);
          imgCache.delete(r.name);
          rImgs.delete(id);
          if (l) { await S.delBlob(id, { remote: true }); have.delete(id); }
          continue;
        }
        if (!l || r.mod > modOf(l)) {
          try {
            const file = await (await f.images.getFileHandle(r.meta.file)).getFile();
            const blob = new Blob([await file.arrayBuffer()], { type: r.meta.mime || 'image/png' });
            const rec = {
              id, blob, mime: r.meta.mime || blob.type, size: blob.size, w: +r.meta.w || 0, h: +r.meta.h || 0,
              name: String(r.meta.name || ''), kind: r.meta.kind === 'snip' ? 'snip' : 'image', created: +r.meta.created || now, mod: r.mod
            };
            await S.putBlobRecord(rec);
            have.set(id, rec);
          } catch (e) { /* the picture file itself has not arrived yet: next round */ }
        }
      }
      for (const [id, l] of have) {
        const mod = modOf(l);
        if (dead('i', id, mod)) { await S.delBlob(id, { remote: true }); continue; }
        const r = rImgs.get(id);
        if (r && mod <= r.mod) continue;
        const file = id + '.' + extOf(l.mime || '');
        if (!r || r.meta.size !== l.blob.size || r.meta.file !== file) await writeFile(f.images, file, l.blob);
        const meta = { id, mime: l.mime, name: l.name, kind: l.kind, w: l.w, h: l.h, created: l.created, mod, size: l.blob.size, file };
        const mf = await writeJSON(f.images, id + '.json', meta);
        imgCache.set(id + '.json', { lm: mf.lastModified, size: mf.size, meta });
      }

      sync.lastAt = S.settings.syncAt = Date.now();
      S.saveSettings();
      sync.state = 'ready';
      sync.lastError = '';
      hideBanner();
      ok = true;
    } catch (e) {
      console.error('[Z Note] sync did not finish', e);
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { sync.state = 'locked'; showBanner(); }
      else { sync.state = 'error'; sync.lastError = (e && e.message) || String(e); }
    } finally {
      busy = false;
      S.emit('sync');
      if (again) later();
    }
    return ok;
  }
  const later = U.debounce(() => { if (sync.dir) run(); }, 3500);
  const soon = U.debounce(() => { if (sync.dir) run(); }, 1200);

  /* ---------- turning sync on and off ---------- */
  /* true when this PC still only has the untouched starter notebook */
  function localPristine() {
    const st = S.settings;
    if (!st.seedAt || Object.keys(st.tomb || {}).length) return false;
    for (const p of S.pages.values()) if (modOf(p) > st.seedAt + 1500) return false;
    return true;
  }

  function askHow(count) {
    return new Promise(resolve => {
      let m = null, picked = null;
      const pick = v => { picked = v; m.close(); return false; };
      m = ui.modal({
        title: 'That folder already holds a notebook', width: 520,
        body: [
          h('p.modal-text', 'It has ' + count + (count === 1 ? ' page' : ' pages') + ', and this PC has pages of its own too.'),
          h('p.modal-text', h('b', 'Combine both'), ' keeps everything from both. ', h('b', 'Use the folder’s notebook'), ' replaces what is on this PC — pages that exist only here would be lost.')
        ],
        buttons: [
          { label: 'Cancel', quiet: true },
          { label: 'Use the folder’s notebook', danger: true, onClick: () => pick('adopt') },
          { label: 'Combine both', primary: true, onClick: () => pick('merge') }
        ],
        onClose: () => resolve(picked)
      });
    });
  }

  /* start syncing with a folder. o.choice ('merge' | 'adopt') skips the question. */
  async function attach(handle, o) {
    o = o || {};
    const before = sync.dir, beforeState = sync.state;
    sync.dir = handle;
    try {
      if ((await permission(true)) !== 'ready') throw new Error('Z Note was not allowed to use that folder.');
      const f = await folders();
      pageCache.clear();
      imgCache.clear();
      const remote = await scanPages(f.pages);
      let choice = o.choice || 'merge';
      if (remote.size && !o.choice) {
        if (localPristine() && !(await S.listBlobs()).length) choice = 'adopt';
        else if (S.pages.size) choice = await askHow(remote.size);
      }
      if (!choice) { sync.dir = before; sync.state = beforeState; return false; }
      if (choice === 'adopt') await S.wipeLocal();
      if (!S.memoryOnly) await db.put('meta', handle, 'syncDir');
      sync.state = 'ready';
      const ok = await run();
      if (choice === 'adopt') { S.settings.seedAt = 0; S.saveSettings(); ZN.go('home'); }
      return ok;
    } catch (e) {
      sync.dir = before;
      sync.state = beforeState;
      S.emit('sync');
      throw e;
    }
  }

  sync.link = async function () {
    return attach(await window.showDirectoryPicker({ id: 'znote-sync', mode: 'readwrite' }));
  };
  sync.attach = attach;
  sync.run = run;
  sync.unlink = async function () {
    sync.dir = null;
    sync.state = 'none';
    pageCache.clear();
    imgCache.clear();
    hideBanner();
    if (!S.memoryOnly) await db.del('meta', 'syncDir');
    S.emit('sync');
  };
  /* must be called from a click: the browser only asks for folder access in answer to one */
  sync.unlock = async function () {
    if (!sync.dir) return false;
    sync.state = await permission(true);
    S.emit('sync');
    if (sync.state !== 'ready') return false;
    hideBanner();
    return run();
  };

  /* Start over everywhere: wipe this PC, record every old page and picture (here and in the folder) as deleted so
     the other PCs drop them too, put a new notebook in place with reseed(), and sync. Throws before anything is
     erased if the folder cannot be used right now. Call it from a click (the browser may ask for folder access). */
  sync.resetAll = async function (reseed) {
    if (!sync.dir) return false;
    if ((await permission(true)) !== 'ready') throw new Error('Z Note needs your OK to use the sync folder before it can empty it.');
    for (let i = 0; busy && i < 150; i++) await new Promise(r => setTimeout(r, 100));     // let a round in progress finish
    if (busy) throw new Error('Sync is busy right now. Try again in a moment.');
    busy = true;
    S.emit('sync');
    try {
      await S.flush();
      const f = await folders();
      const now = Date.now();
      const marks = {};
      const mark = (key, mod) => { marks[key] = Math.max(marks[key] || 0, now, (mod || 0) + 1); };
      (await scanPages(f.pages)).forEach((r, id) => mark('p:' + id, r.mod));
      (await scanImages(f.images)).forEach((r, id) => mark('i:' + id, r.mod));
      S.pages.forEach(p => mark('p:' + p.id, modOf(p)));
      (await S.listBlobs()).forEach(b => mark('i:' + b.id, modOf(b)));
      const known = Object.assign({}, S.settings.tomb);
      await S.wipeLocal();
      S.settings.tomb = Object.assign(known, marks);
      S.saveSettings();
      reseed();
      sync.state = 'ready';
    } finally {
      busy = false;
      S.emit('sync');
    }
    return run();
  };

  sync.init = async function () {
    if (S.memoryOnly) return;
    S.on('flushed', later);
    S.on('blobs', later);
    window.addEventListener('focus', soon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });
    setInterval(() => { if (sync.dir && document.visibilityState === 'visible') run(); }, 60000);
    try { sync.dir = (await db.get('meta', 'syncDir')) || null; } catch (e) { sync.dir = null; }
    if (!sync.dir) return;
    sync.lastAt = S.settings.syncAt || 0;
    sync.state = await permission(false);
    S.emit('sync');
    if (sync.state === 'locked') showBanner(); else run();
  };

  /* ---------- what the user sees ---------- */
  sync.statusText = () => (busy ? 'syncing now'
    : sync.state === 'locked' ? 'paused until you allow access'
    : sync.state === 'error' ? 'the last try did not finish (' + sync.lastError + ')'
    : sync.lastAt ? 'last synced ' + U.ago(sync.lastAt) : 'not synced yet');

  /* small button for the top bar */
  sync.chip = function () {
    const cls = busy ? '.busy' : (sync.state === 'locked' || sync.state === 'error' ? '.warn' : '');
    return h('button.ibtn.sync-chip' + cls, {
      type: 'button', 'aria-label': 'Sync', 'data-tip': 'Source folder: ' + (ZN.sourceFolder ? ZN.sourceFolder.info().notebookPath : sync.dir.name + ' / ' + SUB) + ' — ' + sync.statusText(),
      onclick: () => { if (sync.state === 'locked') sync.unlock(); else run(); }
    }, ZN.icon('sync', 17));
  };

  function showBanner() {
    const top = document.getElementById('topbar');
    if (banner || !top || !sync.dir) return;
    banner = h('div.banner', ZN.icon('folder', 16),
      h('span', 'Sync with “' + sync.dir.name + '” is paused until you allow Z Note to use that folder again.'),
      h('button.btn.sm', { type: 'button', onclick: async () => { if (await sync.unlock()) ui.toast('Sync is back on.'); } }, 'Allow'),
      h('button.ibtn.sm', { type: 'button', 'aria-label': 'Dismiss', style: { marginLeft: '0' }, onclick: hideBanner }, ZN.icon('x', 14)));
    top.after(banner);
  }
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }

  /* the "Sync folder" section of Style & data */
  sync.pane = function () {
    const note = h('div.set-note'), actions = h('div.set-actions');
    const fail = e => { if (!e || e.name !== 'AbortError') ui.toast('That did not work: ' + ((e && e.message) || e), { error: true, ms: 7000 }); };
    function fill() {
      U.clear(actions);
      if (!sync.supported) {
        note.textContent = 'This browser cannot work with a folder directly. Use the backup file below to move your notebook between PCs.';
        return;
      }
      if (!sync.dir) {
        note.replaceChildren('Keep your notebook in a folder that OneDrive syncs, and every PC that opens Z Note shares the same pages. Choose the ',
          h('b', 'same folder on each PC'), ' — your Z Note folder inside OneDrive is a good choice.');
        actions.append(h('button.btn.primary', {
          type: 'button', onclick: async () => {
            try { if (await sync.link()) ui.toast('Sync is on. Your notebook now lives in that folder too.'); } catch (e) { fail(e); }
            fill();
          }
        }, ZN.icon('folder', 15), 'Choose the sync folder'));
        return;
      }
      note.replaceChildren('Syncing with ', h('b', sync.dir.name), ' — ' + sync.statusText() + '.',
        h('div.source-path', ZN.sourceFolder ? ZN.sourceFolder.info().notebookPath : sync.dir.name + ' / ' + SUB));
      if (ZN.sourceFolder) actions.append(h('button.btn', { type: 'button', onclick: () => ZN.sourceFolder.open() }, ZN.icon('folder', 15), 'Source folder details'));
      if (sync.state === 'locked') actions.append(h('button.btn.primary', { type: 'button', onclick: async () => { await sync.unlock(); fill(); } }, 'Allow access'));
      else actions.append(h('button.btn', {
        type: 'button', onclick: async () => {
          const ok = await run();
          ui.toast(ok ? 'Everything is in sync.' : 'Sync did not finish' + (sync.lastError ? ': ' + sync.lastError : '.'), { error: !ok });
          fill();
        }
      }, ZN.icon('sync', 15), 'Sync now'));
      actions.append(h('button.btn.quiet', { type: 'button', onclick: async () => { await sync.unlink(); fill(); } }, 'Stop syncing on this PC'));
    }
    fill();
    const off = S.on('sync', () => { if (note.isConnected) fill(); else off(); });
    const offPath = S.on('sourcefolder', () => { if (note.isConnected) fill(); else offPath(); });
    return h('div.set-group', h('h3', 'Sync folder'), note, actions,
      h('p.set-note.muted', 'Each page is its own file. If the same page is changed on two PCs before they have synced, the newer change wins.'));
  };
})();
