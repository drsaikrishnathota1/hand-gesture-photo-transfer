'use strict';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

const RANGE_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90
};

const PRODUCT_DEFINITIONS = [
  {
    id: 'cloud-storage',
    title: 'Cloud Storage',
    shortTitle: 'Cloud Storage',
    icon: '☁',
    channelHint: 'Google Search + Meta test',
    productExamples: [
      'Cloud storage',
      'Cross-device sync',
      'Large-file transfer',
      'Team file spaces'
    ]
  },
  {
    id: 'pdf-productivity',
    title: 'PDF & Document Productivity',
    shortTitle: 'PDF Software',
    icon: '▤',
    channelHint: 'Google Search first',
    productExamples: [
      'PDF editors',
      'E-signature',
      'Document management',
      'Office productivity'
    ]
  },
  {
    id: 'antivirus-security',
    title: 'Antivirus & Security Software',
    shortTitle: 'Antivirus',
    icon: '🛡',
    channelHint: 'Google Search first',
    productExamples: [
      'Antivirus',
      'Endpoint security',
      'Mobile security',
      'Privacy tools'
    ]
  },
  {
    id: 'backup',
    title: 'Backup & Recovery',
    shortTitle: 'Backup',
    icon: '↻',
    channelHint: 'Google Search + remarketing test',
    productExamples: [
      'Device backup',
      'Cloud backup',
      'Recovery tools',
      'Data protection'
    ]
  },
  {
    id: 'business-productivity',
    title: 'Business Productivity Software',
    shortTitle: 'Productivity',
    icon: '▦',
    channelHint: 'Google Search first',
    productExamples: [
      'Office suites',
      'Collaboration tools',
      'Workflow software',
      'Document automation'
    ]
  },
  {
    id: 'photo-creative',
    title: 'Photo & Creative Software',
    shortTitle: 'Creative Tools',
    icon: '◈',
    channelHint: 'Instagram / Meta first',
    productExamples: [
      'Photo backup',
      'Image editing',
      'Creative apps',
      'Media organization'
    ]
  }
];

function clean(value) {
  return String(value ?? '').trim();
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function round(value, places = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function percent(part, whole, places = 1) {
  const denominator = Number(whole) || 0;
  if (!denominator) return 0;
  return round((Number(part || 0) / denominator) * 100, places);
}

function safeTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeFilters(input = {}) {
  const rangeRaw = clean(input.range).toLowerCase();
  const range = rangeRaw === 'all' || RANGE_DAYS[rangeRaw]
    ? rangeRaw
    : 'all';

  const hourRaw = clean(input.hour);
  const hourNumber = hourRaw === '' ? null : Number(hourRaw);
  const hour = Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23
    ? hourNumber
    : null;

  return {
    range,
    segment: clean(input.segment),
    location: clean(input.location),
    fileType: clean(input.fileType).toUpperCase(),
    device: clean(input.device),
    os: clean(input.os),
    browser: clean(input.browser),
    day: clean(input.day),
    hour
  };
}

function latestTime(rows = []) {
  let latest = null;

  for (const row of rows) {
    const ms = safeTime(row?.time);
    if (ms === null) continue;
    if (latest === null || ms > latest) latest = ms;
  }

  return latest;
}

function applyFilters(rows = [], rawFilters = {}) {
  const filters = normalizeFilters(rawFilters);
  const anchor = latestTime(rows);
  const rangeDays = RANGE_DAYS[filters.range] || null;
  const minTime = anchor !== null && rangeDays
    ? anchor - (rangeDays * 24 * 60 * 60 * 1000)
    : null;

  return rows.filter((row) => {
    if (minTime !== null) {
      const ms = safeTime(row?.time);
      if (ms === null || ms < minTime) return false;
    }

    if (filters.segment && clean(row?.commercialSegment) !== filters.segment) {
      return false;
    }

    if (filters.location && clean(row?.location) !== filters.location) {
      return false;
    }

    if (filters.fileType && clean(row?.fileType).toUpperCase() !== filters.fileType) {
      return false;
    }

    if (filters.device && clean(row?.device) !== filters.device) {
      return false;
    }

    if (filters.os && clean(row?.os) !== filters.os) {
      return false;
    }

    if (filters.browser && clean(row?.browser) !== filters.browser) {
      return false;
    }

    const ms = safeTime(row?.time);

    if (filters.day) {
      if (ms === null || DAY_NAMES[new Date(ms).getUTCDay()] !== filters.day) {
        return false;
      }
    }

    if (filters.hour !== null) {
      if (ms === null || new Date(ms).getUTCHours() !== filters.hour) {
        return false;
      }
    }

    return true;
  });
}

function dimension(rows = [], getter, options = {}) {
  const map = new Map();
  const fallback = clean(options.fallback || 'Unknown');

  for (const row of rows) {
    const raw = typeof getter === 'function' ? getter(row) : '';
    const name = clean(raw) || fallback;

    if (!map.has(name)) {
      map.set(name, {
        name,
        count: 0,
        bytes: 0,
        users: new Set()
      });
    }

    const bucket = map.get(name);
    bucket.count += 1;
    bucket.bytes += Number(row?.fileSizeBytes || 0);

    const student = clean(row?.student);
    if (student) bucket.users.add(student);
  }

  const total = rows.length;

  let values = [...map.values()].map((item) => ({
    name: item.name,
    count: item.count,
    users: item.users.size,
    bytes: item.bytes,
    share: percent(item.count, total)
  }));

  const sortBy = clean(options.sortBy || 'count');

  values.sort((a, b) => {
    const field = ['bytes', 'users'].includes(sortBy) ? sortBy : 'count';
    return Number(b[field] || 0) - Number(a[field] || 0) || a.name.localeCompare(b.name);
  });

  const limit = Number(options.limit || 0);
  if (limit > 0) values = values.slice(0, limit);

  return values;
}

function dimensionMap(list = []) {
  const map = new Map();
  for (const item of list) map.set(item.name, item);
  return map;
}

function countWhere(rows, predicate) {
  let count = 0;
  for (const row of rows) {
    if (predicate(row)) count += 1;
  }
  return count;
}

function sumBytes(rows) {
  return rows.reduce((sum, row) => sum + Number(row?.fileSizeBytes || 0), 0);
}

function uniqueCount(rows, getter) {
  const set = new Set();
  for (const row of rows) {
    const value = clean(getter(row));
    if (value) set.add(value);
  }
  return set.size;
}

function audienceUsage(rows = []) {
  const users = new Map();

  for (const row of rows) {
    const name = clean(row?.student) || 'Unknown user';

    if (!users.has(name)) {
      users.set(name, {
        transfers: 0,
        bytes: 0,
        activeDays: new Set(),
        segment: clean(row?.commercialSegment),
        device: clean(row?.device),
        os: clean(row?.os)
      });
    }

    const user = users.get(name);
    user.transfers += 1;
    user.bytes += Number(row?.fileSizeBytes || 0);

    const ms = safeTime(row?.time);
    if (ms !== null) {
      user.activeDays.add(new Date(ms).toISOString().slice(0, 10));
    }

    if (!user.segment) user.segment = clean(row?.commercialSegment);
    if (!user.device) user.device = clean(row?.device);
    if (!user.os) user.os = clean(row?.os);
  }

  const bands = {
    LIGHT_USAGE: 0,
    ACTIVE_USAGE: 0,
    HEAVY_USAGE: 0
  };

  const detailed = [];

  for (const [name, user] of users.entries()) {
    let band = 'LIGHT_USAGE';

    if (user.transfers >= 25 || user.bytes >= 1024 ** 3) {
      band = 'HEAVY_USAGE';
    } else if (user.transfers >= 8) {
      band = 'ACTIVE_USAGE';
    }

    bands[band] += 1;

    detailed.push({
      name,
      transfers: user.transfers,
      bytes: user.bytes,
      activeDays: user.activeDays.size,
      segment: user.segment,
      device: user.device,
      os: user.os,
      band
    });
  }

  detailed.sort((a, b) =>
    b.transfers - a.transfers || b.bytes - a.bytes
  );

  const totalUsers = detailed.length;

  return {
    totalUsers,
    bands: [
      {
        name: 'Light Usage',
        key: 'LIGHT_USAGE',
        users: bands.LIGHT_USAGE,
        share: percent(bands.LIGHT_USAGE, totalUsers)
      },
      {
        name: 'Active Usage',
        key: 'ACTIVE_USAGE',
        users: bands.ACTIVE_USAGE,
        share: percent(bands.ACTIVE_USAGE, totalUsers)
      },
      {
        name: 'Heavy Usage',
        key: 'HEAVY_USAGE',
        users: bands.HEAVY_USAGE,
        share: percent(bands.HEAVY_USAGE, totalUsers)
      }
    ],
    activeOrHeavyPct: percent(
      bands.ACTIVE_USAGE + bands.HEAVY_USAGE,
      totalUsers
    ),
    heavyPct: percent(bands.HEAVY_USAGE, totalUsers),
    detailed
  };
}

function engagement(rows = []) {
  const dayBuckets = DAY_NAMES.map((name, index) => ({
    name,
    index,
    count: 0,
    bytes: 0,
    users: new Set()
  }));

  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    count: 0,
    bytes: 0,
    users: new Set()
  }));

  for (const row of rows) {
    const ms = safeTime(row?.time);
    if (ms === null) continue;

    const date = new Date(ms);
    const day = dayBuckets[date.getUTCDay()];
    const hour = hourBuckets[date.getUTCHours()];
    const bytes = Number(row?.fileSizeBytes || 0);
    const user = clean(row?.student);

    day.count += 1;
    day.bytes += bytes;
    if (user) day.users.add(user);

    hour.count += 1;
    hour.bytes += bytes;
    if (user) hour.users.add(user);
  }

  const days = dayBuckets.map((item) => ({
    name: item.name,
    index: item.index,
    count: item.count,
    users: item.users.size,
    bytes: item.bytes
  }));

  const hours = hourBuckets.map((item) => ({
    hour: item.hour,
    label: item.label,
    count: item.count,
    users: item.users.size,
    bytes: item.bytes
  }));

  const peakDay = [...days].sort((a, b) => b.count - a.count)[0] || null;
  const peakHour = [...hours].sort((a, b) => b.count - a.count)[0] || null;

  return {
    days,
    hours,
    peakDay,
    peakHour
  };
}

function metricSignals(rows, dimensions, usage) {
  const total = rows.length || 1;
  const segmentMap = dimensionMap(dimensions.segments);
  const fileMap = dimensionMap(dimensions.fileTypes);
  const deviceMap = dimensionMap(dimensions.devices);
  const osMap = dimensionMap(dimensions.os);

  const segmentCount = (name) => Number(segmentMap.get(name)?.count || 0);
  const fileCount = (name) => Number(fileMap.get(name)?.count || 0);
  const deviceCount = (name) => Number(deviceMap.get(name)?.count || 0);
  const osCount = (name) => Number(osMap.get(name)?.count || 0);

  const appleCount =
    segmentCount('APPLE_DESKTOP') +
    segmentCount('APPLE_MOBILE');

  const windowsCount =
    segmentCount('WINDOWS_DESKTOP') ||
    osCount('Windows');

  const androidCount =
    segmentCount('ANDROID_MOBILE') ||
    osCount('Android');

  const mobileCount =
    segmentCount('APPLE_MOBILE') +
    segmentCount('ANDROID_MOBILE') +
    segmentCount('MOBILE_USER') +
    segmentCount('TABLET_USER') +
    deviceCount('Mobile') +
    deviceCount('Tablet');

  const desktopCount =
    deviceCount('Laptop/Desktop') ||
    Math.max(0, total - mobileCount);

  const imageVideoCount =
    fileCount('IMAGE') +
    fileCount('VIDEO');

  const pdfDocCount =
    fileCount('PDF') +
    fileCount('DOCUMENT');

  const largeFileCount = countWhere(
    rows,
    (row) => Number(row?.fileSizeBytes || 0) >= 10 * 1024 * 1024
  );

  const locations = dimensions.locations.length;
  const topLocation = dimensions.locations[0];
  const topMarketShare = percent(topLocation?.count || 0, rows.length);

  const deviceDiversity = clamp(
    ((dimensions.devices.length / 3) * 50) +
    ((dimensions.os.length / 5) * 50)
  );

  return {
    applePct: percent(appleCount, total),
    windowsPct: percent(windowsCount, total),
    androidPct: percent(androidCount, total),
    mobilePct: clamp(percent(mobileCount, total)),
    desktopPct: clamp(percent(desktopCount, total)),
    imageVideoPct: percent(imageVideoCount, total),
    pdfDocPct: percent(pdfDocCount, total),
    largeFilePct: percent(largeFileCount, total),
    activeUsagePct: usage.activeOrHeavyPct,
    heavyUsagePct: usage.heavyPct,
    marketReach: clamp((locations / 10) * 100),
    topMarketSignal: clamp(topMarketShare * 4),
    deviceDiversity
  };
}

function weightedScore(parts = []) {
  const totalWeight = parts.reduce((sum, item) => sum + Number(item.weight || 0), 0) || 1;
  let score = 0;

  const breakdown = parts.map((item) => {
    const value = clamp(item.value);
    const weight = Number(item.weight || 0);
    const points = (value * weight) / totalWeight;
    score += points;

    return {
      label: item.label,
      signal: round(value),
      weight: round((weight / totalWeight) * 100),
      points: round(points)
    };
  });

  return {
    score: Math.round(clamp(score)),
    breakdown
  };
}

function relevantRowsForProduct(id, rows = []) {
  if (id === 'antivirus-security') {
    return rows.filter((row) => {
      const segment = clean(row?.commercialSegment);
      const os = clean(row?.os);
      return (
        segment === 'WINDOWS_DESKTOP' ||
        segment === 'ANDROID_MOBILE' ||
        os === 'Windows' ||
        os === 'Android' ||
        os === 'Linux'
      );
    });
  }

  if (id === 'pdf-productivity' || id === 'business-productivity') {
    return rows.filter((row) =>
      ['PDF', 'DOCUMENT'].includes(clean(row?.fileType).toUpperCase())
    );
  }

  if (id === 'photo-creative') {
    return rows.filter((row) =>
      ['IMAGE', 'VIDEO'].includes(clean(row?.fileType).toUpperCase())
    );
  }

  if (id === 'backup') {
    return rows.filter((row) =>
      ['IMAGE', 'VIDEO'].includes(clean(row?.fileType).toUpperCase()) ||
      Number(row?.fileSizeBytes || 0) >= 10 * 1024 * 1024
    );
  }

  return rows;
}

function productOpportunity(definition, rows, signals) {
  let components;

  switch (definition.id) {
    case 'cloud-storage':
      components = [
        { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 25 },
        { label: 'Large-file activity', value: signals.largeFilePct, weight: 25 },
        { label: 'Image & video activity', value: signals.imageVideoPct, weight: 20 },
        { label: 'Cross-device diversity', value: signals.deviceDiversity, weight: 15 },
        { label: 'Market reach', value: signals.marketReach, weight: 15 }
      ];
      break;

    case 'pdf-productivity':
      components = [
        { label: 'PDF / document activity', value: signals.pdfDocPct, weight: 40 },
        { label: 'Desktop audience', value: signals.desktopPct, weight: 25 },
        { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 20 },
        { label: 'Market reach', value: signals.marketReach, weight: 15 }
      ];
      break;

    case 'antivirus-security':
      components = [
        {
          label: 'Windows / Android audience',
          value: clamp(signals.windowsPct + signals.androidPct),
          weight: 40
        },
        { label: 'Desktop audience', value: signals.desktopPct, weight: 20 },
        { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 20 },
        { label: 'Market reach', value: signals.marketReach, weight: 20 }
      ];
      break;

    case 'backup':
      components = [
        { label: 'Large-file activity', value: signals.largeFilePct, weight: 30 },
        { label: 'Image & video activity', value: signals.imageVideoPct, weight: 25 },
        { label: 'Heavy-user signal', value: signals.heavyUsagePct, weight: 25 },
        { label: 'Cross-device diversity', value: signals.deviceDiversity, weight: 20 }
      ];
      break;

    case 'business-productivity':
      components = [
        { label: 'PDF / document activity', value: signals.pdfDocPct, weight: 35 },
        { label: 'Desktop audience', value: signals.desktopPct, weight: 30 },
        { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 20 },
        { label: 'Market reach', value: signals.marketReach, weight: 15 }
      ];
      break;

    case 'photo-creative':
    default:
      components = [
        { label: 'Image & video activity', value: signals.imageVideoPct, weight: 40 },
        {
          label: 'Mobile / Apple audience',
          value: clamp((signals.mobilePct + signals.applePct) / 2),
          weight: 30
        },
        { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 15 },
        { label: 'Market reach', value: signals.marketReach, weight: 15 }
      ];
      break;
  }

  const scored = weightedScore(components);
  const relevantRows = relevantRowsForProduct(definition.id, rows);
  const markets = dimension(
    relevantRows.length ? relevantRows : rows,
    (row) => row?.location,
    { limit: 5 }
  );

  const audienceSegments = dimension(
    relevantRows.length ? relevantRows : rows,
    (row) => row?.commercialSegment,
    { limit: 4 }
  );

  let reason = 'Observed usage provides a measurable audience for a controlled commercial experiment.';

  if (definition.id === 'antivirus-security') {
    reason = 'Windows, Android and desktop activity provide an aggregate audience for testing security-software messaging.';
  } else if (definition.id === 'pdf-productivity') {
    reason = 'PDF and document transfer activity creates a clear productivity-software hypothesis.';
  } else if (definition.id === 'cloud-storage') {
    reason = 'File volume, repeat usage and cross-device activity support a cloud-storage test hypothesis.';
  } else if (definition.id === 'backup') {
    reason = 'Large files and media activity support testing backup and recovery products.';
  } else if (definition.id === 'business-productivity') {
    reason = 'Document-heavy desktop usage supports a business-productivity test hypothesis.';
  } else if (definition.id === 'photo-creative') {
    reason = 'Image/video and mobile-oriented activity supports a creative-software campaign test.';
  }

  return {
    ...definition,
    score: scored.score,
    scoreLabel: scored.score >= 75
      ? 'Strong test candidate'
      : scored.score >= 55
        ? 'Promising test candidate'
        : 'Exploratory candidate',
    breakdown: scored.breakdown,
    reason,
    markets,
    audienceSegments,
    bestMarket: markets[0]?.name || '',
    relevantEvents: relevantRows.length
  };
}

function advertisingChannels(signals, opportunities) {
  const google = weightedScore([
    { label: 'Desktop audience', value: signals.desktopPct, weight: 30 },
    { label: 'PDF / document activity', value: signals.pdfDocPct, weight: 25 },
    {
      label: 'Security audience',
      value: clamp(signals.windowsPct + signals.androidPct),
      weight: 20
    },
    { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 15 },
    { label: 'Market reach', value: signals.marketReach, weight: 10 }
  ]);

  const meta = weightedScore([
    { label: 'Mobile audience', value: signals.mobilePct, weight: 30 },
    { label: 'Image / video activity', value: signals.imageVideoPct, weight: 30 },
    {
      label: 'Apple / Android audience',
      value: clamp((signals.applePct + signals.androidPct) / 1.5),
      weight: 20
    },
    { label: 'Active / heavy usage', value: signals.activeUsagePct, weight: 10 },
    { label: 'Market reach', value: signals.marketReach, weight: 10 }
  ]);

  const productById = new Map(opportunities.map((item) => [item.id, item]));

  return {
    google: {
      name: 'Google Search Ads',
      score: google.score,
      scoreLabel: google.score >= meta.score ? 'Primary test channel' : 'Secondary test channel',
      breakdown: google.breakdown,
      productCategories: [
        'Antivirus / security',
        'PDF software',
        'Cloud storage',
        'Backup',
        'Business productivity'
      ],
      bestProduct:
        [
          productById.get('antivirus-security'),
          productById.get('pdf-productivity'),
          productById.get('cloud-storage'),
          productById.get('business-productivity')
        ]
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)[0]?.title || ''
    },
    meta: {
      name: 'Instagram / Meta Ads',
      score: meta.score,
      scoreLabel: meta.score > google.score ? 'Primary test channel' : 'Secondary test channel',
      breakdown: meta.breakdown,
      productCategories: [
        'Photo / creative tools',
        'Mobile cloud storage',
        'Photo backup',
        'Mobile security',
        'Cross-device apps'
      ],
      bestProduct:
        [
          productById.get('photo-creative'),
          productById.get('cloud-storage'),
          productById.get('backup')
        ]
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)[0]?.title || ''
    },
    note: 'Channel scores are classroom prioritization hypotheses derived from aggregate AirGesture behavior. They do not measure actual ad conversion or purchase intent.'
  };
}

function productAudienceMatrix(rows, opportunities) {
  const segmentList = dimension(
    rows,
    (row) => row?.commercialSegment,
    { limit: 5 }
  );

  const productMap = new Map(opportunities.map((item) => [item.id, item]));

  const affinity = {
    'cloud-storage': {
      APPLE_DESKTOP: 92,
      APPLE_MOBILE: 94,
      WINDOWS_DESKTOP: 90,
      ANDROID_MOBILE: 92,
      LINUX_DESKTOP: 80,
      GENERAL_DESKTOP: 82,
      MOBILE_USER: 90,
      TABLET_USER: 88
    },
    'pdf-productivity': {
      APPLE_DESKTOP: 86,
      APPLE_MOBILE: 55,
      WINDOWS_DESKTOP: 95,
      ANDROID_MOBILE: 52,
      LINUX_DESKTOP: 72,
      GENERAL_DESKTOP: 80,
      MOBILE_USER: 50,
      TABLET_USER: 58
    },
    'antivirus-security': {
      APPLE_DESKTOP: 60,
      APPLE_MOBILE: 60,
      WINDOWS_DESKTOP: 96,
      ANDROID_MOBILE: 88,
      LINUX_DESKTOP: 65,
      GENERAL_DESKTOP: 75,
      MOBILE_USER: 72,
      TABLET_USER: 68
    },
    backup: {
      APPLE_DESKTOP: 90,
      APPLE_MOBILE: 92,
      WINDOWS_DESKTOP: 92,
      ANDROID_MOBILE: 88,
      LINUX_DESKTOP: 78,
      GENERAL_DESKTOP: 84,
      MOBILE_USER: 88,
      TABLET_USER: 86
    },
    'business-productivity': {
      APPLE_DESKTOP: 84,
      APPLE_MOBILE: 52,
      WINDOWS_DESKTOP: 96,
      ANDROID_MOBILE: 58,
      LINUX_DESKTOP: 74,
      GENERAL_DESKTOP: 86,
      MOBILE_USER: 50,
      TABLET_USER: 60
    },
    'photo-creative': {
      APPLE_DESKTOP: 88,
      APPLE_MOBILE: 96,
      WINDOWS_DESKTOP: 72,
      ANDROID_MOBILE: 90,
      LINUX_DESKTOP: 58,
      GENERAL_DESKTOP: 70,
      MOBILE_USER: 92,
      TABLET_USER: 90
    }
  };

  const segments = segmentList.map((item) => ({
    name: item.name,
    share: item.share,
    events: item.count
  }));

  const products = PRODUCT_DEFINITIONS.map((definition) => {
    const opportunity = productMap.get(definition.id);

    return {
      id: definition.id,
      title: definition.shortTitle,
      overallScore: opportunity?.score || 0,
      cells: segments.map((segment) => {
        const baseAffinity = affinity[definition.id]?.[segment.name] || 68;
        const audienceSignal = clamp(segment.share * 4);
        const score = Math.round(
          clamp((baseAffinity * 0.65) + (audienceSignal * 0.35))
        );

        return {
          segment: segment.name,
          score,
          label: score >= 80 ? 'Strong' : score >= 65 ? 'Moderate' : 'Explore'
        };
      })
    };
  });

  return {
    segments,
    products,
    note: 'Matrix scores combine observed audience share with transparent classroom product-fit assumptions. They are prioritization aids, not predicted revenue.'
  };
}

function periodMetrics(rows = []) {
  const total = rows.length;
  const mobile = countWhere(rows, (row) => {
    const segment = clean(row?.commercialSegment);
    const device = clean(row?.device);
    return (
      ['APPLE_MOBILE', 'ANDROID_MOBILE', 'MOBILE_USER', 'TABLET_USER'].includes(segment) ||
      ['Mobile', 'Tablet'].includes(device)
    );
  });
  const pdfDoc = countWhere(rows, (row) =>
    ['PDF', 'DOCUMENT'].includes(clean(row?.fileType).toUpperCase())
  );

  return {
    events: total,
    mobilePct: percent(mobile, total),
    pdfDocPct: percent(pdfDoc, total),
    bytes: sumBytes(rows),
    locations: uniqueCount(rows, (row) => row?.location)
  };
}

function changePct(current, previous) {
  const p = Number(previous || 0);
  const c = Number(current || 0);
  if (!p) return c ? 100 : 0;
  return round(((c - p) / p) * 100);
}

function trends(rows = []) {
  const anchor = latestTime(rows);
  if (anchor === null) {
    return {
      available: false,
      currentWindow: null,
      previousWindow: null,
      cards: []
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = anchor - (30 * dayMs);
  const previousStart = anchor - (60 * dayMs);

  const currentRows = rows.filter((row) => {
    const ms = safeTime(row?.time);
    return ms !== null && ms >= currentStart && ms <= anchor;
  });

  const previousRows = rows.filter((row) => {
    const ms = safeTime(row?.time);
    return ms !== null && ms >= previousStart && ms < currentStart;
  });

  const current = periodMetrics(currentRows);
  const previous = periodMetrics(previousRows);

  return {
    available: Boolean(currentRows.length && previousRows.length),
    currentWindow: {
      start: new Date(currentStart).toISOString(),
      end: new Date(anchor).toISOString()
    },
    previousWindow: {
      start: new Date(previousStart).toISOString(),
      end: new Date(currentStart).toISOString()
    },
    cards: [
      {
        id: 'activity',
        label: 'Transfer activity',
        value: current.events,
        change: changePct(current.events, previous.events),
        unit: 'events'
      },
      {
        id: 'mobile',
        label: 'Mobile share',
        value: current.mobilePct,
        change: round(current.mobilePct - previous.mobilePct),
        unit: '%',
        changeUnit: 'pp'
      },
      {
        id: 'documents',
        label: 'PDF / document share',
        value: current.pdfDocPct,
        change: round(current.pdfDocPct - previous.pdfDocPct),
        unit: '%',
        changeUnit: 'pp'
      },
      {
        id: 'data-volume',
        label: 'Data volume',
        value: current.bytes,
        change: changePct(current.bytes, previous.bytes),
        unit: 'bytes'
      }
    ]
  };
}

function strategicActions(snapshot) {
  const topProduct = snapshot.opportunities[0];
  const topMarket = snapshot.dimensions.locations[0];
  const topSegment = snapshot.dimensions.segments[0];
  const channel = snapshot.adChannels.google.score >= snapshot.adChannels.meta.score
    ? snapshot.adChannels.google
    : snapshot.adChannels.meta;
  const peak = snapshot.engagement.peakHour;

  const actions = [];

  if (topProduct) {
    actions.push({
      id: 'product',
      priority: 1,
      icon: topProduct.icon,
      title: `${topProduct.shortTitle} opportunity`,
      evidence: `${topProduct.score}/100 classroom opportunity score based on current aggregate behavior.`,
      decision: `Run a small ${topProduct.shortTitle.toLowerCase()} product-message experiment before making a larger investment.`,
      actionLabel: 'Explore product fit',
      ask: `Why is ${topProduct.title} the leading commercial opportunity right now?`
    });
  }

  if (topMarket) {
    actions.push({
      id: 'market',
      priority: 2,
      icon: '⌖',
      title: `${topMarket.name} market signal`,
      evidence: `${topMarket.count} observed events and ${topMarket.users} users in the current scope.`,
      decision: `Use ${topMarket.name} as a controlled geographic test market and compare it with the next-ranked location.`,
      actionLabel: 'Analyze market',
      ask: `Should we target ${topMarket.name} first, and what product should we test there?`
    });
  }

  if (topSegment) {
    actions.push({
      id: 'audience',
      priority: 3,
      icon: '◎',
      title: `${topSegment.name} audience`,
      evidence: `${topSegment.share}% of observed transfer activity in the current scope.`,
      decision: `Design one product or advertising experiment specifically around the ${topSegment.name} audience and compare results with the next segment.`,
      actionLabel: 'Explore audience',
      ask: `What commercial products fit the ${topSegment.name} audience and which market should we test?`
    });
  }

  if (channel) {
    actions.push({
      id: 'advertising',
      priority: 4,
      icon: '↗',
      title: `${channel.name} test`,
      evidence: `${channel.score}/100 channel-fit score from current aggregate device/content behavior.`,
      decision: `Use ${channel.name} as the first classroom advertising hypothesis, then compare with the alternative channel using the same market and product.`,
      actionLabel: 'Compare channels',
      ask: 'Should we use Google Ads or Instagram / Meta based on the current AirGesture data?'
    });
  }

  if (peak?.count) {
    actions.push({
      id: 'timing',
      priority: 5,
      icon: '◷',
      title: `${peak.label} engagement window`,
      evidence: `${peak.count} events occur in the strongest hourly bucket.`,
      decision: 'Test product messages or support coverage near the strongest usage window and compare response with an off-peak period.',
      actionLabel: 'Analyze timing',
      ask: 'When should we schedule promotions or support based on current usage timing?'
    });
  }

  return actions;
}

function buildIntelligenceSnapshot(allRows = [], rawFilters = {}) {
  const sourceRows = Array.isArray(allRows) ? allRows : [];
  const filters = normalizeFilters(rawFilters);
  const rows = applyFilters(sourceRows, filters);

  const dimensions = {
    segments: dimension(rows, (row) => row?.commercialSegment),
    locations: dimension(rows, (row) => row?.location),
    fileTypes: dimension(rows, (row) => clean(row?.fileType).toUpperCase()),
    devices: dimension(rows, (row) => row?.device),
    os: dimension(rows, (row) => row?.os),
    browsers: dimension(rows, (row) => row?.browser)
  };

  const usage = audienceUsage(rows);
  const engagementData = engagement(rows);
  const signals = metricSignals(rows, dimensions, usage);

  const opportunities = PRODUCT_DEFINITIONS
    .map((definition) => productOpportunity(definition, rows, signals))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const adChannels = advertisingChannels(signals, opportunities);
  const matrix = productAudienceMatrix(rows, opportunities);

  const topSegment = dimensions.segments[0] || null;
  const topFileType = dimensions.fileTypes[0] || null;
  const topLocation = dimensions.locations[0] || null;
  const topDevice = dimensions.devices[0] || null;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceAnchorTime: latestTime(sourceRows) !== null
      ? new Date(latestTime(sourceRows)).toISOString()
      : null,
    filters,
    scope: {
      sourceRecords: sourceRows.length,
      matchingRecords: rows.length,
      filtered: Object.entries(filters).some(([key, value]) =>
        key === 'range' ? value !== 'all' : value !== '' && value !== null
      )
    },
    kpis: {
      events: rows.length,
      users: uniqueCount(rows, (row) => row?.student),
      locations: uniqueCount(rows, (row) => row?.location),
      totalBytes: sumBytes(rows),
      avgFileBytes: rows.length ? Math.round(sumBytes(rows) / rows.length) : 0,
      sendEvents: countWhere(rows, (row) => clean(row?.action) === 'SEND'),
      receiveEvents: countWhere(rows, (row) => clean(row?.action) === 'RECEIVE'),
      topSegment: topSegment?.name || '',
      topSegmentShare: topSegment?.share || 0,
      topFileType: topFileType?.name || '',
      topFileTypeShare: topFileType?.share || 0,
      topLocation: topLocation?.name || '',
      topLocationEvents: topLocation?.count || 0,
      topDevice: topDevice?.name || ''
    },
    dimensions,
    usage: {
      totalUsers: usage.totalUsers,
      bands: usage.bands,
      activeOrHeavyPct: usage.activeOrHeavyPct,
      heavyPct: usage.heavyPct
    },
    engagement: engagementData,
    signals,
    opportunities,
    adChannels,
    matrix,
    trends: trends(rows),
    strategicActions: []
  };

  snapshot.strategicActions = strategicActions(snapshot);

  return snapshot;
}

function findOpportunity(snapshot, id) {
  return snapshot?.opportunities?.find((item) => item.id === id) || null;
}

function compactEvidence(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return clean(item.text || item.evidence || item.label || '');
}

function baseConfidence(snapshot, relevantEvents = null) {
  const evidenceCount = relevantEvents === null
    ? Number(snapshot?.scope?.matchingRecords || 0)
    : Number(relevantEvents || 0);

  return {
    evidenceStrength: evidenceCount >= 1000
      ? 'HIGH'
      : evidenceCount >= 250
        ? 'MODERATE'
        : 'LIMITED',
    commercialInference: 'MODERATE',
    recommendation: 'TEST FIRST'
  };
}

function answerForProduct(question, snapshot, productId) {
  const opportunity = findOpportunity(snapshot, productId) || snapshot.opportunities?.[0];
  const bestMarket = opportunity?.markets?.[0] || snapshot.dimensions?.locations?.[0] || null;
  const nextMarkets = (opportunity?.markets || []).slice(1, 3);
  const audience = opportunity?.audienceSegments?.[0] || snapshot.dimensions?.segments?.[0] || null;

  const productLabel = opportunity?.title || 'selected product';
  const marketLabel = bestMarket?.name || 'the strongest observed market';

  return {
    scenario: productId,
    title: `${productLabel} Strategy`,
    directAnswer: bestMarket
      ? `${marketLabel} is the strongest first market to test for ${productLabel.toLowerCase()} in the current AirGesture scope.`
      : `The current scope does not contain enough market activity to rank a first test market for ${productLabel.toLowerCase()}.`,
    evidence: [
      `${opportunity?.score || 0}/100 classroom opportunity score for ${productLabel}.`,
      bestMarket
        ? `${marketLabel}: ${bestMarket.count} relevant events across ${bestMarket.users} observed users.`
        : 'No location currently has enough relevant activity to rank.',
      audience
        ? `${audience.name} is the strongest relevant audience segment in this product view.`
        : 'No dominant relevant audience segment was found.',
      `${opportunity?.relevantEvents || 0} events contribute to this product-fit analysis.`
    ],
    interpretation: opportunity?.reason || 'The observed behavior supports a controlled commercial test rather than a broad rollout.',
    recommendation: bestMarket
      ? `Start with a small ${productLabel.toLowerCase()} campaign in ${marketLabel}. Keep the audience aggregate, measure response, and compare with ${nextMarkets[0]?.name || 'the second-ranked market'} before scaling.`
      : 'Collect additional market activity before choosing a geographic campaign.',
    experiment: bestMarket
      ? `Test one message, one product category and one primary channel in ${marketLabel}; use ${nextMarkets[0]?.name || 'another market'} as a comparison market.`
      : 'Collect more data, then repeat the market ranking.',
    channel: opportunity?.channelHint || 'Run a small controlled channel test.',
    risk: 'AirGesture records observed usage behavior, not ad clicks, purchases or willingness to pay. Treat this as a test hypothesis, not a sales prediction.',
    confidence: baseConfidence(snapshot, opportunity?.relevantEvents),
    chart: {
      type: 'bar',
      title: `${productLabel}: top candidate markets`,
      label: 'Relevant events',
      data: (opportunity?.markets || []).slice(0, 5).map((item) => ({
        label: item.name,
        value: item.count
      }))
    },
    decisionPath: [
      { stage: 'Observation', text: `${opportunity?.relevantEvents || 0} relevant events are visible in the current scope.` },
      { stage: 'Analysis', text: `${productLabel} scores ${opportunity?.score || 0}/100 using transparent aggregate signals.` },
      { stage: 'Opportunity', text: `${marketLabel} ranks highest among the current candidate markets.` },
      { stage: 'Decision', text: `Prioritize a controlled ${productLabel.toLowerCase()} market test.` },
      { stage: 'Experiment', text: `Measure the test before increasing spend or expanding geography.` }
    ],
    followUps: [
      `Why does ${marketLabel} rank first?`,
      `Compare ${marketLabel} with ${nextMarkets[0]?.name || 'the next market'}.`,
      `Should we use Google Ads or Instagram / Meta for ${productLabel}?`
    ]
  };
}

function classifyQuestion(question) {
  const q = clean(question).toLowerCase();

  if (/antivirus|anti-virus|security|endpoint|malware|cyber/.test(q)) {
    return 'antivirus-security';
  }

  if (/pdf|e-sign|esign|document software/.test(q)) {
    return 'pdf-productivity';
  }

  if (/photo|image editing|creative|camera|picture/.test(q)) {
    return 'photo-creative';
  }

  if (/backup|recovery/.test(q)) {
    return 'backup';
  }

  if (/cloud|storage|sync|large file/.test(q)) {
    return 'cloud-storage';
  }

  if (/office|business software|productivity|workflow|collaboration/.test(q)) {
    return 'business-productivity';
  }

  if (/google.*instagram|instagram.*google|meta.*google|google.*meta|which channel|advertising channel|ad channel/.test(q)) {
    return 'channel-comparison';
  }

  if (/apple.*windows|windows.*apple|compare.*segment|compare.*audience|platform|ecosystem/.test(q)) {
    return 'platform-comparison';
  }

  if (/when|time|hour|day|schedule|timing|peak/.test(q)) {
    return 'timing';
  }

  if (/premium|heavy user|pro plan|frequent user|high usage/.test(q)) {
    return 'premium';
  }

  if (/where|area|city|location|market/.test(q)) {
    return 'market';
  }

  if (/what product|which product|what software|promote|advertise|commercial opportun|what should management|what should we do/.test(q)) {
    return 'top-opportunities';
  }

  return 'top-opportunities';
}

function channelAnswer(snapshot) {
  const google = snapshot.adChannels.google;
  const meta = snapshot.adChannels.meta;
  const winner = google.score >= meta.score ? google : meta;
  const other = winner === google ? meta : google;

  return {
    scenario: 'channel-comparison',
    title: 'Google Ads vs Instagram / Meta',
    directAnswer: `${winner.name} is the stronger first classroom test channel in the current AirGesture scope (${winner.score}/100 vs ${other.score}/100).`,
    evidence: [
      `Google Search fit score: ${google.score}/100.`,
      `Instagram / Meta fit score: ${meta.score}/100.`,
      `Current desktop share: ${snapshot.signals.desktopPct}%.`,
      `Current mobile share: ${snapshot.signals.mobilePct}%; image/video share: ${snapshot.signals.imageVideoPct}%.`
    ],
    interpretation: 'Google tends to align with the current desktop/document/security signal, while Instagram / Meta aligns more with mobile and visual-content signals. These are channel-fit hypotheses, not measured conversion outcomes.',
    recommendation: `Use ${winner.name} as the primary test and ${other.name} as the comparison channel while keeping product, geography and budget assumptions consistent.`,
    experiment: 'Run a small A/B channel experiment in the same top market using the same product offer and compare actual clicks or conversions once those metrics are available.',
    channel: `${winner.name} first; ${other.name} as comparison.`,
    risk: 'The database contains product-usage behavior but no ad impressions, clicks, cost-per-click or conversion data.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'bar',
      title: 'Advertising channel fit',
      label: 'Fit score',
      data: [
        { label: 'Google Search', value: google.score },
        { label: 'Instagram / Meta', value: meta.score }
      ]
    },
    decisionPath: [
      { stage: 'Observation', text: 'Device and content behavior differs across the current audience.' },
      { stage: 'Analysis', text: 'The application calculates transparent channel-fit scores from those aggregate signals.' },
      { stage: 'Opportunity', text: `${winner.name} currently has the stronger fit signal.` },
      { stage: 'Decision', text: `Use ${winner.name} as the first test channel.` },
      { stage: 'Experiment', text: 'Measure actual campaign performance before scaling.' }
    ],
    followUps: [
      'Which product should we advertise on the stronger channel?',
      'Which market should receive the first advertising test?',
      'What additional data should we collect to improve this decision?'
    ]
  };
}

function platformAnswer(snapshot) {
  const segments = snapshot.dimensions.segments.slice(0, 5);
  const apple = segments
    .filter((item) => item.name.startsWith('APPLE_'))
    .reduce((sum, item) => sum + item.count, 0);
  const windows = segments
    .filter((item) => item.name === 'WINDOWS_DESKTOP')
    .reduce((sum, item) => sum + item.count, 0);
  const appleShare = percent(apple, snapshot.scope.matchingRecords);
  const windowsShare = percent(windows, snapshot.scope.matchingRecords);
  const leader = apple >= windows ? 'Apple' : 'Windows';

  return {
    scenario: 'platform-comparison',
    title: 'Apple vs Windows Strategy',
    directAnswer: `${leader} currently has the larger observed activity signal in this comparison, but the best commercial target still depends on the product being promoted.`,
    evidence: [
      `Apple-oriented activity: ${appleShare}% of current events.`,
      `Windows Desktop activity: ${windowsShare}% of current events.`,
      `Top content category: ${snapshot.kpis.topFileType || 'Unknown'}.`,
      `Top market: ${snapshot.kpis.topLocation || 'Unknown'}.`
    ],
    interpretation: 'Audience size should guide prioritization, but product fit matters: document/security offers may align differently from cloud/photo offers.',
    recommendation: 'Use product-specific testing rather than choosing an ecosystem solely because it has the largest audience.',
    experiment: 'Run one product-specific Apple test and one comparable Windows test in the same market, then compare actual response metrics.',
    channel: 'Choose the advertising channel after the product objective is fixed.',
    risk: 'Observed platform usage does not prove product preference or willingness to pay.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'bar',
      title: 'Apple vs Windows observed activity',
      label: 'Events',
      data: [
        { label: 'Apple', value: apple },
        { label: 'Windows', value: windows }
      ]
    },
    decisionPath: [
      { stage: 'Observation', text: `${leader} has the larger current activity signal.` },
      { stage: 'Analysis', text: 'Product fit differs by ecosystem and content behavior.' },
      { stage: 'Opportunity', text: 'Use the larger segment as a candidate audience, not as an automatic winner.' },
      { stage: 'Decision', text: 'Match the product to the audience before allocating budget.' },
      { stage: 'Experiment', text: 'Compare ecosystem-specific tests using the same success metric.' }
    ],
    followUps: [
      'Which products fit Apple users best?',
      'Which products fit Windows users best?',
      'Where should we test antivirus first?'
    ]
  };
}

function timingAnswer(snapshot) {
  const peakHour = snapshot.engagement.peakHour;
  const peakDay = snapshot.engagement.peakDay;

  return {
    scenario: 'timing',
    title: 'Engagement Timing Strategy',
    directAnswer: peakHour?.count
      ? `${peakDay?.name || 'The strongest day'} and the ${peakHour.label} UTC hour are the strongest observed usage windows in the current scope.`
      : 'There is not enough timestamped activity in the current scope to identify a peak window.',
    evidence: [
      peakDay ? `${peakDay.name}: ${peakDay.count} events.` : 'No peak day available.',
      peakHour ? `${peakHour.label} UTC: ${peakHour.count} events.` : 'No peak hour available.',
      `${snapshot.scope.matchingRecords} events are included in the current timing analysis.`
    ],
    interpretation: 'Usage timing can guide when to test product messages, support coverage or maintenance, but it does not by itself measure campaign response.',
    recommendation: peakHour?.count
      ? `Test engagement shortly before or around ${peakHour.label} UTC on ${peakDay?.name || 'the strongest day'}, then compare with an off-peak window.`
      : 'Collect additional timestamped activity before making a timing decision.',
    experiment: 'Use the same message in one peak and one off-peak window and compare actual engagement once campaign metrics are available.',
    channel: 'Timing applies to either Google or Meta tests after the channel and product are selected.',
    risk: 'The dataset may combine synthetic classroom records and real app records; interpret time patterns as instructional evidence.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'line',
      title: 'Hourly AirGesture activity',
      label: 'Events',
      data: snapshot.engagement.hours.map((item) => ({
        label: item.label,
        value: item.count
      }))
    },
    decisionPath: [
      { stage: 'Observation', text: 'Transfer activity varies by day and hour.' },
      { stage: 'Analysis', text: 'Peak usage windows are ranked from timestamped events.' },
      { stage: 'Opportunity', text: 'High-activity windows are candidates for engagement tests.' },
      { stage: 'Decision', text: 'Test around the strongest window rather than assuming all times are equal.' },
      { stage: 'Experiment', text: 'Compare peak vs off-peak results.' }
    ],
    followUps: [
      'Which market is most active during the peak window?',
      'Which product should we promote during the peak window?',
      'Should we use Google or Instagram during the peak period?'
    ]
  };
}

function premiumAnswer(snapshot) {
  const bands = snapshot.usage.bands;
  const heavy = bands.find((item) => item.key === 'HEAVY_USAGE');
  const active = bands.find((item) => item.key === 'ACTIVE_USAGE');

  return {
    scenario: 'premium',
    title: 'Premium Audience Strategy',
    directAnswer: `${round((heavy?.share || 0) + (active?.share || 0))}% of observed users fall into active or heavy usage bands in the current scope.`,
    evidence: [
      `Heavy usage: ${heavy?.users || 0} users (${heavy?.share || 0}%).`,
      `Active usage: ${active?.users || 0} users (${active?.share || 0}%).`,
      `Average file size: ${snapshot.kpis.avgFileBytes} bytes before UI formatting.`
    ],
    interpretation: 'Frequent or high-volume usage can identify a population worth testing for premium features, but it does not establish willingness to pay.',
    recommendation: 'Test a Pro concept focused on larger transfers, storage, priority workflows or business productivity with the active/heavy aggregate audience.',
    experiment: 'Show a hypothetical Pro offer to a controlled sample and measure opt-in or conversion intent before setting a final plan.',
    channel: 'Use product-led messaging first; paid advertising is secondary until premium intent is measured.',
    risk: 'Usage intensity is a behavioral signal, not a purchase prediction.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'bar',
      title: 'Usage bands',
      label: 'Users',
      data: bands.map((item) => ({
        label: item.name,
        value: item.users
      }))
    },
    decisionPath: [
      { stage: 'Observation', text: 'Users show different levels of transfer activity.' },
      { stage: 'Analysis', text: 'Users are grouped into transparent light, active and heavy usage bands.' },
      { stage: 'Opportunity', text: 'Active and heavy users are candidates for a premium-product experiment.' },
      { stage: 'Decision', text: 'Test a Pro value proposition with aggregate high-usage audiences.' },
      { stage: 'Experiment', text: 'Measure expressed interest before pricing or scaling.' }
    ],
    followUps: [
      'Which commercial segment has the strongest premium opportunity?',
      'What features should a hypothetical Pro plan test?',
      'Which market contains the strongest high-usage audience?'
    ]
  };
}

function marketAnswer(snapshot) {
  const market = snapshot.dimensions.locations[0];
  const next = snapshot.dimensions.locations[1];
  const topProduct = snapshot.opportunities[0];

  return {
    scenario: 'market',
    title: 'Market Prioritization',
    directAnswer: market
      ? `${market.name} is the strongest observed market in the current scope by transfer activity.`
      : 'No market can be ranked because the current scope has no location data.',
    evidence: [
      market ? `${market.name}: ${market.count} events, ${market.users} users and ${market.share}% of current activity.` : 'No market evidence available.',
      next ? `${next.name} is the next-ranked market with ${next.count} events.` : 'No comparison market is available.',
      topProduct ? `${topProduct.title} is the current highest-scoring product hypothesis (${topProduct.score}/100).` : 'No product opportunity score is available.'
    ],
    interpretation: 'Geographic activity identifies where the application has observed usage, making top markets reasonable candidates for controlled commercial experiments.',
    recommendation: market
      ? `Use ${market.name} as the first geographic test market and ${next?.name || 'the next-ranked market'} as a comparison. Keep the product and channel constant.`
      : 'Collect additional location data before selecting a geographic test.',
    experiment: market
      ? `Run the same small product campaign in ${market.name} and ${next?.name || 'a second market'} and compare measured outcomes.`
      : 'Collect additional location data.',
    channel: snapshot.adChannels.google.score >= snapshot.adChannels.meta.score
      ? 'Google Search is the stronger current channel-fit hypothesis.'
      : 'Instagram / Meta is the stronger current channel-fit hypothesis.',
    risk: 'Usage concentration does not establish market size, customer acquisition cost or purchase intent.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'bar',
      title: 'Top observed markets',
      label: 'Events',
      data: snapshot.dimensions.locations.slice(0, 7).map((item) => ({
        label: item.name,
        value: item.count
      }))
    },
    decisionPath: [
      { stage: 'Observation', text: 'Observed activity is not evenly distributed across locations.' },
      { stage: 'Analysis', text: `${market?.name || 'The leading market'} ranks highest in the current scope.` },
      { stage: 'Opportunity', text: 'Top markets are candidates for controlled geo-targeted tests.' },
      { stage: 'Decision', text: 'Start with one market and one comparison market.' },
      { stage: 'Experiment', text: 'Measure real campaign outcomes before geographic expansion.' }
    ],
    followUps: [
      market ? `What product should we promote in ${market.name}?` : 'What product should we promote?',
      market && next ? `Compare ${market.name} with ${next.name}.` : 'Compare the top two markets.',
      'Where should we advertise antivirus?'
    ]
  };
}

function topOpportunitiesAnswer(snapshot) {
  const top = snapshot.opportunities.slice(0, 3);
  const market = snapshot.dimensions.locations[0];
  const channel = snapshot.adChannels.google.score >= snapshot.adChannels.meta.score
    ? snapshot.adChannels.google
    : snapshot.adChannels.meta;

  return {
    scenario: 'top-opportunities',
    title: 'Top Commercial Opportunities',
    directAnswer: top.length
      ? `${top[0].title} is the highest-scoring product hypothesis in the current AirGesture scope, followed by ${top[1]?.title || 'the next opportunity'}.`
      : 'No commercial opportunities can be ranked in the current scope.',
    evidence: top.map((item) =>
      `${item.title}: ${item.score}/100 — ${item.reason}`
    ),
    interpretation: 'The ranking combines observable usage, device, content, location and activity signals into transparent classroom prioritization scores.',
    recommendation: top[0]
      ? `Test ${top[0].title.toLowerCase()} first in ${top[0].bestMarket || market?.name || 'the strongest market'} using ${channel.name}, then compare with the second-ranked product hypothesis.`
      : 'Collect additional data before selecting a product experiment.',
    experiment: top[0]
      ? `One market + one product + one channel + one measurable outcome. Keep the test small and compare against the second-ranked option.`
      : 'Collect more data.',
    channel: `${channel.name} currently has the stronger channel-fit signal (${channel.score}/100).`,
    risk: 'Opportunity scores are prioritization aids, not revenue forecasts or proof of purchase intent.',
    confidence: baseConfidence(snapshot),
    chart: {
      type: 'bar',
      title: 'Commercial opportunity ranking',
      label: 'Opportunity score',
      data: snapshot.opportunities.map((item) => ({
        label: item.shortTitle,
        value: item.score
      }))
    },
    decisionPath: [
      { stage: 'Observation', text: 'The database contains aggregate product, audience, market and timing signals.' },
      { stage: 'Analysis', text: 'Signals are converted into transparent opportunity scores.' },
      { stage: 'Opportunity', text: `${top[0]?.title || 'The leading product'} ranks highest in the current scope.` },
      { stage: 'Decision', text: 'Prioritize one small test rather than launching every idea.' },
      { stage: 'Experiment', text: 'Measure outcomes and update the ranking with real response data.' }
    ],
    followUps: [
      'Where should we advertise antivirus?',
      'Should we use Google Ads or Instagram / Meta?',
      'Which market should we target first?'
    ]
  };
}

function buildStrategyAnswer(question, snapshot) {
  const safeQuestion = clean(question).slice(0, 500);
  const scenario = classifyQuestion(safeQuestion);

  let answer;

  if (PRODUCT_DEFINITIONS.some((item) => item.id === scenario)) {
    answer = answerForProduct(safeQuestion, snapshot, scenario);
  } else if (scenario === 'channel-comparison') {
    answer = channelAnswer(snapshot);
  } else if (scenario === 'platform-comparison') {
    answer = platformAnswer(snapshot);
  } else if (scenario === 'timing') {
    answer = timingAnswer(snapshot);
  } else if (scenario === 'premium') {
    answer = premiumAnswer(snapshot);
  } else if (scenario === 'market') {
    answer = marketAnswer(snapshot);
  } else {
    answer = topOpportunitiesAnswer(snapshot);
  }

  return {
    question: safeQuestion,
    ...answer,
    evidence: (answer.evidence || []).map(compactEvidence).filter(Boolean)
  };
}

function compactAiEvidence(snapshot, strategy) {
  return {
    scope: {
      records: snapshot?.scope?.matchingRecords || 0,
      users: snapshot?.kpis?.users || 0,
      locations: snapshot?.kpis?.locations || 0,
      filters: snapshot?.filters || {}
    },
    headline: {
      topSegment: snapshot?.kpis?.topSegment || '',
      topSegmentShare: snapshot?.kpis?.topSegmentShare || 0,
      topFileType: snapshot?.kpis?.topFileType || '',
      topFileTypeShare: snapshot?.kpis?.topFileTypeShare || 0,
      topLocation: snapshot?.kpis?.topLocation || '',
      totalBytes: snapshot?.kpis?.totalBytes || 0
    },
    topMarkets: (snapshot?.dimensions?.locations || []).slice(0, 5),
    fileTypes: snapshot?.dimensions?.fileTypes || [],
    segments: (snapshot?.dimensions?.segments || []).slice(0, 6),
    opportunities: (snapshot?.opportunities || []).slice(0, 6).map((item) => ({
      id: item.id,
      title: item.title,
      score: item.score,
      bestMarket: item.bestMarket,
      reason: item.reason
    })),
    channels: {
      google: {
        score: snapshot?.adChannels?.google?.score || 0,
        bestProduct: snapshot?.adChannels?.google?.bestProduct || ''
      },
      meta: {
        score: snapshot?.adChannels?.meta?.score || 0,
        bestProduct: snapshot?.adChannels?.meta?.bestProduct || ''
      }
    },
    strategy: {
      scenario: strategy?.scenario || '',
      directAnswer: strategy?.directAnswer || '',
      evidence: strategy?.evidence || [],
      recommendation: strategy?.recommendation || '',
      experiment: strategy?.experiment || '',
      risk: strategy?.risk || ''
    }
  };
}

module.exports = {
  DAY_NAMES,
  PRODUCT_DEFINITIONS,
  normalizeFilters,
  applyFilters,
  buildIntelligenceSnapshot,
  buildStrategyAnswer,
  compactAiEvidence
};
