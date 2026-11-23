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

  let busy = false, banner = null, paused = 0, scheduledRun = null;
  let operations = Promise.resolve();
  const pageCache = new Map();     // file name → { lm, size, id, mod }
  const imgCache = new Map();      // file name → { lm, size, meta }

  const sync = (ZN.sync = {
    supported: typeof window.showDirectoryPicker === 'function',
    dir: null,           // the folder the user chose
    direct: false,       // selected Z Note notebook itself instead of its parent
    state: 'none',       // none · ready · locked (the browser wants a click first) · error
    lastAt: 0,
    lastError: ''
  });

  /* ---------- small file helpers ---------- */
  function exclusive(task) {
    const result = operations.then(async () => {
      busy = true; S.emit('sync');
      try { return await task(); }
      finally { busy = false; S.emit('sync'); }
    });
    operations = result.catch(() => {});
    return result;
  }
  async function permission(ask, handle) {
    handle = handle || sync.dir;
    if (!handle) return 'locked';
    try {
      if (!handle.queryPermission) return 'ready';
      const o = { mode: 'readwrite' };
      if ((await handle.queryPermission(o)) === 'granted') return 'ready';
      if (ask && (await handle.requestPermission(o)) === 'granted') return 'ready';
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
  async function folders(handle, direct, create) {
    handle = handle || sync.dir;
    if (direct === undefined) direct = sync.direct;
    if (create === undefined) create = true;
    const root = direct ? handle : await handle.getDirectoryHandle(SUB, { create });
    return {
      pages: await root.getDirectoryHandle('pages', { create }),
      images: await root.getDirectoryHandle('images', { create }),
      deleted: await root.getDirectoryHandle('deleted', { create })
    };
  }

  async function locate(handle, existing) {
    const direct = handle.name === SUB;
    try { return { direct, folders: await folders(handle, direct, false) }; }
    catch (e) {
      if (e.name !== 'NotFoundError') throw e;
      if (existing) throw new Error('No complete Z Note notebook was found. Choose “Z Note notebook” or the folder containing it, and wait for OneDrive to finish downloading its files.');
      return { direct, folders: null };
    }
  }

  /* what the folder holds: page id → { mod, name, extra: [older duplicate files, e.g. OneDrive conflict copies] } */
  async function scanPages(dir) {
    const out = new Map(), seen = new Set();
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind !== 'file' || !/\.json$/i.test(name)) continue;
      seen.add(name);
      let f;
      try { f = await hnd.getFile(); } catch (e) { throw new Error('A notebook page is not readable yet. Wait for the folder service to finish, then sync again.'); }
      let c = pageCache.get(name);
      if (!c || c.lm !== f.lastModified || c.size !== f.size) {
        try {
          const raw = JSON.parse(await f.text());
          if (!raw || !SAFE_ID.test(String(raw.id))) throw new Error('Invalid page');
          c = { lm: f.lastModified, size: f.size, id: String(raw.id), mod: modOf(raw) };
          pageCache.set(name, c);
        } catch (e) { throw new Error('A notebook page is incomplete. Wait for the folder service to finish, then sync again.'); }
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
      try { f = await hnd.getFile(); } catch (e) { throw new Error('Picture information is not readable yet. Wait for the folder service to finish, then sync again.'); }
      let c = imgCache.get(name);
      if (!c || c.lm !== f.lastModified || c.size !== f.size) {
        try {
          const meta = JSON.parse(await f.text());
          if (!meta || !SAFE_ID.test(String(meta.id)) || !SAFE_IMG.test(String(meta.file))) throw new Error('Invalid picture information');
          c = { lm: f.lastModified, size: f.size, meta };
          imgCache.set(name, c);
        } catch (e) { throw new Error('Picture information is incomplete. Wait for the folder service to finish, then sync again.'); }
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

  function pictureIds(page) {
    const content = page.content || {};
    const items = page.type === 'note' ? content.blocks || [] : page.type === 'board' ? content.items || [] : [];
    return items.filter(item => item && (item.t === 'image' || item.t === 'img' || item.kind === 'image')).map(item => String(item.src || ''));
  }

  // Read everything needed before changing browser data or writing to the
  // shared folder. A half-downloaded picture must never publish a half-notebook.
  async function preparePull(f, options) {
    options = options || {};
    const imageRevision = S.imageRevision();
    const expectedPages = Array.from(S.pages, ([id, page]) => [id, JSON.stringify(page)]);
    const expectedTomb = Object.assign({}, S.settings.tomb);
    const now = Date.now(), replace = !!options.replace;
    const gone = await readDeleted(f.deleted);
    const tomb = Object.assign({}, replace ? {} : S.settings.tomb);
    const removeDeleted = [], removePages = [], removeImages = [];
    for (const key in gone.at) if (!(tomb[key] >= gone.at[key])) tomb[key] = gone.at[key];
    for (const key of Object.keys(tomb)) if (now - tomb[key] > KEEP_DELETED) {
      delete tomb[key]; removeDeleted.push(...(gone.files[key] || []));
    }
    const dead = (kind, id, mod) => tomb[kind + ':' + id] >= mod;
    const remote = await scanPages(f.pages);
    const rImgs = await scanImages(f.images);
    const have = new Map((replace ? [] : S.memoryOnly ? await S.listBlobs() : await db.all('blobs')).map(b => [b.id, b]));
    const pages = [], deletedPages = [], images = [], deletedImages = [], checkedPages = [];

    for (const [id, r] of Array.from(remote)) {
      const local = replace ? null : S.get(id);
      if (dead('p', id, r.mod)) {
        removePages.push(...[r.name].concat(r.extra)); remote.delete(id);
        if (local && dead('p', id, modOf(local))) deletedPages.push(id);
        continue;
      }
      const incoming = (!local || r.mod > modOf(local)) && (replace || !S.isDirty(id));
      if (incoming || options.validateAll) {
        let pg;
        try {
          pg = ZN.settings.normalizePage(await readJSON(f.pages, r.name));
          if (!pg || pg.id !== id || modOf(pg) !== r.mod) throw new Error('Invalid or changing page');
        } catch (e) { throw new Error('A notebook page is incomplete or changed while opening. Wait for the folder service to finish, then try again.'); }
        checkedPages.push(pg);
        if (incoming) pages.push(pg);
      }
    }
    if (!replace) S.pages.forEach(p => {
      if (!remote.has(p.id) && dead('p', p.id, modOf(p)) && deletedPages.indexOf(p.id) < 0) deletedPages.push(p.id);
    });

    for (const [id, r] of Array.from(rImgs)) {
      const local = have.get(id);
      if (dead('i', id, r.mod)) {
        removeImages.push(r.name, r.meta.file); rImgs.delete(id);
        if (local && dead('i', id, modOf(local))) { deletedImages.push(id); have.delete(id); }
        continue;
      }
      let incoming = !local || r.mod > modOf(local);
      const sameVersion = local && r.mod === modOf(local);
      if (incoming || options.validateAll || sameVersion) {
        let rec;
        try {
          const file = await (await f.images.getFileHandle(r.meta.file)).getFile();
          // Cloud sync can deliver metadata before its binary. If that binary
          // arrives later, reload it even though the logical image version is
          // unchanged. These file fingerprints stay in browser storage only.
          // Only refresh versions known to have come from this source. Older
          // apps may have newer local bytes with the same logical metadata
          // after their same-sized binary write was skipped.
          const knownSource = sameVersion && Number.isFinite(local.sourceFileModified) && Number.isFinite(local.sourceFileSize);
          incoming = incoming || !!(knownSource && (local.sourceFileModified !== file.lastModified || local.sourceFileSize !== file.size));
          if (!incoming && !options.validateAll) continue;
          const blob = new Blob([await file.arrayBuffer()], { type: r.meta.mime || 'image/png' });
          if (!blob.size || (Number.isFinite(r.meta.size) && r.meta.size !== blob.size)) throw new Error('Incomplete picture');
          rec = { id, blob, mime: r.meta.mime || blob.type, size: blob.size, w: +r.meta.w || 0, h: +r.meta.h || 0,
            name: String(r.meta.name || ''), kind: r.meta.kind === 'snip' ? 'snip' : 'image', created: +r.meta.created || now, mod: r.mod,
            sourceFileModified: file.lastModified, sourceFileSize: file.size };
        } catch (e) { throw new Error('A picture has not finished downloading or cannot be read. Wait for the folder service to finish, then try again.'); }
        if (incoming) { images.push(rec); have.set(id, rec); }
      }
    }
    for (const [id, local] of Array.from(have)) if (dead('i', id, modOf(local))) {
      if (deletedImages.indexOf(id) < 0) deletedImages.push(id);
      have.delete(id);
    }
    for (const pg of checkedPages) for (const id of pictureIds(pg)) {
      // Explicitly deleted pictures are allowed to retain their old placeholder.
      if (!rImgs.has(id) && !tomb['i:' + id]) throw new Error('This notebook refers to a picture that is missing from its images folder. Finish syncing the original PC and folder service, then try again.');
    }
    return { f, gone, tomb, dead, remote, rImgs, pages, deletedPages, images, deletedImages, replace, imageRevision, expectedPages, expectedTomb,
      removeDeleted, removePages, removeImages };
  }

  /* ---------- one round of syncing ---------- */
  async function performRun(options) {
    options = options || {};
    if (paused || !sync.dir || sync.state === 'locked' || sync.state === 'none') return false;
    let ok = false;
    try {
      if (S.checkpoint && !S.memoryOnly) await S.checkpoint(); else await S.flush();
      const plan = options.prepared || await preparePull(await folders());
      const { f, gone, tomb, dead, remote, rImgs } = plan;
      if (plan.replace) {
        const localPictures = S.memoryOnly ? await S.listBlobs() : await db.all('blobs');
        if (localPictures.length || !localPristine()) throw new Error('Your notes changed while the folder was opening. Open the notebook again and combine both copies to keep your edits.');
      }
      // One transaction installs pictures and their referencing pages before
      // any view receives a change event. A failed save leaves the old view intact.
      await S.applySyncSnapshot({ pages: plan.pages, deletedPages: plan.deletedPages, images: plan.images,
        deletedImages: plan.deletedImages, replace: plan.replace, tomb, imageRevision: plan.imageRevision,
        expectedPages: plan.expectedPages, expectedTomb: plan.expectedTomb });

      if (!options.pullOnly) {
        for (const name of plan.removeDeleted) await remove(f.deleted, name);
        for (const key of Object.keys(tomb)) if (!(gone.at[key] >= tomb[key])) {
          await writeFile(f.deleted, key.replace(':', '_') + '_' + tomb[key] + '.del', new Blob(['']));
        }
        for (const name of plan.removePages) { await remove(f.pages, name); pageCache.delete(name); }
        for (const name of plan.removeImages) { await remove(f.images, name); imgCache.delete(name); }

        // Send pictures before pages that may refer to them. A same-sized edit
        // still has different bytes, so a newer image always writes its binary.
        const have = S.memoryOnly ? await S.listBlobs() : await db.all('blobs');
        for (const l of have) {
          const id = l.id;
          const mod = modOf(l);
          if (dead('i', id, mod)) continue;
          const r = rImgs.get(id);
          if (r && mod <= r.mod) continue;
          const file = id + '.' + extOf(l.mime || '');
          await writeFile(f.images, file, l.blob);
          const meta = { id, mime: l.mime, name: l.name, kind: l.kind, w: l.w, h: l.h, created: l.created, mod, size: l.blob.size, file };
          const mf = await writeJSON(f.images, id + '.json', meta);
          imgCache.set(id + '.json', { lm: mf.lastModified, size: mf.size, meta });
        }
        for (const p of Array.from(S.pages.values())) {
          const mod = modOf(p);
          if (dead('p', p.id, mod)) continue;
          const r = remote.get(p.id), canon = p.id + '.json';
          if (!r || mod > r.mod || (r.name !== canon && mod >= r.mod)) {
            const file = await writeJSON(f.pages, canon, p);
            pageCache.set(canon, { lm: file.lastModified, size: file.size, id: p.id, mod });
            if (r && r.name !== canon) { await remove(f.pages, r.name); pageCache.delete(r.name); }
          }
          if (r) for (const name of r.extra) { await remove(f.pages, name); pageCache.delete(name); }
        }
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
    }
    return ok;
  }
  function run() {
    if (paused) return Promise.resolve(false);
    if (scheduledRun) return scheduledRun;
    scheduledRun = exclusive(() => { scheduledRun = null; return performRun(); });
    return scheduledRun;
  }
  const later = U.debounce(() => { if (sync.dir) run(); }, 3500);
  const soon = U.debounce(() => { if (sync.dir) run(); }, 1200);

  /* ---------- turning sync on and off ---------- */
  /* true when this PC still only has the untouched starter notebook */
  function localPristine() {
    const st = S.settings;
    if (!st.seedAt || Object.keys(st.tomb || {}).length) return false;
    // Seeding records seedAt after creating every example. Even a quick edit
    // immediately after setup must keep the local notebook out of adoption.
    for (const p of S.pages.values()) if (modOf(p) > st.seedAt) return false;
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
          h('p.modal-text', h('b', 'Combine both'), ' keeps pages unique to either notebook. When the same page was edited in both places, its newer copy wins. Save a backup first if both PCs have edited the same pages.')
        ],
        buttons: [
          { label: 'Cancel', quiet: true },
          { label: 'Combine both', primary: true, onClick: () => pick('merge') }
        ],
        onClose: () => resolve(picked)
      });
    });
  }

  /* All location changes share the sync queue so a running round cannot write
     pages from one connection into the newly selected folder. */
  async function attach(handle, o) {
    o = o || {};
    if (!handle || handle.kind !== 'directory') throw new Error('Choose a folder for your notebook.');
    if ((await permission(true, handle)) !== 'ready') throw new Error('Z Note was not allowed to use that folder.');
    return exclusive(() => attachNow(handle, o));
  }
  async function attachNow(handle, o) {
    if (paused) throw new Error('An app update is in progress. Try connecting the notebook again when it finishes.');
    const before = sync.dir, beforeState = sync.state, beforeDirect = sync.direct;
    let locationSaved = false;
    try {
      const view = ZN.shell && ZN.shell.view();
      if (view && view.prepareExport) await view.prepareExport();
      if (S.checkpoint && !S.memoryOnly) await S.checkpoint(); else await S.flush();
      const location = await locate(handle, !!o.existing);
      pageCache.clear();
      imgCache.clear();
      const remote = location.folders ? await scanPages(location.folders.pages) : new Map();
      let choice = o.choice || 'merge';
      const pristine = localPristine() && !(S.memoryOnly ? await S.listBlobs() : await db.all('blobs')).length;
      if (remote.size && !o.choice) {
        if (pristine) choice = 'adopt';
        else if (S.pages.size) choice = await askHow(remote.size);
      }
      if (!choice) return false;
      if (choice !== 'merge' && !(choice === 'adopt' && pristine)) throw new Error('Save a backup and combine the notebooks to keep this PC’s notes.');
      const prepared = location.folders ? await preparePull(location.folders, { replace: choice === 'adopt', validateAll: true }) : null;
      if (paused) throw new Error('An app update is in progress. Try connecting the notebook again when it finishes.');
      // Persist the exact selection and layout together. Existing parent-folder
      // handles remain readable through the legacy syncDir fallback on startup.
      if (!S.memoryOnly) { await db.put('meta', { handle, direct: location.direct }, 'syncLocation'); locationSaved = true; }
      sync.dir = handle; sync.direct = location.direct;
      sync.state = 'ready';
      const ok = await performRun({ prepared, pullOnly: !!o.existing });
      if (!ok) throw new Error(sync.lastError || 'The notebook could not be opened. Your previous folder remains connected.');
      if (choice === 'adopt') ZN.go('home');
      if (o.existing) later();
      return ok;
    } catch (e) {
      sync.dir = before;
      sync.state = beforeState;
      sync.direct = beforeDirect;
      hideBanner();
      if (beforeState === 'locked') showBanner();
      pageCache.clear(); imgCache.clear();
      if (locationSaved) {
        try { await db.put('meta', { handle: before, direct: beforeDirect }, 'syncLocation'); }
        catch (_) { sync.state = 'error'; sync.lastError = 'The previous folder connection could not be restored. Reconnect it before syncing.'; }
      }
      throw e;
    }
  }

  sync.link = async function (options) {
    return attach(await window.showDirectoryPicker({ id: 'znote-sync', mode: 'readwrite' }), options);
  };
  sync.openExisting = () => sync.link({ existing: true });
  sync.attach = attach;
  sync.run = run;
  sync.unlink = () => exclusive(async () => {
    if (paused) throw new Error('An app update is in progress. Try again when it finishes.');
    // A tombstone prevents a stale legacy handle from reconnecting on startup.
    if (!S.memoryOnly) await db.put('meta', { handle: null, direct: false }, 'syncLocation');
    sync.dir = null;
    sync.direct = false;
    sync.state = 'none';
    pageCache.clear();
    imgCache.clear();
    hideBanner();
  });
  /* must be called from a click: the browser only asks for folder access in answer to one */
  sync.unlock = async function () {
    const handle = sync.dir;
    if (!handle || paused) return false;
    const state = await permission(true, handle);
    return exclusive(async () => {
      if (handle !== sync.dir || paused) return false;
      sync.state = state;
      if (state !== 'ready') return false;
      hideBanner();
      const view = ZN.shell && ZN.shell.view();
      if (view && view.prepareExport) await view.prepareExport();
      return performRun();
    });
  };
  sync.now = async function () {
    if (sync.state === 'locked') return sync.unlock();
    return exclusive(async () => {
      if (paused) return false;
      const view = ZN.shell && ZN.shell.view();
      if (view && view.prepareExport) await view.prepareExport();
      return performRun();
    });
  };
  sync.pause = async function () { paused++; later.cancel(); soon.cancel(); await operations; };
  sync.resume = function () { if (paused) paused--; if (!paused && sync.dir) later(); };
  sync.idle = () => operations;

  /* Start over everywhere: wipe this PC, record every old page and picture (here and in the folder) as deleted so
     the other PCs drop them too, put a new notebook in place with reseed(), and sync. Throws before anything is
     erased if the folder cannot be used right now. Call it from a click (the browser may ask for folder access). */
  sync.resetAll = async function (reseed) {
    if (!sync.dir) return false;
    const handle = sync.dir;
    if ((await permission(true, handle)) !== 'ready') throw new Error('Z Note needs your OK to use the sync folder before it can empty it.');
    return exclusive(async () => {
      if (paused || handle !== sync.dir) throw new Error('The source folder changed or an app update is in progress. Try again.');
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
      return performRun();
    });
  };

  sync.init = async function () {
    if (S.memoryOnly) return;
    S.on('flushed', later);
    S.on('blobs', later);
    window.addEventListener('focus', soon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });
    setInterval(() => { if (sync.dir && document.visibilityState === 'visible') run(); }, 60000);
    try {
      const location = await db.get('meta', 'syncLocation');
      sync.dir = location !== undefined && location !== null ? location.handle || null : (await db.get('meta', 'syncDir')) || null;
      sync.direct = !!(location && location.direct);
    } catch (e) { sync.dir = null; sync.direct = false; }
    if (!sync.dir) return;
    sync.lastAt = S.settings.syncAt || 0;
    sync.state = await permission(false);
    S.emit('sync');
    if (sync.state === 'locked') showBanner(); else run();
  };

  /* ---------- what the user sees ---------- */
  sync.statusText = () => (paused ? 'paused while the app updates' : busy ? 'syncing now'
    : sync.state === 'locked' ? 'paused until you allow access'
    : sync.state === 'error' ? 'the last try did not finish (' + sync.lastError + ')'
    : sync.lastAt ? 'last synced ' + U.ago(sync.lastAt) : 'not synced yet');

  /* small button for the top bar */
  sync.chip = function () {
    const cls = busy ? '.busy' : (sync.state === 'locked' || sync.state === 'error' ? '.warn' : '');
    return h('button.btn.sm.sync-chip' + cls, {
      type: 'button', disabled: busy || paused > 0, 'aria-label': busy ? 'Syncing' : 'Sync', 'aria-busy': String(busy), 'data-tip': 'Source folder: ' + (ZN.sourceFolder ? ZN.sourceFolder.info().notebookPath : sync.dir.name + ' / ' + SUB) + ' — ' + sync.statusText(),
      onclick: () => sync.now()
    }, busy ? 'Syncing…' : 'Sync');
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
        note.replaceChildren('Keep the notebook in OneDrive or a shared network folder. On another PC, choose ',
          h('b', 'Open existing notebook'), ' and select “Z Note notebook” or the folder containing it. Each browser asks for its own folder permission.');
        actions.append(h('button.btn.primary', {
          type: 'button', onclick: async () => {
            try { if (await sync.link()) ui.toast('Sync is on. Your notebook now lives in that folder too.'); } catch (e) { fail(e); }
            fill();
          }
        }, ZN.icon('folder', 15), 'Choose the sync folder'));
        actions.append(h('button.btn', { type: 'button', onclick: async () => {
          try { if (await sync.openExisting()) ui.toast('Notebook opened with its saved pages and pictures.'); } catch (e) { fail(e); }
          fill();
        } }, ZN.icon('folder', 15), 'Open existing notebook…'));
        return;
      }
      note.replaceChildren('Syncing with ', h('b', sync.dir.name), ' — ' + sync.statusText() + '.',
        h('div.source-path', ZN.sourceFolder ? ZN.sourceFolder.info().notebookPath : sync.dir.name + ' / ' + SUB));
      if (ZN.sourceFolder) actions.append(h('button.btn', { type: 'button', onclick: () => ZN.sourceFolder.open() }, ZN.icon('folder', 15), 'Source folder details'));
      if (sync.state === 'locked') actions.append(h('button.btn.primary', { type: 'button', onclick: async () => { await sync.unlock(); fill(); } }, 'Allow access'));
      else actions.append(h('button.btn', {
        type: 'button', onclick: async () => {
          const ok = await sync.now();
          ui.toast(ok ? 'Everything is in sync.' : 'Sync did not finish' + (sync.lastError ? ': ' + sync.lastError : '.'), { error: !ok });
          fill();
        }
      }, ZN.icon('sync', 15), 'Sync now'));
      actions.append(h('button.btn', { type: 'button', onclick: async () => {
        try { if (await sync.openExisting()) ui.toast('Notebook opened with its saved pages and pictures.'); } catch (e) { fail(e); }
        fill();
      } }, ZN.icon('folder', 15), 'Open existing notebook…'));
      actions.append(h('button.btn.quiet', { type: 'button', onclick: async () => { await sync.unlink(); fill(); } }, 'Stop syncing on this PC'));
    }
    fill();
    const off = S.on('sync', () => { if (note.isConnected) fill(); else off(); });
    const offPath = S.on('sourcefolder', () => { if (note.isConnected) fill(); else offPath(); });
    return h('div.set-group', h('h3', 'Sync folder'), note, actions,
      h('p.set-note', 'Before switching PCs, press Sync now on this PC and wait for OneDrive to finish syncing. On the other PC, let OneDrive finish downloading, then press Sync now in Z Note. A one-time folder copy will not carry later changes between PCs.'),
      h('p.set-note.muted', 'Each page is its own file. If the same page is changed on two PCs before they have synced, the newer change wins.'));
  };
})();
