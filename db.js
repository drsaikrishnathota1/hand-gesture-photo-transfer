const { Pool } = require('pg');

function resolveConnectionString(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'connectionString')) {
    return String(options.connectionString || '').trim();
  }

  // Tests never touch the production database unless explicitly requested.
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
        ON class_sessions (
          room_code,
          started_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_session_participants_session
        ON session_participants (
          session_id,
          joined_at
        );

      CREATE INDEX IF NOT EXISTS idx_transfer_events_user
        ON transfer_events (
          user_id,
          created_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_transfer_events_session
        ON transfer_events (
          session_id,
          created_at DESC
        );
    `);

    ready = true;
    return status();
  }

  async function upsertUser(user = {}) {
    if (!enabled) return null;

    const googleSub = clean(
      user.googleSub,
      255
    );

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
       VALUES (
         $1, $2, $3, $4,
         NOW(), NOW()
       )
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
       RETURNING
         id,
         google_sub,
         name,
         email,
         picture_url,
         created_at,
         last_login_at`,
      [
        googleSub,
        clean(user.name, 120),
        clean(user.email, 180),
        clean(user.picture, 500)
      ]
    );

    return result.rows[0] || null;
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
    close
  };
}

module.exports = {
  createDatabase,
  resolveConnectionString
};
