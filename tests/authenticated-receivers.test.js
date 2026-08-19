const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createServer,
  receiverIntelligenceRecord
} = require('../server');

async function withServer(fn) {
  const { server, wss } = createServer();

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  try {
    await fn(port);
  } finally {
    try { wss.close(); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }
}

test('receiver intelligence includes participant identity without exposing Google subject ID', () => {
  const row = receiverIntelligenceRecord('a82f19-1234', {
    identity: {
      googleSub: 'google-private-123',
      name: 'DBA Student',
      email: 'student@example.com'
    },
    network: {
      maskedIp: '73.184.xxx.xxx'
    },
    clientInfo: {
      browser: 'Chrome',
      os: 'macOS',
      deviceType: 'Laptop/Desktop'
    }
  });

  assert.equal(row.participantName, 'DBA Student');
  assert.equal(row.participantEmail, 'student@example.com');
  assert.equal(row.receiverId, 'RCV-A82F19');
  assert.equal(Object.hasOwn(row, 'googleSub'), false);
});

test('protected classroom API rejects unauthenticated requests', async () => {
  await withServer(async (port) => {
    const analytics = await fetch(
      `http://127.0.0.1:${port}/api/analytics`
    );

    assert.equal(analytics.status, 401);

    const health = await fetch(
      `http://127.0.0.1:${port}/api/health`
    );

    assert.equal(health.status, 200);

    const data = await health.json();
    assert.equal(data.version, '5.4.0');
  });
});

test('V5.4.0 authenticates WebSocket upgrades and host UI includes participant identity', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8'
  );

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8'
  );

  assert.match(server, /noServer:\s*true/);
  assert.match(server, /401 Unauthorized/);
  assert.match(server, /req\.session\?\.user\?\.googleSub/);
  assert.match(server, /identity:\s*ws\.user/);

  assert.match(html, /<th>Participant<\/th>/);
  assert.match(html, /Receiver privacy/);
});
