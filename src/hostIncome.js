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
      partner_id INTEGER,
      conversation_id INTEGER,
      upgrade_id INTEGER,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (host_id) REFERENCES users(id)
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
  migrateHostLedger(db);
}

function migrateHostLedger(db) {
  const cols = db.prepare('PRAGMA table_info(host_income_ledger)').all();
  if (!cols.length) return;
  if (cols.some((c) => c.name === 'upgrade_id')) return;
  db.exec(`
    CREATE TABLE host_income_ledger_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      partner_id INTEGER,
      conversation_id INTEGER,
      upgrade_id INTEGER,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (host_id) REFERENCES users(id)
    );
    INSERT INTO host_income_ledger_v2 (id, host_id, partner_id, conversation_id, amount, created_at)
      SELECT id, host_id, partner_id, conversation_id, amount, created_at FROM host_income_ledger;
    DROP TABLE host_income_ledger;
    ALTER TABLE host_income_ledger_v2 RENAME TO host_income_ledger;
    CREATE INDEX IF NOT EXISTS idx_host_income_host ON host_income_ledger(host_id);
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

function uniqueHostCode(db) {
  for (let i = 0; i < 30; i++) {
    const code = String(require('crypto').randomInt(10000000, 99999999));
    const taken = db.prepare('SELECT id FROM users WHERE host_code = ?').get(code);
    if (!taken) return code;
  }
  throw new Error('Could not assign host code');
}

function assignHostCode(db, userId) {
  const row = db.prepare('SELECT host_code FROM users WHERE id = ?').get(userId);
  if (row && row.host_code) return row.host_code;
  const code = uniqueHostCode(db);
  db.prepare('UPDATE users SET host_code = ? WHERE id = ?').run(code, userId);
  return code;
}

function findHostByCode(db, raw) {
  const code = String(raw || '').trim();
  if (!/^\d{8}$/.test(code)) return null;
  return db
    .prepare(
      `SELECT * FROM users
       WHERE host_code = ? AND is_host = 1 AND host_status = 'approved' AND is_ai = 0`
    )
    .get(code);
}

function creditHostForUpgrade(db, { host, member, upgradeId, now, emit }) {
  if (!host || !host.is_host || host.is_ai) return null;
  const exists = db.prepare('SELECT id FROM host_income_ledger WHERE upgrade_id = ?').get(upgradeId);
  if (exists) return null;
  db.prepare(
    `INSERT INTO host_income_ledger (host_id, partner_id, conversation_id, upgrade_id, amount, created_at)
     VALUES (?, ?, NULL, ?, ?, ?)`
  ).run(host.id, member ? member.id : null, upgradeId, HOST_CREDIT_AMOUNT, now);
  const total = hostEarningsTotal(db, host.id);
  const available = hostAvailableBalance(db, host.id);
  if (typeof emit === 'function') {
    emit(host.id, 'host:income', {
      amount: HOST_CREDIT_AMOUNT,
      total,
      available,
      partnerUsername: member ? member.username : null,
      partnerId: member ? member.id : null,
      upgradeId
    });
  }
  return { hostId: host.id, amount: HOST_CREDIT_AMOUNT, total, available };
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

function creditHostIfEligible() {
  return null;
}

function tryCreditConversation() {
  return [];
}

function tickMutual(db, conv, now) {
  const row = ensureMutualRow(db, conv.id, now);
  return { totalMs: row.total_ms, streakMs: 0, bothPresent: false, credited: [], voided: Boolean(row.voided) };
}

function markPresence(db, conv, userId, action, now) {
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
  return { totalMs: 0, streakMs: 0, bothPresent: false, credited: [], voided: false };
}

function hostIncomeLedger(db, hostId, publicUserFn) {
  const rows = db
    .prepare(
      `SELECT id, amount, created_at, conversation_id, partner_id
       FROM host_income_ledger WHERE host_id = ? ORDER BY created_at DESC`
    )
    .all(hostId);
  return rows.map((r) => {
    const partner = r.partner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(r.partner_id) : null;
    return {
      id: r.id,
      amount: r.amount,
      createdAt: r.created_at,
      conversationId: r.conversation_id,
      upgradeId: r.upgrade_id || null,
      partner: partner
        ? publicUserFn
          ? publicUserFn(partner, { viewer: { id: hostId } })
          : { id: partner.id, username: partner.username, level: partner.level }
        : { id: null, username: 'upgrade', level: 0 }
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
    hostWithdrawMin: HOST_WITHDRAW_MIN,
    canWithdraw: available >= HOST_WITHDRAW_MIN,
    hostIncomeLedger: hostIncomeLedger(db, hostId, publicUser),
    hostPayouts: hostPayouts(db, hostId)
  };
}

function mutualSnapshot() {
  return {
    totalMs: 0,
    streakMs: 0,
    neededMs: 0,
    creditAmount: HOST_CREDIT_AMOUNT,
    partnerQualifies: false,
    visitorStarted: false,
    hostOpened: false,
    credited: false,
    voided: false,
    eligible: false
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
  assignHostCode,
  findHostByCode,
  creditHostForUpgrade,
  requestPayout,
  listPayouts
};
