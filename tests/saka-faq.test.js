'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchTopic, replyKey, TOPICS } = require('../src/sakaFaq');
const I18n = require('../public/js/i18n-pack.js');

test('guide FAQ matcher accepts chips and refuses off-topic text', () => {
  assert.deepEqual(TOPICS, ['register', 'pin', 'host', 'upgrade']);
  assert.equal(matchTopic({ faqTopic: 'register', body: 'lol' }), 'register');
  assert.equal(matchTopic({ faqTopic: 'hack', body: 'lol' }), null);
  assert.equal(matchTopic({ body: 'How to recover PIN' }), 'pin');
  assert.equal(matchTopic({ body: 'အကောင့်ဖွင့်ပုံ' }), 'register');
  assert.equal(matchTopic({ body: 'PIN တောင်းပုံ' }), 'pin');
  assert.equal(matchTopic({ body: 'how do I apply as host' }), 'host');
  assert.equal(matchTopic({ body: 'how to upgrade' }), 'upgrade');
  assert.equal(matchTopic({ body: 'what is the weather' }), null);
  assert.equal(replyKey('upgrade'), '__SW__:faq:upgrade');
  assert.equal(replyKey(null), '__SW__:faq:refuse');
  I18n.setLang('en');
  assert.match(I18n.t('sakaFaqAPin'), /Help/);
  I18n.setLang('my');
  assert.match(I18n.t('sakaFaqRefuse'), /၄/);
});
