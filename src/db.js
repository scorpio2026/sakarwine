'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function openDb(dataDir) {
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, 'sakarwine.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      gender TEXT NOT NULL,
      estimated_gender TEXT,
      birth_year INTEGER,
      phone TEXT NOT NULL,
      photo_path TEXT,
      level INTEGER NOT NULL DEFAULT 0,
      paid_until INTEGER,
      status TEXT NOT NULL DEFAULT 'pending_liveness',
      is_ai INTEGER NOT NULL DEFAULT 0,
      is_special INTEGER NOT NULL DEFAULT 0,
      badge TEXT,
      hide_account_id INTEGER NOT NULL DEFAULT 0,
      created_by_admin INTEGER NOT NULL DEFAULT 0,
      tour_completed INTEGER NOT NULL DEFAULT 0,
      occupation TEXT,
      income_monthly INTEGER,
      income_source TEXT,
      nrc_front_path TEXT,
      nrc_back_path TEXT,
      host_status TEXT NOT NULL DEFAULT 'none',
      is_host INTEGER NOT NULL DEFAULT 0,
      host_reviewed_at INTEGER,
      last_seen INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_lo INTEGER NOT NULL,
      user_hi INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      opened_by INTEGER,
      UNIQUE(user_lo, user_hi),
      FOREIGN KEY (user_lo) REFERENCES users(id),
      FOREIGN KEY (user_hi) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER,
      type TEXT NOT NULL,
      body TEXT,
      media_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS conversation_hides (
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      hidden_at INTEGER NOT NULL,
      hidden_after_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id),
      FOREIGN KEY (blocked_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      months INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'MMK',
      receipt_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_hides_user ON conversation_hides(user_id, conversation_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_upgrades_status ON upgrades(status);
  `);
  ensureColumn(db, 'users', 'is_special', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'badge', 'TEXT');
  ensureColumn(db, 'users', 'hide_account_id', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'created_by_admin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'conversation_hides', 'hidden_after_id', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'occupation', 'TEXT');
  ensureColumn(db, 'users', 'income_monthly', 'INTEGER');
  ensureColumn(db, 'users', 'income_source', 'TEXT');
  ensureColumn(db, 'users', 'nrc_front_path', 'TEXT');
  ensureColumn(db, 'users', 'nrc_back_path', 'TEXT');
  ensureColumn(db, 'users', 'host_status', "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'users', 'is_host', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'host_reviewed_at', 'INTEGER');
  ensureColumn(db, 'users', 'last_seen', 'INTEGER');
  ensureColumn(db, 'conversations', 'opened_by', 'INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_host ON users(host_status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen)');
  const { ensureHostIncomeTables } = require('./hostIncome');
  ensureHostIncomeTables(db);
  ensureColumn(db, 'conversation_mutual', 'voided', 'INTEGER NOT NULL DEFAULT 0');
  const { ensurePlatformTables } = require('./platform');
  ensurePlatformTables(db);
}

function ensureColumn(db, table, name, spec) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${spec}`);
}

function seed(db) {
  const defaults = {
    site_name: process.env.SITE_NAME || 'sakarwine',
    monthly_price: '15000',
    currency: 'MMK',
    payment_instructions:
      'Transfer the amount due to the sakarwine admin wallet / bank shown here, then upload your receipt.\n\nKBZPay / WavePay / bank transfer — update these details in Admin → Settings.',
    admin_contact: 'Message the sakarwine admin with the phone number you used at registration. There is no self-serve password reset.',
    badges: JSON.stringify(['Admin', 'officer', 'sponsor', 'VVIP']),
    income_demo_video_url: '/demo/income-host.mp4'
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);

  const ai = db.prepare('SELECT id FROM users WHERE is_ai = 1').get();
  if (!ai) {
    db.prepare(
      `INSERT INTO users (
        account_id, username, password_hash, gender, birth_year, phone,
        photo_path, level, status, is_ai, tour_completed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
    ).run(
      'SW00000001',
      'Saka',
      'ai-account',
      'female',
      1998,
      'admin',
      null,
      9,
      'active',
      Date.now()
    );
  }
}

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getBadges(db) {
  const defaults = ['Admin', 'officer', 'sponsor', 'VVIP'];
  let extra = [];
  try {
    extra = JSON.parse(getSetting(db, 'badges', '[]'));
  } catch {
    extra = [];
  }
  if (!Array.isArray(extra)) extra = [];
  const out = [];
  for (const item of [...defaults, ...extra.map(String)]) {
    const label = String(item || '').trim();
    if (!label) continue;
    if (!out.some((x) => x.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out;
}

function addBadge(db, label) {
  const badges = getBadges(db);
  const clean = String(label || '').trim();
  if (!clean) return badges;
  if (!badges.some((x) => x.toLowerCase() === clean.toLowerCase())) {
    badges.push(clean);
    setSetting(db, 'badges', JSON.stringify(badges));
  }
  return getBadges(db);
}

function publicUser(row, { online = false, includePrivate = false, viewer = null, includeNrc = false } = {}) {
  if (!row) return null;
  const hide = Boolean(row.hide_account_id);
  const isSelf = viewer && Number(viewer.id) === Number(row.id);
  const showAccountId = includePrivate || isSelf || !hide;
  const isHost = Boolean(row.is_host);
  const out = {
    id: row.id,
    accountId: showAccountId ? row.account_id : null,
    accountIdHidden: hide,
    username: row.username,
    gender: row.gender,
    estimatedGender: row.estimated_gender,
    birthYear: row.birth_year,
    photoUrl: row.photo_path ? `/api/media/profile/${path.basename(row.photo_path)}` : null,
    level: row.level,
    badge: row.badge || null,
    isSpecial: Boolean(row.is_special),
    isHost,
    createdByAdmin: Boolean(row.created_by_admin),
    paidUntil: row.paid_until,
    paid: Boolean(row.paid_until && row.paid_until > Date.now()),
    status: row.status,
    isAi: Boolean(row.is_ai),
    tourCompleted: Boolean(row.tour_completed),
    online,
    createdAt: row.created_at
  };
  if (includePrivate) {
    out.phone = row.phone;
    out.hostStatus = row.host_status || 'none';
    out.occupation = row.occupation || null;
    out.monthlyIncome = row.income_monthly != null ? row.income_monthly : null;
    out.incomeSource = row.income_source || null;
  }
  if (includeNrc) {
    out.nrcFrontUrl = row.nrc_front_path ? `/api/admin/accounts/${row.id}/nrc/front` : null;
    out.nrcBackUrl = row.nrc_back_path ? `/api/admin/accounts/${row.id}/nrc/back` : null;
  }
  return out;
}

module.exports = {
  openDb,
  ensureDir,
  getSetting,
  setSetting,
  getBadges,
  addBadge,
  publicUser
};
