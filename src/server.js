'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { openDb, ensureDir, getSetting, setSetting, getBadges, addBadge, publicUser, adminUser, isAdminAccount, defaultAvatarUrl } = require('./db');
const { messageFilterError, bioFilterError, groupNameError, isAllowedImageMime, isAllowedVoiceMime, isForbiddenVideo } = require('./filters');
const { usernameError } = require('./username');
const { translateText, normalizeLang } = require('./translate');
const { quotePlan, allQuotes, addMonths, isPaid, isSpecial, canChatUnlimited, clampMonths } = require('./pricing');
const {
  HOST_CREDIT_AMOUNT,
  HOST_WITHDRAW_MIN,
  markPresence,
  hostIncomeSummary,
  mutualSnapshot,
  voidSession,
  requestPayout,
  listPayouts,
  assignHostCode,
  findHostByCode,
  creditHostForUpgrade
} = require('./hostIncome');
const { rateLimit, securityHeaders, csrfGuard, rejectClientPrivilege, safeEqual } = require('./security');
const {
  AD_ROTATE_MS,
  OFFLINE_PURGE_MS,
  listAds,
  addAd,
  deleteAd,
  purgeStaleAccounts
} = require('./platform');

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
ensureDir(path.join(UPLOADS, 'nrc'));
ensureDir(path.join(UPLOADS, 'ads'));
ensureDir(path.join(UPLOADS, 'broadcast'));
ensureDir(path.join(UPLOADS, 'groups'));

const db = openDb(DATA_DIR);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6, cors: { origin: false } });

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
    secure: process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
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
      const ext = mimeExt(file.mimetype) || '.bin';
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
      const ext = mimeExt(file.mimetype) || '.bin';
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

const uploadRegister = multer({
  storage: storageFor('profiles'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) {
      return cb(new Error('Profile photo must be an image.'));
    }
    cb(null, true);
  }
});

const uploadGroup = multer({
  storage: storageFor('groups'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) return cb(new Error('Group logo must be an image.'));
    cb(null, true);
  }
});

const uploadNrc = multer({
  storage: storageFor('nrc'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) return cb(new Error('NRC photos must be images.'));
    cb(null, true);
  }
});

const uploadAd = multer({
  storage: storageFor('ads'),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) return cb(new Error('Banner must be an image.'));
    cb(null, true);
  }
});

const uploadBroadcast = multer({
  storage: storageFor('chat'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && !isAllowedImageMime(file.mimetype)) {
      return cb(new Error('Broadcast image must be an image file.'));
    }
    cb(null, true);
  }
});

function multerSingle(uploader, field) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (!err) {
        if (!currentAdmin(req)) rejectClientPrivilege(req.body);
        return next();
      }
      res.status(400).json({ error: err.message || 'Upload failed.' });
    });
  };
}

function multerFields(uploader, fields) {
  return (req, res, next) => {
    uploader.fields(fields)(req, res, (err) => {
      if (!err) {
        if (!currentAdmin(req)) rejectClientPrivilege(req.body);
        return next();
      }
      res.status(400).json({ error: err.message || 'Upload failed.' });
    });
  };
}

function firstFile(req, name) {
  const bag = req.files && req.files[name];
  return bag && bag[0] ? bag[0] : null;
}

function unlinkQuiet(file) {
  if (file && file.path) fs.unlink(file.path, () => {});
}

function parseIdDocType(body) {
  const raw = String((body && (body.idType || body.idDocType || body.docType)) || 'nrc')
    .trim()
    .toLowerCase();
  return raw === 'passport' ? 'passport' : 'nrc';
}

function takeHostIdPhotos(req, idType) {
  const front = firstFile(req, 'nrcFront');
  const back = firstFile(req, 'nrcBack');
  if (idType === 'passport') {
    if (!front) {
      unlinkQuiet(front);
      unlinkQuiet(back);
      return { error: 'Upload a passport photo.' };
    }
    unlinkQuiet(back);
    return { front, back: null };
  }
  if (!front || !back) {
    unlinkQuiet(front);
    unlinkQuiet(back);
    return { error: 'Upload Myanmar NRC front and back photos.' };
  }
  return { front, back };
}

function replaceHostIdFiles(user) {
  if (user.nrc_front_path) {
    unlinkQuiet({ path: path.join(UPLOADS, 'nrc', path.basename(user.nrc_front_path)) });
  }
  if (user.nrc_back_path) {
    unlinkQuiet({ path: path.join(UPLOADS, 'nrc', path.basename(user.nrc_back_path)) });
  }
}

function hostIdDocsReady(user) {
  if (!user || !user.nrc_front_path) return false;
  if (user.id_doc_type === 'passport') return true;
  return Boolean(user.nrc_back_path);
}

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(csrfGuard);
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
  rejectClientPrivilege(req.body);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
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

function getOrCreateConversation(userA, userB, openedBy) {
  const [lo, hi] = pairIds(userA, userB);
  let conv = db.prepare('SELECT * FROM conversations WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
  if (!conv) {
    const info = db
      .prepare(
        'INSERT INTO conversations (user_lo, user_hi, started_at, opened_by, member_messaging) VALUES (?, ?, ?, ?, 1)'
      )
      .run(lo, hi, Date.now(), openedBy || userA);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  return conv;
}

function findConversation(userA, userB) {
  const [lo, hi] = pairIds(userA, userB);
  return db.prepare('SELECT * FROM conversations WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
}

function otherUserId(conv, me) {
  return conv.user_lo === me ? conv.user_hi : conv.user_lo;
}

function adminHasMessaged(conv) {
  const ids = [conv.user_lo, conv.user_hi];
  const adminIds = ids.filter((id) => {
    const row = db.prepare('SELECT badge FROM users WHERE id = ?').get(id);
    return isAdminAccount(row);
  });
  if (!adminIds.length) return true;
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM messages
       WHERE conversation_id = ? AND sender_id IN (${adminIds.map(() => '?').join(',')})
         AND type != 'system'
       LIMIT 1`
    )
    .get(conv.id, ...adminIds);
  return Boolean(row);
}

function memberMessagingOpen(conv) {
  return Number(conv && conv.member_messaging) !== 0;
}

function adminChatGate(conv, viewer) {
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, viewer.id));
  const viewerAdmin = isAdminAccount(viewer);
  const peerAdmin = isAdminAccount(peer);
  const involvesAdmin = viewerAdmin || peerAdmin;
  const messagingOpen = memberMessagingOpen(conv);
  const adminMessaged = involvesAdmin ? adminHasMessaged(conv) : true;
  const waitForAdmin = involvesAdmin && !viewerAdmin && !adminMessaged;
  const closedForMember = involvesAdmin && !viewerAdmin && !messagingOpen;
  let deny = null;
  if (closedForMember) deny = 'This chat is closed by admin.';
  else if (waitForAdmin) deny = 'Wait for the admin to send a message first.';
  return {
    involvesAdmin,
    messagingOpen,
    waitForAdmin,
    closed: involvesAdmin && !messagingOpen,
    canToggleMessaging: viewerAdmin && involvesAdmin,
    canSend: !deny,
    error: deny
  };
}

function emitAdminGate(conv) {
  if (!conv) return;
  const a = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_lo);
  const b = db.prepare('SELECT * FROM users WHERE id = ?').get(conv.user_hi);
  if (!isAdminAccount(a) && !isAdminAccount(b)) return;
  emitToUser(a.id, 'chat:gate', { conversationId: conv.id, adminGate: adminChatGate(conv, a) });
  emitToUser(b.id, 'chat:gate', { conversationId: conv.id, adminGate: adminChatGate(conv, b) });
}

function conversationInvolvesAdmin(conv) {
  if (!conv) return false;
  const a = db.prepare('SELECT badge FROM users WHERE id = ?').get(conv.user_lo);
  const b = db.prepare('SELECT badge FROM users WHERE id = ?').get(conv.user_hi);
  return isAdminAccount(a) || isAdminAccount(b);
}

function setMemberMessaging(convId, open, emitTo) {
  const flag = open ? 1 : 0;
  db.prepare('UPDATE conversations SET member_messaging = ? WHERE id = ?').run(flag, convId);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (typeof emitTo === 'function' && conv) {
    const payload = { conversationId: conv.id, messagingOpen: Boolean(flag) };
    emitTo(conv.user_lo, 'chat:messaging', payload);
    emitTo(conv.user_hi, 'chat:messaging', payload);
  }
  emitAdminGate(conv);
  return conv;
}

function isBlocked(a, b) {
  const row = db
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    )
    .get(a, b, b, a);
  return Boolean(row);
}

function hostRepliesToVisitor(conv, user) {
  if (!user || !user.is_host || !conv) return false;
  const opener = Number(conv.opened_by);
  return opener && opener !== Number(user.id);
}

function freeWindow(conv, user, now = Date.now()) {
  const hostFree = hostRepliesToVisitor(conv, user);
  const unlimited = canChatUnlimited(user, now) || hostFree;
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
    hostVisitorChat: hostFree,
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
  const ins = db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, type, body, created_at, source_lang) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const now = Date.now();
  ins.run(conv.id, ai.id, 'text', '__SW__:welcome', now, 'my');
  ins.run(conv.id, null, 'system', '__SW__:rules', now + 1, null);
  if (user.gender === 'female') {
    ins.run(conv.id, null, 'system', '__SW__:host', now + 2, null);
  }
  return conv;
}

function insertSystemMessage(userId, body, mediaPath = null) {
  const ai = aiUser();
  if (!ai) return null;
  const conv = getOrCreateConversation(userId, ai.id, ai.id);
  const type = mediaPath ? 'image' : 'system';
  const info = db
    .prepare(
      'INSERT INTO messages (conversation_id, sender_id, type, body, media_path, created_at, source_lang) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(conv.id, null, type, body || null, mediaPath, Date.now(), null);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  emitTranslated(userId, conv.id, msg, user);
  return msg;
}

function userLang(user) {
  return normalizeLang(user && user.ui_lang) || 'my';
}

function getConversationLang(userId, conversationId) {
  const row = db
    .prepare('SELECT lang FROM conversation_langs WHERE user_id = ? AND conversation_id = ?')
    .get(userId, conversationId);
  return row ? normalizeLang(row.lang) : null;
}

function setConversationLang(userId, conversationId, lang) {
  const code = normalizeLang(lang);
  if (!code) return null;
  db.prepare(
    `INSERT INTO conversation_langs (user_id, conversation_id, lang, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, conversation_id) DO UPDATE SET lang = excluded.lang`
  ).run(userId, conversationId, code, Date.now());
  return code;
}

function chosenViewLang(user, conversationId) {
  return getConversationLang(user.id, conversationId) || normalizeLang(user && user.chat_view_lang) || null;
}

function conversationViewMeta(user, conv, peer, messages) {
  const ui = userLang(user);
  const chosen = chosenViewLang(user, conv.id);
  const peerLang = userLang(peer);
  const otherSources = (messages || [])
    .filter((m) => m.sender && m.sender.id !== user.id && m.sourceLang)
    .map((m) => m.sourceLang);
  const mismatch = (peerLang && peerLang !== ui) || otherSources.some((s) => s && s !== ui);
  if (chosen) return { viewLang: chosen, askViewLang: false, peerLang };
  if (!mismatch) return { viewLang: ui, askViewLang: false, peerLang };
  return { viewLang: null, askViewLang: true, peerLang };
}

async function cachedTranslate(messageId, original, from, to) {
  if (!original || !to || from === to) return original;
  const hit = db
    .prepare('SELECT body FROM message_translations WHERE message_id = ? AND lang = ?')
    .get(messageId, to);
  if (hit) return hit.body;
  const translated = await translateText(original, from, to);
  if (!translated || translated === original) return original;
  db.prepare(
    'INSERT OR REPLACE INTO message_translations (message_id, lang, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(messageId, to, translated, Date.now());
  return translated;
}

async function applyTranslations(messages, viewLang) {
  const lang = normalizeLang(viewLang);
  if (!lang || !messages) return messages || [];
  for (const m of messages) {
    if (!m || !m.body || !m.sender) continue;
    if (m.type === 'system' || m.type === 'voice') continue;
    if (m.type !== 'text' && m.type !== 'image') continue;
    const from = normalizeLang(m.sourceLang);
    if (!from || from === lang) continue;
    const original = m.originalBody || m.body;
    const translated = await cachedTranslate(m.id, original, from, lang);
    if (translated && translated !== original) {
      m.body = translated;
      m.translated = true;
      m.viewLang = lang;
    }
  }
  return messages;
}

async function emitTranslated(userId, conversationId, msg, viewer) {
  const payload = serializeMessage(msg, viewer);
  const lang = viewer ? chosenViewLang(viewer, conversationId) : null;
  if (lang) await applyTranslations([payload], lang);
  emitToUser(userId, 'message', { conversationId, message: payload });
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
    isSpecial(viewer) ||
    msg.sender_id == null;
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
          includePrivate: Boolean(isAdminViewer),
          includePhone: Boolean(isAdminViewer)
        })
      : null,
    mediaUrl,
    imageLocked: isImage && !canSeeImage,
    editable: false,
    sourceLang: msg.source_lang || null,
    originalBody: msg.body,
    translated: false
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

function serializeMe(user) {
  const out = publicUser(user, { includePrivate: true, online: true, viewer: user });
  Object.assign(out, hostIncomeSummary(db, user.id, publicUser));
  out.incomeDemoVideoUrl = getSetting(db, 'income_demo_video_url', '/demo/income-host.mp4');
  return out;
}

function touchPresence(conv, userId, action = 'ping') {
  if (!conv || !userId) return null;
  const blocked = isBlocked(conv.user_lo, conv.user_hi);
  if (blocked) {
    voidSession(db, conv);
    return { totalMs: 0, streakMs: 0, bothPresent: false, credited: [], voided: true };
  }
  return markPresence(db, conv, userId, action, Date.now(), emitToUser);
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
    quotes: allQuotes(Number(getSetting(db, 'monthly_price', '15000'))),
    incomeDemoVideoUrl: getSetting(db, 'income_demo_video_url', '/demo/income-host.mp4'),
    adRotateMs: AD_ROTATE_MS
  });
});

const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function serializePinRecovery(row) {
  const listed = db
    .prepare('SELECT * FROM users WHERE account_id = ? COLLATE NOCASE AND is_ai = 0')
    .get(row.account_id);
  const matched = Boolean(listed && row.user_id && Number(listed.id) === Number(row.user_id));
  return {
    id: row.id,
    accountId: row.account_id,
    phone: row.phone,
    userId: matched ? listed.id : null,
    username: listed ? listed.username : null,
    matched,
    accountFound: Boolean(listed),
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null
  };
}

function countPendingPinRecovery() {
  return db.prepare("SELECT COUNT(*) AS n FROM pin_recovery_requests WHERE status = 'pending'").get().n;
}

app.post(
  '/api/pin-recovery',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 8, name: 'pin-recovery' }),
  (req, res) => {
    const accountId = String(req.body.accountId || '').trim().slice(0, 24);
    const phone = String(req.body.phone || '').trim().slice(0, 20);
    if (!accountId) return res.status(400).json({ error: 'Enter your account ID.' });
    if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });

    const existing = db
      .prepare(
        `SELECT id FROM pin_recovery_requests
         WHERE account_id = ? COLLATE NOCASE AND phone = ? AND status = 'pending'`
      )
      .get(accountId, phone);
    if (existing) return res.json({ ok: true });

    const user = db
      .prepare('SELECT * FROM users WHERE account_id = ? COLLATE NOCASE AND is_ai = 0')
      .get(accountId);
    let userId = null;
    if (user) {
      const submittedDigits = phoneDigits(phone);
      const registeredDigits = phoneDigits(user.phone);
      if (user.phone === phone || (submittedDigits && submittedDigits === registeredDigits)) {
        userId = user.id;
      }
    }

    const info = db
      .prepare(
        `INSERT INTO pin_recovery_requests (account_id, phone, user_id, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      )
      .run(accountId, phone, userId, Date.now());
    io.to('admins').emit('pin-recovery:new', { id: info.lastInsertRowid, accountId });
    res.json({ ok: true });
  }
);

app.post(
  '/api/register',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 15, name: 'register' }),
  multerFields(uploadRegister, [
    { name: 'photo', maxCount: 1 }
  ]),
  (req, res) => {
  try {
    rejectClientPrivilege(req.body);
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const gender = String(req.body.gender || '').trim();
    const birthYear = Number(req.body.birthYear);
    const phone = String(req.body.phone || '').trim();
    const photo = firstFile(req, 'photo');
    const dropUploads = () => {
      unlinkQuiet(photo);
    };
    const nameErr = usernameError(username);
    if (nameErr) {
      dropUploads();
      return res.status(400).json({ error: nameErr });
    }
    if (!/^\d{6}$/.test(password)) {
      dropUploads();
      return res.status(400).json({ error: 'Password must be exactly 6 digits.' });
    }
    if (!['male', 'female'].includes(gender)) {
      dropUploads();
      return res.status(400).json({ error: 'Please choose male or female.' });
    }
    const yearNow = new Date().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < 1940 || birthYear > yearNow - 18) {
      dropUploads();
      return res.status(400).json({ error: 'You must be at least 18. Check your birth year.' });
    }
    if (!PHONE_RE.test(phone)) {
      dropUploads();
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (!photo) {
      dropUploads();
      return res.status(400).json({ error: 'Profile photo is required.' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (taken) {
      dropUploads();
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    if (username.toLowerCase() === 'saka') {
      dropUploads();
      return res.status(400).json({ error: 'That username is reserved.' });
    }
    const uiLang = normalizeLang(req.body.lang) || 'my';
    const accountId = uniqueAccountId();
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (
          account_id, username, password_hash, gender, birth_year, phone,
          photo_path, level, status, host_status, ui_lang, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending_liveness', 'none', ?, ?)`
      )
      .run(
        accountId,
        username,
        hash,
        gender,
        birthYear,
        phone,
        photo.filename,
        uiLang,
        Date.now()
      );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = signToken();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      token,
      user.id,
      Date.now(),
      Date.now() + SESSION_MS
    );
    setCookie(res, 'sw_sid', token, SESSION_MS);
    startAiWelcome(user);
    res.json({ user: publicUser(user, { includePrivate: true, online: true }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', rateLimit({ windowMs: 60 * 1000, max: 20, name: 'login' }), (req, res) => {
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
  const lang = normalizeLang(req.body.lang);
  if (lang) {
    db.prepare('UPDATE users SET ui_lang = ? WHERE id = ?').run(lang, user.id);
    user.ui_lang = lang;
  }
  res.json({ user: serializeMe(user) });
});

app.post('/api/logout', requireUser, (req, res) => {
  const token = req.cookies.sw_sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  clearCookie(res, 'sw_sid');
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: serializeMe(req.user),
    siteName: getSetting(db, 'site_name', 'sakarwine'),
    hostCreditAmount: HOST_CREDIT_AMOUNT
  });
});

app.put('/api/me/lang', requireUser, (req, res) => {
  const lang = req.body && req.body.lang != null && String(req.body.lang).trim() !== ''
    ? normalizeLang(req.body.lang)
    : null;
  if (req.body && req.body.lang != null && String(req.body.lang).trim() !== '' && !lang) {
    return res.status(400).json({ error: 'Choose a supported language.' });
  }
  if (lang) db.prepare('UPDATE users SET ui_lang = ? WHERE id = ?').run(lang, req.user.id);
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'chatViewLang')) {
    const raw = req.body.chatViewLang;
    if (raw == null || raw === '' || raw === 'ask') {
      db.prepare('UPDATE users SET chat_view_lang = NULL WHERE id = ?').run(req.user.id);
    } else {
      const chatLang = normalizeLang(raw);
      if (!chatLang) return res.status(400).json({ error: 'Choose a supported language.' });
      db.prepare('UPDATE users SET chat_view_lang = ? WHERE id = ?').run(chatLang, req.user.id);
    }
  } else if (!lang) {
    return res.status(400).json({ error: 'Choose a supported language.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: serializeMe(user) });
});

app.get('/api/me/blocked', requireUser, requireActive, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.* FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(req.user.id);
  const users = rows.map((row) => {
    const u = publicUser(row, { online: isOnline(row.id), viewer: req.user });
    u.blocked = true;
    return u;
  });
  res.json({ users });
});

app.put(
  '/api/me/profile',
  requireUser,
  requireActive,
  rateLimit({ windowMs: 60 * 1000, max: 20, name: 'profile' }),
  multerSingle(uploadProfile, 'photo'),
  (req, res) => {
    const photo = req.file;
    const drop = () => unlinkQuiet(photo);
    const requestedName = req.body && req.body.username != null ? String(req.body.username).trim() : null;
    let username = req.user.username;
    if (requestedName != null) {
      if (usernameError(requestedName)) {
        drop();
        return res.status(400).json({ error: usernameError(requestedName) });
      }
      if (requestedName.toLowerCase() === 'saka') {
        drop();
        return res.status(400).json({ error: 'That username is reserved.' });
      }
      const taken = db
        .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?')
        .get(requestedName, req.user.id);
      if (taken) {
        drop();
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      username = requestedName;
    }
    const bioSent = req.body && Object.prototype.hasOwnProperty.call(req.body, 'bio');
    let bio = req.user.bio == null ? '' : String(req.user.bio);
    if (bioSent) {
      bio = String(req.body.bio || '').trim();
      const bioErr = bioFilterError(bio);
      if (bioErr) {
        drop();
        return res.status(400).json({ error: bioErr });
      }
    }
    if (!photo && requestedName == null && !bioSent) {
      return res.json({ user: serializeMe(req.user) });
    }
    const photoName = photo ? photo.filename : req.user.photo_path;
    db.prepare('UPDATE users SET username = ?, photo_path = ?, bio = ? WHERE id = ?').run(
      username,
      photoName,
      bio || null,
      req.user.id
    );
    if (photo && req.user.photo_path && req.user.photo_path !== photo.filename) {
      unlinkQuiet({ path: path.join(UPLOADS, 'profiles', path.basename(req.user.photo_path)) });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: serializeMe(user) });
  }
);

app.post(
  '/api/me/pin',
  requireUser,
  requireActive,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 8, name: 'pin-change' }),
  (req, res) => {
    const currentPin = String((req.body && req.body.currentPin) || '');
    const newPin = String((req.body && req.body.newPin) || '');
    const confirmPin = String((req.body && req.body.confirmPin) || '');
    if (!/^\d{6}$/.test(currentPin) || !bcrypt.compareSync(currentPin, req.user.password_hash)) {
      return res.status(400).json({ error: 'Current PIN is wrong.' });
    }
    if (!/^\d{6}$/.test(newPin)) {
      return res.status(400).json({ error: 'New password must be exactly 6 digits.' });
    }
    if (newPin !== confirmPin) {
      return res.status(400).json({ error: 'New PIN and confirmation do not match.' });
    }
    if (newPin === currentPin) {
      return res.status(400).json({ error: 'Choose a different 6-digit PIN.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPin, 10), req.user.id);
    res.json({ ok: true });
  }
);

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
    user: serializeMe(user),
    aiConversationId: conv ? conv.id : null,
    genderMatch: estimatedGender === 'unknown' || estimatedGender === user.gender
  });
});

app.post('/api/me/tour-complete', requireUser, requireActive, (req, res) => {
  db.prepare('UPDATE users SET tour_completed = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.post(
  '/api/me/withdraw',
  requireUser,
  requireActive,
  rateLimit({ windowMs: 60 * 1000, max: 8, name: 'withdraw' }),
  (req, res) => {
    const result = requestPayout(db, req.user, {
      method: req.body.method,
      name: req.body.name,
      phone: req.body.phone
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    io.to('admins').emit('payout:new', { id: result.payout.id, hostId: req.user.id });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ ok: true, payout: result.payout, user: serializeMe(user) });
  }
);

app.post(
  '/api/me/nrc',
  requireUser,
  requireActive,
  multerFields(uploadNrc, [
    { name: 'nrcFront', maxCount: 1 },
    { name: 'nrcBack', maxCount: 1 }
  ]),
  (req, res) => {
    const idType = parseIdDocType(req.body);
    const photos = takeHostIdPhotos(req, idType);
    if (req.user.gender !== 'female') {
      if (photos.front) unlinkQuiet(photos.front);
      if (photos.back) unlinkQuiet(photos.back);
      return res.status(400).json({ error: 'NRC verification is for female accounts.' });
    }
    if (req.user.host_status === 'approved') {
      if (photos.front) unlinkQuiet(photos.front);
      if (photos.back) unlinkQuiet(photos.back);
      return res.status(409).json({ error: 'Your host verification is already approved.' });
    }
    if (photos.error) return res.status(400).json({ error: photos.error });
    replaceHostIdFiles(req.user);
    db.prepare(
      `UPDATE users SET nrc_front_path = ?, nrc_back_path = ?, id_doc_type = ?, host_status = 'pending', is_host = 0
       WHERE id = ?`
    ).run(photos.front.filename, photos.back ? photos.back.filename : null, idType, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: serializeMe(user) });
  }
);

app.post(
  '/api/me/host-apply',
  requireUser,
  requireActive,
  multerFields(uploadNrc, [
    { name: 'nrcFront', maxCount: 1 },
    { name: 'nrcBack', maxCount: 1 }
  ]),
  (req, res) => {
    const idType = parseIdDocType(req.body);
    const photos = takeHostIdPhotos(req, idType);
    const drop = () => {
      if (photos.front) unlinkQuiet(photos.front);
      if (photos.back) unlinkQuiet(photos.back);
    };
    if (req.user.gender !== 'female') {
      drop();
      return res.status(400).json({ error: 'Host application is for female accounts.' });
    }
    if (req.user.host_status === 'approved') {
      drop();
      return res.status(409).json({ error: 'Your host verification is already approved.' });
    }
    if (photos.error) {
      return res.status(400).json({ error: photos.error });
    }
    replaceHostIdFiles(req.user);
    db.prepare(
      `UPDATE users SET nrc_front_path = ?, nrc_back_path = ?, id_doc_type = ?, host_status = 'pending', is_host = 0
       WHERE id = ?`
    ).run(
      photos.front.filename,
      photos.back ? photos.back.filename : null,
      idType,
      req.user.id
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: serializeMe(user) });
  }
);

app.get('/api/ads', requireUser, requireActive, (_req, res) => {
  res.json({ ads: listAds(db), rotateMs: AD_ROTATE_MS });
});

app.get('/api/ads/:id/image', (req, res) => {
  if (!currentUser(req) && !currentAdmin(req)) return res.status(401).end();
  const row = db.prepare('SELECT * FROM ad_banners WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).end();
  sendUpload(res, 'ads', row.image_path);
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
  const gender = String(req.query.gender || 'all').trim().toLowerCase();
  const genderFilter = gender === 'male' || gender === 'female' ? gender : null;
  const users = rows
    .map((row) => {
      const u = publicUser(row, { online: isOnline(row.id), viewer: req.user });
      u.blocked = blocked.includes(row.id);
      return u;
    })
    .filter((u) => !genderFilter || u.gender === genderFilter)
    .sort((a, b) => {
      if (a.isAi !== b.isAi) return a.isAi ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
  res.json({ users });
});

app.get('/api/users/:id/card', requireUser, requireActive, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target || target.status === 'closed') return res.status(404).json({ error: 'User not found.' });
  res.json({
    user: {
      id: target.id,
      username: target.username,
      photoUrl: target.photo_path
        ? `/api/media/profile/${path.basename(target.photo_path)}`
        : defaultAvatarUrl(target),
      hasPhoto: Boolean(target.photo_path),
      gender: target.gender,
      accountId: target.account_id,
      isAi: Boolean(target.is_ai),
      isAdmin: isAdminAccount(target),
      badge: target.badge || null,
      bio: target.bio ? String(target.bio) : ''
    }
  });
});

app.post('/api/users/:id/block', requireUser, requireActive, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target || target.is_ai) return res.status(400).json({ error: 'You cannot block this account.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  if (isAdminAccount(target)) {
    return res.status(403).json({ error: 'Admin accounts cannot be blocked.' });
  }
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    req.user.id,
    target.id,
    Date.now()
  );
  const conv = db
    .prepare('SELECT * FROM conversations WHERE (user_lo = ? AND user_hi = ?) OR (user_lo = ? AND user_hi = ?)')
    .get(req.user.id, target.id, target.id, req.user.id);
  if (conv) voidSession(db, conv);
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
  if (isAdminAccount(target) && !isAdminAccount(req.user)) {
    const existing = findConversation(req.user.id, target.id);
    if (!existing) {
      return res.status(403).json({ error: 'You cannot start a chat with an Admin account.' });
    }
    const gate = adminChatGate(existing, req.user);
    return res.json({
      conversation: {
        id: existing.id,
        peer: publicUser(target, { online: isOnline(target.id), viewer: req.user }),
        window: freeWindow(existing, req.user),
        adminGate: gate
      }
    });
  }
  const conv = getOrCreateConversation(req.user.id, target.id, req.user.id);
  res.json({
    conversation: {
      id: conv.id,
      peer: publicUser(target, { online: isOnline(target.id), viewer: req.user }),
      window: freeWindow(conv, req.user),
      adminGate: adminChatGate(conv, req.user)
    }
  });
});

app.get('/api/conversations', requireUser, requireActive, (req, res) => {
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT c.*,
         m.id AS last_id, m.type AS last_type, m.body AS last_body, m.created_at AS last_created,
         h.hidden_after_id AS hidden_after_id
       FROM conversations c
       LEFT JOIN messages m ON m.id = (
         SELECT MAX(id) FROM messages WHERE conversation_id = c.id
       )
       LEFT JOIN conversation_hides h ON h.conversation_id = c.id AND h.user_id = ?
       WHERE c.user_lo = ? OR c.user_hi = ?
       ORDER BY COALESCE(m.created_at, c.started_at) DESC`
    )
    .all(me, me, me);
  const conversations = [];
  for (const row of rows) {
    if (!row.last_id) continue;
    if (row.hidden_after_id != null && row.last_id <= row.hidden_after_id) continue;
    const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(row, me));
    if (!peer) continue;
    conversations.push({
      id: row.id,
      kind: 'dm',
      peer: publicUser(peer, { online: isOnline(peer.id), viewer: req.user }),
      lastMessage: {
        id: row.last_id,
        type: row.last_type,
        body: row.last_body,
        createdAt: row.last_created
      },
      sortAt: row.last_created
    });
  }
  const groupRows = db
    .prepare(
      `SELECT g.*, gm.role AS role, gm.joined_at AS joined_at,
         m.id AS last_id, m.type AS last_type, m.body AS last_body, m.created_at AS last_created
       FROM group_members gm
       JOIN user_groups g ON g.id = gm.group_id
       LEFT JOIN group_messages m ON m.id = (
         SELECT MAX(id) FROM group_messages WHERE group_id = g.id
       )
       WHERE gm.user_id = ?`
    )
    .all(me);
  for (const row of groupRows) {
    conversations.push({
      id: `g-${row.id}`,
      kind: 'group',
      groupId: row.id,
      name: row.name,
      logoUrl: groupLogoUrl(row),
      role: row.role,
      lastMessage: row.last_id
        ? {
            id: row.last_id,
            type: row.last_type,
            body: row.last_body,
            createdAt: row.last_created
          }
        : null,
      sortAt: row.last_created || row.created_at
    });
  }
  conversations.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0));
  res.json({ conversations });
});

function groupLogoUrl(row) {
  return row && row.logo_path ? `/api/media/group/${path.basename(row.logo_path)}` : null;
}

function serializeGroupPreview(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    logoUrl: groupLogoUrl(row),
    creatorId: row.creator_id,
    createdAt: row.created_at,
    memberCount: extra.memberCount != null ? extra.memberCount : undefined,
    role: extra.role || null
  };
}

function serializeGroupMember(row) {
  return {
    id: row.id,
    username: row.username,
    photoUrl: row.photo_path
      ? `/api/media/profile/${path.basename(row.photo_path)}`
      : defaultAvatarUrl(row),
    gender: row.gender,
    accountId: row.account_id,
    role: row.role,
    isAi: Boolean(row.is_ai),
    isAdmin: isAdminAccount(row)
  };
}

function serializeGroupInvite(row, viewer) {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(row.group_id);
  const inviter = db.prepare('SELECT * FROM users WHERE id = ?').get(row.inviter_id);
  const invitee = db.prepare('SELECT * FROM users WHERE id = ?').get(row.invitee_id);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    group: group ? serializeGroupPreview(group) : null,
    inviter: inviter
      ? {
          id: inviter.id,
          username: inviter.username,
          accountId: inviter.account_id,
          photoUrl: inviter.photo_path
            ? `/api/media/profile/${path.basename(inviter.photo_path)}`
            : defaultAvatarUrl(inviter)
        }
      : null,
    invitee:
      viewer && isAdminAccount(viewer) && invitee
        ? { id: invitee.id, username: invitee.username, accountId: invitee.account_id }
        : undefined
  };
}

function groupMembership(groupId, userId) {
  return db
    .prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId);
}

function findUserByAccountId(accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  return db.prepare('SELECT * FROM users WHERE account_id = ? COLLATE NOCASE AND is_ai = 0').get(id);
}

function groupInvitePreviewUser(row) {
  return {
    id: row.id,
    username: row.username,
    accountId: row.account_id,
    photoUrl: row.photo_path
      ? `/api/media/profile/${path.basename(row.photo_path)}`
      : defaultAvatarUrl(row),
    gender: row.gender,
    bio: row.bio ? String(row.bio) : ''
  };
}

function canCreateGroup(user) {
  return isSpecial(user) || isPaid(user);
}

app.get('/api/groups', requireUser, requireActive, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.*, m.role AS role
       FROM group_members m
       JOIN user_groups g ON g.id = m.group_id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(req.user.id);
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?');
  const groups = rows.map((row) =>
    serializeGroupPreview(row, { role: row.role, memberCount: countStmt.get(row.id).n })
  );
  res.json({ groups, canCreate: canCreateGroup(req.user) });
});

app.post(
  '/api/groups',
  requireUser,
  requireActive,
  multerSingle(uploadGroup, 'logo'),
  (req, res) => {
    if (!canCreateGroup(req.user)) {
      return res.status(403).json({ error: 'Upgrade to create a group.', code: 'GROUP_PAID' });
    }
    const nameErr = groupNameError(req.body && req.body.name);
    if (nameErr) return res.status(400).json({ error: nameErr });
    if (!req.file) return res.status(400).json({ error: 'Upload a group logo.' });
    const now = Date.now();
    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO user_groups (name, logo_path, creator_id, created_at) VALUES (?, ?, ?, ?)')
        .run(String(req.body.name).trim(), req.file.filename, req.user.id, now);
      db.prepare(
        'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(info.lastInsertRowid, req.user.id, 'owner', now);
      return info.lastInsertRowid;
    });
    const groupId = tx();
    const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(groupId);
    res.json({
      group: serializeGroupPreview(group, { role: 'owner', memberCount: 1 }),
      canCreate: true
    });
  }
);

app.get('/api/groups/lookup', requireUser, requireActive, (req, res) => {
  const target = findUserByAccountId(req.query.accountId);
  if (!target || target.status !== 'active') {
    return res.status(404).json({ error: 'No account found for that ID.' });
  }
  res.json({ user: groupInvitePreviewUser(target) });
});

app.get('/api/groups/discover', requireUser, requireActive, (req, res) => {
  const mine = new Set(
    db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(req.user.id).map((r) => r.group_id)
  );
  const pending = new Set(
    db
      .prepare(
        `SELECT group_id FROM group_join_requests WHERE user_id = ? AND status = 'pending'`
      )
      .all(req.user.id)
      .map((r) => r.group_id)
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?');
  const groups = db
    .prepare('SELECT * FROM user_groups ORDER BY created_at DESC')
    .all()
    .map((row) => ({
      ...serializeGroupPreview(row, { memberCount: countStmt.get(row.id).n }),
      joined: mine.has(row.id),
      requested: pending.has(row.id)
    }));
  res.json({ groups });
});

app.get('/api/groups/:id', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine) return res.status(404).json({ error: 'Group not found.' });
  const members = db
    .prepare(
      `SELECT u.*, m.role AS role
       FROM group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY m.role = 'owner' DESC, u.username COLLATE NOCASE`
    )
    .all(group.id)
    .map(serializeGroupMember);
  const joinRequests =
    mine.role === 'owner'
      ? db
          .prepare(
            `SELECT r.*, u.username, u.account_id, u.photo_path, u.gender
             FROM group_join_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.group_id = ? AND r.status = 'pending'
             ORDER BY r.id ASC`
          )
          .all(group.id)
          .map((r) => ({
            id: r.id,
            createdAt: r.created_at,
            user: {
              id: r.user_id,
              username: r.username,
              accountId: r.account_id,
              photoUrl: r.photo_path
                ? `/api/media/profile/${path.basename(r.photo_path)}`
                : defaultAvatarUrl(r),
              gender: r.gender
            }
          }))
      : [];
  res.json({
    group: serializeGroupPreview(group, { role: mine.role, memberCount: members.length }),
    members,
    joinRequests
  });
});

app.post('/api/groups/:id/invites', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  if (!group || !groupMembership(group.id, req.user.id)) {
    return res.status(404).json({ error: 'Group not found.' });
  }
  const body = req.body || {};
  let target = null;
  const userId = Number(body.userId);
  if (userId) {
    target = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(userId);
  } else {
    target = findUserByAccountId(body.targetAccountId || body.swId);
  }
  if (!target || target.status !== 'active') {
    return res.status(404).json({ error: 'No account found for that ID.' });
  }
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot invite yourself.' });
  if (groupMembership(group.id, target.id)) {
    return res.status(400).json({ error: 'This person is already in the group.' });
  }
  const blocked =
    db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
      .get(req.user.id, target.id, target.id, req.user.id);
  if (blocked) return res.status(403).json({ error: 'This chat is blocked.' });
  const pending = db
    .prepare(
      `SELECT id FROM group_invites WHERE group_id = ? AND invitee_id = ? AND status = 'pending'`
    )
    .get(group.id, target.id);
  if (pending) return res.status(400).json({ error: 'An invite is already pending.' });
  const info = db
    .prepare(
      `INSERT INTO group_invites (group_id, inviter_id, invitee_id, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`
    )
    .run(group.id, req.user.id, target.id, Date.now());
  const invite = db.prepare('SELECT * FROM group_invites WHERE id = ?').get(info.lastInsertRowid);
  const payload = serializeGroupInvite(invite, req.user);
  emitToUser(target.id, 'group:invite', {
    inviteId: payload.id,
    groupName: payload.group && payload.group.name,
    inviterName: payload.inviter && payload.inviter.username,
    inviterAccountId: payload.inviter && payload.inviter.accountId
  });
  res.json({ invite: payload, user: groupInvitePreviewUser(target) });
});

app.post('/api/groups/:id/join', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  if (groupMembership(group.id, req.user.id)) {
    return res.status(400).json({ error: 'This person is already in the group.' });
  }
  const pending = db
    .prepare(
      `SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'`
    )
    .get(group.id, req.user.id);
  if (pending) return res.status(400).json({ error: 'A join request is already pending.' });
  const info = db
    .prepare(
      `INSERT INTO group_join_requests (group_id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)`
    )
    .run(group.id, req.user.id, Date.now());
  const owner = db
    .prepare(`SELECT user_id FROM group_members WHERE group_id = ? AND role = 'owner'`)
    .get(group.id);
  if (owner) {
    emitToUser(owner.user_id, 'group:join-request', {
      groupId: group.id,
      groupName: group.name,
      username: req.user.username,
      accountId: req.user.account_id
    });
  }
  res.json({ ok: true, requestId: info.lastInsertRowid });
});

app.post('/api/groups/:id/join-requests/:rid/accept', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine || mine.role !== 'owner') {
    return res.status(403).json({ error: 'Only the group admin can review join requests.' });
  }
  const row = db
    .prepare(`SELECT * FROM group_join_requests WHERE id = ? AND group_id = ?`)
    .get(Number(req.params.rid), group.id);
  if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Join request not found.' });
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `UPDATE group_join_requests SET status = 'accepted', responded_at = ? WHERE id = ?`
    ).run(now, row.id);
    db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`
    ).run(group.id, row.user_id, now);
  })();
  emitToUser(row.user_id, 'group:join-accepted', {
    groupId: group.id,
    groupName: group.name
  });
  res.json({ ok: true });
});

app.post('/api/groups/:id/join-requests/:rid/decline', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine || mine.role !== 'owner') {
    return res.status(403).json({ error: 'Only the group admin can review join requests.' });
  }
  const row = db
    .prepare(`SELECT * FROM group_join_requests WHERE id = ? AND group_id = ?`)
    .get(Number(req.params.rid), group.id);
  if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Join request not found.' });
  db.prepare(
    `UPDATE group_join_requests SET status = 'declined', responded_at = ? WHERE id = ?`
  ).run(Date.now(), row.id);
  emitToUser(row.user_id, 'group:join-declined', { groupId: group.id, groupName: group.name });
  res.json({ ok: true });
});

app.get('/api/group-invites', requireUser, requireActive, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM group_invites WHERE invitee_id = ? AND status = 'pending' ORDER BY id DESC`
    )
    .all(req.user.id);
  res.json({ invites: rows.map((row) => serializeGroupInvite(row, req.user)) });
});

app.post('/api/group-invites/:id/accept', requireUser, requireActive, (req, res) => {
  const invite = db.prepare('SELECT * FROM group_invites WHERE id = ?').get(Number(req.params.id));
  if (!invite || invite.invitee_id !== req.user.id || invite.status !== 'pending') {
    return res.status(404).json({ error: 'Invite not found.' });
  }
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `UPDATE group_invites SET status = 'accepted', responded_at = ? WHERE id = ?`
    ).run(now, invite.id);
    db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`
    ).run(invite.group_id, req.user.id, now);
  })();
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(invite.group_id);
  res.json({
    ok: true,
    group: serializeGroupPreview(group, { role: 'member' })
  });
});

app.post('/api/group-invites/:id/decline', requireUser, requireActive, (req, res) => {
  const invite = db.prepare('SELECT * FROM group_invites WHERE id = ?').get(Number(req.params.id));
  if (!invite || invite.invitee_id !== req.user.id || invite.status !== 'pending') {
    return res.status(404).json({ error: 'Invite not found.' });
  }
  db.prepare(
    `UPDATE group_invites SET status = 'declined', responded_at = ? WHERE id = ?`
  ).run(Date.now(), invite.id);
  res.json({ ok: true });
});

function groupChatWindow(member, user, now = Date.now()) {
  if (canChatUnlimited(user, now)) {
    return {
      expired: false,
      remainingMs: null,
      canSend: true,
      paid: isPaid(user, now),
      special: isSpecial(user)
    };
  }
  const start = Number(member && member.joined_at) || now;
  const remaining = FREE_CHAT_MS - (now - start);
  return {
    expired: remaining <= 0,
    remainingMs: Math.max(0, remaining),
    canSend: remaining > 0,
    paid: false,
    fromJoin: true,
    freeMs: FREE_CHAT_MS
  };
}

function serializeGroupMessage(msg, viewer) {
  const out = serializeMessage(
    {
      ...msg,
      conversation_id: null
    },
    viewer
  );
  out.groupId = msg.group_id;
  out.conversationId = `g-${msg.group_id}`;
  if (msg.type === 'image' && out.mediaUrl) {
    out.mediaUrl = `/api/media/group-chat/${path.basename(msg.media_path)}`;
  } else if (msg.type === 'voice' && msg.media_path) {
    out.mediaUrl = `/api/media/group-chat/${path.basename(msg.media_path)}`;
  }
  return out;
}

function emitToGroup(groupId, event, payload, exceptId) {
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
  for (const m of members) {
    if (exceptId && m.user_id === exceptId) continue;
    emitToUser(m.user_id, event, payload);
  }
}

function removeGroupMember(groupId, userId) {
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  const remaining = db.prepare('SELECT user_id, role, joined_at FROM group_members WHERE group_id = ? ORDER BY joined_at ASC').all(groupId);
  if (remaining.length && !remaining.some((m) => m.role === 'owner')) {
    db.prepare(`UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?`).run(
      groupId,
      remaining[0].user_id
    );
  }
}

app.get('/api/groups/:id/messages', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine) return res.status(404).json({ error: 'Group not found.' });
  const rows = db
    .prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY id ASC')
    .all(group.id);
  res.json({
    group: serializeGroupPreview(group, { role: mine.role }),
    window: groupChatWindow(mine, req.user),
    messages: rows.map((m) => serializeGroupMessage(m, req.user))
  });
});

app.post('/api/groups/:id/messages', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine) return res.status(404).json({ error: 'Group not found.' });
  const win = groupChatWindow(mine, req.user);
  if (!win.canSend) {
    return res.status(402).json({
      error: 'Free chatting has ended. Upgrade to keep talking.',
      code: 'UPGRADE',
      window: win
    });
  }
  const body = String((req.body && req.body.body) || '').trim();
  const err = messageFilterError(body);
  if (err) return res.status(400).json({ error: err });
  const info = db
    .prepare(
      `INSERT INTO group_messages (group_id, sender_id, type, body, media_path, created_at, source_lang)
       VALUES (?, ?, 'text', ?, NULL, ?, ?)`
    )
    .run(group.id, req.user.id, body, Date.now(), userLang(req.user));
  const msg = db.prepare('SELECT * FROM group_messages WHERE id = ?').get(info.lastInsertRowid);
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(group.id);
  for (const m of members) {
    const memberUser = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
    emitToUser(m.user_id, 'group:message', {
      groupId: group.id,
      message: serializeGroupMessage(msg, memberUser)
    });
  }
  res.json({
    message: serializeGroupMessage(msg, req.user),
    window: groupChatWindow(mine, req.user)
  });
});

app.post('/api/groups/:id/leave', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine) return res.status(404).json({ error: 'Group not found.' });
  removeGroupMember(group.id, req.user.id);
  emitToUser(req.user.id, 'group:removed', { groupId: group.id, reason: 'left' });
  res.json({ ok: true });
});

app.post('/api/groups/:id/kick', requireUser, requireActive, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(req.params.id));
  const mine = group ? groupMembership(group.id, req.user.id) : null;
  if (!group || !mine) return res.status(404).json({ error: 'Group not found.' });
  if (mine.role !== 'owner') {
    return res.status(403).json({ error: 'Only the group admin can remove members.' });
  }
  const targetId = Number(req.body && req.body.userId);
  if (!targetId || targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove this member.' });
  }
  const target = groupMembership(group.id, targetId);
  if (!target) return res.status(404).json({ error: 'Member not found.' });
  removeGroupMember(group.id, targetId);
  emitToUser(targetId, 'group:removed', { groupId: group.id, reason: 'kicked' });
  res.json({ ok: true });
});

app.get('/api/conversations/:id', requireUser, requireActive, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, req.user.id));
  const blocked =
    db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, peer.id) != null;
  const tick = blocked ? null : touchPresence(conv, req.user.id, 'ping');
  const messages = listMessagesForViewer(conv.id, req.user);
  const view = conversationViewMeta(req.user, conv, peer, messages);
  if (view.viewLang && !view.askViewLang) {
    await applyTranslations(messages, view.viewLang);
  }
  res.json({
    conversation: {
      id: conv.id,
      peer: publicUser(peer, { online: isOnline(peer.id), viewer: req.user }),
      window: freeWindow(conv, req.user),
      blocked,
      canDelete: !peer.is_ai,
      messagesEditable: false,
      hiddenAt: (hiddenFor(conv.id, req.user.id) || {}).hidden_at || null,
      mutual: mutualSnapshot(db, conv, req.user, peer),
      viewLang: view.viewLang,
      askViewLang: view.askViewLang,
      peerLang: view.peerLang,
      adminGate: adminChatGate(conv, req.user)
    },
    messages,
    credited: tick ? tick.credited : []
  });
});

app.put('/api/conversations/:id/view-lang', requireUser, requireActive, async (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  const lang = setConversationLang(req.user.id, conv.id, req.body && req.body.lang);
  if (!lang) return res.status(400).json({ error: 'Choose a supported language.' });
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, req.user.id));
  const messages = listMessagesForViewer(conv.id, req.user);
  await applyTranslations(messages, lang);
  res.json({
    ok: true,
    viewLang: lang,
    askViewLang: false,
    peerLang: userLang(peer),
    messages
  });
});

app.post(
  '/api/conversations/:id/presence',
  requireUser,
  requireActive,
  rateLimit({ windowMs: 60 * 1000, max: 90, name: 'presence' }),
  (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  const peer = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, req.user.id));
  const action = String(req.body.action || 'ping');
  if (!['enter', 'ping', 'leave'].includes(action)) {
    return res.status(400).json({ error: 'Presence action must be enter, ping, or leave.' });
  }
  const tick = touchPresence(conv, req.user.id, action);
  res.json({
    ok: true,
    mutual: mutualSnapshot(db, conv, req.user, peer),
    credited: tick ? tick.credited : [],
    hostEarnings: hostIncomeSummary(db, req.user.id, publicUser).hostEarnings
  });
});

app.post('/api/conversations/:id/messaging', requireUser, requireActive, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv || (conv.user_lo !== req.user.id && conv.user_hi !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  if (!isAdminAccount(req.user)) {
    return res.status(403).json({ error: 'Only Admin accounts can close or reopen this chat.' });
  }
  const open = req.body && (req.body.open === false || req.body.open === 0 || req.body.open === '0') ? false : true;
  const updated = setMemberMessaging(conv.id, open, emitToUser);
  res.json({
    ok: true,
    messagingOpen: memberMessagingOpen(updated),
    adminGate: adminChatGate(updated, req.user)
  });
});

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
  async (req, res) => {
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
    const gate = adminChatGate(conv, req.user);
    if (!gate.canSend) {
      return res.status(403).json({ error: gate.error, adminGate: gate });
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
        'INSERT INTO messages (conversation_id, sender_id, type, body, media_path, created_at, source_lang) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        conv.id,
        req.user.id,
        type,
        body || null,
        mediaPath,
        Date.now(),
        type === 'voice' || !body ? null : userLang(req.user)
      );
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    const forMe = serializeMessage(msg, req.user);
    const forPeer = serializeMessage(msg, peer);
    const myView = chosenViewLang(req.user, conv.id);
    const peerView = chosenViewLang(peer, conv.id);
    if (myView) await applyTranslations([forMe], myView);
    if (peerView) await applyTranslations([forPeer], peerView);
    emitToUser(peerId, 'message', { conversationId: conv.id, message: forPeer });
    emitToUser(req.user.id, 'message', { conversationId: conv.id, message: forMe });
    emitAdminGate(conv);
    const tick = touchPresence(conv, req.user.id, 'ping');
    res.json({
      message: forMe,
      window: freeWindow(conv, req.user),
      mutual: mutualSnapshot(db, conv, req.user, peer),
      credited: tick ? tick.credited : [],
      adminGate: adminChatGate(conv, req.user)
    });
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
  const rawTarget = String(req.body.targetAccountId || req.body.swId || '').trim();
  if (!rawTarget) return res.status(400).json({ error: 'Enter an account ID to upgrade.' });
  const target = findUserByAccountId(rawTarget);
  if (!target || target.is_ai || target.status === 'closed') {
    return res.status(400).json({ error: 'No account found for that ID.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Upload your payment transfer screenshot.' });
  const rawHostCode = String(req.body.hostCode || '').trim();
  let host = null;
  if (rawHostCode) {
    host = findHostByCode(db, rawHostCode);
    if (!host) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Enter a valid host code.' });
    }
  }
  const pending = db
    .prepare('SELECT id FROM upgrades WHERE user_id = ? AND status = ?')
    .get(req.user.id, 'pending');
  if (pending) return res.status(409).json({ error: 'You already have a pending upgrade. Wait for admin.' });
  const monthly = Number(getSetting(db, 'monthly_price', '15000'));
  const quote = quotePlan(monthly, months);
  const info = db
    .prepare(
      `INSERT INTO upgrades (user_id, account_id, target_user_id, target_account_id, months, amount, currency, receipt_path, host_id, host_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      req.user.id,
      req.user.account_id,
      target.id,
      target.account_id,
      quote.months,
      quote.amount,
      getSetting(db, 'currency', 'MMK'),
      req.file.filename,
      host ? host.id : null,
      host ? host.host_code : null,
      Date.now()
    );
  io.to('admins').emit('upgrade:new', { id: info.lastInsertRowid, accountId: req.user.account_id });
  res.json({ ok: true, id: info.lastInsertRowid, quote, targetAccountId: target.account_id, gift: target.id !== req.user.id });
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

function sendUpload(res, subdir, filename, { noStore = false } = {}) {
  const safe = path.basename(String(filename || ''));
  if (!safe || safe.includes('..')) return res.status(404).end();
  const dir = path.resolve(UPLOADS, subdir);
  const full = path.resolve(dir, safe);
  if (full !== dir && !full.startsWith(dir + path.sep)) return res.status(404).end();
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (noStore) res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(full);
}

app.get('/api/media/profile/:file', requireUser, (req, res) => sendUpload(res, 'profiles', req.params.file));
app.get('/api/media/group/:file', requireUser, (req, res) => sendUpload(res, 'groups', req.params.file));

app.get('/api/media/chat/:file', requireUser, (req, res) => {
  const file = path.basename(req.params.file);
  const msg = db.prepare('SELECT * FROM messages WHERE media_path = ? AND type = ?').get(file, 'image');
  if (!msg) return res.status(404).end();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(msg.conversation_id);
  const admin = currentAdmin(req);
  const member = conv && (conv.user_lo === req.user.id || conv.user_hi === req.user.id);
  if (!admin && !member) return res.status(403).end();
  const own = msg.sender_id === req.user.id || msg.sender_id == null;
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

app.get('/api/admin/accounts/:id/nrc/:side', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const side = String(req.params.side || '');
  const file = side === 'front' ? user.nrc_front_path : side === 'back' ? user.nrc_back_path : null;
  if (!file) return res.status(404).json({ error: 'NRC photo not on file.' });
  sendUpload(res, 'nrc', file, { noStore: true });
});

app.post('/api/admin/login', rateLimit({ windowMs: 60 * 1000, max: 12, name: 'admin-login' }), (req, res) => {
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong admin username or password.' });
  }
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
  const pendingHosts = db.prepare("SELECT COUNT(*) AS n FROM users WHERE host_status = 'pending' AND is_ai = 0").get().n;
  const pendingPayouts = db.prepare("SELECT COUNT(*) AS n FROM host_payouts WHERE status = 'pending'").get().n;
  res.json({
    ok: true,
    username: ADMIN_USERNAME,
    pendingUpgrades: pending,
    pendingHosts,
    pendingPayouts,
    pendingPinRecovery: countPendingPinRecovery(),
    siteName: getSetting(db, 'site_name', 'sakarwine')
  });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_ai = 0").get().n;
  const active = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_ai = 0").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM upgrades WHERE status = 'pending'").get().n;
  const pendingHosts = db.prepare("SELECT COUNT(*) AS n FROM users WHERE host_status = 'pending' AND is_ai = 0").get().n;
  const pendingPayouts = db.prepare("SELECT COUNT(*) AS n FROM host_payouts WHERE status = 'pending'").get().n;
  const chats = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
  res.json({
    users,
    active,
    pendingUpgrades: pending,
    pendingHosts,
    pendingPayouts,
    pendingPinRecovery: countPendingPinRecovery(),
    conversations: chats,
    online: online.size
  });
});

app.get('/api/admin/accounts', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM users WHERE is_ai = 0 ORDER BY id DESC').all();
  const pendingByUser = new Map(
    db
      .prepare("SELECT user_id, COUNT(*) AS n FROM upgrades WHERE status = 'pending' GROUP BY user_id")
      .all()
      .map((r) => [r.user_id, r.n])
  );
  res.json({
    accounts: rows.map((u) =>
      adminUserWithUpgradeFlags(u, { online: isOnline(u.id), pendingCount: pendingByUser.get(u.id) || 0 })
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
    matches: rows.map((u) => adminUserWithUpgradeFlags(u, { online: isOnline(u.id) }))
  });
});

function pendingUpgradeCount(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM upgrades WHERE user_id = ? AND status = 'pending'").get(userId).n;
}

function adminUserWithUpgradeFlags(row, extra = {}) {
  const now = Date.now();
  const pendingCount =
    extra.pendingCount != null ? extra.pendingCount : pendingUpgradeCount(row.id);
  const { pendingCount: _ignored, ...rest } = extra;
  const paidActive = isPaid(row, now);
  return {
    ...adminUser(row, rest),
    paidActive,
    pendingUpgrades: pendingCount,
    extraUpgrade: paidActive && pendingCount > 0
  };
}

function serializeUpgradeRow(u) {
  const submitter = db.prepare('SELECT * FROM users WHERE id = ?').get(u.user_id);
  const targetId = u.target_user_id || u.user_id;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) || submitter;
  const gift = Boolean(target && submitter && target.id !== submitter.id);
  const paidActive = isPaid(target);
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
    phone: submitter ? submitter.phone : null,
    username: submitter ? submitter.username : null,
    level: target ? target.level : null,
    hostCode: u.host_code || null,
    hostId: u.host_id || null,
    paidActive,
    extraUpgrade: Boolean(paidActive && u.status === 'pending'),
    gift,
    submitter: submitter
      ? {
          id: submitter.id,
          accountId: submitter.account_id,
          username: submitter.username,
          phone: submitter.phone
        }
      : null,
    target: target
      ? {
          id: target.id,
          accountId: target.account_id,
          username: target.username,
          phone: target.phone,
          level: target.level
        }
      : null
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
        matches: hits.map((u) => adminUserWithUpgradeFlags(u, { online: isOnline(u.id) }))
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
        peer: adminUser(peer, { online: isOnline(peerId) }),
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
    .map((u) => adminUser(u));
  const blockedBy = db
    .prepare(
      `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocker_id WHERE b.blocked_id = ?`
    )
    .all(user.id)
    .map((u) => adminUser(u));
  res.json({
    user: adminUserWithUpgradeFlags(user, { includeNrc: true, online: isOnline(user.id) }),
    conversations: convos,
    upgrades,
    blocked,
    blockedBy,
    badges: getBadges(db),
    hostIncome: hostIncomeSummary(db, user.id, publicUser),
    payouts: listPayouts(db, adminUser).filter((p) => p.host && p.host.id === user.id)
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
    if (usernameError(username)) {
      return res.status(400).json({ error: usernameError(username) });
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
    if (!PHONE_RE.test(phone)) {
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
      user: adminUser(user, { online: false }),
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
  res.json({ user: adminUser(updated) });
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

app.get('/api/admin/hosts', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE is_ai = 0 AND gender = 'female' AND host_status IN ('pending', 'approved', 'rejected')
       ORDER BY CASE host_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, id DESC`
    )
    .all();
  res.json({
    hosts: rows.map((u) => adminUserWithUpgradeFlags(u, { includeNrc: true, online: isOnline(u.id) }))
  });
});

app.post('/api/admin/accounts/:id/host-approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.gender !== 'female') return res.status(400).json({ error: 'Host verification is for female accounts.' });
  if (!hostIdDocsReady(user)) {
    return res.status(400).json({
      error:
        user.id_doc_type === 'passport'
          ? 'A passport photo is required before approval.'
          : 'NRC front and back photos are required before approval.'
    });
  }
  db.prepare(
    "UPDATE users SET host_status = 'approved', is_host = 1, host_reviewed_at = ? WHERE id = ?"
  ).run(Date.now(), id);
  const hostCode = assignHostCode(db, id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  emitToUser(id, 'host:approved', { isHost: true, hostCode });
  res.json({
    ok: true,
    user: adminUser(updated, { includeNrc: true, online: isOnline(id) })
  });
});

app.post('/api/admin/accounts/:id/host-reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_ai = 0').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.gender !== 'female') return res.status(400).json({ error: 'Host verification is for female accounts.' });
  db.prepare(
    "UPDATE users SET host_status = 'rejected', is_host = 0, host_reviewed_at = ? WHERE id = ?"
  ).run(Date.now(), id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  emitToUser(id, 'host:rejected', { isHost: false });
  res.json({
    ok: true,
    user: adminUser(updated, { includeNrc: true, online: isOnline(id) })
  });
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
      users: [adminUser(a), adminUser(b)],
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
      users: [adminUser(a), adminUser(b)],
      messagingOpen: memberMessagingOpen(conv),
      involvesAdmin: isAdminAccount(a) || isAdminAccount(b)
    },
    messages
  });
});

app.post('/api/admin/conversations/:id/messaging', requireAdmin, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  if (!conversationInvolvesAdmin(conv)) {
    return res.status(400).json({ error: 'Messaging controls are only for chats with an Admin account.' });
  }
  const open = req.body && (req.body.open === false || req.body.open === 0 || req.body.open === '0') ? false : true;
  const updated = setMemberMessaging(conv.id, open, emitToUser);
  res.json({ ok: true, messagingOpen: memberMessagingOpen(updated) });
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
  const beneficiaryId = up.target_user_id || up.user_id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(beneficiaryId);
  if (!user) return res.status(404).json({ error: 'No account found for that ID.' });
  const now = Date.now();
  const base = isPaid(user, now) ? user.paid_until : now;
  const paidUntil = addMonths(base, up.months);
  db.prepare(
    'UPDATE users SET level = level + 1, paid_until = ?, status = CASE WHEN status = ? THEN ? ELSE status END WHERE id = ?'
  ).run(paidUntil, 'pending_liveness', 'active', user.id);
  db.prepare("UPDATE upgrades SET status = 'approved', reviewed_at = ? WHERE id = ?").run(now, id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (up.host_id) {
    const host = db.prepare('SELECT * FROM users WHERE id = ?').get(up.host_id);
    creditHostForUpgrade(db, {
      host,
      member: updated,
      upgradeId: up.id,
      months: up.months,
      now,
      emit: emitToUser
    });
  }
  emitToUser(user.id, 'upgrade:approved', {
    months: up.months,
    paidUntil,
    level: updated.level
  });
  if (up.user_id !== user.id) {
    emitToUser(up.user_id, 'upgrade:approved', {
      months: up.months,
      paidUntil,
      level: updated.level,
      gift: true,
      targetAccountId: updated.account_id
    });
  }
  res.json({ ok: true, user: adminUser(updated) });
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

app.get('/api/admin/payouts', requireAdmin, (_req, res) => {
  res.json({ payouts: listPayouts(db, adminUser) });
});

app.post('/api/admin/payouts/:id/done', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM host_payouts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Payout not found.' });
  if (row.status === 'done') return res.status(400).json({ error: 'Already marked done.' });
  db.prepare("UPDATE host_payouts SET status = 'done', reviewed_at = ? WHERE id = ?").run(Date.now(), id);
  insertSystemMessage(row.host_id, 'ငွေဝင်ပါပြီ');
  emitToUser(row.host_id, 'payout:done', { id: row.id, amount: row.amount });
  res.json({ ok: true });
});

app.get('/api/admin/pin-recovery', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM pin_recovery_requests
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`
    )
    .all();
  res.json({ requests: rows.map(serializePinRecovery) });
});

app.post('/api/admin/pin-recovery/:id/done', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM pin_recovery_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'PIN recovery request not found.' });
  if (row.status === 'done') return res.status(400).json({ error: 'Already marked done.' });
  db.prepare("UPDATE pin_recovery_requests SET status = 'done', reviewed_at = ? WHERE id = ?").run(Date.now(), id);
  res.json({ ok: true, request: serializePinRecovery({ ...row, status: 'done', reviewed_at: Date.now() }) });
});

app.post(
  '/api/admin/broadcast',
  requireAdmin,
  rateLimit({ windowMs: 60 * 1000, max: 10, name: 'broadcast' }),
  multerSingle(uploadBroadcast, 'image'),
  (req, res) => {
    const body = String(req.body.body || '').trim();
    const image = req.file ? req.file.filename : null;
    if (!body && !image) return res.status(400).json({ error: 'Write a system message or attach an image.' });
    if (body && body.length > 2000) return res.status(400).json({ error: 'Message is too long.' });
    const info = db
      .prepare('INSERT INTO broadcasts (body, media_path, created_at) VALUES (?, ?, ?)')
      .run(body || null, image, Date.now());
    const users = db.prepare("SELECT id FROM users WHERE is_ai = 0 AND status = 'active'").all();
    let sent = 0;
    for (const u of users) {
      insertSystemMessage(u.id, body || null, image);
      sent += 1;
    }
    io.emit('broadcast', { body: body || null, hasImage: Boolean(image) });
    res.json({ ok: true, id: info.lastInsertRowid, sent });
  }
);

app.get('/api/admin/ads', requireAdmin, (_req, res) => {
  res.json({ ads: listAds(db), rotateMs: AD_ROTATE_MS });
});

app.post('/api/admin/ads', requireAdmin, multerSingle(uploadAd, 'image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a banner image.' });
  const row = addAd(db, req.file.filename);
  res.json({ ok: true, ad: { id: row.id, imageUrl: `/api/ads/${row.id}/image` } });
});

app.delete('/api/admin/ads/:id', requireAdmin, (req, res) => {
  const row = deleteAd(db, Number(req.params.id), UPLOADS);
  if (!row) return res.status(404).json({ error: 'Banner not found.' });
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
    incomeDemoVideoUrl: getSetting(db, 'income_demo_video_url', '/demo/income-host.mp4'),
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
  if (req.body.incomeDemoVideoUrl != null) {
    const url = String(req.body.incomeDemoVideoUrl).trim().slice(0, 400);
    if (url && !/^(\/|https:\/\/)/i.test(url)) {
      return res.status(400).json({ error: 'Demo video must be a site path or https URL.' });
    }
    setSetting(db, 'income_demo_video_url', url || '/demo/income-host.mp4');
  }
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
    incomeDemoVideoUrl: getSetting(db, 'income_demo_video_url', '/demo/income-host.mp4'),
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
  const leak = process.env.NODE_ENV !== 'production' && err && err.message;
  res.status(500).json({ error: leak || 'Server error.' });
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
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  socket.broadcast.emit('presence', { userId: user.id, online: true });

  socket.on('typing', (payload) => {
    const conversationId = Number(payload && payload.conversationId);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) return;
    const peer = otherUserId(conv, user.id);
    emitToUser(peer, 'typing', { conversationId, userId: user.id, typing: Boolean(payload.typing) });
  });

  socket.on('chat:enter', (payload) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(payload && payload.conversationId));
    if (!conv || (conv.user_lo !== user.id && conv.user_hi !== user.id)) return;
    socket.data.chatId = conv.id;
    socket.join(`chat:${conv.id}`);
    const tick = touchPresence(conv, user.id, 'enter');
    socket.emit('chat:mutual', {
      conversationId: conv.id,
      mutual: mutualSnapshot(
        db,
        conv,
        user,
        db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, user.id))
      ),
      credited: tick.credited
    });
  });

  socket.on('chat:ping', (payload) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(payload && payload.conversationId));
    if (!conv || (conv.user_lo !== user.id && conv.user_hi !== user.id)) return;
    const tick = touchPresence(conv, user.id, 'ping');
    socket.emit('chat:mutual', {
      conversationId: conv.id,
      mutual: mutualSnapshot(
        db,
        conv,
        user,
        db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId(conv, user.id))
      ),
      credited: tick.credited
    });
  });

  socket.on('chat:leave', (payload) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(payload && payload.conversationId));
    if (!conv || (conv.user_lo !== user.id && conv.user_hi !== user.id)) return;
    socket.leave(`chat:${conv.id}`);
    if (socket.data.chatId === conv.id) socket.data.chatId = null;
    touchPresence(conv, user.id, 'leave');
  });

  socket.on('disconnect', () => {
    if (socket.data.chatId) {
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(socket.data.chatId);
      if (conv) touchPresence(conv, user.id, 'leave');
    }
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
  const runPurge = () => {
    try {
      const closed = purgeStaleAccounts(db, UPLOADS);
      if (closed.length) console.log(`Purged ${closed.length} stale account(s)`);
    } catch (err) {
      console.error('offline purge failed', err);
    }
  };
  runPurge();
  setInterval(runPurge, Math.min(OFFLINE_PURGE_MS, 15 * 60 * 1000)).unref();
}

if (require.main === module) start();

module.exports = {
  app,
  server,
  db,
  start,
  DATA_DIR,
  FREE_CHAT_MS,
  HOST_CREDIT_AMOUNT,
  HOST_WITHDRAW_MIN,
  OFFLINE_PURGE_MS
};
