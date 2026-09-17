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
  assert.equal(I18n.t('upgradePromoTitle'), 'Upgrade and save up to 50%');
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

test('masthead wordmark is unfilled and home rows use gender frames', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert.match(css, /\.app-masthead\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.masthead-logo\s*\{[^}]*background-color:\s*transparent/);
  assert.match(css, /\.user-row\.gender-male\s*\{[^}]*#2563eb/);
  assert.match(css, /\.user-row\.gender-female\s*\{[^}]*#ec4899/);
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(js, /gender-female/);
  assert.match(js, /gender-male/);
  assert.match(js, /function showHelp/);
  assert.match(js, /pin-recovery-form/);
  assert.match(js, /back-home-btn/);
  assert.match(js, /function showRegister/);
  assert.equal(js.includes('nrcFront'), true);
  const registerSlice = js.slice(js.indexOf('function showRegister'), js.indexOf('function showScan'));
  assert.equal(registerSlice.includes('nrcFront'), false);
  assert.match(js, /settingsRow\('go-host'/);
  assert.match(js, /upgrade-promo/);
  assert.equal(js.includes('hostCreditBanner'), false);
  assert.equal(js.includes('formatChatMs'), false);
  assert.match(js, /id="host-code"/);
  assert.match(js, /t\('optional'\)/);
  assert.match(js, /hostCode && !\/\^\\d\{8\}\$\/\.test\(hostCode\)/);
  I18n.setLang('en');
  assert.equal(I18n.t('optional'), 'optional');
  assert.match(I18n.t('hostCodeHelp'), /Optional/i);
  assert.equal(I18n.t('errHostCode'), 'Enter a valid host code.');
});
