const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskIp, classifyIp, sanitizeClientInfo, receiverIntelligenceRecord } = require('../server');

test('V5.2 masks IPv4 rather than exposing a full public address', () => {
  assert.equal(maskIp('73.184.122.57'), '73.184.xxx.xxx');
  assert.notEqual(maskIp('73.184.122.57'), '73.184.122.57');
});

test('V5.2 recognizes loopback, private and public network classes', () => {
  assert.equal(classifyIp('127.0.0.1'), 'loopback');
  assert.equal(classifyIp('192.168.1.44'), 'private');
  assert.equal(classifyIp('73.184.122.57'), 'public');
});

test('client telemetry is sanitized and bounded', () => {
  const info = sanitizeClientInfo({ browser: 'Chrome\\nInjected', os: 'macOS', downlinkMbps: 999999999, rttEstimateMs: -5 });
  assert.equal(info.browser.includes('\\n'), false);
  assert.equal(info.os, 'macOS');
  assert.equal(info.downlinkMbps, 100000);
  assert.equal(info.rttEstimateMs, 0);
});

test('receiver intelligence record contains masked network and business telemetry', () => {
  const row = receiverIntelligenceRecord('a82f19-1234', {
    network: { maskedIp: '73.184.xxx.xxx', location: 'St. Louis, MO', provider: 'Example ISP', addressClass: 'public' },
    clientInfo: { browser: 'Chrome', os: 'macOS', deviceType: 'Laptop/Desktop' },
    latencyMs: 31,
    transferSpeedMbps: 18.7,
    downloadTimeSec: 3.6,
    gestureConfidence: 0.99,
    integrityVerified: true,
    completedAt: Date.now()
  });
  assert.equal(row.receiverId, 'RCV-A82F19');
  assert.equal(row.maskedIp, '73.184.xxx.xxx');
  assert.equal(row.transferSpeedMbps, 18.7);
  assert.equal(row.result, 'SUCCESS');
  assert.equal(row.integrityVerified, true);
});

test('V5.2 UI includes Receiver Network Intelligence without a full-IP field', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /Receiver Network Intelligence/);
  assert.match(html, /Masked IP/);
  assert.match(html, /Measured Server Latency/);
  assert.doesNotMatch(html, /Full IP Address/);
});

test('V5.2 browser code collects device and network signals and measures server latency', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /collectClientInfo/);
  assert.match(js, /measureServerLatency/);
  assert.match(js, /receiver-intelligence/);
  assert.match(js, /integrityVerified: true/);
});
