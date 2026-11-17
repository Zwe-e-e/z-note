/* Z Note · keep the screen awake while this window is visible */
(function () {
  'use strict';
  const ZN = window.ZN;
  const supported = window.isSecureContext !== false && !!(navigator.wakeLock && navigator.wakeLock.request);
  let enabled = false, lock = null, pending = false, error = '', version = 0;
  let work = Promise.resolve(), initialized = false, control = null;
  const listeners = new Set();
  const expectedReleases = new WeakSet();
  const visible = () => document.visibilityState === 'visible';

  function state() {
    return { enabled, active: !!(lock && !lock.released), pending, supported, error };
  }

  function notify() {
    if (control) paint();
    listeners.forEach(fn => {
      try { fn(state()); } catch (e) { console.error('[Z Note] Keep Awake listener', e); }
    });
  }

  function report(message) {
    error = message;
    ZN.ui.toast(message, { error: true, ms: 7000 });
  }

  async function release(previous) {
    expectedReleases.add(previous);
    try {
      await previous.release();
      if (lock === previous) lock = null;
    } catch (e) {
      expectedReleases.delete(previous);
      if (!previous.released) throw e;
      if (lock === previous) lock = null;
    }
  }

  // Serialize acquisitions and releases. A changed version invalidates an
  // in-flight request, even if the user has already switched on again.
  function reconcile() {
    work = work.then(async () => {
      if (lock && (!enabled || !visible())) {
        const previous = lock;
        try {
          await release(previous);
        } catch (e) {
          if (!previous.released) {
            report('Keep Awake could not stop. Try again, or close this Z Note window.');
            notify();
            return;
          }
          if (lock === previous) lock = null;
        }
      }
      if (!enabled || !visible() || (lock && !lock.released)) { notify(); return; }
      const attempt = version;
      pending = true;
      notify();
      try {
        const next = await navigator.wakeLock.request('screen');
        lock = next;
        next.addEventListener('release', () => {
          if (lock !== next) return;
          lock = null;
          if (enabled && visible() && !expectedReleases.has(next)) {
            enabled = false;
            report('The browser stopped Keep Awake. Click Keep Awake to try again.');
          }
          notify();
        });
        if (attempt !== version || !enabled || !visible()) {
          await release(next);
        } else if (next.released) {
          lock = null;
          enabled = false;
          report('Keep Awake is unavailable right now. Check your browser and battery-saving settings, then try again.');
        }
      } catch (e) {
        if (attempt === version && enabled && visible()) {
          enabled = false;
          report('Keep Awake could not start. Check your browser and battery-saving settings, then try again.');
        }
      } finally {
        pending = false;
        notify();
      }
    });
    return work;
  }

  function start() {
    if (!supported) {
      report('Keep Awake is not available in this browser. Open Z Note in a current version of Chrome or Edge.');
      notify();
      return Promise.resolve();
    }
    if (!enabled) { enabled = true; version++; }
    error = '';
    notify();
    return reconcile();
  }

  function stop() {
    enabled = false;
    version++;
    error = '';
    notify();
    return reconcile();
  }

  function paint() {
    const s = state();
    const label = s.active ? 'Awake on' : s.pending ? (s.enabled ? 'Starting…' : 'Stopping…') : s.enabled ? 'Awake paused' : 'Keep Awake';
    const detail = !supported ? 'Keep Awake is unavailable in this browser. Use Chrome or Edge.'
      : s.active ? 'Keep Awake is on. Click to stop. Pauses when Z Note is hidden.'
      : s.pending ? (s.enabled ? 'Starting Keep Awake. Click to cancel.' : 'Stopping Keep Awake.')
      : s.enabled ? 'Keep Awake is paused. Resumes when Z Note is visible. Click to turn off.'
      : error || 'Keep the screen on while Z Note is visible. Pauses when minimized or on another tab.';
    control.classList.toggle('awake-on', s.active);
    control.classList.toggle('awake-paused', s.enabled && !s.active);
    control.disabled = s.pending && !s.enabled && !s.active;
    control.setAttribute('aria-pressed', String(s.enabled || s.active));
    control.setAttribute('aria-label', label + '. ' + detail);
    control.setAttribute('aria-busy', String(s.pending));
    control.setAttribute('data-tip', detail);
    control.querySelector('.awake-label').textContent = label;
  }

  function button() {
    // Reuse the same control when the top bar is rebuilt on navigation/saving.
    if (!control) {
      control = ZN.util.h('button.btn.sm.awake-toggle', {
        type: 'button', onclick: () => (enabled || state().active) ? stop() : start()
      }, ZN.icon('sun', 15), ZN.util.h('span.awake-label'));
    }
    paint();
    return control;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('visibilitychange', () => {
      version++;
      reconcile();
    });
    // No stored preference: reload/close ends this session, including bfcache.
    window.addEventListener('pagehide', stop);
  }

  ZN.awake = {
    init, button, start, stop, state,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
