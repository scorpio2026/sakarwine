'use strict';

function clampMonths(months) {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function discountRate(months) {
  if (months === 12) return 0.5;
  if (months === 6) return 0.3;
  return 0;
}

function quotePlan(monthlyPrice, months) {
  const m = clampMonths(months);
  if (m == null) return null;
  const price = Number(monthlyPrice);
  if (!Number.isFinite(price) || price < 0) return null;
  const gross = Math.round(price * m);
  const rate = discountRate(m);
  const amount = Math.round(gross * (1 - rate));
  return {
    months: m,
    monthlyPrice: price,
    gross,
    discountRate: rate,
    discountPercent: Math.round(rate * 100),
    amount,
    label: m === 1 ? '1 month' : `${m} months`
  };
}

function allQuotes(monthlyPrice) {
  return Array.from({ length: 12 }, (_, i) => quotePlan(monthlyPrice, i + 1));
}

function addMonths(fromMs, months) {
  const d = new Date(fromMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function isSpecial(user) {
  if (!user) return false;
  return Boolean(user.isSpecial) || Number(user.is_special) === 1;
}

function paidUntilMs(userOrUntil) {
  if (userOrUntil && typeof userOrUntil === 'object') {
    return Number(userOrUntil.paid_until || userOrUntil.paidUntil || 0);
  }
  return Number(userOrUntil || 0);
}

function isPaid(user, now = Date.now()) {
  return paidUntilMs(user) > now;
}

function remainingPaidHours(userOrUntil, now = Date.now()) {
  const until = paidUntilMs(userOrUntil);
  if (!until || until <= now) return 0;
  return Math.ceil((until - now) / 3600000);
}

function canChatUnlimited(user, now = Date.now()) {
  return isSpecial(user) || isPaid(user, now);
}

module.exports = {
  clampMonths,
  discountRate,
  quotePlan,
  allQuotes,
  addMonths,
  isPaid,
  remainingPaidHours,
  isSpecial,
  canChatUnlimited
};
