'use strict';

const HOST_CREDIT_AMOUNT = Number(process.env.HOST_CREDIT_AMOUNT || 500);
const HOST_CHAT_MS = Number(process.env.HOST_CHAT_MS || 10 * 60 * 1000);
const HOST_PRESENCE_GRACE_MS = Number(process.env.HOST_PRESENCE_GRACE_MS || 20 * 1000);
const HOST_WITHDRAW_MIN = Number(process.env.HOST_WITHDRAW_MIN || 100000);
const PAYOUT_METHODS = ['kbz', 'wave'];

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
      voided INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS host_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      payee_name TEXT NOT NULL,
      payee_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      FOREIGN KEY (host_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_host_income_host ON host_income_ledger(host_id);
    CREATE INDEX IF NOT EXISTS idx_host_payouts_host ON host_payouts(host_id, status);
  `);
}

function ensureMutualRow(db, convId, now) {
  let row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(convId);
  if (!row) {
    db.prepare(
      'INSERT INTO conversation_mutual (conversation_id, total_ms, streak_ms, last_tick_at, both_present, voided) VALUES (?, 0, 0, ?, 0, 0)'
    ).run(convId, now);
    row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(convId);
  }
  return row;
}

function partnerQualifies(partner) {
  if (!partner || partner.is_ai) return false;
  return Number(partner.level || 0) >= 1;
}

function visitorStarted(conv, partner) {
  if (!conv || !partner) return false;
  return Number(conv.opened_by) === Number(partner.id);
}

function alreadyCredited(db, hostId, partnerId) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM host_income_ledger WHERE host_id = ? AND partner_id = ?')
      .get(hostId, partnerId)
  );
}

function hostEarningsTotal(db, hostId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM host_income_ledger WHERE host_id = ?')
    .get(hostId);
  return row ? row.n : 0;
}

function hostHeldTotal(db, hostId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM host_payouts
       WHERE host_id = ? AND status IN ('pending', 'done')`
    )
    .get(hostId);
  return row ? row.n : 0;
}

function hostAvailableBalance(db, hostId) {
  return Math.max(0, hostEarningsTotal(db, hostId) - hostHeldTotal(db, hostId));
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

function voidSession(db, conv, now = Date.now()) {
  if (!conv) return;
  db.prepare('DELETE FROM conversation_presence WHERE conversation_id = ?').run(conv.id);
  ensureMutualRow(db, conv.id, now);
  db.prepare(
    'UPDATE conversation_mutual SET both_present = 0, streak_ms = 0, last_tick_at = ?, voided = 1 WHERE conversation_id = ?'
  ).run(now, conv.id);
}

function resetStreak(db, conv, now) {
  ensureMutualRow(db, conv.id, now);
  db.prepare(
    'UPDATE conversation_mutual SET both_present = 0, streak_ms = 0, last_tick_at = ? WHERE conversation_id = ?'
  ).run(now, conv.id);
}

function creditHostIfEligible(db, host, partner, conv, now, emit) {
  if (!host || !host.is_host || host.is_ai) return null;
  if (!partnerQualifies(partner)) return null;
  if (!visitorStarted(conv, partner)) return null;
  const mutual = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  if (!mutual || mutual.voided) return null;
  if (mutual.streak_ms < HOST_CHAT_MS) return null;
  if (!bothPresent(db, conv, now)) return null;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO host_income_ledger
        (host_id, partner_id, conversation_id, amount, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(host.id, partner.id, conv.id, HOST_CREDIT_AMOUNT, now);
  if (!info.changes) return null;
  const total = hostEarningsTotal(db, host.id);
  const available = hostAvailableBalance(db, host.id);
  if (typeof emit === 'function') {
    emit(host.id, 'host:income', {
      amount: HOST_CREDIT_AMOUNT,
      total,
      available,
      partnerUsername: partner.username,
      partnerId: partner.id
    });
  }
  return { hostId: host.id, amount: HOST_CREDIT_AMOUNT, total, available };
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

function tickMutual(db, conv, now, emit) {
  let row = ensureMutualRow(db, conv.id, now);
  if (row.voided) {
    return { totalMs: row.total_ms, streakMs: 0, bothPresent: false, credited: [], voided: true };
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
    resetStreak(db, conv, now);
    streak = 0;
  }
  const credited = present ? tryCreditConversation(db, conv, now, emit) : [];
  return { totalMs: present ? total : row.total_ms, streakMs: streak, bothPresent: present, credited, voided: false };
}

function markPresence(db, conv, userId, action, now, emit) {
  const act = String(action || 'ping');
  if (act === 'leave') {
    db.prepare('DELETE FROM conversation_presence WHERE conversation_id = ? AND user_id = ?').run(conv.id, userId);
    resetStreak(db, conv, now);
    return { totalMs: 0, streakMs: 0, bothPresent: false, credited: [], voided: false };
  }
  db.prepare(
    `INSERT INTO conversation_presence (conversation_id, user_id, last_seen)
     VALUES (?, ?, ?)
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`
  ).run(conv.id, userId, now);
  return tickMutual(db, conv, now, emit);
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

function hostPayouts(db, hostId) {
  return db
    .prepare(
      `SELECT id, amount, method, payee_name, payee_phone, status, created_at, reviewed_at
       FROM host_payouts WHERE host_id = ? ORDER BY id DESC`
    )
    .all(hostId)
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      payeeName: p.payee_name,
      payeePhone: p.payee_phone,
      status: p.status,
      createdAt: p.created_at,
      reviewedAt: p.reviewed_at
    }));
}

function hostIncomeSummary(db, hostId, publicUser) {
  const earned = hostEarningsTotal(db, hostId);
  const available = hostAvailableBalance(db, hostId);
  return {
    hostEarnings: earned,
    hostBalance: available,
    hostCreditAmount: HOST_CREDIT_AMOUNT,
    hostChatMs: HOST_CHAT_MS,
    hostWithdrawMin: HOST_WITHDRAW_MIN,
    canWithdraw: available >= HOST_WITHDRAW_MIN,
    hostIncomeLedger: hostIncomeLedger(db, hostId, publicUser),
    hostPayouts: hostPayouts(db, hostId)
  };
}

function mutualSnapshot(db, conv, viewer, peer) {
  const row = db.prepare('SELECT * FROM conversation_mutual WHERE conversation_id = ?').get(conv.id);
  const streakMs = row ? row.streak_ms : 0;
  const credited =
    viewer && peer ? alreadyCredited(db, viewer.id, peer.id) : false;
  const viewerIsHost = Boolean(viewer && viewer.is_host);
  const visitorOk = visitorStarted(conv, peer);
  const hostOpened = viewer && Number(conv.opened_by) === Number(viewer.id);
  return {
    totalMs: streakMs,
    streakMs,
    neededMs: HOST_CHAT_MS,
    creditAmount: HOST_CREDIT_AMOUNT,
    partnerQualifies: partnerQualifies(peer),
    visitorStarted: visitorOk,
    hostOpened: Boolean(hostOpened),
    credited: viewerIsHost ? credited : false,
    voided: Boolean(row && row.voided),
    eligible: viewerIsHost && partnerQualifies(peer) && visitorOk && !credited && !(row && row.voided)
  };
}

function requestPayout(db, host, { method, name, phone }) {
  if (!host || !host.is_host) return { error: 'Only verified hosts can withdraw.', status: 403 };
  const payMethod = String(method || '').trim().toLowerCase();
  if (!PAYOUT_METHODS.includes(payMethod)) {
    return { error: 'Choose KBZ Pay or Wave.', status: 400 };
  }
  const payeeName = String(name || '').trim();
  const payeePhone = String(phone || '').replace(/\s+/g, '');
  if (payeeName.length < 2 || payeeName.length > 80) {
    return { error: 'Enter the name on the wallet.', status: 400 };
  }
  if (!/^[0-9+\-]{7,20}$/.test(payeePhone)) {
    return { error: 'Enter the wallet phone number.', status: 400 };
  }
  const pending = db
    .prepare("SELECT id FROM host_payouts WHERE host_id = ? AND status = 'pending'")
    .get(host.id);
  if (pending) return { error: 'You already have a payout waiting for admin.', status: 409 };
  const available = hostAvailableBalance(db, host.id);
  if (available < HOST_WITHDRAW_MIN) {
    return {
      error: `Withdraw opens at ${HOST_WITHDRAW_MIN.toLocaleString()} MMK.`,
      status: 400
    };
  }
  const info = db
    .prepare(
      `INSERT INTO host_payouts (host_id, amount, method, payee_name, payee_phone, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(host.id, available, payMethod, payeeName, payeePhone, Date.now());
  return {
    payout: {
      id: info.lastInsertRowid,
      amount: available,
      method: payMethod,
      status: 'pending'
    },
    hostBalance: 0,
    hostEarnings: hostEarningsTotal(db, host.id)
  };
}

function listPayouts(db, publicUserFn) {
  return db
    .prepare(
      `SELECT p.*, u.username, u.account_id, u.phone AS host_phone
       FROM host_payouts p JOIN users u ON u.id = p.host_id
       ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.id DESC`
    )
    .all()
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      payeeName: p.payee_name,
      payeePhone: p.payee_phone,
      status: p.status,
      createdAt: p.created_at,
      reviewedAt: p.reviewed_at,
      host: publicUserFn
        ? publicUserFn(db.prepare('SELECT * FROM users WHERE id = ?').get(p.host_id), {
            includePrivate: true,
            includePhone: true
          })
        : { id: p.host_id, username: p.username, accountId: p.account_id, phone: p.host_phone }
    }));
}

module.exports = {
  HOST_CREDIT_AMOUNT,
  HOST_CHAT_MS,
  HOST_PRESENCE_GRACE_MS,
  HOST_WITHDRAW_MIN,
  PAYOUT_METHODS,
  ensureHostIncomeTables,
  partnerQualifies,
  visitorStarted,
  markPresence,
  tickMutual,
  tryCreditConversation,
  voidSession,
  resetStreak,
  hostEarningsTotal,
  hostAvailableBalance,
  hostIncomeSummary,
  mutualSnapshot,
  requestPayout,
  listPayouts
};
