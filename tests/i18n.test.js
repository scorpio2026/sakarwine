'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../public/js/i18n.js');

test('i18n catalogs share the same keys and default to Myanmar', () => {
  const codes = I18n.LANGS.map((l) => l.code);
  assert.deepEqual(codes, ['my', 'en', 'th', 'zh', 'ko', 'ja']);
  const enKeys = Object.keys(I18n.catalogs.en).sort();
  assert.ok(enKeys.includes('enterLounge'));
  assert.ok(enKeys.includes('settingsTitle'));
  assert.ok(enKeys.includes('language'));
  for (const code of codes) {
    assert.deepEqual(Object.keys(I18n.catalogs[code]).sort(), enKeys, `${code} missing keys`);
  }
  I18n.setLang('en');
  assert.equal(I18n.t('enterLounge'), 'Enter lounge');
  I18n.setLang('my');
  assert.equal(I18n.lang, 'my');
  assert.notEqual(I18n.t('enterLounge'), 'Enter lounge');
  assert.equal(I18n.error('Wrong username or password.'), I18n.t('errWrongLogin'));
});
