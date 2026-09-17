'use strict';

const I18n = require('../public/js/i18n-pack.js');

const TOPICS = ['register', 'pin', 'host', 'upgrade'];
const QUESTION_KEYS = {
  register: 'sakaFaqQRegister',
  pin: 'sakaFaqQPin',
  host: 'sakaFaqQHost',
  upgrade: 'sakaFaqQUpgrade'
};
const ANSWER_KEYS = {
  register: 'sakaFaqARegister',
  pin: 'sakaFaqAPin',
  host: 'sakaFaqAHost',
  upgrade: 'sakaFaqAUpgrade',
  refuse: 'sakaFaqRefuse'
};

const KEYWORDS = {
  pin: [
    /\bpin\b/i,
    /password/i,
    /recover/i,
    /forgot/i,
    /PIN\s*တောင်း/,
    /PIN\s*ပြန်/,
    /กู้/,
    /ลืม/,
    /找回/,
    /비밀번호/,
    /パスワード/
  ],
  host: [
    /apply as host/i,
    /host\s*လျှောက်/i,
    /\bhost\b/i,
    /โฮสต์/,
    /主持/,
    /호스트/,
    /ホスト/
  ],
  upgrade: [
    /upgrade/i,
    /အဆင့်မြှင့်/,
    /อัปเกรด/,
    /升级/,
    /업그레이드/,
    /アップグレード/
  ],
  register: [
    /register/i,
    /create account/i,
    /open an account/i,
    /sign up/i,
    /အကောင့်ဖွင့်/,
    /สมัคร/,
    /注册/,
    /가입/,
    /登録/
  ]
};

function norm(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function questionLabels(topic) {
  const key = QUESTION_KEYS[topic];
  return I18n.LANGS.map((l) => {
    const cat = I18n.catalogs[l.code] || {};
    return norm(cat[key]);
  }).filter(Boolean);
}

function matchTopic({ faqTopic, body } = {}) {
  const declared = String(faqTopic || '').trim().toLowerCase();
  if (TOPICS.includes(declared)) return declared;
  const text = String(body || '');
  const n = norm(text);
  if (!n) return null;
  for (const topic of TOPICS) {
    if (questionLabels(topic).includes(n)) return topic;
  }
  for (const topic of ['pin', 'host', 'upgrade', 'register']) {
    if (KEYWORDS[topic].some((re) => re.test(text))) return topic;
  }
  return null;
}

function replyKey(topic) {
  return TOPICS.includes(topic) ? `__SW__:faq:${topic}` : '__SW__:faq:refuse';
}

module.exports = {
  TOPICS,
  QUESTION_KEYS,
  ANSWER_KEYS,
  matchTopic,
  replyKey
};
