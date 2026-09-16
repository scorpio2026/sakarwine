'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { messageFilterError, isForbiddenVideo, isAllowedImageMime } = require('../src/filters');

test('blocks messages that start with @', () => {
  assert.equal(messageFilterError('@admin'), 'Messages cannot start with @.');
  assert.equal(messageFilterError('  @hi'), 'Messages cannot start with @.');
});

test('blocks Myanmar numbers starting with 09', () => {
  assert.match(messageFilterError('call me 0912345678'), /09/);
  assert.match(messageFilterError('09-123-456-789'), /09/);
  assert.equal(messageFilterError('hello from the wine lounge'), null);
});

test('rejects empty text', () => {
  assert.ok(messageFilterError(''));
});

test('allows images and forbids typical video files', () => {
  assert.equal(isAllowedImageMime('image/jpeg'), true);
  assert.equal(isForbiddenVideo('video/mp4', 'clip.mp4'), true);
  assert.equal(isForbiddenVideo('audio/webm', 'voice.webm'), false);
  assert.equal(isForbiddenVideo('video/webm', 'voice.webm'), false);
});
