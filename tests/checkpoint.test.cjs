'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(o = {}) {
  const calls = [], timers = new Map(); let id = 0;
  const db = {
    batch: async (...args) => { calls.push(['batch', ...args]); if (o.batch) await o.batch(); },
    put: async (...args) => { calls.push(['put', ...args]); if (o.put) await o.put(...args); },
    del: async (...args) => { calls.push(['del', ...args]); if (o.del) await o.del(...args); },
    get: async (...args) => o.get ? o.get(...args) : undefined,
    all: async () => { if (o.blocked) throw new Error('Storage blocked'); return []; }
  };
  let nextId = 0;
  const ZN = { db, util: { uid: () => 'fixture' + ++nextId, imageSize: async blob => o.imageSize ? o.imageSize(blob) : { w: 10, h: 10 } } };
  const context = { ZN, console: { error() {} }, navigator: {}, document: { addEventListener() {} },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(n) { timers.delete(n); }, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), context);
  return { store: ZN.store, calls, timers };
}
test('checkpoint waits for already-running page writes before persisting settings', async () => {
  const work = deferred(); const t = harness({ batch: () => work.promise });
  t.store.create({ type: 'note', title: 'Latest note' });
  const autosave = t.store.flush();
  let done = false; const checkpoint = t.store.checkpoint().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); assert.equal(t.calls.filter(x => x[0] === 'put').length, 0);
  work.resolve(); await autosave; await checkpoint;
  assert.equal(done, true); assert.equal(t.calls.at(-1)[1], 'meta'); assert.equal(t.calls.at(-1)[3], 'settings');
});
test('checkpoint refuses failed page persistence even though normal autosave reports instead of rejecting', async () => {
  const t = harness({ batch: async () => { throw new Error('Disk full'); } });
  t.store.create({ type: 'note', title: 'Do not lose this' });
  await assert.rejects(t.store.checkpoint(), /could not be saved/);
  assert.equal(t.store.hasUnsaved(), true); assert.equal(t.store.pages.size, 1);
});
test('checkpoint propagates settings failures and does not modify source-folder metadata', async () => {
  const t = harness({ put: async () => { throw new Error('Settings write failed'); } });
  await assert.rejects(t.store.checkpoint(), /Settings write failed/);
  assert.equal(t.calls.length, 1); assert.equal(t.calls[0][3], 'settings');
});
test('checkpoint saves a detached settings copy before delayed settings timers can be lost', async () => {
  const t = harness(); t.store.setSetting('name', 'My notebook');
  await t.store.checkpoint(); t.store.settings.name = 'Changed later';
  assert.equal(t.calls.at(-1)[2].name, 'My notebook'); assert.equal(t.timers.size, 0);
});
test('temporary storage cannot be treated as a durable automatic-update checkpoint', async () => {
  const t = harness({ blocked: true }); await t.store.init();
  assert.equal(t.store.memoryOnly, true);
  await assert.rejects(t.store.checkpoint(), /temporary session/);
});

test('checkpoint waits for image decoding, saving and the caller inserting its page', async () => {
  const decoding = deferred(), saving = deferred();
  const t = harness({ imageSize: () => decoding.promise, put: store => store === 'blobs' ? saving.promise : undefined });
  const image = t.store.addImage({ type: 'image/png', size: 5 }).then(rec => {
    t.store.create({ type: 'note', title: 'Picture page', content: { blocks: [{ id: 'imageblock', t: 'img', blob: rec.id }] } });
  });
  let done = false; const checkpoint = t.store.checkpoint().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); assert.equal(t.calls.length, 0);
  decoding.resolve({ w: 20, h: 30 }); await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false); assert.equal(t.calls.some(x => x[0] === 'batch'), false);
  saving.resolve(); await image; await checkpoint;
  const batch = t.calls.find(x => x[0] === 'batch');
  assert.equal(batch[2][0].title, 'Picture page');
  assert.equal(batch[2][0].content.blocks[0].blob, 'fixture2');
  assert.equal(t.calls.at(-1)[1], 'meta');
});

test('checkpoint drains another image operation queued by a completed operation', async () => {
  const first = deferred(), second = deferred();
  const t = harness({ put: (store, record) => store === 'blobs' ? (record.id === 'first' ? first.promise : second.promise) : undefined });
  const adding = t.store.putBlobRecord({ id: 'first' }).then(() => t.store.putBlobRecord({ id: 'second' }));
  let done = false; const checkpoint = t.store.checkpoint().then(() => { done = true; });
  first.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false); assert.equal(t.calls.some(x => x[1] === 'meta'), false);
  second.resolve(); await adding; await checkpoint;
  assert.equal(t.calls.filter(x => x[1] === 'blobs').length, 2);
  assert.equal(t.calls.at(-1)[1], 'meta');
});

test('checkpoint waits for picture deletion and persists its completed tombstone', async () => {
  const deleting = deferred(), t = harness({ del: () => deleting.promise });
  const operation = t.store.delBlob('picture1');
  let done = false; const checkpoint = t.store.checkpoint().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); assert.equal(t.calls.some(x => x[1] === 'meta'), false);
  deleting.resolve(); await operation; await checkpoint;
  assert.equal(typeof t.calls.at(-1)[2].tomb['i:picture1'], 'number');
});

test('checkpoint tracks picture updates from reading through their final write', async () => {
  const reading = deferred(), saving = deferred();
  const t = harness({ get: () => reading.promise, put: store => store === 'blobs' ? saving.promise : undefined });
  const operation = t.store.updateBlob('picture1', { name: 'Renamed' });
  let done = false; const checkpoint = t.store.checkpoint().then(() => { done = true; });
  await Promise.resolve(); assert.equal(t.calls.length, 0); assert.equal(done, false);
  reading.resolve({ id: 'picture1', name: 'Before' }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false); assert.equal(t.calls.some(x => x[1] === 'meta'), false);
  saving.resolve(); await operation; await checkpoint;
  assert.equal(t.calls.find(x => x[1] === 'blobs')[2].name, 'Renamed');
});

test('a pending picture write failure prevents a successful update checkpoint', async () => {
  const saving = deferred(), t = harness({ put: store => store === 'blobs' ? saving.promise : undefined });
  const operation = assert.rejects(t.store.putBlobRecord({ id: 'picture1' }), /Picture write failed/);
  const checkpoint = assert.rejects(t.store.checkpoint(), /Picture write failed/);
  saving.reject(new Error('Picture write failed'));
  await Promise.all([operation, checkpoint]);
  assert.equal(t.calls.some(x => x[1] === 'meta'), false);
});
