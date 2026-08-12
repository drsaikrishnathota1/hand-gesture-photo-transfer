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

test('V4 uses only Open Palm and Closed Fist for the action sequence', () => {
  assert.match(app, /Open_Palm/);
  assert.match(app, /Closed_Fist/);
  assert.doesNotMatch(app, /Victory ✌️/);
  assert.match(html, /Sender: ✋ → ✊ Air Copy/);
  assert.match(html, /Receiver: ✋ → ✊ Air Paste/);
});

test('two-party transfer protocol requires request and receiver acceptance before payload', () => {
  for (const phrase of ["type: \"transfer-request\"", "type: \"transfer-accept\"", "type: \"meta\"", "type: \"ack\"", "type: \"nack\"", 'senderWaitingAcceptance']) {
    assert.ok(app.includes(phrase), `missing ${phrase}`);
  }
  const request = app.indexOf('function prepareAirCopy');
  const payload = app.indexOf('async function sendFilePayload');
  assert.ok(request >= 0 && payload >= 0);
});

test('manual fallback has role-specific Air Copy and Air Paste controls', () => {
  assert.match(html, /id="copyBtn"/);
  assert.match(html, /id="pasteBtn"/);
  assert.match(app, /prepareAirCopy\("manual"\)/);
  assert.match(app, /acceptAirPaste\("manual"\)/);
});

test('server enforces one sender and one receiver per room', () => {
  assert.match(server, /Room already has a \$\{role\}/);
  assert.match(server, /Choose the opposite role/);
});

test('server exposes V4 health endpoint and records copy/paste analytics fields', () => {
  assert.match(server, /version: '4\.2\.0'/);
  assert.match(server, /acceptanceLatencySec/);
  assert.match(server, /avgSenderGestureConfidence/);
  assert.match(server, /avgReceiverGestureConfidence/);
});


test('V4.2 ultra-easy gesture mode fires on one accepted open then one accepted close', () => {
  assert.doesNotMatch(app, /GESTURE_CONFIRM_FRAMES/);
  assert.match(app, /GESTURE_SEQUENCE_TIMEOUT_MS = 12000/);
  assert.doesNotMatch(app, /GESTURE_HOLD_MS/);
  assert.match(app, /single accepted Open Palm frame/i);
  assert.match(app, /supported \? 100/);
  assert.match(app, /resolveSimpleGesture/);
  assert.match(html, /Instant sensing/);
});
