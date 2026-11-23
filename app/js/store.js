/* Z Note · the notebook model: pages (in memory, mirrored to IndexedDB), images, settings */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, db = ZN.db;

  const pages = new Map();
  const listeners = {};
  const dirty = new Set();
  const blobURLs = new Map();
  const blobVersions = new Map();
  const imageBindings = new WeakMap();
  const memBlobs = new Map();
  let saveTimer = null, settingsTimer = null, kidIndex = null, memoryOnly = false, channel = null;
  const pendingPageWrites = new Set();
  const pendingDataWork = new Set();
  let imageWork = Promise.resolve(), imageRevision = 0;
  const winId = U.uid();

  const TREE_KEYS = ['title', 'icon', 'fav', 'parentId', 'order', 'trashed', 'color', 'type'];

  function defaults() {
    return {
      v: 1,
      style: { paper: 'cream', pattern: 'dots', ink: 'blue', head: 'hand', body: 'serif', size: 'm', width: 'normal' },
      name: '',
      expanded: {},
      sidebarCollapsed: false,
      taskLayout: 'list', // one-column list until a user chooses priority columns
      seeded: false,
      inboxId: null,   // to-do list that quick-added tasks land in
      ideasId: null,   // note that quick-captured ideas land in
      recent: [],
      wheel: 'zoom',   // on boards: mouse wheel zooms ('zoom') or scrolls ('pan')
      backupAt: 0,
      seedAt: 0,       // when the starter notebook was made on this PC (0 = unknown)
      syncAt: 0,
      tomb: {}         // pages and pictures deleted for good here, so other PCs drop them too: { 'p:<id>' | 'i:<id>': time }
    };
  }

  function blank(type) {
    if (type === 'note') return { blocks: [{ id: U.uid(), t: 'p', html: '' }] };
    if (type === 'todo') return { tasks: [] };
    if (type === 'board') return { items: [], view: { x: 0, y: 0, k: 1 } };
    return {};
  }

  /* ---------- events ---------- */
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { const a = listeners[evt]; if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  function emit(evt, a, b) {
    const l = listeners[evt];
    if (!l) return;
    l.slice().forEach(fn => { try { fn(a, b); } catch (e) { console.error('[Z Note] listener for "' + evt + '" failed', e); } });
  }

  /* ---------- tree queries ---------- */
  function index() {
    if (kidIndex) return kidIndex;
    kidIndex = new Map();
    pages.forEach(p => {
      if (p.trashed) return;
      const k = p.parentId || '';
      let a = kidIndex.get(k);
      if (!a) kidIndex.set(k, (a = []));
      a.push(p);
    });
    kidIndex.forEach(a => a.sort((x, y) => (x.order - y.order) || (x.created - y.created)));
    return kidIndex;
  }
  const NONE = Object.freeze([]);
  /* live children in display order — treat the returned array as read-only */
  function children(parentId) { return index().get(parentId || '') || NONE; }
  function notebooks() { return children(null).filter(p => p.type === 'notebook'); }
  function get(id) { return pages.get(id); }

  function isLive(p) {
    let x = p, guard = 0;
    while (x && guard++ < 60) {
      if (x.trashed) return false;
      if (!x.parentId) return true;
      x = pages.get(x.parentId);
    }
    return false;
  }
  function live(type) {
    const out = [];
    pages.forEach(p => { if ((!type || p.type === type) && isLive(p)) out.push(p); });
    return out;
  }
  function path(id) {
    const out = [];
    let x = pages.get(id), guard = 0;
    while (x && guard++ < 60) { out.unshift(x); x = x.parentId ? pages.get(x.parentId) : null; }
    return out;
  }
  function notebookOf(id) { const p = path(id); return p.length && p[0].type === 'notebook' ? p[0] : null; }
  /* every descendant, trashed or not */
  function descendants(id) {
    const out = [];
    (function walk(pid) { pages.forEach(p => { if (p.parentId === pid) { out.push(p.id); walk(p.id); } }); })(id);
    return out;
  }
  function nextOrder(parentId) {
    const k = children(parentId);
    return k.length ? k[k.length - 1].order + 1 : 0;
  }
  function ensureNotebook() {
    const nb = notebooks();
    return nb.length ? nb[0] : create({ type: 'notebook', title: 'My notebook', color: 'blue' });
  }

  /* ---------- changes ---------- */
  /* Every change stamps the page (`mod`) so sync can tell which PC has the newer copy.
     quiet = a change that should stay on this PC (pan/zoom, folded sections): saved, but not stamped. */
  function markDirty(id, quiet) {
    const p = pages.get(id);
    if (p && !quiet) p.mod = Date.now();
    dirty.add(id);
    emit('save', 'dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 450);
  }

  function create(props) {
    props = props || {};
    const type = props.type || 'note';
    const parentId = props.parentId || null;
    const now = Date.now();
    const p = Object.assign({
      id: U.uid(), type, title: '', icon: '', color: '', parentId, order: nextOrder(parentId),
      created: now, updated: now, tags: [], fav: false, trashed: 0, content: blank(type)
    }, props, { parentId });
    pages.set(p.id, p);
    kidIndex = null;
    markDirty(p.id);
    emit('tree');
    return p;
  }

  /* change page fields (title, icon, fav, tags …) */
  function update(id, patch, opts) {
    const p = pages.get(id);
    if (!p) return null;
    Object.assign(p, patch);
    if (!(opts && opts.keepTime)) p.updated = Date.now();
    if ('parentId' in patch || 'order' in patch || 'trashed' in patch) kidIndex = null;
    markDirty(id, opts && opts.quiet);
    emit('page', p, patch);
    if (TREE_KEYS.some(k => k in patch)) emit('tree');
    return p;
  }

  /* call after editing page.content in place */
  function touch(id) {
    const p = pages.get(id);
    if (!p) return;
    p.updated = Date.now();
    markDirty(id);
    emit('content', p);
  }

  function trash(id) { if (pages.has(id)) update(id, { trashed: Date.now() }, { keepTime: true }); }

  function restore(id) {
    const p = pages.get(id);
    if (!p) return;
    const patch = { trashed: 0 };
    if (p.type !== 'notebook') {
      const parent = p.parentId ? pages.get(p.parentId) : null;
      if (!parent || !isLive(parent)) { patch.parentId = ensureNotebook().id; patch.order = nextOrder(patch.parentId); }
    }
    update(id, patch, { keepTime: true });
  }

  /* delete a page and everything inside it, for good */
  function purge(id) {
    const now = Date.now();
    [id].concat(descendants(id)).forEach(i => { pages.delete(i); dirty.add(i); S.settings.tomb['p:' + i] = now; });
    saveSettings();
    kidIndex = null;
    markDirty(id);
    emit('tree');
  }

  function trashed() {
    const out = [];
    pages.forEach(p => { if (p.trashed) out.push(p); });
    return out.sort((a, b) => b.trashed - a.trashed);
  }

  /* move a page under parentId, placed before beforeId (or last). Returns false when the move is not allowed. */
  function move(id, parentId, beforeId) {
    const p = pages.get(id);
    if (!p) return false;
    parentId = parentId || null;
    if (p.type === 'notebook' && parentId) return false;     // notebooks stay at the top level
    if (p.type !== 'notebook' && !parentId) return false;    // pages always live inside a notebook
    for (let x = parentId ? pages.get(parentId) : null, g = 0; x && g < 60; x = x.parentId ? pages.get(x.parentId) : null, g++) {
      if (x.id === id) return false;                          // never into itself
    }
    const sibs = children(parentId).filter(x => x.id !== id);
    let i = beforeId ? sibs.findIndex(x => x.id === beforeId) : -1;
    if (i < 0) i = sibs.length;
    sibs.splice(i, 0, p);
    p.parentId = parentId;
    const now = Date.now();
    sibs.forEach((x, n) => { if (x.order !== n || x === p) { x.order = n; x.mod = now; dirty.add(x.id); } });
    kidIndex = null;
    markDirty(id);
    emit('tree');
    return true;
  }

  function duplicate(id) {
    const p = pages.get(id);
    if (!p) return null;
    const copy = JSON.parse(JSON.stringify(p));
    const now = Date.now();
    Object.assign(copy, { id: U.uid(), title: (p.title || 'Untitled') + ' (copy)', created: now, updated: now, fav: false, trashed: 0 });
    pages.set(copy.id, copy);
    kidIndex = null;
    const next = children(p.parentId).find(x => x.order > p.order && x.id !== copy.id);
    move(copy.id, p.parentId, next ? next.id : null);
    return copy;
  }

  function visit(id) {
    const r = S.settings.recent.filter(x => x !== id);
    r.unshift(id);
    S.settings.recent = r.slice(0, 14);
    saveSettings();
  }

  /* ---------- persistence ---------- */
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty.size) return;
    const ids = Array.from(dirty);
    dirty.clear();
    if (memoryOnly) { emit('save', 'saved'); return; }
    const puts = [], dels = [];
    ids.forEach(id => { const p = pages.get(id); if (p) puts.push(p); else dels.push(id); });
    let writing;
    try {
      writing = db.batch('pages', puts, dels);
      pendingPageWrites.add(writing);
      await writing;
    } catch (e) {
      ids.forEach(i => dirty.add(i));
      console.error('[Z Note] save failed', e);
      emit('save', 'error', e);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 4000);
      return;
    } finally { if (writing) pendingPageWrites.delete(writing); }
    if (!dirty.size) emit('save', 'saved');
    if (channel) try { channel.postMessage({ t: 'saved', from: winId, ids }); } catch (e) {}
    emit('flushed', ids);
  }

  // Automatic updates may reload only after page transactions and settings are
  // durable. The normal autosave reports errors in the UI instead of rejecting.
  async function checkpoint() {
    if (memoryOnly) throw new Error('This is a temporary session. Save a backup and reopen Z Note in a browser with storage before installing updates.');
    do {
      do {
        if (pendingDataWork.size) await Promise.all(Array.from(pendingDataWork));
        // Callers insert a saved image into its page after awaiting addImage.
        // Let those continuations run before flushing the resulting page edits.
        await Promise.resolve();
      } while (pendingDataWork.size);
      await flush();
      while (pendingPageWrites.size) await Promise.all(Array.from(pendingPageWrites));
      if (dirty.size) throw new Error('Some notes could not be saved. Keep Z Note open and retry before updating.');
    } while (pendingDataWork.size);
    clearTimeout(settingsTimer);
    await db.put('meta', JSON.parse(JSON.stringify(S.settings)), 'settings');
    if (dirty.size || pendingPageWrites.size || pendingDataWork.size) throw new Error('Notes or pictures changed while preparing the update. Please try again.');
  }

  function trackDataWork(task) {
    const work = task();
    pendingDataWork.add(work);
    work.then(() => pendingDataWork.delete(work), () => pendingDataWork.delete(work));
    return work;
  }
  function queueImageWork(task) {
    const result = imageWork.then(task);
    imageWork = result.catch(() => {});
    return trackDataWork(() => result);
  }
  function localImageWork(task) {
    // Count intent before asynchronous decoding/reads. A folder preflight must
    // not commit a snapshot sampled before a local photo edit began.
    imageRevision++;
    return queueImageWork(task);
  }

  function otherWindowsOpen() {
    if (!channel) return Promise.resolve(false);
    return new Promise(resolve => {
      let found = false;
      const off = on('otherwindow', () => { found = true; });
      // Older Z Note releases already answer hello with here. Probe afresh;
      // the historical otherWindow flag remains true after a window closes.
      channel.postMessage({ t: 'hello', from: winId });
      setTimeout(() => { off(); resolve(found); }, 1000);
    });
  }

  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      if (memoryOnly) return;
      db.put('meta', S.settings, 'settings').catch(e => console.error('[Z Note] settings save failed', e));
    }, 250);
  }
  function setSetting(key, value) {
    S.settings[key] = value;
    saveSettings();
    emit('settings', key);
  }

  /* ---------- changes arriving from another PC (sync) ---------- */
  /* pages being edited right now on this PC are left alone: the local change is the newer one */
  async function applyRemote(puts, dels) {
    puts = (puts || []).filter(p => p && p.id && !dirty.has(p.id));
    dels = (dels || []).filter(id => pages.has(id) && !dirty.has(id));
    if (!puts.length && !dels.length) return [];
    puts.forEach(p => pages.set(p.id, p));
    dels.forEach(id => pages.delete(id));
    kidIndex = null;
    if (!memoryOnly) await db.batch('pages', puts, dels);
    const changed = puts.map(p => p.id).concat(dels);
    emit('tree');
    if (puts.length) emit('content', puts[0]);
    emit('external', changed);
    return changed;
  }
  function applySyncSnapshot(changes) {
    if (changes.replace && pendingDataWork.size) return Promise.reject(new Error('Pictures are still being saved. Wait for them to finish, then open the notebook again.'));
    const expectedImages = changes.imageRevision === undefined ? imageRevision : changes.imageRevision;
    return queueImageWork(async () => {
    if (expectedImages !== imageRevision) throw new Error('A picture changed while the folder was loading. Your local edits are kept. Sync again to load the remaining changes.');
    const replace = !!changes.replace;
    if (replace && (!S.settings.seedAt || dirty.size || Object.keys(S.settings.tomb || {}).length ||
        Array.from(pages.values()).some(p => (+p.mod || +p.updated || +p.created || 0) > S.settings.seedAt))) {
      throw new Error('This notebook changed while the folder was opening. Try opening it again and combine the notebooks to keep your edits.');
    }
    // Folder reads may take long enough for autosave to clear dirty. Compare
    // the preflight copy too, including pages created/deleted during the read.
    const expectedPages = changes.expectedPages === undefined ? null : new Map(changes.expectedPages);
    const unchanged = id => !expectedPages || JSON.stringify(pages.get(id)) === expectedPages.get(id);
    const modOf = p => p ? (+p.mod || +p.updated || +p.created || 0) : 0;
    const localTomb = S.settings.tomb || {};
    const puts = (changes.pages || []).filter(p => p && p.id && !dirty.has(p.id) && unchanged(p.id) &&
      (replace || (!(localTomb['p:' + p.id] >= modOf(p)) && (!pages.has(p.id) || modOf(p) > modOf(pages.get(p.id))))));
    const dels = (changes.deletedPages || []).filter(id => !dirty.has(id) && unchanged(id) &&
      (replace || !pages.has(id) || (changes.tomb && changes.tomb['p:' + id] >= modOf(pages.get(id)))));
    const beforePages = new Map();
    const remember = id => beforePages.set(id, JSON.stringify(pages.get(id)));
    puts.forEach(p => remember(p.id)); dels.forEach(remember);
    if (replace) pages.forEach((_, id) => remember(id));
    const images = changes.images || [], deletedImages = changes.deletedImages || [];
    const initialTomb = JSON.stringify(S.settings.tomb || {});
    const settings = replace || changes.tomb !== undefined ? JSON.parse(JSON.stringify(S.settings)) : null;
    if (settings) {
      if (replace) Object.assign(settings, { recent: [], inboxId: null, ideasId: null, seedAt: 0 });
      settings.tomb = JSON.parse(JSON.stringify(changes.tomb === undefined ? (replace ? {} : S.settings.tomb || {}) : changes.tomb));
      // A permanent local deletion may have finished during folder preflight.
      // Keep its marker even though it is no longer in the page map or dirty.
      if (!replace) for (const key of Object.keys(localTomb)) {
        if (!changes.expectedTomb || localTomb[key] !== changes.expectedTomb[key]) {
          settings.tomb[key] = Math.max(settings.tomb[key] || 0, localTomb[key]);
        }
      }
    }
    // Nothing in memory or the visible editor changes until every database
    // write commits. A full/failed image store cannot expose half a notebook.
    if (!memoryOnly) await db.syncBatch({ pages: puts, deletedPages: dels, images, deletedImages, replace, settings });
    const changed = new Set();
    const canPublish = id => beforePages.has(id) && !dirty.has(id) && JSON.stringify(pages.get(id)) === beforePages.get(id);
    const protectedPages = new Set();
    if (replace) {
      for (const id of Array.from(pages.keys())) {
        if (canPublish(id)) { pages.delete(id); changed.add(id); }
        else protectedPages.add(id);
      }
      if (memoryOnly) memBlobs.clear();
    }
    // A user may edit while IndexedDB is committing. Keep that live edit;
    // autosave will write it after this already-queued transaction.
    for (const id of dels) {
      if (canPublish(id) || (replace && changed.has(id))) { if (pages.delete(id)) changed.add(id); }
      else protectedPages.add(id);
    }
    for (const page of puts) {
      if (!protectedPages.has(page.id) && (canPublish(page.id) || (replace && changed.has(page.id)))) { pages.set(page.id, page); changed.add(page.id); }
      else protectedPages.add(page.id);
    }
    // An autosave may already have cleared dirty while this transaction was
    // committing. Requeue any concurrent edit/deletion after the remote write.
    protectedPages.forEach(id => markDirty(id, true));
    if (memoryOnly) {
      for (const id of deletedImages) memBlobs.delete(id);
      for (const image of images) memBlobs.set(image.id, image);
    }
    if (settings) {
      const tomb = settings.tomb;
      if (initialTomb !== JSON.stringify(S.settings.tomb || {})) {
        for (const key of Object.keys(S.settings.tomb || {})) tomb[key] = Math.max(tomb[key] || 0, S.settings.tomb[key]);
      }
      S.settings.tomb = tomb;
      if (replace) Object.assign(S.settings, { recent: [], inboxId: null, ideasId: null, seedAt: 0 });
      // Preserve display/settings edits made while the transaction committed.
      if (JSON.stringify(S.settings) !== JSON.stringify(settings)) saveSettings();
    }
    const imageIds = new Set(deletedImages.concat(images.map(image => image.id)));
    if (replace) { blobURLs.forEach((_, id) => imageIds.add(id)); blobVersions.forEach((_, id) => imageIds.add(id)); }
    imageIds.forEach(invalidateBlob);
    refreshImages(imageIds);
    kidIndex = null;
    if (imageIds.size || replace) emit('blobs', Array.from(imageIds));
    if (changed.size) {
      emit('tree');
      if (puts.length) emit('content', puts[0]);
      emit('external', Array.from(changed));
    }
    return Array.from(changed);
  }); }
  function putBlobRecord(rec) { return localImageWork(async () => {
    if (memoryOnly) memBlobs.set(rec.id, rec); else await db.put('blobs', rec);
    invalidateBlob(rec.id);
    refreshImages(new Set([rec.id]));
    emit('blobs');
  }); }
  /* forget everything stored on this PC (used when this PC takes over the notebook found in a sync folder) */
  async function wipeLocal() {
    clearTimeout(saveTimer);
    dirty.clear();
    pages.clear();
    kidIndex = null;
    blobURLs.forEach(u => URL.revokeObjectURL(u));
    blobURLs.clear();
    memBlobs.clear();
    if (!memoryOnly) { await db.clear('pages'); await db.clear('blobs'); }
    Object.assign(S.settings, { tomb: {}, recent: [], inboxId: null, ideasId: null });
    saveSettings();
    emit('tree');
    emit('blobs');
  }

  async function init() {
    try {
      const got = await Promise.all([db.all('pages'), db.get('meta', 'settings')]);
      got[0].forEach(p => pages.set(p.id, p));
      const d = defaults(), st = got[1] || {};
      S.settings = Object.assign(d, st, { style: Object.assign(d.style, st.style || {}) });
    } catch (e) {
      console.error('[Z Note] storage unavailable, running in memory only', e);
      memoryOnly = true;
      S.memoryOnly = true;
      S.settings = defaults();
    }
    // repair pages whose parent no longer exists
    pages.forEach(p => {
      if (p.parentId && !pages.has(p.parentId)) { p.parentId = null; if (p.type !== 'notebook') p.trashed = p.trashed || Date.now(); dirty.add(p.id); }
      if (!p.parentId && p.type !== 'notebook' && !p.trashed) { p.trashed = Date.now(); dirty.add(p.id); }
    });
    if (dirty.size) markDirty(dirty.values().next().value);

    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);

    // notice other Z Note windows so two windows don't quietly overwrite each other
    if (window.BroadcastChannel && !memoryOnly) {
      try {
        channel = new BroadcastChannel('znote');
        channel.onmessage = async e => {
          const m = e.data || {};
          if (m.from === winId) return;
          if (m.t === 'hello') { channel.postMessage({ t: 'here', from: winId }); S.otherWindow = true; emit('otherwindow'); }
          else if (m.t === 'here') { S.otherWindow = true; emit('otherwindow'); }
          else if (m.t === 'saved' && Array.isArray(m.ids)) {
            const changed = [];
            for (const id of m.ids) {
              if (dirty.has(id)) continue;
              const rec = await db.get('pages', id).catch(() => null);
              if (rec) pages.set(id, rec); else pages.delete(id);
              changed.push(id);
            }
            if (changed.length) { kidIndex = null; emit('tree'); emit('external', changed); }
          }
        };
        channel.postMessage({ t: 'hello', from: winId });
      } catch (e) { channel = null; }
    }
    S.ready = true;
  }

  /* ---------- images ---------- */
  function addImage(blob, meta) { return localImageWork(async () => {
    const size = await U.imageSize(blob);
    const rec = Object.assign({
      id: U.uid(), blob, mime: blob.type || 'image/png', size: blob.size,
      w: size.w, h: size.h, name: '', kind: 'image', created: Date.now(), mod: Date.now()
    }, meta || {});
    if (memoryOnly) memBlobs.set(rec.id, rec); else await db.put('blobs', rec);
    emit('blobs');
    return rec;
  }); }
  async function getBlob(id) {
    if (!id) return null;
    if (memoryOnly) return memBlobs.get(id) || null;
    return (await db.get('blobs', id).catch(() => null)) || null;
  }
  /* object URL for an image id (cached for the life of the window); null when the image is gone */
  async function blobURL(id) {
    if (!id) return null;
    if (blobURLs.has(id)) return blobURLs.get(id);
    const version = blobVersions.get(id) || 0;
    const rec = await getBlob(id);
    if (version !== (blobVersions.get(id) || 0)) return blobURL(id);
    if (!rec || !rec.blob) return null;
    if (blobURLs.has(id)) return blobURLs.get(id);
    const url = URL.createObjectURL(rec.blob);
    blobURLs.set(id, url);
    return url;
  }
  function invalidateBlob(id) {
    blobVersions.set(id, (blobVersions.get(id) || 0) + 1);
    const url = blobURLs.get(id);
    if (url) { URL.revokeObjectURL(url); blobURLs.delete(id); }
  }
  function refreshImages(ids) {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('img[data-blob]').forEach(img => {
      if (ids.has(img.dataset.blob)) setImg(img, img.dataset.blob);
    });
  }
  async function listBlobs() {
    const all = memoryOnly ? Array.from(memBlobs.values()) : await db.all('blobs').catch(() => []);
    return all.sort((a, b) => b.created - a.created);
  }
  /* o.remote = the deletion arrived from another PC through sync, so it is not recorded again */
  function delBlob(id, o) { return localImageWork(async () => {
    if (memoryOnly) memBlobs.delete(id); else await db.del('blobs', id);
    if (!(o && o.remote)) { S.settings.tomb['i:' + id] = Date.now(); saveSettings(); }
    invalidateBlob(id);
    refreshImages(new Set([id]));
    emit('blobs');
  }); }
  function updateBlob(id, patch) { return localImageWork(async () => {
    const rec = await getBlob(id);
    if (!rec) return null;
    Object.assign(rec, patch, { mod: Date.now() });
    if (memoryOnly) memBlobs.set(id, rec); else await db.put('blobs', rec);
    if ('blob' in patch) { invalidateBlob(id); refreshImages(new Set([id])); }
    emit('blobs');
    return rec;
  }); }

  /* Refresh photos without rebuilding the editor or disturbing text selection. */
  function setImg(img, id) {
    const previous = imageBindings.get(img);
    const binding = { alt: previous && img.classList.contains('missing') ? previous.alt : img.alt };
    imageBindings.set(img, binding);
    img.dataset.blob = id || '';
    blobURL(id).then(url => {
      if (imageBindings.get(img) !== binding || img.dataset.blob !== (id || '')) return;
      if (url) { img.src = url; img.classList.remove('missing'); img.alt = binding.alt; }
      else { img.removeAttribute('src'); img.classList.add('missing'); img.alt = 'This picture is not available yet. Sync the source folder to load it.'; }
    });
    return img;
  }

  const S = (ZN.store = {
    pages, settings: defaults(), ready: false, memoryOnly: false, otherWindow: false, winId,
    blank, defaults,
    on, off, emit,
    init, flush, checkpoint, otherWindowsOpen, saveSettings, setSetting,
    get, children, notebooks, isLive, live, path, notebookOf, descendants, trashed, ensureNotebook,
    create, update, touch, trash, restore, purge, move, duplicate, visit,
    addImage, getBlob, blobURL, listBlobs, delBlob, updateBlob, setImg,
    applyRemote, applySyncSnapshot, putBlobRecord, wipeLocal,
    imageRevision: () => imageRevision,
    isDirty: id => dirty.has(id),
    hasUnsaved: () => dirty.size > 0
  });
})();
