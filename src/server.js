'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { openDb, ensureDir, getSetting, setSetting, getBadges, addBadge, publicUser } = require('./db');
const { messageFilterError, isAllowedImageMime, isAllowedVoiceMime, isForbiddenVideo } = require('./filters');
const { quotePlan, allQuotes, addMonths, isPaid, isSpecial, canChatUnlimited, clampMonths } = require('./pricing');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOADS = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'sakarwine-dev-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const FREE_CHAT_MS = Number(process.env.FREE_CHAT_MS || 24 * 60 * 60 * 1000);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

ensureDir(path.join(UPLOADS, 'profiles'));
ensureDir(path.join(UPLOADS, 'chat'));
ensureDir(path.join(UPLOADS, 'voice'));
ensureDir(path.join(UPLOADS, 'receipts'));

const db = openDb(DATA_DIR);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

const online = new Map(); // userId -> Set(socketId)

function addOnline(userId, socketId) {
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId).add(socketId);
}

function removeOnline(userId, socketId) {
  const set = online.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) online.delete(userId);
}

function isOnline(userId) {
  const user = db.prepare('SELECT is_ai FROM users WHERE id = ?').get(userId);
  if (user && user.is_ai) return true;
  return online.has(userId);
}

function emitToUser(userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return;
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
  return out;
}

function signToken() {
  return crypto.randomBytes(24).toString('hex');
}

function cookieOpts(maxAge = SESSION_MS) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    secure: process.env.COOKIE_SECURE === '1'
  };
}

function setCookie(res, name, value, maxAge) {
  const opts = cookieOpts(maxAge);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.floor(opts.maxAge / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (opts.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function storageFor(subdir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOADS, subdir)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || mimeExt(file.mimetype);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  });
}

function mimeExt(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'audio/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'video/webm': '.webm'
  };
  return map[mime] || '';
}

const uploadProfile = multer({
  storage: storageFor('profiles'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) return cb(new Error('Profile photo must be an image.'));
    cb(null, true);
  }
});

const uploadChat = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const kind = file.fieldname === 'voice' ? 'voice' : 'chat';
      cb(null, path.join(UPLOADS, kind));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || mimeExt(file.mimetype);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isForbiddenVideo(file.mimetype, file.originalname)) {
      return cb(new Error('Video is not allowed.'));
    }
    if (file.fieldname === 'image' && !isAllowedImageMime(file.mimetype)) {
      return cb(new Error('Only image files can be sent as photos.'));
    }
    if (file.fieldname === 'voice' && !isAllowedVoiceMime(file.mimetype)) {
      return cb(new Error('Voice notes must be audio.'));
    }
    cb(null, true);
  }
});

const uploadReceipt = multer({
  storage: storageFor('receipts'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) return cb(new Error('Receipt must be an image screenshot.'));
    cb(null, true);
  }
});

function multerSingle(uploader, field) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({ error: err.message || 'Upload failed.' });
    });
  };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC));

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

function currentUser(req) {
  const token = req.cookies.sw_sid;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  return row || null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  if (user.status === 'closed') return res.status(403).json({ error: 'This account is permanently closed.' });
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account is temporarily suspended. Contact admin.' });
  }
  req.user = user;
  next();
}

function requireActive(req, res, next) {
  if (req.user.status === 'pending_liveness') {
    return res.status(403).json({ error: 'Finish the face scan to continue.', code: 'LIVENESS' });
  }
  if (req.user.status !== 'active' && !req.user.is_ai) {
    return res.status(403).json({ error: 'Account is not active.' });
  }
  next();
}

function currentAdmin(req) {
  const token = req.cookies.sw_aid;
  if (!token) return false;
  const row = db
    .prepare('SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?')
    .get(token, Date.now());
  return Boolean(row);
}

function requireAdmin(req, res, next) {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

function uniqueAccountId() {
  for (let i = 0; i < 20; i++) {
    const id = `SW${crypto.randomInt(10000000, 99999999)}`;
    const exists = db.prepare('SELECT id FROM users WHERE account_id = ?').get(id);
    if (!exists) return id;
  }
  throw new Error('Could not assign account ID');
}

function pairIds(a, b) {
  return a < b ? [a, b] : [b, a];
}

function getOrCreateConversation(userA, userB) {
  const [lo, hi] = pairIds(userA, userB);
  let conv = db.prepare('SELECT * FROM conversations WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
  if (!conv) {
    const info = db
      .prepare('INSERT INTO conversations (user_lo, user_hi, started_at) VALUES (?, ?, ?)')
      .run(lo, hi, Date.now());
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  return conv;
}

function otherUserId(conv, me) {
  return conv.user_lo === me ? conv.user_hi : conv.user_lo;
}

function isBlocked(a, b) {
  const row = db
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    )
    .get(a, b, b, a);
  return Boolean(row);
}

function freeWindow(conv, user, now = Date.now()) {
  const unlimited = canChatUnlimited(user, now);
  const elapsed = now - conv.started_at;
  const remaining = Math.max(0, FREE_CHAT_MS - elapsed);
  const expired = remaining === 0 && !unlimited;
  return {
    startedAt: conv.started_at,
    freeMs: FREE_CHAT_MS,
    remainingMs: unlimited ? null : remaining,
    expired,
    paid: isPaid(user, now),
    special: isSpecial(user),
    canSend: !expired
  };
}

function aiUser() {
  return db.prepare('SELECT * FROM users WHERE is_ai = 1 LIMIT 1').get();
}

function startAiWelcome(user) {
  const ai = aiUser();
  if (!ai) return;
  const conv = getOrCreateConversation(user.id, ai.id);
  const existing = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conv.id);
  if (existing.n > 0) return conv;
  const lines = [
    `Welcome to sakarwine, ${user.username}. I’m Saka — I’ll show you around.`,
    'Home lists everyone. Online friends float to the top so you can tap and say hello.',
    'Each new conversation has 24 hours of free chatting. After that, everyone in the chat sees an upgrade prompt.',
    'Paid members can keep talking with unlimited people for the whole paid period. Level goes up by 1 each time admin approves an upgrade.',
    'Send a photo with the raised picture button, or a voice note with the mic. Video is not allowed.',
    'Photos stay softly locked until you reach Level 3 (three approved upgrades). Tap a locked photo to read why.',
    'Please don’t send Myanmar numbers starting with 09, and don’t start a message with @.',
    'You can delete a chat for yourself only — the other person still keeps the history. Sent messages cannot be edited.',
    'Forgot your 6-digit PIN? There is no self-serve reset — contact admin and give the phone you registered.'
  ];
  const ins = db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = Date.now();
  lines.forEach((body, i) => ins.run(conv.id, ai.id, 'text', body, now + i));
  return conv;
}

function serializeMessage(msg, viewer) {
  const sender = msg.sender_id
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(msg.sender_id)
    : null;
  const isImage = msg.type === 'image';
  const viewerLevel = viewer ? viewer.level : 0;
  const isAdminViewer = viewer && viewer._admin;
  const own = sender && viewer && sender.id === viewer.id;
  const canSeeImage =
    !isImage ||
    isAdminViewer ||
    own ||
    viewerLevel >= 3 ||
    isSpecial(viewer);
  let mediaUrl = null;
  if (msg.media_path) {
    if (msg.type === 'image') {
      mediaUrl = canSeeImage
        ? `/api/media/chat/${path.basename(msg.media_path)}`
        : null;
    } else if (msg.type === 'voice') {
      mediaUrl = `/api/media/voice/${path.basename(msg.media_path)}`;
    }
  }
  return {
    id: msg.id,
    conversationId: msg.conversation_id,
    type: msg.type,
    body: msg.body,
    createdAt: msg.created_at,
    sender: sender
      ? publicUser(sender, {
          online: isOnline(sender.id),
          viewer,
          includePrivate: Boolean(isAdminViewer)
        })
      : null,
    mediaUrl,
    imageLocked: isImage && !canSeeImage,
    editable: false
  };
}

function hiddenFor(conversationId, userId) {
  return db
    .prepare(
      'SELECT hidden_at, hidden_after_id FROM conversation_hides WHERE conversation_id = ? AND user_id = ?'
    )
    .get(conversationId, userId);
}

function listMessagesForViewer(convId, viewer) {
  const hide = viewer && !viewer._admin ? hiddenFor(convId, viewer.id) : null;
  const rows = hide
    ? db
        .prepare(
          'SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC'
        )
        .all(convId, hide.hidden_after_id)
    : db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(convId);
  return rows.map((m) => serializeMessage(m, viewer));
}

function hideConversationForUser(convId, userId, at = Date.now()) {
  const last = db.prepare('SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?').get(convId);
  const afterId = last && last.id ? last.id : 0;
  db.prepare(
    `INSERT INTO conversation_hides (conversation_id, user_id, hidden_at, hidden_after_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET
       hidden_at = excluded.hidden_at,
       hidden_after_id = excluded.hidden_after_id`
  ).run(convId, userId, at, afterId);
}

function rejectMessageEdit(_req, res) {
  res.status(403).json({ error: 'Messages cannot be edited.' });
}

app.get('/health', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true, name: getSetting(db, 'site_name', 'sakarwine') });
});

app.get('/api/public-settings', (_req, res) => {
  res.json({
    siteName: getSetting(db, 'site_name', 'sakarwine'),
    currency: getSetting(db, 'currency', 'MMK'),
    monthlyPrice: Number(getSetting(db, 'monthly_price', '15000')),
    paymentInstructions: getSetting(db, 'payment_instructions', ''),
    adminContact: getSetting(db, 'admin_contact', ''),
    quotes: allQuotes(Number(getSetting(db, 'monthly_price', '15000')))
  });
});

app.post('/api/register', multerSingle(uploadProfile, 'photo'), (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const gender = String(req.body.gender || '').trim();
    const birthYear = Number(req.body.birthYear);
    const phone = String(req.body.phone || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 letters, numbers, or underscore.' });
    }
    if (!/^\d{6}$/.test(password)) {
      return res.status(400).json({ error: 'Password must be exactly 6 digits.' });
    }
    if (!['male', 'female'].includes(gender)) {
      return res.status(400).json({ error: 'Please choose male or female.' });
    }
    const yearNow = new Date().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < 1940 || birthYear > yearNow - 18) {
      return res.status(400).json({ error: 'You must be at least 18. Check your birth year.' });
    }
    if (!/^[0-9+\s\-()]{7,20}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Profile photo is required.' });
    const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (taken) return res.status(409).json({ error: 'That username is already taken.' });
    if (username.toLowerCase() === 'saka') {
      return res.status(400).json({ error: 'That username is reserved.' });
    }
    const accountId = uniqueAccountId();
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (
          account_id, username, password_hash, gender, birth_year, phone,
          photo_path, level, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending_liveness', ?)`
      )
      .run(accountId, username, hash, gender, birthYear, phone, req.file.filename, Date.now());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = signToken();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      token,
      user.id,
      Date.now(),
      Date.now() + SESSION_MS
    );
    setCookie(res, 'sw_sid', token, SESSION_MS);
    res.json({ user: publicUser(user, { includePrivate: true, online: true }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user || user.is_ai) return res.status(401).json({ error: 'Wrong username or password.' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  if (user.status === 'closed') {
    return res.status(403).json({ error: 'This account is permanently closed.' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account is temporarily suspended. Contact admin with your registered phone.' });
  }
  const token = signToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    user.id,
    Date.now(),
    Date.now() + SESSION_MS
  );
  setCookie(res, 'sw_sid', token, SESSION_MS);
  res.json({ user: publicUser(user, { includePrivate: true, online: true }) });
});

app.post('/api/logout', requireUser, (req, res) => {
  const token = req.cookies.sw_sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  clearCookie(res, 'sw_sid');
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: publicUser(req.user, { includePrivate: true, online: true }),
    siteName: getSetting(db, 'site_name', 'sakarwine')
  });
});

app.post('/api/me/liveness', requireUser, (req, res) => {
  const left = Boolean(req.body.left);
  const right = Boolean(req.body.right);
  const estimatedGender = ['male', 'female', 'unknown'].includes(req.body.estimatedGender)
    ? req.body.estimatedGender
    : 'unknown';
  if (!left || !right) {
    return res.status(400).json({ error: 'Turn your head left, then right, to finish the scan.' });
  }
  db.prepare(
    `UPDATE users SET estimated_gender = ?, status = CASE WHEN status = 'pending_liveness' THEN 'active' ELSE status END
     WHERE id = ?`
  ).run(estimatedGender, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const conv = startAiWelcome(user);
  res.json({
    user: publicUser(user, { includePrivate: true, online: true }),
    aiConversationId: conv ? conv.id : null,
    genderMatch: estimatedGender === 'unknown' || estimatedGender === user.gender
  });
});

app.post('/api/me/tour-complete', requireUser, requireActive, (req, res) => {
  db.prepare('UPDATE users SET tour_completed = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/users', requireUser, requireActive, (req, res) => {
  const blocked = db
    .prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?')
    .all(req.user.id)
    .map((r) => r.blocked_id);
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE id != ? AND status = 'active' AND is_ai IN (0, 1)
       ORDER BY is_ai DESC, username COLLATE NOCASE`
    )
    .all(req.user.id);
  const users = rows
    .map((row) => {
      const u = publicUser(row, { online: isOnline(row.id), viewer: req.user });
      u.blocked = blocked.includes(row.id);
      return u;
    })
    .sort((a, b) => {
      if (a.isAi !== b.isAi) return a.isAi ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
  res.json({ users });
});

app.post('/api/users/:id/block', requireUser, requireActive, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target || target.is_ai) return res.status(400).json({ error: 'You cannot block this account.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    req.user.id,
    target.id,
    Date.now()
  );
  res.json({ ok: true });
});

app.delete('/api/users/:id/block', requireUser, requireActive, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(
    req.user.id,
    Number(req.params.id)
  );
  res.json({ ok: true });
});

app.post('/api/conversations/with/:userId', requireUser, requireActive, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.userId));
  if (!target || target.status !== 'active') return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot chat with yourself.' });
  const theyBlocked = db
    .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(target.id, req.user.id);
  if (theyBlocked) {
    return res.status(403).json({ error: 'This chat is blocked.' });
  }
  const conv = getOrCreateConversation(req.user.id, target.id);
  res.json({
    conversation: {
      id: conv.id,
      peer: publicUser(target, { online: isOnline(target.id), viewer: req.user }),
      window: freeWindow(conv, req.user)
    }
  });
});

app.get('/api/conversations/:id', requireUser, requireActive, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, req.user.id));
  const messages = listMessagesForViewer(conv.id, req.user);
  const blocked =
    db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, peer.id) != null;
  res.json({
    conversation: {
      id: conv.id,
      peer: publicUser(peer, { online: isOnline(peer.id), viewer: req.user }),
      window: freeWindow(conv, req.user),
      blocked,
      canDelete: !peer.is_ai,
      messagesEditable: false,
      hiddenAt: (hiddenFor(conv.id, req.user.id) || {}).hidden_at || null
    },
    messages
  });
}

app.delete('/api/conversations/:id', requireUser, requireActive, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, req.user.id));
  if (peer && peer.is_ai) {
    return res.status(400).json({ error: 'You cannot delete the Saka guide chat.' });
  }
  hideConversationForUser(conv.id, req.user.id);
  res.json({ ok: true, hiddenFor: 'self' });
});

app.post(
  '/api/conversations/:id/messages',
  requireUser,
  requireActive,
  multerSingle(uploadChat, 'file'),
  (req, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
    if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    const peerId = otherUserId(conv, req.user.id);
    const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(peerId);
    if (isBlocked(req.user.id, peerId)) {
      return res.status(403).json({ error: 'This chat is blocked.' });
    }
    if (peer.status !== 'active') {
      return res.status(403).json({ error: 'This account is no longer available.' });
    }
    const win = freeWindow(conv, req.user);
    if (!win.canSend) {
      return res.status(402).json({
        error: 'Free chatting has ended. Upgrade to keep talking.',
        code: 'UPGRADE',
        window: win
      });
    }
    const kind = String(req.body.type || (req.file ? 'file' : 'text'));
    let type = 'text';
    let body = String(req.body.body || '').trim();
    let mediaPath = null;
    if (req.file) {
      if (isForbiddenVideo(req.file.mimetype, req.file.originalname)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Video is not allowed.' });
      }
      if (isAllowedImageMime(req.file.mimetype) && kind !== 'voice') {
        type = 'image';
        mediaPath = req.file.filename;
        body = body || '';
      } else if (isAllowedVoiceMime(req.file.mimetype) || kind === 'voice') {
        type = 'voice';
        mediaPath = req.file.filename;
        body = '';
      } else {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Unsupported file type.' });
      }
    } else {
      const err = messageFilterError(body);
      if (err) return res.status(400).json({ error: err });
    }
    if (type === 'text') {
      const err = messageFilterError(body);
      if (err) return res.status(400).json({ error: err });
    }
    const info = db
      .prepare(
        'INSERT INTO messages (conversation_id, sender_id, type, body, media_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(conv.id, req.user.id, type, body || null, mediaPath, Date.now());
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    const forMe = serializeMessage(msg, req.user);
    const forPeer = serializeMessage(msg, peer);
    emitToUser(peerId, 'message', { conversationId: conv.id, message: forPeer });
    emitToUser(req.user.id, 'message', { conversationId: conv.id, message: forMe });
    res.json({ message: forMe, window: freeWindow(conv, req.user) });
  }
);

app.put('/api/conversations/:id/messages/:messageId', requireUser, rejectMessageEdit);
app.patch('/api/conversations/:id/messages/:messageId', requireUser, rejectMessageEdit);
app.put('/api/messages/:id', requireUser, rejectMessageEdit);
app.patch('/api/messages/:id', requireUser, rejectMessageEdit);

app.get('/api/upgrade/quote', requireUser, requireActive, (req, res) => {
  const months = Number(req.query.months);
  const monthly = Number(getSetting(db, 'monthly_price', '15000'));
  const quote = quotePlan(monthly, months);
  if (!quote) return res.status(400).json({ error: 'Choose 1 to 12 months.' });
  res.json({
    quote,
    currency: getSetting(db, 'currency', 'MMK'),
    accountId: req.user.account_id,
    paymentInstructions: getSetting(db, 'payment_instructions', '')
  });
});

app.post('/api/upgrade', requireUser, requireActive, multerSingle(uploadReceipt, 'receipt'), (req, res) => {
  const months = clampMonths(Number(req.body.months));
  if (!months) return res.status(400).json({ error: 'Choose 1 to 12 months.' });
  const accountId = String(req.body.accountId || req.user.account_id).trim();
  if (accountId !== req.user.account_id) {
    return res.status(400).json({ error: 'Account ID must match the signed-in account.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Upload your payment transfer screenshot.' });
  const pending = db
    .prepare('SELECT id FROM upgrades WHERE user_id = ? AND status = ?')
    .get(req.user.id, 'pending');
  if (pending) return res.status(409).json({ error: 'You already have a pending upgrade. Wait for admin.' });
  const monthly = Number(getSetting(db, 'monthly_price', '15000'));
  const quote = quotePlan(monthly, months);
  const info = db
    .prepare(
      `INSERT INTO upgrades (user_id, account_id, months, amount, currency, receipt_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      req.user.id,
      req.user.account_id,
      quote.months,
      quote.amount,
      getSetting(db, 'currency', 'MMK'),
      req.file.filename,
      Date.now()
    );
  io.to('admins').emit('upgrade:new', { id: info.lastInsertRowid, accountId: req.user.account_id });
  res.json({ ok: true, id: info.lastInsertRowid, quote });
});

app.get('/api/upgrade/mine', requireUser, requireActive, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM upgrades WHERE user_id = ? ORDER BY id DESC LIMIT 20')
    .all(req.user.id)
    .map((u) => ({
      id: u.id,
      months: u.months,
      amount: u.amount,
      currency: u.currency,
      status: u.status,
      createdAt: u.created_at,
      reviewedAt: u.reviewed_at
    }));
  res.json({ upgrades: rows, user: publicUser(req.user, { includePrivate: true }) });
});

function sendUpload(res, subdir, filename) {
  const safe = path.basename(filename);
  const full = path.join(UPLOADS, subdir, safe);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
}

app.get('/api/media/profile/:file', requireUser, (req, res) => sendUpload(res, 'profiles', req.params.file));

app.get('/api/media/chat/:file', requireUser, (req, res) => {
  const file = path.basename(req.params.file);
  const msg = db.prepare('SELECT * FROM messages WHERE media_path = ? AND type = ?').get(file, 'image');
  if (!msg) return res.status(404).end();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(msg.conversation_id);
  const admin = currentAdmin(req);
  const member = conv && (conv.user_lo === req.user.id || conv.user_hi === req.user.id);
  if (!admin && !member) return res.status(403).end();
  const own = msg.sender_id === req.user.id;
  if (!admin && !own && req.user.level < 3 && !isSpecial(req.user)) {
    return res.status(403).json({
      error: 'Photos unlock at Level 3 (three approved upgrades).',
      code: 'IMAGE_LOCK'
    });
  }
  sendUpload(res, 'chat', file);
});

app.get('/api/media/voice/:file', requireUser, (req, res) => {
  const file = path.basename(req.params.file);
  const msg = db.prepare('SELECT * FROM messages WHERE media_path = ? AND type = ?').get(file, 'voice');
  if (!msg) return res.status(404).end();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(msg.conversation_id);
  const admin = currentAdmin(req);
  const member = conv && (conv.user_lo === req.user.id || conv.user_hi === req.user.id);
  if (!admin && !member) return res.status(403).end();
  sendUpload(res, 'voice', file);
});

app.get('/api/media/receipt/:file', requireAdmin, (req, res) => sendUpload(res, 'receipts', req.params.file));

app.post('/api/admin/login', (req, res) => {
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  const userOk = username === ADMIN_USERNAME;
  const passOk =
    password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!userOk || !passOk) return res.status(401).json({ error: 'Wrong admin username or password.' });
  const token = signToken();
  db.prepare('INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(
    token,
    Date.now(),
    Date.now() + SESSION_MS
  );
  setCookie(res, 'sw_aid', token, SESSION_MS);
  res.json({ ok: true, username: ADMIN_USERNAME });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.cookies.sw_aid;
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  clearCookie(res, 'sw_aid');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  const pending = db.prepare("SELECT COUNT(*) AS n FROM upgrades WHERE status = 'pending'").get().n;
  res.json({
    ok: true,
    username: ADMIN_USERNAME,
    pendingUpgrades: pending,
    siteName: getSetting(db, 'site_name', 'sakarwine')
  });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_ai = 0").get().n;
  const active = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_ai = 0").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM upgrades WHERE status = 'pending'").get().n;
  const chats = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
  res.json({ users, active, pendingUpgrades: pending, conversations: chats, online: online.size });
});

app.get('/api/admin/accounts', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM users WHERE is_ai = 0 ORDER BY id DESC').all();
  res.json({
    accounts: rows.map((u) =>
      publicUser(u, { online: isOnline(u.id), includePrivate: true })
    ),
    badges: getBadges(db)
  });
});

app.get('/api/admin/search', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ matches: [] });
  const safe = q.replace(/[%_]/g, '');
  const like = `%${safe}%`;
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE is_ai = 0 AND (
         account_id LIKE ? COLLATE NOCASE
         OR username LIKE ? COLLATE NOCASE
         OR phone LIKE ?
       )
       ORDER BY CASE WHEN account_id = ? COLLATE NOCASE THEN 0
                     WHEN account_id LIKE ? COLLATE NOCASE THEN 1
                     ELSE 2 END, id DESC
       LIMIT 20`
    )
    .all(like, like, like, q, `${safe}%`);
  res.json({
    matches: rows.map((u) => publicUser(u, { online: isOnline(u.id), includePrivate: true }))
  });
});

function serializeUpgradeRow(u) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.user_id);
  return {
    id: u.id,
    userId: u.user_id,
    accountId: u.account_id,
    months: u.months,
    amount: u.amount,
    currency: u.currency,
    status: u.status,
    createdAt: u.created_at,
    reviewedAt: u.reviewed_at,
    receiptUrl: u.receipt_path ? `/api/media/receipt/${u.receipt_path}` : null,
    phone: user ? user.phone : null,
    username: user ? user.username : null,
    level: user ? user.level : null
  };
}

app.get('/api/admin/dossier', requireAdmin, (req, res) => {
  const q = String(req.query.q || req.query.accountId || '').trim();
  if (!q) return res.status(400).json({ error: 'Type an account ID.' });
  let user = db.prepare('SELECT * FROM users WHERE account_id = ? COLLATE NOCASE AND is_ai = 0').get(q);
  if (!user && /^\d+$/.test(q)) {
    user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(Number(q));
  }
  if (!user) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const hits = db
      .prepare(
        `SELECT * FROM users WHERE is_ai = 0 AND account_id LIKE ? COLLATE NOCASE
         ORDER BY id DESC LIMIT 8`
      )
      .all(like);
    if (hits.length === 1) user = hits[0];
    else {
      return res.status(404).json({
        error: hits.length ? 'Several accounts match. Pick one from the list.' : 'No account found for that ID.',
        matches: hits.map((u) => publicUser(u, { includePrivate: true, online: isOnline(u.id) }))
      });
    }
  }
  const convos = db
    .prepare('SELECT * FROM conversations WHERE user_lo = ? OR user_hi = ? ORDER BY id DESC')
    .all(user.id, user.id)
    .map((c) => {
      const peerId = c.user_lo === user.id ? c.user_hi : c.user_lo;
      const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(peerId);
      const last = db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
        .get(c.id);
      const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(c.id).n;
      return {
        id: c.id,
        startedAt: c.started_at,
        messageCount: count,
        peer: publicUser(peer, { includePrivate: true, online: isOnline(peerId) }),
        lastMessage: last ? { type: last.type, body: last.body, createdAt: last.created_at } : null
      };
    });
  const upgrades = db
    .prepare('SELECT * FROM upgrades WHERE user_id = ? ORDER BY id DESC')
    .all(user.id)
    .map(serializeUpgradeRow);
  const blocked = db
    .prepare(
      `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`
    )
    .all(user.id)
    .map((u) => publicUser(u, { includePrivate: true }));
  const blockedBy = db
    .prepare(
      `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocker_id WHERE b.blocked_id = ?`
    )
    .all(user.id)
    .map((u) => publicUser(u, { includePrivate: true }));
  res.json({
    user: publicUser(user, { includePrivate: true, online: isOnline(user.id) }),
    conversations: convos,
    upgrades,
    blocked,
    blockedBy,
    badges: getBadges(db)
  });
});

app.post('/api/admin/accounts', requireAdmin, multerSingle(uploadProfile, 'photo'), (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const gender = String(req.body.gender || '').trim();
    const birthYear = Number(req.body.birthYear);
    const phone = String(req.body.phone || '').trim();
    let badge = String(req.body.badge || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 letters, numbers, or underscore.' });
    }
    if (username.toLowerCase() === 'saka') {
      return res.status(400).json({ error: 'That username is reserved.' });
    }
    if (!/^\d{6}$/.test(password)) {
      return res.status(400).json({ error: 'Password must be exactly 6 digits.' });
    }
    if (!['male', 'female'].includes(gender)) {
      return res.status(400).json({ error: 'Please choose male or female.' });
    }
    const yearNow = new Date().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < 1940 || birthYear > yearNow - 16) {
      return res.status(400).json({ error: 'Check the birth year.' });
    }
    if (!/^[0-9+\s\-()]{7,20}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (!badge) return res.status(400).json({ error: 'Choose a role badge.' });
    if (badge.length > 24) return res.status(400).json({ error: 'Badge label is too long.' });
    const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (taken) return res.status(409).json({ error: 'That username is already taken.' });
    addBadge(db, badge);
    const known = getBadges(db);
    const matched = known.find((b) => b.toLowerCase() === badge.toLowerCase());
    badge = matched || badge;
    const accountId = uniqueAccountId();
    const hash = bcrypt.hashSync(password, 10);
    const photo = req.file ? req.file.filename : null;
    const info = db
      .prepare(
        `INSERT INTO users (
          account_id, username, password_hash, gender, birth_year, phone,
          photo_path, level, status, is_special, badge, hide_account_id, created_by_admin,
          tour_completed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', 1, ?, 1, 1, 1, ?)`
      )
      .run(accountId, username, hash, gender, birthYear, phone, photo, badge, Date.now());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({
      user: publicUser(user, { includePrivate: true, online: false }),
      badges: getBadges(db)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the special account.' });
  }
});

app.post('/api/admin/accounts/:id/hide-id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE users SET hide_account_id = 1 WHERE id = ?').run(id);
  res.json({ ok: true, hideAccountId: true });
});

app.post('/api/admin/accounts/:id/unhide-id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE users SET hide_account_id = 0 WHERE id = ?').run(id);
  res.json({ ok: true, hideAccountId: false });
});

app.post('/api/admin/accounts/:id/badge', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  let badge = String(req.body.badge || '').trim();
  if (!badge) return res.status(400).json({ error: 'Choose a role badge.' });
  if (badge.length > 24) return res.status(400).json({ error: 'Badge label is too long.' });
  addBadge(db, badge);
  const matched = getBadges(db).find((b) => b.toLowerCase() === badge.toLowerCase());
  badge = matched || badge;
  db.prepare('UPDATE users SET badge = ?, is_special = 1 WHERE id = ?').run(badge, id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated, { includePrivate: true }) });
});

app.post('/api/admin/accounts/:id/suspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  emitToUser(id, 'account:status', { status: 'suspended' });
  res.json({ ok: true });
});

app.post('/api/admin/accounts/:id/unsuspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.status === 'closed') return res.status(400).json({ error: 'Closed accounts cannot be reopened.' });
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.post('/api/admin/accounts/:id/close', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare("UPDATE users SET status = 'closed' WHERE id = ?").run(id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  emitToUser(id, 'account:status', { status: 'closed' });
  res.json({ ok: true });
});

app.post('/api/admin/accounts/:id/reset-password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const phone = String(req.body.phone || '').trim();
  if (phone && phone !== user.phone) {
    return res.status(400).json({ error: 'Phone does not match the registered number.' });
  }
  const password = String(req.body.password || '');
  if (!/^\d{6}$/.test(password)) return res.status(400).json({ error: 'New password must be exactly 6 digits.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/admin/conversations', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM conversations ORDER BY id DESC').all();
  const list = rows.map((c) => {
    const a = db.prepare('SELECT * FROM users WHERE id = ?').get(c.user_lo);
    const b = db.prepare('SELECT * FROM users WHERE id = ?').get(c.user_hi);
    const last = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
      .get(c.id);
    return {
      id: c.id,
      startedAt: c.started_at,
      users: [publicUser(a, { includePrivate: true }), publicUser(b, { includePrivate: true })],
      lastMessage: last
        ? { type: last.type, body: last.body, createdAt: last.created_at }
        : null
    };
  });
  res.json({ conversations: list });
});

app.get('/api/admin/conversations/:id', requireAdmin, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  const a = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_lo);
  const b = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_hi);
  const adminViewer = { id: 0, level: 99, _admin: true };
  const messages = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conv.id)
    .map((m) => serializeMessage(m, adminViewer));
  res.json({
    conversation: {
      id: conv.id,
      startedAt: conv.started_at,
      users: [publicUser(a, { includePrivate: true }), publicUser(b, { includePrivate: true })]
    },
    messages
  });
});

app.post('/api/admin/conversations/:id/expire-free', requireAdmin, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  db.prepare('UPDATE conversations SET started_at = ? WHERE id = ?').run(Date.now() - FREE_CHAT_MS - 1000, conv.id);
  res.json({ ok: true });
});

app.get('/api/admin/upgrades', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM upgrades ORDER BY id DESC').all();
  res.json({ upgrades: rows.map(serializeUpgradeRow) });
});

app.post('/api/admin/upgrades/:id/approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const up = db.prepare('SELECT * FROM upgrades WHERE id = ?').get(id);
  if (!up) return res.status(404).json({ error: 'Upgrade not found.' });
  if (up.status !== 'pending') return res.status(400).json({ error: 'This request was already reviewed.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(up.user_id);
  const now = Date.now();
  const base = isPaid(user, now) ? user.paid_until : now;
  const paidUntil = addMonths(base, up.months);
  db.prepare(
    'UPDATE users SET level = level + 1, paid_until = ?, status = CASE WHEN status = ? THEN ? ELSE status END WHERE id = ?'
  ).run(paidUntil, 'pending_liveness', 'active', user.id);
  db.prepare("UPDATE upgrades SET status = 'approved', reviewed_at = ? WHERE id = ?").run(now, id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  emitToUser(user.id, 'upgrade:approved', {
    months: up.months,
    paidUntil,
    level: updated.level
  });
  res.json({ ok: true, user: publicUser(updated, { includePrivate: true }) });
});

app.post('/api/admin/upgrades/:id/reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const up = db.prepare('SELECT * FROM upgrades WHERE id = ?').get(id);
  if (!up) return res.status(404).json({ error: 'Upgrade not found.' });
  if (up.status !== 'pending') return res.status(400).json({ error: 'This request was already reviewed.' });
  db.prepare("UPDATE upgrades SET status = 'rejected', reviewed_at = ? WHERE id = ?").run(Date.now(), id);
  emitToUser(up.user_id, 'upgrade:rejected', { id });
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const monthly = Number(getSetting(db, 'monthly_price', '15000'));
  res.json({
    siteName: getSetting(db, 'site_name', 'sakarwine'),
    monthlyPrice: monthly,
    currency: getSetting(db, 'currency', 'MMK'),
    paymentInstructions: getSetting(db, 'payment_instructions', ''),
    adminContact: getSetting(db, 'admin_contact', ''),
    quotes: allQuotes(monthly),
    badges: getBadges(db)
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  if (req.body.siteName != null) setSetting(db, 'site_name', String(req.body.siteName).slice(0, 40));
  if (req.body.monthlyPrice != null) {
    const n = Number(req.body.monthlyPrice);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Invalid monthly price.' });
    setSetting(db, 'monthly_price', String(Math.round(n)));
  }
  if (req.body.currency != null) setSetting(db, 'currency', String(req.body.currency).slice(0, 8));
  if (req.body.paymentInstructions != null) {
    setSetting(db, 'payment_instructions', String(req.body.paymentInstructions).slice(0, 2000));
  }
  if (req.body.adminContact != null) setSetting(db, 'admin_contact', String(req.body.adminContact).slice(0, 500));
  if (Array.isArray(req.body.badges)) {
    const cleaned = req.body.badges.map((b) => String(b || '').trim()).filter((b) => b && b.length <= 24);
    const merged = [];
    for (const label of ['Admin', 'officer', 'sponsor', 'VVIP', ...cleaned]) {
      if (!merged.some((x) => x.toLowerCase() === label.toLowerCase())) merged.push(label);
    }
    setSetting(db, 'badges', JSON.stringify(merged));
  }
  const monthly = Number(getSetting(db, 'monthly_price', '15000'));
  res.json({
    ok: true,
    siteName: getSetting(db, 'site_name', 'sakarwine'),
    monthlyPrice: monthly,
    currency: getSetting(db, 'currency', 'MMK'),
    paymentInstructions: getSetting(db, 'payment_instructions', ''),
    adminContact: getSetting(db, 'admin_contact', ''),
    quotes: allQuotes(monthly),
    badges: getBadges(db)
  });
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error.' });
});

io.use((socket, next) => {
  const cookies = parseCookies(socket.request.headers.cookie);
  if (cookies.sw_aid) {
    const admin = db
      .prepare('SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?')
      .get(cookies.sw_aid, Date.now());
    if (admin) {
      socket.data.admin = true;
      return next();
    }
  }
  const token = cookies.sw_sid;
  if (!token) return next(new Error('auth'));
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  if (!row || row.status === 'closed' || row.status === 'suspended') return next(new Error('auth'));
  socket.data.user = row;
  next();
});

io.on('connection', (socket) => {
  if (socket.data.admin) {
    socket.join('admins');
    return;
  }
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  addOnline(user.id, socket.id);
  socket.broadcast.emit('presence', { userId: user.id, online: true });

  socket.on('typing', (payload) => {
    const conversationId = Number(payload && payload.conversationId);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) return;
    const peer = otherUserId(conv, user.id);
    emitToUser(peer, 'typing', { conversationId, userId: user.id, typing: Boolean(payload.typing) });
  });

  socket.on('disconnect', () => {
    removeOnline(user.id, socket.id);
    if (!isOnline(user.id)) {
      socket.broadcast.emit('presence', { userId: user.id, online: false });
    }
  });
});

function start() {
  server.listen(PORT, HOST, () => {
    console.log(`sakarwine listening on http://${HOST}:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = { app, server, db, start, DATA_DIR, FREE_CHAT_MS };
