const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('all DOM IDs used by app.js exist in index.html', () => {
  const used = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...new Set(used)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('camera is requested before MediaPipe AI is loaded', () => {
  const start = app.indexOf('async function startCamera()');
  const stop = app.indexOf('function stopCamera()', start);
  const body = app.slice(start, stop);
  assert.ok(body.indexOf('requestCameraStream()') >= 0);
  assert.ok(body.indexOf('loadVisionAI(startToken)') >= 0);
  assert.ok(body.indexOf('requestCameraStream()') < body.indexOf('loadVisionAI(startToken)'));
});

test('both roles may start Vision AI and AI failure preserves manual controls', () => {
  const start = app.indexOf('async function startCamera()');
  const stop = app.indexOf('function stopCamera()', start);
  const body = app.slice(start, stop);
  assert.doesNotMatch(body, /role !== ['"]sender['"]/);
  assert.match(app, /retrying on CPU/i);
  assert.match(app, /Camera Live · AI Offline/);
  assert.match(app, /Manual Air Copy\/Air Paste controls remain available/);
});

test('V5 keeps ultra-easy Open Palm then Closed Fist for both roles', () => {
  assert.match(app, /Open_Palm/);
  assert.match(app, /Closed_Fist/);
  assert.doesNotMatch(app, /Victory ✌️/);
  assert.match(html, /✋ → ✊ Air Copy/);
  assert.match(html, /✋ → ✊ Air Paste/);
  assert.match(html, /Instant sensing/);
});

test('V5.3.2 UI exposes one universal room workflow with no transfer-mode selector', () => {
  assert.doesNotMatch(html, /class="mode-switch"/);
  assert.doesNotMatch(html, /data-mode="peer"/);
  assert.doesNotMatch(html, /1 → 200/);
  assert.doesNotMatch(html, /Peer-to-Peer/);
  assert.match(html, /Universal Room/);
  assert.match(html, /no fixed application participant cap/i);
  assert.match(app, /function connectBroadcastRoom/);
  assert.match(app, /return connectBroadcastRoom\(\)/);
});

test('broadcast upload is one server upload and receiver download is independent', () => {
  assert.match(app, /\/api\/broadcast\/\$\{encodeURIComponent\(state\.room\)\}\/upload/);
  assert.match(app, /\/api\/broadcast\/\$\{encodeURIComponent\(state\.room\)\}\/files\/\$\{encodeURIComponent\(request\.fileId\)\}/);
  assert.match(app, /broadcast-accept/);
  assert.match(app, /broadcast-complete/);
  assert.match(app, /SHA-256/);
});

test('server supports one host and no fixed application receiver cap by default', () => {
  assert.doesNotMatch(server, /MAX_BROADCAST_RECEIVERS = 200/);
  assert.match(server, /AIRGESTURE_MAX_RECEIVERS/);
  assert.match(server, /CONFIGURED_RECEIVER_LIMIT > 0/);
  assert.match(server, /Broadcast room already has a Sender\/Host/);
});

test('V5 broadcast files are temporary, size-limited and SHA-256 hashed', () => {
  assert.match(server, /MAX_BROADCAST_FILE_BYTES = 100 \* 1024 \* 1024/);
  assert.match(server, /BROADCAST_TTL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(server, /createHash\('sha256'\)/);
  assert.match(server, /deleteBroadcastFile/);
});

test('server exposes V5.3.2 health endpoint and universal-room live KPIs', () => {
  assert.match(server, /version: '5\.3\.2'/);
  assert.match(server, /receiverLimit/);
  assert.match(server, /completionRate/);
  for (const id of ['broadcastConnected','broadcastAccepted','broadcastCompleted','broadcastWaiting','broadcastFailed','broadcastCompletion']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
