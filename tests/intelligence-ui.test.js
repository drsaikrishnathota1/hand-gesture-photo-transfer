'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'intelligence.html'), 'utf8');
const utils = require('../public/intelligence-utils');

test('intelligence UI removes confusing duplicate and internal-only sections', () => {
  assert.doesNotMatch(html, /LIVE ANALYTICS/i);
  assert.doesNotMatch(html, /What Changed\?/i);
  assert.doesNotMatch(html, /PRODUCT\s*×\s*AUDIENCE/i);
  assert.doesNotMatch(html, /STRATEGIC DECISION CENTER/i);
  assert.doesNotMatch(html, /OPENAI_API_KEY/i);
  assert.doesNotMatch(html, /Evidence index/i);
});

test('intelligence UI keeps a clear dashboard and AI strategy mode', () => {
  assert.match(html, /Analytics Dashboard/);
  assert.match(html, /AI Strategy/);
  assert.match(html, /Three questions management can act on/);
  assert.match(html, /Commercial test ideas/);
  assert.match(html, /Google Search or Instagram \/ Meta\?/);
});

test('display helpers clean dirty device and browser labels without changing database values', () => {
  assert.equal(utils.prettyDevice('Lap op/Desk op'), 'Laptop/Desktop');
  assert.equal(utils.prettyBrowser('Ch ome'), 'Chrome');
  assert.equal(utils.prettySegment('WINDOWS_DESKTOP'), 'Windows Desktop');
  assert.equal(utils.prettyOs('iOS/iPadOS'), 'iOS / iPadOS');
});

test('location and UTC time labels are beginner friendly', () => {
  assert.equal(utils.prettyLocation('New York, New York, United States'), 'New York, NY');
  assert.equal(utils.prettyLocation('Township of Boone, Missouri, United States of America (the)'), 'Boone Township, MO');
  assert.equal(utils.prettyHourUtc('14:00'), '2:00 PM UTC');
});
