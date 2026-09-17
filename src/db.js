'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { remainingPaidHours } = require('./pricing');

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

    CREATE TABLE IF NOT EXISTS message_translations (
      message_id INTEGER NOT NULL,
      lang TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, lang),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS conversation_langs (
      user_id INTEGER NOT NULL,
      conversation_id INTEGER NOT NULL,
      lang TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, conversation_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS pin_recovery_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pin_recovery_status ON pin_recovery_requests(status, created_at);

    CREATE TABLE IF NOT EXISTS user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      logo_path TEXT,
      creator_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS group_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      responded_at INTEGER,
      FOREIGN KEY (group_id) REFERENCES user_groups(id),
      FOREIGN KEY (inviter_id) REFERENCES users(id),
      FOREIGN KEY (invitee_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id, group_id);
    CREATE INDEX IF NOT EXISTS idx_group_invites_invitee ON group_invites(invitee_id, status);

    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      sender_id INTEGER,
      type TEXT NOT NULL,
      body TEXT,
      media_path TEXT,
      created_at INTEGER NOT NULL,
      source_lang TEXT,
      FOREIGN KEY (group_id) REFERENCES user_groups(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, id);

    CREATE TABLE IF NOT EXISTS group_join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      responded_at INTEGER,
      FOREIGN KEY (group_id) REFERENCES user_groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_joins_group ON group_join_requests(group_id, status);
    CREATE INDEX IF NOT EXISTS idx_group_joins_user ON group_join_requests(user_id, status);
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
  ensureColumn(db, 'users', 'id_doc_type', "TEXT NOT NULL DEFAULT 'nrc'");
  ensureColumn(db, 'users', 'host_status', "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'users', 'is_host', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'host_reviewed_at', 'INTEGER');
  ensureColumn(db, 'users', 'last_seen', 'INTEGER');
  ensureColumn(db, 'conversations', 'opened_by', 'INTEGER');
  ensureColumn(db, 'conversations', 'member_messaging', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'users', 'ui_lang', "TEXT NOT NULL DEFAULT 'my'");
  ensureColumn(db, 'users', 'chat_view_lang', 'TEXT');
  ensureColumn(db, 'users', 'host_code', 'TEXT');
  ensureColumn(db, 'users', 'bio', 'TEXT');
  ensureColumn(db, 'upgrades', 'host_code', 'TEXT');
  ensureColumn(db, 'upgrades', 'host_id', 'INTEGER');
  ensureColumn(db, 'upgrades', 'target_user_id', 'INTEGER');
  ensureColumn(db, 'upgrades', 'target_account_id', 'TEXT');
  ensureColumn(db, 'messages', 'source_lang', 'TEXT');
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
    income_demo_video_url: '/demo/income-host.mp4',
    maintenance_mode: '0'
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

function isAdminAccount(row) {
  return String((row && row.badge) || '').toLowerCase() === 'admin';
}

function defaultAvatarUrl(row) {
  if (row && row.is_ai) return '/assets/saka-guide.svg';
  if (row && String(row.gender || '') === 'female') return '/assets/default-female.png';
  return '/assets/default-male.png';
}

function publicUser(row, { online = false, includePrivate = false, includePhone = false, viewer = null, includeNrc = false } = {}) {
  if (!row) return null;
  const hide = Boolean(row.hide_account_id);
  const isSelf = viewer && Number(viewer.id) === Number(row.id);
  const showAccountId = includePrivate || isSelf || !hide;
  const isHost = Boolean(row.is_host);
  const isAdmin = isAdminAccount(row);
  const hasPhoto = Boolean(row.photo_path);
  const out = {
    id: row.id,
    accountId: showAccountId ? row.account_id : null,
    accountIdHidden: hide,
    username: row.username,
    gender: row.gender,
    estimatedGender: row.estimated_gender,
    birthYear: row.birth_year,
    hasPhoto,
    photoUrl: hasPhoto
      ? `/api/media/profile/${path.basename(row.photo_path)}`
      : defaultAvatarUrl(row),
    level: row.level,
    badge: row.badge || null,
    isSpecial: Boolean(row.is_special),
    isAdmin,
    blockable: !row.is_ai && !isAdmin,
    isHost,
    createdByAdmin: Boolean(row.created_by_admin),
    paidUntil: row.paid_until,
    paid: Boolean(row.paid_until && row.paid_until > Date.now()),
    paidRemainingHours: remainingPaidHours(row.paid_until),
    status: row.status,
    isAi: Boolean(row.is_ai),
    tourCompleted: Boolean(row.tour_completed),
    bio: row.bio ? String(row.bio) : '',
    online,
    createdAt: row.created_at
  };
  if (isSelf || includePrivate) {
    out.uiLang = row.ui_lang || 'my';
    out.chatViewLang = row.chat_view_lang || null;
    if (row.host_code) out.hostCode = row.host_code;
  }
  if (includePrivate) {
    out.hostStatus = row.host_status || 'none';
    out.idDocType = row.id_doc_type === 'passport' ? 'passport' : 'nrc';
  }
  if (includePhone) {
    out.phone = row.phone;
  }
  if (includeNrc) {
    out.idDocType = row.id_doc_type === 'passport' ? 'passport' : 'nrc';
    out.nrcFrontUrl = row.nrc_front_path ? `/api/admin/accounts/${row.id}/nrc/front` : null;
    out.nrcBackUrl = row.nrc_back_path ? `/api/admin/accounts/${row.id}/nrc/back` : null;
  }
  return out;
}

function adminUser(row, extra = {}) {
  return publicUser(row, { includePrivate: true, includePhone: true, ...extra });
}

module.exports = {
  openDb,
  ensureDir,
  getSetting,
  setSetting,
  getBadges,
  addBadge,
  publicUser,
  adminUser,
  isAdminAccount,
  defaultAvatarUrl
};
