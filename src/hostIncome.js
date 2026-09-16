'use strict';

const HOST_CREDIT_AMOUNT = Number(process.env.HOST_CREDIT_AMOUNT || 500);
const HOST_CHAT_MS = Number(process.env.HOST_CHAT_MS || 10 * 60 * 1000);
const HOST_PRESENCE_GRACE_MS = Number(process.env.HOST_PRESENCE_GRACE_MS || 20 * 1000);

function ensureHostIncomeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_presence (
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS conversation_mutual (
      conversation_id INTEGER PRIMARY KEY,
      total_ms INTEGER NOT NULL DEFAULT 0,
      streak_ms INTEGER NOT NULL DEFAULT 0,
      last_tick_at INTEGER,
      both_present INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS host_income_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      conversation_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(host_id, partner_id),
      FOREIGN KEY (host_id) REFERENCES users(id),
      FOREIGN KEY (partner_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_host_income_host ON host_income_ledger(host_id);
  `);
}

function partnerQualifies(partner) {
  if (!partner || partner.is_ai) return false;
  return Number(partner.level || 0) >= 1;
}

function alreadyCredited(db, hostId, partnerId) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM host_income_ledger WHERE host_id = ? AND partner_id = ?')
      .get(hostId, partnerId)
  );
}

function creditHostIfEligible(db, host, partner, conv, now, emit) {
  if (!host || !host.is_host || host.is_ai) return null;
  if (!partnerQualifies(partner)) return null;
  const mutual = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  if (!mutual || mutual.total_ms < HOST_CHAT_MS) return null;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO host_income_ledger
        (host_id, partner_id, conversation_id, amount, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(host.id, partner.id, conv.id, HOST_CREDIT_AMOUNT, now);
  if (!info.changes) return null;
  const total = hostEarningsTotal(db, host.id);
  if (typeof emit === 'function') {
    emit(host.id, 'host:income', {
      amount: HOST_CREDIT_AMOUNT,
      total,
      partnerUsername: partner.username,
      partnerId: partner.id
    });
  }
  return { hostId: host.id, amount: HOST_CREDIT_AMOUNT, total };
}

function tryCreditConversation(db, conv, now, emit) {
  const a = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_lo);
  const b = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_hi);
  const credited = [];
  const one = creditHostIfEligible(db, a, b, conv, now, emit);
  const two = creditHostIfEligible(db, b, a, conv, now, emit);
  if (one) credited.push(one);
  if (two) credited.push(two);
  return credited;
}

function bothPresent(db, conv, now) {
  const a = db
    .prepare('SELECT last_seen FROM conversation_presence WHERE conversation_id = ? AND user_id = ?')
    .get(conv.id, conv.user_lo);
  const b = db
    .prepare('SELECT last_seen FROM conversation_presence WHERE conversation_id = ? AND user_id = ?')
    .get(conv.id, conv.user_hi);
  if (!a || !b) return false;
  return now - a.last_seen <= HOST_PRESENCE_GRACE_MS && now - b.last_seen <= HOST_PRESENCE_GRACE_MS;
}

function tickMutual(db, conv, now, emit) {
  let row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  if (!row) {
    db.prepare(
      'INSERT INTO conversation_mutual (conversation_id, total_ms, streak_ms, last_tick_at, both_present) VALUES (?, 0, 0, ?, 0)'
    ).run(conv.id, now);
    row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  }
  const present = bothPresent(db, conv, now);
  let total = row.total_ms;
  let streak = row.streak_ms;
  if (present) {
    if (row.both_present && row.last_tick_at) {
      const delta = Math.max(0, Math.min(now - row.last_tick_at, HOST_PRESENCE_GRACE_MS));
      total += delta;
      streak += delta;
    }
    db.prepare(
      'UPDATE conversation_mutual SET total_ms = ?, streak_ms = ?, last_tick_at = ?, both_present = 1 WHERE conversation_id = ?'
    ).run(total, streak, now, conv.id);
  } else {
    db.prepare(
      'UPDATE conversation_mutual SET last_tick_at = ?, both_present = 0, streak_ms = 0 WHERE conversation_id = ?'
    ).run(now, conv.id);
    streak = 0;
  }
  const credited = tryCreditConversation(db, conv, now, emit);
  return { totalMs: present ? total : row.total_ms, streakMs: streak, bothPresent: present, credited };
}

function markPresence(db, conv, userId, action, now, emit) {
  const act = String(action || 'ping');
  if (act === 'leave') {
    db.prepare('DELETE FROM conversation_presence WHERE conversation_id = ? AND user_id = ?').run(conv.id, userId);
  } else {
    db.prepare(
      `INSERT INTO conversation_presence (conversation_id, user_id, last_seen)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`
    ).run(conv.id, userId, now);
  }
  return tickMutual(db, conv, now, emit);
}

function hostEarningsTotal(db, hostId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM host_income_ledger WHERE host_id = ?')
    .get(hostId);
  return row ? row.n : 0;
}

function hostIncomeLedger(db, hostId, publicUserFn) {
  const rows = db
    .prepare(
      `SELECT id, amount, created_at, conversation_id, partner_id
       FROM host_income_ledger WHERE host_id = ? ORDER BY created_at DESC`
    )
    .all(hostId);
  return rows.map((r) => {
    const partner = db.prepare('SELECT * FROM users WHERE id = ?').get(r.partner_id);
    return {
      id: r.id,
      amount: r.amount,
      createdAt: r.created_at,
      conversationId: r.conversation_id,
      partner: publicUserFn
        ? publicUserFn(partner, { viewer: { id: hostId } })
        : { id: partner.id, username: partner.username, level: partner.level }
    };
  });
}

function hostIncomeSummary(db, hostId, publicUser) {
  const ledger = hostIncomeLedger(db, hostId, publicUser);
  return {
    hostEarnings: hostEarningsTotal(db, hostId),
    hostCreditAmount: HOST_CREDIT_AMOUNT,
    hostChatMs: HOST_CHAT_MS,
    hostIncomeLedger: ledger
  };
}

function mutualSnapshot(db, conv, viewer, peer) {
  const row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  const totalMs = row ? row.total_ms : 0;
  const credited =
    viewer && peer
      ? alreadyCredited(db, viewer.id, peer.id)
      : false;
  const viewerIsHost = Boolean(viewer && viewer.is_host);
  return {
    totalMs,
    streakMs: row ? row.streak_ms : 0,
    neededMs: HOST_CHAT_MS,
    creditAmount: HOST_CREDIT_AMOUNT,
    partnerQualifies: partnerQualifies(peer),
    credited: viewerIsHost ? credited : false,
    eligible: viewerIsHost && partnerQualifies(peer) && !peer.is_ai
  };
}

module.exports = {
  HOST_CREDIT_AMOUNT,
  HOST_CHAT_MS,
  HOST_PRESENCE_GRACE_MS,
  ensureHostIncomeTables,
  partnerQualifies,
  markPresence,
  tickMutual,
  tryCreditConversation,
  hostEarningsTotal,
  hostIncomeSummary,
  mutualSnapshot
};
