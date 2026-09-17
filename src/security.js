'use strict';

const crypto = require('crypto');

const buckets = new Map();
const PRIVILEGE_KEYS = [
  'level',
  'isHost',
  'is_host',
  'isSpecial',
  'is_special',
  'isAi',
  'is_ai',
  'badge',
  'hostEarnings',
  'hostBalance',
  'amount',
  'paidUntil',
  'paid_until',
  'paidRemainingHours',
  'freeUntil',
  'free_chat_ms',
  'freeChatMs',
  'freeTrialDays',
  'accountId',
  'account_id',
  'status',
  'host_status',
  'hostStatus',
  'createdByAdmin',
  'created_by_admin',
  'hideAccountId',
  'hide_account_id',
  'tourCompleted',
  'tour_completed',
  'password_hash',
  'id',
  'totalMs',
  'streakMs',
  'credited',
  'hostCreditAmount'
];

function clientKey(req, extra = '') {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local')
    .split(',')[0]
    .trim();
  return `${ip}:${extra}`;
}

function rateLimit({ windowMs = 60 * 1000, max = 20, name = 'api' } = {}) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT === '0') return next();
    const key = `${name}:${clientKey(req, req.user ? req.user.id : '')}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Wait a moment and try again.' });
    }
    next();
  };
}

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; frame-ancestors 'none'"
  );
  next();
}

function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const host = String(req.headers.host || '');
    const incoming = new URL(origin);
    if (incoming.host !== host) {
      return res.status(403).json({ error: 'Rejected cross-site request.' });
    }
  } catch {
    return res.status(403).json({ error: 'Rejected cross-site request.' });
  }
  next();
}

function rejectClientPrivilege(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of PRIVILEGE_KEYS) delete body[key];
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  const size = Math.max(left.length, right.length, 1);
  const padL = Buffer.alloc(size);
  const padR = Buffer.alloc(size);
  left.copy(padL);
  right.copy(padR);
  return crypto.timingSafeEqual(padL, padR) && left.length === right.length;
}

module.exports = {
  rateLimit,
  securityHeaders,
  csrfGuard,
  rejectClientPrivilege,
  safeEqual,
  clientKey
};
