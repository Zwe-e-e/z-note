const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Small DOM stand-ins: exercise setup decisions and persistence without
// opening native folder pickers or reading any real notebook files.
class Element {
  constructor(selector, props, children) {
    this.selector = selector;
    this.tag = selector.split(/[.#]/)[0];
    this.classes = selector.split('.').slice(1);
    this.children = children.flat(Infinity).filter(x => x != null && x !== false);
    Object.assign(this, props || {});
    this.attributes = {};
    this.inert = false;
    this.isConnected = true;
  }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  get textContent() { return this.text || this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
  set textContent(value) { this.text = value; }
  all() { return this.children.flatMap(c => c instanceof Element ? [c, ...c.all()] : []); }
  querySelectorAll(selector) {
    return this.all().filter(e => selector.startsWith('.') ? e.classes.includes(selector.slice(1))
      : selector === 'button:not(:disabled)' ? e.tag === 'button' && !e.disabled : e.tag === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { if (this.document) this.document.activeElement = this; }
}

function harness(options = {}) {
  let current = null, opened = 0;
  const writes = [], messages = [], reads = [], meta = new Map();
  if (options.saved) meta.set('setup', options.saved);
  const app = new Element('div#app', {}, []);
  const events = new Map();
  const document = {
    activeElement: app,
    getElementById: () => app,
    querySelectorAll: () => current ? [current.el] : [],
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); }
  };
  function h(selector, props, ...children) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) {
      children.unshift(props); props = {};
    }
    const el = new Element(selector, props, children);
    el.document = document;
    return el;
  }
  const sync = {
    supported: options.supported !== false,
    dir: options.linked ? { name: 'Existing folder' } : null,
    state: 'none', calls: 0, existingCalls: 0, unlinks: 0,
    async link() { this.calls++; if (this.onLink) return this.onLink(); this.dir = { name: 'Selected folder' }; this.state = 'ready'; return true; },
    async openExisting() { this.existingCalls++; this.direct = true; this.dir = { name: 'Z Note notebook' }; this.state = 'ready'; return true; },
    async unlink() { this.unlinks++; this.dir = null; this.state = 'none'; }
  };
  const db = {
    failWrite: false,
    async get(store, key) { reads.push([store, key]); return meta.get(key); },
    async put(store, value, key) {
      if (this.failWrite) throw new Error('Storage full');
      writes.push({ store, value, key }); meta.set(key, value);
    }
  };
  const ZN = {
    store: { memoryOnly: !!options.memoryOnly }, db, sync,
    util: { h }, icon: () => h('svg'),
    ui: {
      toast: msg => messages.push(msg),
      modal(o) {
        opened++;
        const el = h('div.modal', {}, h('h2.modal-title', o.title), o.body);
        current = { el, close: () => { current = null; o.onClose(); } };
        return current;
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/setup.js'), 'utf8'), {
    window: { ZN }, document, console: { warn() {} }
  });
  return {
    setup: ZN.setup, sync, db, app, writes, messages, reads, meta, events,
    get modal() { return current; }, get opened() { return opened; },
    button(label) { return current.el.querySelectorAll('button').find(b => b.textContent === label); },
    get status() { return current.el.querySelector('.setup-status').textContent; }
  };
}

test('first visit opens setup once without requesting a folder automatically', async () => {
  const h = harness();
  await h.setup.init();
  await h.setup.init();
  assert.equal(h.opened, 1);
  assert.equal(h.sync.calls, 0);
  assert.ok(h.button('Choose source folder'));
  assert.ok(h.button('Use browser storage'));
  assert.equal(h.app.inert, true);
});

test('existing linked folders and completed setup skip the first-run dialog', async () => {
  for (const options of [{ linked: true }, { saved: { version: 1, mode: 'browser' } }]) {
    const h = harness(options);
    await h.setup.init();
    assert.equal(h.opened, 0);
    assert.equal(h.sync.calls, 0);
  }
});

test('other-PC setup opens an existing notebook without using the create action', async () => {
  const h = harness();
  await h.setup.init();
  await h.button('Open existing notebook…').onclick();
  assert.equal(h.sync.existingCalls, 1);
  assert.equal(h.sync.calls, 0);
  assert.equal(h.modal, null);
  assert.equal(h.meta.get('setup').mode, 'folder');
  assert.equal(h.app.inert, false);
});

test('cancelling the folder picker leaves setup open without marking complete', async () => {
  const h = harness();
  h.sync.onLink = async () => { throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); };
  await h.setup.init();
  await h.button('Choose source folder').onclick();
  assert.ok(h.modal);
  assert.match(h.status, /No folder selected/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.button('Choose source folder').disabled, false);
});

test('denied folder access reports an error and allows retry', async () => {
  const h = harness();
  h.sync.onLink = async () => { throw new Error('Access denied'); };
  await h.setup.init();
  await h.button('Choose source folder').onclick();
  assert.match(h.status, /Access denied/);
  assert.ok(h.modal);
  assert.equal(h.writes.length, 0);
  h.sync.onLink = null;
  await h.button('Choose source folder').onclick();
  assert.equal(h.modal, null);
  assert.equal(h.meta.get('setup').mode, 'folder');
  assert.equal(h.app.inert, false);
  assert.equal(h.events.size, 0);
});

test('failed first sync stays open and browser-only selection removes its pending connection', async () => {
  const h = harness();
  h.sync.onLink = async () => { h.sync.dir = { name: 'Unwritable folder' }; h.sync.state = 'error'; return false; };
  await h.setup.init();
  await h.button('Choose source folder').onclick();
  assert.ok(h.modal);
  assert.match(h.status, /first save did not finish/);
  assert.equal(h.writes.length, 0);
  await h.button('Use browser storage').onclick();
  assert.equal(h.sync.unlinks, 1);
  assert.equal(h.sync.dir, null);
  assert.equal(h.meta.get('setup').mode, 'browser');
  assert.equal(h.modal, null);
});

test('a folder succeeds only after connection finishes and blocks duplicate clicks', async () => {
  const h = harness();
  let resolve;
  h.sync.onLink = () => new Promise(r => { resolve = r; });
  await h.setup.init();
  const button = h.button('Choose source folder');
  const pending = button.onclick();
  await button.onclick();
  assert.equal(h.sync.calls, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(button.disabled, true);
  assert.ok(h.modal);
  h.sync.dir = { name: 'Notebook home' };
  resolve(true);
  await pending;
  assert.equal(h.modal, null);
  assert.equal(h.meta.get('setup').mode, 'folder');
});

test('browser-only completion persists separately and suppresses future setup', async () => {
  const h = harness();
  await h.setup.init();
  await h.button('Use browser storage').onclick();
  assert.equal(h.writes[0].store, 'meta');
  assert.equal(h.writes[0].key, 'setup');
  assert.equal(h.modal, null);
  await h.setup.init();
  assert.equal(h.opened, 1);
});

test('failed browser-only preference write stays open and is not falsely completed', async () => {
  const h = harness();
  h.db.failWrite = true;
  await h.setup.init();
  await h.button('Use browser storage').onclick();
  assert.ok(h.modal);
  assert.match(h.status, /Could not save this choice/);
  h.db.failWrite = false;
  await h.button('Use browser storage').onclick();
  assert.equal(h.modal, null);
  assert.equal(h.meta.get('setup').mode, 'browser');
});

test('unsupported browsers have an honest browser-storage path', async () => {
  const h = harness({ supported: false });
  await h.setup.init();
  assert.equal(h.button('Choose source folder'), undefined);
  assert.match(h.modal.el.textContent, /cannot save directly to a folder/);
  await h.button('Use browser storage').onclick();
  assert.equal(h.modal, null);
  assert.equal(h.sync.calls, 0);
});

test('blocked browser storage offers only a temporary session and writes no preference', async () => {
  const h = harness({ memoryOnly: true });
  await h.setup.init();
  assert.equal(h.button('Choose source folder'), undefined);
  assert.match(h.modal.el.textContent, /notes will not be kept/);
  await h.button('Continue for this session').onclick();
  assert.equal(h.modal, null);
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
  assert.match(h.messages[0], /Temporary session only/);
});
