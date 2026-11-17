'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/js/awake.js'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener({ type, target: this });
    }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sentinel() {
  return Object.assign(eventTarget(), {
    released: false,
    releaseCalls: 0,
    release() {
      this.releaseCalls++;
      this.autoRelease();
      return Promise.resolve();
    },
    autoRelease() {
      if (this.released) return;
      this.released = true;
      this.dispatch('release');
    }
  });
}

function harness({ supported = true } = {}) {
  const document = Object.assign(eventTarget(), { visibilityState: 'visible', hidden: false });
  const requests = [];
  const toasts = [];
  const ZN = {
    util: {},
    ui: { toast: (...args) => toasts.push(args) }
  };
  const navigator = supported ? {
    wakeLock: {
      request(type) {
        assert.equal(type, 'screen', 'only a screen wake lock is requested');
        const pending = deferred();
        requests.push(pending);
        return pending.promise;
      }
    }
  } : {};
  const context = Object.assign(eventTarget(), {
    ZN, document, navigator, isSecureContext: true,
    console, setTimeout, clearTimeout, queueMicrotask
  });
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'app/js/awake.js' });
  const awake = ZN.awake;
  awake.init();
  return {
    awake, requests, toasts,
    visibility(value) {
      document.visibilityState = value;
      document.hidden = value !== 'visible';
      document.dispatch('visibilitychange');
    },
    page(type) { context.dispatch(type); },
    grant(index = requests.length - 1) {
      const lock = sentinel();
      requests[index].resolve(lock);
      return lock;
    }
  };
}

// Flush promise continuations without relying on implementation-specific timers.
const settle = () => new Promise(resolve => setImmediate(resolve));

test('starts off and does not request power protection during initialization', () => {
  const h = harness();
  const state = h.awake.state();
  assert.equal(state.supported, true);
  assert.equal(state.enabled, false);
  assert.equal(state.active, false);
  assert.equal(state.pending, false);
  assert.equal(h.requests.length, 0);
});

test('reports an unsupported browser without trying to acquire a lock', async () => {
  const h = harness({ supported: false });
  await h.awake.start();
  const state = h.awake.state();
  assert.equal(state.supported, false);
  assert.equal(state.enabled, false);
  assert.equal(state.active, false);
  assert.equal(state.pending, false);
  assert.equal(h.requests.length, 0);
});

test('rapid repeated starts share one request and active starts are idempotent', async () => {
  const h = harness();
  const first = h.awake.start();
  const second = h.awake.start();
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.awake.state().pending, true);
  assert.equal(h.awake.state().active, false);
  h.grant();
  await Promise.all([first, second]);
  await settle();
  assert.equal(h.awake.state().active, true);
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.awake.state().pending, false);
  await h.awake.start();
  assert.equal(h.requests.length, 1);
});

test('stop releases an acquired lock and repeated stop does not release again', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const lock = h.grant();
  await started;
  await h.awake.stop();
  await h.awake.stop();
  assert.equal(lock.released, true);
  assert.equal(lock.releaseCalls, 1);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().pending, false);
});

test('a rejected request stays inactive and can be retried successfully', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  h.requests[0].reject(Object.assign(new Error('Power saving prevented the request'), { name: 'NotAllowedError' }));
  await started;
  await settle();
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().pending, false);
  assert.ok(h.awake.state().error);
  const retry = h.awake.start();
  await settle();
  assert.equal(h.requests.length, 2);
  h.grant();
  await retry;
  assert.equal(h.awake.state().active, true);
  assert.ok(!h.awake.state().error);
});

test('a sentinel already released by the browser is never reported active', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const lock = sentinel();
  lock.autoRelease();
  h.requests[0].resolve(lock);
  await started;
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().pending, false);
  assert.ok(h.awake.state().error);
});

test('a failed release remains truthfully active and can be stopped again', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const lock = h.grant();
  await started;
  const normalRelease = lock.release;
  lock.release = () => Promise.reject(new Error('Temporary release failure'));
  await h.awake.stop();
  assert.equal(h.awake.state().active, true, 'retain the live sentinel after failure');
  assert.ok(h.awake.state().error);
  lock.release = normalRelease;
  await h.awake.stop();
  assert.equal(lock.released, true);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.ok(!h.awake.state().error);
});

test('hiding releases the lock and showing resumes only the enabled session', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const firstLock = h.grant();
  await started;
  h.visibility('hidden');
  await settle();
  assert.equal(firstLock.released, true);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, true);
  h.visibility('visible');
  await settle();
  assert.equal(h.requests.length, 2);
  h.grant();
  await settle();
  assert.equal(h.awake.state().active, true);
  await h.awake.stop();
  h.visibility('hidden');
  h.visibility('visible');
  await settle();
  assert.equal(h.requests.length, 2, 'a stopped session never resumes automatically');
});

test('a request granted after Stop is released without activating the feature', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const stopped = h.awake.stop();
  const lock = h.grant();
  await Promise.all([started, stopped]);
  await settle();
  assert.equal(lock.released, true);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().pending, false);
});

test('Start, Stop, Start while acquisition is pending preserves the newest intent', async () => {
  const h = harness();
  const firstStart = h.awake.start();
  await settle();
  const stopped = h.awake.stop();
  const latestStart = h.awake.start();
  assert.equal(h.requests.length, 1, 'requests remain serialized');
  const staleLock = h.grant(0);
  await settle();
  assert.equal(staleLock.released, true);
  assert.equal(h.requests.length, 2, 'the cancelled request is replaced');
  const currentLock = h.grant(1);
  await Promise.all([firstStart, stopped, latestStart]);
  await settle();
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.awake.state().active, true);
  assert.equal(h.awake.state().pending, false);
  assert.equal(currentLock.released, false);
});

test('a stale denied request does not cancel a newer Start', async () => {
  const h = harness();
  const firstStart = h.awake.start();
  await settle();
  const stopped = h.awake.stop();
  const latestStart = h.awake.start();
  h.requests[0].reject(Object.assign(new Error('Old request denied'), { name: 'NotAllowedError' }));
  await settle();
  assert.equal(h.requests.length, 2);
  h.grant(1);
  await Promise.all([firstStart, stopped, latestStart]);
  await settle();
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.awake.state().active, true);
  assert.ok(!h.awake.state().error);
});

test('starting while hidden waits for visibility before requesting a lock', async () => {
  const h = harness();
  h.visibility('hidden');
  await h.awake.start();
  assert.equal(h.requests.length, 0);
  assert.equal(h.awake.state().enabled, true);
  assert.equal(h.awake.state().active, false);
  h.visibility('visible');
  await settle();
  assert.equal(h.requests.length, 1);
  h.grant();
  await settle();
  assert.equal(h.awake.state().active, true);
});

test('a request granted after hiding is released and resumed on the next visible event', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  h.visibility('hidden');
  const lock = h.grant();
  await started;
  await settle();
  assert.equal(lock.released, true);
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, true);
  h.visibility('visible');
  await settle();
  assert.equal(h.requests.length, 2);
  h.grant();
  await settle();
  assert.equal(h.awake.state().active, true);
});

test('a late release event from an old lock cannot clear the new active lock', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const oldLock = h.grant();
  await started;
  h.visibility('hidden');
  await settle();
  h.visibility('visible');
  await settle();
  const currentLock = h.grant();
  await settle();
  oldLock.dispatch('release');
  assert.equal(h.awake.state().active, true);
  assert.equal(currentLock.released, false);
});

test('an intentional hide release finishing after visibility returns still resumes', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const oldLock = h.grant();
  await started;
  const releaseFinished = deferred();
  oldLock.release = () => {
    oldLock.releaseCalls++;
    return releaseFinished.promise;
  };
  h.visibility('hidden');
  await settle();
  assert.equal(oldLock.releaseCalls, 1);
  h.visibility('visible');
  oldLock.autoRelease();
  releaseFinished.resolve();
  await settle();
  assert.equal(h.awake.state().enabled, true);
  assert.ok(!h.awake.state().error);
  assert.equal(h.requests.length, 2);
  h.grant();
  await settle();
  assert.equal(h.awake.state().active, true);
});

test('a system release updates state without immediately fighting the browser policy', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const lock = h.grant();
  await started;
  lock.autoRelease();
  await settle();
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.ok(h.awake.state().error);
  assert.equal(h.requests.length, 1, 'no automatic immediate retry loop');
});

test('a system release still disables intent after Stop and Start reuse an active lock', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const firstLock = h.grant();
  await started;
  const stopped = h.awake.stop();
  const restarted = h.awake.start();
  await settle();
  // Both keeping the still-active lock and releasing/replacing it are valid.
  const currentLock = h.requests.length > 1 ? h.grant() : firstLock;
  await Promise.all([stopped, restarted]);
  assert.equal(h.awake.state().active, true);
  currentLock.autoRelease();
  await settle();
  assert.equal(h.awake.state().active, false);
  assert.equal(h.awake.state().enabled, false);
  assert.ok(h.awake.state().error);
});

test('pagehide stops protection and a cached pageshow does not auto-enable it', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  const lock = h.grant();
  await started;
  h.page('pagehide');
  await settle();
  assert.equal(lock.released, true);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
  h.page('pageshow');
  h.visibility('visible');
  await settle();
  await settle();
  assert.equal(h.requests.length, 1);
});

test('pagehide also disposes a late pending grant', async () => {
  const h = harness();
  const started = h.awake.start();
  await settle();
  h.page('pagehide');
  const lock = h.grant();
  await started;
  await settle();
  assert.equal(lock.released, true);
  assert.equal(h.awake.state().enabled, false);
  assert.equal(h.awake.state().active, false);
});

test('subscribers observe state changes and can unsubscribe', async () => {
  const h = harness();
  let updates = 0;
  const unsubscribe = h.awake.subscribe(() => { updates++; });
  const baseline = updates;
  const started = h.awake.start();
  await settle();
  h.grant();
  await started;
  assert.ok(updates > baseline);
  unsubscribe();
  const previous = updates;
  await h.awake.stop();
  assert.equal(updates, previous);
});

test('repeated initialization does not duplicate visibility requests', async () => {
  const h = harness();
  h.awake.init();
  h.awake.init();
  const started = h.awake.start();
  await settle();
  h.grant();
  await started;
  h.visibility('hidden');
  await settle();
  h.visibility('visible');
  await settle();
  assert.equal(h.requests.length, 2);
  h.grant();
  await settle();
  assert.equal(h.awake.state().active, true);
});
