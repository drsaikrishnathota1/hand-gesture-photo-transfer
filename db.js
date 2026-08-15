const crypto = require('crypto');
const { Pool } = require('pg');

function resolveConnectionString(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'connectionString')) {
    return String(options.connectionString || '').trim();
  }

  if (process.env.NODE_ENV === 'test') {
    return String(process.env.AIRGESTURE_TEST_DATABASE_URL || '').trim();
  }

  return String(process.env.DATABASE_URL || '').trim();
}

function clean(value, max) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, max);
}

function safeNumber(value, max = 1000000000) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(0, Math.min(max, n))
    : 0;
}

function createDatabase(options = {}) {
  const connectionString = resolveConnectionString(options);
  const enabled = Boolean(connectionString);
  let ready = false;

  const pool = enabled
    ? new Pool({
        connectionString,
        max: Math.max(
          1,
          Number(process.env.AIRGESTURE_PG_POOL_MAX) || 5
        ),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      })
    : null;

  function status() {
    return {
      configured: enabled,
      ready: enabled && ready
    };
  }

  async function initialize() {
    if (!enabled) return status();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        google_sub TEXT NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL DEFAULT '',
        email VARCHAR(180) NOT NULL DEFAULT '',
        picture_url TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS class_sessions (
        id UUID PRIMARY KEY,
        room_code VARCHAR(12) NOT NULL,
        course VARCHAR(32) NOT NULL DEFAULT 'DBA 802',
        host_user_id BIGINT
          REFERENCES users(id)
          ON DELETE SET NULL,
        app_version VARCHAR(24)
          NOT NULL DEFAULT '5.4.0',
        started_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS session_participants (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL
          REFERENCES class_sessions(id)
          ON DELETE CASCADE,
        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,
        receiver_id VARCHAR(24)
          NOT NULL DEFAULT '',
        role VARCHAR(16) NOT NULL
          CHECK (role IN ('sender', 'receiver')),
        browser VARCHAR(80)
          NOT NULL DEFAULT '',
        os VARCHAR(80)
          NOT NULL DEFAULT '',
        device_type VARCHAR(40)
          NOT NULL DEFAULT '',
        timezone VARCHAR(80)
          NOT NULL DEFAULT '',
        masked_ip VARCHAR(80)
          NOT NULL DEFAULT '',
        location VARCHAR(160)
          NOT NULL DEFAULT '',
        provider VARCHAR(160)
          NOT NULL DEFAULT '',
        joined_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, user_id, role)
      );

      CREATE TABLE IF NOT EXISTS transfer_events (
        id UUID PRIMARY KEY,
        session_id UUID NOT NULL
          REFERENCES class_sessions(id)
          ON DELETE CASCADE,
        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,
        file_id UUID NOT NULL,
        receiver_id VARCHAR(24)
          NOT NULL DEFAULT '',
        room_code VARCHAR(12) NOT NULL,
        result VARCHAR(16) NOT NULL
          CHECK (result IN ('SUCCESS', 'FAILED')),
        trigger VARCHAR(16)
          NOT NULL DEFAULT 'manual',
        file_name VARCHAR(180)
          NOT NULL DEFAULT '',
        file_type VARCHAR(120)
          NOT NULL DEFAULT '',
        file_size_bytes BIGINT
          NOT NULL DEFAULT 0,
        latency_ms DOUBLE PRECISION
          NOT NULL DEFAULT 0,
        speed_mbps DOUBLE PRECISION
          NOT NULL DEFAULT 0,
        duration_sec DOUBLE PRECISION
          NOT NULL DEFAULT 0,
        acceptance_latency_sec DOUBLE PRECISION
          NOT NULL DEFAULT 0,
        gesture_confidence DOUBLE PRECISION
          NOT NULL DEFAULT 0,
        integrity_verified BOOLEAN
          NOT NULL DEFAULT FALSE,
        retries INTEGER
          NOT NULL DEFAULT 0,
        failure_reason VARCHAR(160)
          NOT NULL DEFAULT '',
        browser VARCHAR(80)
          NOT NULL DEFAULT '',
        os VARCHAR(80)
          NOT NULL DEFAULT '',
        device_type VARCHAR(40)
          NOT NULL DEFAULT '',
        timezone VARCHAR(80)
          NOT NULL DEFAULT '',
        masked_ip VARCHAR(80)
          NOT NULL DEFAULT '',
        location VARCHAR(160)
          NOT NULL DEFAULT '',
        provider VARCHAR(160)
          NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),
        UNIQUE (
          session_id,
          user_id,
          file_id,
          result
        )
      );


      -- ---------------------------------
      -- V5.4.1 Commercial Intelligence
      -- ---------------------------------

      CREATE TABLE IF NOT EXISTS commercial_profiles (
        user_id BIGINT PRIMARY KEY
          REFERENCES users(id)
          ON DELETE CASCADE,

        first_seen_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        last_seen_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        visit_count INTEGER
          NOT NULL DEFAULT 0,

        country VARCHAR(80)
          NOT NULL DEFAULT '',

        region VARCHAR(120)
          NOT NULL DEFAULT '',

        timezone VARCHAR(80)
          NOT NULL DEFAULT '',

        language VARCHAR(24)
          NOT NULL DEFAULT '',

        browser VARCHAR(80)
          NOT NULL DEFAULT '',

        os VARCHAR(80)
          NOT NULL DEFAULT '',

        device_type VARCHAR(40)
          NOT NULL DEFAULT '',

        screen_category VARCHAR(32)
          NOT NULL DEFAULT '',

        touch_capable BOOLEAN
          NOT NULL DEFAULT FALSE,

        memory_tier VARCHAR(24)
          NOT NULL DEFAULT '',

        cpu_tier VARCHAR(24)
          NOT NULL DEFAULT '',

        referrer_host VARCHAR(160)
          NOT NULL DEFAULT '',

        landing_path VARCHAR(240)
          NOT NULL DEFAULT '',

        utm_source VARCHAR(120)
          NOT NULL DEFAULT '',

        utm_medium VARCHAR(120)
          NOT NULL DEFAULT '',

        utm_campaign VARCHAR(160)
          NOT NULL DEFAULT '',

        total_transfers INTEGER
          NOT NULL DEFAULT 0,

        total_bytes BIGINT
          NOT NULL DEFAULT 0,

        image_transfers INTEGER
          NOT NULL DEFAULT 0,

        video_transfers INTEGER
          NOT NULL DEFAULT 0,

        pdf_transfers INTEGER
          NOT NULL DEFAULT 0,

        document_transfers INTEGER
          NOT NULL DEFAULT 0,

        other_transfers INTEGER
          NOT NULL DEFAULT 0,

        device_segment VARCHAR(64)
          NOT NULL DEFAULT '',

        usage_segment VARCHAR(64)
          NOT NULL DEFAULT '',

        content_segment VARCHAR(64)
          NOT NULL DEFAULT '',

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE TABLE IF NOT EXISTS consent_preferences (
        user_id BIGINT PRIMARY KEY
          REFERENCES users(id)
          ON DELETE CASCADE,

        analytics_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        personalization_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        marketing_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        policy_version VARCHAR(32)
          NOT NULL DEFAULT '2026-08-v1',

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE TABLE IF NOT EXISTS consent_events (
        id UUID PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        analytics_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        personalization_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        marketing_consent BOOLEAN
          NOT NULL DEFAULT FALSE,

        source VARCHAR(40)
          NOT NULL DEFAULT 'app',

        policy_version VARCHAR(32)
          NOT NULL DEFAULT '2026-08-v1',

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE TABLE IF NOT EXISTS data_governance_registry (
        data_field VARCHAR(120) PRIMARY KEY,

        purpose VARCHAR(240)
          NOT NULL,

        source VARCHAR(80)
          NOT NULL,

        data_owner VARCHAR(120)
          NOT NULL DEFAULT 'AirGesture',

        sensitivity VARCHAR(32)
          NOT NULL DEFAULT 'PERSONAL',

        retention_days INTEGER
          NOT NULL DEFAULT 365,

        commercial_allowed BOOLEAN
          NOT NULL DEFAULT FALSE,

        notes TEXT
          NOT NULL DEFAULT '',

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE TABLE IF NOT EXISTS recommendation_events (
        id UUID PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        session_id UUID
          REFERENCES class_sessions(id)
          ON DELETE SET NULL,

        commercial_segment VARCHAR(64)
          NOT NULL DEFAULT '',

        recommendation_category VARCHAR(80)
          NOT NULL DEFAULT '',

        campaign_id VARCHAR(80)
          NOT NULL DEFAULT '',

        action VARCHAR(16)
          NOT NULL
          CHECK (
            action IN (
              'SHOWN',
              'CLICKED',
              'DISMISSED'
            )
          ),

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE TABLE IF NOT EXISTS conversion_events (
        id UUID PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        recommendation_id UUID
          REFERENCES recommendation_events(id)
          ON DELETE SET NULL,

        conversion_type VARCHAR(80)
          NOT NULL DEFAULT '',

        value_amount NUMERIC(12,2)
          NOT NULL DEFAULT 0,

        currency CHAR(3)
          NOT NULL DEFAULT 'USD',

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );


      CREATE INDEX IF NOT EXISTS idx_commercial_profile_device
        ON commercial_profiles (
          os,
          browser,
          device_type
        );

      CREATE INDEX IF NOT EXISTS idx_commercial_profile_market
        ON commercial_profiles (
          country,
          region
        );

      CREATE INDEX IF NOT EXISTS idx_commercial_profile_segment
        ON commercial_profiles (
          device_segment,
          usage_segment,
          content_segment
        );

      CREATE INDEX IF NOT EXISTS idx_consent_events_user
        ON consent_events (
          user_id,
          created_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_recommendations_user
        ON recommendation_events (
          user_id,
          created_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_recommendations_campaign
        ON recommendation_events (
          campaign_id,
          action
        );

      CREATE INDEX IF NOT EXISTS idx_conversions_user
        ON conversion_events (
          user_id,
          created_at DESC
        );


      INSERT INTO data_governance_registry (
        data_field,
        purpose,
        source,
        sensitivity,
        retention_days,
        commercial_allowed,
        notes
      )
      VALUES

      (
        'browser',
        'Device ecosystem segmentation',
        'browser',
        'PERSONAL',
        365,
        TRUE,
        'Used for aggregate commercial segmentation'
      ),

      (
        'os',
        'Device ecosystem segmentation',
        'browser',
        'PERSONAL',
        365,
        TRUE,
        'Used to identify broad technology cohorts'
      ),

      (
        'device_type',
        'Device category segmentation',
        'browser',
        'PERSONAL',
        365,
        TRUE,
        'Laptop desktop mobile or tablet category'
      ),

      (
        'country_region',
        'Geographic market analysis',
        'network_coarse',
        'PERSONAL',
        365,
        TRUE,
        'Coarse geography only; precise location excluded'
      ),

      (
        'acquisition_source',
        'Campaign attribution',
        'url_referrer',
        'PERSONAL',
        365,
        TRUE,
        'UTM and referring-domain attribution'
      ),

      (
        'usage_volume',
        'Customer usage segmentation',
        'application',
        'PERSONAL',
        365,
        TRUE,
        'Aggregate usage volume only'
      ),

      (
        'content_category',
        'Product-need segmentation',
        'file_metadata',
        'PERSONAL',
        365,
        TRUE,
        'File category only; file contents are excluded'
      ),

      (
        'commercial_segment',
        'Commercial recommendation eligibility',
        'derived',
        'PERSONAL',
        365,
        TRUE,
        'Derived from approved commercial attributes'
      ),

      (
        'consent_preferences',
        'Governance and commercial eligibility',
        'user_choice',
        'PERSONAL',
        730,
        FALSE,
        'Consent history is governance evidence, not targeting data'
      )

      ON CONFLICT (data_field)
      DO NOTHING;


      -- V5.4.2 Classroom Live Data
      CREATE TABLE IF NOT EXISTS classroom_data_events (
        id UUID PRIMARY KEY,

        session_id UUID NOT NULL
          REFERENCES class_sessions(id)
          ON DELETE CASCADE,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        room_code VARCHAR(12) NOT NULL,

        action VARCHAR(16) NOT NULL
          CHECK (action IN ('SEND', 'RECEIVE')),

        file_id UUID NOT NULL,

        file_type VARCHAR(40)
          NOT NULL DEFAULT 'OTHER',

        file_size_bytes BIGINT
          NOT NULL DEFAULT 0,

        browser VARCHAR(80)
          NOT NULL DEFAULT '',

        os VARCHAR(80)
          NOT NULL DEFAULT '',

        device_type VARCHAR(40)
          NOT NULL DEFAULT '',

        timezone VARCHAR(80)
          NOT NULL DEFAULT '',

        country VARCHAR(80)
          NOT NULL DEFAULT '',

        region VARCHAR(120)
          NOT NULL DEFAULT '',

        commercial_segment VARCHAR(64)
          NOT NULL DEFAULT 'NOT_OPTED_IN',

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        UNIQUE (
          session_id,
          user_id,
          file_id,
          action
        )
      );

      CREATE INDEX IF NOT EXISTS idx_classroom_live_room
        ON classroom_data_events (
          room_code,
          created_at DESC
        );


      CREATE INDEX IF NOT EXISTS idx_class_sessions_room
        ON class_sessions (room_code, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_session_participants_session
        ON session_participants (session_id, joined_at);

      CREATE INDEX IF NOT EXISTS idx_transfer_events_user
        ON transfer_events (user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_transfer_events_session
        ON transfer_events (session_id, created_at DESC);
    `);


    // ---------------------------------------------------------
    // V5.4.2 HISTORICAL CLASSROOM DATA BACKFILL
    // ---------------------------------------------------------
    // Older AirGesture releases stored successful transfers in
    // transfer_events. Reconstruct those records for the new
    // classroom_data_events teaching table.
    //
    // Existing V5.4.2 rows are protected by ON CONFLICT.

    await pool.query(`
      INSERT INTO classroom_data_events (
        id,
        session_id,
        user_id,
        room_code,
        action,
        file_id,
        file_type,
        file_size_bytes,
        browser,
        os,
        device_type,
        timezone,
        country,
        region,
        commercial_segment,
        created_at
      )

      SELECT
        gen_random_uuid(),
        t.session_id,
        t.user_id,
        t.room_code,
        'RECEIVE',
        t.file_id,

        CASE
          WHEN LOWER(t.file_type)
               LIKE 'image/%'
            THEN 'IMAGE'

          WHEN LOWER(t.file_type)
               LIKE 'video/%'
            THEN 'VIDEO'

          WHEN LOWER(t.file_type)
               LIKE '%pdf%'
            THEN 'PDF'

          WHEN LOWER(t.file_type)
               LIKE '%word%'
            OR LOWER(t.file_type)
               LIKE '%document%'
            OR LOWER(t.file_type)
               LIKE '%text%'
            OR LOWER(t.file_type)
               LIKE '%sheet%'
            OR LOWER(t.file_type)
               LIKE '%excel%'
            OR LOWER(t.file_type)
               LIKE '%presentation%'
            THEN 'DOCUMENT'

          ELSE 'OTHER'
        END,

        t.file_size_bytes,

        CASE
          WHEN COALESCE(
            cp.analytics_consent,
            FALSE
          )
          THEN t.browser
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            cp.analytics_consent,
            FALSE
          )
          THEN t.os
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            cp.analytics_consent,
            FALSE
          )
          THEN t.device_type
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            cp.analytics_consent,
            FALSE
          )
          THEN t.timezone
          ELSE ''
        END,

        '',

        '',

        CASE
          WHEN COALESCE(
            cp.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            profile.device_segment,
            'GENERAL_DESKTOP'
          )
          ELSE 'NOT_OPTED_IN'
        END,

        t.created_at

      FROM transfer_events t

      LEFT JOIN consent_preferences cp
        ON cp.user_id =
           t.user_id

      LEFT JOIN commercial_profiles profile
        ON profile.user_id =
           t.user_id

      WHERE
        t.result = 'SUCCESS'

      ON CONFLICT (
        session_id,
        user_id,
        file_id,
        action
      )
      DO NOTHING;
    `);


    // Reconstruct one historical SEND row for each distinct
    // session/file using the recorded class-session host.
    await pool.query(`
      INSERT INTO classroom_data_events (
        id,
        session_id,
        user_id,
        room_code,
        action,
        file_id,
        file_type,
        file_size_bytes,
        browser,
        os,
        device_type,
        timezone,
        country,
        region,
        commercial_segment,
        created_at
      )

      SELECT DISTINCT ON (
        t.session_id,
        t.file_id
      )

        gen_random_uuid(),
        t.session_id,
        cs.host_user_id,
        t.room_code,
        'SEND',
        t.file_id,

        CASE
          WHEN LOWER(t.file_type)
               LIKE 'image/%'
            THEN 'IMAGE'

          WHEN LOWER(t.file_type)
               LIKE 'video/%'
            THEN 'VIDEO'

          WHEN LOWER(t.file_type)
               LIKE '%pdf%'
            THEN 'PDF'

          WHEN LOWER(t.file_type)
               LIKE '%word%'
            OR LOWER(t.file_type)
               LIKE '%document%'
            OR LOWER(t.file_type)
               LIKE '%text%'
            OR LOWER(t.file_type)
               LIKE '%sheet%'
            OR LOWER(t.file_type)
               LIKE '%excel%'
            OR LOWER(t.file_type)
               LIKE '%presentation%'
            THEN 'DOCUMENT'

          ELSE 'OTHER'
        END,

        t.file_size_bytes,

        CASE
          WHEN COALESCE(
            consent.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            sender.browser,
            ''
          )
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            consent.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            sender.os,
            ''
          )
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            consent.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            sender.device_type,
            ''
          )
          ELSE ''
        END,

        CASE
          WHEN COALESCE(
            consent.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            sender.timezone,
            ''
          )
          ELSE ''
        END,

        '',

        '',

        CASE
          WHEN COALESCE(
            consent.analytics_consent,
            FALSE
          )
          THEN COALESCE(
            profile.device_segment,
            'GENERAL_DESKTOP'
          )
          ELSE 'NOT_OPTED_IN'
        END,

        t.created_at

      FROM transfer_events t

      JOIN class_sessions cs
        ON cs.id =
           t.session_id

      LEFT JOIN session_participants sender
        ON sender.session_id =
           t.session_id
       AND sender.user_id =
           cs.host_user_id
       AND sender.role =
           'sender'

      LEFT JOIN consent_preferences consent
        ON consent.user_id =
           cs.host_user_id

      LEFT JOIN commercial_profiles profile
        ON profile.user_id =
           cs.host_user_id

      WHERE
        t.result = 'SUCCESS'

        AND cs.host_user_id
            IS NOT NULL

      ORDER BY
        t.session_id,
        t.file_id,
        t.created_at ASC

      ON CONFLICT (
        session_id,
        user_id,
        file_id,
        action
      )
      DO NOTHING;
    `);


    ready = true;
    return status();
  }

  async function upsertUser(user = {}) {
    if (!enabled) return null;

    const googleSub = clean(user.googleSub, 255);
    if (!googleSub) {
      throw new Error('googleSub is required');
    }

    const result = await pool.query(
      `INSERT INTO users (
         google_sub,
         name,
         email,
         picture_url,
         last_login_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (google_sub)
       DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         picture_url = CASE
           WHEN EXCLUDED.picture_url <> ''
             THEN EXCLUDED.picture_url
           ELSE users.picture_url
         END,
         last_login_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        googleSub,
        clean(user.name, 120),
        clean(user.email, 180),
        clean(user.picture, 500)
      ]
    );

    return result.rows[0] || null;
  }

  async function createClassSession(input = {}) {
    if (!enabled) return null;

    const id = clean(input.id, 36);
    const roomCode = clean(input.roomCode, 12).toUpperCase();

    if (!id || !roomCode) {
      throw new Error('Session ID and room code are required');
    }

    const result = await pool.query(
      `INSERT INTO class_sessions (
         id,
         room_code,
         course,
         host_user_id,
         app_version
       )
       VALUES ($1, $2, $3, $4, '5.4.0')
       ON CONFLICT (id)
       DO UPDATE SET
         host_user_id = COALESCE(
           EXCLUDED.host_user_id,
           class_sessions.host_user_id
         ),
         ended_at = NULL
       RETURNING *`,
      [
        id,
        roomCode,
        clean(input.course || 'DBA 802', 32),
        input.hostUserId || null
      ]
    );

    return result.rows[0] || null;
  }

  async function upsertParticipant(input = {}) {
    if (!enabled) return null;

    const role = input.role === 'receiver'
      ? 'receiver'
      : 'sender';

    const client = input.clientInfo || {};
    const network = input.network || {};

    const result = await pool.query(
      `INSERT INTO session_participants (
         session_id,
         user_id,
         receiver_id,
         role,
         browser,
         os,
         device_type,
         timezone,
         masked_ip,
         location,
         provider
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       )
       ON CONFLICT (session_id, user_id, role)
       DO UPDATE SET
         receiver_id = EXCLUDED.receiver_id,
         browser = EXCLUDED.browser,
         os = EXCLUDED.os,
         device_type = EXCLUDED.device_type,
         timezone = EXCLUDED.timezone,
         masked_ip = EXCLUDED.masked_ip,
         location = EXCLUDED.location,
         provider = EXCLUDED.provider,
         left_at = NULL,
         updated_at = NOW()
       RETURNING *`,
      [
        input.sessionId,
        input.userId,
        clean(input.receiverId, 24),
        role,
        clean(client.browser, 80),
        clean(client.os, 80),
        clean(client.deviceType, 40),
        clean(client.timezone, 80),
        clean(network.maskedIp, 80),
        clean(network.location, 160),
        clean(network.provider, 160)
      ]
    );

    return result.rows[0] || null;
  }

  async function markParticipantLeft(input = {}) {
    if (!enabled) return;

    await pool.query(
      `UPDATE session_participants
       SET
         left_at = NOW(),
         updated_at = NOW()
       WHERE session_id = $1
         AND user_id = $2
         AND role = $3`,
      [
        input.sessionId,
        input.userId,
        input.role === 'receiver'
          ? 'receiver'
          : 'sender'
      ]
    );
  }

  async function recordTransferEvent(input = {}) {
    if (!enabled) return null;

    const file = input.file || {};
    const client = input.clientInfo || {};
    const network = input.network || {};

    const result =
      input.result === 'FAILED'
        ? 'FAILED'
        : 'SUCCESS';

    const trigger =
      input.trigger === 'gesture'
        ? 'gesture'
        : 'manual';

    const values = [
      crypto.randomUUID(),
      input.sessionId,
      input.userId,
      file.id,
      clean(input.receiverId, 24),
      clean(input.roomCode, 12).toUpperCase(),
      result,
      trigger,
      clean(file.name, 180),
      clean(file.mime, 120),
      Math.round(safeNumber(file.size, 104857600)),
      safeNumber(input.latencyMs, 120000),
      safeNumber(input.speedMbps),
      safeNumber(input.durationSec, 86400),
      safeNumber(input.acceptanceLatencySec, 86400),
      safeNumber(input.gestureConfidence, 1),
      Boolean(input.integrityVerified),
      Math.floor(safeNumber(input.retries, 1000)),
      clean(input.failureReason, 160),
      clean(client.browser, 80),
      clean(client.os, 80),
      clean(client.deviceType, 40),
      clean(client.timezone, 80),
      clean(network.maskedIp, 80),
      clean(network.location, 160),
      clean(network.provider, 160)
    ];

    const query = `
      INSERT INTO transfer_events (
        id,
        session_id,
        user_id,
        file_id,
        receiver_id,
        room_code,
        result,
        trigger,
        file_name,
        file_type,
        file_size_bytes,
        latency_ms,
        speed_mbps,
        duration_sec,
        acceptance_latency_sec,
        gesture_confidence,
        integrity_verified,
        retries,
        failure_reason,
        browser,
        os,
        device_type,
        timezone,
        masked_ip,
        location,
        provider
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26
      )
      ON CONFLICT (
        session_id,
        user_id,
        file_id,
        result
      )
      DO UPDATE SET
        trigger = EXCLUDED.trigger,
        latency_ms = EXCLUDED.latency_ms,
        speed_mbps = EXCLUDED.speed_mbps,
        duration_sec = EXCLUDED.duration_sec,
        acceptance_latency_sec =
          EXCLUDED.acceptance_latency_sec,
        gesture_confidence =
          EXCLUDED.gesture_confidence,
        integrity_verified =
          EXCLUDED.integrity_verified,
        retries = EXCLUDED.retries,
        failure_reason =
          EXCLUDED.failure_reason,
        browser = EXCLUDED.browser,
        os = EXCLUDED.os,
        device_type = EXCLUDED.device_type,
        timezone = EXCLUDED.timezone,
        masked_ip = EXCLUDED.masked_ip,
        location = EXCLUDED.location,
        provider = EXCLUDED.provider
      RETURNING *
    `;

    const resultRow =
      await pool.query(query, values);

    return resultRow.rows[0] || null;
  }


  async function getConsentPreferences(userId) {
    if (!enabled || !userId) {
      return {
        analyticsConsent: false,
        personalizationConsent: false,
        marketingConsent: false,
        policyVersion: '2026-08-v1'
      };
    }

    const result = await pool.query(
      `SELECT
         analytics_consent,
         personalization_consent,
         marketing_consent,
         policy_version,
         updated_at
       FROM consent_preferences
       WHERE user_id = $1`,
      [userId]
    );

    const row = result.rows[0];

    if (!row) {
      return {
        analyticsConsent: false,
        personalizationConsent: false,
        marketingConsent: false,
        policyVersion: '2026-08-v1'
      };
    }

    return {
      analyticsConsent: Boolean(row.analytics_consent),
      personalizationConsent: Boolean(row.personalization_consent),
      marketingConsent: Boolean(row.marketing_consent),
      policyVersion: row.policy_version,
      updatedAt: row.updated_at
    };
  }

  async function saveConsentPreferences(input = {}) {
    if (!enabled) return null;

    if (!input.userId) {
      throw new Error('User ID is required for consent');
    }

    const analyticsConsent =
      input.analyticsConsent === true;

    const personalizationConsent =
      input.personalizationConsent === true;

    const marketingConsent =
      input.marketingConsent === true;

    const policyVersion =
      clean(input.policyVersion || '2026-08-v1', 32);

    const source =
      clean(input.source || 'app', 40);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const preferenceResult =
        await client.query(
          `INSERT INTO consent_preferences (
             user_id,
             analytics_consent,
             personalization_consent,
             marketing_consent,
             policy_version,
             updated_at
           )
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET
             analytics_consent =
               EXCLUDED.analytics_consent,
             personalization_consent =
               EXCLUDED.personalization_consent,
             marketing_consent =
               EXCLUDED.marketing_consent,
             policy_version =
               EXCLUDED.policy_version,
             updated_at = NOW()
           RETURNING *`,
          [
            input.userId,
            analyticsConsent,
            personalizationConsent,
            marketingConsent,
            policyVersion
          ]
        );

      await client.query(
        `INSERT INTO consent_events (
           id,
           user_id,
           analytics_consent,
           personalization_consent,
           marketing_consent,
           source,
           policy_version
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          crypto.randomUUID(),
          input.userId,
          analyticsConsent,
          personalizationConsent,
          marketingConsent,
          source,
          policyVersion
        ]
      );

      await client.query('COMMIT');

      return preferenceResult.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function upsertCommercialProfile(input = {}) {
    if (!enabled) return null;

    if (!input.userId) {
      throw new Error(
        'User ID is required for commercial profile'
      );
    }

    const consent =
      await getConsentPreferences(input.userId);

    if (!consent.analyticsConsent) {
      return null;
    }

    const client = input.clientInfo || {};
    const network = input.network || {};
    const acquisition = input.acquisition || {};

    const result = await pool.query(
      `INSERT INTO commercial_profiles (
         user_id,
         first_seen_at,
         last_seen_at,
         visit_count,
         country,
         region,
         timezone,
         language,
         browser,
         os,
         device_type,
         screen_category,
         touch_capable,
         memory_tier,
         cpu_tier,
         referrer_host,
         landing_path,
         utm_source,
         utm_medium,
         utm_campaign,
         device_segment,
         updated_at
       )
       VALUES (
         $1,
         NOW(),
         NOW(),
         1,
         $2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,
         NOW()
       )
       ON CONFLICT (user_id)
       DO UPDATE SET
         last_seen_at = NOW(),
         visit_count =
           commercial_profiles.visit_count + 1,
         country = CASE
           WHEN EXCLUDED.country <> ''
           THEN EXCLUDED.country
           ELSE commercial_profiles.country
         END,
         region = CASE
           WHEN EXCLUDED.region <> ''
           THEN EXCLUDED.region
           ELSE commercial_profiles.region
         END,
         timezone = EXCLUDED.timezone,
         language = EXCLUDED.language,
         browser = EXCLUDED.browser,
         os = EXCLUDED.os,
         device_type = EXCLUDED.device_type,
         screen_category = EXCLUDED.screen_category,
         touch_capable = EXCLUDED.touch_capable,
         memory_tier = EXCLUDED.memory_tier,
         cpu_tier = EXCLUDED.cpu_tier,
         referrer_host = CASE
           WHEN EXCLUDED.referrer_host <> ''
           THEN EXCLUDED.referrer_host
           ELSE commercial_profiles.referrer_host
         END,
         landing_path = CASE
           WHEN EXCLUDED.landing_path <> ''
           THEN EXCLUDED.landing_path
           ELSE commercial_profiles.landing_path
         END,
         utm_source = CASE
           WHEN EXCLUDED.utm_source <> ''
           THEN EXCLUDED.utm_source
           ELSE commercial_profiles.utm_source
         END,
         utm_medium = CASE
           WHEN EXCLUDED.utm_medium <> ''
           THEN EXCLUDED.utm_medium
           ELSE commercial_profiles.utm_medium
         END,
         utm_campaign = CASE
           WHEN EXCLUDED.utm_campaign <> ''
           THEN EXCLUDED.utm_campaign
           ELSE commercial_profiles.utm_campaign
         END,
         device_segment = EXCLUDED.device_segment,
         updated_at = NOW()
       RETURNING *`,
      [
        input.userId,
        clean(network.country, 80),
        clean(network.region, 120),
        clean(client.timezone, 80),
        clean(client.language, 24),
        clean(client.browser, 80),
        clean(client.os, 80),
        clean(client.deviceType, 40),
        clean(input.screenCategory, 32),
        Boolean(input.touchCapable),
        clean(input.memoryTier, 24),
        clean(input.cpuTier, 24),
        clean(acquisition.referrerHost, 160),
        clean(acquisition.landingPath, 240),
        clean(acquisition.utmSource, 120),
        clean(acquisition.utmMedium, 120),
        clean(acquisition.utmCampaign, 160),
        clean(input.deviceSegment, 64)
      ]
    );

    return result.rows[0] || null;
  }

  async function recordCommercialTransfer(input = {}) {
    if (!enabled || !input.userId) return null;

    const consent =
      await getConsentPreferences(input.userId);

    if (!consent.analyticsConsent) {
      return null;
    }

    const file = input.file || {};
    const mime = String(file.mime || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();

    let category = 'other';

    if (mime.startsWith('image/')) {
      category = 'image';
    } else if (mime.startsWith('video/')) {
      category = 'video';
    } else if (
      mime === 'application/pdf' ||
      name.endsWith('.pdf')
    ) {
      category = 'pdf';
    } else if (
      mime.startsWith('text/') ||
      /word|document|sheet|excel|presentation|powerpoint|csv/.test(mime) ||
      /\.(doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/i.test(name)
    ) {
      category = 'document';
    }

    const size =
      Math.round(
        safeNumber(file.size, 104857600)
      );

    const column = {
      image: 'image_transfers',
      video: 'video_transfers',
      pdf: 'pdf_transfers',
      document: 'document_transfers',
      other: 'other_transfers'
    }[category];

    const query = `
      UPDATE commercial_profiles
      SET
        total_transfers =
          total_transfers + 1,
        total_bytes =
          total_bytes + $2,
        ${column} =
          ${column} + 1,
        usage_segment =
          CASE
            WHEN
              total_bytes + $2 >= 1073741824
              OR total_transfers + 1 >= 25
              THEN 'HEAVY_USAGE'
            WHEN
              total_transfers + 1 >= 8
              THEN 'ACTIVE_USAGE'
            ELSE 'LIGHT_USAGE'
          END,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `;

    const result =
      await pool.query(
        query,
        [
          input.userId,
          size
        ]
      );

    return result.rows[0] || null;
  }

  async function findLatestReceiverSession(input = {}) {
    if (!enabled) return null;

    const roomCode =
      clean(input.roomCode, 12).toUpperCase();

    if (!roomCode || !input.userId) {
      return null;
    }

    const result = await pool.query(
      `SELECT
         cs.id AS session_id,
         sp.receiver_id,
         sp.browser,
         sp.os,
         sp.device_type,
         sp.timezone,
         sp.masked_ip,
         sp.location,
         sp.provider
       FROM class_sessions cs
       JOIN session_participants sp
         ON sp.session_id = cs.id
       WHERE cs.room_code = $1
         AND sp.user_id = $2
         AND sp.role = 'receiver'
       ORDER BY cs.started_at DESC
       LIMIT 1`,
      [
        roomCode,
        input.userId
      ]
    );

    return result.rows[0] || null;
  }

  async function endClassSession(sessionId) {
    if (!enabled || !sessionId) return;

    await pool.query(
      `UPDATE class_sessions
       SET ended_at = COALESCE(
         ended_at,
         NOW()
       )
       WHERE id = $1`,
      [sessionId]
    );
  }

  async function summary() {
    if (!enabled) {
      return {
        users: 0,
        classSessions: 0,
        participants: 0,
        transferEvents: 0
      };
    }

    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int
           FROM users) AS users,
        (SELECT COUNT(*)::int
           FROM class_sessions) AS class_sessions,
        (SELECT COUNT(*)::int
           FROM session_participants) AS participants,
        (SELECT COUNT(*)::int
           FROM transfer_events) AS transfer_events
    `);

    const row = result.rows[0] || {};

    return {
      users: Number(row.users || 0),
      classSessions:
        Number(row.class_sessions || 0),
      participants:
        Number(row.participants || 0),
      transferEvents:
        Number(row.transfer_events || 0)
    };
  }



  function classroomFileType(file = {}) {
    const mime =
      String(file.mime || '')
        .toLowerCase();

    const name =
      String(file.name || '')
        .toLowerCase();

    if (mime.startsWith('image/')) {
      return 'IMAGE';
    }

    if (mime.startsWith('video/')) {
      return 'VIDEO';
    }

    if (
      mime === 'application/pdf' ||
      name.endsWith('.pdf')
    ) {
      return 'PDF';
    }

    if (
      mime.startsWith('text/') ||
      /word|document|sheet|excel|presentation|powerpoint|csv/.test(mime) ||
      /\.(doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/i.test(name)
    ) {
      return 'DOCUMENT';
    }

    return 'OTHER';
  }


  function classroomSegment(client = {}) {
    const os =
      String(client.os || '');

    const device =
      String(client.deviceType || '');

    if (!os && !device) {
      return '';
    }

    if (
      os === 'macOS' &&
      device === 'Laptop/Desktop'
    ) {
      return 'APPLE_DESKTOP';
    }

    if (os === 'iOS/iPadOS') {
      return 'APPLE_MOBILE';
    }

    if (
      os === 'Windows' &&
      device === 'Laptop/Desktop'
    ) {
      return 'WINDOWS_DESKTOP';
    }

    if (os === 'Android') {
      return 'ANDROID_MOBILE';
    }

    if (
      os === 'Linux' &&
      device === 'Laptop/Desktop'
    ) {
      return 'LINUX_DESKTOP';
    }

    if (device === 'Mobile') {
      return 'MOBILE_USER';
    }

    if (device === 'Tablet') {
      return 'TABLET_USER';
    }

    return 'GENERAL_DESKTOP';
  }


  async function recordLiveDataEvent(input = {}) {
    if (!enabled) return null;

    if (
      !input.sessionId ||
      !input.userId ||
      !input.file?.id
    ) {
      return null;
    }

    const action =
      input.action === 'SEND'
        ? 'SEND'
        : 'RECEIVE';

    // Required DBA 802 classroom telemetry.
    // These limited operational/device attributes are recorded
    // for teaching and aggregate product analysis.
    // Personalization and marketing consent remain separate.
    const client =
      input.clientInfo || {};

    const network =
      input.network || {};

    const file =
      input.file || {};

    const result =
      await pool.query(
        `INSERT INTO classroom_data_events (
           id,
           session_id,
           user_id,
           room_code,
           action,
           file_id,
           file_type,
           file_size_bytes,
           browser,
           os,
           device_type,
           timezone,
           country,
           region,
           commercial_segment
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           $10,$11,$12,$13,$14,$15
         )
         ON CONFLICT (
           session_id,
           user_id,
           file_id,
           action
         )
         DO NOTHING
         RETURNING *`,
        [
          crypto.randomUUID(),
          input.sessionId,
          input.userId,
          clean(
            input.roomCode,
            12
          ).toUpperCase(),
          action,
          clean(file.id, 36),
          classroomFileType(file),
          Math.round(
            safeNumber(
              file.size,
              104857600
            )
          ),
          clean(client.browser, 80),
          clean(client.os, 80),
          clean(client.deviceType, 40),
          clean(client.timezone, 80),
          clean(network.country, 80),
          clean(network.region, 120),
          classroomSegment(client)
        ]
      );

    return result.rows[0] || null;
  }


  async function liveClassroomData(input = {}) {
    const allHistory =
      input.allHistory === true;

    if (!enabled) {
      return {
        summary: {},
        insights: {},
        rows: []
      };
    }

    const roomCode =
      clean(
        input.roomCode,
        12
      ).toUpperCase();

    if (!allHistory && !roomCode) {
      return {
        summary: {},
        insights: {},
        rows: []
      };
    }

    const limit =
      allHistory
        ? null
        : Math.max(
            1,
            Math.min(
              500,
              Number(input.limit) || 250
            )
          );

    const result =
      await pool.query(
        `SELECT
           e.user_id,
           u.name,

           e.session_id,
           e.room_code,
           e.action,
           e.file_type,
           e.file_size_bytes,
           e.created_at,

           COALESCE(
             c.analytics_consent,
             FALSE
           ) AS analytics_consent,

           COALESCE(
             NULLIF(e.browser, ''),
             cp.browser,
             ''
           ) AS browser,

           COALESCE(
             NULLIF(e.os, ''),
             cp.os,
             ''
           ) AS os,

           COALESCE(
             NULLIF(
               e.device_type,
               ''
             ),
             cp.device_type,
             ''
           ) AS device_type,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               NULLIF(
                 e.timezone,
                 ''
               ),
               cp.timezone,
               ''
             )
             ELSE ''
           END AS timezone,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.language,
               ''
             )
             ELSE ''
           END AS language,

           COALESCE(
             NULLIF(
               e.country,
               ''
             ),
             cp.country,
             ''
           ) AS country,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               NULLIF(
                 e.region,
                 ''
               ),
               cp.region,
               ''
             )
             ELSE ''
           END AS region,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.screen_category,
               ''
             )
             ELSE ''
           END AS screen_category,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN cp.touch_capable
             ELSE NULL
           END AS touch_capable,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.memory_tier,
               ''
             )
             ELSE ''
           END AS memory_tier,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.cpu_tier,
               ''
             )
             ELSE ''
           END AS cpu_tier,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.referrer_host,
               ''
             )
             ELSE ''
           END AS referrer_host,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.landing_path,
               ''
             )
             ELSE ''
           END AS landing_path,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.utm_source,
               ''
             )
             ELSE ''
           END AS utm_source,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.utm_medium,
               ''
             )
             ELSE ''
           END AS utm_medium,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.utm_campaign,
               ''
             )
             ELSE ''
           END AS utm_campaign,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.visit_count,
               0
             )
             ELSE 0
           END AS visit_count,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.total_transfers,
               0
             )
             ELSE 0
           END AS total_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.total_bytes,
               0
             )
             ELSE 0
           END AS total_bytes,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.image_transfers,
               0
             )
             ELSE 0
           END AS image_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.video_transfers,
               0
             )
             ELSE 0
           END AS video_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.pdf_transfers,
               0
             )
             ELSE 0
           END AS pdf_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.document_transfers,
               0
             )
             ELSE 0
           END AS document_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.other_transfers,
               0
             )
             ELSE 0
           END AS other_transfers,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.device_segment,
               ''
             )
             ELSE ''
           END AS device_segment,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.usage_segment,
               ''
             )
             ELSE ''
           END AS usage_segment,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN COALESCE(
               cp.content_segment,
               ''
             )
             ELSE ''
           END AS content_segment,

           COALESCE(
             NULLIF(
               e.commercial_segment,
               'NOT_OPTED_IN'
             ),
             NULLIF(
               cp.device_segment,
               ''
             ),
             ''
           ) AS commercial_segment,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN cp.first_seen_at
             ELSE NULL
           END AS first_seen_at,

           CASE
             WHEN COALESCE(
               c.analytics_consent,
               FALSE
             )
             THEN cp.last_seen_at
             ELSE NULL
           END AS last_seen_at,

           participant.joined_at,
           participant.left_at,

           transfer.result
             AS transfer_result,

           transfer.trigger
             AS transfer_trigger,

           transfer.latency_ms,
           transfer.speed_mbps,
           transfer.duration_sec,
           transfer.acceptance_latency_sec,
           transfer.gesture_confidence,
           transfer.integrity_verified,
           transfer.retries

         FROM classroom_data_events e

         JOIN users u
           ON u.id = e.user_id

         LEFT JOIN consent_preferences c
           ON c.user_id = e.user_id

         LEFT JOIN commercial_profiles cp
           ON cp.user_id = e.user_id
          AND COALESCE(
                c.analytics_consent,
                FALSE
              ) = TRUE

         LEFT JOIN LATERAL (
           SELECT
             p.joined_at,
             p.left_at

           FROM session_participants p

           WHERE
             p.session_id =
               e.session_id

             AND p.user_id =
               e.user_id

           ORDER BY
             p.updated_at DESC

           LIMIT 1
         ) participant
           ON TRUE

         LEFT JOIN LATERAL (
           SELECT
             t.result,
             t.trigger,
             t.latency_ms,
             t.speed_mbps,
             t.duration_sec,
             t.acceptance_latency_sec,
             t.gesture_confidence,
             t.integrity_verified,
             t.retries

           FROM transfer_events t

           WHERE
             t.session_id =
               e.session_id

             AND t.user_id =
               e.user_id

             AND t.file_id =
               e.file_id

           ORDER BY
             t.created_at DESC

           LIMIT 1
         ) transfer
           ON TRUE

         WHERE
           (
             $1 = ''
             OR e.room_code = $1
           )

         ORDER BY
           e.created_at DESC

         LIMIT $2`,
        [
          roomCode,
          limit
        ]
      );


    const rows =
      result.rows || [];


    const audienceMap =
      new Map();

    for (const row of rows) {
      const key =
        String(
          row.user_id
        );

      if (!audienceMap.has(key)) {
        audienceMap.set(
          key,
          row
        );
      }
    }


    const audience =
      [...audienceMap.values()];


    const optedAudience =
      audience;


    const commercialRows =
      rows;


    const segmentCounts = {};

    for (
      const row
      of optedAudience
    ) {
      const segment =
        row.commercial_segment ||
        row.device_segment ||
        'GENERAL';

      segmentCounts[segment] =
        (
          segmentCounts[segment] ||
          0
        ) + 1;
    }


    const percentage =
      (count) =>
        optedAudience.length
          ? Math.round(
              (
                count /
                optedAudience.length
              ) *
              1000
            ) / 10
          : 0;


    const appleUsers =
      optedAudience.filter(
        (row) =>
          String(
            row.device_segment ||
            row.commercial_segment ||
            ''
          ).startsWith(
            'APPLE_'
          )
      ).length;


    const windowsUsers =
      optedAudience.filter(
        (row) =>
          (
            row.device_segment ||
            row.commercial_segment
          ) ===
          'WINDOWS_DESKTOP'
      ).length;


    const mobileUsers =
      optedAudience.filter(
        (row) =>
          [
            'APPLE_MOBILE',
            'ANDROID_MOBILE',
            'MOBILE_USER',
            'TABLET_USER'
          ].includes(
            row.device_segment ||
            row.commercial_segment
          )
      ).length;


    const fileMix = {
      IMAGE: 0,
      PDF: 0,
      VIDEO: 0,
      DOCUMENT: 0,
      OTHER: 0
    };


    for (
      const row
      of commercialRows
    ) {
      const type =
        Object.prototype
          .hasOwnProperty.call(
            fileMix,
            row.file_type
          )
          ? row.file_type
          : 'OTHER';

      fileMix[type] += 1;
    }


    return {
      generatedAt:
        new Date().toISOString(),

      roomCode:
        allHistory
          ? 'ALL_HISTORY'
          : roomCode,

      summary: {
        totalUsers:
          audience.length,

        commercialAudience:
          optedAudience.length,

        totalEvents:
          rows.length,

        sendEvents:
          rows.filter(
            (row) =>
              row.action === 'SEND'
          ).length,

        receiveEvents:
          rows.filter(
            (row) =>
              row.action === 'RECEIVE'
          ).length,

        totalBytes:
          rows.reduce(
            (sum, row) =>
              sum +
              Number(
                row.file_size_bytes ||
                0
              ),
            0
          )
      },


      insights: {
        applePct:
          percentage(
            appleUsers
          ),

        windowsPct:
          percentage(
            windowsUsers
          ),

        mobilePct:
          percentage(
            mobileUsers
          ),

        segments:
          segmentCounts,

        fileMix
      },


      rows:
        rows.map(
          (row) => ({
            time:
              row.created_at,

            student:
              row.name,

            room:
              row.room_code,

            action:
              row.action,

            fileType:
              row.file_type,

            fileSizeBytes:
              Number(
                row.file_size_bytes ||
                0
              ),

            result:
              row.action === 'SEND'
                ? 'SENT'
                : (
                    row.transfer_result ||
                    'SUCCESS'
                  ),

            trigger:
              row.transfer_trigger ||
              '',

            latencyMs:
              Number(
                row.latency_ms ||
                0
              ),

            speedMbps:
              Number(
                row.speed_mbps ||
                0
              ),

            durationSec:
              Number(
                row.duration_sec ||
                0
              ),

            acceptanceLatencySec:
              Number(
                row.acceptance_latency_sec ||
                0
              ),

            gestureConfidence:
              Number(
                row.gesture_confidence ||
                0
              ),

            integrityVerified:
              row.integrity_verified ===
              true,

            retries:
              Number(
                row.retries ||
                0
              ),

            device:
              row.device_type,

            os:
              row.os,

            browser:
              row.browser,

            timezone:
              row.timezone,

            language:
              row.language,

            country:
              row.country,

            region:
              row.region,

            screenCategory:
              row.screen_category,

            touchCapable:
              row.touch_capable,

            memoryTier:
              row.memory_tier,

            cpuTier:
              row.cpu_tier,

            referrerHost:
              row.referrer_host,

            landingPath:
              row.landing_path,

            utmSource:
              row.utm_source,

            utmMedium:
              row.utm_medium,

            utmCampaign:
              row.utm_campaign,

            visitCount:
              Number(
                row.visit_count ||
                0
              ),

            totalTransfers:
              Number(
                row.total_transfers ||
                0
              ),

            totalBytes:
              Number(
                row.total_bytes ||
                0
              ),

            imageTransfers:
              Number(
                row.image_transfers ||
                0
              ),

            videoTransfers:
              Number(
                row.video_transfers ||
                0
              ),

            pdfTransfers:
              Number(
                row.pdf_transfers ||
                0
              ),

            documentTransfers:
              Number(
                row.document_transfers ||
                0
              ),

            otherTransfers:
              Number(
                row.other_transfers ||
                0
              ),

            deviceSegment:
              row.device_segment,

            usageSegment:
              row.usage_segment,

            contentSegment:
              row.content_segment,

            commercialSegment:
              row.commercial_segment,

            analyticsConsent:
              row.analytics_consent ===
              true,

            firstSeenAt:
              row.first_seen_at,

            lastSeenAt:
              row.last_seen_at,

            joinedAt:
              row.joined_at,

            leftAt:
              row.left_at
          })
        )
    };
  }


  async function dashboardData(input = {}) {
    if (!enabled) {
      return {
        summary: {},
        users: [],
        commercialProfiles: [],
        consentPreferences: [],
        consentEvents: [],
        transferEvents: [],
        governanceRegistry: [],
        recommendationEvents: [],
        conversionEvents: []
      };
    }

    const requestedLimit =
      Number(input.limit) || 250;

    const limit =
      Math.max(
        1,
        Math.min(1000, requestedLimit)
      );

    const [
      summaryResult,
      usersResult,
      profilesResult,
      consentResult,
      consentEventsResult,
      transfersResult,
      governanceResult,
      recommendationsResult,
      conversionsResult
    ] = await Promise.all([

      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users)
            AS users,

          (SELECT COUNT(*)::int FROM class_sessions)
            AS class_sessions,

          (SELECT COUNT(*)::int FROM session_participants)
            AS participants,

          (SELECT COUNT(*)::int FROM transfer_events)
            AS transfer_events,

          (SELECT COUNT(*)::int FROM commercial_profiles)
            AS commercial_profiles,

          (SELECT COUNT(*)::int FROM consent_preferences)
            AS consent_preferences,

          (SELECT COUNT(*)::int FROM consent_events)
            AS consent_events,

          (SELECT COUNT(*)::int FROM recommendation_events)
            AS recommendation_events,

          (SELECT COUNT(*)::int FROM conversion_events)
            AS conversion_events
      `),

      pool.query(
        `SELECT
           id,
           name,
           email,
           created_at,
           last_login_at,
           updated_at
         FROM users
         ORDER BY last_login_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           u.name,
           u.email,
           cp.first_seen_at,
           cp.last_seen_at,
           cp.visit_count,
           cp.country,
           cp.region,
           cp.timezone,
           cp.language,
           cp.browser,
           cp.os,
           cp.device_type,
           cp.screen_category,
           cp.touch_capable,
           cp.memory_tier,
           cp.cpu_tier,
           cp.referrer_host,
           cp.landing_path,
           cp.utm_source,
           cp.utm_medium,
           cp.utm_campaign,
           cp.total_transfers,
           cp.total_bytes,
           cp.image_transfers,
           cp.video_transfers,
           cp.pdf_transfers,
           cp.document_transfers,
           cp.other_transfers,
           cp.device_segment,
           cp.usage_segment,
           cp.content_segment,
           cp.updated_at
         FROM commercial_profiles cp
         JOIN users u
           ON u.id = cp.user_id
         ORDER BY cp.updated_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           u.name,
           u.email,
           c.analytics_consent,
           c.personalization_consent,
           c.marketing_consent,
           c.policy_version,
           c.updated_at
         FROM consent_preferences c
         JOIN users u
           ON u.id = c.user_id
         ORDER BY c.updated_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           ce.id,
           u.name,
           u.email,
           ce.analytics_consent,
           ce.personalization_consent,
           ce.marketing_consent,
           ce.source,
           ce.policy_version,
           ce.created_at
         FROM consent_events ce
         JOIN users u
           ON u.id = ce.user_id
         ORDER BY ce.created_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           te.id,
           u.name,
           u.email,
           te.receiver_id,
           te.room_code,
           te.result,
           te.trigger,
           te.file_name,
           te.file_type,
           te.file_size_bytes,
           te.latency_ms,
           te.speed_mbps,
           te.duration_sec,
           te.acceptance_latency_sec,
           te.integrity_verified,
           te.retries,
           te.browser,
           te.os,
           te.device_type,
           te.timezone,
           te.masked_ip,
           te.location,
           te.provider,
           te.created_at
         FROM transfer_events te
         JOIN users u
           ON u.id = te.user_id
         ORDER BY te.created_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           data_field,
           purpose,
           source,
           data_owner,
           sensitivity,
           retention_days,
           commercial_allowed,
           notes,
           updated_at
         FROM data_governance_registry
         ORDER BY data_field ASC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           re.id,
           u.name,
           u.email,
           re.commercial_segment,
           re.recommendation_category,
           re.campaign_id,
           re.action,
           re.created_at
         FROM recommendation_events re
         JOIN users u
           ON u.id = re.user_id
         ORDER BY re.created_at DESC
         LIMIT $1`,
        [limit]
      ),

      pool.query(
        `SELECT
           ce.id,
           u.name,
           u.email,
           ce.recommendation_id,
           ce.conversion_type,
           ce.value_amount,
           ce.currency,
           ce.created_at
         FROM conversion_events ce
         JOIN users u
           ON u.id = ce.user_id
         ORDER BY ce.created_at DESC
         LIMIT $1`,
        [limit]
      )
    ]);

    const row =
      summaryResult.rows[0] || {};

    return {
      generatedAt:
        new Date().toISOString(),

      limit,

      summary: {
        users:
          Number(row.users || 0),

        classSessions:
          Number(row.class_sessions || 0),

        participants:
          Number(row.participants || 0),

        transferEvents:
          Number(row.transfer_events || 0),

        commercialProfiles:
          Number(row.commercial_profiles || 0),

        consentPreferences:
          Number(row.consent_preferences || 0),

        consentEvents:
          Number(row.consent_events || 0),

        recommendationEvents:
          Number(row.recommendation_events || 0),

        conversionEvents:
          Number(row.conversion_events || 0)
      },

      users:
        usersResult.rows,

      commercialProfiles:
        profilesResult.rows,

      consentPreferences:
        consentResult.rows,

      consentEvents:
        consentEventsResult.rows,

      transferEvents:
        transfersResult.rows,

      governanceRegistry:
        governanceResult.rows,

      recommendationEvents:
        recommendationsResult.rows,

      conversionEvents:
        conversionsResult.rows
    };
  }


  async function close() {
    if (!pool) return;

    ready = false;
    await pool.end();
  }

  return {
    enabled,
    pool,
    status,
    initialize,
    upsertUser,
    createClassSession,
    upsertParticipant,
    markParticipantLeft,
    recordTransferEvent,
    getConsentPreferences,
    saveConsentPreferences,
    upsertCommercialProfile,
    recordCommercialTransfer,
    findLatestReceiverSession,
    endClassSession,
    summary,
    recordLiveDataEvent,
    liveClassroomData,
    dashboardData,
    close
  };
}

module.exports = {
  createDatabase,
  resolveConnectionString
};
