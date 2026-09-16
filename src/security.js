'use strict';

const buckets = new Map();

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
  delete body.level;
  delete body.isHost;
  delete body.is_host;
  delete body.isSpecial;
  delete body.is_special;
  delete body.badge;
  delete body.hostEarnings;
  delete body.hostBalance;
  delete body.amount;
  delete body.paidUntil;
  delete body.paid_until;
  delete body.accountId;
  delete body.account_id;
  delete body.status;
  delete body.host_status;
  delete body.hostStatus;
}

module.exports = {
  rateLimit,
  securityHeaders,
  csrfGuard,
  rejectClientPrivilege,
  clientKey
};
