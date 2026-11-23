'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const REPO = 'https://github.com/ZweWH/z-note';
const API = 'https://api.github.com/repos/ZweWH/z-note/releases/latest';
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
  return { updates: ZN.updates, current, calls, timers, opened, backupCalls, forbidden };
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
    'https://github.com.evil.example/ZweWH/z-note/update.zip',
    good.assets[0].browser_download_url + '?redirect=evil',
    good.assets[0].browser_download_url.replace('ZweWH/z-note', 'Someone/other-repo'),
    good.assets[0].browser_download_url.replace('v2.4.0/', 'v2.3.0/'),
    good.assets[0].browser_download_url.replace('https:', 'http:')
  ];
  for (const url of urls) {
    assert.equal(parseRelease({ ...good, assets: [{ ...good.assets[0], browser_download_url: url }] }).downloadURL, null);
  }
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
