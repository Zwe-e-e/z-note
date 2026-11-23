'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const calls = [], downloads = [], messages = [];
  const page = { id: 'board1', type: 'board', title: 'My board', content: { items: [{ id: 'text1', text: 'old text' }] } };
  const settings = { name: 'Notebook owner', style: { paper: 'cream' } };
  const blobs = options.blobs || [{ id: 'image1', blob: new Blob(['image bytes'], { type: 'image/png' }), mime: 'image/png', name: 'Picture', kind: 'image', w: 10, h: 20, created: 100 }];
  const S = {
    pages: new Map([[page.id, page]]), settings, memoryOnly: !!options.memoryOnly,
    async flush() { calls.push('flush'); },
    async listBlobs() { calls.push('listBlobs'); return blobs; },
    setSetting(key, value) { settings[key] = value; }
  };
  const ZN = {
    store: S,
    db: {
      async all(store) {
        calls.push('read:' + store);
        if (options.readError) throw options.readError;
        return blobs;
      }
    },
    ui: { toast(message) { messages.push(message); } },
    util: {
      async blobToDataURL(blob) {
        calls.push('encode');
        if (options.encode) return options.encode(blob);
        return 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
      },
      ymd() { return '2026-11-23'; },
      download(blob, name) { downloads.push({ blob, name }); }
    }
  };
  if (options.prepareExport) ZN.shell = { view: () => ({ prepareExport: () => options.prepareExport({ page, settings, calls }) }) };
  const context = vm.createContext({ window: { ZN }, Blob, setTimeout, clearTimeout, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js/settings.js'), 'utf8'), context);
  return { ZN, S, page, settings, calls, downloads, messages };
}

test('backup commits the current view before flushing and serializing its notes', async () => {
  const ready = deferred();
  const h = harness({ async prepareExport({ page, calls }) {
    calls.push('prepare');
    await ready.promise;
    page.content.items[0].text = 'latest text still being edited';
    calls.push('prepared');
  } });
  const pending = h.ZN.settings.exportAll();
  assert.deepEqual(h.calls, ['prepare']);
  ready.resolve();
  const backup = await pending;
  assert.equal(backup.pages[0].content.items[0].text, 'latest text still being edited');
  assert.deepEqual(h.calls, ['prepare', 'prepared', 'flush', 'read:blobs', 'encode']);
});

test('backup includes image data and the existing backup format', async () => {
  const h = harness();
  const backup = await h.ZN.settings.exportAll();
  assert.equal(backup.app, 'znote');
  assert.equal(backup.version, 1);
  assert.equal(backup.pages.length, 1);
  assert.equal(backup.images.length, 1);
  assert.equal(backup.images[0].data, 'data:image/png;base64,aW1hZ2UgYnl0ZXM=');
  assert.equal(backup.images[0].name, 'Picture');
  assert.equal(backup.images[0].w, 10);
  assert.equal(backup.images[0].h, 20);
  assert.equal(h.calls.includes('listBlobs'), false);
});

test('image storage failure rejects backup without downloading or changing notes', async () => {
  const error = new Error('Image storage unavailable');
  const h = harness({ readError: error });
  const before = JSON.stringify({ page: h.page, settings: h.settings });
  await assert.rejects(h.ZN.settings.download(), error);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.messages.length, 0);
  assert.equal(JSON.stringify({ page: h.page, settings: h.settings }), before);
});

test('backup has detached snapshots while image encoding is in progress', async () => {
  const started = deferred(), encoded = deferred();
  const h = harness({ encode() { started.resolve(); return encoded.promise; } });
  const pending = h.ZN.settings.exportAll();
  await started.promise;
  h.page.content.items[0].text = 'edited after the snapshot';
  h.settings.style.paper = 'night';
  encoded.resolve('data:image/png;base64,AA==');
  const backup = await pending;
  assert.equal(backup.pages[0].content.items[0].text, 'old text');
  assert.equal(backup.settings.style.paper, 'cream');
  backup.pages[0].title = 'Changed backup';
  backup.settings.name = 'Changed backup name';
  assert.equal(h.page.title, 'My board');
  assert.equal(h.settings.name, 'Notebook owner');
});

test('temporary sessions export their in-memory images without reading IndexedDB', async () => {
  const h = harness({ memoryOnly: true, readError: new Error('Blocked storage') });
  const backup = await h.ZN.settings.exportAll();
  assert.equal(backup.images.length, 1);
  assert.deepEqual(h.calls, ['flush', 'listBlobs', 'encode']);
});

test('download returns its filename and reports that saving still needs confirmation', async () => {
  const h = harness();
  const filename = await h.ZN.settings.download();
  assert.equal(filename, 'Z Note backup 2026-11-23.json');
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].name, filename);
  assert.equal(JSON.parse(await h.downloads[0].blob.text()).pages[0].title, 'My board');
  assert.match(h.messages[0], /download started/i);
  assert.match(h.messages[0], /Check that the file has finished saving/);
  assert.doesNotMatch(h.messages[0], /Backup saved/i);
});

test('image conversion failure prevents an incomplete download', async () => {
  const h = harness({ async encode() { throw new Error('Unreadable image'); } });
  await assert.rejects(h.ZN.settings.download(), /Unreadable image/);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.settings.backupAt, undefined);
});
