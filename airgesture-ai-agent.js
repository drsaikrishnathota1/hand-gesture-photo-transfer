'use strict';

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const DIMENSIONS = [
  'location', 'segment', 'file_type', 'device', 'os', 'browser',
  'action', 'result', 'day', 'hour'
];

const METRICS = [
  'unique_users', 'events', 'data_volume_bytes', 'average_file_size_bytes'
];

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location: { type: ['array', 'null'], items: { type: 'string' } },
    segment: { type: ['array', 'null'], items: { type: 'string' } },
    file_type: { type: ['array', 'null'], items: { type: 'string' } },
    device: { type: ['array', 'null'], items: { type: 'string' } },
    os: { type: ['array', 'null'], items: { type: 'string' } },
    browser: { type: ['array', 'null'], items: { type: 'string' } },
    action: { type: ['array', 'null'], items: { type: 'string' } },
    result: { type: ['array', 'null'], items: { type: 'string' } },
    day: { type: ['array', 'null'], items: { type: 'string' } },
    hour: { type: ['array', 'null'], items: { type: 'string' } }
  },
  required: [
    'location', 'segment', 'file_type', 'device', 'os', 'browser',
    'action', 'result', 'day', 'hour'
  ]
};

const AGENT_TOOLS = [
  {
    type: 'function',
    name: 'get_scope_summary',
    description: 'Read the current AirGesture analysis scope and the leading aggregate values for markets, audiences, file types, devices, operating systems and browsers. Use this when you need orientation before a more specific analysis.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: []
    },
    strict: true
  },
  {
    type: 'function',
    name: 'rank_dimension',
    description: 'Rank an AirGesture dimension by an observed metric. Use location for market/area/city questions. Use unique_users when the user asks about users, events for activity/transfers, and data_volume_bytes for volume. Set order=asc for least/fewest/smallest and desc for most/highest/largest.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimension: { type: 'string', enum: DIMENSIONS },
        metric: { type: 'string', enum: METRICS },
        order: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        exclude_unknown: { type: 'boolean' },
        filters: FILTER_SCHEMA
      },
      required: ['dimension', 'metric', 'order', 'limit', 'exclude_unknown', 'filters']
    },
    strict: true
  },
  {
    type: 'function',
    name: 'compare_dimension_values',
    description: 'Compare specific markets, audience segments, file types, devices, operating systems or other dimension values using live aggregate AirGesture metrics. Use this for questions such as compare Dallas and Chicago, Apple vs Windows, or PDF vs image.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimension: { type: 'string', enum: DIMENSIONS },
        values: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } },
        metric: { type: 'string', enum: METRICS },
        filters: FILTER_SCHEMA
      },
      required: ['dimension', 'values', 'metric', 'filters']
    },
    strict: true
  },
  {
    type: 'function',
    name: 'get_group_profile',
    description: 'Get an aggregate profile for one named market, audience, file type, device or platform. Returns counts plus the strongest related markets, audiences, content types, devices, operating systems and timing patterns. Use this for follow-up questions like what about Dallas, why that market, or what audience exists there.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimension: { type: 'string', enum: DIMENSIONS },
        value: { type: 'string' },
        filters: FILTER_SCHEMA
      },
      required: ['dimension', 'value', 'filters']
    },
    strict: true
  },
  {
    type: 'function',
    name: 'cross_tab_analysis',
    description: 'Analyze two dimensions together using aggregate AirGesture data, such as market by audience, market by file type, market by OS, or audience by content type. Use this when the user asks which market has the most mobile/Windows/PDF activity or when product targeting requires a transparent behavioral proxy.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        row_dimension: { type: 'string', enum: DIMENSIONS },
        column_dimension: { type: 'string', enum: DIMENSIONS },
        metric: { type: 'string', enum: ['unique_users', 'events', 'data_volume_bytes'] },
        row_limit: { type: 'integer', minimum: 1, maximum: 10 },
        column_limit: { type: 'integer', minimum: 1, maximum: 8 },
        exclude_unknown: { type: 'boolean' },
        filters: FILTER_SCHEMA
      },
      required: [
        'row_dimension', 'column_dimension', 'metric', 'row_limit',
        'column_limit', 'exclude_unknown', 'filters'
      ]
    },
    strict: true
  }
];

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scenario: { type: 'string' },
    title: { type: 'string' },
    directAnswer: {
      type: 'string',
      description: 'Answer the current user question immediately and specifically. Do not restate the question.'
    },
    evidence: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string' }
    },
    interpretation: { type: 'string' },
    recommendation: { type: 'string' },
    experiment: { type: 'string' },
    channel: { type: 'string' },
    limitation: { type: 'string' },
    evidenceStrength: {
      type: 'string',
      enum: ['HIGH', 'MODERATE', 'LIMITED']
    },
    followUps: {
      type: 'array',
      minItems: 0,
      maxItems: 4,
      items: { type: 'string' }
    }
  },
  required: [
    'scenario', 'title', 'directAnswer', 'evidence', 'interpretation',
    'recommendation', 'experiment', 'channel', 'limitation',
    'evidenceStrength', 'followUps'
  ]
};

function clean(value) {
  return String(value ?? '').trim();
}

function safeTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9\s:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUnknown(value) {
  const normalized = normalizeText(value);
  return !normalized || [
    'unknown', 'unspecified', 'n a', 'na', 'none', 'null', 'undefined', '-'
  ].includes(normalized);
}

function rowDimensionValue(row, dimension) {
  switch (dimension) {
    case 'location':
      return clean(row?.location) || 'Unknown';
    case 'segment':
      return clean(row?.commercialSegment) || 'Unknown';
    case 'file_type':
      return clean(row?.fileType).toUpperCase() || 'Unknown';
    case 'device':
      return clean(row?.device) || 'Unknown';
    case 'os':
      return clean(row?.os) || 'Unknown';
    case 'browser':
      return clean(row?.browser) || 'Unknown';
    case 'action':
      return clean(row?.action).toUpperCase() || 'Unknown';
    case 'result':
      return clean(row?.result).toUpperCase() || 'Unknown';
    case 'day': {
      const ms = safeTime(row?.time);
      return ms === null ? 'Unknown' : DAY_NAMES[new Date(ms).getUTCDay()];
    }
    case 'hour': {
      const ms = safeTime(row?.time);
      if (ms === null) return 'Unknown';
      const hour = new Date(ms).getUTCHours();
      return `${String(hour).padStart(2, '0')}:00 UTC`;
    }
    default:
      return 'Unknown';
  }
}

function fuzzyMatch(actual, requested) {
  const a = normalizeText(actual);
  const r = normalizeText(requested);
  if (!a || !r) return false;
  if (a === r) return true;
  if (r.length >= 3 && a.includes(r)) return true;
  if (a.length >= 3 && r.includes(a)) return true;
  return false;
}

function listMatches(actual, requestedList) {
  if (!Array.isArray(requestedList) || requestedList.length === 0) return true;
  return requestedList.some((requested) => fuzzyMatch(actual, requested));
}

function normalizeDashboardFilters(filters = {}) {
  const range = ['all', '7d', '30d', '90d'].includes(clean(filters.range).toLowerCase())
    ? clean(filters.range).toLowerCase()
    : 'all';

  return {
    range,
    segment: clean(filters.segment),
    location: clean(filters.location),
    fileType: clean(filters.fileType),
    device: clean(filters.device),
    os: clean(filters.os),
    browser: clean(filters.browser),
    day: clean(filters.day),
    hour: clean(filters.hour)
  };
}

function latestTimestamp(rows) {
  let latest = null;
  for (const row of rows || []) {
    const ms = safeTime(row?.time);
    if (ms !== null && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}

function applyDashboardFilters(rows, filters = {}) {
  const f = normalizeDashboardFilters(filters);
  const anchor = latestTimestamp(rows);
  const days = f.range === '7d' ? 7 : f.range === '30d' ? 30 : f.range === '90d' ? 90 : null;
  const minTime = days && anchor !== null ? anchor - days * 86400000 : null;

  return (rows || []).filter((row) => {
    const ms = safeTime(row?.time);
    if (minTime !== null && (ms === null || ms < minTime)) return false;
    if (f.segment && !fuzzyMatch(rowDimensionValue(row, 'segment'), f.segment)) return false;
    if (f.location && !fuzzyMatch(rowDimensionValue(row, 'location'), f.location)) return false;
    if (f.fileType && !fuzzyMatch(rowDimensionValue(row, 'file_type'), f.fileType)) return false;
    if (f.device && !fuzzyMatch(rowDimensionValue(row, 'device'), f.device)) return false;
    if (f.os && !fuzzyMatch(rowDimensionValue(row, 'os'), f.os)) return false;
    if (f.browser && !fuzzyMatch(rowDimensionValue(row, 'browser'), f.browser)) return false;
    if (f.day && !fuzzyMatch(rowDimensionValue(row, 'day'), f.day)) return false;
    if (f.hour) {
      const value = rowDimensionValue(row, 'hour');
      const normalizedHour = /^\d{1,2}$/.test(f.hour)
        ? `${String(Number(f.hour)).padStart(2, '0')}:00 UTC`
        : f.hour;
      if (!fuzzyMatch(value, normalizedHour)) return false;
    }
    return true;
  });
}

function applyToolFilters(rows, filters = {}) {
  return (rows || []).filter((row) => {
    return (
      listMatches(rowDimensionValue(row, 'location'), filters.location) &&
      listMatches(rowDimensionValue(row, 'segment'), filters.segment) &&
      listMatches(rowDimensionValue(row, 'file_type'), filters.file_type) &&
      listMatches(rowDimensionValue(row, 'device'), filters.device) &&
      listMatches(rowDimensionValue(row, 'os'), filters.os) &&
      listMatches(rowDimensionValue(row, 'browser'), filters.browser) &&
      listMatches(rowDimensionValue(row, 'action'), filters.action) &&
      listMatches(rowDimensionValue(row, 'result'), filters.result) &&
      listMatches(rowDimensionValue(row, 'day'), filters.day) &&
      listMatches(rowDimensionValue(row, 'hour'), filters.hour)
    );
  });
}

function sumBytes(rows) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.fileSizeBytes || 0), 0);
}

function uniqueUsers(rows) {
  const users = new Set();
  for (const row of rows || []) {
    const user = clean(row?.student);
    if (user) users.add(user);
  }
  return users.size;
}

function aggregateRows(rows) {
  const events = (rows || []).length;
  const dataVolumeBytes = sumBytes(rows);
  return {
    events,
    uniqueUsers: uniqueUsers(rows),
    dataVolumeBytes,
    averageFileSizeBytes: events ? Math.round(dataVolumeBytes / events) : 0
  };
}

function metricValue(metrics, metric) {
  switch (metric) {
    case 'unique_users': return Number(metrics.uniqueUsers || 0);
    case 'data_volume_bytes': return Number(metrics.dataVolumeBytes || 0);
    case 'average_file_size_bytes': return Number(metrics.averageFileSizeBytes || 0);
    case 'events':
    default:
      return Number(metrics.events || 0);
  }
}

function groupRows(rows, dimension, excludeUnknown = true) {
  const map = new Map();
  for (const row of rows || []) {
    const value = rowDimensionValue(row, dimension);
    if (excludeUnknown && isUnknown(value)) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function serializeGroup(label, rows, totalEvents) {
  const metrics = aggregateRows(rows);
  return {
    label,
    ...metrics,
    eventSharePct: totalEvents ? Math.round((metrics.events / totalEvents) * 1000) / 10 : 0
  };
}

function rankDimension(rows, args = {}) {
  const dimension = DIMENSIONS.includes(args.dimension) ? args.dimension : 'location';
  const metric = METRICS.includes(args.metric) ? args.metric : 'events';
  const order = args.order === 'asc' ? 'asc' : 'desc';
  const limit = Math.max(1, Math.min(20, Number(args.limit || 5)));
  const filtered = applyToolFilters(rows, args.filters || {});
  const groups = groupRows(filtered, dimension, args.exclude_unknown !== false);
  const totalEvents = filtered.length;

  const values = [...groups.entries()]
    .map(([label, group]) => serializeGroup(label, group, totalEvents))
    .sort((a, b) => {
      const delta = metricValue(a, metric) - metricValue(b, metric);
      if (delta !== 0) return order === 'asc' ? delta : -delta;
      const eventDelta = a.events - b.events;
      if (eventDelta !== 0) return order === 'asc' ? eventDelta : -eventDelta;
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);

  return {
    tool: 'rank_dimension',
    dimension,
    metric,
    order,
    analyzedEvents: filtered.length,
    analyzedUsers: uniqueUsers(filtered),
    groups: values
  };
}

function resolveRequestedGroup(groups, requested) {
  const exact = [...groups.keys()].find((value) => normalizeText(value) === normalizeText(requested));
  if (exact) return exact;
  const candidates = [...groups.entries()]
    .filter(([value]) => fuzzyMatch(value, requested))
    .sort((a, b) => b[1].length - a[1].length);
  return candidates[0]?.[0] || null;
}

function compareDimensionValues(rows, args = {}) {
  const dimension = DIMENSIONS.includes(args.dimension) ? args.dimension : 'location';
  const metric = METRICS.includes(args.metric) ? args.metric : 'events';
  const filtered = applyToolFilters(rows, args.filters || {});
  const groups = groupRows(filtered, dimension, false);
  const totalEvents = filtered.length;
  const results = [];
  const notFound = [];

  for (const requested of args.values || []) {
    const matched = resolveRequestedGroup(groups, requested);
    if (!matched) {
      notFound.push(requested);
      continue;
    }
    results.push({
      requestedValue: requested,
      matchedValue: matched,
      ...serializeGroup(matched, groups.get(matched), totalEvents)
    });
  }

  results.sort((a, b) => metricValue(b, metric) - metricValue(a, metric));

  return {
    tool: 'compare_dimension_values',
    dimension,
    metric,
    analyzedEvents: filtered.length,
    groups: results,
    notFound
  };
}

function topDimension(rows, dimension, limit = 5) {
  return rankDimension(rows, {
    dimension,
    metric: 'events',
    order: 'desc',
    limit,
    exclude_unknown: true,
    filters: {}
  }).groups;
}

function getGroupProfile(rows, args = {}) {
  const dimension = DIMENSIONS.includes(args.dimension) ? args.dimension : 'location';
  const filtered = applyToolFilters(rows, args.filters || {});
  const groups = groupRows(filtered, dimension, false);
  const matched = resolveRequestedGroup(groups, args.value || '');

  if (!matched) {
    return {
      tool: 'get_group_profile',
      dimension,
      requestedValue: args.value || '',
      found: false
    };
  }

  const group = groups.get(matched);
  const profile = aggregateRows(group);
  const relatedDimensions = ['location', 'segment', 'file_type', 'device', 'os', 'browser', 'day', 'hour']
    .filter((item) => item !== dimension);

  const breakdowns = {};
  for (const related of relatedDimensions) {
    breakdowns[related] = topDimension(group, related, related === 'hour' ? 3 : 5);
  }

  return {
    tool: 'get_group_profile',
    dimension,
    requestedValue: args.value || '',
    matchedValue: matched,
    found: true,
    ...profile,
    breakdowns
  };
}

function crossTabAnalysis(rows, args = {}) {
  const rowDimension = DIMENSIONS.includes(args.row_dimension) ? args.row_dimension : 'location';
  const columnDimension = DIMENSIONS.includes(args.column_dimension) ? args.column_dimension : 'segment';
  const metric = ['unique_users', 'events', 'data_volume_bytes'].includes(args.metric)
    ? args.metric
    : 'events';
  const rowLimit = Math.max(1, Math.min(10, Number(args.row_limit || 5)));
  const columnLimit = Math.max(1, Math.min(8, Number(args.column_limit || 5)));
  const filtered = applyToolFilters(rows, args.filters || {});

  const topRows = rankDimension(filtered, {
    dimension: rowDimension,
    metric,
    order: 'desc',
    limit: rowLimit,
    exclude_unknown: args.exclude_unknown !== false,
    filters: {}
  }).groups.map((item) => item.label);

  const topColumns = rankDimension(filtered, {
    dimension: columnDimension,
    metric,
    order: 'desc',
    limit: columnLimit,
    exclude_unknown: args.exclude_unknown !== false,
    filters: {}
  }).groups.map((item) => item.label);

  const matrix = topRows.map((rowValue) => {
    const rowSubset = filtered.filter((row) => fuzzyMatch(rowDimensionValue(row, rowDimension), rowValue));
    const cells = topColumns.map((columnValue) => {
      const cellRows = rowSubset.filter((row) => fuzzyMatch(rowDimensionValue(row, columnDimension), columnValue));
      const metrics = aggregateRows(cellRows);
      return {
        column: columnValue,
        value: metricValue(metrics, metric),
        events: metrics.events,
        uniqueUsers: metrics.uniqueUsers,
        dataVolumeBytes: metrics.dataVolumeBytes
      };
    });
    return { row: rowValue, cells };
  });

  return {
    tool: 'cross_tab_analysis',
    rowDimension,
    columnDimension,
    metric,
    analyzedEvents: filtered.length,
    columns: topColumns,
    rows: matrix
  };
}

function getScopeSummary(rows) {
  const summary = aggregateRows(rows);
  return {
    tool: 'get_scope_summary',
    ...summary,
    marketCount: groupRows(rows, 'location', true).size,
    top: {
      locations: topDimension(rows, 'location', 5),
      segments: topDimension(rows, 'segment', 5),
      fileTypes: topDimension(rows, 'file_type', 5),
      devices: topDimension(rows, 'device', 5),
      operatingSystems: topDimension(rows, 'os', 5),
      browsers: topDimension(rows, 'browser', 5)
    }
  };
}

function executeAgentTool(name, args, rows) {
  switch (name) {
    case 'get_scope_summary':
      return getScopeSummary(rows);
    case 'rank_dimension':
      return rankDimension(rows, args);
    case 'compare_dimension_values':
      return compareDimensionValues(rows, args);
    case 'get_group_profile':
      return getGroupProfile(rows, args);
    case 'cross_tab_analysis':
      return crossTabAnalysis(rows, args);
    default:
      return { error: `Unknown AirGesture tool: ${name}` };
  }
}

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && clean(item.content))
    .map((item) => ({ role: item.role, content: clean(item.content).slice(0, 1200) }))
    .slice(-10);
}

function emptyToolFilters() {
  return {
    location: null,
    segment: null,
    file_type: null,
    device: null,
    os: null,
    browser: null,
    action: null,
    result: null,
    day: null,
    hour: null
  };
}

function extractOutputText(payload = {}) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  return (payload.output || [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === 'output_text' && typeof part?.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function agentInstructions() {
  return [
    'You are the AirGesture AI Data Agent for a DBA 802 Data Analytics and Strategic Decision Intelligence lab.',
    'Every answer must be grounded in live aggregate AirGesture data obtained through the provided tools. Do not answer a data question from memory or from a generic heuristic.',
    'Interpret the current question literally. Examples: area/market/city means location; users means unique_users; most/highest means descending; least/fewest means ascending. If the user asks "which area has least users", call rank_dimension with dimension=location, metric=unique_users, order=asc.',
    'Use the recent conversation only to resolve follow-up references such as "that market", "the other one", "why?", or "what about Dallas?". The current user question has priority.',
    'You may call multiple tools when the question requires multiple signals. Prefer transparent observed metrics over invented scores.',
    'For a product that AirGesture does not directly observe, such as a music app, do not pretend AirGesture measures demand for that product. Use clearly stated behavioral proxies only when useful, such as market user base, mobile platform activity, Apple/Android activity, or media-file activity, and explicitly state the limitation.',
    'Do not infer age, gender, income, race, nationality, health, politics, religion, or any sensitive trait.',
    'Do not invent revenue, conversions, ad clicks, CPC, purchase intent, willingness to pay, company size, industry, or any metric AirGesture does not collect.',
    'Never reveal raw user names, transfer IDs, room IDs, IP addresses, or file contents. Tool outputs contain aggregates only.',
    'Do not use the old 0-100 heuristic scores.',
    'If the requested conclusion is unsupported, say so and explain what the data can support instead.',
    'The first sentence of directAnswer must directly answer the exact question. For ranking questions, name the requested market/audience/value and the metric used.',
    'Evidence should quote concrete aggregate counts or shares returned by tools. Keep recommendations separate from observations.',
    'Use a controlled-test recommendation rather than claiming certainty about future business outcomes.'
  ].join(' ');
}

function formatMetricLabel(metric) {
  switch (metric) {
    case 'unique_users': return 'Unique users';
    case 'data_volume_bytes': return 'Data volume (bytes)';
    case 'average_file_size_bytes': return 'Average file size (bytes)';
    case 'events':
    default: return 'Events';
  }
}

function buildChartFromToolTrace(trace = []) {
  const candidates = [...trace].reverse();
  for (const item of candidates) {
    const result = item?.result;
    if (!result || !Array.isArray(result.groups) || result.groups.length < 2) continue;
    if (!['rank_dimension', 'compare_dimension_values'].includes(result.tool)) continue;
    const metric = result.metric || 'events';
    return {
      type: 'bar',
      title: `${formatMetricLabel(metric)} by ${String(result.dimension || 'group').replace(/_/g, ' ')}`,
      label: formatMetricLabel(metric),
      dimension: result.dimension || '',
      metric,
      data: result.groups.slice(0, 10).map((group) => ({
        label: group.matchedValue || group.label,
        value: metricValue(group, metric)
      }))
    };
  }
  return null;
}

function normalizeFinalAnswer(parsed, trace = []) {
  const directAnswer = clean(parsed?.directAnswer);
  if (!directAnswer) throw new Error('AI agent returned no direct answer.');
  const evidence = Array.isArray(parsed?.evidence)
    ? parsed.evidence.map(clean).filter(Boolean).slice(0, 6)
    : [];
  const followUps = Array.isArray(parsed?.followUps)
    ? parsed.followUps.map(clean).filter(Boolean).slice(0, 4)
    : [];

  return {
    scenario: clean(parsed?.scenario) || 'data-analysis',
    title: clean(parsed?.title) || 'AirGesture analysis',
    directAnswer,
    evidence,
    interpretation: clean(parsed?.interpretation),
    recommendation: clean(parsed?.recommendation),
    experiment: clean(parsed?.experiment),
    channel: clean(parsed?.channel),
    limitation: clean(parsed?.limitation),
    risk: clean(parsed?.limitation),
    evidenceStrength: ['HIGH', 'MODERATE', 'LIMITED'].includes(parsed?.evidenceStrength)
      ? parsed.evidenceStrength
      : 'MODERATE',
    followUps,
    chart: buildChartFromToolTrace(trace)
  };
}

async function postOpenAi(body, apiKey, signal) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 320)}`);
  }
  return response.json();
}

async function generateAirGestureAgentAnswer(input = {}) {
  const question = clean(input.question).slice(0, 500);
  const apiKey = clean(input.apiKey);
  const model = clean(input.model) || 'gpt-5.6-sol';
  const reasoningEffort = ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(clean(input.reasoningEffort))
    ? clean(input.reasoningEffort)
    : 'medium';
  const allRows = Array.isArray(input.rows) ? input.rows : [];
  const dashboardFilters = normalizeDashboardFilters(input.filters || {});
  const rows = applyDashboardFilters(allRows, dashboardFilters);
  const history = normalizeHistory(input.history || []);

  if (!question) throw new Error('A strategy question is required.');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (!globalThis.fetch) throw new Error('Server fetch is unavailable.');

  const inputItems = history.map((message) => ({
    role: message.role,
    content: message.content
  }));

  inputItems.push({
    role: 'user',
    content: [
      `Current question: ${question}`,
      `Active AirGesture dashboard filters: ${JSON.stringify(dashboardFilters)}`,
      `Current filtered scope contains ${rows.length} events.`,
      'Use the AirGesture tools to obtain any facts needed for the answer.'
    ].join('\n')
  });

  const toolTrace = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let response = null;
    const maxToolRounds = 4;

    for (let round = 0; round < maxToolRounds; round += 1) {
      response = await postOpenAi({
        model,
        store: false,
        reasoning: { effort: reasoningEffort },
        instructions: agentInstructions(),
        input: inputItems,
        tools: AGENT_TOOLS,
        tool_choice: round === 0 ? 'required' : 'auto',
        parallel_tool_calls: true,
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'airgesture_agent_answer',
            description: 'A live-data-grounded answer to the exact AirGesture business question.',
            strict: true,
            schema: ANSWER_SCHEMA
          }
        }
      }, apiKey, controller.signal);

      const outputs = Array.isArray(response?.output) ? response.output : [];
      inputItems.push(...outputs);

      const calls = outputs.filter((item) => item?.type === 'function_call');
      if (!calls.length) {
        const outputText = extractOutputText(response);
        if (!outputText) throw new Error('OpenAI returned no final AI agent answer.');
        let parsed;
        try {
          parsed = JSON.parse(outputText);
        } catch {
          throw new Error('OpenAI returned an invalid structured AI agent answer.');
        }
        return {
          strategy: normalizeFinalAnswer(parsed, toolTrace),
          ai: {
            configured: true,
            used: true,
            provider: 'OpenAI + AirGesture live data tools',
            model,
            reasoningEffort,
            source: 'live-tool-agent',
            toolCalls: toolTrace.length
          },
          toolTrace: toolTrace.map((item) => ({ name: item.name, args: item.args }))
        };
      }

      for (const call of calls) {
        let args = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }

        const result = executeAgentTool(call.name, args, rows);
        toolTrace.push({ name: call.name, args, result });
        inputItems.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
    }

    response = await postOpenAi({
      model,
      store: false,
      reasoning: { effort: reasoningEffort },
      instructions: `${agentInstructions()} No more tool calls are allowed. Produce the final structured answer using the tool results already in the conversation.`,
      input: inputItems,
      tools: AGENT_TOOLS,
      tool_choice: 'none',
      text: {
        verbosity: 'medium',
        format: {
          type: 'json_schema',
          name: 'airgesture_agent_answer',
          strict: true,
          schema: ANSWER_SCHEMA
        }
      }
    }, apiKey, controller.signal);

    const outputText = extractOutputText(response);
    if (!outputText) throw new Error('OpenAI returned no final AI agent answer.');

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error('OpenAI returned an invalid final AI agent answer.');
    }

    return {
      strategy: normalizeFinalAnswer(parsed, toolTrace),
      ai: {
        configured: true,
        used: true,
        provider: 'OpenAI + AirGesture live data tools',
        model,
        reasoningEffort,
        source: 'live-tool-agent',
        toolCalls: toolTrace.length
      },
      toolTrace: toolTrace.map((item) => ({ name: item.name, args: item.args }))
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  AGENT_TOOLS,
  ANSWER_SCHEMA,
  emptyToolFilters,
  normalizeDashboardFilters,
  applyDashboardFilters,
  executeAgentTool,
  rankDimension,
  compareDimensionValues,
  getGroupProfile,
  crossTabAnalysis,
  getScopeSummary,
  normalizeHistory,
  generateAirGestureAgentAnswer
};
