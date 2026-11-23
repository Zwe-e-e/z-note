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
async function picture(root, id, bytes, mod = 20000, options = {}) {
  const dir = await root.getDirectoryHandle('images');
  const file = id + '.png';
  const data = new Blob([bytes], { type: 'image/png' });
  const metadata = { id, file, mime: 'image/png', size: data.size, w: 20, h: 10, created: mod, mod, kind: 'image', name: 'Saved photo', ...options };
  dir.children.set(id + '.json', new FileHandle(id + '.json', JSON.stringify(metadata)));
  dir.children.set(file, new FileHandle(file, data));
  return dir;
}
function illustratedPages() {
  return [
    { ...page('book1', 'Saved notebook'), type: 'notebook', content: {} },
    { ...page('note1', 'Saved note'), parentId: 'book1', content: { blocks: [
      { id: 'text1', t: 'p', html: '<b>Existing text</b> with မြန်မာစာ and <i>formatting</i>' },
      { id: 'image1', t: 'image', src: 'photo1', cap: 'Original caption' }
    ] } },
    { ...page('board1', 'Saved board'), type: 'board', parentId: 'book1', content: { items: [
      { id: 'shape1', kind: 'text', text: '<b>Board text</b>', x: 30, y: 40, w: 100, h: 50 },
      { id: 'shape2', kind: 'image', src: 'photo1', x: 150, y: 40, w: 200, h: 100 }
    ], view: { x: 0, y: 0, k: 1 } } }
  ];
}

function harness(options = {}) {
  const pages = new Map((options.pages || []).map(p => [p.id, structuredClone(p)]));
  const images = new Map((options.images || []).map(image => [image.id, structuredClone(image)]));
  const meta = options.meta || new Map(), events = new Map(), timers = new Map();
  const messages = [], pickerCalls = [], prompts = [], mutations = [];
  const S = {
    pages, memoryOnly: false,
    settings: { tomb: {}, seedAt: options.seedAt || 0 },
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn); },
    emit(name) { for (const fn of [...(events.get(name) || [])]) fn(); },
    async flush() {}, saveSettings() {}, get: id => pages.get(id), isDirty: () => false,
    imageRevision: () => options.imageRevision || 0,
    async applyRemote(puts, dels) { mutations.push('apply'); for (const id of dels) pages.delete(id); for (const p of puts) pages.set(p.id, p); },
    async applySyncSnapshot(snapshot) {
      if (options.failSnapshot) throw new Error('Notebook storage full');
      if (snapshot.imageRevision !== S.imageRevision()) throw new Error('Pictures changed while the folder was opening');
      const expectedPages = new Map(snapshot.expectedPages);
      const unchanged = id => snapshot.replace || JSON.stringify(pages.get(id)) === expectedPages.get(id);
      const changedPages = (snapshot.pages || []).filter(pg => unchanged(pg.id));
      const deletedPages = (snapshot.deletedPages || []).filter(unchanged);
      mutations.push(snapshot.replace ? 'replace' : 'apply');
      if (snapshot.replace) { pages.clear(); images.clear(); S.settings.seedAt = 0; }
      for (const id of snapshot.deletedImages || []) images.delete(id);
      for (const rec of snapshot.images || []) images.set(rec.id, rec);
      for (const id of deletedPages) pages.delete(id);
      for (const pg of changedPages) pages.set(pg.id, pg);
      const tomb = { ...snapshot.tomb };
      for (const key of Object.keys(S.settings.tomb)) {
        if (!snapshot.replace && (!snapshot.expectedTomb || S.settings.tomb[key] !== snapshot.expectedTomb[key])) {
          tomb[key] = Math.max(tomb[key] || 0, S.settings.tomb[key]);
        }
      }
      S.settings.tomb = tomb;
      if (options.onPublish) options.onPublish({ pages, images, snapshot });
    },
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

test('opening either folder location publishes full text and note/board photos together', async () => {
  for (const direct of [false, true]) {
    const parent = new Dir('Shared'), original = illustratedPages(), root = await notebook(parent, original);
    await picture(root, 'photo1', 'original-photo-bytes');
    let publications = 0;
    const h = harness({ picked: direct ? root : parent, pages: [page('seed1', 'Starter', 1000)], seedAt: 1000,
      onPublish({ pages, images }) {
        publications++;
        assert.equal(images.has('photo1'), true, 'image bytes must exist before a page can be rendered');
        assert.equal(pages.get('note1').content.blocks[0].html, original[1].content.blocks[0].html);
        assert.equal(pages.get('board1').content.items[1].src, 'photo1');
      }
    });
    assert.equal(await h.sync.openExisting(), true);
    assert.equal(publications, 1);
    assert.equal(h.pages.size, 3);
    assert.equal(h.pages.get('note1').parentId, 'book1');
    assert.equal(h.pages.get('note1').content.blocks[1].cap, 'Original caption');
    assert.equal(h.pages.get('board1').content.items[0].text, '<b>Board text</b>');
    assert.equal(await h.images.get('photo1').blob.text(), 'original-photo-bytes');
    assert.equal((await root.getDirectoryHandle('pages')).children.size, 3, 'opening does not write starter pages into the selected folder');
    assert.equal(h.mutations.includes('wipe'), false);
  }
});

test('missing photo bytes preserve current notes and the previous connection', async () => {
  const old = new Dir('Old'), next = new Dir('Next');
  await notebook(old, [page('local1', 'Keep my note')]);
  const selected = await notebook(next, illustratedPages());
  const dir = await picture(selected, 'photo1', 'picture');
  dir.children.delete('photo1.png');
  const h = harness(); await h.sync.attach(old, { existing: true });
  const publications = h.mutations.length;
  await assert.rejects(h.sync.attach(next, { existing: true }), /picture.*not finished downloading/i);
  assert.equal(h.sync.dir, old);
  assert.equal(h.meta.get('syncLocation').handle, old);
  assert.equal(h.pages.size, 1);
  assert.equal(h.pages.get('local1').title, 'Keep my note');
  assert.equal(h.images.size, 0);
  assert.equal(h.mutations.length, publications);
  assert.equal((await selected.getDirectoryHandle('pages')).children.size, 3);
});

test('a referenced photo without metadata cannot silently open as a blank image', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const h = harness({ picked: root, pages: [page('seed1', 'Starter', 1000)], seedAt: 1000 });
  await assert.rejects(h.sync.openExisting(), /picture that is missing/);
  assert.equal(h.pages.get('seed1').title, 'Starter');
  assert.equal(h.sync.dir, null);
  assert.equal(h.meta.has('syncLocation'), false);
  assert.equal(h.mutations.length, 0);
});

test('an incomplete picture size prevents local replacement and remote writes', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  await picture(root, 'photo1', 'half', 20000, { size: 40 });
  const h = harness({ picked: parent, pages: [page('local1', 'Local note')] });
  await assert.rejects(h.sync.openExisting(), /picture.*not finished downloading/i);
  assert.equal(h.pages.size, 1);
  assert.equal((await root.getDirectoryHandle('pages')).children.has('local1.json'), false);
  assert.equal(h.meta.size, 0);
});

test('failed atomic notebook storage restores the previous folder and leaves current pages intact', async () => {
  const old = new Dir('Old'), next = new Dir('Next');
  await notebook(old, [page('local1', 'Keep local')]);
  const root = await notebook(next, illustratedPages()); await picture(root, 'photo1', 'photo');
  const options = {}, h = harness(options);
  await h.sync.attach(old, { existing: true }); options.failSnapshot = true;
  await assert.rejects(h.sync.attach(next, { existing: true }), /Notebook storage full/);
  assert.equal(h.sync.dir, old);
  assert.equal(h.meta.get('syncLocation').handle, old);
  assert.equal(h.pages.size, 1);
  assert.equal(h.pages.get('local1').title, 'Keep local');
  assert.equal(h.images.size, 0);
});

test('normal sync stages a newly referenced photo before exposing a remote note update', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, [page('note1', 'Initial')]);
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const incoming = illustratedPages()[1]; incoming.mod = incoming.updated = 30000;
  const pageDir = await root.getDirectoryHandle('pages');
  pageDir.children.set('note1.json', new FileHandle('note1.json', JSON.stringify(incoming)));
  const imageDir = await picture(root, 'photo1', 'downloaded-photo', 30000);
  imageDir.children.get('photo1.png').readError = true;
  h.pages.set('local1', page('local1', 'Pending local', 60000));
  assert.equal(await h.sync.now(), false);
  assert.equal(h.pages.get('note1').title, 'Initial');
  assert.equal(pageDir.children.has('local1.json'), false);
  imageDir.children.get('photo1.png').readError = false;
  assert.equal(await h.sync.now(), true);
  assert.equal(h.pages.get('note1').title, incoming.title);
  assert.equal(await h.images.get('photo1').blob.text(), 'downloaded-photo');
});

test('same-sized photo edits update binary data and reach another PC', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  await picture(root, 'photo1', 'AAAA');
  const first = harness(), second = harness();
  await first.sync.attach(parent, { existing: true }); await second.sync.attach(parent, { existing: true });
  const previous = first.images.get('photo1');
  first.images.set('photo1', { ...previous, blob: new Blob(['BBBB'], { type: 'image/png' }), mod: 40000 });
  assert.equal(await first.sync.now(), true);
  assert.equal(await second.sync.now(), true);
  assert.equal(await second.images.get('photo1').blob.text(), 'BBBB');
});

test('photo bytes arriving after equal-sized metadata refresh without a second metadata change', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'AAAA');
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const metadata = dir.children.get('photo1.json');
  const next = JSON.parse(metadata.data); next.mod = 40000;
  metadata.data = JSON.stringify(next); metadata.modified = ++clock;
  assert.equal(await h.sync.now(), true);
  assert.equal(await h.images.get('photo1').blob.text(), 'AAAA');
  // Simulate OneDrive delivering the binary only after the JSON metadata.
  const file = dir.children.get('photo1.png'); file.data = new Blob(['BBBB']); file.modified = ++clock;
  assert.equal(await h.sync.now(), true);
  assert.equal(await h.images.get('photo1').blob.text(), 'BBBB');
  assert.equal(h.images.get('photo1').mod, 40000);
});

test('editing starter notes while folder photos load prevents adoption', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'photo'), gate = deferred();
  dir.wait = gate.promise;
  const h = harness({ picked: parent, pages: [page('seed1', 'Starter', 1000)], seedAt: 1000 });
  const opening = h.sync.openExisting(); await settle();
  h.pages.set('seed1', page('seed1', 'My new text', 50000));
  gate.resolve(); await assert.rejects(opening, /notes changed while the folder/);
  assert.equal(h.pages.get('seed1').title, 'My new text');
  assert.equal(h.sync.dir, null);
  assert.equal(h.mutations.length, 0);
});

test('a newly captured unattached picture also prevents starter adoption', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'photo'), gate = deferred();
  dir.wait = gate.promise;
  const h = harness({ picked: parent, pages: [page('seed1', 'Starter', 1000)], seedAt: 1000 });
  const opening = h.sync.openExisting(); await settle();
  h.images.set('newpic1', { id: 'newpic1', blob: new Blob(['my picture']), mod: 50000 });
  gate.resolve(); await assert.rejects(opening, /notes changed while the folder/);
  assert.equal(await h.images.get('newpic1').blob.text(), 'my picture');
  assert.equal(h.pages.has('seed1'), true);
  assert.equal(h.sync.dir, null);
});

test('a same-ID local photo edit during preflight aborts the stale remote snapshot', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'AAAA');
  const options = {}, h = harness(options); await h.sync.attach(parent, { existing: true });
  const meta = dir.children.get('photo1.json'), next = JSON.parse(meta.data); next.mod = 40000;
  meta.data = JSON.stringify(next); meta.modified = ++clock;
  const gate = deferred(), image = dir.children.get('photo1.png');
  const originalGetFile = image.getFile.bind(image);
  image.getFile = async () => { await gate.promise; return originalGetFile(); };
  const syncing = h.sync.now(); await settle();
  const saved = h.images.get('photo1');
  h.images.set('photo1', { ...saved, blob: new Blob(['MINE']), mod: 50000 }); options.imageRevision = 1;
  gate.resolve();
  assert.equal(await syncing, false);
  assert.equal(await h.images.get('photo1').blob.text(), 'MINE');
  assert.match(h.sync.lastError, /Pictures changed/);
});

test('a real note image block without picture metadata cannot open as blank', async () => {
  const parent = new Dir('Shared');
  await notebook(parent, illustratedPages().filter(pg => pg.type !== 'board'));
  const h = harness({ pages: [page('local1', 'Keep my text')], picked: parent });
  await assert.rejects(h.sync.openExisting(), /picture that is missing/);
  assert.equal(h.pages.get('local1').title, 'Keep my text');
  assert.equal(h.pages.has('note1'), false);
  assert.equal(h.sync.dir, null);
  assert.equal(h.mutations.length, 0);
});

test('equal-version legacy local photos keep their bytes when remote binary is stale', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  await picture(root, 'photo1', 'BAD!', 20000);
  const h = harness({ pages: illustratedPages(), images: [{ id: 'photo1', blob: new Blob(['GOOD']), mime: 'image/png', size: 4, mod: 20000 }] });
  assert.equal(await h.sync.attach(parent, { existing: true }), true);
  assert.equal(await h.images.get('photo1').blob.text(), 'GOOD');
  assert.equal(h.images.get('photo1').sourceFileModified, undefined);
  assert.equal(await h.sync.now(), true);
  assert.equal(await h.images.get('photo1').blob.text(), 'GOOD');
});

test('a same-page edit saved during photo preflight is preserved and synced', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'AAAA');
  const h = harness(); await h.sync.attach(parent, { existing: true });
  const pages = await root.getDirectoryHandle('pages');
  const remote = { ...h.pages.get('note1'), title: 'Remote text', mod: 40000 };
  pages.children.set('note1.json', new FileHandle('note1.json', JSON.stringify(remote)));
  await picture(root, 'photo1', 'BBBB', 40000);
  const gate = deferred(), image = dir.children.get('photo1.png');
  const originalGetFile = image.getFile.bind(image);
  image.getFile = async () => { await gate.promise; return originalGetFile(); };
  const syncing = h.sync.now(); await settle();
  h.pages.set('note1', { ...h.pages.get('note1'), title: 'My saved text', mod: 50000 });
  gate.resolve();
  assert.equal(await syncing, true);
  assert.equal(h.pages.get('note1').title, 'My saved text');
  assert.equal((await diskPage(root, 'note1')).title, 'My saved text');
  assert.equal(await h.images.get('photo1').blob.text(), 'BBBB');
});

test('preflight keeps new local deletions while allowing old deletion records to expire', async () => {
  const parent = new Dir('Shared'), root = await notebook(parent, illustratedPages());
  const dir = await picture(root, 'photo1', 'AAAA');
  const h = harness(); await h.sync.attach(parent, { existing: true });
  h.S.settings.tomb['p:expired1'] = Date.now() - 181 * 24 * 60 * 60 * 1000;
  await picture(root, 'photo1', 'BBBB', 40000);
  const gate = deferred(), image = dir.children.get('photo1.png');
  const originalGetFile = image.getFile.bind(image);
  image.getFile = async () => { await gate.promise; return originalGetFile(); };
  const syncing = h.sync.now(); await settle();
  h.pages.delete('note1');
  const deletedAt = h.S.settings.tomb['p:note1'] = Date.now();
  gate.resolve();
  assert.equal(await syncing, true);
  assert.equal(h.S.settings.tomb['p:expired1'], undefined);
  assert.equal(h.S.settings.tomb['p:note1'], deletedAt);
  assert.equal(h.pages.has('note1'), false);
});
