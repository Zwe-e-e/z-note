'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const REPO = 'https://github.com/Zwe-e-e/z-note';
const API = 'https://api.github.com/repos/Zwe-e-e/z-note/releases/latest';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function release(version = '2.4.0') {
  const name = 'Z-Note-v' + version + '-Portable.zip';
  return {
    tag_name: 'v' + version, draft: false, prerelease: false,
    assets: [{ name, state: 'uploaded', size: 1234, browser_download_url: REPO + '/releases/download/v' + version + '/' + name }]
  };
}
function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

// Small DOM fixture: tests drive the actual button handlers without real files,
// browser storage, networking, timers, or navigation.
class Element {
  constructor(selector, props, children) {
    this.selector = selector;
    this.children = children.flat(Infinity).filter(x => x != null && x !== false);
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    Object.assign(this, props);
  }
  append(...children) { this.children.push(...children); }
  contains(el) { return this === el || this.children.some(child => child instanceof Element && child.contains(el)); }
  replaceChildren(...children) { this.children = children; this.text = undefined; }
  addEventListener(name, fn) { this['on' + name] = fn; }
  get textContent() {
    return this.text === undefined ? this.children.map(x => x instanceof Element ? x.textContent : String(x)).join('') : this.text;
  }
  set textContent(text) { this.text = text; this.children = []; }
}
function h(selector, props, ...children) {
  if (props == null) props = {};
  else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { children.unshift(props); props = {}; }
  return new Element(selector, props, children);
}
function all(root, predicate) {
  return [root, ...root.children.filter(x => x instanceof Element).flatMap(x => all(x, () => true))].filter(predicate);
}
function one(root, predicate) {
  const matches = all(root, predicate);
  assert.equal(matches.length, 1, 'Expected exactly one matching control');
  return matches[0];
}
const button = (root, label) => one(root, el => el.selector.startsWith('button') && el.textContent === label);
const guide = root => one(root, el => el.selector.includes('.update-guide'));
const checkbox = root => one(root, el => el.type === 'checkbox');
const downloadLinks = root => all(root, el => el.selector.startsWith('a') && /\/releases\/download\//.test(el.href || ''));
const status = root => one(root, el => el.selector === 'p.update-status').textContent;

function harness(options = {}) {
  const calls = [], timers = new Map(), opened = [], backupCalls = [], forbidden = [];
  let timerID = 0;
  const current = {
    fetch: options.fetch || (async () => response(release())),
    download: options.download || (async () => 'Z Note backup 2026-11-23.json')
  };
  const noAccess = label => new Proxy({}, { get(_target, name) {
    forbidden.push(label + '.' + String(name));
    throw new Error('Update checks must not access ' + label);
  } });
  const ZN = {
    version: options.version || '2.3.0',
    util: { h, clear: el => { el.replaceChildren(); return el; } },
    icon: () => h('svg'),
    settings: {
      open(...args) { opened.push(args); },
      async download() { backupCalls.push('backup'); return current.download(); }
    },
    store: noAccess('store'), db: noAccess('db'), sync: noAccess('sync')
  };
  const context = {
    ZN, AbortController, TypeError,
    setTimeout(fn, delay) { const id = ++timerID; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { calls.push({ url, init }); return current.fetch(url, init); },
    location: noAccess('location'), document: noAccess('document')
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/updates.js'), 'utf8'), context, { filename: 'app/js/updates.js' });
  return { updates: ZN.updates, ZN, context, current, calls, timers, opened, backupCalls, forbidden };
}

// Installation fixtures model only the already authenticated bridge capability.
// They never launch a helper, touch browser storage, download files or navigate.
function nativeHarness(options = {}) {
  const t = harness(options), events = [], modals = [], listeners = new Map(), documentListeners = new Map();
  const app = h('div#app', { inert: false }), priorModal = h('div.modal', { inert: true });
  const notebook = { app: 'znote', version: 1, pages: [{ id: 'note-1', text: 'Keep me' }], images: [], settings: { sourceFolder: 'unchanged' } };
  const state = { supported: true, version: options.nativeVersion || options.version || '2.3.0', installAttempted: false, backupPath: '' };
  const nativeCalls = [];
  let reloads = 0, closes = 0;
  function add(map, name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); }
  function remove(map, name, fn) { if (map.has(name)) map.get(name).delete(fn); }
  Object.assign(t.current, {
    connect: options.connect || (async () => ({ ...state })),
    otherWindowsOpen: options.otherWindowsOpen || (async () => false),
    pause: options.pause || (async () => {}),
    prepareExport: options.prepareExport || (async () => {}),
    checkpoint: options.checkpoint || (async () => {}),
    exportAll: options.exportAll || (async () => notebook),
    install: options.install || (async (_backup, version) => ({ stage: 'installed', version, backupPath: 'C:\\Z Note\\Backups\\notebook.json' }))
  });
  t.ZN.updateNative = {
    available: options.available !== false,
    async connect() { events.push('connect'); return t.current.connect(); },
    state() { return { ...state }; },
    async install(backup, version, onProgress) {
      events.push('install');
      nativeCalls.push({ backup, version, onProgress });
      state.installAttempted = options.installAttempted !== false;
      return t.current.install(backup, version, onProgress);
    }
  };
  t.ZN.store = {
    memoryOnly: !!options.memoryOnly,
    async otherWindowsOpen() { events.push('otherWindowsOpen'); return t.current.otherWindowsOpen(); },
    async checkpoint() { events.push('checkpoint'); return t.current.checkpoint(); }
  };
  t.ZN.sync = {
    async pause() { events.push('pause'); return t.current.pause(); },
    resume() { events.push('resume'); }
  };
  t.ZN.shell = { view: () => ({ async prepareExport() { events.push('prepareExport'); return t.current.prepareExport(); } }) };
  t.ZN.settings.exportAll = async () => { events.push('exportAll'); return t.current.exportAll(); };
  t.ZN.ui = { modal(config) {
    const modal = { config, el: h('div.modal', {}, config.body), closed: false, close() { this.closed = true; } };
    modals.push(modal);
    return modal;
  } };
  t.context.document = {
    querySelectorAll(selector) { assert.equal(selector, '#app, .modal'); return [app, priorModal]; },
    addEventListener(name, fn) { add(documentListeners, name, fn); },
    removeEventListener(name, fn) { remove(documentListeners, name, fn); }
  };
  t.context.location = { reload() { events.push('reload'); reloads++; } };
  t.context.closed = false;
  t.context.close = () => { events.push('close'); closes++; if (options.closeThrows) throw new Error('Browser refused script close'); t.context.closed = !!options.closeSucceeds; };
  t.context.addEventListener = (name, fn) => add(listeners, name, fn);
  t.context.removeEventListener = (name, fn) => remove(listeners, name, fn);
  return { ...t, events, modals, listeners, documentListeners, app, priorModal, notebook, nativeCalls, nativeState: state,
    get reloads() { return reloads; }, get closes() { return closes; } };
}
function automatic(root) {
  return one(root, el => el.selector === 'div.set-group' && el.children.some(child => child instanceof Element && child.selector === 'h3' && child.textContent === 'Automatic update'));
}
async function advanceUntil(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await Promise.resolve();
  assert.equal(!!predicate(), true, 'The expected asynchronous operation was not reached');
}

test('release versions compare numeric components, not text or decimals', () => {
  const { compareVersions: compare } = harness().updates;
  assert.equal(compare('2.10.0', '2.9.99'), 1);
  assert.equal(compare('v2.3.0', '2.3.0'), 0);
  assert.equal(compare('2.3.9', '2.3.10'), -1);
  assert.equal(compare('3.0.0', '2.100.100'), 1);
});

test('invalid, ambiguous, and prerelease version strings fail closed', () => {
  const { compareVersions: compare } = harness().updates;
  for (const invalid of ['2.3', '02.3.0', '2.3.0-beta', '2.3.0+build', ' 2.3.0', '2.3.0/', '9007199254740992.0.0', null]) {
    assert.throws(() => compare(invalid, '2.3.0'), /version number/);
  }
});

test('only a published stable release is accepted', () => {
  const { parseRelease } = harness().updates;
  for (const data of [null, {}, { ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), tag_name: 'v2.4.0-beta' }]) {
    assert.throws(() => parseRelease(data), /stable release/);
  }
  assert.equal(parseRelease(release()).version, '2.4.0');
});

test('download URL must be the exact known package in the official release', () => {
  const { parseRelease } = harness().updates;
  const good = release();
  assert.equal(parseRelease(good).downloadURL, good.assets[0].browser_download_url);
  const urls = [
    'https://evil.example/update.zip',
    'javascript:alert(1)',
    'https://github.com.evil.example/Zwe-e-e/z-note/update.zip',
    good.assets[0].browser_download_url + '?redirect=evil',
    good.assets[0].browser_download_url.replace('Zwe-e-e/z-note', 'Someone/other-repo'),
    good.assets[0].browser_download_url.replace('v2.4.0/', 'v2.3.0/'),
    good.assets[0].browser_download_url.replace('https:', 'http:')
  ];
  for (const url of urls) {
    assert.equal(parseRelease({ ...good, assets: [{ ...good.assets[0], browser_download_url: url }] }).downloadURL, null);
  }
});

test('repository migration uses the new owner and rejects old-owner package URLs', async () => {
  const data = release('2.5.0');
  const t = harness({ fetch: async () => response(data) });
  const parsed = await t.updates.checkLatest();
  assert.equal(t.calls[0].url, 'https://api.github.com/repos/Zwe-e-e/z-note/releases/latest');
  assert.equal(parsed.releaseURL, 'https://github.com/Zwe-e-e/z-note/releases/tag/v2.5.0');
  assert.equal(parsed.downloadURL, 'https://github.com/Zwe-e-e/z-note/releases/download/v2.5.0/Z-Note-v2.5.0-Portable.zip');
  data.assets[0].browser_download_url = data.assets[0].browser_download_url.replace('Zwe-e-e/z-note', 'ZweWH/z-note');
  assert.equal(t.updates.parseRelease(data).downloadURL, null);
});

test('incomplete, absent, or differently named assets cannot offer an update download', () => {
  const { parseRelease } = harness().updates;
  for (const assets of [[], null, [{ ...release().assets[0], state: 'new' }], [{ ...release().assets[0], size: 0 }], [{ ...release().assets[0], name: 'Source.zip' }]]) {
    assert.equal(parseRelease({ ...release(), assets }).downloadURL, null);
  }
  const data = release();
  data.assets[0].name = 'Z-Note-Portable.zip';
  data.assets[0].browser_download_url = REPO + '/releases/download/v2.4.0/Z-Note-Portable.zip';
  assert.equal(parseRelease(data).downloadURL, data.assets[0].browser_download_url);
});

test('untrusted release title, body and html_url are not used as UI or links', async () => {
  const data = { ...release(), name: '<script>bad()</script>', body: '<img onerror=bad()>', html_url: 'https://evil.example' };
  const t = harness({ fetch: async () => response(data) });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.doesNotMatch(root.textContent, /script|onerror|evil/);
  assert.equal(one(root, el => el.selector.startsWith('a') && el.textContent === 'View release notes').href, REPO + '/releases/tag/v2.4.0');
});

test('creating the settings pane is idle and the sidebar open requests an explicit check', () => {
  const t = harness();
  t.updates.pane();
  t.updates.open();
  assert.deepEqual(t.opened, [['updates', true]]);
  assert.equal(t.calls.length, 0);
  assert.deepEqual(t.forbidden, []);
});

test('the pane can immediately perform the sidebar-requested check', async () => {
  const waiting = deferred();
  const t = harness({ fetch: () => waiting.promise });
  const root = t.updates.pane(true);
  assert.equal(t.calls.length, 1);
  assert.match(status(root), /Checking GitHub/);
  assert.equal(button(root, 'Check for updates').disabled, true);
  waiting.resolve(response(release()));
  await t.updates.checkLatest();
  assert.match(status(root), /Update available/);
});

test('explicit checks send only a credential-free public metadata request', async () => {
  const t = harness();
  await t.updates.checkLatest();
  assert.equal(t.calls.length, 1);
  const { url, init } = t.calls[0];
  assert.equal(url, API);
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.mode, 'cors');
  assert.equal(init.body, undefined);
  assert.deepEqual(Object.keys(init.headers), ['Accept']);
  assert.equal(t.timers.size, 0);
  assert.deepEqual(t.forbidden, []);
});

test('overlapping checks share one request and later checks fetch afresh', async () => {
  const waiting = deferred();
  const t = harness({ fetch: () => waiting.promise });
  const first = t.updates.checkLatest();
  const second = t.updates.checkLatest();
  assert.equal(first, second);
  assert.equal(t.calls.length, 1);
  waiting.resolve(response(release()));
  await first;
  t.current.fetch = async () => response(release('2.5.0'));
  assert.equal((await t.updates.checkLatest()).version, '2.5.0');
  assert.equal(t.calls.length, 2);
});

test('HTTP failures explain rate limits, missing releases and server failure, then allow retry', async () => {
  for (const [code, message] of [[403, /limiting/], [429, /limiting/], [404, /No published release/], [500, /could not check/]]) {
    const t = harness({ fetch: async () => response({}, code) });
    await assert.rejects(t.updates.checkLatest(), message);
    assert.equal(t.timers.size, 0);
    t.current.fetch = async () => response(release());
    assert.equal((await t.updates.checkLatest()).version, '2.4.0');
  }
});

test('a failed connection remains retryable and never reports up to date', async () => {
  const t = harness({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.match(status(root), /internet connection/);
  assert.doesNotMatch(status(root), /up to date/);
  assert.equal(button(root, 'Check for updates').disabled, false);
  assert.equal(guide(root).hidden, true);
  t.current.fetch = async () => response(release('2.3.0'));
  await button(root, 'Check for updates').onclick();
  assert.match(status(root), /up to date/);
  assert.deepEqual(t.forbidden, []);
});

test('a stalled request times out at twelve seconds and cleans up its timer', async () => {
  const t = harness({ fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
  }) });
  const request = t.updates.checkLatest();
  const failure = assert.rejects(request, /timed out/);
  assert.equal(t.timers.size, 1);
  const timer = [...t.timers.values()][0];
  assert.equal(timer.delay, 12000);
  timer.fn();
  await failure;
  assert.equal(t.timers.size, 0);
});

test('malformed response data fails without a stale success status', async () => {
  const t = harness({ fetch: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('Invalid JSON'); } }) });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.match(status(root), /Invalid JSON/);
  assert.equal(guide(root).hidden, true);
  assert.equal(downloadLinks(root).length, 0);
});

test('available, current and ahead versions have distinct states', async () => {
  for (const [version, expected, hidden] of [['2.4.0', /Update available: v2.4.0/, false], ['2.3.0', /up to date/, true], ['2.2.1', /ahead.*No update is needed/, true]]) {
    const t = harness({ fetch: async () => response(release(version)) });
    const root = t.updates.pane();
    await button(root, 'Check for updates').onclick();
    assert.match(status(root), expected);
    assert.equal(guide(root).hidden, hidden);
    assert.deepEqual(t.forbidden, []);
  }
});

test('an available release without a ready portable asset has no download action', async () => {
  const t = harness({ fetch: async () => response({ ...release(), assets: [] }) });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.match(status(root), /Update available/);
  assert.match(root.textContent, /download is not ready/);
  assert.equal(guide(root).hidden, true);
  assert.equal(downloadLinks(root).length, 0);
});

test('the update link requires both completed backup preparation and explicit saved-file confirmation', async () => {
  const backup = deferred();
  const t = harness({ download: () => backup.promise });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  const confirm = checkbox(root);
  assert.equal(confirm.disabled, true);
  assert.equal(downloadLinks(root).length, 0);
  confirm.checked = true;
  confirm.onchange();
  assert.equal(downloadLinks(root).length, 0, 'A checkbox value alone cannot bypass the backup requirement');
  const saving = button(root, 'Download a backup first').onclick();
  assert.equal(button(root, 'Download a backup first').disabled, true);
  assert.equal(confirm.disabled, true);
  assert.equal(downloadLinks(root).length, 0);
  backup.resolve('Z Note backup.json');
  await saving;
  assert.equal(confirm.disabled, false);
  assert.equal(confirm.checked, false);
  assert.equal(downloadLinks(root).length, 0);
  assert.match(root.textContent, /Download started: Z Note backup.json/);
  confirm.checked = true;
  confirm.onchange();
  assert.equal(downloadLinks(root).length, 1);
  assert.equal(downloadLinks(root)[0].href, release().assets[0].browser_download_url);
  assert.equal(downloadLinks(root)[0].target, '_blank');
  assert.equal(downloadLinks(root)[0].rel, 'noopener noreferrer');
  confirm.checked = false;
  confirm.onchange();
  assert.equal(downloadLinks(root).length, 0);
  assert.deepEqual(t.forbidden, []);
});

test('failed backup preparation keeps update blocked, and a new backup resets earlier confirmation', async () => {
  const t = harness();
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  await button(root, 'Download a backup first').onclick();
  const confirm = checkbox(root);
  confirm.checked = true;
  confirm.onchange();
  assert.equal(downloadLinks(root).length, 1);
  t.current.download = async () => { throw new Error('Image storage unavailable'); };
  await button(root, 'Download a backup first').onclick();
  assert.equal(confirm.checked, false);
  assert.equal(confirm.disabled, true);
  assert.equal(downloadLinks(root).length, 0);
  assert.match(root.textContent, /Backup failed: Image storage unavailable.*Keep this app open/);
  assert.deepEqual(t.forbidden, []);
});

test('checking again requires a fresh backup and confirmation for the new result', async () => {
  const t = harness();
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  await button(root, 'Download a backup first').onclick();
  const confirm = checkbox(root);
  confirm.checked = true;
  confirm.onchange();
  assert.equal(downloadLinks(root).length, 1);
  t.current.fetch = async () => response(release('2.5.0'));
  await button(root, 'Check for updates').onclick();
  assert.equal(confirm.checked, false);
  assert.equal(confirm.disabled, true);
  assert.equal(downloadLinks(root).length, 0);
  assert.match(status(root), /v2.5.0/);
});

test('repeated clicks during a check or backup do not start duplicate operations', async () => {
  const request = deferred(), backup = deferred();
  const t = harness({ fetch: () => request.promise, download: () => backup.promise });
  const root = t.updates.pane();
  const firstCheck = button(root, 'Check for updates').onclick();
  await button(root, 'Check for updates').onclick();
  assert.equal(t.calls.length, 1);
  request.resolve(response(release()));
  await firstCheck;
  const firstBackup = button(root, 'Download a backup first').onclick();
  await button(root, 'Download a backup first').onclick();
  assert.equal(t.backupCalls.length, 1);
  backup.resolve('backup.json');
  await firstBackup;
});

test('a supported launcher offers automatic installation without the manual backup checkbox', async () => {
  const t = nativeHarness();
  const root = t.updates.pane();
  assert.deepEqual(t.events, [], 'Opening an idle pane must not connect or install');
  await button(root, 'Check for updates').onclick();
  assert.deepEqual(t.events, ['connect'], 'A capability probe must not read or transmit notes');
  assert.equal(automatic(root).hidden, false);
  assert.equal(button(root, 'Install update automatically').disabled, false);
  assert.equal(guide(root).hidden, true);
  assert.equal(checkbox(root).checked, false);
  assert.equal(downloadLinks(root).length, 0);
  assert.equal(t.backupCalls.length, 0);
  assert.equal(t.nativeCalls.length, 0);
  assert.equal(t.reloads, 0);
  assert.deepEqual(t.forbidden, []);
});

test('current releases, older releases and unfinished assets do not probe the launcher', async () => {
  for (const data of [release('2.3.0'), release('2.2.0'), { ...release(), assets: [] }]) {
    const t = nativeHarness({ fetch: async () => response(data) });
    const root = t.updates.pane();
    await button(root, 'Check for updates').onclick();
    assert.deepEqual(t.events, []);
    assert.equal(automatic(root).hidden, true);
    assert.equal(button(root, 'Install update automatically').disabled, true);
  }
});

test('an unavailable or incompatible launcher preserves the manual backup-first route', async () => {
  for (const options of [
    { available: false },
    { connect: async () => ({ supported: false }) },
    { connect: async () => { throw new Error('Reopen Open Z Note.cmd to connect to the new launcher.'); } }
  ]) {
    const t = nativeHarness(options), root = t.updates.pane();
    await button(root, 'Check for updates').onclick();
    assert.equal(button(root, 'Install update automatically').disabled, true);
    assert.equal(guide(root).hidden, false);
    assert.equal(checkbox(root).disabled, true);
    assert.equal(downloadLinks(root).length, 0);
    assert.equal(t.nativeCalls.length, 0);
    assert.equal(t.events.includes('checkpoint'), false);
    if (options.available !== false) assert.match(automatic(root).textContent, /backup and ZIP steps/);
  }
});

test('temporary browser storage cannot enable automatic installation', async () => {
  const t = nativeHarness({ memoryOnly: true }), root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.equal(button(root, 'Install update automatically').disabled, true);
  assert.equal(guide(root).hidden, false);
  assert.match(automatic(root).textContent, /browser storage/);
  assert.deepEqual(t.events, ['connect']);
  assert.equal(t.nativeCalls.length, 0);
  assert.equal(t.reloads, 0);
});

test('a new check clears a formerly enabled automatic button while probing', async () => {
  const t = nativeHarness(), root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  assert.equal(button(root, 'Install update automatically').disabled, false);
  const capability = deferred();
  t.current.connect = () => capability.promise;
  const checking = button(root, 'Check for updates').onclick();
  assert.equal(button(root, 'Install update automatically').disabled, true);
  await advanceUntil(() => t.events.filter(event => event === 'connect').length === 2);
  assert.equal(button(root, 'Install update automatically').disabled, true);
  capability.reject(new Error('Launcher disconnected'));
  await checking;
  assert.equal(button(root, 'Install update automatically').disabled, true);
  assert.equal(guide(root).hidden, false);
});

test('install saves pending edits and durable storage before backup upload, then reloads once', async () => {
  const t = nativeHarness(), root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  t.events.length = 0;
  await button(root, 'Install update automatically').onclick();
  assert.deepEqual(t.events, ['otherWindowsOpen', 'connect', 'pause', 'prepareExport', 'checkpoint', 'exportAll', 'install', 'checkpoint', 'reload']);
  assert.equal(t.nativeCalls.length, 1);
  assert.equal(t.nativeCalls[0].backup, t.notebook);
  assert.equal(t.nativeCalls[0].version, '2.4.0');
  assert.equal(t.backupCalls.length, 0, 'Automatic backup does not need a separate browser download');
  assert.equal(t.modals[0].config.dismissable, false);
  assert.match(status(t.modals[0].el), /Installed v2.4.0/);
  assert.match(t.modals[0].el.textContent, /Recovery backup: C:\\Z Note\\Backups\\notebook.json/);
  assert.equal(t.listeners.get('beforeunload').size, 0);
  assert.equal(t.reloads, 1);
  await button(root, 'Install update automatically').onclick();
  assert.equal(t.nativeCalls.length, 1, 'The original button cannot replay an installed update');
  assert.equal(t.reloads, 1);
});

test('install progress leaves notes frozen and does not reload or settle early', async () => {
  const installation = deferred();
  const t = nativeHarness({ install: () => installation.promise });
  const first = t.updates.installAutomatically({ version: '2.4.0' });
  assert.equal(t.app.inert, true);
  assert.equal(t.priorModal.inert, true);
  assert.equal(t.listeners.get('beforeunload').size, 1);
  let prevented = false;
  const unloading = { preventDefault() { prevented = true; } };
  [...t.listeners.get('beforeunload')][0](unloading);
  assert.equal(prevented, true);
  assert.equal(unloading.returnValue, '');
  await advanceUntil(() => t.nativeCalls.length === 1);
  await t.updates.installAutomatically({ version: '2.4.0' });
  assert.equal(t.nativeCalls.length, 1, 'Overlapping install actions share the busy guard');
  t.nativeCalls[0].onProgress({ stage: 'progress', message: 'Verifying package…' });
  assert.match(status(t.modals[0].el), /Verifying package/);
  assert.equal(t.reloads, 0);
  assert.equal(t.app.inert, true);
  assert.equal(t.events.includes('resume'), false);
  installation.resolve({ stage: 'installed', version: '2.4.0', backupPath: 'C:\\backup.json' });
  await first;
  assert.equal(t.reloads, 1);
});

test('other windows and temporary sessions stop before taking a backup or installing', async () => {
  for (const [options, message] of [
    [{ otherWindowsOpen: async () => true }, /Close the other Z Note windows/],
    [{ memoryOnly: true }, /temporary session/]
  ]) {
    const t = nativeHarness(options);
    await t.updates.installAutomatically({ version: '2.4.0' });
    assert.equal(t.nativeCalls.length, 0);
    assert.equal(t.events.includes('pause'), false);
    assert.equal(t.events.includes('checkpoint'), false);
    assert.equal(t.reloads, 0);
    assert.match(status(t.modals[0].el), message);
    assert.equal(t.app.inert, false);
    assert.equal(t.priorModal.inert, true, 'Pre-existing inert state must be preserved');
    assert.equal(t.listeners.get('beforeunload').size, 0);
  }
});

test('save or export failure restores notes and sync without installing or reloading', async () => {
  for (const options of [
    { checkpoint: async () => { throw new Error('Disk quota exceeded'); } },
    { exportAll: async () => { throw new Error('Picture could not be read'); } }
  ]) {
    const t = nativeHarness(options);
    await t.updates.installAutomatically({ version: '2.4.0' });
    assert.equal(t.nativeCalls.length, 0);
    assert.equal(t.reloads, 0);
    assert.match(status(t.modals[0].el), /Update did not finish: (Disk quota exceeded|Picture could not be read)/);
    assert.equal(t.app.inert, false);
    assert.equal(t.priorModal.inert, true);
    assert.equal(t.events.filter(event => event === 'resume').length, 1);
    assert.equal(t.listeners.get('beforeunload').size, 0);
    button(t.modals[0].el, 'Back to my notes').onclick();
    assert.equal(t.modals[0].closed, true);
    t.current.checkpoint = async () => {};
    t.current.exportAll = async () => t.notebook;
    await t.updates.installAutomatically({ version: '2.4.0' });
    assert.equal(t.nativeCalls.length, 1, 'A pre-install failure can be retried after it is fixed');
    assert.equal(t.reloads, 1);
  }
});

test('a failed backup reports the saved recovery path and never reloads', async () => {
  const t = nativeHarness({ installAttempted: false, install: async () => { throw new Error('Backup verification failed'); } });
  t.nativeState.backupPath = 'C:\\Z Note\\Backups\\recovery.json';
  await t.updates.installAutomatically({ version: '2.4.0' });
  assert.equal(t.reloads, 0);
  assert.match(status(t.modals[0].el), /Backup verification failed/);
  assert.match(t.modals[0].el.textContent, /Your recovery backup is saved at: C:\\Z Note\\Backups\\recovery.json/);
  assert.equal(t.app.inert, false);
  assert.equal(t.events.filter(event => event === 'resume').length, 1);
  assert.equal(t.listeners.get('beforeunload').size, 0);
});

test('an earlier installation attempt cannot re-enable the automatic button', async () => {
  const t = nativeHarness(), root = t.updates.pane();
  t.nativeState.installAttempted = true;
  await button(root, 'Check for updates').onclick();
  assert.equal(button(root, 'Install update automatically').disabled, true);
  assert.match(automatic(root).textContent, /already been attempted.*reopen Z Note\.exe/);
  assert.equal(t.nativeCalls.length, 0);
  assert.equal(t.reloads, 0);
});

test('an uncertain install keeps editing and sync paused and cannot be replayed', async () => {
  for (const flag of ['uncertain', 'reopenRequired']) {
    const failure = new Error('The Windows updater connection was interrupted.');
    failure[flag] = true;
    const t = nativeHarness({ install: async () => { throw failure; } });
    t.nativeState.backupPath = 'C:\\Z Note\\Backups\\recovery.json';
    await t.updates.installAutomatically({ version: '2.4.0' });
    const modal = t.modals[0].el;
    assert.match(status(modal), /result could not be confirmed/);
    assert.match(modal.textContent, /Editing and folder sync are paused/);
    assert.match(modal.textContent, /reopen Z Note\.exe/);
    assert.match(modal.textContent, /C:\\Z Note\\Backups\\recovery.json/);
    assert.equal(all(modal, el => el.selector.startsWith('button') && el.textContent === 'Back to my notes').length, 0);
    assert.equal(t.app.inert, true);
    assert.equal(t.listeners.get('beforeunload').size, 1);
    assert.equal(t.listeners.get('keydown').size, 1);
    assert.equal(t.events.includes('resume'), false);
    assert.equal(t.reloads, 0);
    await t.updates.installAutomatically({ version: '2.4.0' });
    assert.equal(t.nativeCalls.length, 1);
  }
});

test('a confirmed unchanged or rolled-back install can close the dialog and return safely to notes', async () => {
  for (const outcome of ['unchanged', 'rolled-back']) {
    const failure = Object.assign(new Error('Access to the update staging path is denied.'),
      { safeToResume: true, outcome, uncertain: false, reopenRequired: false });
    const t = nativeHarness({ install: async () => { throw failure; } });
    t.nativeState.backupPath = 'C:\\Z Note\\Backups\\recovery.json';
    await t.updates.installAutomatically({ version: '2.4.0' });
    const modal = t.modals[0].el;
    assert.match(status(modal), outcome === 'unchanged' ? /stopped before changing the app/ : /previous app was restored/);
    assert.match(status(modal), /Access to the update staging path is denied/);
    assert.doesNotMatch(status(modal), /result could not be confirmed|Installed v/);
    assert.match(modal.textContent, /C:\\Z Note\\Backups\\recovery.json/);
    assert.match(modal.textContent, /Source folder → Open existing notebook/);
    assert.match(modal.textContent, /full path may be different on each PC/);
    assert.equal(t.app.inert, false);
    assert.equal(t.priorModal.inert, true);
    assert.equal(t.events.filter(event => event === 'resume').length, 1);
    assert.equal(t.listeners.get('beforeunload').size, 0);
    assert.equal(t.listeners.get('keydown').size, 0);
    assert.equal(t.reloads, 0);
    assert.equal(t.closes, 0);
    button(modal, 'Back to my notes').onclick();
    assert.equal(t.modals[0].closed, true);
    assert.equal(t.app.inert, false);
    assert.equal(t.nativeCalls.length, 1);
    const pane = t.updates.pane();
    await button(pane, 'Check for updates').onclick();
    assert.equal(button(pane, 'Install update automatically').disabled, true, 'A stopped installation is not replayable in this window');
  }
});

test('a final save failure keeps the installed app frozen until saving and reload can be retried', async () => {
  let checkpoints = 0;
  const t = nativeHarness({ checkpoint: async () => {
    checkpoints++;
    if (checkpoints === 2) throw new Error('A pending picture could not be saved');
  } });
  t.nativeState.backupPath = 'C:\\Z Note\\Backups\\recovery.json';
  await t.updates.installAutomatically({ version: '2.4.0' });
  const modal = t.modals[0].el;
  assert.equal(t.nativeCalls.length, 1, 'Installation completed before the final durability check failed');
  assert.equal(checkpoints, 2);
  assert.equal(t.reloads, 0, 'Reloading would discard the unsaved note or picture');
  assert.match(status(modal), /app update is installed, but your latest notes could not be saved/);
  assert.match(status(modal), /pending picture.*Keep this window open/);
  assert.equal(all(modal, el => el.selector.startsWith('button') && el.textContent === 'Reload Z Note').length, 0);
  assert.equal(t.app.inert, true);
  assert.equal(t.events.includes('resume'), false);
  assert.equal(t.listeners.get('beforeunload').size, 1);
  assert.equal(t.listeners.get('keydown').size, 1);
  assert.equal(all(modal, el => el.selector.startsWith('button') && el.textContent === 'Back to my notes').length, 0);
  await button(modal, 'Retry save and reload').onclick();
  assert.equal(t.reloads, 1);
  assert.equal(t.nativeCalls.length, 1, 'Saving again must not repeat installation');
  assert.equal(t.listeners.get('beforeunload').size, 0);
});

test('a stale browser offers reload when the launcher reports the release is already on disk', async () => {
  for (const nativeVersion of ['2.6.0', '2.6.1']) {
    const t = nativeHarness({ version: '2.5.1', nativeVersion, fetch: async () => response(release('2.6.0')) });
    const root = t.updates.pane();
    await button(root, 'Check for updates').onclick();
    const reload = button(root, 'Reload installed version');
    assert.equal(reload.disabled, false);
    assert.equal(guide(root).hidden, true);
    assert.equal(t.nativeCalls.length, 0);
    assert.equal(t.reloads, 0, 'Checking must not reload without a click');
    await reload.onclick();
    assert.equal(t.reloads, 1);
    assert.equal(t.nativeCalls.length, 0, 'Already installed files must not be installed again');
    assert.equal(t.events.includes('exportAll'), false);
    assert.ok(t.events.indexOf('pause') < t.events.indexOf('prepareExport'));
    assert.ok(t.events.indexOf('prepareExport') < t.events.indexOf('checkpoint'));
    assert.ok(t.events.indexOf('checkpoint') < t.events.indexOf('reload'));
  }
});

test('install preflight rechecks disk version even if the earlier pane probe saw an older app', async () => {
  const t = nativeHarness({ version: '2.5.1', fetch: async () => response(release('2.6.0')) });
  const root = t.updates.pane();
  await button(root, 'Check for updates').onclick();
  const install = button(root, 'Install update automatically');
  t.nativeState.version = '2.6.0';
  await install.onclick();
  assert.equal(t.nativeCalls.length, 0);
  assert.equal(t.events.includes('exportAll'), false);
  assert.equal(t.reloads, 1);
  assert.ok(t.events.indexOf('checkpoint') < t.events.indexOf('reload'));
});

test('already-current refusal unlocks notes and offers a safe reload without reporting installation', async () => {
  const failure = Object.assign(new Error('This app is already current. Check for updates again.'), { alreadyCurrent: true, uncertain: false, reopenRequired: false });
  const t = nativeHarness({ install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  const modal = t.modals[0].el;
  assert.equal(t.app.inert, false);
  assert.equal(t.priorModal.inert, true);
  assert.equal(t.events.filter(event => event === 'resume').length, 1);
  assert.equal(t.listeners.get('beforeunload').size, 0);
  assert.equal(t.listeners.get('keydown').size, 0);
  assert.equal(t.reloads, 0);
  assert.doesNotMatch(status(modal), /result could not be confirmed|Reopening your notebook/);
  assert.ok(button(modal, 'Back to my notes'));
  const saving = deferred();
  t.current.checkpoint = () => saving.promise;
  const reload = button(modal, 'Reload installed version').onclick();
  await advanceUntil(() => t.events.filter(event => event === 'checkpoint').length >= 2);
  assert.equal(t.reloads, 0, 'Reload must await newly saved notes');
  assert.equal(t.app.inert, true);
  assert.equal(t.events.filter(event => event === 'pause').length, 2, 'Reload must pause sync again after the error flow resumed it');
  assert.equal(t.listeners.get('beforeunload').size, 1, 'Pending changes must be protected during the new save');
  assert.equal(t.listeners.get('keydown').size, 1, 'Document shortcuts must remain blocked while the live notebook is saved');
  button(modal, 'Back to my notes').onclick();
  assert.equal(t.modals[0].closed, false, 'Closing the dialog during its pending save would strand a frozen notebook');
  saving.resolve();
  await reload;
  assert.equal(t.reloads, 1);
  assert.equal(t.nativeCalls.length, 1);
});

test('already-current refusal can return to notes without reloading', async () => {
  const failure = Object.assign(new Error('This app is already current. Check for updates again.'), { alreadyCurrent: true });
  const t = nativeHarness({ install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  button(t.modals[0].el, 'Back to my notes').onclick();
  assert.equal(t.modals[0].closed, true);
  assert.equal(t.app.inert, false);
  assert.equal(t.reloads, 0);
});

test('failed reload after an already-current refusal can return safely to notes', async () => {
  const failure = Object.assign(new Error('This app is already current. Check for updates again.'), { alreadyCurrent: true });
  const t = nativeHarness({ install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  t.current.checkpoint = async () => { throw new Error('Disk full'); };
  const modal = t.modals[0].el;
  await button(modal, 'Reload installed version').onclick();
  assert.equal(t.reloads, 0);
  assert.equal(t.app.inert, true);
  assert.equal(t.listeners.get('beforeunload').size, 1);
  button(modal, 'Back to my notes').onclick();
  assert.equal(t.modals[0].closed, true);
  assert.equal(t.app.inert, false);
  assert.equal(t.priorModal.inert, true);
  assert.equal(t.listeners.get('beforeunload').size, 0);
  assert.equal(t.listeners.get('keydown').size, 0);
  assert.equal(t.events.at(-1), 'resume');
});

test('uncertain-result close waits for durable notes and explains the native window close fallback', async () => {
  const failure = Object.assign(new Error('Connection lost'), { uncertain: true, reopenRequired: true });
  const t = nativeHarness({ install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  const modal = t.modals[0].el, saving = deferred();
  t.current.checkpoint = () => saving.promise;
  const closing = button(modal, 'Close Z Note').onclick();
  await advanceUntil(() => t.events.filter(event => event === 'checkpoint').length >= 2);
  assert.equal(t.closes, 0);
  assert.equal(t.listeners.get('beforeunload').size, 1);
  assert.equal(t.listeners.get('keydown').size, 1);
  assert.equal(t.app.inert, true);
  saving.resolve();
  await closing;
  assert.equal(t.closes, 1);
  assert.equal(t.listeners.get('beforeunload').size, 0);
  assert.equal(t.reloads, 0);
  assert.equal(t.nativeCalls.length, 1);
  assert.equal(t.events.includes('resume'), false);
  assert.equal(t.app.inert, true, 'Refused browser closure must not unlock a possibly inconsistent app');
  assert.match(modal.textContent, /(?:window.*(?:X|×|close)|(?:X|×).*window)/i);
});

test('failed final save prevents uncertain-result closure and leaves protection in place', async () => {
  const failure = Object.assign(new Error('Connection lost'), { uncertain: true });
  const t = nativeHarness({ install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  t.current.checkpoint = async () => { throw new Error('Disk full'); };
  const modal = t.modals[0].el;
  await button(modal, 'Close Z Note').onclick();
  assert.equal(t.closes, 0);
  assert.equal(t.reloads, 0);
  assert.equal(t.app.inert, true);
  assert.equal(t.listeners.get('beforeunload').size, 1);
  assert.equal(t.listeners.get('keydown').size, 1);
  assert.equal(t.events.includes('resume'), false);
  assert.match(modal.textContent, /Disk full/);
});

test('browser refusing script-close after a saved checkpoint keeps manual window-close guidance', async () => {
  const failure = Object.assign(new Error('Connection lost'), { uncertain: true });
  const t = nativeHarness({ closeThrows: true, install: async () => { throw failure; } });
  await t.updates.installAutomatically({ version: '2.4.0' });
  const modal = t.modals[0].el;
  await button(modal, 'Close Z Note').onclick();
  assert.equal(t.closes, 1);
  assert.equal(t.listeners.get('beforeunload').size, 0);
  assert.equal(t.app.inert, true);
  assert.equal(t.reloads, 0);
  assert.equal(t.events.includes('resume'), false);
  assert.match(status(modal), /(?:window.*(?:X|×|close)|(?:X|×).*window)/i);
  assert.doesNotMatch(status(modal), /notes could not be saved/);
});
