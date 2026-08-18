'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIntelligenceSnapshot,
  buildStrategyAnswer,
  compactAiEvidence
} = require('../strategy-intelligence');

const rows = [
  {
    time: '2026-08-18T13:00:00.000Z', student: 'Alpha', room: 'AERO-1',
    transferId: '00000000-0000-4000-8000-000000000001', action: 'SEND',
    fileType: 'PDF', fileSizeBytes: 18_000_000, result: 'SENT',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Chrome',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-18T12:00:00.000Z', student: 'Beta', room: 'AERO-2',
    transferId: '00000000-0000-4000-8000-000000000002', action: 'RECEIVE',
    fileType: 'DOCUMENT', fileSizeBytes: 12_000_000, result: 'SUCCESS',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Edge',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-17T15:00:00.000Z', student: 'Gamma', room: 'NOVA-1',
    transferId: '00000000-0000-4000-8000-000000000003', action: 'SEND',
    fileType: 'IMAGE', fileSizeBytes: 8_000_000, result: 'SENT',
    device: 'Mobile', os: 'Android', browser: 'Chrome',
    location: 'Dallas, Texas, United States', commercialSegment: 'ANDROID_MOBILE'
  },
  {
    time: '2026-08-16T16:00:00.000Z', student: 'Delta', room: 'NOVA-2',
    transferId: '00000000-0000-4000-8000-000000000004', action: 'RECEIVE',
    fileType: 'IMAGE', fileSizeBytes: 6_000_000, result: 'SUCCESS',
    device: 'Mobile', os: 'iOS/iPadOS', browser: 'Safari',
    location: 'New York, New York, United States', commercialSegment: 'APPLE_MOBILE'
  },
  {
    time: '2026-08-15T11:00:00.000Z', student: 'Epsilon', room: 'SOLAR-1',
    transferId: '00000000-0000-4000-8000-000000000005', action: 'SEND',
    fileType: 'PDF', fileSizeBytes: 25_000_000, result: 'SENT',
    device: 'Laptop/Desktop', os: 'macOS', browser: 'Safari',
    location: 'Seattle, Washington, United States', commercialSegment: 'APPLE_DESKTOP'
  },
  {
    time: '2026-08-14T14:00:00.000Z', student: 'Alpha', room: 'AERO-3',
    transferId: '00000000-0000-4000-8000-000000000006', action: 'RECEIVE',
    fileType: 'DOCUMENT', fileSizeBytes: 15_000_000, result: 'SUCCESS',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Chrome',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-07-01T10:00:00.000Z', student: 'Gamma', room: 'OLD-1',
    transferId: '00000000-0000-4000-8000-000000000007', action: 'SEND',
    fileType: 'VIDEO', fileSizeBytes: 45_000_000, result: 'SENT',
    device: 'Mobile', os: 'Android', browser: 'Chrome',
    location: 'Dallas, Texas, United States', commercialSegment: 'ANDROID_MOBILE'
  },
  {
    time: '2026-06-01T10:00:00.000Z', student: 'Zeta', room: 'OLD-2',
    transferId: '00000000-0000-4000-8000-000000000008', action: 'RECEIVE',
    fileType: 'OTHER', fileSizeBytes: 1_000_000, result: 'SUCCESS',
    device: 'Laptop/Desktop', os: 'Linux', browser: 'Firefox',
    location: 'Austin, Texas, United States', commercialSegment: 'LINUX_DESKTOP'
  }
];

test('builds commercial intelligence from the exact AirGesture row shape', () => {
  const snapshot = buildIntelligenceSnapshot(rows, { range: 'all' });

  assert.equal(snapshot.scope.sourceRecords, 8);
  assert.equal(snapshot.scope.matchingRecords, 8);
  assert.equal(snapshot.kpis.users, 6);
  assert.equal(snapshot.kpis.locations, 5);
  assert.equal(snapshot.kpis.topSegment, 'WINDOWS_DESKTOP');
  assert.equal(snapshot.kpis.topLocation, 'Chicago, Illinois, United States');
  assert.ok(['PDF', 'DOCUMENT', 'IMAGE'].includes(snapshot.kpis.topFileType));
  assert.ok(snapshot.opportunities.length >= 6);
  assert.ok(snapshot.strategicActions.length >= 3);
});

test('cross-filtering changes every analysis to the selected audience', () => {
  const snapshot = buildIntelligenceSnapshot(rows, {
    range: 'all',
    segment: 'WINDOWS_DESKTOP'
  });

  assert.equal(snapshot.scope.matchingRecords, 3);
  assert.equal(snapshot.kpis.users, 2);
  assert.equal(snapshot.kpis.locations, 1);
  assert.equal(snapshot.kpis.topLocation, 'Chicago, Illinois, United States');
  assert.equal(snapshot.dimensions.fileTypes.reduce((sum, item) => sum + item.count, 0), 3);
});

test('AI strategy questions are grounded in the calculated product opportunity', () => {
  const snapshot = buildIntelligenceSnapshot(rows, { range: 'all' });
  const answer = buildStrategyAnswer(
    'I want to advertise an antivirus product. Which area should I test first?',
    snapshot
  );

  assert.equal(answer.scenario, 'antivirus-security');
  assert.match(answer.title, /Security|Antivirus/i);
  assert.ok(answer.evidence.length >= 3);
  assert.ok(answer.recommendation.length > 20);
  assert.equal(answer.confidence.recommendation, 'TEST FIRST');
  assert.match(answer.risk, /not ad clicks|not.*purchase|not.*willingness|usage behavior/i);
});

test('channel comparison produces a transparent Google vs Meta strategy', () => {
  const snapshot = buildIntelligenceSnapshot(rows, { range: 'all' });
  const answer = buildStrategyAnswer(
    'Should I use Google Ads or Instagram Meta?',
    snapshot
  );

  assert.equal(answer.scenario, 'channel-comparison');
  assert.equal(answer.chart.data.length, 2);
  assert.match(answer.directAnswer, /recommended first|comparison channel/i);
  assert.doesNotMatch(answer.directAnswer, /\/100/);
});

test('external AI evidence is aggregate and excludes raw users and transfer IDs', () => {
  const snapshot = buildIntelligenceSnapshot(rows, { range: 'all' });
  const answer = buildStrategyAnswer('What should management do next?', snapshot);
  const evidence = compactAiEvidence(snapshot, answer);
  const serialized = JSON.stringify(evidence);

  assert.doesNotMatch(serialized, /Alpha|Beta|Gamma|Epsilon|Zeta/);
  assert.doesNotMatch(serialized, /00000000-0000-4000/);
  assert.equal(evidence.scope.records, 8);
});
