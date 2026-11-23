'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

let clock = 100;
function notFound() { return Object.assign(new Error('Not found'), { name: 'NotFoundError' }); }
class FileHandle {
  constructor(name, data = '') { this.name = name; this.kind = 'file'; this.data = data; this.modified = ++clock; }
  async getFile() {
    if (this.readError) throw new Error('Downloading');
    const blob = this.data instanceof Blob ? this.data : new Blob([this.data]);
    return { lastModified: this.modified, size: blob.size, text: () => blob.text(), arrayBuffer: () => blob.arrayBuffer() };
  }
  async createWritable() {
    let next;
    return { write: async data => { next = data; }, close: async () => { this.data = next; this.modified = ++clock; } };
  }
}
class Dir {
  constructor(name) { this.name = name; this.kind = 'directory'; this.children = new Map(); this.permission = 'granted'; this.requests = 0; }
  async queryPermission() { return this.permission; }
  async requestPermission() { this.requests++; return this.permission; }
  async getDirectoryHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) { item = new Dir(name); this.children.set(name, item); }
    if (!item) throw notFound();
    if (item.kind !== 'directory') throw new Error('Not a directory');
    return item;
  }
  async getFileHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) { item = new FileHandle(name); this.children.set(name, item); }
    if (!item) throw notFound();
    if (item.kind !== 'file') throw new Error('Not a file');
    return item;
  }
  async *entries() {
    if (this.wait) await this.wait;
    yield* this.children.entries();
  }
  async removeEntry(name) { this.children.delete(name); }
  async isSameEntry(other) { return this === other; }
}
const page = (id, title, mod = 20000) => ({ id, type: 'note', title, created: mod, updated: mod, mod, content: { blocks: [] } });
async function notebook(parent, pages = []) {
  const root = await parent.getDirectoryHandle('Z Note notebook', { create: true });
  const pagesDir = await root.getDirectoryHandle('pages', { create: true });
  await root.getDirectoryHandle('images', { create: true });
  await root.getDirectoryHandle('deleted', { create: true });
  for (const p of pages) pagesDir.children.set(p.id + '.json', new FileHandle(p.id + '.json', JSON.stringify(p)));
  return root;
}
async function diskPage(root, id) { return JSON.parse(await (await (await (await root.getDirectoryHandle('pages')).getFileHandle(id + '.json')).getFile()).text()); }

function harness(options = {}) {
  const pages = new Map((options.pages || []).map(p => [p.id, structuredClone(p)]));
  const images = new Map();
  const meta = options.meta || new Map(), events = new Map(), timers = new Map();
  const messages = [], pickerCalls = [], prompts = [], mutations = [];
  const S = {
    pages, memoryOnly: false,
    settings: { tomb: {}, seedAt: options.seedAt || 0 },
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn); },
    emit(name) { for (const fn of [...(events.get(name) || [])]) fn(); },
    async flush() {}, saveSettings() {}, get: id => pages.get(id), isDirty: () => false,
    async applyRemote(puts, dels) { mutations.push('apply'); for (const id of dels) pages.delete(id); for (const p of puts) pages.set(p.id, p); },
    async listBlobs() { return Array.from(images.values()); },
    async wipeLocal() { mutations.push('wipe'); pages.clear(); images.clear(); },
    async putBlobRecord(rec) { images.set(rec.id, rec); },
    async delBlob(id) { images.delete(id); }
  };
  function h(selector, props, ...children) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || Array.isArray(props) || props.selector) { children.unshift(props); props = {}; }
    return { selector, ...props, isConnected: true, children,
      append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; }, remove() {} };
  }
  const ZN = { store: S,
    db: {
      async get(store, key) { return meta.get(key); },
      async put(store, value, key) { if (options.failMeta) throw new Error('Storage full'); meta.set(key, value); },
      async all(store) { if (options.failImageRead) throw new Error('Images unavailable'); return Array.from(images.values()); }
    },
    settings: { normalizePage: value => structuredClone(value) },
    util: { h, clear(el) { el.replaceChildren(); return el; }, ago: () => 'just now', debounce(fn) {
      const d = () => timers.set(d, fn); d.cancel = () => timers.delete(d); return d;
    } },
    shell: { view: () => options.view || null }, icon: () => h('svg'), go() {},
    ui: { toast: text => messages.push(text), modal(o) {
      prompts.push(o);
      const modal = { close() { o.onClose(); } };
      queueMicrotask(() => {
        const b = o.buttons.find(x => x.label === (options.choice || 'Combine both'));
        if (b && b.onClick) b.onClick(); else modal.close();
      });
      return modal;
    } }
  };
  const context = { ZN, Blob, console: { error() {}, warn() {} }, setInterval() {}, setTimeout, clearTimeout,
    document: { visibilityState: 'visible', addEventListener() {}, getElementById() { return null; } },
    addEventListener() {},
    async showDirectoryPicker(pickerOptions) { pickerCalls.push(pickerOptions); return options.picked; }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/sync.js'), 'utf8'), context);
  return { sync: ZN.sync, S, ZN, pages, images, meta, messages, pickerCalls, prompts, mutations, timers };
}

test('another PC opens the parent and pulls the notebook, replacing only untouched starter examples', async () => {
  const parent = new Dir('OneDrive notes');
  const root = await notebook(parent, [page('note1', 'Changed on PC one')]);
  const h = harness({ pages: [page('seed1', 'Starter', 1000)], seedAt: 1000, picked: parent });
  assert.equal(await h.sync.openExisting(), true);
  assert.equal(h.sync.direct, false);
  assert.equal(h.sync.dir, parent);
  assert.equal(h.pages.get('note1').title, 'Changed on PC one');
  assert.equal(h.pages.has('seed1'), false);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.pickerCalls[0].mode, 'readwrite');
  assert.equal((await root.getDirectoryHandle('pages')).children.has('seed1.json'), false);
});

test('choosing Z Note notebook itself never creates a nested notebook', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Shared note')]);
  const h = harness({ picked: root });
  assert.equal(await h.sync.openExisting(), true);
  assert.equal(h.sync.dir, root);
  assert.equal(h.sync.direct, true);
  assert.equal(root.children.has('Z Note notebook'), false);
  assert.equal(h.meta.get('syncLocation').handle, root);
  assert.equal(h.meta.get('syncLocation').direct, true);
});

test('two PCs pull and push later edits through the same notebook', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Original')]);
  const first = harness(), second = harness();
  await first.sync.attach(parent, { existing: true });
  await second.sync.attach(root, { existing: true });
  first.pages.set('note1', page('note1', 'Edited on first PC', 30000));
  assert.equal(await first.sync.now(), true);
  assert.equal(await second.sync.now(), true);
  assert.equal(second.pages.get('note1').title, 'Edited on first PC');
  second.pages.set('note1', page('note1', 'Edited on second PC', 40000));
  await second.sync.now(); await first.sync.now();
  assert.equal(first.pages.get('note1').title, 'Edited on second PC');
  assert.equal((await diskPage(root, 'note1')).title, 'Edited on second PC');
});

test('an existing local notebook combines unique pages and never offers a destructive adoption', async () => {
  const parent = new Dir('Shared'); await notebook(parent, [page('remote1', 'Remote')]);
  const h = harness({ pages: [page('local1', 'Keep local')] });
  await h.sync.attach(parent, { existing: true });
  assert.equal(h.pages.size, 2);
  assert.equal(h.pages.get('local1').title, 'Keep local');
  assert.equal(h.mutations.includes('wipe'), false);
  assert.deepEqual(Array.from(h.prompts[0].buttons, b => b.label), ['Cancel', 'Combine both']);
});

test('canceling the merge preserves the previous folder connection and local pages', async () => {
  const old = new Dir('Old'), next = new Dir('Next');
  await notebook(old, [page('note1', 'Keep')]); await notebook(next, [page('note2', 'Remote')]);
  const h = harness({ choice: 'Cancel' });
  await h.sync.attach(old, { existing: true });
  assert.equal(await h.sync.attach(next, { existing: true }), false);
  assert.equal(h.sync.dir, old);
  assert.equal(h.meta.get('syncLocation').handle, old);
  assert.equal(h.pages.has('note2'), false);
});

test('wrong existing-folder selection writes no files or remembered connection', async () => {
  const unrelated = new Dir('Documents'), h = harness({ picked: unrelated });
  await assert.rejects(h.sync.openExisting(), /No complete Z Note notebook/);
  assert.equal(unrelated.children.size, 0);
  assert.equal(h.meta.size, 0);
  assert.equal(h.sync.dir, null);
});

test('denied folder access preserves the previous connection', async () => {
  const parent = new Dir('Shared'), denied = new Dir('Denied');
  await notebook(parent, [page('note1', 'Keep')]);
  const h = harness(); await h.sync.attach(parent, { existing: true });
  denied.permission = 'denied';
  await assert.rejects(h.sync.attach(denied), /not allowed/);
  assert.equal(h.sync.dir, parent);
  assert.equal(h.meta.get('syncLocation').handle, parent);
  assert.equal(denied.children.size, 0);
});

test('metadata failure happens before any starter reset or new folder writes', async () => {
  const selected = new Dir('New'), h = harness({ failMeta: true, pages: [page('seed1', 'Starter', 1000)], seedAt: 1000 });
  await assert.rejects(h.sync.attach(selected), /Storage full/);
  assert.equal(h.pages.has('seed1'), true);
  assert.equal(selected.children.size, 0);
  assert.equal(h.sync.dir, null);
});

test('manual sync commits pending board edits before writing', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Old')]);
  let h, editing = false;
  h = harness({ view: { prepareExport() { if (editing) h.pages.set('note1', page('note1', 'Pending board edit', 40000)); } } });
  await h.sync.attach(parent, { existing: true });
  editing = true;
  await h.sync.now();
  assert.equal((await diskPage(root, 'note1')).title, 'Pending board edit');
});

test('connecting another PC preserves pending edits to a starter page even just after setup', async () => {
  const parent = new Dir('Shared'); await notebook(parent, [page('remote1', 'Remote')]);
  let h;
  h = harness({ pages: [page('seed1', 'Starter', 1000)], seedAt: 1000,
    view: { prepareExport() { h.pages.set('seed1', page('seed1', 'My pending edit', 1001)); } }
  });
  assert.equal(await h.sync.attach(parent, { existing: true }), true);
  assert.equal(h.pages.get('seed1').title, 'My pending edit');
  assert.equal(h.mutations.includes('wipe'), false);
  assert.equal(h.prompts.length, 1);
});

test('attach waits for an in-flight sync before changing the folder', async () => {
  const parent = new Dir('First'), next = new Dir('Second');
  const root = await notebook(parent, [page('note1', 'First')]);
  await notebook(next, [page('note2', 'Second')]);
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const gate = deferred(); (await root.getDirectoryHandle('pages')).wait = gate.promise;
  const running = h.sync.run(); await settle();
  const attaching = h.sync.attach(next, { existing: true, choice: 'merge' }); await settle();
  assert.equal(h.sync.dir, parent);
  assert.equal(h.meta.get('syncLocation').handle, parent);
  gate.resolve(); await running; await attaching;
  assert.equal(h.sync.dir, next);
});

test('updater pause drains active work and prevents sync or connection changes until resumed', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Old')]);
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const gate = deferred(); (await root.getDirectoryHandle('pages')).wait = gate.promise;
  const running = h.sync.run(); await settle();
  let paused = false; const pausing = h.sync.pause().then(() => { paused = true; }); await settle();
  assert.equal(paused, false);
  gate.resolve(); await running; await pausing;
  h.pages.set('note1', page('note1', 'Keep in memory', 50000));
  assert.equal(await h.sync.now(), false);
  assert.equal(await h.sync.run(), false);
  assert.equal((await diskPage(root, 'note1')).title, 'Old');
  await assert.rejects(h.sync.attach(new Dir('Other')), /update is in progress/);
  h.sync.resume(); assert.equal(await h.sync.now(), true);
  assert.equal((await diskPage(root, 'note1')).title, 'Keep in memory');
});

test('new direct layout restores and legacy parent metadata still reconnects', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Stored')]);
  for (const [record, direct] of [[new Map([['syncLocation', { handle: root, direct: true }]]), true], [new Map([['syncDir', parent]]), false]]) {
    const h = harness({ meta: record }); await h.sync.init(); await h.sync.idle();
    assert.equal(h.sync.direct, direct); assert.equal(h.pages.get('note1').title, 'Stored');
  }
});

test('disconnect tombstone does not resurrect the legacy folder on restart', async () => {
  const parent = new Dir('Shared'); await notebook(parent, [page('note1', 'Stored')]);
  const meta = new Map([['syncDir', parent]]), h = harness({ meta });
  await h.sync.init(); await h.sync.idle(); await h.sync.unlink();
  const reopened = harness({ meta }); await reopened.sync.init();
  assert.equal(reopened.sync.dir, null);
});

test('incomplete remote page data stops sync instead of overwriting it with a local copy', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Initial')]);
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const file = await (await root.getDirectoryHandle('pages')).getFileHandle('note1.json');
  file.data = '{incomplete'; file.modified = ++clock;
  h.pages.set('note1', page('note1', 'Local', 60000));
  assert.equal(await h.sync.now(), false);
  assert.equal(h.sync.state, 'error');
  assert.equal(file.data, '{incomplete');
});
