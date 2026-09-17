'use strict';

process.env.HOST_CREDIT_AMOUNT = '500';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creditAmountForMonths, HOST_CREDIT_AMOUNT } = require('../src/hostIncome');

test('host referral credit is 500 × months, not a flat 500', () => {
  assert.equal(HOST_CREDIT_AMOUNT, 500);
  assert.equal(12 * 500, 6000);
  assert.equal(creditAmountForMonths(12), 12 * HOST_CREDIT_AMOUNT);
  assert.equal(creditAmountForMonths(12), 6000);
  for (let months = 1; months <= 12; months++) {
    assert.equal(creditAmountForMonths(months), months * HOST_CREDIT_AMOUNT);
  }
});
