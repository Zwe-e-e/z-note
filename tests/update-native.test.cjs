'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOKEN = 'ab'.repeat(32), APP = 'file:///C:/Z%20Note/Z%20Note.html';
const URL_WITH_HOST = APP + '?zn-awake-port=47231&zn-awake-token=' + TOKEN;
const BACKUP_PATH = 'C:\\Users\\Tester\\AppData\\Local\\ZNote\\backups\\backup.json';
const MAX_BACKUP = 268435456;
const turn = () => new Promise(resolve => setImmediate(resolve));
const backup = () => ({ app: 'znote', version: 1, settings: { name: 'Example' }, pages: [{ id: 'note1', content: { text: 'Hello မြန်မာ 🌱' } }], images: [] });

function harness(options = {}) {
  const sockets = [], timers = new Map(), events = new Map();
  let serial = 0;
  class FakeSocket {
    constructor(url) {
      if (options.constructorFailure) throw new Error('Unavailable');
      this.url = url; this.sent = []; this.closed = false; this.received = 0;
      sockets.push(this);
    }
    send(text) {
      if (this.closed) throw new Error('Closed');
      const command = JSON.parse(text);
      this.sent.push(command);
      if (this.onSend) this.onSend(command);
    }
    message(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
    update(stage, details = {}) { this.message({ type: 'update', protocol: 1, stage, ...details }); }
    ready(details = {}) { this.update('ready', { supported: true, maxBackupBytes: MAX_BACKUP, version: '2.4.0', ...details }); }
    close() { this.closed = true; this.onclose?.({}); }
    autoBackup() {
      this.onSend = command => {
        if (command.command === 'backup-begin') { this.received = 0; this.update('backup-started'); }
        if (command.command === 'backup-chunk') {
          this.received += Buffer.from(command.data, 'base64').length;
          this.update('backup-chunk', { received: this.received });
        }
        if (command.command === 'backup-end') this.update('backup-saved', { backupPath: BACKUP_PATH });
      };
    }
  }
  const context = {
    ZN: {}, location: new URL(options.url || URL_WITH_HOST), URLSearchParams, console,
    TextEncoder: options.encoder || TextEncoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    WebSocket: options.websocket === false ? undefined : FakeSocket,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { events.set(name, fn); },
    fetch() { throw new Error('The bridge must not contact the internet.'); }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/update-native.js'), 'utf8'), context);
  const bridge = context.ZN.updateNative;
  return {
    bridge, sockets, timers, events,
    fire(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    },
    async connect(details) {
      const pending = bridge.connect();
      const socket = sockets.at(-1);
      socket.ready(details);
      await pending;
      return socket;
    },
    async start(data = backup(), version = '2.4.1', progress) {
      const socket = await this.connect();
      socket.autoBackup();
      const result = bridge.install(data, version, progress);
      await turn();
      assert.equal(socket.sent.at(-1).command, 'install');
      return { socket, result };
    }
  };
}

test('eligible launcher URLs enable the bridge without opening any connection', () => {
  const h = harness();
  assert.equal(h.bridge.available, true);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.sockets.length, 0);
});

test('hosted pages, absent capabilities, and malformed capability parameters cannot reach native updater', async () => {
  const bad = [APP, 'https://example.com/Z%20Note.html?zn-awake-port=47231&zn-awake-token=' + TOKEN,
    APP + '?zn-awake-port=0&zn-awake-token=' + TOKEN,
    APP + '?zn-awake-port=65536&zn-awake-token=' + TOKEN,
    APP + '?zn-awake-port=47231&zn-awake-token=bad'];
  for (const url of bad) {
    const h = harness({ url });
    assert.equal(h.bridge.available, false);
    await assert.rejects(h.bridge.connect(), /Open Z Note.cmd/);
    assert.equal(h.sockets.length, 0);
  }
  const h = harness({ websocket: false });
  assert.equal(h.bridge.available, false);
  await assert.rejects(h.bridge.connect());
});

test('capability probe uses only authenticated update endpoint and never starts installation', async () => {
  const h = harness();
  const first = h.bridge.connect(), second = h.bridge.connect();
  assert.equal(first, second);
  const socket = h.sockets[0];
  assert.equal(socket.url, 'ws://127.0.0.1:47231/update/' + TOKEN);
  socket.ready();
  await first;
  assert.equal(h.bridge.state().supported, true);
  assert.equal(h.bridge.state().version, '2.4.0');
  assert.equal(socket.sent.length, 0);
  assert.equal(h.timers.size, 0);
});

test('old host and invalid ready messages fail without attempting a backup or install', async () => {
  for (const message of [
    { type: 'state', protocol: 1, active: false },
    { type: 'update', protocol: 1, stage: 'ready', supported: false, version: '2.4.0', maxBackupBytes: MAX_BACKUP },
    { type: 'update', protocol: 1, stage: 'ready', supported: true, version: '2.4.0', maxBackupBytes: MAX_BACKUP + 1 },
    { type: 'update', protocol: 1, stage: 'ready', supported: true, version: 'broken', maxBackupBytes: MAX_BACKUP }
  ]) {
    const h = harness(), result = h.bridge.connect();
    h.sockets[0].message(message);
    await assert.rejects(result, /launcher|protocol/i);
    assert.equal(h.sockets[0].sent.length, 0);
    assert.equal(h.sockets[0].closed, true);
  }
});

test('constructor and handshake timeouts explain launcher recovery and clean up timers', async () => {
  const broken = harness({ constructorFailure: true });
  await assert.rejects(broken.bridge.connect(), /reopen Z Note\.exe/);
  assert.equal(broken.timers.size, 0);
  const h = harness(), result = h.bridge.connect();
  h.fire(8000);
  await assert.rejects(result, /reopen Z Note\.exe/);
  assert.equal(h.timers.size, 0);
});

test('invalid backup and unsafe version are rejected before any native operation', async () => {
  const h = harness();
  for (const version of ['v2.4.1', '2.4.1-rc1', '2.04.1', '../2.4.1', '2.4.1;run']) {
    await assert.rejects(h.bridge.install(backup(), version), /version/);
  }
  for (const data of [null, { app: 'other', version: 1, pages: [], images: [] }, { app: 'znote', version: 1, pages: [] }]) {
    await assert.rejects(h.bridge.install(data, '2.4.1'), /backup/);
  }
  assert.equal(h.sockets.length, 0);
});

test('complete UTF-8 backup is acknowledged in bounded chunks before install is sent', async () => {
  const h = harness(), data = backup(), stages = [];
  data.pages[0].content.text = 'မြန်မာ 🌱 '.repeat(9000);
  const original = JSON.stringify(data);
  const { socket, result } = await h.start(data, '2.4.1', value => stages.push(value.stage));
  const begin = socket.sent[0], chunks = socket.sent.filter(x => x.command === 'backup-chunk');
  assert.equal(begin.bytes, Buffer.byteLength(original, 'utf8'));
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(Buffer.from(chunk.data, 'base64').length <= 32768);
    assert.ok(Buffer.byteLength(JSON.stringify(chunk), 'utf8') < 49152);
  }
  assert.equal(Buffer.concat(chunks.map(c => Buffer.from(c.data, 'base64'))).toString('utf8'), original);
  assert.equal(socket.sent.at(-2).command, 'backup-end');
  assert.deepEqual(socket.sent.at(-1), { command: 'install', version: '2.4.1' });
  assert.equal(h.bridge.state().backupPath, BACKUP_PATH);
  assert.equal(JSON.stringify(data), original, 'backup input is not mutated');
  let finished = false;
  result.then(() => { finished = true; });
  socket.update('progress', { message: 'Downloading verified release…' });
  socket.update('progress', { message: 'Installing application files…' });
  await turn();
  assert.equal(finished, false, 'progress is not completion');
  socket.update('installed', { version: '2.4.1', backupPath: BACKUP_PATH });
  const installed = await result;
  assert.equal(installed.version, '2.4.1');
  assert.equal(installed.backupPath, BACKUP_PATH);
  assert.ok(stages.includes('backup-saved'));
  assert.deepEqual(stages.slice(-3), ['progress', 'progress', 'installed']);
  assert.equal(h.timers.size, 0);
  assert.equal(h.bridge.state().busy, false);
});

test('backup acknowledgement counts must match exactly and cannot skip backup completion', async () => {
  const h = harness(), socket = await h.connect();
  const result = h.bridge.install(backup(), '2.4.1');
  const rejected = assert.rejects(result, /confirm/);
  await turn();
  socket.update('backup-started');
  await turn();
  socket.update('backup-chunk', { received: 1 });
  await rejected;
  assert.equal(socket.sent.some(x => x.command === 'install'), false);
  assert.equal(h.bridge.state().installAttempted, false);
  assert.equal(socket.closed, true);
});

test('missing backup-saved path fails closed and sends no installation command', async () => {
  const h = harness(), socket = await h.connect();
  socket.autoBackup();
  const acknowledge = socket.onSend;
  socket.onSend = command => command.command === 'backup-end' ? socket.update('backup-saved') : acknowledge(command);
  await assert.rejects(h.bridge.install(backup(), '2.4.1'), /confirm/);
  assert.equal(socket.sent.some(x => x.command === 'install'), false);
});

test('partial backup connection failure stops transfer and explicit retry opens a fresh session', async () => {
  const h = harness(), socket = await h.connect();
  const result = h.bridge.install(backup(), '2.4.1');
  const rejected = assert.rejects(result, /did not respond/);
  await turn();
  socket.close();
  await rejected;
  assert.equal(socket.sent.some(x => x.command === 'install'), false);
  const newSocket = await h.connect();
  assert.notEqual(newSocket, socket);
  assert.equal(h.sockets.length, 2);
});

test('backup timeout prevents installation and resets busy state', async () => {
  const h = harness();
  await h.connect();
  const result = h.bridge.install(backup(), '2.4.1');
  const rejected = assert.rejects(result, /saving your backup/);
  await turn();
  h.fire(30000);
  await rejected;
  assert.equal(h.bridge.state().busy, false);
  assert.equal(h.bridge.state().installAttempted, false);
});

test('native backup size limit is checked before sending data', async () => {
  const h = harness();
  const socket = await h.connect({ maxBackupBytes: 10 });
  await assert.rejects(h.bridge.install(backup(), '2.4.1'), /limit/);
  assert.equal(socket.sent.length, 0);
  const oversized = harness({ encoder: class { encode() { return { length: MAX_BACKUP + 1 }; } } });
  await assert.rejects(oversized.bridge.install(backup(), '2.4.1'), /too large/);
  assert.equal(oversized.sockets.length, 0);
});

test('duplicate install calls cannot overlap, and completed installs cannot replay in the same page', async () => {
  const h = harness(), { socket, result } = await h.start();
  await assert.rejects(h.bridge.install(backup(), '2.4.1'), /already in progress/);
  socket.update('installed', { version: '2.4.1', backupPath: BACKUP_PATH });
  await result;
  await assert.rejects(h.bridge.install(backup(), '2.4.2'), /already been started/);
  assert.equal(socket.sent.filter(x => x.command === 'install').length, 1);
});

test('disconnect after install was sent is uncertain and never reconnects or reinstalls automatically', async () => {
  const h = harness(), { socket, result } = await h.start();
  const rejected = assert.rejects(result, e => /Do not start another update/.test(e.message) && e.uncertain && e.reopenRequired);
  socket.close();
  await rejected;
  await assert.rejects(h.bridge.install(backup(), '2.4.1'), /already been started/);
  await assert.rejects(h.bridge.connect(), /already been started/);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.bridge.state().backupPath, BACKUP_PATH);
});

test('installation timeout remains uncertain even after valid progress messages', async () => {
  const h = harness(), { socket, result } = await h.start();
  const rejected = assert.rejects(result, e => /not confirmed in time/.test(e.message) && e.uncertain);
  socket.update('progress', { message: 'Still installing' });
  h.fire(180000);
  await rejected;
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.bridge.install(backup(), '2.4.1'), /already been started/);
});

test('wrong installed version or backup path never reports successful installation', async () => {
  for (const details of [{ version: '2.9.0', backupPath: BACKUP_PATH }, { version: '2.4.1', backupPath: 'C:\\elsewhere.json' }]) {
    const h = harness(), { socket, result } = await h.start();
    const rejected = assert.rejects(result, /confirm/);
    socket.update('installed', details);
    await rejected;
    assert.equal(h.bridge.state().installedVersion, '');
  }
});

test('native error and malformed replies reject rather than treating failure as completion', async () => {
  for (const reply of [
    { type: 'update', protocol: 1, stage: 'error', message: 'Package digest mismatch. Previous app preserved.' },
    '{broken',
    { type: 'update', protocol: 99, stage: 'installed', version: '2.4.1', backupPath: BACKUP_PATH }
  ]) {
    const h = harness(), { socket, result } = await h.start();
    const rejected = assert.rejects(result);
    socket.message(reply);
    await rejected;
    assert.equal(h.bridge.state().installedVersion, '');
    assert.equal(h.bridge.state().busy, false);
  }
});

test('pagehide closes the native session and rejects pending work without replay', async () => {
  const h = harness(), socket = await h.connect();
  const result = h.bridge.install(backup(), '2.4.1');
  const rejected = assert.rejects(result, /connection was closed/);
  await turn();
  h.events.get('pagehide')();
  await rejected;
  assert.equal(socket.closed, true);
  await assert.rejects(h.bridge.connect());
  assert.equal(h.timers.size, 0);
});
