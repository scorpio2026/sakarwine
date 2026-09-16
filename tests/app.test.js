'use strict';

process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'sakarwine-'));
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.FREE_CHAT_MS = '80';
process.env.SESSION_SECRET = 'test-secret';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../src/server');

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

  await new Promise((r) => setTimeout(r, 120));
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

  const listed = await req('/api/users', { jar: member.jar });
  const vvip = listed.data.users.find((u) => u.username === created.data.user.username);
  assert.ok(vvip);
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
  assert.equal(dossier.data.user.phone, member.user.phone);
  assert.ok(dossier.data.conversations.length >= 1);
  assert.ok(['active', 'pending_liveness'].includes(dossier.data.user.status));
  const hide = await req(`/api/admin/accounts/${member.user.id}/hide-id`, { method: 'POST', jar: admin });
  assert.equal(hide.data.hideAccountId, true);
  const again = await req(`/api/admin/dossier?q=${member.user.accountId}`, { jar: admin });
  assert.equal(again.data.user.accountIdHidden, true);
});

after(() => new Promise((resolve) => server.close(resolve)));
