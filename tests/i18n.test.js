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
  assert.match(css, /\.logo-aura\s*\{/);
  assert.match(css, /@keyframes logo-drift/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /#ff8a3d/);
  assert.match(css, /#ff4ecd/);
  assert.match(css, /#8b5cff/);
  assert.match(css, /#3d7eff/);
  assert.match(css, /\.user-row\.gender-male\s*\{[^}]*#2563eb/);
  assert.match(css, /\.user-row\.gender-female\s*\{[^}]*#ec4899/);
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(js, /logo-aura/);
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

test('admin dashboard paints paid accounts green and badges extra upgrades', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/admin.css'), 'utf8');
  assert.match(css, /tr\.paid-active td\s*\{[^}]*#bbf7d0/);
  assert.match(css, /\.extra-upgrade-badge/);
  const js = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
  assert.match(js, /a\.paidActive \? 'paid-active'/);
  assert.match(js, /u\.paidActive \? ' paid-active'/);
  assert.match(js, /u\.extraUpgrade/);
  assert.equal(js.includes('extra-upgrade-badge'), true);
});

test('admin-badge chats block first contact and expose a live gate', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(js, /socket\.on\('chat:gate'/);
  assert.match(js, /errAdminFirst|Admin account/);
  assert.match(js, /waitAdminFirst/);
  assert.match(js, /toggle-msg/);
  I18n.setLang('en');
  assert.equal(I18n.error('You cannot start a chat with an Admin account.'), I18n.t('errAdminFirst'));
  assert.equal(I18n.error('Wait for the admin to send a message first.'), I18n.t('waitAdminFirst'));
  assert.equal(I18n.error('This chat is closed by admin.'), I18n.t('chatClosedByAdmin'));
});

test('bottom nav is Help-only; Me stays reachable from the header', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const navSlice = js.slice(js.indexOf('function nav('), js.indexOf('function bindNav('));
  assert.match(navSlice, /nav-help-only/);
  assert.match(navSlice, /data-go="help"/);
  assert.equal(navSlice.includes('data-go="people"'), false);
  assert.equal(navSlice.includes('data-go="upgrade"'), false);
  assert.equal(navSlice.includes('data-go="profile"'), false);
  assert.equal(navSlice.includes('navPeople'), false);
  assert.equal(navSlice.includes('navUpgrade'), false);
  assert.match(js, /function meBtnHtml/);
  assert.match(js, /id="goto-me"/);
  assert.match(js, /id="up-back"/);
  assert.match(js, /id="me-back"/);
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert.match(css, /\.nav\.nav-help-only\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('settings PIN change is translated and separate from Help recovery', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(js, /function showChangePin/);
  assert.match(js, /\/api\/me\/pin/);
  assert.match(js, /go-pin/);
  assert.match(js, /function showHelp/);
  assert.match(js, /pin-recovery-form/);
  I18n.setLang('en');
  assert.equal(I18n.t('changePin'), 'Change PIN');
  assert.equal(I18n.t('currentPin'), 'Current PIN');
  assert.equal(I18n.error('Current PIN is wrong.'), I18n.t('errWrongPin'));
  assert.equal(I18n.error('New PIN and confirmation do not match.'), I18n.t('errPinMismatch'));
  I18n.setLang('my');
  assert.equal(I18n.t('changePin'), 'PIN ပြောင်းရန်');
});
