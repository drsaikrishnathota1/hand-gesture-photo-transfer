
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html =
  fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'public',
      'intelligence.html'
    ),
    'utf8'
  );

const js =
  fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'public',
      'intelligence.js'
    ),
    'utf8'
  );

test(
  'marketplace V2 adds product discovery tools',
  () => {

    assert.match(
      html,
      /productSearchV2/
    );

    assert.match(
      html,
      /Surprise Me/
    );

    assert.match(
      html,
      /Compare Selected/
    );

    assert.match(
      js,
      /PRODUCT_BRANDS_V2/
    );

    assert.match(
      js,
      /hypothesis score/
    );
  }
);
