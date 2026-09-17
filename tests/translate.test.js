'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { translateText, normalizeLang } = require('../src/translate');

test('translate stub wraps text when TRANSLATE_API_KEY=test', async () => {
  const prev = process.env.TRANSLATE_API_KEY;
  const env = process.env.NODE_ENV;
  process.env.TRANSLATE_API_KEY = 'test';
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(await translateText('Hello', 'en', 'my'), '[my] Hello');
    assert.equal(await translateText('Hello', 'en', 'en'), 'Hello');
  } finally {
    process.env.TRANSLATE_API_KEY = prev;
    process.env.NODE_ENV = env;
  }
});

test('translate degrades to null in tests without a stub key', async () => {
  const prev = process.env.TRANSLATE_API_KEY;
  process.env.TRANSLATE_API_KEY = '';
  try {
    assert.equal(await translateText('Hello', 'en', 'ja'), null);
  } finally {
    process.env.TRANSLATE_API_KEY = prev;
  }
});

test('normalizeLang maps supported UI languages', () => {
  assert.equal(normalizeLang('MY'), 'my');
  assert.equal(normalizeLang('zh-CN'), 'zh');
  assert.equal(normalizeLang('fr'), null);
});
