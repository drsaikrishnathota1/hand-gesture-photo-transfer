'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  emptyToolFilters,
  applyDashboardFilters,
  executeAgentTool,
  generateAirGestureAgentAnswer
} = require('../airgesture-ai-agent');

const rows = [
  {
    time: '2026-08-18T13:00:00.000Z', student: 'Alice Raw Name', room: 'A1',
    transferId: '00000000-0000-4000-8000-000000000001', action: 'SEND',
    fileType: 'PDF', fileSizeBytes: 18_000_000, result: 'SENT',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Chrome',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-18T12:00:00.000Z', student: 'Bob Raw Name', room: 'A2',
    transferId: '00000000-0000-4000-8000-000000000002', action: 'RECEIVE',
    fileType: 'DOCUMENT', fileSizeBytes: 12_000_000, result: 'SUCCESS',
    device: 'Laptop/Desktop', os: 'Windows', browser: 'Edge',
    location: 'Chicago, Illinois, United States', commercialSegment: 'WINDOWS_DESKTOP'
  },
  {
    time: '2026-08-17T18:00:00.000Z', student: 'Cara Raw Name', room: 'A3',
    transferId: '00000000-0000-4000-8000-000000000003', action: 'SEND',
    fileType: 'IMAGE', fileSizeBytes: 8_000_000, result: 'SENT',
    device: 'Mobile', os: 'Android', browser: 'Chrome',
    location: 'Chicago, Illinois, United States', commercialSegment: 'ANDROID_MOBILE'
  },
  {
    time: '2026-08-17T15:00:00.000Z', student: 'Dan Raw Name', room: 'D1',
    transferId: '00000000-0000-4000-8000-000000000004', action: 'SEND',
    fileType: 'VIDEO', fileSizeBytes: 20_000_000, result: 'SENT',
    device: 'Mobile', os: 'Android', browser: 'Chrome',
    location: 'Dallas, Texas, United States', commercialSegment: 'ANDROID_MOBILE'
  },
  {
    time: '2026-08-16T16:00:00.000Z', student: 'Eve Raw Name', room: 'N1',
    transferId: '00000000-0000-4000-8000-000000000005', action: 'RECEIVE',
    fileType: 'IMAGE', fileSizeBytes: 6_000_000, result: 'SUCCESS',
    device: 'Mobile', os: 'iOS/iPadOS', browser: 'Safari',
    location: 'New York, New York, United States', commercialSegment: 'APPLE_MOBILE'
  },
  {
    time: '2026-08-16T12:00:00.000Z', student: 'Frank Raw Name', room: 'N2',
    transferId: '00000000-0000-4000-8000-000000000006', action: 'SEND',
    fileType: 'IMAGE', fileSizeBytes: 9_000_000, result: 'SENT',
    device: 'Mobile', os: 'iOS/iPadOS', browser: 'Safari',
    location: 'New York, New York, United States', commercialSegment: 'APPLE_MOBILE'
  }
];

function filters() {
  return emptyToolFilters();
}

test('V4 answers least-users questions from live aggregate ordering, not the old strongest-market fallback', () => {
  const result = executeAgentTool('rank_dimension', {
    dimension: 'location', metric: 'unique_users', order: 'asc', limit: 3,
    exclude_unknown: true, filters: filters()
  }, rows);

  assert.equal(result.groups[0].label, 'Dallas, Texas, United States');
  assert.equal(result.groups[0].uniqueUsers, 1);
  assert.equal(result.groups.at(-1).label, 'Chicago, Illinois, United States');
});

test('V4 ranks most users correctly and keeps raw identities out of tool output', () => {
  const result = executeAgentTool('rank_dimension', {
    dimension: 'location', metric: 'unique_users', order: 'desc', limit: 3,
    exclude_unknown: true, filters: filters()
  }, rows);

  assert.equal(result.groups[0].label, 'Chicago, Illinois, United States');
  assert.equal(result.groups[0].uniqueUsers, 3);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Alice Raw Name|Bob Raw Name|Cara Raw Name|Dan Raw Name/);
  assert.doesNotMatch(serialized, /00000000-0000-4000|A1|D1/);
});

test('V4 supports product-proxy analysis with live filters such as mobile activity by market', () => {
  const result = executeAgentTool('rank_dimension', {
    dimension: 'location', metric: 'unique_users', order: 'desc', limit: 5,
    exclude_unknown: true,
    filters: { ...filters(), device: ['Mobile'] }
  }, rows);

  assert.equal(result.groups[0].label, 'New York, New York, United States');
  assert.equal(result.groups[0].uniqueUsers, 2);
  assert.equal(result.groups.find((item) => item.label.startsWith('Dallas')).uniqueUsers, 1);
});

test('V4 fuzzy comparison resolves normal city names against stored full location labels', () => {
  const result = executeAgentTool('compare_dimension_values', {
    dimension: 'location', values: ['Dallas', 'Chicago'], metric: 'events', filters: filters()
  }, rows);

  assert.equal(result.notFound.length, 0);
  assert.ok(result.groups.some((item) => item.matchedValue === 'Dallas, Texas, United States'));
  assert.ok(result.groups.some((item) => item.matchedValue === 'Chicago, Illinois, United States'));
});

test('V4 respects the active dashboard scope before AI tools execute', () => {
  const filtered = applyDashboardFilters(rows, { segment: 'APPLE_MOBILE', range: 'all' });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((row) => row.location.startsWith('New York')));
});

test('V4 OpenAI loop executes a live function call and returns a structured answer', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  let call = 0;

  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    call += 1;

    if (call === 1) {
      return {
        ok: true,
        async json() {
          return {
            output: [{
              type: 'function_call',
              call_id: 'call_rank_1',
              name: 'rank_dimension',
              arguments: JSON.stringify({
                dimension: 'location',
                metric: 'unique_users',
                order: 'asc',
                limit: 3,
                exclude_unknown: true,
                filters: filters()
              })
            }]
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: JSON.stringify({
                scenario: 'market-ranking',
                title: 'Markets with the fewest observed users',
                directAnswer: 'Dallas has the fewest observed users in the current AirGesture scope, with 1 unique user.',
                evidence: ['Dallas has 1 unique user in the current scope.', 'New York has 2 unique users.', 'Chicago has 3 unique users.'],
                interpretation: 'Dallas is the smallest observed market by unique-user count in this dataset.',
                recommendation: 'Treat this as a descriptive finding, not a market-quality conclusion.',
                experiment: 'If market expansion is the goal, compare response rates rather than choosing a market only by user count.',
                channel: '',
                limitation: 'The current AirGesture dataset measures usage, not total addressable market size.',
                evidenceStrength: 'HIGH',
                followUps: ['Which area has the most users?', 'Compare Dallas and Chicago.']
              })
            }]
          }]
        };
      }
    };
  };

  try {
    const result = await generateAirGestureAgentAnswer({
      question: 'Which area has least users?',
      history: [],
      rows,
      filters: { range: 'all' },
      apiKey: 'test-key',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium'
    });

    assert.equal(result.ai.used, true);
    assert.equal(result.ai.source, 'live-tool-agent');
    assert.equal(result.ai.toolCalls, 1);
    assert.match(result.strategy.directAnswer, /Dallas.*1 unique user/i);
    assert.equal(requests[0].tool_choice, 'required');
    assert.equal(requests[0].model, 'gpt-5.6-sol');
    assert.equal(requests[0].reasoning.effort, 'medium');
    assert.equal(requests[0].text.format.type, 'json_schema');
    assert.ok(requests[1].input.some((item) => item.type === 'function_call_output' && /Dallas/.test(item.output)));
  } finally {
    global.fetch = originalFetch;
  }
});

test('V4 refuses to impersonate AI when no server API key is configured', async () => {
  await assert.rejects(
    () => generateAirGestureAgentAnswer({ question: 'Which market has most users?', rows, apiKey: '' }),
    /OPENAI_API_KEY is not configured/
  );
});
