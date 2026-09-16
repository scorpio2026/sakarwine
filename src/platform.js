'use strict';

const fs = require('fs');
const path = require('path');

const OFFLINE_PURGE_MS = Number(process.env.OFFLINE_PURGE_MS || 30 * 24 * 60 * 60 * 1000);
const AD_ROTATE_MS = Number(process.env.AD_ROTATE_MS || 5000);

function ensurePlatformTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT,
      media_path TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

function listAds(db) {
  return db
    .prepare('SELECT id, image_path, sort_order, created_at FROM ad_banners ORDER BY sort_order ASC, id ASC')
    .all()
    .map((a) => ({
      id: a.id,
      imageUrl: `/api/ads/${a.id}/image`,
      sortOrder: a.sort_order,
      createdAt: a.created_at
    }));
}

function addAd(db, filename) {
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM ad_banners').get().n;
  const info = db
    .prepare('INSERT INTO ad_banners (image_path, sort_order, created_at) VALUES (?, ?, ?)')
    .run(filename, max + 1, Date.now());
  return db.prepare('SELECT * FROM ad_banners WHERE id = ?').get(info.lastInsertRowid);
}

function deleteAd(db, id, uploadsDir) {
  const row = db.prepare('SELECT * FROM ad_banners WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM ad_banners WHERE id = ?').run(id);
  if (row.image_path && uploadsDir) {
    fs.unlink(path.join(uploadsDir, 'ads', path.basename(row.image_path)), () => {});
  }
  return row;
}

function staleAccounts(db, now = Date.now()) {
  const cutoff = now - OFFLINE_PURGE_MS;
  return db
    .prepare(
      `SELECT * FROM users
       WHERE is_ai = 0
         AND status != 'closed'
         AND COALESCE(last_seen, created_at) < ?
         AND id NOT IN (SELECT host_id FROM host_payouts WHERE status = 'pending')`
    )
    .all(cutoff);
}

function closeStaleAccount(db, user, uploadsDir, now = Date.now()) {
  const goneName = `gone${user.id}`;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare(
    `UPDATE users SET
       status = 'closed',
       username = ?,
       phone = 'deleted',
       photo_path = NULL,
       nrc_front_path = NULL,
       nrc_back_path = NULL,
       is_host = 0,
       host_status = 'none',
       password_hash = ?
     WHERE id = ?`
  ).run(goneName, `purged-${now}-${user.id}`, user.id);
  if (uploadsDir) {
    for (const file of [user.photo_path, user.nrc_front_path, user.nrc_back_path]) {
      if (!file) continue;
      const sub = file === user.photo_path ? 'profiles' : 'nrc';
      fs.unlink(path.join(uploadsDir, sub, path.basename(file)), () => {});
    }
  }
  return goneName;
}

function purgeStaleAccounts(db, uploadsDir, now = Date.now()) {
  const rows = staleAccounts(db, now);
  const closed = [];
  for (const user of rows) {
    closed.push({ id: user.id, username: closeStaleAccount(db, user, uploadsDir, now) });
  }
  return closed;
}

module.exports = {
  OFFLINE_PURGE_MS,
  AD_ROTATE_MS,
  ensurePlatformTables,
  listAds,
  addAd,
  deleteAd,
  staleAccounts,
  closeStaleAccount,
  purgeStaleAccounts
};
