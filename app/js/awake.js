/* Z Note · Windows background Keep Awake, with a visible-tab browser fallback */
(function () {
  'use strict';
  const ZN = window.ZN;
  const native = ZN.awakeNative && ZN.awakeNative.available ? ZN.awakeNative : null;
  const supported = !!native || (window.isSecureContext !== false && !!(navigator.wakeLock && navigator.wakeLock.request));
  let enabled = false, lock = null, pending = false, error = '', version = 0;
  let work = Promise.resolve(), initialized = false, control = null, explainedBrowser = false, closing = false;
  const listeners = new Set();
  const expectedReleases = new WeakSet();
  const visible = () => document.visibilityState === 'visible';

  function state() {
    return { enabled, active: native ? native.state().active : !!(lock && !lock.released), pending, supported, error, mode: native ? 'windows' : 'browser' };
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
    if (native) return reconcileNative();
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

  function reconcileNative() {
    work = work.then(async () => {
      if (closing) return;
      if (enabled && native.state().active) { notify(); return; }
      if (!enabled && !native.state().active) { notify(); return; }
      const attempt = version;
      pending = true;
      notify();
      try {
        if (enabled) {
          await native.start();
          if (attempt !== version || !enabled || closing) await native.stop();
        } else {
          await native.stop();
        }
      } catch (e) {
        enabled = false;
        if (!closing) report(e.message || 'Windows Keep Awake disconnected. Reopen Z Note with Open Z Note.cmd.');
      } finally {
        pending = false;
        notify();
      }
    });
    return work;
  }

  function start() {
    if (closing) {
      report('This Windows Keep Awake session has ended. Reopen Z Note with Open Z Note.cmd.');
      notify();
      return Promise.resolve();
    }
    if (!supported) {
      report('Keep Awake is not available in this browser. Open Z Note in a current version of Chrome or Edge.');
      notify();
      return Promise.resolve();
    }
    if (!enabled) { enabled = true; version++; }
    error = '';
    if (!native && !explainedBrowser) {
      explainedBrowser = true;
      ZN.ui.toast('Browser Keep Awake works only while Z Note is visible. For minimized use on Windows, download Z Note and open Open Z Note.cmd.', { ms: 10000 });
    }
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
    const label = s.active ? (native ? 'Awake on' : 'Awake: visible') : s.pending ? (s.enabled ? 'Starting…' : 'Stopping…') : s.enabled ? 'Awake paused' : 'Keep Awake';
    const detail = !supported ? 'Keep Awake is unavailable in this browser. Use Chrome or Edge.'
      : s.active ? (native ? 'Windows Keep Awake is on, including when minimized or covered. Click to stop.' : 'Browser Keep Awake is on while visible. Background use requires Open Z Note.cmd.')
      : s.pending ? (s.enabled ? 'Starting Keep Awake. Click to cancel.' : 'Stopping Keep Awake.')
      : s.enabled ? 'Keep Awake is paused. Resumes when Z Note is visible. Click to turn off.'
      : error || (native ? 'Keep the screen on even when Z Note is minimized or covered. Stops when this window closes.' : 'Keep the screen on while Z Note is visible. Background use requires the Windows launcher, Open Z Note.cmd.');
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
    if (native) {
      native.subscribe(s => {
        if (!s.connected && s.error && !closing) {
          const wasEnabled = enabled;
          enabled = false;
          version++;
          error = s.error;
          if (wasEnabled && !pending) report(s.error);
        }
        notify();
      });
      // Connect immediately to keep the launcher session alive, but never
      // request power until the user presses the button.
      native.connect().catch(e => { if (!closing) { error = e.message; notify(); } });
      window.addEventListener('pagehide', () => {
        closing = true;
        enabled = false;
        version++;
        native.close();
        notify();
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted && closing) {
          error = 'This Windows Keep Awake session has ended. Reopen Z Note with Open Z Note.cmd.';
          notify();
        }
      });
      return;
    }
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
