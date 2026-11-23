/* Z Note · visible notebook location and an optional, device-local path label */
(function () {
  'use strict';
  const ZN = window.ZN, S = ZN.store, db = ZN.db, h = ZN.util.h;
  const KEY = 'sourceFolderPath', SUB = 'Z Note notebook';
  let current = null, saved = null, version = 0, initialized = false, control = null;
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
  function button() {
    if (!control) control = h('button.source-folder', { type: 'button', onclick: open },
      ZN.icon('folder', 16), h('span.source-folder-text', h('span.source-folder-label', 'Source folder'), h('span.source-folder-value')));
    paint();
    return control;
  }
  function open() {
    const handle = dir(), value = info();
    const pathBox = h('div.source-path', { tabindex: '0' }, value.notebookPath);
    const status = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
    const input = h('input.input', { type: 'text', value: value.fullPath ? value.parentPath : '', placeholder: 'C:\\Users\\Your name\\Documents\\Z Note', spellcheck: 'false', autocomplete: 'off' });
    const fail = e => { status.textContent = e.message || String(e); };
    let busy = false;
    const save = h('button.btn.sm', { type: 'button', onclick: async () => {
      if (busy) return;
      if (handle !== dir()) { fail(new Error('The source folder changed. Close this dialog and open it again.')); return; }
      busy = true; save.disabled = true;
      try {
        if (input.value.trim()) await setPath(input.value); else await clearPath();
        pathBox.textContent = info().notebookPath;
        status.textContent = input.value.trim() ? 'Full path saved for display on this browser. The connected folder has not changed.' : 'Showing the folder location supplied by your browser.';
      } catch (e) { fail(e); }
      finally { busy = false; save.disabled = false; }
    } }, 'Save display path');
    const actions = h('div.set-actions',
      h('button.btn.sm', { type: 'button', disabled: !value.connected, onclick: async () => {
        if (handle !== dir()) { fail(new Error('The source folder changed. Close this dialog and open it again.')); return; }
        try {
          await navigator.clipboard.writeText(pathBox.textContent);
          status.textContent = 'Copied ' + (info().fullPath ? 'the saved full path.' : 'the folder location (not a full Windows path).');
        } catch (_) { status.textContent = 'Could not copy automatically. Select the path above and copy it.'; }
      } }, 'Copy location'),
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
        h('p.modal-text', value.connected ? 'Connected notebook location:' : S.memoryOnly ? 'No source folder is connected. Notes are only kept for this temporary session.' : 'No source folder is connected. Your notes are stored in this browser.'),
        pathBox, actions,
        value.connected ? h('p.set-note', 'Sync: ' + ZN.sync.statusText() + '.') : null,
        h('p.set-note', 'On another PC, use Open existing notebook and select the same notebook in OneDrive or a shared network folder. You can choose “Z Note notebook” itself or its parent. Each PC must allow folder access. Sync on the first PC, wait for the folder service to finish, then sync on the other PC.'),
        value.connected ? h('div.source-path-edit',
          h('p.set-note', 'Browsers show the folder name but hide its full Windows path. You can use Locate folder to inspect the connected location.'),
          h('label.source-path-label', 'Selected folder’s full path (optional)', input),
          h('p.set-note.muted', 'Paste the path of “' + value.folderName + '” from File Explorer. This is a display label you provide; it does not move your notes or change the connected folder. Clear it to show the folder name again.'),
          save) : null,
        status,
        h('button.btn.quiet', { type: 'button', onclick: () => { dialog.close(); ZN.settings.open('data'); } }, value.connected ? 'Manage source folder & backups' : 'Choose a source folder')
      ], buttons: [{ label: 'Done', primary: true }]
    });
  }
  async function init() {
    if (initialized) return;
    initialized = true;
    S.on('sync', () => { if (current !== dir()) refresh(); });
    await refresh();
  }
  ZN.sourceFolder = { init, refresh, info, setPath, clearPath, button, open };
})();
