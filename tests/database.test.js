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
