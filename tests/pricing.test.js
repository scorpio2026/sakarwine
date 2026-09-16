'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quotePlan, allQuotes, isPaid, addMonths } = require('../src/pricing');

test('6 months is 30% off and 12 months is 50% off', () => {
  const m = quotePlan(10000, 1);
  assert.equal(m.amount, 10000);
  const six = quotePlan(10000, 6);
  assert.equal(six.gross, 60000);
  assert.equal(six.amount, 42000);
  assert.equal(six.discountPercent, 30);
  const year = quotePlan(10000, 12);
  assert.equal(year.amount, 60000);
  assert.equal(year.discountPercent, 50);
});

test('quotes cover 1-12 months', () => {
  assert.equal(allQuotes(15000).length, 12);
  assert.equal(quotePlan(15000, 13), null);
});

test('paid helper and month rolling', () => {
  const now = Date.UTC(2026, 0, 15);
  assert.equal(isPaid({ paid_until: now + 1000 }, now), true);
  assert.equal(isPaid({ paid_until: now - 1 }, now), false);
  const later = addMonths(now, 1);
  assert.ok(later > now);
});
