'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => value === undefined ? undefined : structuredClone(value);
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const pdf = text => new Blob(['%PDF-1.7\n', text || 'receipt', '\n%%EOF'], { type: 'application/pdf' });
const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), 'fixture'], { type: 'image/png' });
const book = { id: 'book1', type: 'notebook', title: 'My notebook', content: {}, created: 10, updated: 10, mod: 10 };
const original = { id: 'note1', type: 'note', parentId: 'book1', title: 'Keep my note', content: { blocks: [{ id: 'text1', t: 'p', html: 'Original text' }] }, created: 20, updated: 20, mod: 20 };
const expense = attachments => ({ currency: 'SGD', budgets: { '2026-11': 50000 }, expenses: [{ id: 'expense1', date: '2026-11-25', description: 'Lunch', category: 'Food', amount: 1234, note: 'Receipt attached', attachments }] });
const budgetPage = ids => ({ id: 'budget1', type: 'budget', parentId: 'book1', title: 'November', content: expense(ids), created: 30, updated: 30, mod: 30 });

async function harness(options = {}) {
  const data = { pages: new Map((options.pages || [book, original]).map(p => [p.id, clone(p)])), blobs: new Map(), meta: new Map([['settings', { seeded: true, seedAt: 0, tomb: {}, style: { paper: 'cream' } }]]) };
  let next = 0, timer = 0;
  const timers = new Map(), commits = [];
  const uiState = { nodes: [], modals: [], toasts: [], listeners: new Map(), app: { inert: false }, reloads: 0 };
  function element(selector, ...parts) {
    const attrs = parts[0] && !Array.isArray(parts[0]) && typeof parts[0] === 'object' && !parts[0].selector ? parts.shift() : {};
    const node = Object.assign({ selector, children: parts.flat(Infinity), listeners: {}, isConnected: true,
      classList: { toggle() {} }, append(...children) { this.children.push(...children); },
      querySelectorAll() { return this.children.filter(c => c && c.selector === 'button.tab'); },
      addEventListener(type, callback) { this.listeners[type] = callback; }, click() {}
    }, attrs);
    uiState.nodes.push(node); return node;
  }
  const db = {
    async all(store) { if (options.memoryOnly) throw new Error('Storage unavailable'); return Array.from(data[store].values(), clone); },
    async get(store, key) { return clone(data[store].get(key)); },
    async put(store, value, key) { if (options.putGate && store === 'blobs') await options.putGate; data[store].set(key === undefined ? value.id : key, clone(value)); },
    async del(store, key) { data[store].delete(key); },
    async clear(store) { data[store].clear(); },
    async batch(store, puts, dels) { if (options.failPageDeletion && store === 'pages' && dels && dels.length) throw new Error('Page deletion failed'); for (const id of dels || []) data[store].delete(id); for (const p of puts || []) data[store].set(p.id, clone(p)); },
    async syncBatch(spec) {
      commits.push(clone(spec));
      if (options.commitGate) await options.commitGate;
      if (options.failCommit) throw new Error('Storage full');
      if (spec.replace) { data.pages.clear(); data.blobs.clear(); }
      for (const id of spec.deletedPages || []) data.pages.delete(id);
      for (const p of spec.pages || []) data.pages.set(p.id, clone(p));
      for (const id of spec.deletedImages || []) data.blobs.delete(id);
      for (const rec of spec.images || []) data.blobs.set(rec.id, clone(rec));
      if (spec.settings) data.meta.set('settings', clone(spec.settings));
    }
  };
  const ZN = { db, util: {
    uid: () => 'local' + (++next), imageSize: async () => options.badImage ? { w: 0, h: 0 } : { w: 20, h: 30 },
    cleanHTML: value => value, text: value => value, h: element, ago: () => 'just now',
    clear(node) { node.children = []; return node; },
    debounce(fn) { const run = () => timers.set(run, fn); run.cancel = () => timers.delete(run); return run; },
    async blobToDataURL(blob) { return 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'); },
    dataURLToBlob(value) { const m = /^data:([^;,]+);base64,(.*)$/.exec(value); if (!m) throw new Error('Bad data'); return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }); }
  }, ui: { toast(message) { uiState.toasts.push(message); }, modal(spec) { const modal = { ...spec, close() { this.closed = true; } }; uiState.modals.push(modal); return modal; } }, shell: { view: () => null }, go() {}, icon() { return element('svg'); },
    budget: { normalizeContent: value => clone(value), attachmentIds(page) { return (page.content || page).expenses.flatMap(e => e.attachments || []); } }
  };
  const context = { ZN, Blob, Uint8Array, console: { error() {}, warn() {} }, navigator: {},
    document: { addEventListener() {}, querySelectorAll: selector => selector === '#app, .modal' ? [uiState.app] : [], getElementById: () => null },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    localStorage: { setItem() {} }, addEventListener(type, callback, capture) { if (capture) uiState.listeners.set(type, callback); }, removeEventListener(type) { uiState.listeners.delete(type); }, setInterval() {},
    location: { reload() { uiState.reloads++; } },
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); },
    showDirectoryPicker() { throw new Error('No real folder access allowed'); }
  };
  context.window = context;
  for (const name of ['store', 'settings', 'sync']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/' + name + '.js'), 'utf8'), context);
  await ZN.store.init();
  return { ZN, S: ZN.store, data, commits, uiState };
}

let modified = 100;
function absent() { return Object.assign(new Error('Missing'), { name: 'NotFoundError' }); }
class FileHandle {
  constructor(name, bytes = '') { this.name = name; this.kind = 'file'; this.bytes = bytes; this.modified = ++modified; }
  async getFile() { if (this.fail) throw new Error('Still downloading'); const blob = this.bytes instanceof Blob ? this.bytes : new Blob([this.bytes]); return { size: blob.size, lastModified: this.modified, text: () => blob.text(), arrayBuffer: () => blob.arrayBuffer() }; }
  async createWritable() { let pending; return { write: async value => { pending = value; }, close: async () => { this.bytes = pending; this.modified = ++modified; } }; }
}
class Folder {
  constructor(name) { this.name = name; this.kind = 'directory'; this.children = new Map(); }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
  async getDirectoryHandle(name, options = {}) { if (!this.children.has(name) && options.create) this.children.set(name, new Folder(name)); if (!this.children.has(name)) throw absent(); return this.children.get(name); }
  async getFileHandle(name, options = {}) { if (!this.children.has(name) && options.create) this.children.set(name, new FileHandle(name)); if (!this.children.has(name)) throw absent(); return this.children.get(name); }
  async *entries() { yield* this.children.entries(); }
  async removeEntry(name) { this.children.delete(name); }
}
async function seedBudget(h) {
  const rec = await h.S.addAttachment(pdf('Invoice number 8'), { name: 'invoice.pdf' });
  h.S.create(budgetPage([rec.id])); await h.S.flush();
  return rec;
}

test('PDF and image receipts retain bytes, canonical metadata and separate attachment kind', async () => {
  const h = await harness();
  for (const [blob, name] of [[pdf(), 'invoice.pdf'], [png(), 'receipt.png']]) {
    const rec = await h.S.addAttachment(blob, { name, kind: 'snip', id: 'hijack' });
    assert.equal(rec.kind, 'attachment'); assert.notEqual(rec.id, 'hijack'); assert.equal(rec.name, name);
    assert.equal(rec.mime, blob.type); assert.equal(rec.size, blob.size);
    assert.deepEqual(Buffer.from(await (await h.S.getAttachment(rec.id)).blob.arrayBuffer()), Buffer.from(await blob.arrayBuffer()));
  }
  const noMime = await h.S.addAttachment(new Blob(['%PDF-1.7\nInvoice']));
  assert.equal(noMime.blob.type, 'application/pdf');
  assert.equal(await h.S.getAttachment('absent'), null);
});

test('unsafe, mislabeled, empty and oversized receipts never write a blob', async () => {
  const h = await harness();
  const bad = [new Blob([], { type: 'application/pdf' }), new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    new Blob(['<html>invoice</html>'], { type: 'application/pdf' }), new Blob(['%PDF-1.7'], { type: 'image/png' }),
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'application/pdf' })];
  for (const blob of bad) await assert.rejects(h.S.addAttachment(blob));
  assert.equal(h.data.blobs.size, 0);
  const broken = await harness({ badImage: true });
  await assert.rejects(broken.S.addAttachment(png()), /could not be read/); assert.equal(broken.data.blobs.size, 0);
});

test('receipt download names always end in the verified file type including imported names', async () => {
  const h = await harness();
  const rec = await h.S.addAttachment(pdf('<html>invoice</html>'), { name: 'invoice.html' });
  assert.equal(rec.name, 'invoice.html.pdf');
  h.data.blobs.get(rec.id).name = '..\\invoice.html';
  assert.equal((await h.S.getAttachment(rec.id)).name, '.._invoice.html.pdf');
  h.data.blobs.get(rec.id).name = 'invoice.PDF';
  assert.equal((await h.S.getAttachment(rec.id)).name, 'invoice.PDF');
});

test('a complete tracked expense save is included before backup and checkpoint finish', async () => {
  const h = await harness(), gate = deferred();
  const saving = h.S.trackDataWork(async () => {
    const first = await h.S.addAttachment(pdf('First'));
    await gate.promise;
    const second = await h.S.addAttachment(pdf('Second'));
    h.S.create(budgetPage([first.id, second.id]));
  });
  let finished = false;
  const backupWork = h.ZN.settings.exportAll().then(value => { finished = true; return value; });
  const checkpoint = h.S.checkpoint();
  await settle(); assert.equal(finished, false);
  gate.resolve(); await saving; await checkpoint;
  const backup = await backupWork;
  assert.equal(backup.pages.find(p => p.type === 'budget').content.expenses[0].attachments.length, 2);
  assert.equal(backup.images.length, 2); assert.ok(backup.images.every(i => i.kind === 'attachment'));
});

test('backup round trip preserves financial entries, receipt bytes and names', async () => {
  const source = await harness(), rec = await seedBudget(source);
  const backup = await source.ZN.settings.exportAll();
  const target = await harness();
  const result = await target.ZN.settings.importData(backup, 'replace');
  assert.equal(result.pages, 3); assert.equal(result.images, 1);
  assert.deepEqual(target.data.pages.get('budget1').content, expense([rec.id]));
  assert.equal(target.data.blobs.get(rec.id).kind, 'attachment');
  assert.equal(target.data.blobs.get(rec.id).name, 'invoice.pdf');
  assert.equal(await target.data.blobs.get(rec.id).blob.text(), await rec.blob.text());
});

test('missing or invalid backup receipts reject before replacing existing notes', async () => {
  const source = await harness(), rec = await seedBudget(source), complete = await source.ZN.settings.exportAll();
  for (const variant of ['missing', 'invalid']) {
    const target = await harness(), backup = clone(complete);
    if (variant === 'missing') backup.images = [];
    else backup.images[0].data = 'data:application/pdf;base64,' + Buffer.from('<script>unsafe</script>').toString('base64');
    await assert.rejects(target.ZN.settings.importData(backup, 'replace'));
    assert.equal(target.commits.length, 0); assert.equal(target.data.pages.get('note1').title, 'Keep my note');
    assert.equal(target.data.pages.has('budget1'), false); assert.equal(target.data.blobs.has(rec.id), false);
  }
});

test('missing, corrupt or misclassified live receipts prevent an apparently complete backup', async () => {
  for (const variant of ['missing', 'corrupt', 'ordinary image']) {
    const h = await harness(), rec = await seedBudget(h);
    if (variant === 'missing') h.data.blobs.delete(rec.id);
    if (variant === 'corrupt') h.data.blobs.get(rec.id).blob = new Blob(['invalid'], { type: 'application/pdf' });
    if (variant === 'ordinary image') h.data.blobs.get(rec.id).kind = 'image';
    await assert.rejects(h.ZN.settings.exportAll());
    assert.equal(h.S.get('note1').title, 'Keep my note');
  }
});

test('a backup with an unsupported future page type cannot silently drop that page', async () => {
  const h = await harness();
  const backup = { app: 'znote', pages: [book, original, { id: 'future', type: 'unknown-future-page', content: { keep: 'everything' } }] };
  await assert.rejects(h.ZN.settings.importData(backup, 'replace'), /unsupported page/);
  assert.equal(h.commits.length, 0); assert.equal(h.data.pages.get('note1').title, 'Keep my note');
});

test('merging a backup cannot bind receipts to an existing ordinary image with the same ID', async () => {
  const source = await harness(), rec = await seedBudget(source), backup = await source.ZN.settings.exportAll();
  const target = await harness();
  target.data.blobs.set(rec.id, { ...clone(rec), kind: 'image' });
  await assert.rejects(target.ZN.settings.importData(backup, 'merge'), /receipt is missing/);
  assert.equal(target.commits.length, 0); assert.equal(target.data.pages.has('budget1'), false);
});

test('permanent deletion preserves shared receipt references including duplicate pages in trash', async () => {
  const h = await harness(), rec = await seedBudget(h);
  const duplicate = h.S.duplicate('budget1');
  h.S.trash(duplicate.id);
  await h.S.purge('budget1');
  assert.equal(h.S.get('budget1'), undefined);
  assert.ok(h.S.get(duplicate.id).trashed); assert.ok(await h.S.getAttachment(rec.id));
  assert.equal(h.S.settings.tomb['i:' + rec.id], undefined);
  await h.S.purge(duplicate.id); await h.S.checkpoint();
  assert.equal(await h.S.getAttachment(rec.id), null);
  assert.ok(h.S.settings.tomb['i:' + rec.id]);
  assert.equal(h.data.meta.get('settings').tomb['i:' + rec.id], h.S.settings.tomb['i:' + rec.id]);
});

test('purging a notebook cleans its budget descendants without sweeping receipts retained for Undo', async () => {
  const h = await harness(), rec = await seedBudget(h);
  const undoReceipt = await h.S.addAttachment(pdf('Recently removed expense'));
  const ordinaryImage = await h.S.addImage(png());
  h.S.get('budget1').content.expenses[0].attachments.push(ordinaryImage.id);
  await h.S.purge('book1'); await h.S.flushDataWork();
  assert.equal(h.S.get('budget1'), undefined); assert.equal(await h.S.getAttachment(rec.id), null);
  assert.ok(await h.S.getAttachment(undoReceipt.id)); assert.ok(await h.S.getBlob(ordinaryImage.id));
  assert.equal(h.S.settings.tomb['i:' + undoReceipt.id], undefined);
  assert.equal(h.S.settings.tomb['i:' + ordinaryImage.id], undefined);
});

test('a live note picture reference also prevents receipt deletion when its budget is purged', async () => {
  const h = await harness(), rec = await seedBudget(h);
  h.S.get('note1').content.blocks.push({ id: 'imageBlock', t: 'img', src: rec.id });
  await h.S.purge('budget1');
  assert.ok(await h.S.getAttachment(rec.id)); assert.equal(h.S.settings.tomb['i:' + rec.id], undefined);
});

test('receipts survive a failed permanent page deletion so persisted pages stay complete', async () => {
  const options = {}, h = await harness(options), rec = await seedBudget(h);
  options.failPageDeletion = true;
  await assert.rejects(h.S.purge('budget1'), /deleted page could not be saved/);
  assert.ok(h.data.pages.has('budget1')); assert.ok(await h.S.getAttachment(rec.id));
  assert.equal(h.S.settings.tomb['i:' + rec.id], undefined);
});

test('failed atomic backup commit preserves current pages, files and source folder settings', async () => {
  const source = await harness(); await seedBudget(source); const backup = await source.ZN.settings.exportAll();
  const target = await harness({ failCommit: true }); target.data.meta.set('syncLocation', { handle: 'existing-folder', direct: true });
  await assert.rejects(target.ZN.settings.importData(backup, 'replace'), /Storage full/);
  assert.equal(target.data.pages.get('note1').title, 'Keep my note'); assert.equal(target.data.pages.has('budget1'), false);
  assert.deepEqual(target.data.meta.get('syncLocation'), { handle: 'existing-folder', direct: true });
});

async function openRestore(h, backup) {
  h.ZN.settings.open('data');
  const restoreButton = h.uiState.nodes.find(n => n.children.includes('Restore from a file…'));
  restoreButton.onclick();
  const input = h.uiState.nodes.find(n => n.selector === 'input' && n.type === 'file');
  input.files = [{ text: async () => JSON.stringify(backup) }];
  await input.listeners.change();
  h.uiState.modals.find(m => m.title === 'Restore this backup?').buttons.find(b => b.label === 'Replace my notebook').onClick();
}

test('restore keeps stale in-memory pages inert and folder sync paused until immediate reload', async () => {
  const source = await harness(); await seedBudget(source); const backup = await source.ZN.settings.exportAll();
  const gate = deferred(), h = await harness({ commitGate: gate.promise });
  let paused = 0, resumed = 0;
  h.ZN.sync = { pane() {}, async pause() { paused++; }, resume() { resumed++; } };
  await openRestore(h, backup); await settle();
  assert.equal(paused, 1); assert.equal(h.uiState.app.inert, true); assert.equal(h.uiState.reloads, 0);
  assert.equal(h.uiState.listeners.has('keydown'), true); assert.equal(h.data.pages.has('budget1'), false);
  gate.resolve(); await settle();
  assert.equal(h.data.pages.has('budget1'), true); assert.equal(h.uiState.reloads, 1);
  assert.equal(h.uiState.app.inert, true); assert.equal(resumed, 0);
  assert.equal(h.uiState.modals.at(-1).dismissable, false);
});

test('a restore failure unfreezes editing and resumes folder sync without replacing existing notes', async () => {
  const source = await harness(); await seedBudget(source); const backup = await source.ZN.settings.exportAll();
  const h = await harness({ failCommit: true });
  let paused = 0, resumed = 0;
  h.ZN.sync = { pane() {}, async pause() { paused++; }, resume() { resumed++; } };
  await openRestore(h, backup); await settle();
  assert.equal(paused, 1); assert.equal(resumed, 1); assert.equal(h.uiState.app.inert, false);
  assert.equal(h.uiState.listeners.size, 0); assert.equal(h.uiState.reloads, 0);
  assert.equal(h.data.pages.has('budget1'), false); assert.equal(h.data.pages.get('note1').title, 'Keep my note');
  assert.match(h.uiState.toasts.at(-1), /Restore failed: Storage full/);
});

test('temporary-memory sessions include receipt files in their backup', async () => {
  const h = await harness({ memoryOnly: true }); const rec = await seedBudget(h);
  const backup = await h.ZN.settings.exportAll();
  assert.equal(backup.images.length, 1); assert.equal(backup.images[0].kind, 'attachment');
  assert.equal(backup.images[0].id, rec.id); assert.match(backup.images[0].data, /^data:application\/pdf;base64,/);
});

test('two PCs sync PDF expenses through the existing notebook layout', async () => {
  const first = await harness(), rec = await seedBudget(first), shared = new Folder('Shared');
  assert.equal(await first.ZN.sync.attach(shared, { choice: 'merge' }), true);
  const root = await shared.getDirectoryHandle('Z Note notebook'), files = await root.getDirectoryHandle('images');
  assert.ok(files.children.has(rec.id + '.pdf'));
  const meta = JSON.parse(await (await files.getFileHandle(rec.id + '.json')).bytes.text());
  assert.equal(meta.kind, 'attachment'); assert.equal(meta.mime, 'application/pdf');
  const second = await harness();
  assert.equal(await second.ZN.sync.attach(shared, { choice: 'merge', existing: true }), true);
  assert.deepEqual(clone(second.S.get('budget1').content), expense([rec.id]));
  assert.equal(await (await second.S.getAttachment(rec.id)).blob.text(), await rec.blob.text());
  assert.equal(second.S.get('note1').title, 'Keep my note');
});

test('an incomplete shared receipt leaves the prior notebook and folder connection intact', async () => {
  const first = await harness(), rec = await seedBudget(first), shared = new Folder('Shared');
  await first.ZN.sync.attach(shared, { choice: 'merge' });
  const root = await shared.getDirectoryHandle('Z Note notebook'), files = await root.getDirectoryHandle('images');
  files.children.delete(rec.id + '.pdf');
  const second = await harness();
  await assert.rejects(second.ZN.sync.attach(shared, { existing: true, choice: 'merge' }), /receipt.*not finished downloading/);
  assert.equal(second.ZN.sync.dir, null); assert.equal(second.S.get('budget1'), undefined);
  assert.equal(second.S.get('note1').title, 'Keep my note'); assert.equal(second.commits.length, 0);
});

test('a missing receipt metadata record cannot silently open an incomplete budget', async () => {
  const first = await harness(), rec = await seedBudget(first), shared = new Folder('Shared');
  await first.ZN.sync.attach(shared, { choice: 'merge' });
  const files = await (await shared.getDirectoryHandle('Z Note notebook')).getDirectoryHandle('images');
  files.children.delete(rec.id + '.json');
  const second = await harness();
  await assert.rejects(second.ZN.sync.attach(shared, { existing: true, choice: 'merge' }), /receipt that is missing/);
  assert.equal(second.S.get('budget1'), undefined); assert.equal(second.commits.length, 0);
});

test('another PC cannot delete a receipt still referenced by a local budget or trashed duplicate', async () => {
  const first = await harness(), rec = await seedBudget(first), shared = new Folder('Shared');
  await first.ZN.sync.attach(shared, { choice: 'merge' });
  const second = await harness();
  await second.ZN.sync.attach(shared, { existing: true, choice: 'merge' });
  const duplicate = second.S.duplicate('budget1'); second.S.trash(duplicate.id);
  const root = await shared.getDirectoryHandle('Z Note notebook');
  const deleted = await root.getDirectoryHandle('deleted');
  deleted.children.set('i_' + rec.id + '_' + (Date.now() + 1000) + '.del', new FileHandle('receipt deletion'));
  const before = second.commits.length;
  assert.equal(await second.ZN.sync.run(), false);
  assert.match(second.ZN.sync.lastError, /receipt is missing or marked deleted/);
  assert.equal(second.commits.length, before);
  assert.ok(await second.S.getAttachment(rec.id)); assert.ok(second.S.get(duplicate.id).trashed);
  assert.equal(second.S.get('note1').title, 'Keep my note');
});

function receiptDeletion(h, rec) {
  const now = Date.now() + 1000;
  return { deletedPages: ['budget1'], deletedImages: [rec.id],
    tomb: { ['p:budget1']: now, ['i:' + rec.id]: now },
    expectedPages: Array.from(h.S.pages, ([id, page]) => [id, JSON.stringify(page)]), imageRevision: h.S.imageRevision() };
}

test('a budget edit during a held sync commit preserves both its page and receipt bytes', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise }), rec = await seedBudget(h);
  const applying = h.S.applySyncSnapshot(receiptDeletion(h, rec));
  await settle();
  h.S.get('budget1').content.expenses[0].description = 'Edited while syncing'; h.S.touch('budget1');
  gate.resolve(); await applying; await h.S.flush();
  assert.equal(h.S.get('budget1').content.expenses[0].description, 'Edited while syncing');
  assert.equal(h.data.pages.get('budget1').content.expenses[0].description, 'Edited while syncing');
  assert.equal(await (await h.S.getAttachment(rec.id)).blob.text(), await rec.blob.text());
});

test('a budget changed after preflight retains receipts when its stale page deletion is filtered', async () => {
  const h = await harness(), rec = await seedBudget(h), deletion = receiptDeletion(h, rec);
  h.S.get('budget1').content.expenses[0].description = 'Newer local expense'; h.S.touch('budget1'); await h.S.flush();
  await h.S.applySyncSnapshot(deletion);
  assert.equal(h.S.get('budget1').content.expenses[0].description, 'Newer local expense');
  assert.ok(await h.S.getAttachment(rec.id));
});

test('remote purge defers receipt deletion until a subsequent snapshot finds no remaining page', async () => {
  const h = await harness(), rec = await seedBudget(h);
  await h.S.applySyncSnapshot(receiptDeletion(h, rec));
  assert.equal(h.S.get('budget1'), undefined); assert.ok(await h.S.getAttachment(rec.id));
  await h.S.applySyncSnapshot(receiptDeletion(h, rec));
  assert.equal(await h.S.getAttachment(rec.id), null);
});

test('expense Undo and receipt deletion serialize so Undo cannot restore a missing file reference', async () => {
  const h = await harness(), rec = await h.S.addAttachment(pdf());
  const undo = h.S.withAttachments([rec.id], () => h.S.create(budgetPage([rec.id])));
  const removal = h.S.delBlob(rec.id, { unreferencedAttachment: true });
  await undo; await removal;
  assert.ok(h.S.get('budget1')); assert.ok(await h.S.getAttachment(rec.id));
  const other = await harness(), otherRec = await other.S.addAttachment(pdf());
  const deletingFirst = other.S.delBlob(otherRec.id, { unreferencedAttachment: true });
  const lateUndo = other.S.withAttachments([otherRec.id], () => other.S.create(budgetPage([otherRec.id])));
  await deletingFirst; await assert.rejects(lateUndo, /no longer available/);
  assert.equal(other.S.get('budget1'), undefined);
});
