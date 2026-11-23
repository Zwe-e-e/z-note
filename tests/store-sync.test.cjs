'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const clone = value => value === undefined ? undefined : structuredClone(value);
const notebook = { id: 'notebook1', type: 'notebook', title: 'Existing notebook', parentId: null, created: 10, updated: 10, mod: 10 };
const note = (id, title, content = { blocks: [] }) => ({ id, type: 'note', title, parentId: 'notebook1', content, created: 20, updated: 20, mod: 20 });
const photo = (id, text, mod = 20) => ({ id, mime: 'image/png', name: 'A photo', w: 10, h: 10, created: 10, mod, blob: new Blob([text], { type: 'image/png' }) });

function imageElement(id, alt = 'Photo caption') {
  const classes = new Set();
  return { dataset: { blob: id }, alt, src: '', isConnected: true,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    removeAttribute(name) { if (name === 'src') this.src = ''; }, getAttribute(name) { return this[name]; }, setAttribute(name, value) { this[name] = value; }
  };
}

async function harness(options = {}) {
  const data = {
    pages: new Map((options.pages || [notebook, note('localnote', 'My original text')]).map(value => [value.id, clone(value)])),
    blobs: new Map((options.images || []).map(value => [value.id, clone(value)])),
    meta: new Map([['settings', { name: 'Local display name', style: { paper: 'kraft' }, seeded: true, seedAt: 100, tomb: {}, recent: [], inboxId: null, ideasId: null }], ['syncLocation', { handle: 'unchanged folder', direct: true }]])
  };
  const calls = [], events = [], timers = new Map(), urls = new Map(), revoked = [], visibleImages = [];
  let nextId = 0, nextTimer = 0, nextURL = 0;
  const db = {
    async all(store) { return Array.from(data[store].values(), clone); },
    async get(store, key) { if (options.get) { const special = options.get(store, key, data); if (special !== undefined) return special; } return clone(data[store].get(key)); },
    async put(store, value, key = value.id) { data[store].set(key, clone(value)); },
    async del(store, key) { data[store].delete(key); },
    async clear(store) { data[store].clear(); },
    async batch(store, puts, dels) { for (const id of dels || []) data[store].delete(id); for (const value of puts || []) data[store].set(value.id, clone(value)); },
    async syncBatch(spec) {
      calls.push(clone(spec));
      if (options.commitGate) await options.commitGate;
      if (options.failCommit) throw new Error('Storage full');
      if (spec.replace) { data.pages.clear(); data.blobs.clear(); }
      for (const id of spec.deletedPages || []) data.pages.delete(id);
      for (const value of spec.pages || []) data.pages.set(value.id, clone(value));
      for (const id of spec.deletedImages || []) data.blobs.delete(id);
      for (const value of spec.images || []) data.blobs.set(value.id, clone(value));
      if (spec.settings) data.meta.set('settings', clone(spec.settings));
    }
  };
  const ZN = { db, util: { uid: () => 'fixture' + ++nextId, imageSize: async blob => options.imageSize ? options.imageSize(blob) : ({ w: 10, h: 10 }) } };
  const context = { ZN, console: { error() {} }, navigator: {}, Blob,
    document: { addEventListener() {}, querySelectorAll() { return visibleImages; } }, addEventListener() {},
    URL: { createObjectURL(blob) { const url = 'blob:fixture-' + ++nextURL; urls.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(key) { timers.delete(key); }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), context);
  await ZN.store.init();
  for (const name of ['tree', 'content', 'external', 'blobs']) ZN.store.on(name, value => events.push({ name, value }));
  return { S: ZN.store, data, calls, events, visibleImages, urls, revoked };
}

test('remote text and referenced photos become visible only after their complete snapshot commits', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise });
  const selected = note('remotenote', 'From the chosen folder', { blocks: [
    { id: 'textblock', t: 'p', html: '<strong>Existing text</strong> with မြန်မာ' },
    { id: 'photoblock', t: 'image', src: 'remoteimage', cap: 'Original photo caption' }
  ] });
  let pictureAtRender;
  h.S.on('external', () => { pictureAtRender = h.data.blobs.get('remoteimage'); });
  const saving = h.S.applySyncSnapshot({ pages: [selected], images: [photo('remoteimage', 'image bytes')], tomb: { 'p:olddeleted': 15 } });
  await settle();
  assert.equal(h.S.get('remotenote'), undefined); assert.equal(h.events.length, 0);
  assert.equal(h.S.settings.tomb['p:olddeleted'], undefined);
  gate.resolve(); await saving;
  assert.equal(h.S.get('remotenote').content.blocks[0].html, '<strong>Existing text</strong> with မြန်မာ');
  assert.equal(h.S.get('remotenote').content.blocks[1].src, 'remoteimage');
  assert.equal(await pictureAtRender.blob.text(), 'image bytes');
  assert.equal(h.data.meta.get('settings').tomb['p:olddeleted'], 15);
  assert.equal(h.S.settings.tomb['p:olddeleted'], 15);
  assert.equal(h.S.get('localnote').title, 'My original text');
});

test('failed snapshot storage leaves notes, pictures, settings and visible view untouched', async () => {
  const h = await harness({ failCommit: true, images: [photo('oldimage', 'keep this photo')] });
  const settings = clone(h.S.settings);
  await assert.rejects(h.S.applySyncSnapshot({ replace: true, pages: [notebook, note('replacement', 'New text')], images: [photo('newimage', 'new photo')], tomb: { 'p:old': 5 } }), /Storage full/);
  assert.equal(h.S.get('localnote').title, 'My original text'); assert.equal(h.S.get('replacement'), undefined);
  assert.equal(await (await h.S.getBlob('oldimage')).blob.text(), 'keep this photo');
  assert.deepEqual(clone(h.S.settings), settings); assert.equal(h.events.length, 0);
  assert.deepEqual(h.data.meta.get('syncLocation'), { handle: 'unchanged folder', direct: true });
});

test('pulling another PC cannot overwrite or delete a locally edited page', async () => {
  const h = await harness(); h.S.update('localnote', { title: 'Unfinished local change' });
  h.events.length = 0;
  await h.S.applySyncSnapshot({ pages: [note('localnote', 'Remote title'), note('newnote', 'New remote page')], deletedPages: ['localnote'], images: [] });
  assert.equal(h.S.get('localnote').title, 'Unfinished local change');
  assert.equal(h.S.get('newnote').title, 'New remote page');
  assert.equal(h.calls[0].pages.some(p => p.id === 'localnote'), false);
  assert.equal((h.calls[0].deletedPages || []).includes('localnote'), false);
});

test('a local edit that autosaves during the remote commit still wins in the live editor', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise });
  const loading = h.S.applySyncSnapshot({ pages: [Object.assign(note('localnote', 'Remote version'), { mod: 30 })], images: [] });
  await settle();
  h.S.update('localnote', { title: 'Typed while pictures were saving' });
  await h.S.flush(); assert.equal(h.S.isDirty('localnote'), false);
  gate.resolve(); await loading;
  assert.equal(h.S.get('localnote').title, 'Typed while pictures were saving');
  assert.equal(h.S.isDirty('localnote'), true);
  await h.S.flush();
  assert.equal(h.data.pages.get('localnote').title, 'Typed while pictures were saving');
});

test('replacement preserves edits started while its database transaction was committing', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise });
  const loading = h.S.applySyncSnapshot({ replace: true, pages: [notebook, note('selectednote', 'Selected content')], images: [], tomb: {} });
  await settle();
  h.S.update('localnote', { title: 'Do not erase this new edit' }); await h.S.flush();
  const created = h.S.create({ type: 'note', parentId: 'notebook1', title: 'Created while opening' }); await h.S.flush();
  gate.resolve(); await loading;
  assert.equal(h.S.get('localnote').title, 'Do not erase this new edit');
  assert.equal(h.S.get(created.id).title, 'Created while opening');
  assert.equal(h.S.get('selectednote').title, 'Selected content');
  await h.S.flush();
  assert.equal(h.data.pages.get(created.id).title, 'Created while opening');
});

test('a complete replacement removes starter pages and pictures while retaining appearance and folder settings', async () => {
  const h = await harness({ images: [photo('starterimage', 'starter picture')] });
  await h.S.applySyncSnapshot({ replace: true, pages: [notebook, note('selectednote', 'Selected text')], images: [photo('selectedimage', 'selected photo')], tomb: {} });
  assert.equal(h.S.get('localnote'), undefined); assert.equal(h.S.get('selectednote').title, 'Selected text');
  assert.equal(await h.S.getBlob('starterimage'), null);
  assert.equal(await (await h.S.getBlob('selectedimage')).blob.text(), 'selected photo');
  assert.equal(h.S.settings.style.paper, 'kraft'); assert.equal(h.S.settings.name, 'Local display name');
  assert.equal(h.S.settings.seedAt, 0); assert.equal(h.data.meta.get('syncLocation').handle, 'unchanged folder');
});

test('a photo-only pull refreshes an already visible image without rebuilding note text', async () => {
  const h = await harness({ images: [photo('picture1', 'old bytes')] });
  const img = imageElement('picture1'); h.visibleImages.push(img);
  h.S.setImg(img, 'picture1'); await settle(); const oldURL = img.src;
  await h.S.applySyncSnapshot({ pages: [], images: [photo('picture1', 'new bytes', 30)] }); await settle();
  assert.notEqual(img.src, oldURL); assert.equal(await h.urls.get(img.src).text(), 'new bytes');
  assert.equal(h.revoked.includes(oldURL), true); assert.equal(img.alt, 'Photo caption');
  assert.equal(h.S.get('localnote').title, 'My original text');
});

test('a picture that arrives after its missing placeholder appears is displayed automatically', async () => {
  const h = await harness(); const img = imageElement('picture1', 'My original caption'); h.visibleImages.push(img);
  h.S.setImg(img, 'picture1'); await settle(); assert.equal(img.classList.contains('missing'), true);
  await h.S.putBlobRecord(photo('picture1', 'now downloaded')); await settle();
  assert.equal(img.classList.contains('missing'), false); assert.equal(await h.urls.get(img.src).text(), 'now downloaded');
  assert.equal(img.alt, 'My original caption');
});

test('an older asynchronous image read cannot replace newer synchronized photo bytes', async () => {
  const oldRead = deferred(); let intercepted = false;
  const h = await harness({ images: [photo('picture1', 'old bytes')], get(store, id) {
    if (store === 'blobs' && id === 'picture1' && !intercepted) { intercepted = true; return oldRead.promise; }
  } });
  const img = imageElement('picture1'); h.visibleImages.push(img); h.S.setImg(img, 'picture1');
  await h.S.putBlobRecord(photo('picture1', 'new bytes', 30)); await settle();
  oldRead.resolve(photo('picture1', 'old bytes')); await settle();
  assert.equal(await h.urls.get(img.src).text(), 'new bytes');
});

test('a local photo edit during folder preflight prevents its stale snapshot from overwriting storage', async () => {
  const h = await harness({ images: [photo('picture1', 'original bytes')] });
  const sampledRevision = h.S.imageRevision();
  await h.S.updateBlob('picture1', { blob: new Blob(['local edited bytes'], { type: 'image/png' }), name: 'Edited locally' });
  await assert.rejects(h.S.applySyncSnapshot({ imageRevision: sampledRevision, pages: [note('remotenote', 'Do not publish partial load')], images: [photo('picture1', 'older folder bytes', 30)] }), /picture changed/);
  assert.equal(h.calls.length, 0); assert.equal(h.S.get('remotenote'), undefined);
  assert.equal(await h.data.blobs.get('picture1').blob.text(), 'local edited bytes');
  assert.equal((await h.S.getBlob('picture1')).name, 'Edited locally');
});

test('a photo deleted during folder preflight cannot be resurrected by the old incoming plan', async () => {
  const h = await harness({ images: [photo('picture1', 'old photo')] });
  const sampledRevision = h.S.imageRevision(); await h.S.delBlob('picture1');
  await assert.rejects(h.S.applySyncSnapshot({ imageRevision: sampledRevision, pages: [], images: [photo('picture1', 'old photo')], tomb: {} }), /picture changed/);
  assert.equal(h.calls.length, 0); assert.equal(h.data.blobs.has('picture1'), false);
  assert.equal(typeof h.S.settings.tomb['i:picture1'], 'number');
});

test('a same-ID photo edit started during a remote transaction commits after it in storage and the view', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise, images: [photo('picture1', 'original')] });
  const img = imageElement('picture1'); h.visibleImages.push(img); h.S.setImg(img, 'picture1'); await settle();
  const loading = h.S.applySyncSnapshot({ imageRevision: h.S.imageRevision(), pages: [], images: [photo('picture1', 'remote version', 30)] });
  await settle();
  let localFinished = false;
  const editing = h.S.updateBlob('picture1', { blob: new Blob(['latest local photo'], { type: 'image/png' }), name: 'Local edit' }).then(value => { localFinished = true; return value; });
  await settle();
  assert.equal(localFinished, false); assert.equal(await h.data.blobs.get('picture1').blob.text(), 'original');
  gate.resolve(); await Promise.all([loading, editing]); await settle();
  assert.equal(await h.data.blobs.get('picture1').blob.text(), 'latest local photo');
  assert.equal(await (await h.S.getBlob('picture1')).blob.text(), 'latest local photo');
  assert.equal(await h.urls.get(img.src).text(), 'latest local photo');
  assert.equal(h.data.blobs.get('picture1').name, 'Local edit');
});

test('a local photo deletion started during remote commit remains deleted after both operations settle', async () => {
  const gate = deferred(), h = await harness({ commitGate: gate.promise, images: [photo('picture1', 'original')] });
  const loading = h.S.applySyncSnapshot({ imageRevision: h.S.imageRevision(), pages: [], images: [photo('picture1', 'remote version', 30)], tomb: {} });
  await settle(); const deleting = h.S.delBlob('picture1');
  gate.resolve(); await Promise.all([loading, deleting]);
  assert.equal(h.data.blobs.has('picture1'), false); assert.equal(await h.S.getBlob('picture1'), null);
  assert.equal(typeof h.S.settings.tomb['i:picture1'], 'number');
});

test('adoption refuses pending image decoding before writing or replacing the notebook', async () => {
  const decoding = deferred(), h = await harness({ imageSize: () => decoding.promise });
  const adding = h.S.addImage(new Blob(['user photo'], { type: 'image/png' }));
  await assert.rejects(h.S.applySyncSnapshot({ replace: true, pages: [notebook, note('selectednote', 'Selected')], images: [], tomb: {} }), /Pictures are still being saved/);
  assert.equal(h.calls.length, 0); assert.equal(h.S.get('localnote').title, 'My original text');
  decoding.resolve({ w: 12, h: 20 }); const image = await adding;
  assert.equal(await h.data.blobs.get(image.id).blob.text(), 'user photo');
});

test('an autosaved local edit made during folder preflight cannot be replaced by its stale page plan', async () => {
  const h = await harness();
  const expectedPages = Array.from(h.S.pages, ([id, page]) => [id, JSON.stringify(page)]);
  const remote = Object.assign(note('localnote', 'Older folder text'), { mod: Date.now() + 864e5 });
  h.S.update('localnote', { title: 'Latest local text' }); await h.S.flush();
  assert.equal(h.S.isDirty('localnote'), false);
  await h.S.applySyncSnapshot({ expectedPages, pages: [remote], images: [] });
  assert.equal(h.calls[0].pages.length, 0);
  assert.equal(h.S.get('localnote').title, 'Latest local text');
  assert.equal(h.data.pages.get('localnote').title, 'Latest local text');
});

test('incoming page versions and deletion markers are rechecked against saved local changes', async () => {
  const h = await harness();
  h.S.update('localnote', { title: 'Autosaved after file scanning' }); await h.S.flush();
  await h.S.applySyncSnapshot({ pages: [note('localnote', 'Old folder text')], deletedPages: ['localnote'], images: [], tomb: { 'p:localnote': 30 } });
  assert.equal(h.calls[0].pages.length, 0); assert.equal(h.calls[0].deletedPages.length, 0);
  assert.equal(h.S.get('localnote').title, 'Autosaved after file scanning');
  assert.equal(h.data.pages.get('localnote').title, 'Autosaved after file scanning');
});

test('a permanent local deletion during preflight remains deleted and keeps its persisted marker', async () => {
  const h = await harness();
  const expectedPages = Array.from(h.S.pages, ([id, page]) => [id, JSON.stringify(page)]), expectedTomb = clone(h.S.settings.tomb);
  h.S.purge('localnote'); await h.S.flush(); const deletedAt = h.S.settings.tomb['p:localnote'];
  await h.S.applySyncSnapshot({ expectedPages, expectedTomb, pages: [Object.assign(note('localnote', 'Stale deleted text'), { mod: Date.now() + 864e5 })], images: [], tomb: {} });
  assert.equal(h.S.get('localnote'), undefined); assert.equal(h.data.pages.has('localnote'), false);
  assert.equal(h.S.settings.tomb['p:localnote'], deletedAt); assert.equal(h.data.meta.get('settings').tomb['p:localnote'], deletedAt);
});

test('a local page created after preflight is not overwritten by a colliding incoming ID', async () => {
  const h = await harness(); const expectedPages = Array.from(h.S.pages, ([id, page]) => [id, JSON.stringify(page)]);
  h.S.create({ id: 'newpage', type: 'note', parentId: 'notebook1', title: 'New local page' }); await h.S.flush();
  await h.S.applySyncSnapshot({ expectedPages, pages: [Object.assign(note('newpage', 'Remote collision'), { mod: Date.now() + 864e5 })], images: [] });
  assert.equal(h.S.get('newpage').title, 'New local page'); assert.equal(h.data.pages.get('newpage').title, 'New local page');
});

test('unchanged expired deletion markers can be removed by the folder plan', async () => {
  const h = await harness(); h.S.settings.tomb = { 'p:expiredpage': 1 };
  await h.S.applySyncSnapshot({ expectedTomb: { 'p:expiredpage': 1 }, pages: [], images: [], tomb: {} });
  assert.equal(h.S.settings.tomb['p:expiredpage'], undefined); assert.equal(h.data.meta.get('settings').tomb['p:expiredpage'], undefined);
});
