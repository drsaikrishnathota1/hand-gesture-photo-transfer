'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIntelligenceSnapshot,
  buildAiEvidencePackage,
  normalizeAiHistory,
  normalizeStructuredAiAnswer
} = require('../strategy-intelligence');

const {
  ANSWER_SCHEMA,
  generateAiStrategyAnswer
} = require('../ai-strategy-copilot');

const rows = [
  {
    time: '2026-08-18T13:00:00.000Z', student: 'Alpha Person', room: 'AERO-1',
    transferId: '00000000-0000-4000-8000-000000000001', action: 'SEND',
    fileType: 'PDF', fileSizeBytes: 18_000_000, result: 'SENT',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Chrome',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-18T12:00:00.000Z', student: 'Beta Person', room: 'AERO-2',
    transferId: '00000000-0000-4000-8000-000000000002', action: 'RECEIVE',
    fileType: 'DOCUMENT', fileSizeBytes: 12_000_000, result: 'SUCCESS',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Edge',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-17T15:00:00.000Z', student: 'Gamma Person', room: 'NOVA-1',
    transferId: '00000000-0000-4000-8000-000000000003', action: 'SEND',
    fileType: 'IMAGE', fileSizeBytes: 8_000_000, result: 'SENT',
    device: 'Mobile', os: 'Android', browser: 'Chrome',
    location: 'Dallas, Texas, United States', commercialSegment: 'ANDROID_MOBILE'
  },
  {
    time: '2026-08-16T16:00:00.000Z', student: 'Delta Person', room: 'NOVA-2',
    transferId: '00000000-0000-4000-8000-000000000004', action: 'RECEIVE',
    fileType: 'IMAGE', fileSizeBytes: 6_000_000, result: 'SUCCESS',
    device: 'Mobile', os: 'iOS/iPadOS', browser: 'Safari',
    location: 'New York, New York, United States', commercialSegment: 'APPLE_MOBILE'
  }
];

function snapshot() {
  return buildIntelligenceSnapshot(rows, { range: 'all' });
}

test('V3 AI evidence contains aggregate facts but no raw user or transfer identifiers', () => {
  const evidence = buildAiEvidencePackage(snapshot());
  const text = JSON.stringify(evidence);

  assert.match(text, /Chicago/);
  assert.match(text, /WINDOWS_DESKTOP/);
  assert.doesNotMatch(text, /Alpha Person|Beta Person|Gamma Person|Delta Person/);
  assert.doesNotMatch(text, /00000000-0000-4000/);
  assert.doesNotMatch(text, /AERO-1|NOVA-1/);
});

test('V3 keeps a bounded recent conversation for follow-up questions', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message-${index}`
  }));

  const normalized = normalizeAiHistory(history);
  assert.equal(normalized.length, 8);
  assert.equal(normalized[0].content, 'message-4');
  assert.equal(normalized.at(-1).content, 'message-11');
});

test('V3 structured answers use server-generated charts instead of model-generated numbers', () => {
  const result = normalizeStructuredAiAnswer({
    scenario: 'antivirus-market',
    title: 'Antivirus market test',
    directAnswer: 'Chicago is the first market I would test for this antivirus scenario.',
    evidence: ['Chicago has relevant Windows activity.'],
    interpretation: 'This is a test signal.',
    recommendation: 'Start with Chicago.',
    experiment: 'Compare Chicago with Dallas.',
    channel: 'Test Google Search first.',
    limitation: 'No ad conversion data is available.',
    evidenceStrength: 'MODERATE',
    chartKey: 'antivirusMarkets',
    chartTitle: 'Antivirus candidate markets',
    followUps: ['Why Chicago?', 'What about Dallas?']
  }, snapshot(), 'Where should I test antivirus?');

  assert.equal(result.directAnswer, 'Chicago is the first market I would test for this antivirus scenario.');
  assert.ok(result.chart.data.length >= 1);
  assert.equal(result.chart.label, 'Relevant events');
  assert.ok(result.chart.data.every((item) => Number.isFinite(item.value)));
});

test('V3 OpenAI request uses strict structured output and includes recent context', async () => {
  const originalFetch = global.fetch;
  let captured = null;

  global.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          output: [{
            content: [{
              type: 'output_text',
              text: JSON.stringify({
                scenario: 'market-comparison',
                title: 'Chicago vs Dallas',
                directAnswer: 'Chicago is the stronger first test in this scope.',
                evidence: ['Chicago has more relevant observed activity than Dallas.'],
                interpretation: 'The evidence supports prioritizing Chicago for a small test.',
                recommendation: 'Use Chicago first and Dallas as the comparison market.',
                experiment: 'Run the same antivirus message in both markets.',
                channel: 'Keep the channel constant during the market comparison.',
                limitation: 'AirGesture does not contain campaign conversion data.',
                evidenceStrength: 'MODERATE',
                chartKey: 'antivirusMarkets',
                chartTitle: 'Antivirus market evidence',
                followUps: ['Why Chicago?', 'Which channel should I use?']
              })
            }]
          }]
        };
      }
    };
  };

  try {
    const result = await generateAiStrategyAnswer({
      question: 'What about Dallas instead?',
      history: [
        { role: 'user', content: 'Where should I test an antivirus campaign?' },
        { role: 'assistant', content: 'Chicago is the strongest first candidate.' }
      ],
      snapshot: snapshot(),
      apiKey: 'test-key',
      model: 'gpt-5.6'
    });

    assert.equal(result.ai.used, true);
    assert.equal(result.strategy.directAnswer, 'Chicago is the stronger first test in this scope.');
    assert.equal(captured.text.format.type, 'json_schema');
    assert.equal(captured.text.format.strict, true);
    assert.match(JSON.stringify(captured.input), /What about Dallas instead/);
    assert.match(JSON.stringify(captured.input), /Chicago is the strongest first candidate/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('V3 response schema requires a direct answer and bounded chart selection', () => {
  assert.equal(ANSWER_SCHEMA.additionalProperties, false);
  assert.ok(ANSWER_SCHEMA.required.includes('directAnswer'));
  assert.ok(ANSWER_SCHEMA.required.includes('evidence'));
  assert.ok(ANSWER_SCHEMA.properties.chartKey.enum.includes('antivirusMarkets'));
  assert.ok(ANSWER_SCHEMA.properties.chartKey.enum.includes('none'));
});
