'use strict';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DIMENSIONS = [
  'location', 'segment', 'file_type', 'device', 'os', 'browser', 'room',
  'action', 'result', 'day', 'hour'
];

const METRICS = ['unique_users', 'events', 'data_volume_bytes', 'average_file_size_bytes'];

const NUMBER_WORDS = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10]
]);

const STATE_ABBR = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI',
  'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
  'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
  'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

const PRODUCT_PROFILES = [
  {
    id: 'music-app',
    keywords: /\b(music|audio|spotify|podcast|streaming audio|radio app)\b/i,
    label: 'music app',
    proxyLabel: 'mobile-oriented usage',
    predicate: (row) => {
      const device = normalizeText(row?.device);
      const segment = normalizeText(row?.commercialSegment);
      const os = normalizeText(row?.os);
      return device.includes('mobile') || device.includes('tablet') ||
        segment.includes('mobile') || segment.includes('tablet') ||
        os.includes('android') || os.includes('ios');
    },
    channel: 'A mobile/social awareness test is a reasonable channel hypothesis, but AirGesture contains no ad-performance data.',
    limitation: 'AirGesture does not record music listening, subscriptions, streaming preferences or music-app purchase intent. Mobile activity is only a proxy for where to test.'
  },
  {
    id: 'antivirus',
    keywords: /\b(antivirus|anti virus|security|cyber|malware|endpoint|vpn|privacy software)\b/i,
    label: 'antivirus/security software',
    proxyLabel: 'Windows/Android/Linux activity',
    predicate: (row) => /windows|android|linux/i.test(clean(row?.os)) || /WINDOWS_DESKTOP|ANDROID_MOBILE|LINUX_DESKTOP/i.test(clean(row?.commercialSegment)),
    channel: 'Search-intent advertising is a reasonable first hypothesis for security software, but AirGesture does not contain ad-click or conversion data.',
    limitation: 'AirGesture observes platform usage, not security incidents, antivirus ownership, malware risk or purchase intent.'
  },
  {
    id: 'pdf-document',
    keywords: /\b(pdf|document|e[ -]?sign|esign|adobe|document management)\b/i,
    label: 'PDF/document software',
    proxyLabel: 'PDF and document activity',
    predicate: (row) => ['PDF', 'DOCUMENT'].includes(clean(row?.fileType).toUpperCase()),
    channel: 'Search-intent advertising is a reasonable first hypothesis for document software, but actual channel performance must be measured separately.',
    limitation: 'PDF/document transfers indicate workflow relevance, not willingness to buy document software.'
  },
  {
    id: 'cloud-storage',
    keywords: /\b(cloud|storage|drive|dropbox|sync|large file|file sharing)\b/i,
    label: 'cloud storage/file management',
    proxyLabel: 'large-file and media transfer activity',
    predicate: (row) => Number(row?.fileSizeBytes || 0) >= 10 * 1024 * 1024 || ['IMAGE', 'VIDEO'].includes(clean(row?.fileType).toUpperCase()),
    channel: 'Search and retargeting are reasonable hypotheses for storage products, but AirGesture does not measure advertising performance.',
    limitation: 'File volume can indicate storage relevance, but it does not prove cloud-storage demand or purchase intent.'
  },
  {
    id: 'backup',
    keywords: /\b(backup|recovery|restore|data protection)\b/i,
    label: 'backup/recovery software',
    proxyLabel: 'large-file and media activity',
    predicate: (row) => Number(row?.fileSizeBytes || 0) >= 10 * 1024 * 1024 || ['IMAGE', 'VIDEO'].includes(clean(row?.fileType).toUpperCase()),
    channel: 'Search-intent advertising is a reasonable first hypothesis for backup/recovery products, but campaign outcomes are not present in AirGesture.',
    limitation: 'Transfer size and media activity can justify a backup test, but they do not prove backup need or willingness to pay.'
  },
  {
    id: 'creative',
    keywords: /\b(photo|image editing|creative|design|camera|video editor|media tool)\b/i,
    label: 'photo/creative software',
    proxyLabel: 'image/video and mobile-oriented activity',
    predicate: (row) => {
      const type = clean(row?.fileType).toUpperCase();
      const device = normalizeText(row?.device);
      return ['IMAGE', 'VIDEO'].includes(type) || device.includes('mobile') || device.includes('tablet');
    },
    channel: 'A visual/social campaign is a reasonable hypothesis for creative software, but AirGesture has no campaign-response data.',
    limitation: 'Image/video transfers suggest creative/media relevance, not intent to buy creative software.'
  },
  {
    id: 'productivity',
    keywords: /\b(productivity|office|workflow|collaboration|business software|workspace)\b/i,
    label: 'business productivity software',
    proxyLabel: 'desktop PDF/document activity',
    predicate: (row) => {
      const type = clean(row?.fileType).toUpperCase();
      const device = normalizeText(row?.device);
      return ['PDF', 'DOCUMENT'].includes(type) || device.includes('desktop') || device.includes('laptop');
    },
    channel: 'Search-intent or professional-audience advertising is a reasonable hypothesis, but AirGesture does not contain campaign performance.',
    limitation: 'Desktop/document usage can identify a productivity use case, but it does not establish software demand or budget.'
  }
];

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9\s:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isUnknown(value) {
  const normalized = normalizeText(value);
  return !normalized || ['unknown', 'unspecified', 'n a', 'na', 'nan', 'none', 'null', 'undefined', '-'].includes(normalized);
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

function rowDimensionValue(row, dimension) {
  switch (dimension) {
    case 'location': return clean(row?.location) || 'Unknown';
    case 'segment': return clean(row?.commercialSegment) || 'Unknown';
    case 'file_type': return clean(row?.fileType).toUpperCase() || 'Unknown';
    case 'device': return clean(row?.device) || 'Unknown';
    case 'os': return clean(row?.os) || 'Unknown';
    case 'browser': return clean(row?.browser) || 'Unknown';
    case 'room': return clean(row?.room) || 'Unknown';
    case 'action': return clean(row?.action).toUpperCase() || 'Unknown';
    case 'result': return clean(row?.result).toUpperCase() || 'Unknown';
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
    default: return 'Unknown';
  }
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
      const normalizedHour = /^\d{1,2}$/.test(f.hour)
        ? `${String(Number(f.hour)).padStart(2, '0')}:00 UTC`
        : f.hour;
      if (!fuzzyMatch(rowDimensionValue(row, 'hour'), normalizedHour)) return false;
    }
    return true;
  });
}

function sumBytes(rows) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.fileSizeBytes || 0), 0);
}

function uniqueUsers(rows) {
  const users = new Set();
  for (const row of rows || []) {
    const value = clean(row?.student);
    if (value) users.add(value);
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
  if (metric === 'unique_users') return Number(metrics.uniqueUsers || 0);
  if (metric === 'data_volume_bytes') return Number(metrics.dataVolumeBytes || 0);
  if (metric === 'average_file_size_bytes') return Number(metrics.averageFileSizeBytes || 0);
  return Number(metrics.events || 0);
}

function groupRows(rows, dimension, excludeUnknown = true) {
  const map = new Map();
  for (const row of rows || []) {
    const value = rowDimensionValue(row, dimension);
    const nonSpecificLocation = dimension === 'location' && ['us', 'usa', 'united states', 'united states of america'].includes(normalizeText(value));
    if (excludeUnknown && (isUnknown(value) || nonSpecificLocation)) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function rankDimension(rows, { dimension = 'location', metric = 'events', order = 'desc', limit = 5, excludeUnknown = true } = {}) {
  const groups = groupRows(rows, DIMENSIONS.includes(dimension) ? dimension : 'location', excludeUnknown);
  const safeMetric = METRICS.includes(metric) ? metric : 'events';
  const safeLimit = Math.max(1, Math.min(20, Number(limit || 5)));
  return [...groups.entries()]
    .map(([label, group]) => ({ label, ...aggregateRows(group) }))
    .sort((a, b) => {
      const delta = metricValue(a, safeMetric) - metricValue(b, safeMetric);
      if (delta !== 0) return order === 'asc' ? delta : -delta;
      const eventDelta = a.events - b.events;
      if (eventDelta !== 0) return order === 'asc' ? eventDelta : -eventDelta;
      return a.label.localeCompare(b.label);
    })
    .slice(0, safeLimit);
}

function prettyLocation(value) {
  const text = clean(value);
  if (!text || isUnknown(text)) return 'Unspecified';
  if (/Township of Boone/i.test(text)) return 'Boone Township, MO';
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length >= 2 && STATE_ABBR[parts[1]]) return `${parts[0]}, ${STATE_ABBR[parts[1]]}`;
  return text.replace(/, United States(?: of America \(the\))?$/i, '');
}

function prettySegment(value) {
  return clean(value)
    .toLowerCase()
    .split('_')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ')
    .replace(/Ios/g, 'iOS');
}

function prettyDimensionValue(dimension, value) {
  if (dimension === 'location') return prettyLocation(value);
  if (dimension === 'segment') return prettySegment(value);
  if (dimension === 'file_type' || dimension === 'action' || dimension === 'result') return clean(value).toUpperCase();
  if (dimension === 'hour') {
    const match = clean(value).match(/^(\d{1,2}):00/);
    if (match) {
      const h = Number(match[1]);
      return `${h % 12 || 12}:00 ${h >= 12 ? 'PM' : 'AM'} UTC`;
    }
  }
  return clean(value);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / (1024 ** index);
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function metricLabel(metric) {
  if (metric === 'unique_users') return 'unique users';
  if (metric === 'data_volume_bytes') return 'data volume';
  if (metric === 'average_file_size_bytes') return 'average file size';
  return 'events';
}

function dimensionLabel(dimension) {
  const labels = {
    location: 'markets', segment: 'audiences', file_type: 'file types', device: 'devices',
    os: 'operating systems', browser: 'browsers', room: 'rooms', action: 'actions',
    result: 'results', day: 'days', hour: 'hours'
  };
  return labels[dimension] || dimension.replace(/_/g, ' ');
}

function metricDisplay(item, metric) {
  if (metric === 'unique_users') return `${item.uniqueUsers} unique user${item.uniqueUsers === 1 ? '' : 's'}`;
  if (metric === 'data_volume_bytes') return formatBytes(item.dataVolumeBytes);
  if (metric === 'average_file_size_bytes') return formatBytes(item.averageFileSizeBytes);
  return `${item.events} event${item.events === 1 ? '' : 's'}`;
}

function rankingWord(metric, order) {
  const countMetric = metric === 'unique_users' || metric === 'events';
  if (order === 'asc') return countMetric ? 'fewest' : 'lowest';
  return countMetric ? 'most' : 'highest';
}

function extractLimit(text, fallback = 5) {
  const normalized = normalizeText(text);
  const numeric = normalized.match(/\b(?:top|bottom|first|last)\s+(\d{1,2})\b/);
  if (numeric) return Math.max(1, Math.min(20, Number(numeric[1])));
  for (const [word, value] of NUMBER_WORDS) {
    if (new RegExp(`\\b(?:top|bottom|first|last)\\s+${word}\\b`).test(normalized)) return value;
  }
  return fallback;
}

function detectOrder(text) {
  const q = normalizeText(text);
  if (/\b(least|fewest|lowest|smallest|bottom|min(?:imum)?)\b/.test(q)) return 'asc';
  if (/\b(most|highest|largest|top|busiest|max(?:imum)?)\b/.test(q)) return 'desc';
  return null;
}

function detectMetric(text) {
  const q = normalizeText(text);
  if (/\b(avg|average|mean)\b.*\b(file size|size)\b|\baverage file size\b/.test(q)) return 'average_file_size_bytes';
  if (/\b(volume|bytes|data size|total size|file size)\b/.test(q)) return 'data_volume_bytes';
  if (/\b(user|users|people|participants|students)\b/.test(q)) return 'unique_users';
  if (/\b(event|events|activity|activities|transfer|transfers|records|usage|files)\b/.test(q)) return 'events';
  return null;
}

function detectDimension(text) {
  const q = normalizeText(text);
  if (/\b(area|areas|market|markets|city|cities|location|locations|geograph(?:y|ic))\b/.test(q)) return 'location';
  if (/\b(audience|audiences|segment|segments|commercial segment)\b/.test(q)) return 'segment';
  if (/\b(file type|file types|content type|content types|content category|file category)\b/.test(q)) return 'file_type';
  if (/\b(device|devices)\b/.test(q)) return 'device';
  if (/\b(operating system|operating systems|\bos\b|platform|platforms)\b/.test(q)) return 'os';
  if (/\b(browser|browsers)\b/.test(q)) return 'browser';
  if (/\b(room|rooms)\b/.test(q)) return 'room';
  if (/\b(action|actions|send|receive)\b/.test(q)) return 'action';
  if (/\b(result|results|success|successful|sent)\b/.test(q)) return 'result';
  if (/\b(day|days|weekday|weekdays)\b/.test(q)) return 'day';
  if (/\b(hour|hours|time of day|what time|when)\b/.test(q)) return 'hour';
  return null;
}

function knownValues(rows, dimension) {
  return [...groupRows(rows, dimension, true).keys()];
}

function findMentionedValues(text, rows, dimension, max = 8) {
  const normalized = normalizeText(text);
  const matches = [];
  const phrasePresent = (phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(normalized);
  };

  for (const value of knownValues(rows, dimension)) {
    const v = normalizeText(value);
    const first = v.split(' ')[0];
    if ((v && phrasePresent(v)) || (dimension === 'location' && first.length >= 4 && phrasePresent(first))) {
      matches.push(value);
    }
  }
  return [...new Set(matches)].slice(0, max);
}

function extractFiltersFromQuestion(text, rows, dimensionBeingRanked = null) {
  const q = normalizeText(text);
  const predicates = [];
  const descriptions = [];

  const add = (description, predicate) => {
    descriptions.push(description);
    predicates.push(predicate);
  };

  if (/\bwindows\b/.test(q)) add('Windows', (row) => fuzzyMatch(rowDimensionValue(row, 'os'), 'Windows') || fuzzyMatch(rowDimensionValue(row, 'segment'), 'WINDOWS_DESKTOP'));
  if (/\bandroid\b/.test(q)) add('Android', (row) => fuzzyMatch(rowDimensionValue(row, 'os'), 'Android') || fuzzyMatch(rowDimensionValue(row, 'segment'), 'ANDROID_MOBILE'));
  if (/\b(mac|macos|apple desktop)\b/.test(q)) add('macOS/Apple Desktop', (row) => fuzzyMatch(rowDimensionValue(row, 'os'), 'macOS') || fuzzyMatch(rowDimensionValue(row, 'segment'), 'APPLE_DESKTOP'));
  if (/\b(ios|iphone|ipad|apple mobile)\b/.test(q)) add('iOS/Apple Mobile', (row) => /ios|ipad/i.test(rowDimensionValue(row, 'os')) || fuzzyMatch(rowDimensionValue(row, 'segment'), 'APPLE_MOBILE'));
  if (/\blinux\b/.test(q)) add('Linux', (row) => fuzzyMatch(rowDimensionValue(row, 'os'), 'Linux'));

  if (/\bmobile\b/.test(q) && !/apple mobile|android mobile/.test(q)) add('Mobile', (row) => /mobile/i.test(rowDimensionValue(row, 'device')) || /_MOBILE/i.test(rowDimensionValue(row, 'segment')));
  if (/\btablet\b/.test(q)) add('Tablet', (row) => /tablet/i.test(rowDimensionValue(row, 'device')) || /TABLET/i.test(rowDimensionValue(row, 'segment')));
  if (/\b(desktop|laptop)\b/.test(q) && !/windows desktop|apple desktop|linux desktop/.test(q)) add('Desktop/Laptop', (row) => /desktop|laptop/i.test(rowDimensionValue(row, 'device')));

  if (/\bpdf\b/.test(q)) add('PDF', (row) => rowDimensionValue(row, 'file_type') === 'PDF');
  if (/\b(document|documents|doc files?)\b/.test(q) && !/document management/.test(q)) add('Document', (row) => rowDimensionValue(row, 'file_type') === 'DOCUMENT');
  if (/\b(image|images|photo files?|pictures?)\b/.test(q)) add('Image', (row) => rowDimensionValue(row, 'file_type') === 'IMAGE');
  if (/\b(video|videos)\b/.test(q)) add('Video', (row) => rowDimensionValue(row, 'file_type') === 'VIDEO');

  if (/\bsend(?:ing|s)?\b/.test(q)) add('SEND action', (row) => rowDimensionValue(row, 'action') === 'SEND');
  if (/\breceiv(?:e|ed|ing)\b/.test(q)) add('RECEIVE action', (row) => rowDimensionValue(row, 'action') === 'RECEIVE');

  if (dimensionBeingRanked !== 'location') {
    const locations = findMentionedValues(text, rows, 'location', 3);
    if (locations.length) {
      add(`market ${locations.map(prettyLocation).join(', ')}`, (row) => locations.some((location) => fuzzyMatch(rowDimensionValue(row, 'location'), location)));
    }
  }

  const days = DAY_NAMES.filter((day) => new RegExp(`\\b${day.toLowerCase()}s?\\b`).test(q));
  if (days.length) add(days.join('/'), (row) => days.some((day) => fuzzyMatch(rowDimensionValue(row, 'day'), day)));

  return {
    descriptions,
    apply(sourceRows) {
      return predicates.reduce((current, predicate) => current.filter(predicate), sourceRows);
    }
  };
}

function historyText(history = [], roles = ['user', 'assistant']) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && roles.includes(item.role))
    .slice(-8)
    .map((item) => clean(item.content))
    .join(' \n ');
}

function inferFromHistory(history, detector) {
  const items = (Array.isArray(history) ? history : []).slice(-8).reverse();
  for (const item of items) {
    const value = detector(item?.content || '');
    if (value) return value;
  }
  return null;
}

function detectProduct(text) {
  const source = clean(text);
  for (const profile of PRODUCT_PROFILES) {
    if (profile.keywords.test(source)) return { ...profile, requestedLabel: profile.label };
  }

  const promoteMatch = source.match(/\b(?:promote|advertise|launch|market|sell)\s+(?:a|an|the|my)?\s*([^?.]{2,60}?\b(?:app|software|product|service))\b/i);
  if (promoteMatch) {
    return {
      id: 'generic-product',
      label: clean(promoteMatch[1]),
      requestedLabel: clean(promoteMatch[1]),
      proxyLabel: 'observed market size and activity',
      predicate: () => true,
      channel: 'AirGesture does not contain enough information to choose an advertising channel for this product; treat channel choice as a separate experiment.',
      limitation: `AirGesture does not directly measure demand for ${clean(promoteMatch[1])}. The recommendation can only prioritize a market for testing based on observed usage.`
    };
  }
  return null;
}

function hasProductIntent(text) {
  const q = normalizeText(text);
  return /\b(promote|advertise|launch|market|sell|campaign|target|best area|best market|which area.*best|which market.*best)\b/.test(q);
}

function makeChart(dimension, metric, groups, title = '') {
  return {
    type: 'bar',
    title: title || `${metricLabel(metric)} by ${dimension.replace(/_/g, ' ')}`,
    label: metricLabel(metric),
    dimension,
    metric,
    data: (groups || []).slice(0, 10).map((item) => ({
      label: item.label,
      value: metricValue(item, metric)
    }))
  };
}

function baseAnswer(input = {}) {
  return {
    scenario: input.scenario || 'data-analysis',
    title: input.title || 'AirGesture Data Assistant',
    directAnswer: input.directAnswer || '',
    evidence: input.evidence || [],
    interpretation: input.interpretation || '',
    recommendation: input.recommendation || '',
    experiment: input.experiment || '',
    channel: input.channel || '',
    limitation: input.limitation || 'AirGesture describes observed application usage; it does not measure the full external market.',
    risk: input.limitation || 'AirGesture describes observed application usage; it does not measure the full external market.',
    evidenceStrength: input.evidenceStrength || 'HIGH',
    followUps: input.followUps || [],
    chart: input.chart || null
  };
}

function answerRanking(question, rows, history) {
  let dimension = detectDimension(question) || inferFromHistory(history, detectDimension) || 'location';
  let metric = detectMetric(question) || inferFromHistory(history, detectMetric) || 'events';
  const order = detectOrder(question) || 'desc';
  const limit = extractLimit(question, /\b(which|what)\b/.test(normalizeText(question)) ? 5 : 5);

  const filters = extractFiltersFromQuestion(question, rows, dimension);
  const filtered = filters.apply(rows);
  const groups = rankDimension(filtered, { dimension, metric, order, limit, excludeUnknown: true });

  if (!groups.length) {
    return baseAnswer({
      scenario: 'ranking',
      title: 'No matching data',
      directAnswer: 'No AirGesture records match that question in the current scope.',
      evidence: filters.descriptions.length ? [`Applied filter: ${filters.descriptions.join(', ')}.`] : [],
      limitation: 'The answer is limited to the records currently available in AirGesture.',
      followUps: ['Show the top markets by users.', 'Reset the filters and summarize the data.']
    });
  }

  const first = groups[0];
  const display = prettyDimensionValue(dimension, first.label);
  const orderPhrase = rankingWord(metric, order);
  const filterPhrase = filters.descriptions.length ? ` among ${filters.descriptions.join(', ')} records` : '';
  const wantsList = limit > 1 && /\b(give|show|list|top|bottom|first|last)\b/.test(normalizeText(question));
  const direct = wantsList
    ? `The ${order === 'asc' ? 'bottom' : 'top'} ${groups.length} ${dimensionLabel(dimension)} by ${metricLabel(metric)}${filterPhrase} are: ${groups.map((item, index) => `${index + 1}) ${prettyDimensionValue(dimension, item.label)} — ${metricDisplay(item, metric)}`).join('; ')}.`
    : `${display} has the ${orderPhrase} ${metricLabel(metric)}${filterPhrase} in the current AirGesture scope, with ${metricDisplay(first, metric)}.`;
  const evidence = groups.slice(0, Math.min(limit, 5)).map((item, index) =>
    `${index + 1}. ${prettyDimensionValue(dimension, item.label)} — ${metricDisplay(item, metric)}${metric !== 'events' ? ` across ${item.events} events` : ''}.`
  );

  return baseAnswer({
    scenario: 'ranking',
    title: `${order === 'asc' ? 'Lowest' : 'Highest'} ${metricLabel(metric)} by ${dimensionLabel(dimension)}`,
    directAnswer: direct,
    evidence,
    interpretation: `This is a descriptive ranking of the current AirGesture records${filterPhrase}.`,
    recommendation: 'Use this ranking to choose what to inspect or test next; do not treat it as proof of external market demand.',
    experiment: 'If this ranking will drive a business decision, compare actual response metrics across at least two candidate groups.',
    limitation: 'The ranking reflects observed AirGesture usage only, not population size, total market size or purchase intent.',
    evidenceStrength: filtered.length >= 100 ? 'HIGH' : filtered.length >= 25 ? 'MODERATE' : 'LIMITED',
    followUps: [
      `Show the ${order === 'asc' ? 'highest' : 'lowest'} ${dimensionLabel(dimension)} by ${metricLabel(metric)}.`,
      dimension === 'location' ? `Compare ${prettyLocation(groups[0].label)} with ${prettyLocation(groups[1]?.label || groups[0].label)}.` : 'Show the current market ranking by users.'
    ],
    chart: makeChart(dimension, metric, groups, `${order === 'asc' ? 'Lowest' : 'Highest'} ${metricLabel(metric)}`)
  });
}

function resolveGroup(rows, dimension, requested) {
  const groups = groupRows(rows, dimension, false);
  const exact = [...groups.keys()].find((value) => normalizeText(value) === normalizeText(requested));
  if (exact) return exact;
  const candidates = [...groups.keys()].filter((value) => fuzzyMatch(value, requested));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => (groups.get(b)?.length || 0) - (groups.get(a)?.length || 0))[0];
}

function answerComparison(question, rows, history) {
  let dimension = detectDimension(question) || inferFromHistory(history, detectDimension) || 'location';
  let values = findMentionedValues(question, rows, dimension, 6);

  if (values.length < 2 && dimension === 'location') {
    const historyValues = findMentionedValues(historyText(history), rows, 'location', 8);
    values = [...values, ...historyValues.filter((value) => !values.includes(value))].slice(0, 2);
  }

  if (values.length < 2) return null;
  const metric = detectMetric(question) || inferFromHistory(history, detectMetric) || 'unique_users';
  const groupsMap = groupRows(rows, dimension, false);
  const groups = values
    .map((value) => resolveGroup(rows, dimension, value))
    .filter(Boolean)
    .map((matched) => ({ label: matched, ...aggregateRows(groupsMap.get(matched)) }))
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric));

  if (groups.length < 2) return null;
  const winner = groups[0];
  const other = groups[1];

  return baseAnswer({
    scenario: 'comparison',
    title: `${prettyDimensionValue(dimension, winner.label)} vs ${prettyDimensionValue(dimension, other.label)}`,
    directAnswer: `${prettyDimensionValue(dimension, winner.label)} is higher than ${prettyDimensionValue(dimension, other.label)} on ${metricLabel(metric)} in the current AirGesture scope: ${metricDisplay(winner, metric)} versus ${metricDisplay(other, metric)}.`,
    evidence: groups.map((item) => `${prettyDimensionValue(dimension, item.label)} — ${item.uniqueUsers} unique users, ${item.events} events, ${formatBytes(item.dataVolumeBytes)} recorded volume.`),
    interpretation: 'The comparison describes observed AirGesture usage; the stronger group depends on the metric you selected.',
    recommendation: 'Choose the comparison metric that matches the business objective before selecting a winner.',
    experiment: 'If the comparison drives a campaign or product decision, run the same controlled test in both groups and compare real outcomes.',
    limitation: 'Observed AirGesture usage is not the same as external market demand or conversion performance.',
    evidenceStrength: rows.length >= 100 ? 'HIGH' : 'MODERATE',
    followUps: [
      `Compare these two by events instead of ${metricLabel(metric)}.`,
      dimension === 'location' ? `Which audience is strongest in ${prettyLocation(winner.label)}?` : 'Which market has the most users?'
    ],
    chart: makeChart(dimension, metric, groups, `${prettyDimensionValue(dimension, winner.label)} vs ${prettyDimensionValue(dimension, other.label)}`)
  });
}

function answerCountOrProfile(question, rows, history) {
  const q = normalizeText(question);
  const locationMentions = findMentionedValues(question, rows, 'location', 3);
  const isFollowUp = /\b(what about|how about|tell me about|and|there|that market|that area)\b/.test(q);
  let location = locationMentions[0] || null;

  if (!location && isFollowUp) {
    location = findMentionedValues(historyText(history), rows, 'location', 3)[0] || null;
  }
  if (!location) return null;

  const locationRows = rows.filter((row) => fuzzyMatch(rowDimensionValue(row, 'location'), location));
  if (!locationRows.length) return null;
  const stats = aggregateRows(locationRows);
  const metric = detectMetric(question);

  if (/\bhow many\b/.test(q) && metric) {
    const item = { label: location, ...stats };
    return baseAnswer({
      scenario: 'market-count',
      title: prettyLocation(location),
      directAnswer: `${prettyLocation(location)} has ${metricDisplay(item, metric)} in the current AirGesture scope.`,
      evidence: [`${stats.events} events`, `${stats.uniqueUsers} unique users`, `${formatBytes(stats.dataVolumeBytes)} recorded volume`],
      interpretation: 'This is an exact aggregate from the currently loaded AirGesture records.',
      recommendation: 'Use the count as descriptive evidence and compare it with another market before making a commercial decision.',
      experiment: '',
      limitation: 'AirGesture usage counts do not represent the full population or addressable market.',
      followUps: [`Compare ${prettyLocation(location)} with the leading market.`, `Which audience is strongest in ${prettyLocation(location)}?`]
    });
  }

  const topSegments = rankDimension(locationRows, { dimension: 'segment', metric: 'events', order: 'desc', limit: 3 });
  const topFiles = rankDimension(locationRows, { dimension: 'file_type', metric: 'events', order: 'desc', limit: 3 });
  const topOs = rankDimension(locationRows, { dimension: 'os', metric: 'events', order: 'desc', limit: 3 });
  return baseAnswer({
    scenario: 'market-profile',
    title: `${prettyLocation(location)} profile`,
    directAnswer: `${prettyLocation(location)} currently has ${stats.uniqueUsers} observed users across ${stats.events} events and ${formatBytes(stats.dataVolumeBytes)} of recorded file volume.`,
    evidence: [
      topSegments[0] ? `Leading audience: ${prettySegment(topSegments[0].label)} (${topSegments[0].events} events).` : '',
      topFiles[0] ? `Leading content: ${topFiles[0].label} (${topFiles[0].events} events).` : '',
      topOs[0] ? `Leading OS: ${topOs[0].label} (${topOs[0].events} events).` : ''
    ].filter(Boolean),
    interpretation: 'This profile shows the composition of observed AirGesture activity in the selected market.',
    recommendation: 'Use the profile to choose a specific product or audience hypothesis, then compare it with another market.',
    experiment: 'Run the same small test in this market and a comparison market using one success metric.',
    limitation: 'The profile describes AirGesture users only; it does not represent the entire city market.',
    evidenceStrength: stats.events >= 100 ? 'HIGH' : stats.events >= 25 ? 'MODERATE' : 'LIMITED',
    followUps: [`Which market has the most users?`, `Which product idea fits ${prettyLocation(location)} best?`]
  });
}

function normalizeScore(value, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(1, Number(value || 0) / max));
}

function productMarketCandidates(rows, profile) {
  const groups = groupRows(rows, 'location', true);
  const raw = [...groups.entries()].map(([label, marketRows]) => {
    const all = aggregateRows(marketRows);
    const relevantRows = marketRows.filter(profile.predicate || (() => true));
    const relevant = aggregateRows(relevantRows);
    const relevantEventShare = all.events ? relevant.events / all.events : 0;
    return { label, all, relevant, relevantEventShare };
  });

  const maxRelevantUsers = Math.max(1, ...raw.map((item) => item.relevant.uniqueUsers));
  const maxUsers = Math.max(1, ...raw.map((item) => item.all.uniqueUsers));
  const maxEvents = Math.max(1, ...raw.map((item) => item.all.events));

  return raw.map((item) => {
    const generic = profile.id === 'generic-product';
    const score = generic
      ? (0.62 * normalizeScore(item.all.uniqueUsers, maxUsers)) + (0.38 * normalizeScore(item.all.events, maxEvents))
      : (0.45 * normalizeScore(item.relevant.uniqueUsers, maxRelevantUsers)) +
        (0.25 * item.relevantEventShare) +
        (0.20 * normalizeScore(item.all.uniqueUsers, maxUsers)) +
        (0.10 * normalizeScore(item.all.events, maxEvents));
    return { ...item, score };
  }).sort((a, b) => b.score - a.score || b.all.uniqueUsers - a.all.uniqueUsers || b.all.events - a.all.events);
}

function answerProductStrategy(question, rows, history, profile) {
  const q = normalizeText(question);
  const mentionedLocations = findMentionedValues(question, rows, 'location', 3);
  const candidates = productMarketCandidates(rows, profile);
  if (!candidates.length) return null;

  let target = candidates[0];
  let compare = candidates[1] || candidates[0];
  if (mentionedLocations.length) {
    const matched = candidates.find((item) => fuzzyMatch(item.label, mentionedLocations[0]));
    if (matched) {
      target = matched;
      compare = candidates.find((item) => item.label !== matched.label) || matched;
    }
  } else if (/\bwhat about\b/.test(q)) {
    const historicalLocations = findMentionedValues(historyText(history), rows, 'location', 4);
    const matched = candidates.find((item) => historicalLocations.some((value) => fuzzyMatch(item.label, value)));
    if (matched) target = matched;
  }

  const isRequestedSpecificMarket = mentionedLocations.length > 0;
  const targetName = prettyLocation(target.label);
  const compareName = prettyLocation(compare.label);
  const relevantPct = target.all.events ? Math.round((target.relevant.events / target.all.events) * 1000) / 10 : 0;
  const directAnswer = isRequestedSpecificMarket
    ? `${targetName} is a reasonable market to test ${profile.requestedLabel || profile.label}, but it is ${target.label === candidates[0].label ? 'the strongest' : 'not the strongest'} candidate in the current AirGesture proxy analysis.`
    : `${targetName} is the strongest first test market for ${profile.requestedLabel || profile.label} using the AirGesture signals that are actually available.`;

  const evidence = [
    `${targetName}: ${target.all.uniqueUsers} observed users and ${target.all.events} total events.`,
    profile.id === 'generic-product'
      ? `${targetName} has one of the strongest observed user/activity bases in the current dataset.`
      : `${targetName}: ${target.relevant.uniqueUsers} users and ${target.relevant.events} events match the ${profile.proxyLabel} proxy (${relevantPct}% of that market's events).`,
    compare && compare.label !== target.label
      ? `${compareName} is the next comparison candidate with ${compare.all.uniqueUsers} observed users and ${compare.relevant.uniqueUsers} proxy-relevant users.`
      : ''
  ].filter(Boolean);

  return baseAnswer({
    scenario: 'product-market-test',
    title: `${profile.requestedLabel || profile.label}: market test`,
    directAnswer,
    evidence,
    interpretation: `AirGesture cannot measure demand for ${profile.requestedLabel || profile.label} directly. This recommendation prioritizes where to run a test using ${profile.proxyLabel} plus observed market size/activity.`,
    recommendation: `Start with a small test in ${targetName}${compare && compare.label !== target.label ? ` and use ${compareName} as the comparison market` : ''}. Keep the product message and success metric consistent.`,
    experiment: `Run the same short campaign or landing-page test in ${targetName}${compare && compare.label !== target.label ? ` and ${compareName}` : ''}; compare actual clicks, sign-ups or another real response metric before scaling.`,
    channel: profile.channel,
    limitation: profile.limitation,
    evidenceStrength: target.relevant.uniqueUsers >= 30 ? 'HIGH' : target.relevant.uniqueUsers >= 10 ? 'MODERATE' : 'LIMITED',
    followUps: [
      `Compare ${targetName} with ${compareName}.`,
      `Which audience is strongest in ${targetName}?`,
      `What additional data should we collect before spending money on ${profile.requestedLabel || profile.label}?`
    ],
    chart: {
      type: 'bar',
      title: `${profile.requestedLabel || profile.label}: candidate markets`,
      label: profile.id === 'generic-product' ? 'Observed users' : 'Proxy-relevant users',
      dimension: 'location',
      metric: profile.id === 'generic-product' ? 'unique_users' : 'proxy_users',
      data: candidates.slice(0, 7).map((item) => ({
        label: item.label,
        value: profile.id === 'generic-product' ? item.all.uniqueUsers : item.relevant.uniqueUsers
      }))
    }
  });
}

function answerSummary(rows) {
  const summary = aggregateRows(rows);
  const markets = rankDimension(rows, { dimension: 'location', metric: 'unique_users', order: 'desc', limit: 5 });
  const segments = rankDimension(rows, { dimension: 'segment', metric: 'events', order: 'desc', limit: 3 });
  const files = rankDimension(rows, { dimension: 'file_type', metric: 'events', order: 'desc', limit: 3 });
  const os = rankDimension(rows, { dimension: 'os', metric: 'events', order: 'desc', limit: 3 });
  const hours = rankDimension(rows, { dimension: 'hour', metric: 'events', order: 'desc', limit: 3 });

  return baseAnswer({
    scenario: 'summary',
    title: 'Current AirGesture data summary',
    directAnswer: `The current scope contains ${summary.events} events from ${summary.uniqueUsers} observed users across ${groupRows(rows, 'location', true).size} markets, totaling ${formatBytes(summary.dataVolumeBytes)} of recorded file volume.`,
    evidence: [
      markets[0] ? `Largest observed market by users: ${prettyLocation(markets[0].label)} (${markets[0].uniqueUsers} users).` : '',
      segments[0] ? `Leading audience by events: ${prettySegment(segments[0].label)} (${segments[0].events} events).` : '',
      files[0] ? `Leading content type: ${files[0].label} (${files[0].events} events).` : '',
      os[0] ? `Leading operating system: ${os[0].label} (${os[0].events} events).` : '',
      hours[0] ? `Peak observed hour: ${prettyDimensionValue('hour', hours[0].label)} (${hours[0].events} events).` : ''
    ].filter(Boolean),
    interpretation: 'These are descriptive usage patterns from the current AirGesture records.',
    recommendation: 'Use one pattern at a time to form a testable business question—for example a market, audience or product-use-case experiment.',
    experiment: 'Pick one candidate market and one comparison market, define one measurable outcome, and test before scaling.',
    limitation: 'The dataset describes AirGesture usage and does not contain revenue, ad conversion, demographics or purchase intent.',
    evidenceStrength: summary.events >= 1000 ? 'HIGH' : summary.events >= 250 ? 'MODERATE' : 'LIMITED',
    followUps: ['Which area has the most users?', 'Which area has the least users?', 'Which market has the most Windows users?', 'What product idea is worth testing?'],
    chart: makeChart('location', 'unique_users', markets, 'Observed users by market')
  });
}

function answerManagement(rows) {
  const markets = rankDimension(rows, { dimension: 'location', metric: 'unique_users', order: 'desc', limit: 2 });
  const segments = rankDimension(rows, { dimension: 'segment', metric: 'events', order: 'desc', limit: 2 });
  const files = rankDimension(rows, { dimension: 'file_type', metric: 'events', order: 'desc', limit: 2 });
  const market = markets[0];
  const comparison = markets[1];
  return baseAnswer({
    scenario: 'management-next-step',
    title: 'Recommended next management test',
    directAnswer: market
      ? `Use ${prettyLocation(market.label)} as the first controlled market test and ${prettyLocation(comparison?.label || market.label)} as the comparison market.`
      : 'Collect more market data before choosing a commercial test.',
    evidence: [
      market ? `${prettyLocation(market.label)} has ${market.uniqueUsers} observed users and ${market.events} events.` : '',
      segments[0] ? `${prettySegment(segments[0].label)} is the leading audience by activity.` : '',
      files[0] ? `${files[0].label} is the leading content type.` : ''
    ].filter(Boolean),
    interpretation: 'The safest decision is a small comparison test built on an observed market/audience/content pattern rather than a broad rollout.',
    recommendation: 'Choose one product hypothesis, one audience, two markets and one success metric.',
    experiment: market ? `Run the same offer in ${prettyLocation(market.label)} and ${prettyLocation(comparison?.label || market.label)} for a short period and compare actual response.` : '',
    limitation: 'AirGesture does not contain revenue, campaign conversion or purchase-intent data, so management should validate any commercial hypothesis with real response metrics.',
    evidenceStrength: rows.length >= 1000 ? 'HIGH' : 'MODERATE',
    followUps: ['Which product idea fits the leading audience?', 'Which area has the most users?', 'Which content type is most common?'],
    chart: makeChart('location', 'unique_users', markets, 'First market vs comparison market')
  });
}

function answerHelp() {
  return baseAnswer({
    scenario: 'assistant-help',
    title: 'What you can ask',
    directAnswer: 'I can answer factual and business-test questions from the current AirGesture database without using an external AI API.',
    evidence: [
      'Rankings: most/least users, events or data volume by market, audience, file type, device, OS, browser, room, day or hour.',
      'Filters: Windows, Android, mobile, PDF, image, video, send/receive and named markets.',
      'Comparisons: Dallas vs Chicago, Apple vs Windows, PDF vs image and similar questions.',
      'Business tests: antivirus, music app, storage, backup, PDF/document, creative and productivity hypotheses.'
    ],
    interpretation: 'The assistant calculates answers from current aggregate records and uses transparent rules for product-test recommendations.',
    recommendation: 'Ask one concrete question at a time.',
    experiment: '',
    limitation: 'The assistant cannot infer facts AirGesture does not collect, such as purchase intent, demographics, revenue or ad conversion.',
    evidenceStrength: 'HIGH',
    followUps: ['Which area has the most users?', 'Which area has the least users?', 'I want to promote a music app. Which market should I test first?', 'Compare Dallas and Chicago.']
  });
}

function sanitizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && clean(item.content))
    .map((item) => ({ role: item.role, content: clean(item.content).slice(0, 1200) }))
    .slice(-10);
}

function answerAirGestureQuestion(input = {}) {
  const question = clean(input.question).slice(0, 500);
  if (!question) throw new Error('A question is required.');
  const history = sanitizeHistory(input.history || []);
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const rows = applyDashboardFilters(sourceRows, input.filters || {});
  const q = normalizeText(question);

  if (!rows.length) {
    return {
      strategy: baseAnswer({
        scenario: 'no-data',
        title: 'No records in scope',
        directAnswer: 'There are no AirGesture records in the current filter scope, so I cannot calculate that answer.',
        evidence: [],
        recommendation: 'Reset or broaden the dashboard filters and ask again.',
        limitation: 'No records are available in the current scope.',
        evidenceStrength: 'LIMITED'
      }),
      assistant: { provider: 'AirGesture Data Assistant', source: 'local-deterministic', externalApi: false, costPerQuestion: 0 }
    };
  }

  let product = detectProduct(question);
  if (!product && /\b(what about|how about|there|that market|that area|compare that)\b/.test(q)) {
    product = detectProduct(historyText(history, ['user']));
  }

  let strategy;
  if (product && (hasProductIntent(question) || /\bwhat about\b/.test(q))) {
    strategy = answerProductStrategy(question, rows, history, product);
  }

  if (!strategy && /\b(compare|versus|\bvs\b|difference between)\b/.test(q)) {
    strategy = answerComparison(question, rows, history);
  }

  const hasRankingLanguage = Boolean(detectOrder(question)) || /\b(which|what)\b.*\b(most|least|fewest|highest|lowest|top|bottom|largest|smallest|common)\b/.test(q);
  const hasAnalyticalDimension = Boolean(detectDimension(question)) || Boolean(detectMetric(question));
  const explicitProfileQuestion = /\b(how many|what about|how about|tell me about|profile)\b/.test(q);

  if (!strategy && (hasRankingLanguage || (hasAnalyticalDimension && !explicitProfileQuestion))) {
    strategy = answerRanking(question, rows, history);
  }

  if (!strategy) {
    strategy = answerCountOrProfile(question, rows, history);
  }

  if (!strategy && /\b(summary|summarize|overview|what does the data show|describe the data)\b/.test(q)) {
    strategy = answerSummary(rows);
  }

  if (!strategy && /\b(what should management do|what should we do|next decision|next action|management next)\b/.test(q)) {
    strategy = answerManagement(rows);
  }

  if (!strategy) strategy = answerHelp();

  return {
    strategy,
    assistant: {
      provider: 'AirGesture Data Assistant',
      source: 'local-deterministic',
      externalApi: false,
      costPerQuestion: 0,
      rowsAnalyzed: rows.length
    }
  };
}

module.exports = {
  DAY_NAMES,
  DIMENSIONS,
  METRICS,
  PRODUCT_PROFILES,
  normalizeText,
  fuzzyMatch,
  rowDimensionValue,
  applyDashboardFilters,
  aggregateRows,
  rankDimension,
  detectDimension,
  detectMetric,
  detectOrder,
  detectProduct,
  answerAirGestureQuestion,
  prettyLocation,
  formatBytes
};
