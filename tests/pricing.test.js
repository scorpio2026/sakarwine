'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quotePlan, allQuotes, isPaid, addMonths, canChatUnlimited, isSpecial, remainingPaidHours, remainingPaidBreakdown } = require('../src/pricing');

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

test('paid helper, special unlimited, and month rolling', () => {
  const now = Date.UTC(2026, 0, 15);
  assert.equal(isPaid({ paid_until: now + 1000 }, now), true);
  assert.equal(isPaid({ paid_until: now - 1 }, now), false);
  assert.equal(isSpecial({ is_special: 1 }), true);
  assert.equal(canChatUnlimited({ is_special: 1 }, now), true);
  assert.equal(canChatUnlimited({ paid_until: now - 1 }, now), false);
  const later = addMonths(now, 1);
  assert.ok(later > now);
  assert.equal(remainingPaidHours(now + 3600000, now), 1);
  assert.equal(remainingPaidHours(now + 1, now), 1);
  assert.equal(remainingPaidHours({ paid_until: now + 5 * 3600000 }, now), 5);
  assert.equal(remainingPaidHours({ paidUntil: now - 1 }, now), 0);
  const parts = remainingPaidBreakdown(now + (2 * 3600000) + (3 * 60000) + 4000, now);
  assert.equal(parts.hours, 2);
  assert.equal(parts.minutes, 3);
  assert.equal(parts.seconds, 4);
});
