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

      CREATE INDEX IF NOT EXISTS idx_class_sessions_room
        ON class_sessions (room_code, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_session_participants_session
        ON session_participants (session_id, joined_at);

      CREATE INDEX IF NOT EXISTS idx_transfer_events_user
        ON transfer_events (user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_transfer_events_session
        ON transfer_events (session_id, created_at DESC);
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
    endClassSession,
    summary,
    close
  };
}

module.exports = {
  createDatabase,
  resolveConnectionString
};
