const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeGoogleUser } = require('../auth');

test('Google user identity keeps only required verified profile fields', () => {
  const user = sanitizeGoogleUser({
    sub: '123456789',
    name: 'DBA Student',
    email: 'student@example.com',
    email_verified: true,
    picture: 'https://example.com/student.jpg'
  });

  assert.equal(user.googleSub, '123456789');
  assert.equal(user.name, 'DBA Student');
  assert.equal(user.email, 'student@example.com');
  assert.equal(user.picture, 'https://example.com/student.jpg');
});

test('Google identity requires a stable Google subject identifier', () => {
  assert.throws(() => sanitizeGoogleUser({
    email: 'student@example.com',
    email_verified: true
  }));
});

const fs = require('node:fs');
const path = require('node:path');

test('V5.3 UI contains the official Google identity login gate', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8'
  );

  assert.match(html, /id="authGate"/);
  assert.match(html, /accounts\.google\.com\/gsi\/client/);
  assert.match(html, /auth-client\.js/);
  assert.match(html, /id="googleSignInButton"/);
  assert.match(html, /id="logoutBtn"/);
});

test('V5.3 browser authentication sends Google credential to the server', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'auth-client.js'),
    'utf8'
  );

  assert.match(js, /google\.accounts\.id\.initialize/);
  assert.match(js, /google\.accounts\.id\.renderButton/);
  assert.match(js, /\/api\/auth\/google/);
  assert.match(js, /\/api\/auth\/me/);
  assert.match(js, /\/api\/auth\/logout/);
});
