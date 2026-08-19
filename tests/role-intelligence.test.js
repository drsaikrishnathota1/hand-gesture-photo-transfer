const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('V5.4.0 gives Receivers a personal intelligence view and Senders the classroom table', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8'
  );

  assert.match(html, /id="myIntelligencePanel"/);
  assert.match(html, /My AirGesture Intelligence/);
  assert.match(html, /id="senderIntelligencePanel"/);
  assert.match(html, /id="myIdentityName"/);
  assert.match(html, /id="myReceiverId"/);
  assert.match(html, /id="myTransferIntegrity"/);
  assert.match(html, /id="myRecommendation"/);
  assert.match(html, /Receiver privacy/);
  assert.match(html, /<th>Participant<\/th>/);
});

test('V5.4.0 switches intelligence by role and builds personal transfer evidence', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'app.js'),
    'utf8'
  );

  assert.match(js, /function renderMyIntelligence/);
  assert.match(js, /function renderRoleIntelligence/);
  assert.match(js, /state\.myTransfer/);
  assert.match(js, /integrityVerified:\s*true/);
  assert.match(js, /senderIntelligencePanel/);
  assert.match(js, /myIntelligencePanel/);
  assert.match(js, /broadcastStatsPanel/);
});

test('V5.4.0 exposes only the browser-safe Google profile to the personal view', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'auth-client.js'),
    'utf8'
  );

  assert.match(js, /window\.AirGestureAuthUser/);
  assert.match(js, /airgesture-auth-user/);

  const profileBlock = js.match(
    /window\.AirGestureAuthUser\s*=\s*\{[\s\S]*?\};/
  );

  assert.ok(profileBlock);
  assert.doesNotMatch(profileBlock[0], /googleSub/);
});
