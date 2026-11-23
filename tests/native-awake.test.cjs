'use strict';

// Real loopback integration tests, using only Node built-ins. The native host is
// started without a browser and its capability file exists only in this test's
// private temporary directory. Power protection is briefly enabled and released.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const projectRoot = path.resolve(__dirname, '..');

class Reader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiter = null;
    this.error = null;
    socket.on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      this.flush();
    });
    socket.on('error', error => { this.error = error; this.flush(); });
    socket.on('close', () => { this.error = new Error('Socket closed'); this.flush(); });
  }
  flush() {
    if (!this.waiter) return;
    if (this.buffer.length >= this.waiter.count) {
      const { count, resolve } = this.waiter;
      this.waiter = null;
      const bytes = this.buffer.subarray(0, count);
      this.buffer = this.buffer.subarray(count);
      resolve(bytes);
    } else if (this.error) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(this.error);
    }
  }
  read(count) {
    assert.equal(this.waiter, null, 'test reader has only one consumer');
    return new Promise((resolve, reject) => { this.waiter = { count, resolve, reject }; this.flush(); });
  }
  async headers() {
    let text = '';
    while (!text.endsWith('\r\n\r\n')) {
      assert.ok(text.length < 8192);
      text += (await this.read(1)).toString('ascii');
    }
    return text;
  }
  async frame() {
    const head = await this.read(2);
    assert.equal(head[0] & 128, 128);
    assert.equal(head[1] & 128, 0, 'server frames must be unmasked');
    let length = head[1] & 127;
    if (length === 126) length = (await this.read(2)).readUInt16BE(0);
    assert.ok(length <= 1024);
    return { opcode: head[0] & 15, payload: await this.read(length) };
  }
  async state() {
    for (;;) {
      const frame = await this.frame();
      if (frame.opcode === 9) { this.socket.write(clientFrame(frame.payload, 10)); continue; }
      assert.equal(frame.opcode, 1);
      const state = JSON.parse(frame.payload.toString('utf8'));
      assert.equal(state.type, 'state');
      assert.equal(state.protocol, 1);
      assert.equal(typeof state.active, 'boolean');
      return state;
    }
  }
}

function clientFrame(input, opcode = 1, options = {}) {
  const payload = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const masked = options.masked !== false;
  const extended = payload.length >= 126;
  const header = Buffer.alloc(extended ? 4 : 2);
  header[0] = (options.final === false ? 0 : 128) | opcode;
  header[1] = (masked ? 128 : 0) | (extended ? 126 : payload.length);
  if (extended) header.writeUInt16BE(payload.length, 2);
  if (!masked) return Buffer.concat([header, payload]);
  const mask = crypto.randomBytes(4);
  const encoded = Buffer.from(payload);
  for (let i = 0; i < encoded.length; i++) encoded[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, encoded]);
}

test('portable Windows host protocol and lifecycle', { timeout: 100000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'znote-native-test-'));
  const infoPath = path.join(temp, 'connection.json');
  const executable = process.env.ZNOTE_NATIVE_HOST || path.join(projectRoot, 'app/native/ZNoteHost.exe');
  const child = spawn(executable, ['--no-browser', '--page', path.join(projectRoot, 'Z Note.html'), '--test-info', infoPath], {
    cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const sockets = new Set();
  let info;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { info = JSON.parse(await fs.readFile(infoPath, 'utf8')); break; }
      catch (error) {
        if (child.exitCode !== null) throw new Error('Native host exited: ' + stderr);
        await delay(50);
      }
    }
    assert.ok(info, 'native test information appears');
    assert.match(info.token, /^[0-9a-f]{64}$/);
    assert.ok(info.port > 0 && info.port < 65536);
    assert.equal(info.pid, child.pid);
    const connect = async (overrides = {}) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: info.port });
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      const reader = new Reader(socket);
      await once(socket, 'connect');
      const key = crypto.randomBytes(16).toString('base64');
      const headers = {
        Host: '127.0.0.1:' + info.port,
        Origin: 'null', Upgrade: 'websocket', Connection: 'Upgrade',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
        ...(overrides.headers || {})
      };
      socket.write('GET ' + (overrides.path || '/awake/' + info.token) + ' HTTP/1.1\r\n' +
        Object.entries(headers).map(([name, value]) => name + ': ' + value + '\r\n').join('') + '\r\n');
      const response = await reader.headers();
      if (overrides.rejected) return { socket, reader, response };
      assert.match(response, /^HTTP\/1\.1 101 /);
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      assert.ok(response.includes('Sec-WebSocket-Accept: ' + accept + '\r\n'));
      if (!overrides.update) assert.equal((await reader.state()).active, false, 'each connection starts off');
      return { socket, reader, response };
    };
    const command = async (connection, text) => {
      connection.socket.write(clientFrame(text));
      return connection.reader.state();
    };

    // Keep one authenticated connection open while invalid clients are exercised.
    const main = await connect();
    await t.test('update endpoint authenticates and test helper cannot install or write a backup', async () => {
      for (const override of [
        { path: '/update/' + '0'.repeat(64) },
        { path: '/update/' + info.token, headers: { Origin: 'https://example.com' } }
      ]) {
        const client = await connect({ ...override, rejected: true });
        assert.match(client.response, /^HTTP\/1\.1 403 /);
        client.socket.destroy();
      }
      const client = await connect({ path: '/update/' + info.token, update: true });
      const response = async () => {
        const frame = await client.reader.frame();
        assert.equal(frame.opcode, 1);
        const value = JSON.parse(frame.payload.toString('utf8'));
        assert.equal(value.type, 'update');
        assert.equal(value.protocol, 1);
        return value;
      };
      const ready = await response();
      assert.equal(ready.stage, 'ready');
      assert.equal(ready.supported, false);
      assert.equal(ready.maxBackupBytes, 268435456);
      assert.match(ready.version, /^\d+\.\d+\.\d+$/);
      for (const message of [{ command: 'backup-begin', bytes: 10 }, { command: 'install', version: '99.0.0' }]) {
        client.socket.write(clientFrame(JSON.stringify(message)));
        const error = await response();
        assert.equal(error.stage, 'error');
        assert.match(error.message, /disabled/);
      }
      client.socket.destroy();
    });
    await t.test('token, Host and Origin are all checked before upgrade', async () => {
      for (const override of [
        { path: '/awake/' + '0'.repeat(64) },
        { headers: { Origin: 'https://example.com' } },
        { headers: { Host: 'localhost:' + info.port } }
      ]) {
        const client = await connect({ ...override, rejected: true });
        assert.match(client.response, /^HTTP\/1\.1 403 /);
        client.socket.destroy();
      }
    });
    await t.test('invalid WebSocket version and key are rejected', async () => {
      for (const headers of [{ 'Sec-WebSocket-Version': '12' }, { 'Sec-WebSocket-Key': 'bad-key' }]) {
        const client = await connect({ headers, rejected: true });
        assert.match(client.response, /^HTTP\/1\.1 400 /);
        client.socket.destroy();
      }
    });
    await t.test('start, repeated start, status and stop report real native state', async () => {
      assert.equal((await command(main, 'start')).active, true);
      assert.equal((await command(main, 'start')).active, true);
      assert.equal((await command(main, 'status')).active, true);
      assert.equal((await command(main, 'stop')).active, false);
      assert.equal((await command(main, 'stop')).active, false);
    });
    await t.test('connections own independent awake sessions and abrupt disconnect is recoverable', async () => {
      const second = await connect();
      assert.equal((await command(main, 'start')).active, true);
      assert.equal((await command(second, 'start')).active, true);
      assert.equal((await command(second, 'stop')).active, false);
      assert.equal((await command(main, 'status')).active, true);
      await command(second, 'start');
      second.socket.destroy();
      const replacement = await connect();
      assert.equal((await command(replacement, 'status')).active, false);
      replacement.socket.destroy();
      await command(main, 'stop');
    });
    await t.test('client ping is answered with matching protocol pong', async () => {
      const payload = Buffer.from('native ping');
      main.socket.write(clientFrame(payload, 9));
      const pong = await main.reader.frame();
      assert.equal(pong.opcode, 10);
      assert.deepEqual(pong.payload, payload);
    });
    await t.test('unsupported commands and invalid frames close only their own socket', async () => {
      const cases = [
        [clientFrame('execute'), 1008],
        [clientFrame('status', 1, { masked: false }), 1002],
        [clientFrame('sta', 1, { final: false }), 1002],
        [clientFrame(Buffer.alloc(1025)), 1009],
        [clientFrame(Buffer.from([0xc3, 0x28])), 1007],
        [clientFrame(Buffer.from([1]), 8), 1002],
        [clientFrame('status', 2), 1002]
      ];
      for (const [frame, code] of cases) {
        const client = await connect();
        await command(client, 'start');
        client.socket.write(frame);
        const close = await client.reader.frame();
        assert.equal(close.opcode, 8);
        assert.equal(close.payload.readUInt16BE(0), code);
        client.socket.destroy();
      }
      assert.equal((await command(main, 'status')).active, false);
    });
    await t.test('native protocol pings preserve awake mode without any JavaScript/text heartbeat', async () => {
      assert.equal((await command(main, 'start')).active, true);
      for (let i = 0; i < 2; i++) {
        const ping = await main.reader.frame();
        assert.equal(ping.opcode, 9);
        main.socket.write(clientFrame(ping.payload, 10));
      }
      assert.equal((await command(main, 'status')).active, true);
      await command(main, 'stop');
    });
    await t.test('normal close is echoed and last disconnect lets the host exit', async () => {
      const payload = Buffer.from([3, 232]); // normal close 1000
      main.socket.write(clientFrame(payload, 8));
      const close = await main.reader.frame();
      assert.equal(close.opcode, 8);
      assert.deepEqual(close.payload, payload);
      main.socket.destroy();
      const [exitCode] = await exited;
      assert.equal(exitCode, 0, stderr);
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (child.exitCode === null) { child.kill(); await exited; }
    await fs.unlink(infoPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(temp);
  }
});
