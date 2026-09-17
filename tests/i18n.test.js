'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../public/js/i18n-pack.js');

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
  assert.equal(I18n.t('enterLounge'), 'Login');
  assert.equal(I18n.t('upgradePromoTitle'), 'Upgrade and save up to 50%');
  I18n.setLang('my');
  assert.equal(I18n.lang, 'my');
  assert.equal(I18n.t('enterLounge'), 'အကောင့်ဝင်ရန်');
  I18n.setLang('th');
  assert.equal(I18n.t('enterLounge'), 'เข้าสู่ระบบ');
  I18n.setLang('zh');
  assert.equal(I18n.t('enterLounge'), '登录');
  I18n.setLang('ko');
  assert.equal(I18n.t('enterLounge'), '로그인');
  I18n.setLang('ja');
  assert.equal(I18n.t('enterLounge'), 'ログイン');
  const bannedLoungeLogin = /enter lounge|under lounge|เข้าเลานจ์|进入会客厅|라운지 입장|ラウンジに入る/i;
  for (const code of codes) {
    assert.equal(bannedLoungeLogin.test(I18n.catalogs[code].enterLounge), false, `${code} enterLounge still mentions lounge`);
  }
  I18n.setLang('my');
  assert.notEqual(I18n.t('enterLounge'), 'Login');
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
  assert.match(css, /drop-shadow\(-1px -1\.5px 0 rgba\(255, 255, 255/);
  assert.match(css, /drop-shadow\(1px 1\.5px 0 rgba\(78, 18, 120/);
  assert.match(css, /@keyframes logo-drift/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /#ff8a3d/);
  assert.match(css, /#ff4ecd/);
  assert.match(css, /#8b5cff/);
  assert.match(css, /#3d7eff/);
  assert.match(css, /\.user-row\.gender-male\s*\{[^}]*#2563eb/);
  assert.match(css, /\.user-row\.gender-female\s*\{[^}]*#ec4899/);
  assert.match(css, /\.user-row\.gender-male\s*\{[^}]*border:\s*4px solid #2563eb/);
  assert.match(css, /\.user-row\.gender-female\s*\{[^}]*border:\s*4px solid #ec4899/);
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
  assert.match(js, /upgrade-promo-x/);
  assert.match(js, /afterRegister/);
  assert.match(js, /sw_upgrade_promo/);
  assert.equal(js.includes('hostCreditBanner'), false);
  assert.equal(js.includes('formatChatMs'), false);
  assert.match(js, /id="host-code"/);
  assert.match(js, /t\('optional'\)/);
  assert.match(js, /function incomeDemoBlock/);
  assert.match(js, /t\('howHostWorks'\)/);
  assert.match(js, /t\('hostIncomeHelp'\)/);
  assert.match(js, /t\('hostIncomeExample'\)/);
  assert.match(js, /host-guide-videos/);
  assert.match(js, /function bindHostGuideVideos/);
  assert.match(js, /host-guide-tab/);
  assert.match(js, /host-demo-apply\.mp4/);
  assert.match(js, /host-demo-code\.mp4/);
  assert.match(js, /host-demo-income\.mp4/);
  assert.equal(js.includes('income-host.mp4'), false);
  assert.equal(js.includes('income-video'), false);
  assert.match(css, /\.host-guide-videos/);
  assert.match(css, /\.host-guide-tabs/);
  assert.equal(css.includes('income-video'), false);
  assert.equal(css.includes('chat-demo'), false);
  assert.match(js, /class="settings-flow"/);
  assert.match(css, /\.settings-screen\s*\{[^}]*font-size:\s*0\.8rem/);
  assert.match(css, /\.settings-screen \.screen-body\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.settings-flow\s*\{/);
  assert.equal(js.includes('sampleChatOnly'), false);
  assert.equal(js.includes('visitedSample'), false);
  assert.equal(js.includes('demoHi'), false);
  assert.equal(js.includes('chat-demo'), false);
  assert.equal(js.includes('hostCredited'), false);
  assert.match(js, /hostCode && !\/\^\\d\{8\}\$\/\.test\(hostCode\)/);
  assert.match(js, /id="edit-bio"/);
  assert.match(js, /profile-bio/);
  assert.equal(js.includes('people-search'), false);
  assert.equal(js.includes('id="home-fab"'), false);
  assert.match(js, /gender-filter/);
  assert.match(js, /id-doc-filter/);
  assert.match(js, /data-id-type="nrc"/);
  assert.match(js, /data-id-type="passport"/);
  assert.match(js, /id="host-apply-send"/);
  assert.equal(js.includes('inc-occ'), false);
  assert.equal(js.includes('/api/me/income'), false);
  assert.equal(js.includes("t('occupation')"), false);
  assert.equal(js.includes("t('monthlyIncome')"), false);
  assert.equal(js.includes("t('incomeSource')"), false);
  I18n.setLang('en');
  assert.equal(I18n.t('hostApplyHelp').includes('income form'), false);
  assert.equal(I18n.t('hostDemoApply'), 'How to apply as host');
  assert.equal(I18n.t('hostDemoCode'), 'How to get your referral code');
  assert.equal(I18n.t('hostDemoIncome'), 'How income messages appear');
  I18n.setLang('my');
  assert.equal(I18n.t('hostDemoApply'), 'Host လျှောက်ပုံ');
  assert.equal(I18n.t('hostDemoCode'), 'ကုဒ် ယူပုံ');
  assert.equal(I18n.t('hostDemoIncome'), 'ဝင်ငွေရကြောင်း message ဝင်ပုံ');
  assert.equal(I18n.t('femaleHostBody').includes('income form'), false);
  assert.match(css, /\.id-doc-filter\s*\{/);
  assert.match(js, /data-gender="all"/);
  assert.match(js, /data-gender="male"/);
  assert.match(js, /data-gender="female"/);
  assert.match(css, /\.gender-filter\s*\{/);
  assert.match(css, /\.gender-chip/);
  I18n.setLang('en');
  assert.equal(I18n.t('filterAll'), 'All');
  assert.equal(I18n.t('idDocPassport'), 'Passport');
  assert.match(I18n.t('idDocPassportHelp'), /passport/i);
  assert.equal(I18n.t('optional'), 'optional');
  assert.match(I18n.t('hostCodeHelp'), /Optional/i);
  assert.match(I18n.t('hostCodeHelp'), /500 ×/);
  assert.match(I18n.t('hostRules'), /2 months → 1000/);
  assert.match(I18n.t('hostRules'), /12 months → 6000/);
  assert.match(I18n.t('hostIncomeHelp'), /optionally/i);
  assert.match(I18n.t('hostIncomeHelp'), /500 ×/);
  assert.equal(I18n.t('hostIncomeHelp').includes('chat time'), false);
  assert.equal(I18n.t('hostIncomeHelp').includes('visited'), false);
  assert.match(I18n.t('hostIncomeExample'), /12/);
  assert.match(I18n.t('hostIncomeExample'), /6000/);
  assert.match(I18n.t('hostCredited', { amount: 6000, months: 12 }), /6000/);
  assert.match(I18n.t('hostCredited', { amount: 6000, months: 12 }), /12/);
  assert.equal(I18n.t('errHostCode'), 'Enter a valid host code.');
  assert.equal(I18n.t('bio'), 'Bio');
  assert.match(I18n.t('bioHelp'), /280/);
  I18n.setLang('my');
  assert.equal(I18n.t('howHostWorks'), 'Host ဝင်ငွေ ဘယ်လိုရသလဲ');
  assert.match(I18n.t('hostIncomeHelp'), /ကုဒ်/);
  assert.match(I18n.t('hostIncomeExample'), /၆၀၀၀/);
  assert.equal(I18n.t('errBioRestricted'), 'ကန့်သတ်စာလုံးများ မရပါ။');
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
  assert.match(js, /admin-paid-remain/);
  assert.match(js, /setInterval\(paint, 1000\)/);
  assert.equal(js.includes('paidHoursLeft'), false);
  assert.equal(js.includes('function incomeLine'), false);
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

test('bottom nav has Home, Chat, Group, Profile, and Help — no Upgrade tab', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const navSlice = js.slice(js.indexOf('function nav('), js.indexOf('function bindNav('));
  assert.equal(navSlice.includes('nav-help-only'), false);
  assert.match(navSlice, /data-go="\$\{go\}"/);
  assert.match(navSlice, /tab\('home'/);
  assert.match(navSlice, /tab\('chats'/);
  assert.match(navSlice, /tab\('groups'/);
  assert.match(navSlice, /tab\('profile'/);
  assert.match(navSlice, /tab\('help'/);
  assert.equal(navSlice.includes("tab('people'"), false);
  assert.equal(navSlice.includes("tab('upgrade'"), false);
  assert.equal(navSlice.includes('data-go="upgrade"'), false);
  assert.match(navSlice, /navHome/);
  assert.match(navSlice, /navChat/);
  assert.match(navSlice, /navGroup/);
  assert.match(navSlice, /navProfile/);
  assert.match(navSlice, /navHelp/);
  assert.equal(navSlice.includes('navUpgrade'), false);
  assert.match(js, /function showInbox/);
  assert.match(js, /function showGroups/);
  assert.match(js, /function showDiscoverPreview/);
  assert.match(js, /\/api\/groups\/discover/);
  assert.match(js, /\/api\/conversations/);
  assert.match(js, /\/api\/groups/);
  assert.match(js, /function meBtnHtml/);
  assert.match(js, /id="goto-me"/);
  assert.match(js, /id="up-back"/);
  assert.match(js, /id="me-back"/);
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert.equal(css.includes('nav-help-only'), false);
  assert.match(css, /\.nav\s*\{[^}]*grid-template-columns:\s*repeat\(5/);
  I18n.setLang('en');
  assert.equal(I18n.t('navHome'), 'Home');
  assert.equal(I18n.t('navChat'), 'Chat');
  assert.equal(I18n.t('navProfile'), 'Profile');
  assert.equal(I18n.t('navHelp'), 'Help');
  assert.equal(I18n.t('navGroup'), 'Group');
  assert.equal(I18n.t('upgradeGift'), 'Gift');
  assert.equal(I18n.t('upgradeSelf'), 'Self');
  assert.equal(I18n.t('noChats'), 'No conversations yet.');
  assert.equal(I18n.t('paidHoursLeft', { hours: 48 }), '48 hours remaining');
  assert.equal(I18n.t('paidCountdown', { h: 12, m: '04', s: '09' }), '12h 04m 09s remaining');
  assert.match(js, /setInterval\(paint, 1000\)/);
  assert.match(js, /paidCountdown/);
  assert.equal(js.includes('paidHoursLeft'), false);
  assert.match(js, /function bindPaidRemain/);
  assert.match(js, /function paidStatusHtml/);
  assert.match(js, /class="paid-tick"/);
  assert.match(js, /id="paid-remain-pill"/);
  assert.match(js, /id="paid-remain"/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /function paidPillText/);
  assert.match(js, /async function showHome[\s\S]*?bindPaidRemain\(\);/);
  assert.match(js, /async function showInbox[\s\S]*?bindPaidRemain\(\);/);
  assert.match(js, /async function showProfile[\s\S]*?bindPaidRemain\(\);/);
  assert.match(js, /id="home-title">\$\{escapeHtml\(\(u && u\.username\) \|\| ''\)\}/);
  assert.equal(js.includes("id=\"home-title\">${t('contactsTitle')}"), false);
  const pillFn = js.slice(js.indexOf('function statusPill'), js.indexOf('function bindPaidRemain'));
  assert.equal(pillFn.includes('free24h'), false);
  assert.match(pillFn, /paid-remain-pill/);
  const paidPill = js.slice(js.indexOf('function paidPillText'), js.indexOf('function tickPaidRemain'));
  assert.equal(paidPill.includes('free24h'), false);
  assert.match(js, /function freeCountdownLabel/);
  assert.match(js, /freeUntil/);
  assert.match(js, /t\('freeCountdown'/);
  const remainFn = js.slice(js.indexOf('function formatRemain'), js.indexOf('function remainingPaidParts'));
  assert.equal(remainFn.includes('freeLeft'), false);
  assert.match(js, /state\.view === 'profile' \? u\.freeUntil/);
  I18n.setLang('en');
  assert.equal(I18n.t('freeCountdown', { h: 23, m: '01', s: '09' }), '23h 01m 09s free remaining');
  I18n.setLang('my');
  assert.match(I18n.t('freeCountdown', { h: 23, m: '01', s: '09' }), /အခမဲ့/);
  assert.match(css, /\.badge-lv\s*\{[^}]*font-size:\s*0\.7rem/);
  assert.match(css, /\.badge-lv\s*\{[^}]*padding:\s*2px 7px/);
  assert.match(css, /\.badge-lv\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.badge-lv\s*\{[^}]*neon-run/);
  assert.match(css, /\.badge-lv\s*\{[^}]*background-clip:\s*text/);
  assert.match(css, /\.badge-neon\s*\{[^}]*neon-run/);
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

test('UI language pack covers Saka rules, Help, errors, and does not translate the SAKARWINE wordmark', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  assert.match(html, /i18n-pack\.js/);
  assert.match(adminHtml, /i18n-pack\.js/);
  assert.match(html, /id="maintenance-screen"/);
  assert.match(html, /alt="SAKARWINE"/);
  assert.match(admin, /id="maint"/);
  assert.match(js, /function applyMaintenance/);
  assert.match(js, /<h1>SAKARWINE<\/h1>/);
  assert.match(js, /alt="SAKARWINE"/);
  assert.match(js, /t\('pinRecoveryBody'\)/);
  assert.equal(js.includes("t('pinRecoveryBodyMy')"), false);
  assert.match(js, /function chatBody/);
  assert.match(admin, /t\('createSpecialTitle'\)/);
  assert.match(admin, /t\('adminNoticeUpgrades'\)/);
  assert.match(admin, /t\('approveHost'\)/);
  const codes = I18n.LANGS.map((l) => l.code);
  for (const code of codes) {
    assert.ok(I18n.catalogs[code].sakaRules, `${code} missing sakaRules`);
    assert.ok(I18n.catalogs[code].sakaHostNotice, `${code} missing sakaHostNotice`);
    assert.ok(I18n.catalogs[code].sakaWelcome, `${code} missing sakaWelcome`);
    assert.ok(I18n.catalogs[code].maintenanceMsg, `${code} missing maintenanceMsg`);
    assert.equal(/SAKARWINE/.test(I18n.catalogs[code].maintenanceMsg), false, `${code} translated logo into maintenanceMsg`);
    assert.equal(/09/.test(I18n.catalogs[code].sakaRules), false, `${code} sakaRules mentions 09`);
    assert.equal(/@/.test(I18n.catalogs[code].sakaRules), false, `${code} sakaRules mentions @`);
    assert.equal(/09/.test(I18n.catalogs[code].sakaWelcome), false, `${code} sakaWelcome mentions 09`);
    assert.equal(/@/.test(I18n.catalogs[code].sakaWelcome), false, `${code} sakaWelcome mentions @`);
    assert.equal(/09/.test(I18n.catalogs[code].tourChat1), false, `${code} tourChat1 mentions 09`);
    assert.equal(/@/.test(I18n.catalogs[code].tourChat1), false, `${code} tourChat1 mentions @`);
    assert.equal(/09/.test(I18n.catalogs[code].bioHelp), false, `${code} bioHelp mentions 09`);
    assert.equal(/@/.test(I18n.catalogs[code].bioHelp), false, `${code} bioHelp mentions @`);
  }
  I18n.setLang('en');
  assert.equal(I18n.t('maintenanceMsg'), 'update server');
  assert.match(I18n.t('sakaWelcome', { name: 'Aung' }), /Aung/);
  assert.match(I18n.localizeChatBody('__SW__:rules'), /24 hours free/i);
  assert.match(I18n.localizeChatBody('__SW__:host'), /500/);
  const oldStored = [
    'Rules\n\nWithout upgrade\n• Each new chat has 24 hours free.\n• Photos stay locked until Level 3.\n• No 09 phone numbers; do not start a message with @. No video.\n\nIf you upgrade\n• Unlimited chatting for the paid period.',
    'စည်းကမ်း\n\nအဆင့်မမြှင့်ရသေးပါက\n• စကားပြောအသစ်တိုင်း အခမဲ့ ၂၄ နာရီသာ ရသည်။\n• 09 ဖုန်းနံပါတ်နှင့် @ ဖြင့် စသော စာ မပို့ရ။ ဗီဒီယို မရပါ။',
    'กฎ\n\nยังไม่อัปเกรด\n• ห้ามเบอร์ 09 และข้อความที่ขึ้นต้นด้วย @ ห้ามวิดีโอ',
    '规则\n\n未升级\n• 不可发送 09 开头电话；消息不能以 @ 开头。禁止视频。',
    '규칙\n\n업그레이드 전\n• 09 전화번호와 @로 시작하는 메시지 금지. 동영상 불가.',
    'ルール\n\nアップグレード前\n• 09の電話番号と @ で始まるメッセージは不可。動画不可。',
    [
      'စည်းကမ်း / Rules',
      '',
      'အဆင့်မမြှင့်ရသေးပါက',
      '• 09 ဖုန်းနံပါတ်နှင့် @ ဖြင့် စသော စာ မပို့ရ။ ဗီဒီယို မရပါ။',
      '',
      'Without upgrade',
      '• No 09 phone numbers; do not start a message with @. No video.'
    ].join('\n'),
    'Please don’t send Myanmar numbers starting with 09, and don’t start a message with @.'
  ];
  for (const body of oldStored) {
    const localized = I18n.localizeChatBody(body);
    assert.equal(localized, I18n.t('sakaRules'), `old rules body not remapped: ${body.slice(0, 40)}`);
    assert.equal(/09/.test(localized), false);
    assert.equal(/@/.test(localized), false);
  }
  assert.equal(I18n.error('Upload failed.'), I18n.t('errUpload'));
  assert.equal(I18n.error('Please choose male or female.'), I18n.t('errChooseGender'));
  assert.equal(I18n.statusLabel('pending'), I18n.t('statusPending'));
  I18n.setLang('my');
  assert.match(I18n.localizeChatBody('__SW__:rules'), /အခမဲ့ ၂၄ နာရီ/);
  assert.notEqual(I18n.t('sakaRules'), I18n.catalogs.en.sakaRules);
  assert.notEqual(I18n.t('createSpecialTitle'), I18n.catalogs.en.createSpecialTitle);
  I18n.setLang('th');
  assert.notEqual(I18n.t('pinRecoveryBody'), I18n.catalogs.en.pinRecoveryBody);
  I18n.setLang('zh');
  assert.notEqual(I18n.t('hostApplyTitle'), I18n.catalogs.en.hostApplyTitle);
  I18n.setLang('ko');
  assert.notEqual(I18n.t('groupsTitle'), I18n.catalogs.en.groupsTitle);
  I18n.setLang('ja');
  assert.notEqual(I18n.t('upgradeTitle'), I18n.catalogs.en.upgradeTitle);
});
