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

function nextMessage(ws, predicate = () => true, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for WebSocket message')); }, timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (!predicate(msg)) return;
      cleanup(); resolve(msg);
    };
    const cleanup = () => { clearTimeout(timer); ws.off('message', handler); };
    ws.on('message', handler);
  });
}

async function withServer(fn) {
  const instance = createServer();
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const port = instance.server.address().port;
  try { await fn({ ...instance, port }); }
  finally {
    for (const client of instance.wss.clients) client.terminate();
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

test('health endpoint and role-aware signaling work end-to-end', { skip: !depsAvailable }, async () => {
  await withServer(async ({ port }) => {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.version, '4.2.0');

    const sender = await openClient(`ws://127.0.0.1:${port}`);
    sender.send(JSON.stringify({ type: 'join', room: 'DBA802', role: 'sender' }));
    const joinedSender = await nextMessage(sender, (m) => m.type === 'joined');
    assert.equal(joinedSender.role, 'sender');

    const receiver = await openClient(`ws://127.0.0.1:${port}`);
    receiver.send(JSON.stringify({ type: 'join', room: 'DBA802', role: 'receiver' }));
    const joinedReceiver = await nextMessage(receiver, (m) => m.type === 'joined');
    assert.equal(joinedReceiver.role, 'receiver');

    const offerPromise = nextMessage(receiver, (m) => m.type === 'offer');
    sender.send(JSON.stringify({ type: 'offer', sdp: { type: 'offer', sdp: 'test-sdp' } }));
    const offer = await offerPromise;
    assert.equal(offer.sdp.sdp, 'test-sdp');

    sender.close(); receiver.close();
  });
});

test('room rejects duplicate roles', { skip: !depsAvailable }, async () => {
  await withServer(async ({ port }) => {
    const a = await openClient(`ws://127.0.0.1:${port}`);
    a.send(JSON.stringify({ type: 'join', room: 'NOVA-527', role: 'sender' }));
    await nextMessage(a, (m) => m.type === 'joined');

    const b = await openClient(`ws://127.0.0.1:${port}`);
    const errorPromise = nextMessage(b, (m) => m.type === 'error');
    b.send(JSON.stringify({ type: 'join', room: 'NOVA-527', role: 'sender' }));
    const err = await errorPromise;
    assert.match(err.message, /already has a sender/i);
    a.close(); b.close();
  });
});
