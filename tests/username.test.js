'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usernameError, USERNAME_RE } = require('../src/username');

test('usernames allow English or Myanmar letters and digits up to 12', () => {
  assert.equal(usernameError('KoKo12'), null);
  assert.equal(usernameError('မောင်မောင်'), null);
  assert.equal(usernameError('သ1'), null);
  assert.equal(usernameError('A'), null);
  assert.ok(USERNAME_RE.test('abcdefghijkl'));
});

test('usernames reject symbols, spaces, underscore, and over-length', () => {
  assert.ok(usernameError('seta_new'));
  assert.ok(usernameError('hello world'));
  assert.ok(usernameError('name@me'));
  assert.ok(usernameError('abcdefghijklm'));
  assert.ok(usernameError(''));
  assert.ok(usernameError('  '));
});
