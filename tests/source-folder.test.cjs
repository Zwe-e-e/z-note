'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function handle(id, name = 'Notes') {
  return { id, name, kind: 'directory', async isSameEntry(other) { return !!other && other.id === id; } };
}

// No real folder access or browser storage: exercise handle binding and races.
function harness({ dir = null, saved, memoryOnly = false } = {}) {
  const values = new Map(), reads = [], writes = [], deletes = [], messages = [], events = new Map(), modals = [], clipboardWrites = [];
  if (saved) values.set('sourceFolderPath', saved);
  class Element {
    constructor(selector, props, children) {
      this.selector = selector;
      this.children = children.flat(Infinity).filter(x => x != null && x !== false);
      this.style = {};
      this.attributes = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.isConnected = true;
      Object.assign(this, props);
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this['on' + name] = fn; }
    focus() {}
    select() {}
    get textContent() { return this.text || this.children.map(x => x instanceof Element ? x.textContent : String(x)).join(''); }
    set textContent(value) { this.text = value; }
    querySelector(selector) {
      for (const child of this.children) {
        if (!(child instanceof Element)) continue;
        if (child.selector.includes(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
  }
  function h(selector, props, ...children) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { children.unshift(props); props = {}; }
    return new Element(selector, props, children);
  }
  const db = {
    async get(store, key) { reads.push({ store, key }); if (this.onGet) return this.onGet(store, key); return values.get(key); },
    async put(store, value, key) { if (this.onPut) await this.onPut(store, value, key); writes.push({ store, value, key }); values.set(key, value); },
    async del(store, key) { if (this.onDelete) await this.onDelete(store, key); deletes.push({ store, key }); values.delete(key); }
  };
  const store = {
    memoryOnly, settings: {},
    on(name, fn) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(fn);
      return () => events.get(name).delete(fn);
    },
    emit(name) { for (const fn of [...(events.get(name) || [])]) fn(); }
  };
  const ZN = {
    db, store, sync: { dir, state: dir ? 'ready' : 'none', statusText: () => 'ready' },
    util: { h, clear: el => el.replaceChildren(), frame: fn => fn }, icon: () => h('svg'),
    ui: { toast: message => messages.push(message), modal: options => {
      const modal = { options, close() {} };
      modals.push(modal);
      return modal;
    } }
  };
  const context = { ZN, console: { warn() {}, error() {} }, setTimeout, clearTimeout, URL,
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value); } } },
    document: { getElementById: () => null } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/source-folder.js'), 'utf8'), context, { filename: 'app/js/source-folder.js' });
  return { source: ZN.sourceFolder, sync: ZN.sync, store, db, values, reads, writes, deletes, messages, events, modals, clipboardWrites, context };
}

function elements(root) {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== 'object' || !root.selector) return [];
  return [root, ...(root.children || []).flatMap(elements)];
}
function labelledButton(root, label) {
  const buttons = elements(root).filter(el => el.selector.startsWith('button') && el.textContent === label);
  assert.equal(buttons.length, 1, 'Expected one button: ' + label);
  return buttons[0];
}

test('without a connected folder no source path is invented', async () => {
  const h = harness();
  await h.source.init();
  assert.equal(h.source.info().connected, false);
  assert.equal(h.source.info().fullPath, false);
  assert.equal(h.writes.length, 0);
});

test('a browser handle shows a relative notebook location, not an inferred drive path', async () => {
  const h = harness({ dir: handle('one', 'Work notes') });
  await h.source.init();
  const info = h.source.info();
  assert.equal(info.connected, true);
  assert.equal(info.folderName, 'Work notes');
  assert.equal(info.fullPath, false);
  assert.match(info.notebookPath, /Work notes.*Z Note notebook/);
});

test('selecting the notebook directly shows the selected folder once', async () => {
  const h = harness({ dir: handle('direct', 'Z Note notebook') });
  h.sync.direct = true;
  await h.source.init();
  assert.equal(h.source.info().direct, true);
  assert.equal(h.source.info().notebookPath, '… / Z Note notebook');
  await h.source.setPath('D:\\Shared\\Z Note notebook');
  assert.equal(h.source.info().notebookPath, 'D:\\Shared\\Z Note notebook');
  assert.equal(h.source.info().fullPath, true);
});

test('a supplied full path is stored only in device metadata and bound to its directory handle', async () => {
  const dir = handle('one');
  const h = harness({ dir });
  await h.source.init();
  await h.source.setPath('C:\\Work\\Notes');
  const info = h.source.info();
  assert.equal(info.fullPath, true);
  assert.equal(info.parentPath, 'C:\\Work\\Notes');
  assert.equal(info.notebookPath, 'C:\\Work\\Notes\\Z Note notebook');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].store, 'meta');
  assert.equal(h.writes[0].key, 'sourceFolderPath');
  assert.equal(h.writes[0].value.handle, dir);
  assert.equal(h.writes[0].value.path, 'C:\\Work\\Notes');
  assert.deepEqual(h.store.settings, {});
});

test('Explorer quotes and trailing separators normalize without dropping a drive root', async () => {
  const h = harness({ dir: handle('one') });
  await h.source.init();
  await h.source.setPath('  "C:\\Work\\Notes\\"  ');
  assert.equal(h.source.info().parentPath, 'C:\\Work\\Notes');
  await h.source.setPath('C:\\');
  assert.equal(h.source.info().parentPath, 'C:\\');
  assert.equal(h.source.info().notebookPath, 'C:\\Z Note notebook');
});

test('UNC and POSIX absolute parent paths remain usable display values', async () => {
  const h = harness({ dir: handle('one') });
  await h.source.init();
  await h.source.setPath('\\\\server\\share\\Notes');
  assert.equal(h.source.info().parentPath, '\\\\server\\share\\Notes');
  assert.equal(h.source.info().notebookPath, '\\\\server\\share\\Notes\\Z Note notebook');
  await h.source.setPath('/home/me/Notes');
  assert.equal(h.source.info().parentPath, '/home/me/Notes');
  assert.equal(h.source.info().notebookPath, '/home/me/Notes/Z Note notebook');
});

test('relative paths, URLs, and control characters cannot be saved as full paths', async () => {
  const h = harness({ dir: handle('one') });
  await h.source.init();
  for (const value of ['Notes', 'C:Notes', 'C:', 'https://example.com/Notes', 'file:///C:/Notes', 'C:\\Notes\nother', 'C:\\No\u0000tes']) {
    await assert.rejects(h.source.setPath(value), value);
  }
  assert.equal(h.writes.length, 0);
  assert.equal(h.source.info().fullPath, false);
});

test('a saved path restores for the same directory even through a different handle instance', async () => {
  const h = harness({ dir: handle('same'), saved: { handle: handle('same'), path: 'D:\\Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, true);
  assert.equal(h.source.info().parentPath, 'D:\\Notes');
});

test('equal folder names never restore another directory’s stored path', async () => {
  const h = harness({ dir: handle('new', 'Notes'), saved: { handle: handle('old', 'Notes'), path: 'C:\\Private\\Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, false);
  assert.doesNotMatch(h.source.info().notebookPath, /Private/);
});

test('an identity check failure cannot expose an unverified saved path', async () => {
  const broken = handle('one');
  broken.isSameEntry = async () => { throw new Error('Handle unavailable'); };
  const current = handle('one');
  current.isSameEntry = broken.isSameEntry;
  const h = harness({ dir: current, saved: { handle: broken, path: 'C:\\Private\\Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, false);
});

test('failed metadata writes do not show a path as successfully saved', async () => {
  const h = harness({ dir: handle('one') });
  await h.source.init();
  h.db.onPut = async () => { throw new Error('Storage full'); };
  await assert.rejects(h.source.setPath('C:\\Notes'), /Storage full/);
  assert.equal(h.source.info().fullPath, false);
  assert.equal(h.writes.length, 0);
});

test('changing folders during a pending save cannot paint the old path onto the new folder', async () => {
  const h = harness({ dir: handle('one', 'First') });
  await h.source.init();
  const saving = deferred();
  h.db.onPut = () => saving.promise;
  const pending = assert.rejects(h.source.setPath('C:\\First'));
  await settle();
  h.sync.dir = handle('two', 'Second');
  await h.source.refresh();
  saving.resolve();
  await pending;
  assert.equal(h.source.info().folderName, 'Second');
  assert.equal(h.source.info().fullPath, false);
  assert.doesNotMatch(h.source.info().notebookPath, /First/);
});

test('a late identity lookup cannot override a newer folder refresh', async () => {
  const comparison = deferred();
  const first = handle('one', 'First');
  const saved = handle('one', 'First');
  saved.isSameEntry = other => other.id === 'one' ? comparison.promise : Promise.resolve(false);
  first.isSameEntry = () => comparison.promise;
  const h = harness({ dir: first, saved: { handle: saved, path: 'C:\\First' } });
  const original = h.source.init();
  await settle();
  h.sync.dir = handle('two', 'Second');
  const newer = h.source.refresh();
  await settle();
  comparison.resolve(true);
  await Promise.all([original, newer]);
  assert.equal(h.source.info().folderName, 'Second');
  assert.equal(h.source.info().fullPath, false);
  assert.doesNotMatch(h.source.info().notebookPath, /First/);
});

test('clearing a path removes its metadata and returns to the relative source location', async () => {
  const h = harness({ dir: handle('one'), saved: { handle: handle('one'), path: 'C:\\Notes' } });
  await h.source.init();
  await h.source.clearPath();
  assert.equal(h.source.info().fullPath, false);
  assert.equal(h.values.has('sourceFolderPath'), false);
  assert.ok(h.deletes.every(x => x.store === 'meta' && x.key === 'sourceFolderPath'));
});

test('disconnect immediately hides the previously displayed path', async () => {
  const h = harness({ dir: handle('one'), saved: { handle: handle('one'), path: 'C:\\Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, true);
  h.sync.dir = null;
  h.sync.state = 'none';
  h.store.emit('sync');
  await settle();
  assert.equal(h.source.info().connected, false);
  assert.equal(h.source.info().fullPath, false);
});

test('a path cannot be assigned when no source directory is connected', async () => {
  const h = harness();
  await h.source.init();
  await assert.rejects(h.source.setPath('C:\\Notes'));
  assert.equal(h.writes.length, 0);
});

test('temporary sessions do not read or write remembered path metadata', async () => {
  const h = harness({ dir: handle('one'), memoryOnly: true, saved: { handle: handle('one'), path: 'C:\\Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, false);
  await assert.rejects(h.source.setPath('C:\\Notes'));
  await h.source.clearPath();
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.deletes.length, 0);
});

test('invalid saved paths stay hidden even when their handle matches', async () => {
  const h = harness({ dir: handle('one'), saved: { handle: handle('one'), path: 'https://example.com/Notes' } });
  await h.source.init();
  assert.equal(h.source.info().fullPath, false);
  assert.doesNotMatch(h.source.info().notebookPath, /example/);
});

test('clearing while a save is pending cannot let the late save restore its path', async () => {
  const h = harness({ dir: handle('one') });
  await h.source.init();
  const pendingWrite = deferred();
  h.db.onPut = () => pendingWrite.promise;
  const save = assert.rejects(h.source.setPath('C:\\Notes'));
  await settle();
  const clear = h.source.clearPath();
  pendingWrite.resolve();
  await Promise.all([save, clear]);
  assert.equal(h.source.info().fullPath, false);
  assert.equal(h.values.has('sourceFolderPath'), false);
});

test('a newer save survives an earlier pending clear', async () => {
  const h = harness({ dir: handle('one'), saved: { handle: handle('one'), path: 'C:\\Old' } });
  await h.source.init();
  const deleting = deferred();
  h.db.onDelete = () => deleting.promise;
  const clear = h.source.clearPath();
  await settle();
  const save = h.source.setPath('D:\\New');
  deleting.resolve();
  await Promise.all([clear, save]);
  assert.equal(h.source.info().parentPath, 'D:\\New');
  assert.equal(h.values.get('sourceFolderPath').path, 'D:\\New');
});

test('the sidebar observes a restored connection before source-folder initialization finishes', async () => {
  const h = harness();
  const sidebar = h.source.button();
  assert.match(sidebar.textContent, /Browser storage only/);
  const restored = handle('restored', 'Z Note notebook');
  const metadata = deferred();
  h.db.onGet = () => metadata.promise;
  h.sync.dir = restored;
  h.sync.direct = true;
  h.store.emit('sync');
  assert.match(sidebar.textContent, /Z Note notebook/);
  assert.doesNotMatch(sidebar.textContent, /Browser storage only/);
  metadata.resolve({ handle: restored, path: 'E:\\Shared\\Z Note notebook' });
  await settle();
  assert.match(sidebar.textContent, /E:\\Shared\\Z Note notebook/);
  await h.source.init();
  assert.equal(h.events.get('sync').size, 1, 'button() and init() must share one observer');
});

test('sync instructions require a connected folder with a saved full path', async () => {
  for (const dir of [null, handle('unknown', 'Z Note notebook')]) {
    const h = harness({ dir });
    await h.source.init();
    assert.equal(h.source.syncInstructions(), '');
  }
  const h = harness({ dir: handle('saved', 'Notes') });
  await h.source.init();
  await h.source.setPath('D:\\Shared\\Notes');
  const instructions = h.source.syncInstructions();
  assert.match(instructions, /D:\\Shared\\Notes\\Z Note notebook/);
  assert.match(instructions, /Open existing notebook/);
  assert.match(instructions, /[Ss]ync/);
  h.sync.dir = null;
  h.store.emit('sync');
  assert.equal(h.source.syncInstructions(), '');
});

test('OneDrive instructions preserve the account name and relative notebook path', async () => {
  const h = harness({ dir: handle('onedrive', 'Z Note') });
  await h.source.init();
  await h.source.setPath('E:\\One Drive\\OneDrive - Example Company\\Z Note');
  const full = h.source.info().notebookPath;
  const instructions = h.source.syncInstructions();
  assert.ok(instructions.includes(full));
  const hints = instructions.split('\n').filter(line => !line.includes(full));
  assert.ok(hints.some(line => line.includes('OneDrive - Example Company')));
  assert.ok(hints.some(line => /Z Note[\\/]Z Note notebook/.test(line)));
  assert.match(instructions, /different|differ|may vary/i);
});

test('direct notebook paths are not duplicated in sharing instructions', async () => {
  const h = harness({ dir: handle('direct', 'Z Note notebook') });
  h.sync.direct = true;
  await h.source.init();
  await h.source.setPath('C:\\Users\\Tester\\OneDrive\\Notes\\Z Note notebook');
  const instructions = h.source.syncInstructions();
  assert.ok(instructions.includes('C:\\Users\\Tester\\OneDrive\\Notes\\Z Note notebook'));
  assert.doesNotMatch(instructions, /Z Note notebook[\\/]Z Note notebook/);
});

test('OneDrive-like names do not generate a guessed OneDrive-relative location', async () => {
  const h = harness({ dir: handle('plain', 'Notes') });
  await h.source.init();
  await h.source.setPath('D:\\OneDriveBackup\\Notes');
  const full = h.source.info().notebookPath;
  const instructions = h.source.syncInstructions();
  assert.ok(instructions.includes(full));
  const hints = instructions.split('\n').filter(line => !line.includes(full)).join('\n');
  assert.doesNotMatch(hints, /OneDriveBackup|inside OneDrive|OneDrive account|OneDrive folder:/i);
});

test('both folder dialogs share the same full-path panel and do not copy an ellipsis', async () => {
  const h = harness({ dir: handle('unknown', 'Z Note notebook') });
  h.sync.direct = true;
  await h.source.init();
  const panel = h.source.pathPanel();
  assert.match(panel.textContent, /Folder on this PC/);
  assert.equal(labelledButton(panel, 'Copy path').disabled, true);
  assert.equal(labelledButton(panel, 'Copy sync instructions').disabled, true);
  await labelledButton(panel, 'Copy path').onclick();
  await labelledButton(panel, 'Copy sync instructions').onclick();
  assert.equal(h.clipboardWrites.length, 0);
  h.source.open();
  const body = h.modals.at(-1).options.body;
  assert.equal(elements(body).filter(el => el.selector.includes('source-path-summary')).length, 1);
  assert.equal(labelledButton(body, 'Copy path').disabled, true);
  assert.equal(labelledButton(body, 'Copy sync instructions').disabled, true);
});

test('copy actions use the latest saved path and are disabled after switching folders', async () => {
  const h = harness({ dir: handle('first', 'Notes') });
  await h.source.init();
  await h.source.setPath('C:\\First\\Notes');
  const panel = h.source.pathPanel();
  await h.source.setPath('D:\\Moved\\Notes');
  await labelledButton(panel, 'Copy path').onclick();
  await labelledButton(panel, 'Copy sync instructions').onclick();
  assert.equal(h.clipboardWrites[0], 'D:\\Moved\\Notes\\Z Note notebook');
  assert.ok(h.clipboardWrites[1].includes('D:\\Moved\\Notes\\Z Note notebook'));
  assert.doesNotMatch(h.clipboardWrites[1], /C:\\First/);
  h.sync.dir = handle('second', 'Notes');
  h.store.emit('sync');
  await settle();
  assert.equal(labelledButton(panel, 'Copy path').disabled, true);
  assert.equal(labelledButton(panel, 'Copy sync instructions').disabled, true);
});
