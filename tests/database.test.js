const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createDatabase
} = require('../db');

const {
  publicGoogleUser
} = require('../auth');

const root =
  path.join(__dirname, '..');

test(
  'V5.4 database stays disabled locally without DATABASE_URL',
  async () => {
    const database =
      createDatabase({
        connectionString: ''
      });

    assert.equal(
      database.enabled,
      false
    );

    assert.deepEqual(
      database.status(),
      {
        configured: false,
        ready: false
      }
    );

    assert.deepEqual(
      await database.initialize(),
      {
        configured: false,
        ready: false
      }
    );
  }
);

test(
  'V5.4 schema creates four classroom persistence tables without full IP',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'db.js'),
        'utf8'
      );

    for (const table of [
      'users',
      'class_sessions',
      'session_participants',
      'transfer_events'
    ]) {
      assert.match(
        source,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table}`
        )
      );
    }

    assert.match(
      source,
      /masked_ip/
    );

    assert.doesNotMatch(
      source,
      /full_ip/i
    );
  }
);

test(
  'browser profile hides Google subject and database user ID',
  () => {
    const user =
      publicGoogleUser({
        googleSub:
          'private-google-id',

        dbUserId: '42',

        name:
          'DBA Student',

        email:
          'student@example.com',

        picture:
          'https://example.com/a.jpg'
      });

    assert.deepEqual(
      user,
      {
        name: 'DBA Student',
        email:
          'student@example.com',
        picture:
          'https://example.com/a.jpg'
      }
    );

    assert.equal(
      Object.hasOwn(
        user,
        'googleSub'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        user,
        'dbUserId'
      ),
      false
    );
  }
);

test(
  'V5.4 uses PostgreSQL for persistent login sessions',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'server.js'),
        'utf8'
      );

    assert.match(
      source,
      /connect-pg-simple/
    );

    assert.match(
      source,
      /createTableIfMissing:\s*true/
    );

    assert.match(
      source,
      /tableName:\s*'user_sessions'/
    );

    assert.match(
      source,
      /database\.initialize\(\)/
    );

    assert.match(
      source,
      /database:\s*database\.status\(\)/
    );
  }
);

test(
  'V5.4 database persists classroom sessions and participants',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(
      source,
      /createClassSession/
    );

    assert.match(
      source,
      /upsertParticipant/
    );

    assert.match(
      source,
      /markParticipantLeft/
    );

    assert.match(
      source,
      /endClassSession/
    );
  }
);

test(
  'V5.4 persists successful and failed receiver transfer evidence',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'server.js'),
      'utf8'
    );

    assert.match(
      source,
      /persistTransferEvent/
    );

    assert.match(
      source,
      /'SUCCESS'/
    );

    assert.match(
      source,
      /'FAILED'/
    );

    assert.match(
      source,
      /recordTransferEvent/
    );
  }
);

test(
  'V5.4 provides protected non-PII persistence counts',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'server.js'),
      'utf8'
    );

    assert.match(
      source,
      /\/api\/persistence\/summary/
    );

    assert.match(
      source,
      /database\.summary/
    );
  }
);

test(
  'V5.4 exposes authenticated HTTP transfer persistence',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'server.js'),
      'utf8'
    );

    assert.match(
      source,
      /\/api\/persistence\/transfer/
    );

    assert.match(
      source,
      /HTTP transfer persistence/
    );

    assert.match(
      source,
      /recordTransferEvent/
    );
  }
);

test(
  'Receiver posts verified SUCCESS evidence to PostgreSQL endpoint',
  () => {
    const source = fs.readFileSync(
      path.join(
        root,
        'public',
        'app.js'
      ),
      'utf8'
    );

    assert.match(
      source,
      /\/api\/persistence\/transfer/
    );

    assert.match(
      source,
      /integrityVerified:\s*true/
    );

    assert.match(
      source,
      /result:\s*"SUCCESS"/
    );
  }
);

test(
  'V5.4.1 creates commercial intelligence tables',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    for (const table of [
      'commercial_profiles',
      'recommendation_events',
      'conversion_events'
    ]) {
      assert.match(
        source,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table}`
        )
      );
    }
  }
);

test(
  'V5.4.1 creates explicit consent governance tables',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(
      source,
      /CREATE TABLE IF NOT EXISTS consent_preferences/
    );

    assert.match(
      source,
      /CREATE TABLE IF NOT EXISTS consent_events/
    );

    assert.match(
      source,
      /analytics_consent BOOLEAN[\s\S]*DEFAULT FALSE/
    );

    assert.match(
      source,
      /personalization_consent BOOLEAN[\s\S]*DEFAULT FALSE/
    );

    assert.match(
      source,
      /marketing_consent BOOLEAN[\s\S]*DEFAULT FALSE/
    );
  }
);

test(
  'V5.4.1 has field-level governance registry',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(
      source,
      /data_governance_registry/
    );

    assert.match(
      source,
      /retention_days/
    );

    assert.match(
      source,
      /commercial_allowed/
    );

    assert.match(
      source,
      /data_owner/
    );
  }
);

test(
  'commercial profile excludes prohibited high-risk collection',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.doesNotMatch(
      source,
      /full_ip/i
    );

    assert.doesNotMatch(
      source,
      /precise_geolocation/i
    );

    assert.doesNotMatch(
      source,
      /camera_frame/i
    );
  }
);

test(
  'V5.4.1 exposes commercial profile persistence',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(source, /upsertCommercialProfile/);
    assert.match(source, /recordCommercialTransfer/);
    assert.match(source, /total_transfers/);
    assert.match(source, /total_bytes/);
  }
);

test(
  'V5.4.1 requires analytics consent before commercial collection',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(source, /getConsentPreferences/);
    assert.match(
      source,
      /if \(!consent\.analyticsConsent\)/
    );
    assert.match(source, /return null/);
  }
);

test(
  'V5.4.1 stores consent changes as audit events',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'db.js'),
      'utf8'
    );

    assert.match(source, /saveConsentPreferences/);
    assert.match(source, /INSERT INTO consent_events/);
    assert.match(source, /BEGIN/);
    assert.match(source, /COMMIT/);
  }
);


test(
  'V5.4.1 exposes authenticated commercial governance APIs',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'server.js'),
      'utf8'
    );

    assert.match(
      source,
      /\/api\/commercial\/consent/
    );

    assert.match(
      source,
      /\/api\/commercial\/profile/
    );

    assert.match(
      source,
      /saveConsentPreferences/
    );

    assert.match(
      source,
      /upsertCommercialProfile/
    );
  }
);


test(
  'V5.4.1 commercial transfer aggregation cannot break verified persistence',
  () => {
    const source = fs.readFileSync(
      path.join(root, 'server.js'),
      'utf8'
    );

    assert.match(
      source,
      /recordCommercialTransfer/
    );

    assert.match(
      source,
      /commercial transfer aggregation/
    );

    assert.match(
      source,
      /PostgreSQL HTTP transfer persisted/
    );
  }
);


test(
  'V5.4.1 browser collects practical commercial segmentation signals',
  () => {
    const source = fs.readFileSync(
      path.join(
        root,
        'public',
        'app.js'
      ),
      'utf8'
    );

    assert.match(
      source,
      /commercialSignals/
    );

    assert.match(
      source,
      /utm_source/
    );

    assert.match(
      source,
      /utm_medium/
    );

    assert.match(
      source,
      /utm_campaign/
    );

    assert.match(
      source,
      /memoryTier/
    );

    assert.match(
      source,
      /cpuTier/
    );

    assert.match(
      source,
      /deviceSegment/
    );

    assert.match(
      source,
      /referrerHost/
    );
  }
);


test(
  'V5.4.1 UI provides explicit commercial consent controls',
  () => {
    const source = fs.readFileSync(
      path.join(
        root,
        'public',
        'index.html'
      ),
      'utf8'
    );

    for (const id of [
      'analyticsConsent',
      'personalizationConsent',
      'marketingConsent',
      'saveConsentBtn',
      'consentStatus'
    ]) {
      assert.match(
        source,
        new RegExp(
          `id="${id}"`
        )
      );
    }

    assert.match(
      source,
      /off by default/i
    );
  }
);



test(
  'V5.4.2 exposes read-only database dashboard data',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'db.js'),
        'utf8'
      );

    assert.match(
      source,
      /dashboardData/
    );

    assert.match(
      source,
      /commercialProfiles/
    );

    assert.match(
      source,
      /consentPreferences/
    );

    assert.match(
      source,
      /transferEvents/
    );

    assert.match(
      source,
      /governanceRegistry/
    );
  }
);


test(
  'V5.4.2 protects database dashboard with server-side admin email allowlist',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'server.js'),
        'utf8'
      );

    assert.match(
      source,
      /AIRGESTURE_ADMIN_EMAILS/
    );

    assert.match(
      source,
      /requireAdmin/
    );

    assert.match(
      source,
      /\/api\/admin\/database/
    );
  }
);


test(
  'V5.4.2 database dashboard does not expose Google subject identifiers',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'db.js'),
        'utf8'
      );

    const start =
      source.indexOf(
        'async function dashboardData'
      );

    const end =
      source.indexOf(
        'async function close',
        start
      );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const dashboardSource =
      source.slice(start, end);

    assert.doesNotMatch(
      dashboardSource,
      /google_sub/i
    );

    assert.doesNotMatch(
      dashboardSource,
      /picture_url/i
    );
  }
);



test(
  'V5.4.2 UI contains admin PostgreSQL database intelligence dashboard',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'index.html'
        ),
        'utf8'
      );

    for (const id of [
      'databaseIntelligencePanel',
      'dbProfilesBody',
      'dbUsersBody',
      'dbConsentBody',
      'dbConsentEventsBody',
      'dbTransfersBody',
      'dbGovernanceBody',
      'dbRecommendationsBody',
      'dbConversionsBody',
      'refreshDatabaseBtn'
    ]) {
      assert.match(
        source,
        new RegExp(
          `id="${id}"`
        )
      );
    }

    assert.match(
      source,
      /Admin-only read access/
    );
  }
);


test(
  'V5.4.2 browser loads database records only through protected admin API',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'app.js'
        ),
        'utf8'
      );

    assert.match(
      source,
      /\/api\/admin\/database/
    );

    assert.match(
      source,
      /response\.status === 403/
    );

    assert.match(
      source,
      /databaseIntelligencePanel/
    );

    assert.match(
      source,
      /panel\.hidden = true/
    );
  }
);


test(
  'V5.4.2 dashboard renders commercial consent transfer governance recommendation and conversion records',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'app.js'
        ),
        'utf8'
      );

    for (const name of [
      'commercialProfiles',
      'consentPreferences',
      'consentEvents',
      'transferEvents',
      'governanceRegistry',
      'recommendationEvents',
      'conversionEvents'
    ]) {
      assert.match(
        source,
        new RegExp(name)
      );
    }
  }
);



test(
  'V5.4.2 grab release gesture experience is present',
  () => {
    const html =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'index.html'
        ),
        'utf8'
      );

    assert.match(
      html,
      /id="gestureExperience"/
    );

    assert.match(
      html,
      /id="gestureFileCard"/
    );

    assert.match(
      html,
      /id="gestureExperienceHand"/
    );
  }
);


test(
  'V5.4.2 sender grabs while receiver catches and releases',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'app.js'
        ),
        'utf8'
      );

    assert.match(
      source,
      /waiting-fist/
    );

    assert.match(
      source,
      /waiting-release/
    );

    assert.match(
      source,
      /READY TO GRAB/
    );

    assert.match(
      source,
      /CAUGHT/
    );

    assert.match(
      source,
      /RELEASED/
    );
  }
);


test(
  'V5.4.2 animates the file toward the detected hand',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'app.js'
        ),
        'utf8'
      );

    assert.match(
      source,
      /updateGestureHandAnchor/
    );

    assert.match(
      source,
      /animateAirFile/
    );

    assert.match(
      source,
      /lastHandAnchor/
    );
  }
);


test(
  'V5.4.2 incoming receiver UI uses a soft pulse',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'styles.css'
        ),
        'utf8'
      );

    assert.match(
      source,
      /airIncomingPulse/
    );

    assert.match(
      source,
      /prefers-reduced-motion/
    );
  }
);



test(
  'V5.4.2 stores classroom SEND and RECEIVE rows',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'db.js'),
        'utf8'
      );

    assert.match(
      source,
      /classroom_data_events/
    );

    assert.match(
      source,
      /recordLiveDataEvent/
    );

    assert.match(
      source,
      /'SEND'/
    );

    assert.match(
      source,
      /'RECEIVE'/
    );
  }
);


test(
  'V5.4.2 server creates SEND and RECEIVE live data events',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'server.js'),
        'utf8'
      );

    assert.match(
      source,
      /live SEND persistence/
    );

    assert.match(
      source,
      /live RECEIVE persistence/
    );

    assert.match(
      source,
      /\/api\/live-data/
    );
  }
);


test(
  'V5.4.2 main UI removes Executive Analytics navigation',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'index.html'
        ),
        'utf8'
      );

    assert.doesNotMatch(
      source,
      /data-view="analyticsView"/
    );

    assert.match(
      source,
      /id="openLiveDataBtn"/
    );

    assert.doesNotMatch(
      source,
      /id="classroomAnalyticsConsent"/
    );

    assert.match(
      source,
      /classroom transfer and device analytics are recorded/i
    );
  }
);


test(
  'V5.4.2 separate Live Data page auto-refreshes and downloads CSV',
  () => {
    const html =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'live-data.html'
        ),
        'utf8'
      );

    const js =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'live-data.js'
        ),
        'utf8'
      );

    assert.match(
      html,
      /Live Classroom Data Records/
    );

    assert.match(
      html,
      /Download CSV/
    );

    assert.match(
      js,
      /setInterval/
    );

    assert.match(
      js,
      /1000/
    );

    assert.match(
      js,
      /text\/csv/
    );
  }
);


test(
  'V5.4.2 student Live Data excludes email Google ID and full IP',
  () => {
    const source =
      fs.readFileSync(
        path.join(root, 'db.js'),
        'utf8'
      );

    const start =
      source.indexOf(
        'async function liveClassroomData'
      );

    const end =
      source.indexOf(
        'async function dashboardData',
        start
      );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const live =
      source.slice(
        start,
        end
      );

    assert.doesNotMatch(
      live,
      /u\.email/i
    );

    assert.doesNotMatch(
      live,
      /google_sub/i
    );

    assert.doesNotMatch(
      live,
      /masked_ip/i
    );
  }
);



test(
  'V5.4.2 Live Data shows all history to any authenticated user',
  () => {
    const server =
      fs.readFileSync(
        path.join(
          root,
          'server.js'
        ),
        'utf8'
      );

    const app =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'app.js'
        ),
        'utf8'
      );

    const live =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'live-data.js'
        ),
        'utf8'
      );

    const db =
      fs.readFileSync(
        path.join(
          root,
          'db.js'
        ),
        'utf8'
      );

    const routeStart =
      server.indexOf(
        "'/api/live-data'"
      );

    const routeEnd =
      server.indexOf(
        'app.get(',
        routeStart + 20
      );

    const route =
      server.slice(
        routeStart,
        routeEnd > routeStart
          ? routeEnd
          : undefined
      );

    assert.match(
      route,
      /requireAuth/
    );

    assert.match(
      route,
      /allHistory:\s*true/
    );

    assert.doesNotMatch(
      route,
      /isRoomParticipant/
    );

    assert.doesNotMatch(
      route,
      /Join this AirGesture room/
    );

    assert.match(
      app,
      /['"]\/live-data\.html['"]/
    );

    assert.match(
      live,
      /fetch\(\s*['"]\/api\/live-data['"]/
    );

    assert.match(
      live,
      /ALL STORED RECORDS/
    );

    assert.match(
      db,
      /input\.allHistory === true/
    );
  }
);


test(
  'V5.4.2 exposes full classroom-safe commercial attribute dataset',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'db.js'
        ),
        'utf8'
      );

    const start =
      source.indexOf(
        'async function liveClassroomData'
      );

    const end =
      source.indexOf(
        'async function dashboardData',
        start
      );

    const live =
      source.slice(
        start,
        end
      );

    for (
      const attribute
      of [
        'language',
        'screen_category',
        'touch_capable',
        'memory_tier',
        'cpu_tier',
        'referrer_host',
        'utm_source',
        'total_transfers',
        'image_transfers',
        'device_segment',
        'usage_segment',
        'content_segment',
        'latency_ms',
        'speed_mbps',
        'gesture_confidence',
        'integrity_verified'
      ]
    ) {
      assert.match(
        live,
        new RegExp(
          attribute
        )
      );
    }

    assert.doesNotMatch(
      live,
      /u\.email/
    );

    assert.doesNotMatch(
      live,
      /google_sub/
    );

    assert.doesNotMatch(
      live,
      /masked_ip/
    );

    assert.doesNotMatch(
      live,
      /file_name/
    );
  }
);


test(
  'V5.4.2 full CSV uses the same columns as the classroom database table',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'live-data.js'
        ),
        'utf8'
      );

    assert.match(
      source,
      /const columns =/
    );

    assert.match(
      source,
      /link\.download/
    );

    assert.match(
      source,
      /commercial-data/
    );

    assert.match(
      source,
      /columns\.map/
    );

    assert.doesNotMatch(
      source,
      /Analytics Opt-In/
    );

    assert.doesNotMatch(
      source,
      /Gesture Confidence/
    );

    assert.doesNotMatch(
      source,
      /Latency ms/
    );

    assert.doesNotMatch(
      source,
      /Speed Mbps/
    );

    assert.doesNotMatch(
      source,
      /Duration sec/
    );

    assert.doesNotMatch(
      source,
      /label: 'Trigger'/
    );

    assert.match(
      source,
      /Commercial Segment/
    );
  }
);



test(
  'V5.4.2 uses required classroom telemetry without an opt-in checkbox',
  () => {
    const db =
      fs.readFileSync(
        path.join(
          root,
          'db.js'
        ),
        'utf8'
      );

    const html =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'index.html'
        ),
        'utf8'
      );

    const live =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'live-data.js'
        ),
        'utf8'
      );

    assert.doesNotMatch(
      html,
      /classroomAnalyticsConsent/
    );

    assert.doesNotMatch(
      live,
      /Analytics Opt-In/
    );

    assert.match(
      html,
      /aggregate product analysis/i
    );

    const start =
      db.indexOf(
        'async function recordLiveDataEvent'
      );

    const end =
      db.indexOf(
        'async function liveClassroomData',
        start
      );

    const record =
      db.slice(
        start,
        end
      );

    assert.doesNotMatch(
      record,
      /commercialAllowed\\s*\\?/
    );

    assert.match(
      record,
      /classroomSegment\(client\)/
    );
  }
);

