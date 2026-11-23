/* Z Note · backup-first automatic updates through the authenticated Windows launcher */
(function () {
  'use strict';
  const MAX_BACKUP = 256 * 1024 * 1024, CHUNK_BYTES = 32768;
  const params = new URLSearchParams(window.location.search);
  const port = params.get('zn-awake-port') || '', token = params.get('zn-awake-token') || '';
  const available = window.location.protocol === 'file:' && typeof window.WebSocket === 'function' &&
    typeof window.TextEncoder === 'function' && typeof window.btoa === 'function' &&
    /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[a-f0-9]{64}$/i.test(token);
  const endpoint = available ? 'ws://127.0.0.1:' + Number(port) + '/update/' + token : '';
  const REOPEN = 'Close Z Note and reopen Z Note.exe (or Open Z Note.cmd). If the launcher is older, download the latest portable version once.';
  const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split('.').every(part => Number.isSafeInteger(Number(part)));
  let socket = null, connected = false, supported = false, closed = false, busy = false;
  let connecting = null, handshake = null, command = null;
  let version = '', maxBackupBytes = MAX_BACKUP, error = '', backupPath = '', installedVersion = '';
  let installAttempted = false;
  const state = () => ({ connected, supported, version, maxBackupBytes, busy, error, backupPath, installedVersion, installAttempted });

  function settle(item, failure, value) {
    if (!item) return;
    clearTimeout(item.timer);
    if (failure) {
      const e = new Error(failure);
      e.reopenRequired = installAttempted || closed;
      e.uncertain = installAttempted && !installedVersion;
      item.reject(e);
    } else item.resolve(value);
  }
  function fail(message) {
    error = message;
    const previous = socket, waiting = handshake, pending = command;
    socket = null; connected = supported = false;
    handshake = command = connecting = null;
    settle(waiting, message);
    settle(pending, message);
    if (previous) { try { previous.close(); } catch (_) {} }
  }
  function transportFailure() {
    fail(installAttempted
      ? 'The update connection ended before its result was confirmed. Do not start another update. ' + REOPEN
      : 'The Windows updater did not respond. ' + REOPEN);
  }
  function progress(fn, value) {
    if (typeof fn !== 'function') return;
    try { fn(value); } catch (e) { console.error('[Z Note] update progress listener', e); }
  }
  function receive(current, event) {
    if (socket !== current) return;
    let value;
    try {
      if (typeof event.data !== 'string' || event.data.length > 16384) throw new Error('Invalid response');
      value = JSON.parse(event.data);
    } catch (_) { fail('Invalid response from the Windows updater. ' + REOPEN); return; }
    if (!value || value.type !== 'update' || value.protocol !== 1 || typeof value.stage !== 'string') {
      fail('The Windows updater protocol is not supported. ' + REOPEN); return;
    }
    if (value.stage === 'error') {
      fail(typeof value.message === 'string' && value.message ? value.message.slice(0, 2000) : 'The Windows update could not finish.');
      return;
    }
    if (handshake) {
      if (value.stage !== 'ready' || value.supported !== true || !validVersion(value.version) ||
          !Number.isSafeInteger(value.maxBackupBytes) || value.maxBackupBytes < 1 || value.maxBackupBytes > MAX_BACKUP) {
        fail('This Windows launcher does not support automatic updates. ' + REOPEN); return;
      }
      connected = supported = true; version = value.version; maxBackupBytes = value.maxBackupBytes; error = '';
      const waiting = handshake;
      handshake = connecting = null;
      settle(waiting, null, state());
      return;
    }
    if (!command) { fail('The Windows updater sent an unexpected response. ' + REOPEN); return; }
    if (command.name === 'install' && value.stage === 'progress') {
      if (typeof value.message !== 'string') { fail('Invalid update progress response. ' + REOPEN); return; }
      progress(command.onProgress, { stage: 'progress', message: value.message.slice(0, 2000) });
      return;
    }
    if (value.stage !== command.expected ||
        (value.stage === 'backup-chunk' && value.received !== command.received) ||
        ((value.stage === 'backup-saved' || value.stage === 'installed') && (typeof value.backupPath !== 'string' || !value.backupPath)) ||
        (value.stage === 'installed' && (value.version !== command.version || value.backupPath !== backupPath))) {
      fail('The Windows updater could not confirm the requested operation. ' + REOPEN); return;
    }
    if (value.stage === 'backup-saved') backupPath = value.backupPath;
    if (value.stage === 'installed') installedVersion = value.version;
    const completed = command;
    command = null;
    settle(completed, null, value);
  }
  function connect() {
    if (closed || !available) return Promise.reject(new Error('Open Z Note with Z Note.exe (or Open Z Note.cmd) on Windows to install updates automatically.'));
    if (installAttempted && !connected) return Promise.reject(new Error('An update has already been started in this window. ' + REOPEN));
    if (connected && supported) return Promise.resolve(state());
    if (connecting) return connecting;
    error = '';
    const ready = new Promise((resolve, reject) => {
      handshake = { resolve, reject, timer: setTimeout(transportFailure, 8000) };
    });
    connecting = ready;
    try {
      const current = new WebSocket(endpoint);
      socket = current;
      current.onmessage = event => receive(current, event);
      current.onerror = () => { if (socket === current) transportFailure(); };
      current.onclose = () => { if (socket === current) transportFailure(); };
    } catch (_) { transportFailure(); }
    return ready;
  }
  function request(payload, expected, options) {
    options = options || {};
    if (!socket || !connected || command) return Promise.reject(new Error('The Windows updater is not ready. ' + REOPEN));
    return new Promise((resolve, reject) => {
      command = Object.assign({ name: payload.command, expected, resolve, reject,
        timer: setTimeout(() => fail(payload.command === 'install'
          ? 'The update result was not confirmed in time. Do not start another update. ' + REOPEN
          : 'The Windows updater timed out while saving your backup. ' + REOPEN), payload.command === 'install' ? 180000 : 30000)
      }, options);
      // Once a request could have reached the installer, never replay it after
      // an uncertain transport failure. Reopening lets native recovery finish.
      if (payload.command === 'install') installAttempted = true;
      try { socket.send(JSON.stringify(payload)); } catch (_) { transportFailure(); }
    });
  }
  function encodeChunk(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  async function install(backup, targetVersion, onProgress) {
    if (busy) throw new Error('An update is already in progress.');
    if (installAttempted) throw new Error('An update has already been started in this window. ' + REOPEN);
    if (!validVersion(targetVersion)) throw new Error('The update version could not be read.');
    if (!backup || backup.app !== 'znote' || backup.version !== 1 || !Array.isArray(backup.pages) || !Array.isArray(backup.images)) {
      throw new Error('A complete Z Note backup is required before installing.');
    }
    busy = true;
    backupPath = '';
    try {
      // Snapshot once: note data is sent only to this launcher's local endpoint.
      const json = JSON.stringify(backup);
      if (json.length > MAX_BACKUP) throw new Error('The automatic backup is too large. Save a backup and update manually.');
      const bytes = new TextEncoder().encode(json);
      if (bytes.length > MAX_BACKUP) throw new Error('The automatic backup is too large. Save a backup and update manually.');
      await connect();
      if (bytes.length > maxBackupBytes) throw new Error('The backup exceeds this launcher’s limit. Save a backup and update manually.');
      progress(onProgress, { stage: 'backup-started', message: 'Saving an automatic backup on this PC…', received: 0, total: bytes.length });
      await request({ command: 'backup-begin', bytes: bytes.length }, 'backup-started');
      for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
        const chunk = bytes.subarray(at, Math.min(at + CHUNK_BYTES, bytes.length));
        const received = at + chunk.length;
        await request({ command: 'backup-chunk', data: encodeChunk(chunk) }, 'backup-chunk', { received });
        progress(onProgress, { stage: 'backup-chunk', message: 'Saving an automatic backup on this PC…', received, total: bytes.length });
      }
      const saved = await request({ command: 'backup-end' }, 'backup-saved');
      progress(onProgress, { stage: 'backup-saved', message: 'Automatic backup saved.', backupPath: saved.backupPath });
      const installed = await request({ command: 'install', version: targetVersion }, 'installed', { version: targetVersion, onProgress });
      progress(onProgress, { stage: 'installed', message: 'Update installed.', version: installed.version, backupPath: installed.backupPath });
      return installed;
    } finally { busy = false; }
  }
  function close() {
    if (closed) return;
    closed = true;
    fail('The Windows updater connection was closed. ' + REOPEN);
  }
  window.addEventListener('pagehide', close);
  window.ZN.updateNative = { available, connect, state, install, close };
})();
