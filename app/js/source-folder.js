/* Z Note · visible notebook location and an optional, device-local path label */
(function () {
  'use strict';
  const ZN = window.ZN, S = ZN.store, db = ZN.db, h = ZN.util.h;
  const KEY = 'sourceFolderPath', SUB = 'Z Note notebook';
  let current = null, saved = null, version = 0, initialized = false, watching = false, control = null;
  let writes = Promise.resolve();
  const dir = () => ZN.sync && ZN.sync.dir;

  function normalize(value) {
    let path = String(value || '').trim();
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).trim();
    if (!path || /[\x00-\x1f\x7f]/.test(path)) throw new Error('Paste the full path of the selected folder.');
    if (/^[a-z]:[\\/]/i.test(path)) {
      path = path.replace(/\//g, '\\');
      return path.replace(/\\+$/, '') + (/^[a-z]:\\*$/i.test(path) ? '\\' : '');
    }
    if (/^\\\\[^\\/]+[\\/][^\\/]+/.test(path)) return path.replace(/\//g, '\\').replace(/\\+$/, '');
    if (path.startsWith('/') && !path.startsWith('//')) return path.replace(/\/+$/, '') || '/';
    throw new Error('Use a full path, such as C:\\Notes, not a web address or a relative path.');
  }
  function info() {
    const handle = dir();
    if (!handle) return { connected: false, folderName: '', parentPath: '', notebookPath: S.memoryOnly ? 'Temporary session (not saved)' : 'Browser storage only', fullPath: false };
    const fullPath = !!(saved && saved.handle === handle);
    const parentPath = fullPath ? saved.path : handle.name;
    const direct = !!(ZN.sync && ZN.sync.direct);
    const separator = fullPath && !parentPath.startsWith('/') ? '\\' : '/';
    const notebookPath = direct ? (fullPath ? parentPath : '… / ' + handle.name) : fullPath
      ? parentPath.replace(/[\\/]+$/, '') + separator + SUB
      : '… / ' + handle.name + ' / ' + SUB;
    return { connected: true, folderName: handle.name, parentPath, notebookPath, fullPath, direct };
  }
  function paint() {
    if (control) {
      const value = info();
      control.querySelector('.source-folder-value').textContent = value.notebookPath;
      control.title = value.notebookPath + (value.fullPath ? ' (saved display path)' : '');
      control.setAttribute('aria-label', 'Source folder: ' + value.notebookPath + '. Show folder details.');
    }
    S.emit('sourcefolder');
  }
  async function refresh() {
    const handle = current = dir(), attempt = ++version;
    saved = null;
    paint();
    if (!handle || S.memoryOnly) return;
    try {
      const record = await db.get('meta', KEY);
      if (!record || !record.handle || typeof record.path !== 'string') return;
      const path = normalize(record.path);
      const same = handle === record.handle || (typeof handle.isSameEntry === 'function' && await handle.isSameEntry(record.handle));
      // Folder names are not identities. Two folders can have the same name.
      if (same && attempt === version && handle === dir()) saved = { handle, path };
    } catch (_) { /* Folder location remains visible if the optional label cannot be restored. */ }
    if (attempt === version) paint();
  }
  function write(task) {
    const result = writes.then(task);
    writes = result.catch(() => {});
    return result;
  }
  function setPath(value) {
    let path;
    try { path = normalize(value); } catch (e) { return Promise.reject(e); }
    const handle = dir(), attempt = ++version;
    if (!handle) return Promise.reject(new Error('Connect a source folder first.'));
    if (S.memoryOnly) return Promise.reject(new Error('This browser cannot remember a folder path in this session.'));
    return write(async () => {
      if (handle !== dir()) throw new Error('The source folder changed. Open its details again.');
      await db.put('meta', { handle, path }, KEY);
      if (handle !== dir() || attempt !== version) throw new Error('The source folder changed. Open its details again.');
      saved = { handle, path };
      current = handle;
      paint();
    });
  }
  function clearPath() {
    const attempt = ++version;
    return write(async () => {
      if (!S.memoryOnly) await db.del('meta', KEY);
      if (attempt === version) { saved = null; paint(); }
    });
  }
  function ensureWatching() {
    if (watching) return;
    watching = true;
    S.on('sync', () => { if (current !== dir()) refresh(); else paint(); });
  }
  function button() {
    ensureWatching();
    if (!control) control = h('button.source-folder', { type: 'button', onclick: open },
      ZN.icon('folder', 16), h('span.source-folder-text', h('span.source-folder-label', 'Source folder'), h('span.source-folder-value')));
    paint();
    return control;
  }
  function sharedLocation(value) {
    if (!value.connected || !value.fullPath) return '';
    const parts = value.notebookPath.split(/[\\/]+/);
    const root = parts.findIndex(part => /^OneDrive(?: - .+)?$/i.test(part));
    if (root < 0) return '';
    return 'Inside ' + parts[root] + ': ' + (parts.slice(root + 1).join('/') || '(root folder)');
  }
  function syncInstructions() {
    const value = info();
    if (!value.connected || !value.fullPath) return '';
    const location = sharedLocation(value);
    return [
      'Z Note notebook',
      'Folder on this PC: ' + value.notebookPath,
      location,
      location ? 'On another PC, find this location inside the same OneDrive account. Its drive letter and user folder may differ.'
        : 'On another PC, locate the same notebook in your shared folder. The local path may differ.',
      '1. Click Sync on this PC and wait for OneDrive or your shared-folder service to finish.',
      '2. In Z Note on the other PC, choose Open existing notebook and select that same notebook folder. Allow folder access when prompted.',
      '3. Click Sync on the other PC. Sync and wait for the folder service before switching PCs again.'
    ].filter(Boolean).join('\n');
  }
  /* A stable path panel: normal sync status refreshes must not erase a draft. */
  function pathPanel() {
    let bound = dir(), dirty = false, busy = false, editing = !info().fullPath;
    const pathBox = h('div.source-path', { tabindex: '0', 'aria-label': 'Connected notebook folder path' });
    const hint = h('p.set-note');
    const shared = h('div.source-path-shared');
    const otherPC = h('p.set-note');
    const status = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
    const input = h('input.input', { type: 'text', placeholder: 'C:\\Users\\Your name\\Documents\\Z Note', spellcheck: 'false', autocomplete: 'off' });
    input.addEventListener('input', () => { dirty = true; status.textContent = ''; });
    const save = h('button.btn.sm', { type: 'button', onclick: async () => {
      if (busy) return;
      if (bound !== dir()) { render(); status.textContent = 'The connected folder changed. Enter its full path below.'; return; }
      busy = true; render();
      try {
        await setPath(input.value);
        dirty = false; editing = false;
        status.textContent = 'Full path saved on this PC. The connected folder has not changed.';
      } catch (error) { status.textContent = error.message || String(error); }
      finally { busy = false; render(); }
    } }, 'Save full path');
    const copy = h('button.btn.sm', { type: 'button', onclick: async () => {
      const latest = info();
      if (!latest.connected || !latest.fullPath) { render(); return; }
      try { await navigator.clipboard.writeText(latest.notebookPath); status.textContent = 'Full notebook path copied.'; }
      catch (_) { status.textContent = 'Select the path above and copy it with Ctrl+C.'; }
    } }, 'Copy path');
    const copyInstructions = h('button.btn.sm', { type: 'button', onclick: async () => {
      const instructions = syncInstructions();
      if (!instructions) { render(); return; }
      try { await navigator.clipboard.writeText(instructions); status.textContent = 'Notebook location and sync instructions copied.'; }
      catch (_) { status.textContent = 'Could not copy automatically. Select and copy the folder location above.'; }
    } }, 'Copy sync instructions');
    const edit = h('button.btn.sm.quiet', { type: 'button', onclick: () => { editing = !editing; render(); if (editing) input.focus(); } }, 'Edit path');
    const label = h('span', 'Selected folder’s full path');
    const editor = h('div.source-path-edit', h('label.source-path-label', label, input), save);
    const panel = h('div.source-path-summary', h('b', 'Folder on this PC'), pathBox, hint,
      h('div.set-actions', copy, copyInstructions, edit), shared, otherPC, editor, status);
    function render() {
      const value = info(), handle = dir();
      if (bound !== handle) { bound = handle; dirty = false; editing = !value.fullPath; status.textContent = ''; }
      pathBox.textContent = value.connected ? value.notebookPath : 'No source folder connected';
      if (!dirty) input.value = value.fullPath ? value.parentPath : '';
      hint.textContent = !value.connected ? 'Choose a sync folder below to keep a folder copy of your notebook.'
        : value.fullPath ? 'Saved full path on this PC. If you move or rename this folder, edit the displayed path here.'
        : 'Full path not saved yet. Browsers hide it; copy the selected folder’s address from File Explorer and paste it below once.';
      shared.textContent = sharedLocation(value);
      shared.hidden = !shared.textContent;
      otherPC.hidden = !value.fullPath;
      otherPC.textContent = shared.textContent
        ? 'On another PC, find this location inside the same OneDrive account. The drive letter and user folder may differ. Use Open existing notebook to connect it there.'
        : 'On another PC, use Open existing notebook and select the same notebook in your shared folder. Its local path may differ.';
      label.textContent = 'Full path of selected folder “' + value.folderName + '”';
      copy.disabled = !value.fullPath;
      copyInstructions.disabled = !value.fullPath;
      edit.hidden = !value.fullPath;
      edit.textContent = editing ? 'Hide path editor' : 'Edit path';
      editor.hidden = !value.connected || value.fullPath && !editing && !dirty;
      input.disabled = busy || S.memoryOnly;
      save.disabled = busy || S.memoryOnly || !value.connected;
    }
    render();
    const off = S.on('sourcefolder', () => { if (panel.isConnected) render(); else off(); });
    return panel;
  }
  function open() {
    const handle = dir(), value = info();
    const status = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
    const fail = e => { status.textContent = e.message || String(e); };
    let busy = false;
    const actions = h('div.set-actions',
      value.connected && ZN.sync.supported ? h('button.btn.sm', { type: 'button', onclick: async () => {
        if (handle !== dir()) { fail(new Error('The source folder changed. Close this dialog and open it again.')); return; }
        try {
          // Opens at the existing granted folder. Its result is deliberately
          // discarded: inspecting a location must never change the connection.
          await window.showDirectoryPicker({ startIn: handle, mode: 'read' });
          status.textContent = 'Source folder unchanged.';
        } catch (e) { if (e.name !== 'AbortError') fail(e); }
      } }, 'Locate folder') : null);
    let dialog;
    if (ZN.sync && ZN.sync.supported && !S.memoryOnly) {
      if (value.connected) actions.append(h('button.btn.sm', { type: 'button', onclick: async () => {
        if (busy) return;
        if (handle !== dir()) { fail(new Error('The source folder changed. Close this dialog and open it again.')); return; }
        busy = true;
        status.textContent = 'Syncing this notebook…';
        try {
          const ok = await ZN.sync.now();
          status.textContent = ok ? 'Notebook synced. Wait for OneDrive to finish before switching PCs.' : 'Sync did not finish. ' + ZN.sync.statusText() + '.';
        } catch (e) { fail(e); }
        finally { busy = false; }
      } }, ZN.icon('sync', 15), 'Sync now'));
      actions.append(h('button.btn.sm', { type: 'button', onclick: async () => {
        if (busy) return;
        busy = true;
        try {
          if (await ZN.sync.openExisting()) { dialog.close(); open(); }
        } catch (e) { if (e.name !== 'AbortError') fail(e); }
        finally { busy = false; }
      } }, ZN.icon('folder', 15), 'Open existing notebook…'));
    }
    dialog = ZN.ui.modal({ title: 'Source folder', width: 590,
      body: [
        pathPanel(), actions,
        value.connected ? h('p.set-note', 'Sync: ' + ZN.sync.statusText() + '.') : null,
        h('p.set-note', 'On another PC, use Open existing notebook and select the same notebook in OneDrive or a shared network folder. You can choose “Z Note notebook” itself or its parent. Each PC must allow folder access. Sync on the first PC, wait for the folder service to finish, then sync on the other PC.'),
        status,
        h('button.btn.quiet', { type: 'button', onclick: () => { dialog.close(); ZN.settings.open('data'); } }, value.connected ? 'Manage source folder & backups' : 'Choose a source folder')
      ], buttons: [{ label: 'Done', primary: true }]
    });
  }
  async function init() {
    if (initialized) return;
    initialized = true;
    ensureWatching();
    await refresh();
  }
  ZN.sourceFolder = { init, refresh, info, setPath, clearPath, button, pathPanel, syncInstructions, open };
})();
