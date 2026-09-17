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
  assert.equal(I18n.t('helpTitle'), 'အကူအညီ');
  assert.equal(I18n.t('pinRecovery'), 'PIN ပြန်ရယူခြင်း');
  assert.equal(
    I18n.t('pinRecoveryBodyMy'),
    'ကိုယ်တိုင် ပြန်သတ်မှတ်၍ မရပါ။ မှတ်ပုံတင်စဉ် သုံးသော ဖုန်းနံပါတ်ကို sakarwine အက်ဒမင်ထံ ပေးပါ။ စစ်ဆေးပြီး PIN ၆ လုံး အသစ် သတ်မှတ်ပေးမည်။'
  );
  assert.equal(
    I18n.t('pinRecoveryBodyEn'),
    'Message the sakarwine admin with the phone number you used at registration. There is no self-serve password reset.'
  );
  assert.equal(I18n.t('backHome'), 'မူလစာမျက်နှာ');
  assert.equal(I18n.error('Wrong username or password.'), I18n.t('errWrongLogin'));
});
