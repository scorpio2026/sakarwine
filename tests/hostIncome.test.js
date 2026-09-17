'use strict';

process.env.HOST_CREDIT_AMOUNT = '500';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creditAmountForMonths } = require('../src/hostIncome');

test('host referral credit is 500 × months, not a flat 500', () => {
  assert.equal(creditAmountForMonths(1), 500);
  assert.equal(creditAmountForMonths(2), 1000);
  assert.equal(creditAmountForMonths(6), 3000);
  assert.equal(creditAmountForMonths(12), 6000);
});
