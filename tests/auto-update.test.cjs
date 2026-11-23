'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function deferred() { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; }
function harness(o = {}) {
  const calls = [], app = { inert: false }, panel = { inert: false }, unload = new Map(), modals = [];
  const h = (selector, props, ...children) => {
    if (props == null) props = {}; else if (typeof props !== 'object' || props.selector || Array.isArray(props)) { children.unshift(props); props = {}; }
    return Object.assign({ selector, children, append(...els) { this.children.push(...els); } }, props);
  };
  const ZN = { version: '2.4.0', util: { h }, ui: { modal(options) { const modal = { ...options, close() {} }; modals.push(modal); return modal; } },
    store: { memoryOnly: !!o.memoryOnly, otherWindowsOpen: async () => !!o.otherWindow,
      async checkpoint() { calls.push('checkpoint'); if (o.storageError) throw new Error('Disk full'); } },
    sync: { async pause() { calls.push('pause'); }, resume() { calls.push('resume'); } },
    shell: { view: () => ({ prepareExport() { calls.push('edits'); } }) },
    settings: { async exportAll() { calls.push('export'); if (o.exportError) throw new Error('Cannot read picture'); return { app: 'znote', version: 1, pages: [{ id: 'note1' }], images: [] }; } },
    updateNative: { available: true, async connect() { calls.push('connect'); }, state: () => ({ backupPath: 'C:\\Backups\\recovery.json' }),
      async install(data, version, progress) {
        calls.push(['install', data, version]);
        assert.equal(app.inert, true); assert.equal(panel.inert, true);
        progress({ stage: 'backup-saved', backupPath: 'C:\\Backups\\recovery.json' });
        if (o.installWait) await o.installWait;
        if (o.installError) throw new Error('Verification failed');
        return { version, backupPath: 'C:\\Backups\\recovery.json' };
      }
    }
  };
  const context = { ZN, document: { querySelectorAll: () => [app, panel] },
    addEventListener: (name, fn) => unload.set(name, fn), removeEventListener: name => unload.delete(name),
    location: { reload() { calls.push('reload'); } } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/updates.js'), 'utf8'), context);
  return { updates: ZN.updates, calls, app, panel, unload, modals };
}
test('automatic update freezes editing, checkpoints and backs up before installing, then reloads only after success', async () => {
  const gate = deferred(), t = harness({ installWait: gate.promise });
  const task = t.updates.installAutomatically({ version: '2.5.0' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.calls.includes('reload'), false); assert.equal(t.app.inert, true);
  const install = t.calls.find(x => Array.isArray(x)); assert.equal(install[1].pages[0].id, 'note1');
  gate.resolve(); await task;
  assert.deepEqual(t.calls.filter(x => typeof x === 'string'), ['connect', 'pause', 'edits', 'checkpoint', 'export', 'checkpoint', 'reload']);
  assert.equal(t.unload.size, 0);
});
test('failed storage or image export blocks installation and restores editing/sync', async () => {
  for (const option of [{ storageError: true }, { exportError: true }]) {
    const t = harness(option); await t.updates.installAutomatically({ version: '2.5.0' });
    assert.equal(t.calls.some(x => Array.isArray(x)), false); assert.equal(t.calls.includes('reload'), false);
    assert.equal(t.app.inert, false); assert.equal(t.panel.inert, false); assert.equal(t.calls.at(-1), 'resume');
  }
});
test('failed native verification cannot reload or discard the live notebook', async () => {
  const t = harness({ installError: true }); await t.updates.installAutomatically({ version: '2.5.0' });
  assert.equal(t.calls.includes('reload'), false); assert.equal(t.app.inert, false); assert.equal(t.calls.at(-1), 'resume');
});
test('temporary sessions and other open windows block automatic installation', async () => {
  for (const option of [{ memoryOnly: true }, { otherWindow: true }]) {
    const t = harness(option); await t.updates.installAutomatically({ version: '2.5.0' });
    assert.equal(t.calls.length, 0); assert.equal(t.app.inert, false); assert.equal(t.unload.size, 0);
  }
});
test('repeated install clicks do not start a second transaction', async () => {
  const gate = deferred(), t = harness({ installWait: gate.promise });
  const one = t.updates.installAutomatically({ version: '2.5.0' });
  await t.updates.installAutomatically({ version: '2.5.0' }); gate.resolve(); await one;
  assert.equal(t.calls.filter(x => Array.isArray(x)).length, 1);
});
