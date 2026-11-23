/* Z Note · "Style & data": make it yours, back it up, learn the shortcuts */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui, db = ZN.db;

  const KEYS = ['paper', 'pattern', 'ink', 'head', 'body', 'size', 'width'];
  const OPTIONS = {
    paper: [['cream', 'Cream', '#FCF8EC'], ['white', 'White', '#FFFFFF'], ['kraft', 'Kraft', '#EAD7B2'], ['night', 'Night', '#211F1C']],
    pattern: [['dots', 'Dots'], ['lines', 'Lines'], ['grid', 'Grid'], ['blank', 'Blank']],
    ink: [['blue', 'Blue', '#2E4A8C'], ['black', 'Black', '#2A2823'], ['red', 'Red', '#AE3B26'], ['green', 'Green', '#2B6B49'], ['violet', 'Violet', '#5B418F'], ['teal', 'Teal', '#1F6A71']],
    head: [['hand', 'Handwritten', 'var(--font-hand)'], ['marker', 'Marker', 'var(--font-marker)'], ['serif', 'Serif', '"Sitka Heading", Georgia, serif'], ['sans', 'Clean', 'var(--font-sans)']],
    body: [['serif', 'Serif', 'var(--font-serif)'], ['sans', 'Clean', 'var(--font-sans)'], ['mono', 'Typewriter', 'var(--font-mono)'], ['hand', 'Handwritten', 'var(--font-hand)']],
    size: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']],
    width: [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['full', 'Full']]
  };

  function applyStyle() {
    const st = S.settings.style, root = document.documentElement;
    KEYS.forEach(k => { if (st[k]) root.setAttribute('data-' + k, st[k]); });
    try { localStorage.setItem('zn.style', JSON.stringify(st)); } catch (e) {}
  }
  function setStyle(k, v) {
    S.settings.style[k] = v;
    S.saveSettings();
    applyStyle();
    S.emit('style', k);
  }

  /* ---------- style ---------- */
  function seg(key) {
    const row = h('div.seg', { role: 'radiogroup' });
    OPTIONS[key].forEach(o => {
      const isFont = key === 'head' || key === 'body';
      const b = h('button' + (S.settings.style[key] === o[0] ? '.on' : ''), { type: 'button', role: 'radio', style: isFont ? { fontFamily: o[2] } : null },
        (key === 'paper' || key === 'ink') ? h('span.dot', { style: { '--sw': o[2] } }) : null, o[1]);
      b.addEventListener('click', () => {
        setStyle(key, o[0]);
        row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      });
      row.append(b);
    });
    return row;
  }
  const setRow = (label, control) => h('div.set-row', h('span.set-label', label), control);

  function stylePane() {
    const name = h('input.input', { type: 'text', value: S.settings.name || '', placeholder: 'Your name, for the greeting on Home', maxlength: 40 });
    name.addEventListener('input', () => S.setSetting('name', name.value.trim()));
    const wheel = h('div.seg');
    [['zoom', 'Zooms in and out'], ['pan', 'Scrolls the board']].forEach(o => {
      const b = h('button' + ((S.settings.wheel || 'zoom') === o[0] ? '.on' : ''), { type: 'button' }, o[1]);
      b.addEventListener('click', () => { S.setSetting('wheel', o[0]); wheel.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
      wheel.append(b);
    });
    return h('div.settings',
      setRow('Call me', name),
      setRow('Paper', seg('paper')),
      setRow('Page pattern', seg('pattern')),
      setRow('Ink colour', seg('ink')),
      setRow('Headings', seg('head')),
      setRow('Writing', seg('body')),
      setRow('Text size', seg('size')),
      setRow('Page width', seg('width')),
      setRow('Mouse wheel', wheel));
  }

  /* ---------- backup: one file ---------- */
  async function exportAll() {
    const view = ZN.shell && ZN.shell.view();
    if (view && view.prepareExport) await view.prepareExport();
    await S.flush();
    const settings = JSON.parse(JSON.stringify(S.settings));
    const pages = JSON.parse(JSON.stringify(Array.from(S.pages.values())));
    // A failed image read must not turn into an apparently complete backup.
    const blobs = S.memoryOnly ? await S.listBlobs() : await db.all('blobs');
    const images = [];
    for (const b of blobs) {
      images.push({ id: b.id, mime: b.mime, name: b.name, kind: b.kind, w: b.w, h: b.h, created: b.created, data: await U.blobToDataURL(b.blob) });
    }
    return { app: 'znote', version: 1, exported: Date.now(), settings, pages, images };
  }

  async function download() {
    const data = await exportAll();
    const name = 'Z Note backup ' + U.ymd() + '.json';
    U.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
    S.setSetting('backupAt', Date.now());
    ui.toast('Backup download started: “' + name + '”. Check that the file has finished saving before closing Z Note.', { ms: 8000 });
    return name;
  }

  function normalizePage(p) {
    if (!p || typeof p !== 'object' || !p.id || ['notebook', 'note', 'todo', 'board'].indexOf(p.type) < 0) return null;
    const out = {
      id: String(p.id), type: p.type, title: String(p.title || ''), icon: String(p.icon || ''), color: String(p.color || ''),
      parentId: p.parentId ? String(p.parentId) : null, order: +p.order || 0,
      created: +p.created || Date.now(), updated: +p.updated || Date.now(), mod: +p.mod || +p.updated || 0,
      tags: Array.isArray(p.tags) ? p.tags.map(String) : [], fav: !!p.fav, trashed: +p.trashed || 0,
      content: p.content && typeof p.content === 'object' ? p.content : S.blank(p.type)
    };
    const c = out.content;
    if (p.type === 'note') {
      c.blocks = (Array.isArray(c.blocks) ? c.blocks : []).filter(b => b && b.id && b.t)
        .map(b => Object.assign({}, b, { html: U.cleanHTML(String(b.html || '')), cap: b.cap ? U.text(String(b.cap)) : '' }));
    } else if (p.type === 'todo') {
      c.tasks = (Array.isArray(c.tasks) ? c.tasks : []).filter(t => t && t.id).map(t => Object.assign({}, t, { text: String(t.text || '') }));
    } else if (p.type === 'board') {
      c.items = (Array.isArray(c.items) ? c.items : []).filter(i => i && i.id && i.kind)
        .map(i => (typeof i.text === 'string' ? Object.assign({}, i, { text: U.cleanHTML(i.text) }) : i));
    }
    return out;
  }

  /* mode: 'merge' keeps what you have and adds/updates from the backup; 'replace' wipes first */
  async function importData(data, mode) {
    if (!data || data.app !== 'znote' || !Array.isArray(data.pages)) throw new Error('That file is not a Z Note backup.');
    const pages = data.pages.map(normalizePage).filter(Boolean);
    const images = Array.isArray(data.images) ? data.images : [];
    await S.flush();
    if (mode === 'replace') { await db.clear('pages'); await db.clear('blobs'); }
    const puts = pages.filter(p => {
      if (mode === 'replace') return true;
      const e = S.pages.get(p.id);
      return !e || p.updated > (e.updated || 0);
    });
    await db.batch('pages', puts, []);
    const have = new Set(mode === 'replace' ? [] : (await S.listBlobs()).map(b => b.id));
    let added = 0;
    for (const im of images) {
      if (!im || !im.id || have.has(String(im.id))) continue;
      let blob = null;
      try { blob = im.blob || (im.data ? U.dataURLToBlob(im.data) : null); } catch (e) { blob = null; }
      if (!blob || !/^image\//.test(blob.type || im.mime || '')) continue;
      await db.put('blobs', {
        id: String(im.id), blob, mime: im.mime || blob.type, size: blob.size, w: +im.w || 0, h: +im.h || 0,
        name: String(im.name || ''), kind: im.kind === 'snip' ? 'snip' : 'image', created: +im.created || Date.now()
      });
      added++;
    }
    if (mode === 'replace' && data.settings && typeof data.settings === 'object') {
      const d = S.defaults();
      const st = Object.assign(d, data.settings, { style: Object.assign(d.style, data.settings.style || {}), seeded: true });
      await db.put('meta', st, 'settings');
      try { localStorage.setItem('zn.style', JSON.stringify(st.style)); } catch (e) {}
    }
    return { pages: puts.length, images: added };
  }

  function askImport(data) {
    if (!data || data.app !== 'znote' || !Array.isArray(data.pages)) { ui.toast('That file is not a Z Note backup.', { error: true }); return; }
    const n = data.pages.filter(p => p && p.type !== 'notebook').length;
    const im = (data.images || data.imageFiles || []).length;
    const when = data.exported ? new Date(data.exported).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date';
    let m = null;
    const go = async mode => {
      m.close();
      try {
        const r = await importData(data, mode);
        ui.toast('Restored ' + r.pages + ' pages and ' + r.images + ' images. Reloading…');
        setTimeout(() => location.reload(), 900);
      } catch (e) { ui.toast('Restore failed: ' + (e.message || e), { error: true, ms: 8000 }); }
    };
    m = ui.modal({
      title: 'Restore this backup?', width: 500,
      body: [
        h('p.modal-text', 'This backup holds ' + n + ' pages and ' + im + ' images, saved on ' + when + '.'),
        h('p.modal-text', h('b', 'Add to my notebook'), ' keeps everything you have now and brings in whatever is missing or newer. ',
          h('b', 'Replace my notebook'), ' erases what is here first.')
      ],
      buttons: [
        { label: 'Cancel', quiet: true },
        { label: 'Replace my notebook', danger: true, onClick: () => { go('replace'); return false; } },
        { label: 'Add to my notebook', primary: true, onClick: () => { go('merge'); return false; } }
      ]
    });
  }

  function pickBackupFile() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try { askImport(JSON.parse(await f.text())); }
      catch (e) { ui.toast('That file could not be read as a Z Note backup.', { error: true }); }
    });
    inp.click();
  }

  /* ---------- data pane ---------- */
  function dataPane() {
    const stats = h('p.set-note', 'Counting…');
    let countVersion = 0;
    async function count() {
      const version = ++countVersion;
      const blobs = await S.listBlobs();
      let used = '';
      try { const est = await navigator.storage.estimate(); if (est && est.usage) used = ' · about ' + U.bytes(est.usage) + ' on disk'; } catch (e) {}
      if (version === countVersion) stats.textContent = S.live().filter(p => p.type !== 'notebook').length + ' pages · ' + blobs.length + ' pictures' + used;
    }
    const recount = () => count().catch(() => { stats.textContent = 'Could not count saved pictures. Try opening Sync & backup again.'; });
    recount();
    for (const event of ['tree', 'blobs']) {
      const off = S.on(event, () => { if (stats.isConnected) recount(); else off(); });
    }
    return h('div.settings',
      h('p.set-note', h('b', 'Where your notes live: '), 'inside this browser’s storage on this PC. Turn on a sync folder to keep them in OneDrive as well and share them with your other PCs — or save a backup file from time to time.'),
      stats,
      ZN.sync ? ZN.sync.pane() : null,
      h('div.set-group', h('h3', 'Backup file'),
        h('p.set-note', 'One file with every page and picture. Keep it somewhere safe, or use it to move your notebook by hand.'),
        h('div.set-actions',
          h('button.btn', { type: 'button', onclick: () => download().catch(e => ui.toast('Backup failed: ' + (e.message || e), { error: true })) }, ZN.icon('download', 15), 'Download a backup'),
          h('button.btn', { type: 'button', onclick: pickBackupFile }, ZN.icon('upload', 15), 'Restore from a file…'))),
      h('div.set-group', h('h3', 'Start over'),
        h('p.set-note', 'Erase every page and picture on this PC and begin again with the starter notebooks — Ideas, Work, Study & reference and Personal — plus the example brainstorm board. Your style choices are kept.'),
        h('div.set-actions',
          h('button.btn.danger', { type: 'button', onclick: () => startFresh() }, ZN.icon('trash', 15), 'Start a fresh notebook…'))));
  }

  /* ---------- start over: wipe this PC's notebook and put the starter notebooks back ---------- */
  async function startFresh() {
    const pages = S.live().filter(p => p.type !== 'notebook').length + S.trashed().filter(p => p.type !== 'notebook').length;
    const pics = (await S.listBlobs()).length;
    const synced = ZN.sync && ZN.sync.dir ? ZN.sync.dir.name : '';
    let m = null;
    const reseed = () => { S.settings.expanded = {}; ZN.templates.seed(); };      // the same starter notebooks as the very first run
    const erase = async () => {
      m.close();
      try {
        if (synced) await ZN.sync.resetAll(reseed);          // empties the sync folder too, so every PC starts over
        else { await S.flush(); await S.wipeLocal(); reseed(); }
        if (panel) panel.close();
        ZN.go('home');
        ui.toast(synced ? 'Fresh notebook ready here and in “' + synced + '”. Your other PCs follow the next time they sync.'
          : 'Fresh notebook ready, with the starter notebooks back in place.', { ms: 7000 });
      } catch (e) {
        ui.toast('Could not start fresh: ' + ((e && e.message) || e), { error: true, ms: 8000 });
      }
    };
    m = ui.modal({
      title: 'Start a fresh notebook?', width: 520,
      body: [
        h('p.modal-text', 'This erases everything in Z Note on this PC — ' + pages + (pages === 1 ? ' page' : ' pages') + ' and ' +
          pics + (pics === 1 ? ' picture' : ' pictures') + ', including what is in the trash. It cannot be undone.'),
        h('p.modal-text', 'You then begin again with the starter notebooks — Ideas, Work, Study & reference and Personal — and the example brainstorm board, just like the first time you opened Z Note.'),
        synced ? h('p.modal-text', 'The sync folder ', h('b', synced), ' is emptied as well and then receives the fresh notebook, so ',
          h('b', 'your other PCs lose the old pages too'), ' the next time they sync. To reset only this PC, press Cancel and choose “Stop syncing on this PC” first.') : null
      ],
      buttons: [
        { label: 'Cancel', quiet: true },
        { label: 'Download a backup first', onClick: () => { download().catch(e => ui.toast('Backup failed: ' + (e.message || e), { error: true })); return false; } },
        { label: 'Erase and start fresh', danger: true, onClick: () => { erase(); return false; } }
      ]
    });
  }

  /* ---------- shortcuts pane ---------- */
  function keysPane() {
    const k = (label, keys) => [h('span', label), h('div', keys.split(' ').map(x => h('kbd', x)))];
    const group = (title, rows) => h('div.set-group', h('h3', title), h('div.keys', rows));
    return h('div.settings', { style: { gap: '0' } },
      h('div.keys', { style: { marginBottom: '16px' } },
        k('Search everything', 'Ctrl K'), k('Snip the screen', 'Alt S'), k('New note', 'Alt N'), k('New to-do list', 'Alt T'),
        k('New board', 'Alt B'), k('Home', 'Alt H'), k('Show or hide the sidebar', 'Ctrl \\')),
      group('In a note', [
        k('Block menu', '/'), k('Heading', '#'), k('Bullet', '-'), k('To-do', '[]'), k('Numbered list', '1.'), k('Quote', '>'),
        k('Bold · italic · underline', 'Ctrl B/I/U'), k('Highlight', 'Ctrl Shift H'), k('Link (with text selected)', 'Ctrl K'),
        k('Indent · outdent', 'Tab Shift+Tab'), k('Move a line up or down', 'Alt ↑/↓'), k('Undo · redo', 'Ctrl Z/Y')]),
      group('On a board', [
        k('Select · hand', 'V H'), k('Sticky · text', 'N T'), k('Box · circle · diamond', 'R O D'), k('Arrow · pen', 'L P'),
        k('Frame · eraser', 'F E'), k('Move around', 'Space drag'), k('Zoom', 'Ctrl +/-'), k('Fit everything', 'Shift 1'),
        k('Duplicate', 'Ctrl D'), k('Bring forward · send back', '] [')]));
  }

  /* ---------- the panel ---------- */
  let panel = null;
  function open(tab, checkUpdates) {
    const body = h('div');
    const panes = { style: ['Style', stylePane], data: ['Sync & backup', dataPane], keys: ['Shortcuts', keysPane],
      updates: ['Updates', () => ZN.updates.pane(!!checkUpdates)] };
    const tabs = h('div.tabs', { role: 'tablist' });
    const show = id => {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.id === id));
      U.clear(body).append(panes[id][1]());
      checkUpdates = false;
    };
    Object.keys(panes).forEach(id => tabs.append(h('button.tab', { type: 'button', role: 'tab', dataset: { id }, onclick: () => show(id) }, panes[id][0])));
    panel = ui.modal({ title: 'Style & data' + (ZN.version ? ' · v' + ZN.version : ''), width: 640, body: [tabs, body], onClose: () => { panel = null; } });
    show(panes[tab] ? tab : 'style');
  }

  ZN.settings = { open, applyStyle, setStyle, exportAll, importData, download, normalizePage };
})();
