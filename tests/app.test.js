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
const { server, db } = require('../src/server');
const { purgeStaleAccounts } = require('../src/platform');

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
  if (gender === 'female') {
    form.set('occupation', 'Lounge host');
    form.set('monthlyIncome', '450000');
    form.set('incomeSource', 'salary');
    form.set('nrcFront', new Blob([PNG], { type: 'image/png' }), 'front.png');
    form.set('nrcBack', new Blob([PNG], { type: 'image/png' }), 'back.png');
  }
  const { data } = await req('/api/register', { method: 'POST', form, jar });
  assert.ok(data.user, data.error);
  await req('/api/me/liveness', {
    method: 'POST',
    json: { left: true, right: true, estimatedGender: gender },
    jar
  });
  return { jar, user: data.user };
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

async function giveUpgrade(admin, member) {
  const receipt = new FormData();
  receipt.set('accountId', member.user.accountId);
  receipt.set('months', '1');
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
  receipt.set('accountId', a.user.accountId);
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

test('female accounts need NRC, admin-only ID photos, and host badge after approval', async () => {
  await started;
  const jar = cookieJar();
  const missing = new FormData();
  missing.set('username', 'noface' + Date.now().toString().slice(-5));
  missing.set('password', '121212');
  missing.set('gender', 'female');
  missing.set('birthYear', '1998');
  missing.set('phone', '091111111');
  missing.set('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  missing.set('occupation', 'Host');
  missing.set('monthlyIncome', '200000');
  missing.set('incomeSource', 'salary');
  const denied = await req('/api/register', { method: 'POST', form: missing, jar });
  assert.equal(denied.res.status, 400);
  assert.match(denied.data.error, /NRC/i);

  const female = await register('hosty' + Date.now().toString().slice(-5), '343434', 'female');
  assert.equal(female.user.gender, 'female');
  assert.equal(female.user.isHost, false);
  assert.equal(female.user.hostStatus, 'pending');
  assert.equal(female.user.occupation, 'Lounge host');
  assert.equal(female.user.monthlyIncome, 450000);
  assert.equal(female.user.nrcFrontUrl, undefined);

  const listed = await req('/api/users', { jar: female.jar });
  const peer = listed.data.users[0];
  assert.equal(peer.nrcFrontUrl, undefined);
  assert.ok(!('nrcFrontUrl' in peer) || peer.nrcFrontUrl == null);

  const male = await register('lad' + Date.now().toString().slice(-6), '565656', 'male');
  assert.equal(male.user.hostStatus, 'none');
  assert.equal(male.user.isHost, false);

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
  assert.equal(dossier.data.user.hostStatus, 'pending');

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

  const locked = await req('/api/me/income', {
    method: 'PUT',
    json: { occupation: 'Singer', monthlyIncome: '800000', incomeSource: 'business', level: 99, isHost: true },
    jar: female.jar
  });
  assert.equal(locked.res.status, 403);
  assert.match(locked.data.error, /Lv 1/i);
  const stillLv = await req('/api/me', { jar: female.jar });
  assert.equal(stillLv.data.user.level, 0);
  assert.equal(stillLv.data.user.canEditIncome, false);

  await giveUpgrade(admin, female);
  const income = await req('/api/me/income', {
    method: 'PUT',
    json: { occupation: 'Singer', monthlyIncome: '800000', incomeSource: 'business' },
    jar: female.jar
  });
  assert.equal(income.res.status, 200);
  assert.equal(income.data.user.occupation, 'Singer');
  assert.equal(income.data.user.canEditIncome, true);
});

test('hosts earn 500 per qualifying Lv1+ partner after 10 minutes of mutual chat', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('earny' + Date.now().toString().slice(-5), '777777', 'female');
  const paid = await register('payer' + Date.now().toString().slice(-5), '888888', 'male');
  const free = await register('broke' + Date.now().toString().slice(-5), '999999', 'male');
  const paid2 = await register('payer' + Date.now().toString().slice(-4), '666666', 'male');
  const invited = await register('inv' + Date.now().toString().slice(-5), '232323', 'male');

  const okHost = await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  assert.equal(okHost.data.user.isHost, true);
  await giveUpgrade(admin, paid);
  await giveUpgrade(admin, paid2);
  await giveUpgrade(admin, invited);

  const hostStarted = await req(`/api/conversations/with/${invited.user.id}`, { method: 'POST', jar: host.jar });
  const hostTick = await sitTogether(hostStarted.data.conversation.id, host.jar, invited.jar, 120);
  assert.equal(hostTick.data.mutual.hostOpened, true);
  assert.equal(hostTick.data.hostEarnings, 0);

  const withPaid = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: paid.jar });
  const cid1 = withPaid.data.conversation.id;
  const tick = await sitTogether(cid1, host.jar, paid.jar, 120);
  assert.ok((tick.data.mutual.streakMs || tick.data.mutual.totalMs) >= 80, JSON.stringify(tick.data.mutual));
  assert.equal(tick.data.hostEarnings, 500);
  assert.equal(tick.data.mutual.credited, true);

  const me = await req('/api/me', { jar: host.jar });
  assert.equal(me.data.user.isHost, true);
  assert.equal(me.data.user.hostEarnings, 500);
  assert.equal(me.data.user.hostIncomeLedger.length, 1);
  assert.equal(me.data.user.hostIncomeLedger[0].partner.username, paid.user.username);
  assert.equal(me.data.user.hostIncomeLedger[0].amount, 500);

  const again = await sitTogether(cid1, host.jar, paid.jar, 120);
  assert.equal(again.data.hostEarnings, 500);

  const withFree = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: free.jar });
  const freeTick = await sitTogether(withFree.data.conversation.id, host.jar, free.jar, 120);
  assert.equal(freeTick.data.mutual.partnerQualifies, false);
  const still = await req('/api/me', { jar: host.jar });
  assert.equal(still.data.user.hostEarnings, 500);

  const withPaid2 = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: paid2.jar });
  const tick2 = await sitTogether(withPaid2.data.conversation.id, host.jar, paid2.jar, 120);
  assert.equal(tick2.data.hostEarnings, 1000);
  const me2 = await req('/api/me', { jar: host.jar });
  assert.equal(me2.data.user.hostEarnings, 1000);
  assert.equal(me2.data.user.hostIncomeLedger.length, 2);

  const people = await req('/api/users', { jar: host.jar });
  const saka = people.data.users.find((u) => u.isAi);
  const withSaka = await req(`/api/conversations/with/${saka.id}`, { method: 'POST', jar: host.jar });
  await req(`/api/conversations/${withSaka.data.conversation.id}/presence`, {
    method: 'POST',
    json: { action: 'enter' },
    jar: host.jar
  });
  await new Promise((r) => setTimeout(r, 120));
  await req(`/api/conversations/${withSaka.data.conversation.id}/presence`, {
    method: 'POST',
    json: { action: 'ping' },
    jar: host.jar
  });
  const afterSaka = await req('/api/me', { jar: host.jar });
  assert.equal(afterSaka.data.user.hostEarnings, 1000);

  const dossier = await req(`/api/admin/dossier?q=${host.user.accountId}`, { jar: admin });
  assert.equal(dossier.data.hostIncome.hostEarnings, 1000);
  assert.equal(dossier.data.hostIncome.hostIncomeLedger.length, 2);

  const notHost = await register('plain' + Date.now().toString().slice(-5), '555555', 'female');
  const withPaid3 = await req(`/api/conversations/with/${notHost.user.id}`, { method: 'POST', jar: paid.jar });
  await sitTogether(withPaid3.data.conversation.id, notHost.jar, paid.jar, 120);
  const plainMe = await req('/api/me', { jar: notHost.jar });
  assert.equal(plainMe.data.user.isHost, false);
  assert.equal(plainMe.data.user.hostEarnings, 0);

  const ready = await req('/api/me', { jar: host.jar });
  assert.equal(ready.data.user.hostBalance, 1000);
  assert.equal(ready.data.user.canWithdraw, true);
  const tooSoon = await req('/api/me/withdraw', {
    method: 'POST',
    json: { method: 'kbz', name: 'May', phone: '091234567', amount: 999999 },
    jar: host.jar
  });
  assert.equal(tooSoon.res.status, 200, tooSoon.data.error);
  assert.equal(tooSoon.data.payout.amount, 1000);
  const held = await req('/api/me', { jar: host.jar });
  assert.equal(held.data.user.hostBalance, 0);
  assert.equal(held.data.user.hostEarnings, 1000);

  const done = await req(`/api/admin/payouts/${tooSoon.data.payout.id}/done`, { method: 'POST', jar: admin });
  assert.equal(done.res.status, 200);
  const guide = await req(`/api/conversations/with/${saka.id}`, { method: 'POST', jar: host.jar });
  const thread = await req(`/api/conversations/${guide.data.conversation.id}`, { jar: host.jar });
  assert.ok(thread.data.messages.some((m) => m.type === 'system' && /ငွေဝင်ပါပြီ/.test(m.body || '')));
});

test('offline or block before 10 minutes voids host credit', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('voidh' + Date.now().toString().slice(-5), '777777', 'female');
  const paid = await register('voidp' + Date.now().toString().slice(-5), '888888', 'male');
  await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
  await giveUpgrade(admin, paid);
  const opened = await req(`/api/conversations/with/${host.user.id}`, { method: 'POST', jar: paid.jar });
  const cid = opened.data.conversation.id;
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'enter' }, jar: host.jar });
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'enter' }, jar: paid.jar });
  await new Promise((r) => setTimeout(r, 40));
  await req(`/api/conversations/${cid}/presence`, { method: 'POST', json: { action: 'leave' }, jar: paid.jar });
  await new Promise((r) => setTimeout(r, 80));
  const afterLeave = await sitTogether(cid, host.jar, paid.jar, 40);
  assert.ok((afterLeave.data.mutual.streakMs || 0) < 80);
  const me = await req('/api/me', { jar: host.jar });
  assert.equal(me.data.user.hostEarnings, 0);

  const host2 = await register('voidb' + Date.now().toString().slice(-5), '121212', 'female');
  await req(`/api/admin/accounts/${host2.user.id}/host-approve`, { method: 'POST', jar: admin });
  const opened2 = await req(`/api/conversations/with/${host2.user.id}`, { method: 'POST', jar: paid.jar });
  const cid2 = opened2.data.conversation.id;
  await req(`/api/conversations/${cid2}/presence`, { method: 'POST', json: { action: 'enter' }, jar: host2.jar });
  await req(`/api/conversations/${cid2}/presence`, { method: 'POST', json: { action: 'enter' }, jar: paid.jar });
  await req(`/api/users/${host2.user.id}/block`, { method: 'POST', jar: paid.jar });
  await new Promise((r) => setTimeout(r, 100));
  const blockedTick = await req(`/api/conversations/${cid2}/presence`, {
    method: 'POST',
    json: { action: 'ping' },
    jar: host2.jar
  });
  assert.equal(blockedTick.data.hostEarnings, 0);
});

test('hosts keep chatting visitors after 24h; ads, broadcast, and stale purge', async () => {
  await started;
  const admin = await loginAdmin();
  const host = await register('freh' + Date.now().toString().slice(-5), '232323', 'female');
  const visitor = await register('vis' + Date.now().toString().slice(-5), '454545', 'male');
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
  const csrf = await fetch(base + '/api/me/income', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: host.jar.header(), origin: 'https://evil.example' },
    body: JSON.stringify({ occupation: 'Nope', monthlyIncome: 1, incomeSource: 'salary' })
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
  await req(`/api/admin/accounts/${host.user.id}/host-approve`, { method: 'POST', jar: admin });
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
  receipt.set('accountId', created.data.user.accountId);
  receipt.set('months', '1');
  receipt.set('amount', '1');
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

after(() => new Promise((resolve) => server.close(resolve)));
