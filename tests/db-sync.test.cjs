'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const clone = value => structuredClone(value);

function harness(options = {}) {
  const data = {
    pages: new Map([['oldnote', { id: 'oldnote', title: 'Existing private note' }]]),
    blobs: new Map([['oldimage', { id: 'oldimage', blob: new Blob(['old photo']) }]]),
    meta: new Map([['settings', { name: 'Keep my name', tomb: {} }], ['syncLocation', { handle: 'unchanged source folder', direct: true }]])
  };
  const transactions = [];
  const database = {
    objectStoreNames: { contains: name => name in data }, close() {},
    transaction(names, mode) {
      const stores = Array.isArray(names) ? Array.from(names) : [names];
      const staged = Object.fromEntries(stores.map(name => [name, new Map(Array.from(data[name], ([key, value]) => [key, clone(value)]))]));
      let aborted = false;
      const tx = {
        stores, mode, error: null,
        objectStore(name) {
          if (!stores.includes(name)) throw new Error('Store was not included in this transaction');
          return {
            clear() { staged[name].clear(); },
            delete(key) { staged[name].delete(key); },
            put(value, key = value.id) {
              if (options.failPut === name) throw new Error('Picture storage failed');
              staged[name].set(key, clone(value)); return {};
            }
          };
        },
        abort() { aborted = true; queueMicrotask(() => { if (tx.onabort) tx.onabort(); }); }
      };
      transactions.push(tx);
      queueMicrotask(async () => {
        if (options.commitGate) await options.commitGate;
        if (aborted) return;
        if (options.failCommit) {
          tx.error = new Error('Storage transaction aborted');
          if (tx.onabort) tx.onabort(); return;
        }
        for (const name of stores) data[name] = staged[name];
        if (tx.oncomplete) tx.oncomplete();
      });
      return tx;
    }
  };
  const indexedDB = { open() { const request = { result: database }; queueMicrotask(() => request.onsuccess()); return request; } };
  const context = { ZN: {}, indexedDB }; context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/db.js'), 'utf8'), context);
  return { db: context.ZN.db, data, transactions };
}

test('folder pages, photos and tombstones commit together and preserve source-folder metadata', async () => {
  const gate = deferred(), h = harness({ commitGate: gate.promise });
  const saving = h.db.syncBatch({
    pages: [{ id: 'newnote', content: { blocks: [{ id: 'photo', t: 'image', src: 'newimage' }] } }], deletedPages: ['oldnote'],
    images: [{ id: 'newimage', blob: new Blob(['new photo']) }], deletedImages: ['oldimage'],
    settings: { name: 'Keep my name', tomb: { 'p:oldnote': 2000 } }
  });
  let committed = false; saving.then(() => { committed = true; });
  await settle();
  assert.equal(committed, false); assert.equal(h.transactions.length, 1);
  assert.deepEqual([...h.transactions[0].stores].sort(), ['blobs', 'meta', 'pages']);
  assert.equal(h.transactions[0].mode, 'readwrite');
  assert.equal(h.data.pages.has('oldnote'), true); assert.equal(h.data.blobs.has('newimage'), false);
  gate.resolve(); await saving;
  assert.equal(h.data.pages.has('oldnote'), false); assert.equal(h.data.pages.has('newnote'), true);
  assert.equal(await h.data.blobs.get('newimage').blob.text(), 'new photo'); assert.equal(h.data.blobs.has('oldimage'), false);
  assert.equal(h.data.meta.get('settings').tomb['p:oldnote'], 2000);
  assert.deepEqual(h.data.meta.get('syncLocation'), { handle: 'unchanged source folder', direct: true });
});

test('a photo-write failure cannot leave new pages or cleared notebook data committed', async () => {
  const h = harness({ failPut: 'blobs' });
  await assert.rejects(h.db.syncBatch({ replace: true, pages: [{ id: 'newnote' }], images: [{ id: 'newimage' }], settings: { tomb: {} } }), /Picture storage failed/);
  await settle();
  assert.deepEqual([...h.data.pages.keys()], ['oldnote']); assert.deepEqual([...h.data.blobs.keys()], ['oldimage']);
  assert.equal(h.data.meta.get('settings').name, 'Keep my name');
  assert.equal(h.transactions.length, 1);
});

test('a transaction abort preserves the previous complete notebook', async () => {
  const h = harness({ failCommit: true });
  await assert.rejects(h.db.syncBatch({ replace: true, pages: [{ id: 'newnote' }], images: [{ id: 'newimage' }] }), /aborted/);
  assert.deepEqual([...h.data.pages.keys()], ['oldnote']); assert.deepEqual([...h.data.blobs.keys()], ['oldimage']);
});

test('replacement clears old pages and photos in the same transaction', async () => {
  const h = harness();
  await h.db.syncBatch({ replace: true, pages: [{ id: 'selectednote' }], images: [{ id: 'selectedimage', blob: new Blob(['selected']) }] });
  assert.deepEqual([...h.data.pages.keys()], ['selectednote']); assert.deepEqual([...h.data.blobs.keys()], ['selectedimage']);
  assert.equal(h.data.meta.get('syncLocation').direct, true);
});
