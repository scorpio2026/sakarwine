'use strict';

process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'sakarwine-'));
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.FREE_CHAT_MS = '60000';
process.env.HOST_CHAT_MS = '80';
process.env.HOST_CREDIT_AMOUNT = '500';
process.env.HOST_PRESENCE_GRACE_MS = '5000';
process.env.HOST_WITHDRAW_MIN = '1000';
process.env.OFFLINE_PURGE_MS = String(30 * 24 * 60 * 60 * 1000);
process.env.SESSION_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, db, FREE_CHAT_MS } = require('../src/server');
const { remainingPaidHours } = require('../src/pricing');
const { purgeStaleAccounts } = require('../src/platform');
const { DAY_MS, DEFAULT_FREE_TRIAL_DAYS, LEGACY_FREE_CHAT_MS, userFreeChatMs } = require('../src/db');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function cookieJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    store(res) {
      const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const c of raw) {
        const [nv] = c.split(';');
        const eq = nv.indexOf('=');
        jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1).trim());
      }
    }
  };
}

let base;
const started = new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
});

async function req(path, { method = 'GET', json, form, jar } = {}) {
  const headers = {};
  if (jar) headers.cookie = jar.header();
  let body;
  if (json) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(base + path, { method, headers, body });
  if (jar) jar.store(res);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function register(name, pin, gender = 'female') {
  const jar = cookieJar();
  const form = new FormData();
  form.set('username', name);
  form.set('password', pin);
  form.set('gender', gender);
  form.set('birthYear', '1998');
  form.set('phone', '091111111');
  form.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const { data } = await req('/api/register', { method: 'POST', form, jar });
  assert.ok(data.user, data.error);
  await req('/api/me/liveness', {
    method: 'POST',
    json: { left: true, right: true, estimatedGender: gender },
    jar
  });
  return { jar, user: data.user };
}

async function applyHost(member, extras = {}) {
  const form = new FormData();
  if (extras.idType) form.set('idType', extras.idType);
  form.set('nrcFront', extras.nrcFront || new Blob([PNG], { type: 'image/png' }), 'front.png');
  if (extras.idType !== 'passport') {
    form.set('nrcBack', extras.nrcBack || new Blob([PNG], { type: 'image/png' }), 'back.png');
  }
  const applied = await req('/api/me/host-apply', { method: 'POST', form, jar: member.jar });
  assert.equal(applied.res.status, 200, applied.data.error);
  member.user = applied.data.user;
  return member;
}

async function loginAdmin() {
  const jar = cookieJar();
  const login = await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar
  });
  assert.equal(login.data.ok, true);
  return jar;
}

async function giveUpgrade(admin, member, hostCode) {
  const receipt = new FormData();
  receipt.set('targetAccountId', member.user.accountId);
  receipt.set('months', '1');
  if (hostCode) receipt.set('hostCode', hostCode);
  receipt.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const submitted = await req('/api/upgrade', { method: 'POST', form: receipt, jar: member.jar });
  assert.equal(submitted.res.status, 200, submitted.data.error);
  const queue = await req('/api/admin/upgrades', { jar: admin });
  const pending = queue.data.upgrades.find((u) => u.status === 'pending' && u.accountId === member.user.accountId);
  assert.ok(pending);
  const approved = await req(`/api/admin/upgrades/${pending.id}/approve`, { method: 'POST', jar: admin });
  assert.ok(approved.data.user.level >= 1);
  member.user = approved.data.user;
  return member;
}

async function sitTogether(cid, jarA, jarB, waitMs = 120) {
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'enter' }, jar: jarA });
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'enter' }, jar: jarB });
  await new Promise((r) => setTimeout(r, waitMs));
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'ping' }, jar: jarB });
  return req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'ping' }, jar: jarA });
}

test('health', async () => {
  await started;
  const { data } = await req('/health');
  assert.equal(data.ok, true);
});

test('home people list filters by gender query', async () => {
  await started;
  const viewer = await register('gview' + Date.now().toString().slice(-5), '121212', 'male');
  const man = await register('gman' + Date.now().toString().slice(-5), '232323', 'male');
  const woman = await register('gwoman' + Date.now().toString().slice(-4), '343434', 'female');

  const all = await req('/api/users', { jar: viewer.jar });
  assert.ok(all.data.users.some((u) => u.username === man.user.username));
  assert.ok(all.data.users.some((u) => u.username === woman.user.username));

  const men = await req('/api/users?gender=male', { jar: viewer.jar });
  assert.ok(men.data.users.some((u) => u.username === man.user.username));
  assert.equal(men.data.users.some((u) => u.username === woman.user.username), false);
  assert.ok(men.data.users.every((u) => u.gender === 'male'));

  const women = await req('/api/users?gender=female', { jar: viewer.jar });
  assert.ok(women.data.users.some((u) => u.username === woman.user.username));
  assert.equal(women.data.users.some((u) => u.username === man.user.username), false);
  assert.ok(women.data.users.every((u) => u.gender === 'female'));

  const ignored = await req('/api/users?gender=nope', { jar: viewer.jar });
  assert.equal(ignored.data.users.length, all.data.users.length);
});

test('owner /api/me exposes freeUntil; public users and profile cards do not', async () => {
  await started;
  const owner = await register('frown' + Date.now().toString().slice(-5), '121212', 'male');
  const other = await register('frope' + Date.now().toString().slice(-5), '232323', 'female');
  const me = await req('/api/me', { jar: owner.jar });
  assert.ok(me.data.user.freeUntil);
  assert.equal(me.data.user.freeUntil, Number(me.data.user.createdAt) + DEFAULT_FREE_TRIAL_DAYS * DAY_MS);
  assert.equal(me.data.user.freeUntil, Number(me.data.user.createdAt) + FREE_CHAT_MS);
  assert.ok(me.data.user.freeUntil > Date.now());

  const listed = await req('/api/users', { jar: owner.jar });
  const peer = listed.data.users.find((u) => u.username === other.user.username);
  assert.ok(peer);
  assert.equal(Object.prototype.hasOwnProperty.call(peer, 'freeUntil'), false);
  assert.equal(peer.freeUntil, undefined);

  const selfRow = listed.data.users.find((u) => u.username === owner.user.username);
  if (selfRow) assert.equal(Object.prototype.hasOwnProperty.call(selfRow, 'freeUntil'), false);

  const card = await req(`/api/users/${peer.id}/card`, { jar: owner.jar });
  assert.equal(card.res.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(card.data.user, 'freeUntil'), false);
  assert.equal(card.data.user.freeUntil, undefined);
  assert.equal(card.data.user.level, other.user.level);
  assert.equal(card.data.user.isHost, false);
});

test('two users chat, filters, image lock, upgrade path', async () => {
  await started;
  const a = await register('rose' + Date.now().toString().slice(-6), '123456', 'female');
  const b = await register('oak' + Date.now().toString().slice(-5), '654321', 'male');

  const usersA = await req('/api/users', { jar: a.jar });
  assert.ok(usersA.data.users.some((u) => u.username === b.user.username));
  const peer = usersA.data.users.find((u) => u.username === b.user.username);

  const opened = await req(`/api/conversations/with/${peer.id}`, { method: 'POST', jar: a.jar });
  const cid = opened.data.conversation.id;

  const ok = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'hello from the cellar' },
    jar: a.jar
  });
  assert.equal(ok.data.message.body, 'hello from the cellar');

  const at = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: '@secret' },
    jar: a.jar
  });
  assert.equal(at.res.status, 400);

  const phone = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'call 09123456789' },
    jar: a.jar
  });
  assert.equal(phone.res.status, 400);

  const imgForm = new FormData();
  imgForm.set('type', 'image');
  imgForm.set('file', new Blob([PNG], { type: 'image/png' }), 'shot.png');
  const img = await req(`/api/conversations/${cid}/messages`, { method: 'POST', form: imgForm, jar: a.jar });
  assert.equal(img.data.message.type, 'image');
  assert.ok(img.data.message.mediaUrl);

  const asB = await req(`/api/conversations/${cid}`, { jar: b.jar });
  const locked = asB.data.messages.find((m) => m.type === 'image');
  assert.equal(locked.imageLocked, true);
  assert.equal(locked.mediaUrl, null);

  await req(`/api/users/${peer.id}/block`, { method: 'POST', jar: a.jar });
  const blocked = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'still there?' },
    jar: b.jar
  });
  assert.equal(blocked.res.status, 403);
  await req(`/api/users/${peer.id}/block`, { method: 'DELETE', jar: a.jar });

  const admin = cookieJar();
  const login = await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar: admin
  });
  assert.equal(login.data.ok, true);

  const receipt = new FormData();
  receipt.set('targetAccountId', a.user.accountId);
  receipt.set('months', '6');
  receipt.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const submitted = await req('/api/upgrade', { method: 'POST', form: receipt, jar: a.jar });
  assert.equal(submitted.data.quote.discountPercent, 30);

  const queue = await req('/api/admin/upgrades', { jar: admin });
  const pending = queue.data.upgrades.find((u) => u.status === 'pending');
  assert.ok(pending.phone);
  assert.equal(pending.accountId, a.user.accountId);
  const approved = await req(`/api/admin/upgrades/${pending.id}/approve`, { method: 'POST', jar: admin });
  assert.equal(approved.data.user.level, 1);
  assert.ok(approved.data.user.paid);

  await req(`/api/admin/conversations/${cid}/expire-free`, { method: 'POST', jar: admin });
  const expired = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'after window' },
    jar: b.jar
  });
  assert.equal(expired.res.status, 402);

  const paidStill = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'paid can still talk' },
    jar: a.jar
  });
  assert.equal(paidStill.res.status, 200);
});

test('special accounts skip the upgrade gate and hide IDs', async () => {
  await started;
  const member = await register('fan' + Date.now().toString().slice(-6), '121212', 'female');
  const admin = cookieJar();
  await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar: admin
  });
  const form = new FormData();
  form.set('username', 'vvip' + Date.now().toString().slice(-5));
  form.set('password', '999999');
  form.set('gender', 'female');
  form.set('birthYear', '1994');
  form.set('phone', '0999999999');
  form.set('badge', 'VVIP');
  const created = await req('/api/admin/accounts', { method: 'POST', form, jar: admin });
  assert.equal(created.res.status, 200, created.data.error);
  assert.equal(created.data.user.isSpecial, true);
  assert.equal(created.data.user.badge, 'VVIP');
  assert.equal(created.data.user.accountIdHidden, true);
  assert.ok(created.data.user.accountId);
  assert.equal(created.data.user.hasPhoto, false);
  assert.equal(created.data.user.photoUrl, '/assets/default-female.png');
  assert.equal(created.data.user.photoUrl.includes('sakarwine-logo'), false);

  const listed = await req('/api/users', { jar: member.jar });
  const vvip = listed.data.users.find((u) => u.username === created.data.user.username);
  assert.ok(vvip);
  assert.equal(vvip.photoUrl, '/assets/default-female.png');
  assert.equal(vvip.hasPhoto, false);
  assert.equal(vvip.accountId, null);
  assert.equal(vvip.accountIdHidden, true);
  assert.equal(vvip.badge, 'VVIP');

  await req(`/api/admin/accounts/${created.data.user.id}/unhide-id`, { method: 'POST', jar: admin });
  const listed2 = await req('/api/users', { jar: member.jar });
  const vvip2 = listed2.data.users.find((u) => u.username === created.data.user.username);
  assert.equal(vvip2.accountId, created.data.user.accountId);

  const vvipJar = cookieJar();
  await req('/api/login', {
    method: 'POST',
    json: { username: created.data.user.username, password: '999999' },
    jar: vvipJar
  });
  const opened = await req(`/api/conversations/with/${member.user.id}`, { method: 'POST', jar: vvipJar });
  const cid = opened.data.conversation.id;
  assert.equal(opened.data.conversation.window.special, true);
  assert.equal(opened.data.conversation.window.canSend, true);

  await req(`/api/admin/conversations/${cid}/expire-free`, { method: 'POST', jar: admin });
  const still = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'special still chatting' },
    jar: vvipJar
  });
  assert.equal(still.res.status, 200, still.data.error);

  const blockedFree = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'regular after expiry' },
    jar: member.jar
  });
  assert.equal(blockedFree.res.status, 402);
});

test('profile card shows account ID and admin accounts cannot be blocked', async () => {
  await started;
  const member = await register('fan2' + Date.now().toString().slice(-5), '121212', 'male');
  const admin = await loginAdmin();
  const form = new FormData();
  form.set('username', 'adm' + Date.now().toString().slice(-5));
  form.set('password', '999999');
  form.set('gender', 'male');
  form.set('birthYear', '1990');
  form.set('phone', '0988888888');
  form.set('badge', 'Admin');
  const created = await req('/api/admin/accounts', { method: 'POST', form, jar: admin });
  assert.equal(created.res.status, 200, created.data.error);
  assert.equal(created.data.user.isAdmin, true);
  assert.equal(created.data.user.blockable, false);
  assert.equal(created.data.user.hasPhoto, false);
  assert.equal(created.data.user.photoUrl, '/assets/default-male.png');

  const listed = await req('/api/users', { jar: member.jar });
  const adm = listed.data.users.find((u) => u.username === created.data.user.username);
  assert.equal(adm.isAdmin, true);
  assert.equal(adm.blockable, false);
  assert.equal(adm.accountId, null);

  const card = await req(`/api/users/${created.data.user.id}/card`, { jar: member.jar });
  assert.equal(card.data.user.accountId, created.data.user.accountId);
  assert.equal(card.data.user.photoUrl, '/assets/default-male.png');
  assert.equal(card.data.user.hasPhoto, false);
  assert.equal(card.data.user.gender, 'male');

  const noBlock = await req(`/api/users/${created.data.user.id}/block`, { method: 'POST', jar: member.jar });
  assert.equal(noBlock.res.status, 403);

  const noStart = await req(`/api/conversations/with/${created.data.user.id}`, { method: 'POST', jar: member.jar });
  assert.equal(noStart.res.status, 403);
  assert.equal(noStart.data.error, 'You cannot start a chat with an Admin account.');

  const admJar = cookieJar();
  const admLogin = await req('/api/login', {
    method: 'POST',
    json: { username: created.data.user.username, password: '999999' },
    jar: admJar
  });
  assert.equal(admLogin.res.status, 200, admLogin.data.error);
  const startedByAdmin = await req(`/api/conversations/with/${member.user.id}`, { method: 'POST', jar: admJar });
  assert.equal(startedByAdmin.res.status, 200, startedByAdmin.data.error);
  const cidAdmin = startedByAdmin.data.conversation.id;
  assert.equal(startedByAdmin.data.conversation.adminGate.waitForAdmin, false);
  const memberView = await req(`/api/conversations/${cidAdmin}`, { jar: member.jar });
  assert.equal(memberView.data.conversation.adminGate.waitForAdmin, true);
  assert.equal(memberView.data.conversation.adminGate.canSend, false);
  const tooSoon = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'member cannot go first' },
    jar: member.jar
  });
  assert.equal(tooSoon.res.status, 403);
  assert.equal(tooSoon.data.error, 'Wait for the admin to send a message first.');
  const first = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'admin says hi first' },
    jar: admJar
  });
  assert.equal(first.res.status, 200, first.data.error);
  assert.equal(first.data.adminGate.waitForAdmin, false);

  const opened = await req(`/api/conversations/with/${created.data.user.id}`, { method: 'POST', jar: member.jar });
  assert.equal(opened.res.status, 200, opened.data.error);
  assert.equal(opened.data.conversation.adminGate.waitForAdmin, false);
  const reply = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'member replies' },
    jar: member.jar
  });
  assert.equal(reply.res.status, 200, reply.data.error);

  const closed = await req(`/api/conversations/${cidAdmin}/messaging`, {
    method: 'POST',
    json: { open: false },
    jar: admJar
  });
  assert.equal(closed.res.status, 200, closed.data.error);
  assert.equal(closed.data.messagingOpen, false);
  const blockedSend = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'should fail' },
    jar: member.jar
  });
  assert.equal(blockedSend.res.status, 403);
  assert.equal(blockedSend.data.error, 'This chat is closed by admin.');
  const stillAdmin = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'admin can still write' },
    jar: admJar
  });
  assert.equal(stillAdmin.res.status, 200, stillAdmin.data.error);

  const dash = await loginAdmin();
  const dashClose = await req(`/api/admin/conversations/${cidAdmin}/messaging`, {
    method: 'POST',
    json: { open: true },
    jar: dash
  });
  assert.equal(dashClose.res.status, 200, dashClose.data.error);
  const again = await req(`/api/conversations/${cidAdmin}/messages`, {
    method: 'POST',
    json: { body: 'open again' },
    jar: member.jar
  });
  assert.equal(again.res.status, 200, again.data.error);

  const other = await register('plain' + Date.now().toString().slice(-5), '121212', 'female');
  const peerChat = await req(`/api/conversations/with/${other.user.id}`, { method: 'POST', jar: member.jar });
  const dashPeer = await req(`/api/admin/conversations/${peerChat.data.conversation.id}/messaging`, {
    method: 'POST',
    json: { open: false },
    jar: dash
  });
  assert.equal(dashPeer.res.status, 400);

  const hijack = await req(`/api/conversations/${cidAdmin}/messaging`, {
    method: 'POST',
    json: { open: false },
    jar: member.jar
  });
  assert.equal(hijack.res.status, 403);
});

test('members never receive phone numbers; admin still does', async () => {
  await started;
  const member = await register('priv' + Date.now().toString().slice(-6), '121212', 'male');
  const other = await register('seen' + Date.now().toString().slice(-6), '343434', 'female');
  const assertNoPhone = (obj, label) => {
    const json = JSON.stringify(obj);
    assert.equal(Object.prototype.hasOwnProperty.call(obj || {}, 'phone'), false, `${label} has phone key`);
    assert.equal(json.includes('091111111'), false, `${label} leaked 091111111: ${json}`);
  };

  const me = await req('/api/me', { jar: member.jar });
  assert.equal(me.res.status, 200);
  assertNoPhone(me.data.user, '/api/me');

  const listed = await req('/api/users', { jar: member.jar });
  for (const u of listed.data.users) assertNoPhone(u, `list ${u.username}`);

  const card = await req(`/api/users/${other.user.id}/card`, { jar: member.jar });
  assert.equal(card.res.status, 200);
  assertNoPhone(card.data.user, 'card');
  assert.ok(card.data.user.accountId);

  const opened = await req(`/api/conversations/with/${other.user.id}`, { method: 'POST', jar: member.jar });
  assertNoPhone(opened.data.conversation.peer, 'open peer');
  const thread = await req(`/api/conversations/${opened.data.conversation.id}`, { jar: member.jar });
  assertNoPhone(thread.data.conversation.peer, 'thread peer');
  for (const m of thread.data.messages) {
    if (m.sender) assertNoPhone(m.sender, 'sender');
  }

  const admin = await loginAdmin();
  const accounts = await req('/api/admin/accounts', { jar: admin });
  const row = accounts.data.accounts.find((a) => a.id === member.user.id);
  assert.equal(row.phone, '091111111');
});

test('settings: members can edit display profile and manage blocked list, not PIN', async () => {
  await started;
  const member = await register('seta' + Date.now().toString().slice(-6), '121212', 'male');
  const other = await register('setb' + Date.now().toString().slice(-6), '343434', 'female');
  const taken = other.user.username;
  const before = await req('/api/me', { jar: member.jar });
  const oldPhoto = before.data.user.photoUrl;
  const oldLevel = before.data.user.level;
  const oldGender = before.data.user.gender;
  const oldYear = before.data.user.birthYear;

  const hijack = await req('/api/me/profile', {
    method: 'PUT',
    json: {
      username: 'setanew' + Date.now().toString().slice(-4),
      password: '000000',
      pin: '000000',
      phone: '0999999999',
      gender: 'female',
      birthYear: 2001,
      level: 99,
      badge: 'VVIP'
    },
    jar: member.jar
  });
  assert.equal(hijack.res.status, 200, hijack.data.error);
  assert.match(hijack.data.user.username, /^setanew/);
  assert.equal(hijack.data.user.level, oldLevel);
  assert.equal(hijack.data.user.gender, oldGender);
  assert.equal(hijack.data.user.birthYear, oldYear);
  assert.equal(hijack.data.user.badge, null);
  assert.equal(Object.prototype.hasOwnProperty.call(hijack.data.user, 'phone'), false);
  assert.equal(JSON.stringify(hijack.data).includes('0999999999'), false);
  assert.equal(JSON.stringify(hijack.data).includes('091111111'), false);

  const pinStill = await req('/api/login', {
    method: 'POST',
    json: { username: hijack.data.user.username, password: '121212' },
    jar: cookieJar()
  });
  assert.equal(pinStill.res.status, 200, pinStill.data.error);
  const pinChanged = await req('/api/login', {
    method: 'POST',
    json: { username: hijack.data.user.username, password: '000000' },
    jar: cookieJar()
  });
  assert.equal(pinChanged.res.status, 401);

  const pinBad = await req('/api/me/pin', {
    method: 'POST',
    json: { currentPin: '000000', newPin: '654321', confirmPin: '654321' },
    jar: member.jar
  });
  assert.equal(pinBad.res.status, 400);
  assert.equal(pinBad.data.error, 'Current PIN is wrong.');
  const pinMismatch = await req('/api/me/pin', {
    method: 'POST',
    json: { currentPin: '121212', newPin: '654321', confirmPin: '111111' },
    jar: member.jar
  });
  assert.equal(pinMismatch.res.status, 400);
  assert.equal(pinMismatch.data.error, 'New PIN and confirmation do not match.');
  const pinSame = await req('/api/me/pin', {
    method: 'POST',
    json: { currentPin: '121212', newPin: '121212', confirmPin: '121212' },
    jar: member.jar
  });
  assert.equal(pinSame.res.status, 400);
  assert.equal(pinSame.data.error, 'Choose a different 6-digit PIN.');
  const pinOk = await req('/api/me/pin', {
    method: 'POST',
    json: { currentPin: '121212', newPin: '654321', confirmPin: '654321' },
    jar: member.jar
  });
  assert.equal(pinOk.res.status, 200, pinOk.data.error);
  const loginNew = await req('/api/login', {
    method: 'POST',
    json: { username: hijack.data.user.username, password: '654321' },
    jar: cookieJar()
  });
  assert.equal(loginNew.res.status, 200, loginNew.data.error);
  const loginOld = await req('/api/login', {
    method: 'POST',
    json: { username: hijack.data.user.username, password: '121212' },
    jar: cookieJar()
  });
  assert.equal(loginOld.res.status, 401);

  const clash = await req('/api/me/profile', {
    method: 'PUT',
    json: { username: taken },
    jar: member.jar
  });
  assert.equal(clash.res.status, 409);

  const reserved = await req('/api/me/profile', {
    method: 'PUT',
    json: { username: 'Saka' },
    jar: member.jar
  });
  assert.equal(reserved.res.status, 400);

  const photoForm = new FormData();
  photoForm.set('username', hijack.data.user.username);
  photoForm.set('photo', new Blob([PNG], { type: 'image/png' }), 'next.png');
  const photoed = await req('/api/me/profile', { method: 'PUT', form: photoForm, jar: member.jar });
  assert.equal(photoed.res.status, 200, photoed.data.error);
  assert.ok(photoed.data.user.photoUrl);
  assert.notEqual(photoed.data.user.photoUrl, oldPhoto);

  const empty = await req('/api/me/blocked', { jar: member.jar });
  assert.equal(empty.res.status, 200);
  assert.deepEqual(empty.data.users, []);

  const blocked = await req(`/api/users/${other.user.id}/block`, { method: 'POST', jar: member.jar });
  assert.equal(blocked.res.status, 200);
  const listed = await req('/api/me/blocked', { jar: member.jar });
  assert.equal(listed.data.users.length, 1);
  assert.equal(listed.data.users[0].id, other.user.id);
  assert.equal(listed.data.users[0].blocked, true);
  assert.equal(Object.prototype.hasOwnProperty.call(listed.data.users[0], 'phone'), false);
  assert.equal(JSON.stringify(listed.data).includes('091111111'), false);

  await req(`/api/users/${other.user.id}/block`, { method: 'DELETE', jar: member.jar });
  const cleared = await req('/api/me/blocked', { jar: member.jar });
  assert.equal(cleared.data.users.length, 0);
});

test('profile bio is owner-editable, filtered, and visible without phones', async () => {
  await started;
  const owner = await register('bioa' + Date.now().toString().slice(-6), '121212', 'male');
  const visitor = await register('biob' + Date.now().toString().slice(-6), '343434', 'female');
  const note = 'Hello from the wine lounge';
  const saved = await req('/api/me/profile', { method: 'PUT', json: { bio: note }, jar: owner.jar });
  assert.equal(saved.res.status, 200, saved.data.error);
  assert.equal(saved.data.user.bio, note);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.data.user, 'phone'), false);

  const me = await req('/api/me', { jar: owner.jar });
  assert.equal(me.data.user.bio, note);

  const listed = await req('/api/users', { jar: visitor.jar });
  const peer = listed.data.users.find((u) => u.id === owner.user.id);
  assert.ok(peer);
  assert.equal(peer.bio, note);
  assert.equal(Object.prototype.hasOwnProperty.call(peer, 'phone'), false);

  const card = await req(`/api/users/${owner.user.id}/card`, { jar: visitor.jar });
  assert.equal(card.data.user.bio, note);
  assert.equal(Object.prototype.hasOwnProperty.call(card.data.user, 'phone'), false);
  assert.equal(JSON.stringify(card.data).includes('091111111'), false);

  const atStart = await req('/api/me/profile', { method: 'PUT', json: { bio: '@admin' }, jar: owner.jar });
  assert.equal(atStart.res.status, 400);
  assert.equal(atStart.data.error, 'Bio cannot start with @.');
  const phone = await req('/api/me/profile', { method: 'PUT', json: { bio: 'call me 0912345678' }, jar: owner.jar });
  assert.equal(phone.res.status, 400);
  assert.match(phone.data.error, /09/);
  const restricted = await req('/api/me/profile', {
    method: 'PUT',
    json: { bio: 'hi\u200bthere' },
    jar: owner.jar
  });
  assert.equal(restricted.res.status, 400);
  assert.equal(restricted.data.error, 'Restricted characters are not allowed.');
  const tooLong = await req('/api/me/profile', {
    method: 'PUT',
    json: { bio: 'x'.repeat(281) },
    jar: owner.jar
  });
  assert.equal(tooLong.res.status, 400);
  assert.match(tooLong.data.error, /280/);
  const keep = await req('/api/me', { jar: owner.jar });
  assert.equal(keep.data.user.bio, note);

  const hijack = await req('/api/me/profile', {
    method: 'PUT',
    json: { bio: 'updated lounge note', phone: '0999999999', level: 99 },
    jar: owner.jar
  });
  assert.equal(hijack.res.status, 200, hijack.data.error);
  assert.equal(hijack.data.user.bio, 'updated lounge note');
  assert.equal(hijack.data.user.level, 0);
  assert.equal(JSON.stringify(hijack.data).includes('0999999999'), false);

  const clearedBio = await req('/api/me/profile', { method: 'PUT', json: { bio: '   ' }, jar: owner.jar });
  assert.equal(clearedBio.res.status, 200, clearedBio.data.error);
  assert.equal(clearedBio.data.user.bio, '');
});

test('admin account ID search opens a full dossier', async () => {
  await started;
  const member = await register('seek' + Date.now().toString().slice(-6), '343434', 'male');
  const admin = cookieJar();
  await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar: admin
  });
  const people = await req('/api/users', { jar: member.jar });
  const saka = people.data.users.find((u) => u.isAi);
  const opened = await req(`/api/conversations/with/${saka.id}`, {
    method: 'POST',
    jar: member.jar
  });
  await req(`/api/conversations/${opened.data.conversation.id}/messages`, {
    method: 'POST',
    json: { body: 'hello dossier' },
    jar: member.jar
  });
  const prefix = member.user.accountId.slice(0, 6);
  const search = await req(`/api/admin/search?q=${prefix}`, { jar: admin });
  assert.ok(search.data.matches.some((m) => m.accountId === member.user.accountId));
  const dossier = await req(`/api/admin/dossier?q=${member.user.accountId}`, { jar: admin });
  assert.equal(dossier.data.user.username, member.user.username);
  assert.equal(dossier.data.user.phone, '091111111');
  assert.ok(dossier.data.conversations.length >= 1);
  assert.ok(['active', 'pending_liveness'].includes(dossier.data.user.status));
  const hide = await req(`/api/admin/accounts/${member.user.id}/hide-id`, { method: 'POST', jar: admin });
  assert.equal(hide.data.hideAccountId, true);
  const again = await req(`/api/admin/dossier?q=${member.user.accountId}`, { jar: admin });
  assert.equal(again.data.user.accountIdHidden, true);
});

test('chat history is per-user delete and messages cannot be edited', async () => {
  await started;
  const a = await register('keep' + Date.now().toString().slice(-6), '111111', 'female');
  const b = await register('wipe' + Date.now().toString().slice(-6), '222222', 'male');
  const usersA = await req('/api/users', { jar: a.jar });
  const peer = usersA.data.users.find((u) => u.username === b.user.username);
  const opened = await req(`/api/conversations/with/${peer.id}`, { method: 'POST', jar: a.jar });
  const cid = opened.data.conversation.id;

  const first = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'remember this forever' },
    jar: a.jar
  });
  assert.equal(first.res.status, 200);
  const msgId = first.data.message.id;
  assert.equal(first.data.message.editable, false);

  const edited = await req(`/api/conversations/${cid}/messages/${msgId}`, {
    method: 'PUT',
    json: { body: 'changed my mind' },
    jar: a.jar
  });
  assert.equal(edited.res.status, 403);
  assert.match(edited.data.error, /cannot be edited/i);

  const patched = await req(`/api/messages/${msgId}`, {
    method: 'PATCH',
    json: { body: 'still trying' },
    jar: a.jar
  });
  assert.equal(patched.res.status, 403);

  const afterEdit = await req(`/api/conversations/${cid}`, { jar: a.jar });
  assert.equal(afterEdit.data.messages.find((m) => m.id === msgId).body, 'remember this forever');
  assert.equal(afterEdit.data.conversation.messagesEditable, false);
  assert.equal(afterEdit.data.conversation.canDelete, true);

  const del = await req(`/api/conversations/${cid}`, { method: 'DELETE', jar: b.jar });
  assert.equal(del.res.status, 200, del.data.error);
  assert.equal(del.data.hiddenFor, 'self');

  const asB = await req(`/api/conversations/${cid}`, { jar: b.jar });
  assert.equal(asB.data.messages.some((m) => m.body === 'remember this forever'), false);
  assert.ok(asB.data.conversation.hiddenAt);

  const asA = await req(`/api/conversations/${cid}`, { jar: a.jar });
  assert.equal(asA.data.messages.some((m) => m.body === 'remember this forever'), true);

  const next = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'fresh after delete' },
    jar: a.jar
  });
  assert.equal(next.res.status, 200, next.data.error);

  const asB2 = await req(`/api/conversations/${cid}`, { jar: b.jar });
  assert.equal(asB2.data.messages.length, 1);
  assert.equal(asB2.data.messages[0].body, 'fresh after delete');

  const asA2 = await req(`/api/conversations/${cid}`, { jar: a.jar });
  assert.ok(asA2.data.messages.some((m) => m.body === 'remember this forever'));
  assert.ok(asA2.data.messages.some((m) => m.body === 'fresh after delete'));

  const admin = cookieJar();
  await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar: admin
  });
  const mod = await req(`/api/admin/conversations/${cid}`, { jar: admin });
  assert.ok(mod.data.messages.some((m) => m.body === 'remember this forever'));
  assert.ok(mod.data.messages.some((m) => m.body === 'fresh after delete'));

  const saka = usersA.data.users.find((u) => u.isAi);
  const withSaka = await req(`/api/conversations/with/${saka.id}`, { method: 'POST', jar: a.jar });
  const delSaka = await req(`/api/conversations/${withSaka.data.conversation.id}`, {
    method: 'DELETE',
    jar: a.jar
  });
  assert.equal(delSaka.res.status, 400);
});

test('member inbox lists visible conversations and hides deleted threads', async () => {
  await started;
  const a = await register('inbA' + Date.now().toString().slice(-5), '121212', 'male');
  const b = await register('inbB' + Date.now().toString().slice(-5), '343434', 'female');

  const denied = await req('/api/conversations');
  assert.equal(denied.res.status, 401);

  const before = await req('/api/conversations', { jar: a.jar });
  assert.equal(before.res.status, 200, before.data.error);
  assert.ok(Array.isArray(before.data.conversations));
  assert.ok(before.data.conversations.every((c) => c.peer && c.peer.isAi));
  before.data.conversations.forEach((c) => {
    assert.equal(c.peer.phone, undefined);
  });

  const opened = await req(`/api/conversations/with/${b.user.id}`, { method: 'POST', jar: a.jar });
  const cid = opened.data.conversation.id;
  const emptyThread = await req('/api/conversations', { jar: a.jar });
  assert.equal(emptyThread.data.conversations.some((c) => c.id === cid), false);

  const sent = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'hello inbox' },
    jar: a.jar
  });
  assert.equal(sent.res.status, 200, sent.data.error);

  const listed = await req('/api/conversations', { jar: a.jar });
  const row = listed.data.conversations.find((c) => c.id === cid);
  assert.ok(row);
  assert.equal(row.peer.id, b.user.id);
  assert.equal(row.peer.phone, undefined);
  assert.equal(row.lastMessage.body, 'hello inbox');
  assert.equal(listed.data.conversations[0].id, cid);

  const asB = await req('/api/conversations', { jar: b.jar });
  const bRow = asB.data.conversations.find((c) => c.id === cid);
  assert.ok(bRow);
  assert.equal(bRow.peer.id, a.user.id);
  assert.equal(bRow.peer.phone, undefined);

  const del = await req(`/api/conversations/${cid}`, { method: 'DELETE', jar: b.jar });
  assert.equal(del.res.status, 200, del.data.error);
  const hidden = await req('/api/conversations', { jar: b.jar });
  assert.equal(hidden.data.conversations.some((c) => c.id === cid), false);
  const stillA = await req('/api/conversations', { jar: a.jar });
  assert.ok(stillA.data.conversations.some((c) => c.id === cid));

  const again = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'after hide' },
    jar: a.jar
  });
  assert.equal(again.res.status, 200, again.data.error);
  const restored = await req('/api/conversations', { jar: b.jar });
  const back = restored.data.conversations.find((c) => c.id === cid);
  assert.ok(back);
  assert.equal(back.lastMessage.body, 'after hide');
});

test('paid members can create groups; invites accept and decline', async () => {
  await started;
  const free = await register('gfree' + Date.now().toString().slice(-5), '121212', 'male');
  const owner = await register('gown' + Date.now().toString().slice(-5), '232323', 'female');
  const invitee = await register('ginv' + Date.now().toString().slice(-5), '343434', 'male');
  const other = await register('goth' + Date.now().toString().slice(-5), '454545', 'female');
  const admin = await loginAdmin();
  await giveUpgrade(admin, owner);

  function groupForm(name) {
    const form = new FormData();
    form.set('name', name);
    form.set('logo', new Blob([PNG], { type: 'image/png' }), 'logo.png');
    return form;
  }

  const denied = await req('/api/groups', { method: 'POST', form: groupForm('NoPay'), jar: free.jar });
  assert.equal(denied.res.status, 403);
  assert.match(denied.data.error, /upgrade/i);

  const created = await req('/api/groups', { method: 'POST', form: groupForm('Sunset'), jar: owner.jar });
  assert.equal(created.res.status, 200, created.data.error);
  const gid = created.data.group.id;
  assert.equal(created.data.group.name, 'Sunset');
  assert.ok(created.data.group.logoUrl);

  const listed = await req('/api/groups', { jar: owner.jar });
  assert.ok(listed.data.groups.some((g) => g.id === gid));
  assert.equal(listed.data.canCreate, true);

  const lookup = await req(`/api/groups/lookup?accountId=${encodeURIComponent(invitee.user.accountId)}`, {
    jar: owner.jar
  });
  assert.equal(lookup.res.status, 200, lookup.data.error);
  assert.equal(lookup.data.user.username, invitee.user.username);
  assert.equal(lookup.data.user.phone, undefined);

  const self = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: owner.user.id },
    jar: owner.jar
  });
  assert.equal(self.res.status, 400);

  const inv = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: invitee.user.id },
    jar: owner.jar
  });
  assert.equal(inv.res.status, 200, inv.data.error);
  assert.equal(inv.data.user.phone, undefined);

  const dup = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: invitee.user.id },
    jar: owner.jar
  });
  assert.equal(dup.res.status, 400);

  const pending = await req('/api/group-invites', { jar: invitee.jar });
  assert.equal(pending.data.invites.length, 1);
  assert.equal(pending.data.invites[0].group.name, 'Sunset');
  assert.equal(pending.data.invites[0].inviter.username, owner.user.username);
  assert.equal(pending.data.invites[0].inviter.accountId, owner.user.accountId);
  assert.equal(pending.data.invites[0].inviter.phone, undefined);

  const hijack = await req(`/api/group-invites/${pending.data.invites[0].id}/accept`, {
    method: 'POST',
    jar: other.jar
  });
  assert.equal(hijack.res.status, 404);

  const acc = await req(`/api/group-invites/${pending.data.invites[0].id}/accept`, {
    method: 'POST',
    jar: invitee.jar
  });
  assert.equal(acc.res.status, 200, acc.data.error);
  const joined = await req('/api/groups', { jar: invitee.jar });
  assert.ok(joined.data.groups.some((g) => g.id === gid));

  const already = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: invitee.user.id },
    jar: owner.jar
  });
  assert.equal(already.res.status, 400);

  const inv2 = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: other.user.id },
    jar: owner.jar
  });
  assert.equal(inv2.res.status, 200, inv2.data.error);
  const pending2 = await req('/api/group-invites', { jar: other.jar });
  assert.equal(pending2.data.invites.length, 1);
  const dec = await req(`/api/group-invites/${pending2.data.invites[0].id}/decline`, {
    method: 'POST',
    jar: other.jar
  });
  assert.equal(dec.res.status, 200, dec.data.error);
  const stillOut = await req('/api/groups', { jar: other.jar });
  assert.equal(stillOut.data.groups.some((g) => g.id === gid), false);
  const emptyInv = await req('/api/group-invites', { jar: other.jar });
  assert.equal(emptyInv.data.invites.length, 0);

  const inboxInvitee = await req('/api/conversations', { jar: invitee.jar });
  const gRow = inboxInvitee.data.conversations.find((c) => c.kind === 'group' && c.groupId === gid);
  assert.ok(gRow);
  assert.equal(gRow.name, 'Sunset');

  const inviteeThread = await req(`/api/groups/${gid}/messages`, { jar: invitee.jar });
  assert.equal(inviteeThread.data.window.fromJoin, true);
  assert.equal(inviteeThread.data.window.canSend, true);
  const inviteeRow = db.prepare('SELECT * FROM users WHERE id = ?').get(invitee.user.id);
  assert.equal(inviteeThread.data.window.freeMs, userFreeChatMs(inviteeRow));

  const sentG = await req(`/api/groups/${gid}/messages`, {
    method: 'POST',
    json: { body: 'hello group' },
    jar: invitee.jar
  });
  assert.equal(sentG.res.status, 200, sentG.data.error);
  const thread = await req(`/api/groups/${gid}/messages`, { jar: owner.jar });
  assert.ok(thread.data.messages.some((m) => m.body === 'hello group'));

  db.prepare('UPDATE group_members SET joined_at = ? WHERE group_id = ? AND user_id = ?').run(
    Date.now() - userFreeChatMs(inviteeRow) - 1000,
    gid,
    invitee.user.id
  );
  const expired = await req(`/api/groups/${gid}/messages`, {
    method: 'POST',
    json: { body: 'too late' },
    jar: invitee.jar
  });
  assert.equal(expired.res.status, 402);
  assert.equal(expired.data.code, 'UPGRADE');

  const stillOwner = await req(`/api/groups/${gid}/messages`, {
    method: 'POST',
    json: { body: 'owner still talking' },
    jar: owner.jar
  });
  assert.equal(stillOwner.res.status, 200, stillOwner.data.error);

  const notKick = await req(`/api/groups/${gid}/kick`, {
    method: 'POST',
    json: { userId: owner.user.id },
    jar: invitee.jar
  });
  assert.equal(notKick.res.status, 403);

  const kicked = await req(`/api/groups/${gid}/kick`, {
    method: 'POST',
    json: { userId: invitee.user.id },
    jar: owner.jar
  });
  assert.equal(kicked.res.status, 200, kicked.data.error);
  const gone = await req('/api/conversations', { jar: invitee.jar });
  assert.equal(gone.data.conversations.some((c) => c.kind === 'group' && c.groupId === gid), false);
  const deniedThread = await req(`/api/groups/${gid}/messages`, { jar: invitee.jar });
  assert.equal(deniedThread.res.status, 404);

  const inv3 = await req(`/api/groups/${gid}/invites`, {
    method: 'POST',
    json: { userId: other.user.id },
    jar: owner.jar
  });
  assert.equal(inv3.res.status, 200, inv3.data.error);
  const pending3 = await req('/api/group-invites', { jar: other.jar });
  await req(`/api/group-invites/${pending3.data.invites[0].id}/accept`, { method: 'POST', jar: other.jar });
  const inInbox = await req('/api/conversations', { jar: other.jar });
  assert.ok(inInbox.data.conversations.some((c) => c.kind === 'group' && c.groupId === gid));
  const left = await req(`/api/groups/${gid}/leave`, { method: 'POST', jar: other.jar });
  assert.equal(left.res.status, 200, left.data.error);
  const outInbox = await req('/api/conversations', { jar: other.jar });
  assert.equal(outInbox.data.conversations.some((c) => c.kind === 'group' && c.groupId === gid), false);

  const seeker = await register('gsee' + Date.now().toString().slice(-5), '565656', 'male');
  const disc = await req('/api/groups/discover', { jar: seeker.jar });
  const found = disc.data.groups.find((g) => g.id === gid);
  assert.ok(found);
  assert.equal(found.name, 'Sunset');
  assert.ok(found.logoUrl);
  assert.equal(found.joined, false);
  assert.equal(found.phone, undefined);
  const seekerMine = await req('/api/groups', { jar: seeker.jar });
  assert.equal(seekerMine.data.groups.some((g) => g.id === gid), false);
  assert.ok(disc.data.groups.length >= 1);

  const discOwner = await req('/api/groups/discover', { jar: owner.jar });
  const ownerFound = discOwner.data.groups.find((g) => g.id === gid);
  assert.ok(ownerFound);
  assert.equal(ownerFound.joined, true);
  assert.equal(ownerFound.role, 'owner');
  let seenUnjoined = false;
  for (const g of discOwner.data.groups) {
    if (!g.joined) seenUnjoined = true;
    else assert.equal(seenUnjoined, false, 'joined groups must sort first');
  }
  seenUnjoined = false;
  for (const g of disc.data.groups) {
    if (!g.joined) seenUnjoined = true;
    else assert.equal(seenUnjoined, false, 'joined groups must sort first');
  }

  const passer = await register('gpass' + Date.now().toString().slice(-5), '676767', 'female');
  const passAsk = await req(`/api/groups/${gid}/join`, { method: 'POST', jar: passer.jar });
  assert.equal(passAsk.res.status, 200, passAsk.data.error);
  const ownerForPass = await req(`/api/groups/${gid}`, { jar: owner.jar });
  const passRow = (ownerForPass.data.joinRequests || []).find((r) => r.user && r.user.id === passer.user.id);
  assert.ok(passRow);
  const passDec = await req(`/api/groups/${gid}/join-requests/${passRow.id}/decline`, {
    method: 'POST',
    jar: owner.jar
  });
  assert.equal(passDec.res.status, 200, passDec.data.error);
  const passerGroups = await req('/api/groups', { jar: passer.jar });
  assert.equal(passerGroups.data.groups.some((g) => g.id === gid), false);
  const passerInbox = await req('/api/conversations', { jar: passer.jar });
  assert.equal(passerInbox.data.conversations.some((c) => c.kind === 'group' && c.groupId === gid), false);

  const ask = await req(`/api/groups/${gid}/join`, { method: 'POST', jar: seeker.jar });
  assert.equal(ask.res.status, 200, ask.data.error);
  const dupAsk = await req(`/api/groups/${gid}/join`, { method: 'POST', jar: seeker.jar });
  assert.equal(dupAsk.res.status, 400);

  const asOwner = await req(`/api/groups/${gid}`, { jar: owner.jar });
  const reqRow = (asOwner.data.joinRequests || []).find((r) => r.user && r.user.id === seeker.user.id);
  assert.ok(reqRow);
  assert.equal(reqRow.user.phone, undefined);

  const notReview = await req(`/api/groups/${gid}/join-requests/${reqRow.id}/accept`, {
    method: 'POST',
    jar: seeker.jar
  });
  assert.equal(notReview.res.status, 403);

  const okJoin = await req(`/api/groups/${gid}/join-requests/${reqRow.id}/accept`, {
    method: 'POST',
    jar: owner.jar
  });
  assert.equal(okJoin.res.status, 200, okJoin.data.error);
  const seekerInbox = await req('/api/conversations', { jar: seeker.jar });
  assert.ok(seekerInbox.data.conversations.some((c) => c.kind === 'group' && c.groupId === gid));
  const seekerSend = await req(`/api/groups/${gid}/messages`, {
    method: 'POST',
    json: { body: 'joined by request' },
    jar: seeker.jar
  });
  assert.equal(seekerSend.res.status, 200, seekerSend.data.error);
});

test('host apply sample guide images are served from /demo', async () => {
  await started;
  for (const kind of ['apply', 'code', 'income']) {
    const res = await fetch(`${base}/demo/host-demo-${kind}.png`);
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type') || ''), /image\/png/i);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000, kind);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
  }
  const missing = await fetch(`${base}/uploads/host-demo-apply.mp4`);
  assert.equal(missing.status, 404);
});

test('female registration matches male; host apply is later from Settings', async () => {
  await started;
  const jar = cookieJar();
  const missing = new FormData();
  missing.set('username', 'noface' + Date.now().toString().slice(-5));
  missing.set('password', '121212');
  missing.set('gender', 'female');
  missing.set('birthYear', '1998');
  missing.set('phone', '091111111');
  missing.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const created = await req('/api/register', { method: 'POST', form: missing, jar });
  assert.equal(created.res.status, 200, created.data.error);
  assert.equal(created.data.user.hostStatus, 'none');
  assert.equal(created.data.user.isHost, false);
  assert.equal(created.data.user.occupation, undefined);

  const female = await register('hosty' + Date.now().toString().slice(-5), '343434', 'female');
  assert.equal(female.user.gender, 'female');
  assert.equal(female.user.isHost, false);
  assert.equal(female.user.hostStatus, 'none');
  assert.equal(female.user.occupation, undefined);
  assert.equal(female.user.nrcFrontUrl, undefined);

  const listed = await req('/api/users', { jar: female.jar });
  const peer = listed.data.users[0];
  assert.equal(peer.nrcFrontUrl, undefined);
  assert.ok(!('nrcFrontUrl' in peer) || peer.nrcFrontUrl == null);

  const male = await register('lad' + Date.now().toString().slice(-6), '565656', 'male');
  assert.equal(male.user.hostStatus, 'none');
  assert.equal(male.user.isHost, false);

  const maleApply = await req('/api/me/host-apply', {
    method: 'POST',
    form: (() => {
      const form = new FormData();
      form.set('nrcFront', new Blob([PNG], { type: 'image/png' }), 'front.png');
      form.set('nrcBack', new Blob([PNG], { type: 'image/png' }), 'back.png');
      return form;
    })(),
    jar: male.jar
  });
  assert.equal(maleApply.res.status, 400);

  await applyHost(female);
  assert.equal(female.user.hostStatus, 'pending');
  assert.equal(female.user.occupation, undefined);
  assert.equal(female.user.monthlyIncome, undefined);

  const nrcAsUser = await fetch(base + `/api/admin/accounts/${female.user.id}/nrc/front`, {
    headers: { cookie: female.jar.header() }
  });
  assert.equal(nrcAsUser.status, 401);

  const admin = cookieJar();
  await req('/api/admin/login', {
    method: 'POST',
    json: { username: 'admin', password: 'admin123' },
    jar: admin
  });
  const nrcAdmin = await fetch(base + `/api/admin/accounts/${female.user.id}/nrc/front`, {
    headers: { cookie: admin.header() }
  });
  assert.equal(nrcAdmin.status, 200);
  assert.match(String(nrcAdmin.headers.get('content-type') || ''), /image|octet|png/i);
  assert.match(String(nrcAdmin.headers.get('cache-control') || ''), /no-store/);

  const back = await fetch(base + `/api/admin/accounts/${female.user.id}/nrc/back`, {
    headers: { cookie: admin.header() }
  });
  assert.equal(back.status, 200);

  const dossier = await req(`/api/admin/dossier?q=${female.user.accountId}`, { jar: admin });
  assert.ok(dossier.data.user.nrcFrontUrl);
  assert.ok(dossier.data.user.nrcBackUrl);
  assert.equal(dossier.data.user.idDocType, 'nrc');
  assert.equal(dossier.data.user.hostStatus, 'pending');

  const noNrc = await req(`/api/admin/accounts/${male.user.id}/host-approve`, {
    method: 'POST',
    jar: admin
  });
  assert.equal(noNrc.res.status, 400);

  const approved = await req(`/api/admin/accounts/${female.user.id}/host-approve`, {
    method: 'POST',
    jar: admin
  });
  assert.equal(approved.res.status, 200, approved.data.error);
  assert.equal(approved.data.user.isHost, true);
  assert.equal(approved.data.user.hostStatus, 'approved');

  const me = await req('/api/me', { jar: female.jar });
  assert.equal(me.data.user.isHost, true);
  assert.equal(me.data.user.nrcFrontUrl, undefined);

  const asMale = await req('/api/users', { jar: male.jar });
  const host = asMale.data.users.find((u) => u.username === female.user.username);
  assert.ok(host);
  assert.equal(host.isHost, true);
  assert.equal(host.nrcFrontUrl, undefined);
  assert.equal(host.occupation, undefined);

  const hostCard = await req(`/api/users/${female.user.id}/card`, { jar: male.jar });
  assert.equal(hostCard.res.status, 200);
  assert.equal(hostCard.data.user.isHost, true);
  assert.equal(hostCard.data.user.level, female.user.level);
  assert.equal(Object.prototype.hasOwnProperty.call(hostCard.data.user, 'freeUntil'), false);

  const goneIncome = await req('/api/me/income', {
    method: 'PUT',
    json: { occupation: 'Singer', monthlyIncome: '800000', incomeSource: 'business', level: 99, isHost: true },
    jar: female.jar
  });
  assert.equal(goneIncome.res.status, 404);
});

test('host apply accepts passport front only instead of NRC pair', async () => {
  await started;
  const female = await register('passp' + Date.now().toString().slice(-5), '454545', 'female');
  const admin = await loginAdmin();

  const missingBack = new FormData();
  missingBack.set('idType', 'nrc');
  missingBack.set('nrcFront', new Blob([PNG], { type: 'image/png' }), 'front.png');
  const nrcOne = await req('/api/me/host-apply', { method: 'POST', form: missingBack, jar: female.jar });
  assert.equal(nrcOne.res.status, 400);
  assert.match(nrcOne.data.error, /NRC front and back/i);

  const missingPass = new FormData();
  missingPass.set('idType', 'passport');
  const noFront = await req('/api/me/host-apply', { method: 'POST', form: missingPass, jar: female.jar });
  assert.equal(noFront.res.status, 400);
  assert.match(noFront.data.error, /passport/i);

  const passForm = new FormData();
  passForm.set('idType', 'passport');
  passForm.set('nrcFront', new Blob([PNG], { type: 'image/png' }), 'pass.png');
  const applied = await req('/api/me/host-apply', { method: 'POST', form: passForm, jar: female.jar });
  assert.equal(applied.res.status, 200, applied.data.error);
  assert.equal(applied.data.user.hostStatus, 'pending');
  assert.equal(applied.data.user.idDocType, 'passport');
  assert.equal(applied.data.user.nrcFrontUrl, undefined);

  const dossier = await req(`/api/admin/dossier?q=${female.user.accountId}`, { jar: admin });
  assert.equal(dossier.data.user.idDocType, 'passport');
  assert.ok(dossier.data.user.nrcFrontUrl);
  assert.equal(dossier.data.user.nrcBackUrl, null);

  const approved = await req(`/api/admin/accounts/${female.user.id}/host-approve`, { method: 'POST', jar: admin });
  assert.equal(approved.res.status, 200, approved.data.error);
  assert.equal(approved.data.user.isHost, true);
  assert.equal(approved.data.user.idDocType, 'passport');
});

test('new accounts get language-keyed Saka rules; host income is female-only', async () => {
  await started;
  async function registerOnly(name, pin, gender) {
    const jar = cookieJar();
    const form = new FormData();
    form.set('username', name);
    form.set('password', pin);
    form.set('gender', gender);
    form.set('birthYear', '1998');
    form.set('phone', '091111111');
    form.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
    const { data } = await req('/api/register', { method: 'POST', form, jar });
    assert.ok(data.user, data.error);
    return { jar, user: data.user };
  }
  const male = await registerOnly('rulem' + Date.now().toString().slice(-5), '121212', 'male');
  const female = await registerOnly('rulef' + Date.now().toString().slice(-5), '212121', 'female');
  const saka = db.prepare('SELECT id FROM users WHERE is_ai = 1').get();
  assert.ok(saka && saka.id, 'Saka guide account');
  function welcomeRows(userId) {
    const lo = Math.min(userId, saka.id);
    const hi = Math.max(userId, saka.id);
    const conv = db.prepare('SELECT id FROM conversations WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
    assert.ok(conv, 'expected Saka conversation for user ' + userId);
    return db.prepare('SELECT type, body FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
  }
  const maleRows = welcomeRows(male.user.id);
  const femaleRows = welcomeRows(female.user.id);
  assert.equal(maleRows.length, 2);
  assert.equal(femaleRows.length, 3);
  assert.equal(maleRows[0].body, '__SW__:welcome');
  assert.equal(maleRows[1].body, '__SW__:rules');
  assert.equal(femaleRows[0].body, '__SW__:welcome');
  assert.equal(femaleRows[1].body, '__SW__:rules');
  assert.equal(femaleRows[2].body, '__SW__:host');
  const I18n = require('../public/js/i18n-pack.js');
  I18n.setLang('en');
  assert.match(I18n.t('sakaRules'), /7 days free/i);
  assert.match(I18n.t('sakaRules'), /50%/);
  assert.match(I18n.t('sakaHostNotice'), /optionally enter that code when upgrading/i);
  assert.match(I18n.t('sakaHostNotice'), /12 → \+6000/);
  assert.equal(/Chat time no longer pays/i.test(I18n.t('sakaHostNotice')), false);
  I18n.setLang('my');
  assert.match(I18n.t('sakaRules'), /အခမဲ့ ၇ ရက်/);
  assert.match(I18n.t('sakaHostNotice'), /ရည်ညွှန်းကုဒ် ၈ လုံး/);
  assert.match(I18n.t('sakaHostNotice'), /၁၂ လ → \+၆၀၀၀/);
  assert.equal(/စကားပြောချိန်ဖြင့် \+၅၀၀ မရတော့ပါ/.test(I18n.t('sakaHostNotice')), false);
  await req('/api/me/liveness', {
    method: 'POST',
    json: { left: true, right: true, estimatedGender: 'male' },
    jar: male.jar
  });
  await req('/api/me/liveness', {
    method: 'POST',
    json: { left: true, right: true, estimatedGender: 'female' },
    jar: female.jar
  });
  assert.equal(welcomeRows(male.user.id).length, 2);
  assert.equal(welcomeRows(female.user.id).length, 3);
});

test('hosts earn 500 per month of an approved upgrade that used their code', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('earny' + Date.now().toString().slice(-5), '777777', 'female');
  const paid = await register('payer' + Date.now().toString().slice(-5), '888888', 'male');
  const free = await register('broke' + Date.now().toString().slice(-5), '999999', 'male');
  const paid2 = await register('payer' + Date.now().toString().slice(-4), '666666', 'male');

  await applyHost(host);
  const okHost = await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  assert.equal(okHost.data.user.isHost, true);
  const code = okHost.data.user.hostCode;
  assert.match(String(code), /^\d{8}$/);
  host.user = okHost.data.user;

  const missing = new FormData();
  missing.set('targetAccountId', paid.user.accountId);
  missing.set('months', '1');
  missing.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const noCode = await req('/api/upgrade', { method: 'POST', form: missing, jar: paid.jar });
  assert.equal(noCode.res.status, 200, noCode.data.error);
  const blankQueue = await req('/api/admin/upgrades', { jar: admin });
  const blankPending = blankQueue.data.upgrades.find(
    (u) => u.status === 'pending' && u.accountId === paid.user.accountId
  );
  assert.ok(blankPending);
  assert.equal(blankPending.hostCode, null);
  const blankOk = await req(`/api/admin/upgrades/${blankPending.id}/approve`, { method: 'POST', jar: admin });
  assert.equal(blankOk.res.status, 200, blankOk.data.error);
  paid.user = blankOk.data.user;
  const none = await req('/api/me', { jar: host.jar });
  assert.equal(none.data.user.hostEarnings, 0);

  const bad = new FormData();
  bad.set('targetAccountId', paid.user.accountId);
  bad.set('months', '1');
  bad.set('hostCode', '00000000');
  bad.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const badCode = await req('/api/upgrade', { method: 'POST', form: bad, jar: paid.jar });
  assert.equal(badCode.res.status, 400);
  assert.equal(badCode.data.error, 'Enter a valid host code.');
  const stillNone = await req('/api/me', { jar: host.jar });
  assert.equal(stillNone.data.user.hostEarnings, 0);

  await giveUpgrade(admin, paid, code);
  const me = await req('/api/me', { jar: host.jar });
  assert.equal(me.data.user.hostEarnings, 500);
  assert.equal(me.data.user.hostCode, code);
  assert.equal(me.data.user.hostIncomeLedger.length, 1);
  assert.equal(me.data.user.hostIncomeLedger[0].partner.username, paid.user.username);
  assert.equal(me.data.user.hostIncomeLedger[0].amount, 500);

  await giveUpgrade(admin, paid, code);
  const again = await req('/api/me', { jar: host.jar });
  assert.equal(again.data.user.hostEarnings, 1000);
  assert.equal(again.data.user.hostIncomeLedger.length, 2);

  await giveUpgrade(admin, paid2, code);
  const me2 = await req('/api/me', { jar: host.jar });
  assert.equal(me2.data.user.hostEarnings, 1500);

  const six = new FormData();
  six.set('targetAccountId', paid2.user.accountId);
  six.set('months', '6');
  six.set('hostCode', code);
  six.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const sixSub = await req('/api/upgrade', { method: 'POST', form: six, jar: paid2.jar });
  assert.equal(sixSub.res.status, 200, sixSub.data.error);
  const sixOk = await req(`/api/admin/upgrades/${sixSub.data.id}/approve`, { method: 'POST', jar: admin });
  assert.equal(sixOk.res.status, 200, sixOk.data.error);
  const me6 = await req('/api/me', { jar: host.jar });
  assert.equal(me6.data.user.hostEarnings, 4500);
  assert.equal(me6.data.user.hostIncomeLedger[0].amount, 3000);

  const withFree = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: free.jar });
  await sitTogether(withFree.data.conversation.id, host.jar, free.jar, 120);
  const still = await req('/api/me', { jar: host.jar });
  assert.equal(still.data.user.hostEarnings, 4500);

  const people = await req('/api/users', { jar: host.jar });
  const listed = people.data.users.find((u) => u.username === host.user.username);
  assert.equal(listed, undefined);
  const other = people.data.users[0];
  assert.equal(Object.prototype.hasOwnProperty.call(other || {}, 'hostCode'), false);

  const dossier = await req(`/api/admin/dossier?q=${host.user.accountId}`, { jar: admin });
  assert.equal(dossier.data.user.hostCode, code);
  assert.equal(dossier.data.hostIncome.hostEarnings, 4500);
  assert.equal(dossier.data.hostIncome.hostIncomeLedger.length, 4);

  const notHost = await register('plain' + Date.now().toString().slice(-5), '555555', 'female');
  assert.equal(notHost.user.hostCode, undefined);
  const withPaid3 = await req(`/api/conversations/with/${notHost.user.id}`, { method: 'POST', jar: paid.jar });
  await sitTogether(withPaid3.data.conversation.id, notHost.jar, paid.jar, 120);
  const plainMe = await req('/api/me', { jar: notHost.jar });
  assert.equal(plainMe.data.user.isHost, false);
  assert.equal(plainMe.data.user.hostEarnings, 0);

  const ready = await req('/api/me', { jar: host.jar });
  assert.equal(ready.data.user.hostBalance, 4500);
  assert.equal(ready.data.user.canWithdraw, true);
  const tooSoon = await req('/api/me/withdraw', {
    method: 'POST',
    json: { method: 'kbz', name: 'May', phone: '091234567', amount: 999999 },
    jar: host.jar
  });
  assert.equal(tooSoon.res.status, 200, tooSoon.data.error);
  assert.equal(tooSoon.data.payout.amount, 4500);
  const held = await req('/api/me', { jar: host.jar });
  assert.equal(held.data.user.hostBalance, 0);
  assert.equal(held.data.user.hostEarnings, 4500);

  const sakaList = await req('/api/users', { jar: host.jar });
  const saka = sakaList.data.users.find((u) => u.isAi);
  const done = await req(`/api/admin/payouts/${tooSoon.data.payout.id}/done`, { method: 'POST', jar: admin });
  assert.equal(done.res.status, 200);
  const guide = await req(`/api/conversations/with/${saka.id}`, { method: 'POST', jar: host.jar });
  const thread = await req(`/api/conversations/${guide.data.conversation.id}`, { jar: host.jar });
  assert.ok(thread.data.messages.some((m) => m.type === 'system' && /ငွေဝင်ပါပြီ/.test(m.body || '')));
});

test('host earns 6000 for a 12-month upgrade that used their code', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('yrhst' + Date.now().toString().slice(-5), '121212', 'female');
  const payer = await register('yrpay' + Date.now().toString().slice(-5), '232323', 'male');
  await applyHost(host);
  const okHost = await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  const code = okHost.data.user.hostCode;
  const form = new FormData();
  form.set('targetAccountId', payer.user.accountId);
  form.set('months', '12');
  form.set('hostCode', code);
  form.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const submitted = await req('/api/upgrade', { method: 'POST', form, jar: payer.jar });
  assert.equal(submitted.res.status, 200, submitted.data.error);
  const approved = await req(`/api/admin/upgrades/${submitted.data.id}/approve`, { method: 'POST', jar: admin });
  assert.equal(approved.res.status, 200, approved.data.error);
  const me = await req('/api/me', { jar: host.jar });
  assert.equal(me.data.user.hostEarnings, 12 * 500);
  assert.equal(me.data.user.hostEarnings, 6000);
  assert.equal(me.data.user.hostIncomeLedger.length, 1);
  assert.equal(me.data.user.hostIncomeLedger[0].amount, 12 * 500);
  assert.equal(me.data.user.hostIncomeLedger[0].amount, 6000);
  const payerMe = await req('/api/me', { jar: payer.jar });
  assert.equal(payerMe.data.user.hostEarnings || 0, 0);
  assert.ok(payerMe.data.user.paidUntil > Date.now());
});

test('admin paints paid accounts green and badges extra upgrades', async () => {
  await started;
  const admin = await loginAdmin();
  const member = await register('green' + Date.now().toString().slice(-5), '121212', 'male');
  const list0 = await req('/api/admin/accounts', { jar: admin });
  const row0 = list0.data.accounts.find((a) => a.accountId === member.user.accountId);
  assert.equal(row0.paidActive, false);
  assert.equal(row0.extraUpgrade, false);

  await giveUpgrade(admin, member);
  const list1 = await req('/api/admin/accounts', { jar: admin });
  const row1 = list1.data.accounts.find((a) => a.accountId === member.user.accountId);
  assert.equal(row1.paidActive, true);
  assert.equal(row1.extraUpgrade, false);

  const extra = new FormData();
  extra.set('targetAccountId', member.user.accountId);
  extra.set('months', '1');
  extra.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const extraSub = await req('/api/upgrade', { method: 'POST', form: extra, jar: member.jar });
  assert.equal(extraSub.res.status, 200, extraSub.data.error);

  const list2 = await req('/api/admin/accounts', { jar: admin });
  const row2 = list2.data.accounts.find((a) => a.accountId === member.user.accountId);
  assert.equal(row2.paidActive, true);
  assert.equal(row2.extraUpgrade, true);
  assert.equal(row2.pendingUpgrades, 1);

  const queue = await req('/api/admin/upgrades', { jar: admin });
  const extraRow = queue.data.upgrades.find((u) => u.id === extraSub.data.id);
  assert.ok(extraRow);
  assert.equal(extraRow.status, 'pending');
  assert.equal(extraRow.paidActive, true);
  assert.equal(extraRow.extraUpgrade, true);
  const approvedRow = queue.data.upgrades.find(
    (u) => u.accountId === member.user.accountId && u.status === 'approved'
  );
  assert.ok(approvedRow);
  assert.equal(approvedRow.paidActive, true);
  assert.equal(approvedRow.extraUpgrade, false);

  const dossier = await req(`/api/admin/dossier?q=${member.user.accountId}`, { jar: admin });
  assert.equal(dossier.data.user.paidActive, true);
  assert.equal(dossier.data.user.extraUpgrade, true);
  const mePaid = await req('/api/me', { jar: member.jar });
  assert.ok(mePaid.data.user.paidUntil > Date.now());
  assert.ok(mePaid.data.user.paidRemainingHours > 0);
  assert.equal(mePaid.data.user.paidRemainingHours, remainingPaidHours(mePaid.data.user.paidUntil));
  db.prepare('UPDATE users SET paid_until = ? WHERE id = ?').run(Date.now() + 90 * 60 * 1000, member.user.id);
  const meHours = await req('/api/me', { jar: member.jar });
  assert.equal(meHours.data.user.paidRemainingHours, 2);
  assert.equal(meHours.data.user.paidRemainingHours, remainingPaidHours(meHours.data.user.paidUntil));

  db.prepare('UPDATE users SET paid_until = ? WHERE id = ?').run(Date.now() - 1000, member.user.id);
  const list3 = await req('/api/admin/accounts', { jar: admin });
  const row3 = list3.data.accounts.find((a) => a.accountId === member.user.accountId);
  assert.equal(row3.paidActive, false);
  assert.equal(row3.extraUpgrade, false);
  assert.equal(row3.paidRemainingHours, 0);
  const expiredQueue = await req('/api/admin/upgrades', { jar: admin });
  const extraExpired = expiredQueue.data.upgrades.find((u) => u.id === extraSub.data.id);
  assert.equal(extraExpired.paidActive, false);
  assert.equal(extraExpired.extraUpgrade, false);
});

test('upgrade can be gifted to another account by ID', async () => {
  await started;
  const admin = await loginAdmin();
  const payer = await register('gpay' + Date.now().toString().slice(-5), '121212', 'male');
  const giftTo = await register('grcv' + Date.now().toString().slice(-5), '232323', 'female');
  const ghost = await req('/api/upgrade', {
    method: 'POST',
    form: (() => {
      const f = new FormData();
      f.set('targetAccountId', 'SW00009999');
      f.set('months', '1');
      f.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
      return f;
    })(),
    jar: payer.jar
  });
  assert.equal(ghost.res.status, 400);

  const blankId = await req('/api/upgrade', {
    method: 'POST',
    form: (() => {
      const f = new FormData();
      f.set('months', '1');
      f.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
      return f;
    })(),
    jar: payer.jar
  });
  assert.equal(blankId.res.status, 400);

  const selfForm = new FormData();
  selfForm.set('targetAccountId', payer.user.accountId);
  selfForm.set('months', '1');
  selfForm.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const selfSub = await req('/api/upgrade', { method: 'POST', form: selfForm, jar: payer.jar });
  assert.equal(selfSub.res.status, 200, selfSub.data.error);
  assert.equal(selfSub.data.gift, false);
  const selfQueue = await req('/api/admin/upgrades', { jar: admin });
  const selfRow = selfQueue.data.upgrades.find((u) => u.id === selfSub.data.id);
  assert.ok(selfRow);
  assert.equal(selfRow.gift, false);
  assert.equal(selfRow.submitter.accountId, payer.user.accountId);
  assert.equal(selfRow.target.accountId, payer.user.accountId);
  const selfReject = await req(`/api/admin/upgrades/${selfSub.data.id}/reject`, { method: 'POST', jar: admin });
  assert.equal(selfReject.res.status, 200, selfReject.data.error);

  const giftForm = new FormData();
  giftForm.set('targetAccountId', giftTo.user.accountId);
  giftForm.set('months', '1');
  giftForm.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const gifted = await req('/api/upgrade', { method: 'POST', form: giftForm, jar: payer.jar });
  assert.equal(gifted.res.status, 200, gifted.data.error);
  assert.equal(gifted.data.gift, true);
  const giftQueue = await req('/api/admin/upgrades', { jar: admin });
  const giftRow = giftQueue.data.upgrades.find((u) => u.id === gifted.data.id);
  assert.ok(giftRow);
  assert.equal(giftRow.gift, true);
  assert.equal(giftRow.submitter.accountId, payer.user.accountId);
  assert.equal(giftRow.target.accountId, giftTo.user.accountId);
  assert.equal(giftRow.submitter.phone, '091111111');
  const giftOk = await req(`/api/admin/upgrades/${gifted.data.id}/approve`, { method: 'POST', jar: admin });
  assert.equal(giftOk.res.status, 200, giftOk.data.error);
  assert.equal(giftOk.data.user.accountId, giftTo.user.accountId);
  assert.ok(giftOk.data.user.level >= 1);
  const giftMe = await req('/api/me', { jar: giftTo.jar });
  assert.ok(giftMe.data.user.paidUntil > Date.now());
  assert.ok(giftMe.data.user.paidRemainingHours > 0);
  const payerMe = await req('/api/me', { jar: payer.jar });
  assert.equal(!payerMe.data.user.paidUntil || payerMe.data.user.paidUntil <= Date.now(), true);
  assert.equal(payerMe.data.user.paidRemainingHours || 0, 0);
});

test('hosts keep chatting visitors after 24h; ads, broadcast, and stale purge', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('freh' + Date.now().toString().slice(-5), '232323', 'female');
  const visitor = await register('vis' + Date.now().toString().slice(-5), '454545', 'male');
  await applyHost(host);
  await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  const opened = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: visitor.jar });
  const cid = opened.data.conversation.id;
  await req(`/api/admin/conversations/${cid}/expire-free`, { method: 'POST', jar: admin });
  const hostSend = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'still here for you' },
    jar: host.jar
  });
  assert.equal(hostSend.res.status, 200, hostSend.data.error);
  const visitorSend = await req(`/api/conversations/${cid}/messages`, {
    method: 'POST',
    json: { body: 'need to pay' },
    jar: visitor.jar
  });
  assert.equal(visitorSend.res.status, 402);

  const banner = new FormData();
  banner.set('image', new Blob([PNG], { type: 'image/png' }), 'ad.png');
  const ad = await req('/api/admin/ads', { method: 'POST', form: banner, jar: admin });
  assert.equal(ad.res.status, 200, ad.data.error);
  const ads = await req('/api/ads', { jar: host.jar });
  assert.equal(ads.data.ads.length, 1);

  const blast = await req('/api/admin/broadcast', {
    method: 'POST',
    json: { body: 'Lounge note for everyone' },
    jar: admin
  });
  assert.equal(blast.res.status, 200, blast.data.error);
  assert.ok(blast.data.sent >= 2);

  const stale = db.prepare('SELECT * FROM users WHERE id = ?').get(visitor.user.id);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now() - 40 * 24 * 60 * 60 * 1000, stale.id);
  const closed = purgeStaleAccounts(db, null);
  assert.ok(closed.some((c) => c.id === stale.id));
  const gone = db.prepare('SELECT * FROM users WHERE id = ?').get(stale.id);
  assert.equal(gone.status, 'closed');

  const escalate = await req('/api/me', { jar: host.jar });
  assert.equal(escalate.data.user.level, 0);
  const csrf = await fetch(base + '/api/me/lang', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: host.jar.header(), origin: 'https://evil.example' },
    body: JSON.stringify({ lang: 'en' })
  });
  assert.equal(csrf.status, 403);
});

test('money, levels, and roles cannot be set from the client', async () => {
  await started;
  const jar = cookieJar();
  const form = new FormData();
  form.set('username', 'hack' + Date.now().toString().slice(-6));
  form.set('password', '121212');
  form.set('gender', 'male');
  form.set('birthYear', '1998');
  form.set('phone', '091111111');
  form.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.html');
  form.set('level', '9');
  form.set('is_special', '1');
  form.set('is_host', '1');
  form.set('badge', 'VVIP');
  form.set('amount', '999999');
  const created = await req('/api/register', { method: 'POST', form, jar });
  assert.ok(created.data.user, created.data.error);
  assert.equal(created.data.user.level, 0);
  assert.equal(created.data.user.isSpecial, false);
  assert.equal(created.data.user.isHost, false);
  assert.equal(created.data.user.badge, null);

  await req('/api/me/liveness', {
    method: 'POST',
    json: { left: true, right: true, estimatedGender: 'male' },
    jar
  });
  const admin = await loginAdmin();
  const member = { jar, user: created.data.user };
  await giveUpgrade(admin, member);
  const host = await register('secH' + Date.now().toString().slice(-5), '343434', 'female');
  await applyHost(host);
  const hostOk = await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  assert.equal(hostOk.res.status, 200, hostOk.data.error);
  const opened = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar });
  await req(`/api/conversations/${opened.data.conversation.id}/presence`, {
    method: 'POST',
    json: { action: 'enter', totalMs: 9e6, streakMs: 9e6, credited: true, amount: 50000 },
    jar
  });
  const fake = await req(`/api/conversations/${opened.data.conversation.id}/presence`, {
    method: 'POST',
    json: { action: 'ping', totalMs: 9e6, streakMs: 9e6, credited: true, amount: 50000 },
    jar: host.jar
  });
  assert.equal(fake.data.hostEarnings || 0, 0);
  assert.equal(fake.data.mutual.credited, false);

  const receipt = new FormData();
  receipt.set('targetAccountId', created.data.user.accountId);
  receipt.set('months', '1');
  receipt.set('amount', '1');
  receipt.set('hostCode', hostOk.data.user.hostCode);
  receipt.set('receipt', new Blob([PNG], { type: 'image/png' }), 'pay.png');
  const submitted = await req('/api/upgrade', { method: 'POST', form: receipt, jar });
  assert.equal(submitted.res.status, 200, submitted.data.error);
  assert.ok(submitted.data.quote.amount > 1);

  const nrc = await fetch(base + `/api/admin/accounts/${host.user.id}/nrc/front`, {
    headers: { cookie: jar.header() }
  });
  assert.equal(nrc.status, 401);
  const receiptPeek = await fetch(base + '/api/media/receipt/nope.png', {
    headers: { cookie: jar.header() }
  });
  assert.equal(receiptPeek.status, 401);
});

test('usernames reject symbols; chat asks once for view language then translates', async () => {
  await started;
  const badReg = new FormData();
  badReg.set('username', 'bad_name');
  badReg.set('password', '121212');
  badReg.set('gender', 'male');
  badReg.set('birthYear', '1998');
  badReg.set('phone', '091111111');
  const regUnderscore = await req('/api/register', { method: 'POST', form: badReg, jar: cookieJar() });
  assert.equal(regUnderscore.res.status, 400);
  assert.match(regUnderscore.data.error, /letters and numbers/i);

  const longReg = new FormData();
  longReg.set('username', 'abcdefghijklm');
  longReg.set('password', '121212');
  longReg.set('gender', 'male');
  longReg.set('birthYear', '1998');
  longReg.set('phone', '091111111');
  const regLong = await req('/api/register', { method: 'POST', form: longReg, jar: cookieJar() });
  assert.equal(regLong.res.status, 400);

  const spaceReg = new FormData();
  spaceReg.set('username', 'hello world');
  spaceReg.set('password', '121212');
  spaceReg.set('gender', 'male');
  spaceReg.set('birthYear', '1998');
  spaceReg.set('phone', '091111111');
  const regSpace = await req('/api/register', { method: 'POST', form: spaceReg, jar: cookieJar() });
  assert.equal(regSpace.res.status, 400);

  const admin = await loginAdmin();
  const badAdmin = new FormData();
  badAdmin.set('username', 'vip_user');
  badAdmin.set('password', '999999');
  badAdmin.set('gender', 'male');
  badAdmin.set('birthYear', '1990');
  badAdmin.set('phone', '0988888888');
  badAdmin.set('badge', 'VVIP');
  const adminBad = await req('/api/admin/accounts', { method: 'POST', form: badAdmin, jar: admin });
  assert.equal(adminBad.res.status, 400);

  const a = await register('trena' + Date.now().toString().slice(-5), '121212', 'male');
  const b = await register('trenb' + Date.now().toString().slice(-5), '343434', 'female');
  const langA = await req('/api/me/lang', { method: 'PUT', json: { lang: 'ja' }, jar: a.jar });
  assert.equal(langA.res.status, 200, langA.data.error);
  assert.equal(langA.data.user.uiLang, 'ja');
  await req('/api/me/lang', { method: 'PUT', json: { lang: 'my' }, jar: b.jar });

  const underscore = await req('/api/me/profile', { method: 'PUT', json: { username: 'bad_name' }, jar: a.jar });
  assert.equal(underscore.res.status, 400);
  const tooLong = await req('/api/me/profile', { method: 'PUT', json: { username: 'abcdefghijklm' }, jar: a.jar });
  assert.equal(tooLong.res.status, 400);

  const opened = await req(`/api/conversations/with/${b.user.id}`, { method: 'POST', jar: a.jar });
  const convId = opened.data.conversation.id;
  const prev = process.env.TRANSLATE_API_KEY;
  process.env.TRANSLATE_API_KEY = 'test';
  try {
    const sent = await req(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      json: { type: 'text', body: 'Hello from Japan' },
      jar: a.jar
    });
    assert.equal(sent.res.status, 200, sent.data.error);
    assert.equal(sent.data.message.sourceLang, 'ja');
    assert.equal(sent.data.message.body, 'Hello from Japan');
    assert.equal(sent.data.message.originalBody, 'Hello from Japan');

    const forB = await req(`/api/conversations/${convId}`, { jar: b.jar });
    assert.equal(forB.res.status, 200, forB.data.error);
    assert.equal(forB.data.conversation.askViewLang, true);
    assert.equal(forB.data.conversation.viewLang, null);
    assert.equal(forB.data.messages[0].body, 'Hello from Japan');
    assert.equal(Boolean(forB.data.messages[0].translated), false);
    assert.equal(forB.data.messages[0].originalBody, 'Hello from Japan');

    const picked = await req(`/api/conversations/${convId}/view-lang`, {
      method: 'PUT',
      json: { lang: 'my' },
      jar: b.jar
    });
    assert.equal(picked.res.status, 200, picked.data.error);
    assert.equal(picked.data.askViewLang, false);
    assert.equal(picked.data.viewLang, 'my');
    assert.equal(picked.data.messages[0].translated, true);
    assert.equal(picked.data.messages[0].originalBody, 'Hello from Japan');
    assert.equal(picked.data.messages[0].body, '[my] Hello from Japan');

    const forB2 = await req(`/api/conversations/${convId}`, { jar: b.jar });
    assert.equal(forB2.data.conversation.askViewLang, false);
    assert.equal(forB2.data.conversation.viewLang, 'my');
    assert.equal(forB2.data.messages[0].body, '[my] Hello from Japan');

    const more = await req(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      json: { type: 'text', body: 'Second from Japan' },
      jar: a.jar
    });
    assert.equal(more.res.status, 200, more.data.error);
    assert.equal(more.data.message.body, 'Second from Japan');

    const forB3 = await req(`/api/conversations/${convId}`, { jar: b.jar });
    const last = forB3.data.messages[forB3.data.messages.length - 1];
    assert.equal(last.body, '[my] Second from Japan');
    assert.equal(last.originalBody, 'Second from Japan');

    const forA = await req(`/api/conversations/${convId}`, { jar: a.jar });
    assert.equal(forA.data.conversation.askViewLang, true);
    assert.equal(forA.data.messages[0].body, 'Hello from Japan');
    assert.equal(Boolean(forA.data.messages[0].translated), false);
  } finally {
    process.env.TRANSLATE_API_KEY = prev;
  }

  const sameA = await register('trenc' + Date.now().toString().slice(-5), '121212', 'male');
  const sameB = await register('trend' + Date.now().toString().slice(-5), '343434', 'female');
  await req('/api/me/lang', { method: 'PUT', json: { lang: 'my' }, jar: sameA.jar });
  await req('/api/me/lang', { method: 'PUT', json: { lang: 'my' }, jar: sameB.jar });
  const sameOpened = await req(`/api/conversations/with/${sameB.user.id}`, { method: 'POST', jar: sameA.jar });
  const sameId = sameOpened.data.conversation.id;
  await req(`/api/conversations/${sameId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'Same language hello' },
    jar: sameA.jar
  });
  const sameView = await req(`/api/conversations/${sameId}`, { jar: sameB.jar });
  assert.equal(sameView.data.conversation.askViewLang, false);
  assert.equal(sameView.data.conversation.viewLang, 'my');
  assert.equal(sameView.data.messages[0].body, 'Same language hello');
  assert.equal(Boolean(sameView.data.messages[0].translated), false);

  const globA = await register('trene' + Date.now().toString().slice(-5), '121212', 'male');
  const globB = await register('trenf' + Date.now().toString().slice(-5), '343434', 'female');
  await req('/api/me/lang', { method: 'PUT', json: { lang: 'ja' }, jar: globA.jar });
  const globPref = await req('/api/me/lang', {
    method: 'PUT',
    json: { lang: 'my', chatViewLang: 'en' },
    jar: globB.jar
  });
  assert.equal(globPref.res.status, 200, globPref.data.error);
  assert.equal(globPref.data.user.chatViewLang, 'en');
  const globOpened = await req(`/api/conversations/with/${globB.user.id}`, { method: 'POST', jar: globA.jar });
  const globId = globOpened.data.conversation.id;
  process.env.TRANSLATE_API_KEY = 'test';
  try {
    await req(`/api/conversations/${globId}/messages`, {
      method: 'POST',
      json: { type: 'text', body: 'Hello from Japan' },
      jar: globA.jar
    });
    const globView = await req(`/api/conversations/${globId}`, { jar: globB.jar });
    assert.equal(globView.data.conversation.askViewLang, false);
    assert.equal(globView.data.conversation.viewLang, 'en');
    assert.equal(globView.data.messages[0].body, '[en] Hello from Japan');
    assert.equal(globView.data.messages[0].originalBody, 'Hello from Japan');
  } finally {
    process.env.TRANSLATE_API_KEY = prev;
  }

  const cleared = await req('/api/me/lang', { method: 'PUT', json: { chatViewLang: 'ask' }, jar: globB.jar });
  assert.equal(cleared.res.status, 200, cleared.data.error);
  assert.equal(cleared.data.user.chatViewLang, null);
});

test('PIN recovery Help form queues an admin request without resetting the PIN', async () => {
  await started;
  const member = await register('pinrec' + Date.now().toString().slice(-5), '135791', 'male');
  const before = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(member.user.id).password_hash;

  const empty = await req('/api/pin-recovery', { method: 'POST', json: { accountId: '  ', phone: '091111111' } });
  assert.equal(empty.res.status, 400);
  assert.match(empty.data.error, /account ID/i);

  const badPhone = await req('/api/pin-recovery', {
    method: 'POST',
    json: { accountId: member.user.accountId, phone: 'abc' }
  });
  assert.equal(badPhone.res.status, 400);
  assert.match(badPhone.data.error, /phone/i);

  const sent = await req('/api/pin-recovery', {
    method: 'POST',
    json: { accountId: member.user.accountId, phone: '091111111' }
  });
  assert.equal(sent.res.status, 200, sent.data.error);
  assert.equal(sent.data.ok, true);

  const again = await req('/api/pin-recovery', {
    method: 'POST',
    json: { accountId: member.user.accountId, phone: '091111111' }
  });
  assert.equal(again.res.status, 200, again.data.error);

  const after = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(member.user.id).password_hash;
  assert.equal(after, before);

  const denied = await req('/api/admin/pin-recovery');
  assert.equal(denied.res.status, 401);

  const admin = await loginAdmin();
  const stats = await req('/api/admin/stats', { jar: admin });
  assert.ok(stats.data.pendingPinRecovery >= 1);

  const queue = await req('/api/admin/pin-recovery', { jar: admin });
  const pending = queue.data.requests.filter(
    (r) => r.status === 'pending' && r.accountId === member.user.accountId
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].phone, '091111111');
  assert.equal(pending[0].matched, true);
  assert.equal(pending[0].userId, member.user.id);

  const unmatched = await req('/api/pin-recovery', {
    method: 'POST',
    json: { accountId: 'SW00009999', phone: '099888777' }
  });
  assert.equal(unmatched.res.status, 200, unmatched.data.error);
  const afterUnmatched = await req('/api/admin/pin-recovery', { jar: admin });
  const ghost = afterUnmatched.data.requests.find(
    (r) => r.accountId === 'SW00009999' && r.status === 'pending'
  );
  assert.ok(ghost);
  assert.equal(ghost.matched, false);
  assert.equal(ghost.accountFound, false);

  const mismatch = await req('/api/pin-recovery', {
    method: 'POST',
    json: { accountId: member.user.accountId, phone: '099000111' }
  });
  assert.equal(mismatch.res.status, 200, mismatch.data.error);
  const afterMismatch = await req('/api/admin/pin-recovery', { jar: admin });
  const wrongPhone = afterMismatch.data.requests.find(
    (r) => r.accountId === member.user.accountId && r.phone === '099000111' && r.status === 'pending'
  );
  assert.ok(wrongPhone);
  assert.equal(wrongPhone.matched, false);
  assert.equal(wrongPhone.accountFound, true);
  assert.equal(wrongPhone.username, member.user.username);

  const done = await req(`/api/admin/pin-recovery/${pending[0].id}/done`, { method: 'POST', jar: admin });
  assert.equal(done.res.status, 200, done.data.error);
  const still = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(member.user.id).password_hash;
  assert.equal(still, before);
});

test('admin can freeze members with maintenance mode; health and admin stay up', async () => {
  await started;
  const member = await register('mnt' + Date.now().toString().slice(-6), '121212', 'male');
  const pub0 = await req('/api/public-settings');
  assert.equal(pub0.data.maintenance, false);
  const me0 = await req('/api/me', { jar: member.jar });
  assert.equal(me0.res.status, 200);

  const admin = await loginAdmin();
  const on = await req('/api/admin/settings', { method: 'PUT', json: { maintenance: true }, jar: admin });
  assert.equal(on.res.status, 200, on.data.error);
  assert.equal(on.data.maintenance, true);
  const pub1 = await req('/api/public-settings');
  assert.equal(pub1.data.maintenance, true);
  const health = await req('/health');
  assert.equal(health.data.ok, true);
  const me1 = await req('/api/me', { jar: member.jar });
  assert.equal(me1.res.status, 503);
  assert.equal(me1.data.code, 'MAINTENANCE');
  const users = await req('/api/users', { jar: member.jar });
  assert.equal(users.res.status, 503);
  const accounts = await req('/api/admin/accounts', { jar: admin });
  assert.equal(accounts.res.status, 200);

  const off = await req('/api/admin/settings', { method: 'PUT', json: { maintenance: false }, jar: admin });
  assert.equal(off.data.maintenance, false);
  const me2 = await req('/api/me', { jar: member.jar });
  assert.equal(me2.res.status, 200);
  assert.ok(me2.data.user);

  const on2 = await req('/api/admin/settings', { method: 'PUT', json: { maintenance: true }, jar: admin });
  assert.equal(on2.data.maintenance, true);
  const login = await req('/api/login', {
    method: 'POST',
    json: { username: member.user.username, password: '121212' }
  });
  assert.equal(login.res.status, 503);
  assert.equal(login.data.code, 'MAINTENANCE');
  const form = new FormData();
  form.set('username', 'mntx' + Date.now().toString().slice(-5));
  form.set('password', '343434');
  form.set('gender', 'male');
  form.set('birthYear', '1998');
  form.set('phone', '091111111');
  form.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const reg = await req('/api/register', { method: 'POST', form });
  assert.equal(reg.res.status, 503);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="maintenance-screen"/);
  assert.match(html, /alt="SAKARWINE"/);
  const adminPage = await fetch(base + '/admin');
  assert.equal(adminPage.status, 200);
  await req('/api/admin/settings', { method: 'PUT', json: { maintenance: false }, jar: admin });
});

test('new accounts get 7-day free trial; admin days apply only to later signups', async () => {
  await started;
  const admin = await loginAdmin();
  const pub0 = await req('/api/public-settings');
  assert.equal(pub0.data.freeTrialDays, DEFAULT_FREE_TRIAL_DAYS);

  const first = await register('ft7' + Date.now().toString().slice(-5), '121212', 'male');
  const firstMe = await req('/api/me', { jar: first.jar });
  const firstMs = DEFAULT_FREE_TRIAL_DAYS * DAY_MS;
  assert.equal(firstMe.data.user.freeUntil, Number(firstMe.data.user.createdAt) + firstMs);
  const firstRow = db.prepare('SELECT free_chat_ms FROM users WHERE id = ?').get(first.user.id);
  assert.equal(firstRow.free_chat_ms, firstMs);

  const peer = await register('ft7p' + Date.now().toString().slice(-5), '232323', 'female');
  const opened = await req(`/api/conversations/with/${peer.user.id}`, { method: 'POST', jar: first.jar });
  assert.equal(opened.data.conversation.window.freeMs, firstMs);
  assert.equal(opened.data.conversation.window.canSend, true);
  assert.equal(opened.data.conversation.window.expired, false);

  const saved = await req('/api/admin/settings', { method: 'PUT', json: { freeTrialDays: 3 }, jar: admin });
  assert.equal(saved.res.status, 200, saved.data.error);
  assert.equal(saved.data.freeTrialDays, 3);
  const pub1 = await req('/api/public-settings');
  assert.equal(pub1.data.freeTrialDays, 3);

  const later = await register('ft3' + Date.now().toString().slice(-5), '343434', 'female');
  const laterMe = await req('/api/me', { jar: later.jar });
  assert.equal(laterMe.data.user.freeUntil, Number(laterMe.data.user.createdAt) + 3 * DAY_MS);
  const laterRow = db.prepare('SELECT free_chat_ms FROM users WHERE id = ?').get(later.user.id);
  assert.equal(laterRow.free_chat_ms, 3 * DAY_MS);

  const firstAgain = await req('/api/me', { jar: first.jar });
  assert.equal(firstAgain.data.user.freeUntil, Number(firstAgain.data.user.createdAt) + firstMs);
  const firstChat = await req(`/api/conversations/${opened.data.conversation.id}`, { jar: first.jar });
  assert.equal(firstChat.data.conversation.window.freeMs, firstMs);

  const bad = await req('/api/admin/settings', { method: 'PUT', json: { freeTrialDays: 0 }, jar: admin });
  assert.equal(bad.res.status, 400);

  const legacyName = 'leg' + Date.now().toString().slice(-6);
  db.prepare(
    `INSERT INTO users (
      account_id, username, password_hash, gender, birth_year, phone,
      photo_path, level, status, host_status, ui_lang, created_at, free_chat_ms
    ) VALUES (?, ?, ?, 'male', 1990, '0900000000', null, 0, 'active', 'none', 'en', ?, ?)`
  ).run('SWLG' + String(Date.now()).slice(-8), legacyName, 'x', Date.now(), LEGACY_FREE_CHAT_MS);
  const legacy = db.prepare('SELECT * FROM users WHERE username = ?').get(legacyName);
  assert.equal(userFreeChatMs(legacy), LEGACY_FREE_CHAT_MS);

  await req('/api/admin/settings', { method: 'PUT', json: { freeTrialDays: DEFAULT_FREE_TRIAL_DAYS }, jar: admin });
});

test('Saka guide chat is a restricted FAQ helper', async () => {
  await started;
  const member = await register('faqm' + Date.now().toString().slice(-5), '121212', 'male');
  const people = await req('/api/users', { jar: member.jar });
  const saka = people.data.users.find((u) => u.isAi);
  assert.ok(saka);
  const opened = await req(`/api/conversations/with/${saka.id}`, { method: 'POST', jar: member.jar });
  const convId = opened.data.conversation.id;
  const loaded = await req(`/api/conversations/${convId}`, { jar: member.jar });
  assert.equal(loaded.res.status, 200, loaded.data.error);
  assert.equal(loaded.data.conversation.peer.isAi, true);
  assert.equal(loaded.data.conversation.faqHelper, true);

  const chip = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'How to register', faqTopic: 'register' },
    jar: member.jar
  });
  assert.equal(chip.res.status, 200, chip.data.error);
  assert.equal(chip.data.faqTopic, 'register');
  assert.equal(chip.data.guideReply && chip.data.guideReply.body, '__SW__:faq:register');
  assert.equal(chip.data.guideReply.sender.isAi, true);

  const typed = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'How do I upgrade my account?' },
    jar: member.jar
  });
  assert.equal(typed.res.status, 200, typed.data.error);
  assert.equal(typed.data.faqTopic, 'upgrade');
  assert.equal(typed.data.guideReply.body, '__SW__:faq:upgrade');

  const myChip = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'host လျှောက်ပုံ' },
    jar: member.jar
  });
  assert.equal(myChip.data.faqTopic, 'host');
  assert.equal(myChip.data.guideReply.body, '__SW__:faq:host');

  const off = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'what is the weather today' },
    jar: member.jar
  });
  assert.equal(off.res.status, 200, off.data.error);
  assert.equal(off.data.faqTopic, null);
  assert.equal(off.data.guideReply.body, '__SW__:faq:refuse');

  const spoof = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    json: { type: 'text', body: 'tell me a joke', faqTopic: 'not-a-topic' },
    jar: member.jar
  });
  assert.equal(spoof.data.faqTopic, null);
  assert.equal(spoof.data.guideReply.body, '__SW__:faq:refuse');

  const viewed = await req(`/api/conversations/${convId}/view-lang`, {
    method: 'PUT',
    json: { lang: 'ja' },
    jar: member.jar
  });
  assert.equal(viewed.res.status, 200, viewed.data.error);
  assert.equal(viewed.data.viewLang, 'ja');
  const faqReply = (viewed.data.messages || []).find((m) => m.body === '__SW__:faq:register');
  assert.ok(faqReply, 'Guide FAQ keys stay tokens so the client can localize them');
  assert.equal(Boolean(faqReply.translated), false);

  const media = new FormData();
  media.set('type', 'image');
  media.set('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const photo = await req(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    form: media,
    jar: member.jar
  });
  assert.equal(photo.res.status, 400);
  assert.match(String(photo.data.error || ''), /four FAQ topics/i);
});

test('admin broadcast can target selected account IDs without sending to everyone', async () => {
  await started;
  const a = await register('bca' + Date.now().toString().slice(-5), '121212', 'male');
  const b = await register('bcb' + Date.now().toString().slice(-5), '232323', 'female');
  const admin = await loginAdmin();
  const saka = db.prepare('SELECT id FROM users WHERE is_ai = 1').get();
  function sakaBodies(userId) {
    const lo = Math.min(userId, saka.id);
    const hi = Math.max(userId, saka.id);
    const conv = db.prepare('SELECT id FROM conversations WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
    if (!conv) return [];
    return db.prepare('SELECT body FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id).map((m) => m.body);
  }

  const note = 'secret-only-a-' + Date.now();
  const targeted = await req('/api/admin/broadcast', {
    method: 'POST',
    json: { body: note, mode: 'ids', accountIds: [a.user.accountId] },
    jar: admin
  });
  assert.equal(targeted.res.status, 200, targeted.data.error);
  assert.equal(targeted.data.sent, 1);
  assert.equal(targeted.data.mode, 'ids');
  assert.deepEqual(targeted.data.accountIds, [a.user.accountId]);
  assert.equal(sakaBodies(a.user.id).includes(note), true);
  assert.equal(sakaBodies(b.user.id).includes(note), false);

  const empty = await req('/api/admin/broadcast', {
    method: 'POST',
    json: { body: 'no one', mode: 'ids', accountIds: [] },
    jar: admin
  });
  assert.equal(empty.res.status, 400);
  assert.equal(empty.data.error, 'Choose at least one account ID.');

  const unknown = await req('/api/admin/broadcast', {
    method: 'POST',
    json: { body: 'ghost', mode: 'ids', accountIds: ['SWNOPE000'] },
    jar: admin
  });
  assert.equal(unknown.res.status, 400);
  assert.equal(unknown.data.error, 'No active account found for that ID.');

  const formNote = 'form-only-b-' + Date.now();
  const fd = new FormData();
  fd.set('body', formNote);
  fd.set('mode', 'ids');
  fd.set('accountIds', JSON.stringify([b.user.accountId]));
  const formHit = await req('/api/admin/broadcast', { method: 'POST', form: fd, jar: admin });
  assert.equal(formHit.res.status, 200, formHit.data.error);
  assert.equal(formHit.data.sent, 1);
  assert.equal(sakaBodies(b.user.id).includes(formNote), true);
  assert.equal(sakaBodies(a.user.id).includes(formNote), false);

  const allNote = 'for-everyone-' + Date.now();
  const all = await req('/api/admin/broadcast', {
    method: 'POST',
    json: { body: allNote },
    jar: admin
  });
  assert.equal(all.res.status, 200, all.data.error);
  assert.equal(all.data.mode, 'all');
  assert.ok(all.data.sent >= 2);
  assert.equal(sakaBodies(a.user.id).includes(allNote), true);
  assert.equal(sakaBodies(b.user.id).includes(allNote), true);
});

after(() => new Promise((resolve) => server.close(resolve)));
