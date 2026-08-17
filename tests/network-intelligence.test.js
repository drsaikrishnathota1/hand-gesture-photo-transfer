const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  maskIp,
  classifyIp,
  sanitizeClientInfo,
  sanitizeClientGeo,
  mergeClientGeo,
  receiverIntelligenceRecord
} = require('../server');

test('V5.4.0 masks IPv4 rather than exposing a full public address', () => {
  assert.equal(maskIp('73.184.122.57'), '73.184.xxx.xxx');
  assert.notEqual(maskIp('73.184.122.57'), '73.184.122.57');
});

test('V5.4.0 recognizes loopback, private and public network classes', () => {
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

test('V5.4.0 UI includes Receiver Network Intelligence without a full-IP field', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /Receiver Network Intelligence/);
  assert.match(html, /Masked IP/);
  assert.match(html, /Measured Server Latency/);
  assert.doesNotMatch(html, /Full IP Address/);
});

test('V5.4.0 browser code collects device and network signals and measures server latency', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /collectClientInfo/);
  assert.match(js, /measureServerLatency/);
  assert.match(js, /receiver-intelligence/);
  assert.match(js, /integrityVerified: true/);
});



test(
  'V5.4.2 uses redundant city-level IP enrichment',
  () => {
    const serverSource =
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'server.js'
        ),
        'utf8'
      );

    assert.match(
      serverSource,
      /AIRGESTURE_IP_ENRICH_FALLBACK_URL_TEMPLATE/
    );

    assert.match(
      serverSource,
      /IP_ENRICH_TIMEOUT_MS/
    );

    assert.match(
      serverSource,
      /hasCompleteGeo/
    );

    assert.match(
      serverSource,
      /geoCache/
    );

    assert.match(
      serverSource,
      /\/api\/network\/location/
    );
  }
);


test(
  'V5.4.2 live dashboard provides interactive Transfer Trace',
  () => {
    const js =
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'public',
          'live-data.js'
        ),
        'utf8'
      );

    const css =
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'public',
          'live-data.css'
        ),
        'utf8'
      );

    assert.match(
      js,
      /activeTransferId/
    );

    assert.match(
      js,
      /createTransferIdControl/
    );

    assert.match(
      js,
      /transfer-trace-active/
    );

    assert.match(
      js,
      /copyText/
    );

    assert.match(
      css,
      /transfer-id-chip/
    );

    assert.match(
      css,
      /transfer-trace-active/
    );
  }
);



test(
  'browser-direct coarse geography requires city region and country',
  () => {
    assert.equal(
      sanitizeClientGeo({
        country:
          'United States'
      }),
      null
    );

    const geo =
      sanitizeClientGeo({
        city:
          'Lake Saint Louis',

        region:
          'Missouri',

        country:
          'United States',

        source:
          'ipapi-browser'
      });

    assert.deepEqual(
      geo,
      {
        city:
          'Lake Saint Louis',

        region:
          'Missouri',

        country:
          'United States',

        location:
          'Lake Saint Louis, Missouri, United States',

        geoSource:
          'ipapi-browser'
      }
    );
  }
);


test(
  'browser-direct geography upgrades unresolved server geography',
  () => {
    const merged =
      mergeClientGeo(
        {
          country:
            'United States',

          location:
            'Approximate location unavailable',

          geoSource:
            'unresolved'
        },
        {
          city:
            'Lake Saint Louis',

          region:
            'Missouri',

          country:
            'United States',

          source:
            'ipwhois-browser'
        }
      );

    assert.equal(
      merged.location,
      'Lake Saint Louis, Missouri, United States'
    );

    assert.equal(
      merged.geoSource,
      'ipwhois-browser'
    );
  }
);


test(
  'browser code resolves coarse location directly without storing provider IP',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'public',
          'app.js'
        ),
        'utf8'
      );

    assert.match(
      source,
      /resolveBrowserCoarseGeo/
    );

    assert.match(
      source,
      /https:\/\/ipapi\.co\/json\//
    );

    assert.match(
      source,
      /https:\/\/ipwho\.is\//
    );

    assert.match(
      source,
      /client-geo/
    );

    assert.doesNotMatch(
      source,
      /geo\.ip\s*=/
    );
  }
);
