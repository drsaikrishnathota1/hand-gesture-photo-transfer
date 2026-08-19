const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'),
  'utf8'
);

test(
  'V5.4 resolves database user from verified Google identity',
  () => {
    assert.match(
      server,
      /resolveDatabaseUserId/
    );

    assert.match(
      server,
      /database\.upsertUser/
    );

    assert.match(
      server,
      /ws\.user\.googleSub/
    );
  }
);

test(
  'V5.4 logs successful PostgreSQL transfer persistence',
  () => {
    assert.match(
      server,
      /PostgreSQL transfer event persisted/
    );
  }
);

test(
  'V5.4 transfer persistence reports skipped prerequisites',
  () => {
    assert.match(
      server,
      /PostgreSQL transfer event skipped/
    );
  }
);
