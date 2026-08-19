'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORY_TITLES = {
  cloud: 'Cloud Storage',
  pdf: 'PDF & Document Productivity',
  security: 'Antivirus & Security Software',
  backup: 'Backup & Recovery',
  business: 'Business Productivity Software',
  creative: 'Photo & Creative Software'
};

function clean(value) {
  return String(value ?? '').trim();
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, n)
  );
}

function round(value, places = 1) {
  const p = 10 ** places;

  return (
    Math.round(
      (Number(value) || 0) * p
    ) / p
  );
}

function rowTime(row) {
  const ms = Date.parse(
    row?.time || ''
  );

  return Number.isFinite(ms)
    ? ms
    : null;
}

function latestTimestamp(rows) {
  let latest = null;

  for (const row of rows) {
    const ms = rowTime(row);

    if (ms === null) {
      continue;
    }

    if (
      latest === null ||
      ms > latest
    ) {
      latest = ms;
    }
  }

  return latest;
}

function uniqueUsers(rows) {
  return new Set(
    rows
      .map(row =>
        clean(row?.student)
      )
      .filter(Boolean)
  ).size;
}

function countBy(
  rows,
  getter
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      clean(getter(row)) ||
      'Unknown';

    map.set(
      key,
      (map.get(key) || 0) + 1
    );
  }

  return [...map.entries()]
    .map(([name, count]) => ({
      name,
      count
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
}

function shareOf(
  dimensions,
  name,
  total
) {
  if (!total) {
    return 0;
  }

  const item =
    dimensions.find(
      value =>
        clean(value.name)
          .toUpperCase() ===
        clean(name).toUpperCase()
    );

  return item
    ? item.count / total
    : 0;
}

function segmentSignals(segment) {
  const value =
    clean(segment)
      .toLowerCase();

  const signals = {
    cloud: 0,
    pdf: 0,
    security: 0,
    backup: 0,
    business: 0,
    creative: 0,
    keywords: []
  };

  if (
    value.includes('windows')
  ) {
    signals.security += 15;
    signals.business += 15;
    signals.pdf += 10;
    signals.backup += 10;

    signals.keywords.push(
      'microsoft',
      'norton',
      'bitdefender',
      'mcafee',
      'acrobat',
      'backup',
      'security'
    );
  }

  if (
    value.includes('apple desktop')
  ) {
    signals.creative += 18;
    signals.cloud += 13;
    signals.pdf += 8;
    signals.backup += 8;

    signals.keywords.push(
      'adobe',
      'lightroom',
      'photoshop',
      'icloud',
      'dropbox',
      'creative'
    );
  }

  if (
    value.includes('apple mobile')
  ) {
    signals.creative += 17;
    signals.cloud += 17;
    signals.backup += 10;
    signals.security += 5;

    signals.keywords.push(
      'icloud',
      'photo',
      'canva',
      'adobe',
      'mobile',
      'vpn'
    );
  }

  if (
    value.includes('android')
  ) {
    signals.cloud += 17;
    signals.backup += 12;
    signals.security += 10;
    signals.creative += 8;

    signals.keywords.push(
      'google',
      'drive',
      'photo',
      'backup',
      'vpn',
      'security'
    );
  }

  if (
    value.includes('linux')
  ) {
    signals.security += 20;
    signals.cloud += 13;
    signals.backup += 12;

    signals.keywords.push(
      'cloudflare',
      'proton',
      'vpn',
      'security',
      'encrypted',
      'backup'
    );
  }

  if (
    value.includes('tablet')
  ) {
    signals.pdf += 14;
    signals.creative += 13;
    signals.cloud += 12;
    signals.business += 8;

    signals.keywords.push(
      'pdf',
      'document',
      'photo',
      'canva',
      'cloud',
      'scan'
    );
  }

  return signals;
}

function contentSignals(
  rows
) {
  const dimensions =
    countBy(
      rows,
      row => row?.fileType
    );

  const total =
    Math.max(
      1,
      rows.length
    );

  const pdf =
    shareOf(
      dimensions,
      'PDF',
      total
    );

  const document =
    shareOf(
      dimensions,
      'DOCUMENT',
      total
    );

  const image =
    shareOf(
      dimensions,
      'IMAGE',
      total
    );

  const video =
    shareOf(
      dimensions,
      'VIDEO',
      total
    );

  const other =
    shareOf(
      dimensions,
      'OTHER',
      total
    );

  return {
    dimensions,

    weights: {
      cloud:
        image * 22 +
        video * 24 +
        document * 7 +
        other * 5,

      pdf:
        pdf * 34 +
        document * 17,

      security:
        5 +
        other * 7,

      backup:
        image * 17 +
        video * 20 +
        document * 13 +
        pdf * 10,

      business:
        document * 31 +
        pdf * 15,

      creative:
        image * 35 +
        video * 30
    }
  };
}

function confidenceFor(
  events,
  users
) {
  if (
    events >= 25 &&
    users >= 8
  ) {
    return {
      label: 'STRONG',
      level: 3
    };
  }

  if (
    events >= 10 &&
    users >= 4
  ) {
    return {
      label: 'MODERATE',
      level: 2
    };
  }

  return {
    label: 'EXPLORE',
    level: 1
  };
}

function growthInfo(
  current,
  previous
) {
  if (
    previous <= 0 &&
    current > 0
  ) {
    return {
      percent: null,
      label: 'New activity',
      positive: true
    };
  }

  if (previous <= 0) {
    return {
      percent: 0,
      label: 'No recent change',
      positive: false
    };
  }

  const value =
    round(
      ((current - previous) /
        previous) *
        100,
      1
    );

  return {
    percent: value,

    label:
      value > 0
        ? `+${value}%`
        : `${value}%`,

    positive:
      value > 0
  };
}

function momentumPoints(
  current,
  previous
) {
  if (
    current <= 0
  ) {
    return 0;
  }

  if (
    previous <= 0
  ) {
    return 12;
  }

  const growth =
    ((current - previous) /
      previous) *
    100;

  return clamp(
    growth / 8,
    -10,
    15
  );
}

function keywordSignals(
  segment,
  leadingContent
) {
  const result =
    segmentSignals(segment)
      .keywords
      .slice();

  const content =
    clean(leadingContent)
      .toUpperCase();

  if (content === 'PDF') {
    result.push(
      'acrobat',
      'foxit',
      'nitro',
      'pdf',
      'sign',
      'scan'
    );
  }

  if (
    content === 'DOCUMENT'
  ) {
    result.push(
      'microsoft',
      'workspace',
      'document',
      'docusign',
      'productivity',
      'dropbox'
    );
  }

  if (
    content === 'IMAGE'
  ) {
    result.push(
      'photoshop',
      'lightroom',
      'canva',
      'photo',
      'creative',
      'icloud'
    );
  }

  if (
    content === 'VIDEO'
  ) {
    result.push(
      'davinci',
      'capcut',
      'final cut',
      'video',
      'creative',
      'storage'
    );
  }

  if (
    content === 'OTHER'
  ) {
    result.push(
      'security',
      'backup',
      'cloud'
    );
  }

  return [
    ...new Set(
      result.map(
        value =>
          value.toLowerCase()
      )
    )
  ];
}

function marketMetrics(
  rows,
  anchor
) {
  const recentStart =
    anchor - 7 * DAY_MS;

  const previousStart =
    anchor - 14 * DAY_MS;

  const recent =
    rows.filter(row => {
      const ms = rowTime(row);

      return (
        ms !== null &&
        ms >= recentStart &&
        ms <= anchor
      );
    });

  const previous =
    rows.filter(row => {
      const ms = rowTime(row);

      return (
        ms !== null &&
        ms >= previousStart &&
        ms < recentStart
      );
    });

  const recentUsers =
    uniqueUsers(recent);

  const previousUsers =
    uniqueUsers(previous);

  return {
    recent,
    previous,
    recentEvents:
      recent.length,
    previousEvents:
      previous.length,
    recentUsers,
    previousUsers,
    growth:
      growthInfo(
        recent.length,
        previous.length
      )
  };
}

function emergingMarkets(
  rows,
  anchor
) {
  const locations =
    new Map();

  for (const row of rows) {
    const location =
      clean(row?.location);

    if (
      !location ||
      location.toLowerCase()
        .includes('unavailable')
    ) {
      continue;
    }

    if (
      !locations.has(location)
    ) {
      locations.set(
        location,
        []
      );
    }

    locations
      .get(location)
      .push(row);
  }

  return [...locations.entries()]
    .map(
      ([location, marketRows]) => {

        const metrics =
          marketMetrics(
            marketRows,
            anchor
          );

        const confidence =
          confidenceFor(
            metrics.recentEvents,
            metrics.recentUsers
          );

        const score =
          (
            metrics.recentEvents * 0.6 +
            metrics.recentUsers * 2
          ) +
          momentumPoints(
            metrics.recentEvents,
            metrics.previousEvents
          ) * 3;

        return {
          location,
          recentEvents:
            metrics.recentEvents,
          previousEvents:
            metrics.previousEvents,
          recentUsers:
            metrics.recentUsers,
          growth:
            metrics.growth,
          confidence:
            confidence.label,
          score:
            round(score, 1)
        };
      }
    )
    .filter(
      market =>
        market.recentEvents >= 10 &&
        market.recentUsers >= 3
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 5);
}

function buildRealtimeOpportunity(
  inputRows = [],
  filters = {}
) {
  const rows =
    Array.isArray(inputRows)
      ? inputRows
      : [];

  const anchor =
    latestTimestamp(rows);

  if (
    !rows.length ||
    anchor === null
  ) {
    return {
      generatedAt:
        new Date().toISOString(),
      anchorTime: null,
      scope: {
        location:
          clean(filters.location),
        segment:
          clean(filters.segment)
      },
      recentEvents: 0,
      recentUsers: 0,
      previousEvents: 0,
      growth: {
        percent: 0,
        label:
          'No recent activity',
        positive: false
      },
      confidence: 'EXPLORE',
      categoryScores: [],
      keywords: [],
      emergingMarkets: []
    };
  }

  const location =
    clean(filters.location);

  const segment =
    clean(filters.segment);

  const scoped =
    rows.filter(row => {

      if (
        location &&
        clean(row?.location) !==
          location
      ) {
        return false;
      }

      if (
        segment &&
        clean(
          row?.commercialSegment
        ) !== segment
      ) {
        return false;
      }

      return true;
    });

  const metrics =
    marketMetrics(
      scoped,
      anchor
    );

  const signalRows =
    metrics.recent.length
      ? metrics.recent
      : scoped;

  const segmentMix =
    countBy(
      signalRows,
      row =>
        row?.commercialSegment
    );

  const content =
    contentSignals(
      signalRows
    );

  const leadingSegment =
    segment ||
    segmentMix[0]?.name ||
    '';

  const leadingContent =
    content
      .dimensions[0]
      ?.name || '';

  const segmentFit =
    segmentSignals(
      leadingSegment
    );

  const confidence =
    confidenceFor(
      metrics.recentEvents,
      metrics.recentUsers
    );

  const activityScore =
    clamp(
      metrics.recentEvents / 2,
      0,
      20
    );

  const userScore =
    clamp(
      metrics.recentUsers * 1.5,
      0,
      15
    );

  const momentum =
    momentumPoints(
      metrics.recentEvents,
      metrics.previousEvents
    );

  const keys = [
    'cloud',
    'pdf',
    'security',
    'backup',
    'business',
    'creative'
  ];

  const categoryScores =
    keys.map(key => {

      const raw =
        30 +
        activityScore +
        userScore +
        momentum +
        Number(
          content.weights[key] ||
          0
        ) +
        Number(
          segmentFit[key] ||
          0
        );

      return {
        id: key,
        title:
          CATEGORY_TITLES[key],
        score:
          round(
            clamp(raw),
            1
          )
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score
    );

  const intensity =
    metrics.recentUsers
      ? round(
          metrics.recentEvents /
          metrics.recentUsers,
          1
        )
      : 0;

  return {
    generatedAt:
      new Date().toISOString(),

    anchorTime:
      new Date(anchor)
        .toISOString(),

    scope: {
      location,
      segment
    },

    recentEvents:
      metrics.recentEvents,

    previousEvents:
      metrics.previousEvents,

    recentUsers:
      metrics.recentUsers,

    previousUsers:
      metrics.previousUsers,

    eventsPerUser:
      intensity,

    growth:
      metrics.growth,

    confidence:
      confidence.label,

    leadingSegment,

    leadingContent,

    categoryScores,

    keywords:
      keywordSignals(
        leadingSegment,
        leadingContent
      ),

    emergingMarkets:
      emergingMarkets(
        rows,
        anchor
      )
  };
}

module.exports = {
  buildRealtimeOpportunity
};
