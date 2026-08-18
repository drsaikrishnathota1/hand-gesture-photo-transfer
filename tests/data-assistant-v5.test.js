'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { answerAirGestureQuestion } = require('../airgesture-data-assistant');

const rows = [
  { time:'2026-08-18T13:00:00Z', student:'Alice', room:'A1', transferId:'id1', action:'SEND', fileType:'PDF', fileSizeBytes:18000000, result:'SENT', device:'Laptop/Desktop', os:'Windows', browser:'Chrome', location:'Chicago, Illinois, United States', commercialSegment:'WINDOWS_DESKTOP' },
  { time:'2026-08-18T12:00:00Z', student:'Bob', room:'A2', transferId:'id2', action:'RECEIVE', fileType:'DOCUMENT', fileSizeBytes:12000000, result:'SUCCESS', device:'Laptop/Desktop', os:'Windows', browser:'Edge', location:'Chicago, Illinois, United States', commercialSegment:'WINDOWS_DESKTOP' },
  { time:'2026-08-17T18:00:00Z', student:'Cara', room:'A3', transferId:'id3', action:'SEND', fileType:'IMAGE', fileSizeBytes:8000000, result:'SENT', device:'Mobile', os:'Android', browser:'Chrome', location:'Chicago, Illinois, United States', commercialSegment:'ANDROID_MOBILE' },
  { time:'2026-08-17T15:00:00Z', student:'Dan', room:'D1', transferId:'id4', action:'SEND', fileType:'VIDEO', fileSizeBytes:20000000, result:'SENT', device:'Mobile', os:'Android', browser:'Chrome', location:'Dallas, Texas, United States', commercialSegment:'ANDROID_MOBILE' },
  { time:'2026-08-16T16:00:00Z', student:'Eve', room:'N1', transferId:'id5', action:'RECEIVE', fileType:'IMAGE', fileSizeBytes:6000000, result:'SUCCESS', device:'Mobile', os:'iOS/iPadOS', browser:'Safari', location:'New York, New York, United States', commercialSegment:'APPLE_MOBILE' },
  { time:'2026-08-16T12:00:00Z', student:'Frank', room:'N2', transferId:'id6', action:'SEND', fileType:'IMAGE', fileSizeBytes:9000000, result:'SENT', device:'Mobile', os:'iOS/iPadOS', browser:'Safari', location:'New York, New York, United States', commercialSegment:'APPLE_MOBILE' }
];

function ask(question, history = []) {
  return answerAirGestureQuestion({ question, history, rows, filters:{range:'all'} });
}

test('least-users is exact and no external API is needed', () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('external fetch should not run'); };
  try {
    const out = ask('which area has least users');
    assert.match(out.strategy.directAnswer, /Dallas, TX.*fewest.*1 unique user/i);
    assert.equal(out.assistant.externalApi, false);
    assert.equal(out.assistant.costPerQuestion, 0);
  } finally { global.fetch = originalFetch; }
});

test('most users ranks Chicago first', () => {
  const out = ask('which area has most users');
  assert.match(out.strategy.directAnswer, /Chicago, IL.*most.*3 unique users/i);
});

test('Windows market question filters before ranking', () => {
  const out = ask('which area has the most Windows users?');
  assert.match(out.strategy.directAnswer, /Chicago, IL/i);
  assert.match(out.strategy.directAnswer, /Windows/i);
});

test('comparison understands normal city names', () => {
  const out = ask('compare Dallas and Chicago by users');
  assert.match(out.strategy.directAnswer, /Chicago, IL.*Dallas, TX/i);
  assert.match(out.strategy.directAnswer, /3 unique users.*1 unique user/i);
});

test('music-app question uses transparent mobile proxy and limitation', () => {
  const out = ask('I want to promote a music app. Which area is best?');
  assert.match(out.strategy.directAnswer, /New York, NY/i);
  assert.match(out.strategy.interpretation, /cannot measure demand.*directly/i);
  assert.match(out.strategy.limitation, /does not record music/i);
});

test('follow-up can reuse prior market context', () => {
  const first = ask('which area has most users');
  const history = [
    { role:'user', content:'which area has most users' },
    { role:'assistant', content:first.strategy.directAnswer }
  ];
  const out = ask('what about Chicago?', history);
  assert.match(out.strategy.directAnswer, /Chicago, IL.*3 observed users.*3 events/i);
});

test('summary never leaks raw names or transfer IDs', () => {
  const out = ask('summarize the data');
  const serialized = JSON.stringify(out);
  assert.doesNotMatch(serialized, /Alice|Bob|Cara|Dan|Eve|Frank|id1|id2|id3/);
});
