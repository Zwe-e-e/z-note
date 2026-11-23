/* Z Note · authenticated connection to the optional Windows launcher */
(function () {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const port = params.get('zn-awake-port') || '';
  const token = params.get('zn-awake-token') || '';
  const available = window.location.protocol === 'file:' && typeof window.WebSocket === 'function' &&
    /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[a-f0-9]{64}$/i.test(token);
  const endpoint = available ? 'ws://127.0.0.1:' + Number(port) + '/awake/' + token : '';
  let socket = null, connected = false, active = false, error = '', closed = false;
  let connecting = null, handshake = null, command = null, generation = 0;
  let queue = Promise.resolve();
  const listeners = new Set();
  const state = () => ({ connected, active, error });
  const notify = () => listeners.forEach(fn => {
    try { fn(state()); } catch (e) { console.error('[Z Note] Windows Keep Awake listener', e); }
  });
  function settle(item, failure) {
    if (!item) return;
    clearTimeout(item.timer);
    if (failure) item.reject(new Error(failure)); else item.resolve();
  }
  function fail(message) {
    const previous = socket;
    socket = null;
    connected = false;
    active = false;
    error = message;
    generation++;
    const waiting = handshake, pending = command;
    handshake = command = connecting = null;
    settle(waiting, message);
    settle(pending, message);
    if (previous) { try { previous.close(); } catch (_) {} }
    notify();
  }
  function connect() {
    if (closed || !available) return Promise.reject(new Error('Open Z Note with Z Note.exe (or Open Z Note.cmd) for Windows Keep Awake.'));
    if (connected) return Promise.resolve();
    if (connecting) return connecting;
    error = '';
    // Create the promise before the socket so synchronous construction failures
    // can reject the same handshake as network failures.
    const ready = new Promise((resolve, reject) => {
      handshake = { resolve, reject, timer: setTimeout(() => fail('The Windows helper did not respond. Reopen Z Note with Z Note.exe (or Open Z Note.cmd).'), 5000) };
    });
    connecting = ready;
    try {
      const current = new WebSocket(endpoint);
      socket = current;
      current.onmessage = event => {
        if (socket !== current) return;
        let message;
        try { message = JSON.parse(event.data); } catch (_) { fail('Invalid response from Windows Keep Awake.'); return; }
        if (!message || message.type !== 'state' || message.protocol !== 1 || typeof message.active !== 'boolean' || message.error) {
          fail('Windows Keep Awake could not confirm its state. Reopen Z Note with Z Note.exe (or Open Z Note.cmd).'); return;
        }
        if (command && message.active !== (command.name === 'start')) {
          fail('Windows Keep Awake could not complete the request.'); return;
        }
        connected = true;
        active = message.active;
        error = '';
        const waiting = handshake, pending = command;
        handshake = command = connecting = null;
        settle(waiting);
        settle(pending);
        notify();
      };
      current.onerror = () => { if (socket === current) fail('Cannot connect to Windows Keep Awake. Reopen Z Note with Z Note.exe (or Open Z Note.cmd).'); };
      current.onclose = () => { if (socket === current) fail('Windows Keep Awake disconnected. Reopen Z Note with Z Note.exe (or Open Z Note.cmd).'); };
    } catch (_) { fail('Cannot connect to Windows Keep Awake. Reopen Z Note with Z Note.exe (or Open Z Note.cmd).'); }
    return ready;
  }
  function request(name) {
    const attempt = generation;
    const result = queue.then(async () => {
      // A transport failure cancels all work queued on that session. Only a
      // new, explicit button action can reconnect; never replay a stale start.
      if (attempt !== generation) throw new Error('Windows Keep Awake session ended.');
      await connect();
      if (attempt !== generation || closed) throw new Error('Windows Keep Awake session ended.');
      return new Promise((resolve, reject) => {
        command = { name, resolve, reject, timer: setTimeout(() => fail('Windows Keep Awake did not confirm the request.'), 5000) };
        try { socket.send(name); } catch (_) { fail('Windows Keep Awake disconnected.'); }
      });
    });
    queue = result.catch(() => {});
    return result;
  }
  window.ZN.awakeNative = {
    available, connect, state,
    start: () => request('start'), stop: () => request('stop'),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    close: () => { if (!closed) { closed = true; fail('Windows Keep Awake session closed.'); } }
  };
})();
