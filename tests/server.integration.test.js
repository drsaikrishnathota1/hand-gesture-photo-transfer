const test = require('node:test');
const assert = require('node:assert/strict');

let createServer, WebSocket;
let depsAvailable = true;
try {
  ({ createServer } = require('../server.js'));
  WebSocket = require('ws');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') depsAvailable = false;
  else throw error;
}

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for WebSocket message')); }, timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };
    const cleanup = () => { clearTimeout(timer); ws.off('message', handler); };
    ws.on('message', handler);
  });
}

async function join(ws, payload, expectedType) {
  const message = nextMessage(ws, (m) => m.type === expectedType);
  ws.send(JSON.stringify(payload));
  return message;
}

async function withServer(fn) {
  const instance = createServer();
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const port = instance.server.address().port;
  try {
    await fn({ ...instance, port });
  } finally {
    for (const client of instance.wss.clients) client.terminate();
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

test('V5.2 health endpoint reports universal room mode with no fixed receiver cap by default', { skip: !depsAvailable }, async () => {
  await withServer(async ({ port }) => {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.version, '5.2.0');
    assert.equal(health.receiverLimit, null);
  });
});

test('universal room keeps one Sender and accepts more than the old 200-receiver limit', { skip: !depsAvailable }, async () => {
  await withServer(async ({ port }) => {
    const url = `ws://127.0.0.1:${port}`;
    const host = await openClient(url);
    const hostJoined = await join(host, { type: 'join', room: 'UNIVERSAL', role: 'sender' }, 'broadcast-joined');
    assert.ok(hostJoined.hostToken);

    const duplicateHost = await openClient(url);
    const hostError = await join(duplicateHost, { type: 'join', room: 'UNIVERSAL', role: 'sender' }, 'error');
    assert.match(hostError.message, /already has a Sender\/Host/i);
    duplicateHost.close();

    const receiverCount = 205;
    const receivers = await Promise.all(Array.from({ length: receiverCount }, async () => {
      const ws = await openClient(url);
      const joined = await join(ws, { type: 'join', room: 'UNIVERSAL', role: 'receiver' }, 'broadcast-joined');
      assert.equal(joined.role, 'receiver');
      assert.equal(joined.receiverLimit, null);
      return ws;
    }));

    const status = await fetch(`http://127.0.0.1:${port}/api/broadcast/UNIVERSAL/status`).then((r) => r.json());
    assert.equal(status.stats.connected, receiverCount);

    for (const ws of receivers) ws.close();
    host.close();
  });
});

test('broadcast uploads once, receiver accepts, downloads exact bytes, and host sees completion', { skip: !depsAvailable }, async () => {
  await withServer(async ({ port }) => {
    const wsUrl = `ws://127.0.0.1:${port}`;
    const httpUrl = `http://127.0.0.1:${port}`;

    const host = await openClient(wsUrl);
    const hostJoined = await join(host, { type: 'join', room: 'MIDWEST802', role: 'sender' }, 'broadcast-joined');

    const receiver = await openClient(wsUrl);
    await join(receiver, { type: 'join', room: 'MIDWEST802', role: 'receiver' }, 'broadcast-joined');

    const bytes = Buffer.from('DBA 802 classroom broadcast exact-byte test\n', 'utf8');
    const readyPromise = nextMessage(receiver, (m) => m.type === 'broadcast-file-ready');
    const uploadResponse = await fetch(`${httpUrl}/api/broadcast/MIDWEST802/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-AirGesture-Host-Token': hostJoined.hostToken,
        'X-File-Name': encodeURIComponent('DBA802-case.txt'),
        'X-File-Size': String(bytes.length),
        'X-File-Type': 'text/plain'
      },
      body: bytes
    });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();
    const ready = await readyPromise;
    assert.equal(ready.file.id, uploaded.file.id);
    assert.equal(ready.file.size, bytes.length);
    assert.match(ready.file.sha256, /^[a-f0-9]{64}$/);

    const acceptedStatsPromise = nextMessage(host, (m) => m.type === 'broadcast-stats' && m.stats.accepted === 1);
    receiver.send(JSON.stringify({ type: 'broadcast-accept', fileId: ready.file.id, trigger: 'gesture' }));
    const acceptedStats = await acceptedStatsPromise;
    assert.equal(acceptedStats.stats.accepted, 1);

    const download = await fetch(`${httpUrl}/api/broadcast/MIDWEST802/files/${ready.file.id}`);
    assert.equal(download.status, 200);
    const downloaded = Buffer.from(await download.arrayBuffer());
    assert.deepEqual(downloaded, bytes);
    assert.equal(download.headers.get('x-airgesture-sha256'), ready.file.sha256);

    const completedStatsPromise = nextMessage(host, (m) => m.type === 'broadcast-stats' && m.stats.completed === 1);
    receiver.send(JSON.stringify({ type: 'broadcast-complete', fileId: ready.file.id }));
    const completedStats = await completedStatsPromise;
    assert.equal(completedStats.stats.connected, 1);
    assert.equal(completedStats.stats.accepted, 1);
    assert.equal(completedStats.stats.completed, 1);
    assert.equal(completedStats.stats.completionRate, 100);
  });
});
