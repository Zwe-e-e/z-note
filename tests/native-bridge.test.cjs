'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const TOKEN = 'ab'.repeat(32);
const APP = 'file:///E:/Z%20Note/Z%20Note.html';
const VALID_URL = APP + '?zn-awake-port=47231&zn-awake-token=' + TOKEN;
const settle = () => new Promise(resolve => setImmediate(resolve));

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, data = {}) {
      const event = Object.assign({ type, target: this }, data);
      this['on' + type]?.(event);
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    }
  };
}

function harness({ url = VALID_URL, websocket = true, constructorFailure = false } = {}) {
  const sockets = [], timers = new Map();
  let timerId = 0;
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(endpoint) {
      if (constructorFailure) throw new Error('WebSocket construction blocked');
      Object.assign(this, events());
      this.url = endpoint;
      this.sent = [];
      this.readyState = FakeSocket.CONNECTING;
      this.closeCalls = 0;
      sockets.push(this);
    }
    open() { this.readyState = FakeSocket.OPEN; this.emit('open'); }
    send(data) {
      assert.equal(this.readyState, FakeSocket.OPEN, 'commands require an open socket');
      this.sent.push(data);
    }
    message(value) { this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) }); }
    close() { this.closeCalls++; this.readyState = FakeSocket.CLOSED; this.emit('close'); }
    disconnect() { this.readyState = FakeSocket.CLOSED; this.emit('close', { code: 1006 }); }
  }
  const location = new URL(url);
  const ZN = {};
  const context = Object.assign(events(), {
    ZN, location, URL, URLSearchParams, console,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    queueMicrotask
  });
  if (websocket) context.WebSocket = FakeSocket;
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/awake-native.js'), 'utf8'), context, { filename: 'app/js/awake-native.js' });
  return {
    bridge: ZN.awakeNative, sockets, timers,
    fireTimers() {
      for (const [id, timer] of [...timers]) {
        if (!timers.delete(id)) continue;
        timer.fn();
      }
    },
    state(socket = sockets[sockets.length - 1], active = false) {
      socket.message({ type: 'state', active, protocol: 1 });
    },
    async connect() {
      const pending = ZN.awakeNative.connect();
      await settle();
      const socket = sockets[sockets.length - 1];
      socket.open();
      this.state(socket, false);
      await pending;
      return socket;
    }
  };
}

test('valid local launcher parameters enable native mode without opening a socket', () => {
  const h = harness();
  assert.equal(h.bridge.available, true);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.sockets.length, 0);
});

test('hosted pages and invalid launcher credentials never enable native access', () => {
  const badUrls = [
    APP,
    APP + '?zn-awake-port=47231',
    APP + '?zn-awake-token=' + TOKEN,
    'https://example.com/Z%20Note.html?zn-awake-port=47231&zn-awake-token=' + TOKEN,
    'http://localhost/Z%20Note.html?zn-awake-port=47231&zn-awake-token=' + TOKEN,
    ...['', '1023', '65536', '-1', '1234.5', '1234abc', '1e4'].map(port => APP + '?zn-awake-port=' + port + '&zn-awake-token=' + TOKEN),
    ...['', 'aa', TOKEN + 'a', 'g'.repeat(64), '127.0.0.1:1234'].map(token => APP + '?zn-awake-port=47231&zn-awake-token=' + token)
  ];
  for (const url of badUrls) {
    const h = harness({ url });
    assert.equal(h.bridge.available, false, url);
    assert.equal(h.sockets.length, 0, url);
  }
});

test('both allowed port boundaries are accepted', () => {
  for (const port of [1024, 65535]) {
    assert.equal(harness({ url: APP + '?zn-awake-port=' + port + '&zn-awake-token=' + TOKEN }).bridge.available, true);
  }
});

test('unavailable bridge rejects connect without trying another transport', async () => {
  const h = harness({ url: APP });
  await assert.rejects(h.bridge.connect());
  assert.equal(h.sockets.length, 0);
  assert.equal(h.bridge.state().active, false);
});

test('missing WebSocket support cannot enable native mode', async () => {
  const h = harness({ websocket: false });
  assert.equal(h.bridge.available, false);
  await assert.rejects(h.bridge.connect());
  assert.equal(h.sockets.length, 0);
});

test('synchronous socket construction failure rejects the handshake and clears its timeout', async () => {
  const h = harness({ constructorFailure: true });
  await assert.rejects(h.bridge.connect());
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
  assert.ok(h.bridge.state().error);
  assert.equal(h.timers.size, 0);
});

test('connect waits for a valid server state, and concurrent connects share one socket', async () => {
  const h = harness();
  let settled = false;
  const first = h.bridge.connect().then(() => { settled = true; });
  const second = h.bridge.connect();
  await settle();
  assert.equal(h.sockets.length, 1);
  const socket = h.sockets[0];
  assert.equal(socket.url, 'ws://127.0.0.1:47231/awake/' + TOKEN);
  socket.open();
  await settle();
  assert.equal(settled, false, 'TCP/WebSocket open is not a native-state acknowledgement');
  assert.equal(h.bridge.state().connected, false);
  h.state(socket, false);
  await Promise.all([first, second]);
  assert.equal(h.bridge.state().connected, true);
  assert.equal(h.bridge.state().active, false);
  assert.equal(socket.sent.includes('start'), false);
  assert.equal(h.timers.size, 0);
});

test('connection timeout closes the socket and never automatically reconnects', async () => {
  const h = harness();
  const pending = assert.rejects(h.bridge.connect());
  await settle();
  assert.ok([...h.timers.values()].some(timer => timer.delay === 5000));
  h.fireTimers();
  await pending;
  assert.ok(h.sockets[0].closeCalls > 0);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
  assert.ok(h.bridge.state().error);
  h.fireTimers();
  await settle();
  assert.equal(h.sockets.length, 1);
});

test('start and stop change active only after the matching native acknowledgement', async () => {
  const h = harness();
  const socket = await h.connect();
  const start = h.bridge.start();
  await settle();
  assert.equal(socket.sent[socket.sent.length - 1], 'start');
  assert.equal(h.bridge.state().active, false);
  h.state(socket, true);
  await start;
  assert.equal(h.bridge.state().active, true);
  const stop = h.bridge.stop();
  await settle();
  assert.equal(socket.sent[socket.sent.length - 1], 'stop');
  assert.equal(h.bridge.state().active, true, 'do not falsely show off before the helper releases');
  h.state(socket, false);
  await stop;
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.timers.size, 0);
});

test('opposite commands are serialized so one response cannot acknowledge both', async () => {
  const h = harness();
  const socket = await h.connect();
  const start = h.bridge.start();
  const stop = h.bridge.stop();
  await settle();
  assert.deepEqual(socket.sent.filter(x => x === 'start' || x === 'stop'), ['start']);
  h.state(socket, true);
  await start;
  await settle();
  assert.deepEqual(socket.sent.filter(x => x === 'start' || x === 'stop'), ['start', 'stop']);
  h.state(socket, false);
  await stop;
  assert.equal(h.bridge.state().active, false);
});

test('mismatched start acknowledgement rejects and closes for native cleanup', async () => {
  const h = harness();
  const socket = await h.connect();
  const pending = assert.rejects(h.bridge.start());
  await settle();
  h.state(socket, false);
  await pending;
  assert.ok(socket.closeCalls > 0);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
});

test('mismatched stop acknowledgement rejects and drops the active connection', async () => {
  const h = harness();
  const socket = await h.connect();
  const start = h.bridge.start();
  await settle(); h.state(socket, true); await start;
  const pending = assert.rejects(h.bridge.stop());
  await settle(); h.state(socket, true); await pending;
  assert.ok(socket.closeCalls > 0);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
});

test('missing command acknowledgement times out, closes, and does not replay start', async () => {
  const h = harness();
  const socket = await h.connect();
  const pending = assert.rejects(h.bridge.start());
  await settle();
  assert.ok([...h.timers.values()].some(timer => timer.delay === 5000));
  h.fireTimers();
  await pending;
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.bridge.state().connected, false);
  h.fireTimers(); await settle();
  assert.equal(h.sockets.length, 1);
  assert.equal(socket.sent.filter(x => x === 'start').length, 1);
});

test('malformed or incompatible initial messages reject connection and close it', async () => {
  for (const message of [
    'not json',
    { type: 'state', active: false, protocol: 2 },
    { type: 'state', active: 'false', protocol: 1 },
    { type: 'state', active: false },
    { type: 'other', active: false, protocol: 1 }
  ]) {
    const h = harness();
    const pending = assert.rejects(h.bridge.connect());
    await settle();
    const socket = h.sockets[0];
    socket.open(); socket.message(message);
    await pending;
    assert.ok(socket.closeCalls > 0);
    assert.equal(h.bridge.state().connected, false);
    assert.equal(h.bridge.state().active, false);
  }
});

test('native error rejects the pending command and drops active state', async () => {
  const h = harness();
  const socket = await h.connect();
  const pending = assert.rejects(h.bridge.start());
  await settle();
  socket.message({ type: 'error', message: 'Windows refused the power request.' });
  await pending;
  assert.ok(socket.closeCalls > 0);
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.bridge.state().connected, false);
  assert.ok(h.bridge.state().error);
});

test('socket failure rejects pending work without automatic retry', async () => {
  const h = harness();
  const socket = await h.connect();
  const pending = assert.rejects(h.bridge.start());
  await settle();
  socket.emit('error');
  await pending;
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.bridge.state().connected, false);
  h.fireTimers(); await settle();
  assert.equal(h.sockets.length, 1);
});

test('transport failure cancels queued commands without reconnecting or replaying a stale start', async () => {
  const h = harness();
  const socket = await h.connect();
  const first = assert.rejects(h.bridge.start());
  const queuedStop = assert.rejects(h.bridge.stop());
  const queuedStart = assert.rejects(h.bridge.start());
  await settle();
  assert.deepEqual(socket.sent.filter(x => x === 'start' || x === 'stop'), ['start']);
  socket.disconnect();
  await Promise.all([first, queuedStop, queuedStart]);
  h.fireTimers(); await settle();
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(socket.sent.filter(x => x === 'start' || x === 'stop'), ['start']);
  assert.equal(h.bridge.state().active, false);
});

test('disconnect after activation clears state and later explicit start can reconnect', async () => {
  const h = harness();
  const socket = await h.connect();
  const start = h.bridge.start();
  await settle(); h.state(socket, true); await start;
  socket.disconnect();
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.bridge.state().connected, false);
  h.fireTimers(); await settle();
  assert.equal(h.sockets.length, 1);
  const restart = h.bridge.start();
  await settle();
  assert.equal(h.sockets.length, 2);
  const replacement = h.sockets[1];
  replacement.open(); h.state(replacement, false);
  await settle();
  assert.equal(replacement.sent[replacement.sent.length - 1], 'start');
  h.state(replacement, true);
  await restart;
  assert.equal(h.bridge.state().active, true);
  // Old transport events must not resurrect or overwrite the new session.
  h.state(socket, false);
  socket.disconnect();
  assert.equal(h.bridge.state().connected, true);
  assert.equal(h.bridge.state().active, true);
});

test('close is terminal, rejects pending work, clears timers, and prevents reconnect', async () => {
  const h = harness();
  const socket = await h.connect();
  const pending = assert.rejects(h.bridge.start());
  await settle();
  h.bridge.close();
  await pending;
  assert.ok(socket.closeCalls > 0);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.bridge.connect());
  await assert.rejects(h.bridge.start());
  h.fireTimers(); await settle();
  assert.equal(h.sockets.length, 1);
});

test('closing during handshake rejects connect and ignores a late state message', async () => {
  const h = harness();
  const pending = assert.rejects(h.bridge.connect());
  await settle();
  const socket = h.sockets[0];
  h.bridge.close();
  await pending;
  socket.open(); h.state(socket, true);
  assert.equal(h.bridge.state().connected, false);
  assert.equal(h.bridge.state().active, false);
  assert.equal(h.timers.size, 0);
});

test('subscribers observe acknowledged states and may unsubscribe', async () => {
  const h = harness();
  const observed = [];
  const off = h.bridge.subscribe(state => observed.push({ connected: state.connected, active: state.active }));
  const socket = await h.connect();
  const start = h.bridge.start();
  await settle(); h.state(socket, true); await start;
  assert.ok(observed.some(s => s.connected && !s.active));
  assert.ok(observed.some(s => s.connected && s.active));
  off();
  const count = observed.length;
  socket.disconnect();
  assert.equal(observed.length, count);
  assert.equal(h.bridge.state().active, false);
});
