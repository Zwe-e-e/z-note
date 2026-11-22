'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/js/awake.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    dispatch(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, target: this }); }
  };
}

function harness({ hidden = false, connectError = '' } = {}) {
  const nativeListeners = new Set(), calls = [], toasts = [];
  let connected = false, active = false, error = '', closed = false;
  let browserRequests = 0, connectCalls = 0, closeCalls = 0;
  const nativeState = () => ({ connected, active, error });
  const emit = () => nativeListeners.forEach(fn => fn(nativeState()));
  function request(kind) {
    if (closed) return Promise.reject(new Error('Session closed. Reopen Z Note.'));
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ kind, promise, resolve, reject, settled: false });
    return promise;
  }
  const native = {
    available: true,
    state: nativeState,
    connect() {
      connectCalls++;
      if (connectError) { error = connectError; emit(); return Promise.reject(new Error(error)); }
      connected = true; error = ''; emit(); return Promise.resolve();
    },
    start: () => request('start'), stop: () => request('stop'),
    subscribe(fn) { nativeListeners.add(fn); return () => nativeListeners.delete(fn); },
    close() {
      closeCalls++; closed = true; connected = false; active = false; error = 'Session closed';
      for (const call of calls) if (!call.settled) { call.settled = true; call.reject(new Error(error)); }
      emit();
    }
  };
  const document = Object.assign(eventTarget(), { visibilityState: hidden ? 'hidden' : 'visible', hidden });
  const context = Object.assign(eventTarget(), {
    ZN: { awakeNative: native, ui: { toast: (...args) => toasts.push(args) }, util: {} },
    navigator: { wakeLock: { request() { browserRequests++; return Promise.reject(new Error('Browser lock must not be used in native mode')); } } },
    document, isSecureContext: true, console, setTimeout, clearTimeout, queueMicrotask
  });
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'app/js/awake.js' });
  const awake = context.ZN.awake;
  awake.init();
  return {
    awake, native, calls, toasts,
    get browserRequests() { return browserRequests; },
    get connectCalls() { return connectCalls; },
    get closeCalls() { return closeCalls; },
    get subscriberCount() { return nativeListeners.size; },
    visibility(value) { document.visibilityState = value; document.hidden = value !== 'visible'; document.dispatch('visibilitychange'); },
    page(type) { context.dispatch(type); },
    grant(index = calls.length - 1) {
      const call = calls[index];
      assert.ok(call, 'expected a native command to acknowledge');
      call.settled = true; connected = true; active = call.kind === 'start'; error = ''; emit(); call.resolve();
    },
    fail(index = calls.length - 1, message = 'Windows helper disconnected') {
      connected = false; active = false; error = message;
      const call = calls[index];
      if (call && !call.settled) { call.settled = true; call.reject(new Error(message)); }
      emit();
    }
  };
}

test('native initialization connects once without automatically requesting power', async () => {
  const h = harness();
  h.awake.init();
  await settle();
  assert.equal(h.connectCalls, 1);
  assert.equal(h.subscriberCount, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.browserRequests, 0);
  assert.equal(h.awake.state().supported, true);
  assert.equal(h.awake.state().mode, 'windows');
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
});

test('native mode can start while the document is already hidden', async () => {
  const h = harness({ hidden: true });
  const start = h.awake.start();
  await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
  assert.equal(h.awake.state().active, false);
  h.grant(); await start;
  assert.equal(h.awake.state().active, true);
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.browserRequests, 0);
});

test('hiding, covering, and restoring an active native session never pause it', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.grant(); await start;
  h.visibility('hidden'); await settle();
  assert.equal(h.awake.state().active, true);
  assert.equal(h.awake.state().enabled, true);
  h.visibility('visible'); await settle();
  assert.equal(h.awake.state().active, true);
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
  assert.equal(h.browserRequests, 0);
});

test('active state follows native acknowledgements for both start and stop', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle();
  assert.equal(h.awake.state().pending, true);
  assert.equal(h.awake.state().active, false);
  h.grant(); await start;
  assert.equal(h.awake.state().active, true);
  const stop = h.awake.stop();
  await settle();
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, true, 'power remains requested until helper acknowledgement');
  h.grant(); await stop;
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().pending, false);
  assert.equal(h.browserRequests, 0);
});

test('rapid repeated starts are idempotent after the first acknowledgement', async () => {
  const h = harness();
  const first = h.awake.start();
  const second = h.awake.start();
  await settle();
  h.grant(); await first; await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
  await second;
  await h.awake.start();
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
});

test('cancelling a pending native start releases its late grant', async () => {
  const h = harness();
  const first = h.awake.start();
  await settle();
  const cancelled = h.awake.stop();
  h.grant(0); await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start', 'stop']);
  h.grant(1); await Promise.all([first, cancelled]);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().pending, false);
});

test('start, cancel, restart settles the newest intent without duplicate activation', async () => {
  const h = harness();
  const first = h.awake.start();
  await settle();
  const cancelled = h.awake.stop();
  const restarted = h.awake.start();
  h.grant(0); await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start', 'stop']);
  h.grant(1); await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start', 'stop', 'start']);
  h.grant(2); await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start', 'stop', 'start']);
  await Promise.all([first, cancelled, restarted]);
  assert.equal(h.awake.state().active, true);
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.awake.state().pending, false);
});

test('native disconnect clears active intent and reports the failure without auto-restarting', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.grant(); await start;
  h.fail(); await settle();
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.match(h.awake.state().error, /disconnected/);
  assert.ok(h.toasts.some(args => /disconnected/.test(args[0])));
  h.visibility('hidden'); h.visibility('visible'); await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
  assert.equal(h.browserRequests, 0);
});

test('startup connection failure is shown without falling back to a browser lock', async () => {
  const h = harness({ connectError: 'Cannot connect to the Windows helper' });
  await settle();
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.match(h.awake.state().error, /Cannot connect/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.browserRequests, 0);
});

test('native start error reports off and clears pending', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.fail(0, 'Windows refused Start'); await start;
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().pending, false);
  assert.match(h.awake.state().error, /refused Start/);
  assert.equal(h.browserRequests, 0);
});

test('native stop error follows disconnected helper state and remains off', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.grant(); await start;
  const stop = h.awake.stop();
  await settle(); h.fail(1, 'Stop acknowledgement lost'); await stop;
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().pending, false);
  assert.match(h.awake.state().error, /acknowledgement lost/);
});

test('transport failure cancels a restart queued before that failure', async () => {
  const h = harness();
  const first = h.awake.start();
  await settle();
  const cancelled = h.awake.stop();
  const restart = h.awake.start();
  h.fail(0);
  await Promise.all([first, cancelled, restart]);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
});

test('pagehide closes an active native session and cached pageshow never restarts it', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.grant(); await start;
  h.page('pagehide'); await settle();
  assert.equal(h.closeCalls, 1);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  h.page('pageshow'); await settle();
  assert.equal(h.connectCalls, 1);
  assert.deepEqual(h.calls.map(c => c.kind), ['start']);
  assert.equal(h.toasts.length, 0, 'normal close is not shown as a failure');
});

test('pagehide during a pending start closes the bridge without an unhandled error', async () => {
  const h = harness();
  const start = h.awake.start();
  await settle(); h.page('pagehide'); await start;
  assert.equal(h.closeCalls, 1);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().pending, false);
  assert.equal(h.toasts.length, 0);
});

test('a user action after cached-page restoration asks to reopen and cannot re-enable a closed bridge', async () => {
  const h = harness();
  h.page('pagehide'); h.page('pageshow');
  await h.awake.start();
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.calls.length, 0);
  assert.match(h.awake.state().error, /reopen/i);
  assert.equal(h.browserRequests, 0);
});
