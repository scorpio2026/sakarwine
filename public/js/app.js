'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const toastEl = $('#toast');
const modalEl = $('#modal');

const state = {
  user: null,
  settings: null,
  users: [],
  peopleGender: 'all',
  socket: null,
  view: 'welcome',
  chat: null,
  chatFrom: 'home',
  typing: false
};

const ICONS = {
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  wine: `<svg viewBox="0 0 48 48" fill="none"><path d="M16 8h16l-2 16a8 8 0 1 1-12 0L16 8z" fill="#f3d0c4" opacity=".95"/><path d="M22 32v8h-4v2h12v-2h-4v-8" stroke="#f7e7d2" stroke-width="2"/><path d="M18 14h12" stroke="#8b2252" stroke-width="2" opacity=".5"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 19c1-3 3.5-5 6-5s5 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 19c.4-1.6 1.6-3 3.4-3.6"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6h14v9H8l-3 3V6z"/></svg>`,
  bubble: `<svg viewBox="0 0 48 48" fill="none"><rect x="8" y="10" width="32" height="22" rx="8" fill="#fff"/><path d="M18 32l-6 8 2-8h4z" fill="#fff"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l16-8-6 16-2-6-8-2z"/></svg>`,
  gem: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l8-6 8 6-8 10L4 10z"/><path d="M4 10h16M12 4v16"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3.2 3.8-5 7-5s5.6 1.8 7 5"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M9.6 9.2a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.4 1.1-1.4 2"/><circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none"/></svg>`,
  group: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3.6 18c.7-2.6 2.6-4 4.4-4s3.7 1.4 4.4 4M11.6 18c.7-2.6 2.6-4 4.4-4s3.7 1.4 4.4 4"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 6l-6 6 6 6"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M7 17l4-4 3 3 3-3 3 4"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg>`,
  block: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M7 7l10 10"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/></svg>`,
  lang: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3.2 3 12.8 0 16M12 4c-3 3.2-3 12.8 0 16"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>`
};

function toast(msg) {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 2800);
}

function t(key, vars) {
  return I18n.t(key, vars);
}

function toastErr(e) {
  toast(I18n.error(e && e.message));
}

function genderLabel(g) {
  if (g === 'female') return t('female');
  if (g === 'male') return t('male');
  if (g === 'unknown') return t('genderUnknown');
  return g || '';
}

function chatBody(body, vars) {
  const name = (vars && vars.name) || (state.user && state.user.username) || '';
  return I18n.localizeChatBody ? I18n.localizeChatBody(body, { name }) : (body || '');
}

function planLabel(months) {
  const n = Number(months);
  return n === 1 ? t('planMonths', { n }) : t('planMonthsMany', { n });
}

function rerender() {
  const v = state.view;
  if (v === 'welcome') showWelcome();
  else if (v === 'register') showRegister();
  else if (v === 'scan') showScan();
  else if (v === 'home') showHome();
  else if (v === 'chats') showInbox();
  else if (v === 'groups') showGroups();
  else if (v === 'group-create') showCreateGroup();
  else if (v === 'group-preview' && state.discoverGroup) showDiscoverPreview(state.discoverGroup);
  else if (v === 'group-detail' && state.group) showGroupDetail(state.group.id);
  else if (v === 'group-chat' && state.groupChat) renderGroupChat();
  else if (v === 'chat' && state.chat) renderChat();
  else if (v === 'upgrade') showUpgrade();
  else if (v === 'profile') showProfile();
  else if (v === 'settings') showSettings();
  else if (v === 'host-apply') showHostApply();
  else if (v === 'edit-profile') showEditProfile();
  else if (v === 'change-pin') showChangePin();
  else if (v === 'blocked') showBlocked();
  else if (v === 'help') showHelp(Boolean(state.user));
}

function closeModal() {
  modalEl.hidden = true;
  modalEl.innerHTML = '';
}

function modal(html) {
  modalEl.hidden = false;
  modalEl.innerHTML = `<div class="glass-card">${html}</div>`;
  modalEl.onclick = (e) => { if (e.target === modalEl) closeModal(); };
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { credentials: 'include', ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (data && data.code === 'MAINTENANCE') applyMaintenance(true);
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.code = data.code;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function applyMaintenance(on) {
  const el = $('#maintenance-screen');
  if (!el) return;
  const next = Boolean(on);
  const wasOn = document.body.classList.contains('is-maintenance');
  if (state.settings) state.settings.maintenance = next;
  el.hidden = !next;
  const msg = $('#maintenance-msg');
  if (msg) msg.textContent = t('maintenanceMsg');
  document.body.classList.toggle('is-maintenance', next);
  const extras = [app, toastEl, modalEl, $('#tour')];
  extras.forEach((node) => {
    if (!node) return;
    if (next) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  });
  if (next) {
    closeModal();
    const tour = $('#tour');
    if (tour) {
      tour.hidden = true;
      tour.innerHTML = '';
    }
    if (state.socket) {
      const sock = state.socket;
      state.socket = null;
      sock.disconnect();
    }
  } else if (wasOn) {
    if (state.user) {
      if (!state.socket) connectSocket();
    } else {
      api('/api/me')
        .then((me) => {
          if (state.settings && state.settings.maintenance) return;
          state.user = me.user;
          if (me.user.status === 'pending_liveness') return showScan();
          connectSocket();
          showHome();
        })
        .catch(() => {});
    }
  }
}

function startMaintenancePoll() {
  const tick = async () => {
    try {
      const s = await fetch('/api/public-settings', { credentials: 'include' }).then((r) => r.json());
      state.settings = { ...(state.settings || {}), ...s };
      applyMaintenance(Boolean(s.maintenance));
    } catch {
      /* ignore poll errors */
    }
  };
  tick();
  if (!state.maintTick) state.maintTick = setInterval(tick, 8000);
}

function mastheadHtml() {
  return `<header class="app-masthead" role="banner">
    <span class="logo-aura" aria-hidden="true"></span>
    <img class="masthead-logo" src="/assets/sakarwine-logo.png" alt="SAKARWINE" />
  </header>`;
}

function avatarHtml(user, cls = '') {
  if (!user) return '';
  const tap = user.id != null ? ` data-photo-user="${user.id}"` : '';
  const fb = user.hasPhoto === false || !user.hasPhoto;
  const genderClass = user.isAi ? 'ai' : (user.gender === 'female' ? 'fallback-female' : 'fallback-male');
  const src = user.photoUrl || (user.isAi ? '/assets/saka-guide.svg' : (user.gender === 'female' ? '/assets/default-female.png' : '/assets/default-male.png'));
  return `<img class="avatar round ${cls} ${fb || user.isAi ? genderClass : ''}" alt="" src="${escapeHtml(src)}"${tap} />`;
}

async function openProfilePhoto(userId) {
  try {
    const data = await api(`/api/users/${userId}/card`);
    const u = data.user;
    const photo = u.hasPhoto && u.photoUrl
      ? `<img class="profile-lite-photo" src="${escapeHtml(u.photoUrl)}" alt="${escapeHtml(u.username)}" />`
      : avatarHtml(u, 'profile-lite-photo');
    modal(`
      <div class="profile-lite">
        ${photo}
        <h3 style="margin:12px 0 4px">${escapeHtml(u.username)}</h3>
        <p class="profile-id">${escapeHtml(u.accountId || '—')}</p>
        ${u.bio ? `<p class="profile-bio">${escapeHtml(u.bio)}</p>` : ''}
        <button class="btn secondary block" id="photo-close">${t('close')}</button>
      </div>`);
    $('#photo-close').onclick = closeModal;
  } catch (e) {
    toastErr(e);
  }
}

function roleMark(user) {
  let core = '';
  if (user && user.badge) {
    core = `<span class="badge-neon" data-badge="${escapeHtml(user.badge)}">${escapeHtml(user.badge)}</span>`;
  } else {
    const lv = user && user.level != null ? user.level : 0;
    core = `<span class="badge-lv">${t('lv', { n: lv })}</span>`;
  }
  if (user && user.isHost) {
    core += ` <span class="badge-neon badge-host" data-badge="host">${t('host')}</span>`;
  }
  return core;
}

function statusPill(user) {
  if (user && user.isSpecial) return roleMark(user);
  if (user && remainingPaidParts(user.paidUntil).ms) {
    return `<span class="pill paid-tick" id="paid-remain-pill">${t('paid')} · ${escapeHtml(paidCountdownLabel(user.paidUntil))} · <span class="badge-lv">${t('lv', { n: user.level })}</span></span>`;
  }
  return `<span class="badge-lv">${t('lv', { n: user && user.level })}</span>`;
}

function bindPaidRemain() {
  const u = state.user;
  if (!u || u.isSpecial) return;
  const freeUntil = state.view === 'profile' ? u.freeUntil : null;
  tickPaidRemain(u.paidUntil, freeUntil);
}

function petals() {}

function syncLang(code) {
  if (!state.user) return;
  api('/api/me/lang', { method: 'PUT', json: { lang: code || I18n.lang } }).catch(() => {});
}

const USERNAME_CHAR_CLASS = '[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]';

function usernamePatternOk(value) {
  return new RegExp(`^${USERNAME_CHAR_CLASS}{1,12}$`).test(String(value || '').trim());
}

function connectSocket() {
  if ((state.settings && state.settings.maintenance) || document.body.classList.contains('is-maintenance')) {
    return;
  }
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  const socket = io({ transports: ['websocket', 'polling'] });
  state.socket = socket;
  socket.on('maintenance', (payload) => {
    const frozen = Boolean(payload && payload.on);
    applyMaintenance(frozen);
  });
  socket.on('connect_error', (err) => {
    if (String((err && err.message) || '').includes('MAINTENANCE')) applyMaintenance(true);
  });
  socket.on('message', ({ conversationId, message }) => {
    if (state.chat && state.chat.id === conversationId) {
      addChatMessage(message);
      const box = $('#messages');
      if (box) {
        box.innerHTML = renderThread(state.chat.messages);
        box.scrollTop = box.scrollHeight;
      }
    } else if (!message.sender) {
      toast(chatBody(message.body) || t('newSystem'));
    } else if (message.sender && message.sender.id !== state.user.id) {
      toast(t('newMessageFrom', { name: message.sender.username }));
    }
    if (state.view === 'chats') loadInbox();
  });
  socket.on('chat:messaging', ({ conversationId, messagingOpen }) => {
    if (state.chat && state.chat.id === conversationId) {
      if (!state.chat.adminGate) state.chat.adminGate = {};
      state.chat.adminGate.messagingOpen = messagingOpen;
      state.chat.adminGate.closed = !messagingOpen;
      if (!state.user.isAdmin) {
        state.chat.adminGate.canSend = Boolean(messagingOpen) && !state.chat.adminGate.waitForAdmin;
      }
      if (state.view === 'chat') renderChat();
    }
  });
  socket.on('chat:gate', ({ conversationId, adminGate }) => {
    if (state.chat && state.chat.id === conversationId && adminGate) {
      state.chat.adminGate = adminGate;
      if (state.view === 'chat') renderChat();
    }
  });
  socket.on('presence', () => {
    if (state.view === 'home') loadHome();
    if (state.view === 'chats') loadInbox();
  });
  socket.on('typing', ({ conversationId, typing }) => {
    if (state.chat && state.chat.id === conversationId) {
      const el = $('#typing');
      if (el) el.textContent = typing ? t('typing', { name: state.chat.peer.username }) : '';
    }
  });
  socket.on('upgrade:approved', (payload) => {
    toast(t('upgradeApproved', { level: payload.level }));
    refreshMe();
  });
  socket.on('host:approved', () => {
    toast(t('hostApproved'));
    refreshMe().then(() => {
      if (state.view === 'home') loadHome();
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('host:rejected', () => {
    toast(t('hostRejectedToast'));
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('host:income', (payload) => {
    toast(t('hostCreditFrom', { amount: payload.amount, name: payload.partnerUsername || t('upgradeTitle') }));
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('payout:done', () => {
    toast(t('payoutDone'));
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('group:invite', (payload) => {
    toast(t('inviteFrom', {
      name: payload.inviterName || '',
      id: payload.inviterAccountId || '',
      group: payload.groupName || ''
    }));
    if (state.view === 'groups') showGroups();
  });
  socket.on('group:message', ({ groupId, message }) => {
    if (state.groupChat && state.groupChat.id === groupId) {
      addGroupChatMessage(message);
      const box = $('#messages');
      if (box) {
        box.innerHTML = renderThread(state.groupChat.messages);
        box.scrollTop = box.scrollHeight;
      }
    } else if (state.view === 'chats') loadInbox();
    else if (message && message.sender && message.sender.id !== state.user.id) {
      toast(t('newMessageFrom', { name: message.sender.username }));
    }
  });
  socket.on('group:join-request', (payload) => {
    toast(t('joinRequestFrom', { name: payload.username || '', group: payload.groupName || '' }));
    if (state.view === 'group-detail' && state.group && state.group.id === payload.groupId) {
      showGroupDetail(payload.groupId);
    }
  });
  socket.on('group:join-accepted', (payload) => {
    toast(t('joinWasAccepted', { group: payload.groupName || '' }));
    if (state.view === 'groups') showGroups();
    if (state.view === 'chats') loadInbox();
  });
  socket.on('group:join-declined', (payload) => {
    toast(t('joinWasDeclined', { group: payload.groupName || '' }));
    if (state.view === 'groups') showGroups();
  });
  socket.on('group:removed', ({ groupId, reason }) => {
    toast(reason === 'kicked' ? t('kickedFromGroup') : t('leftGroup'));
    if (state.groupChat && state.groupChat.id === groupId) {
      state.groupChat = null;
      showInbox();
    } else if (state.view === 'chats') loadInbox();
    else if (state.view === 'groups' || state.view === 'group-detail') showGroups();
  });
  socket.on('broadcast', () => {
    refreshMe();
  });
  socket.on('account:status', () => {
    toast(t('accountChanged'));
    location.reload();
  });
}

async function refreshMe() {
  const data = await api('/api/me');
  state.user = data.user;
  return data.user;
}

async function boot() {
  I18n.init();
  I18n.onChange((code) => {
    syncLang(code);
    applyMaintenance(Boolean(state.settings && state.settings.maintenance));
    rerender();
  });
  petals();
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-photo-user]');
    if (!el || el.closest('#modal')) return;
    const id = Number(el.dataset.photoUser);
    if (state.user && id === Number(state.user.id)) return;
    e.preventDefault();
    e.stopPropagation();
    openProfilePhoto(id);
  }, true);
  startMaintenancePoll();
  state.settings = await api('/api/public-settings');
  document.title = state.settings.siteName;
  applyMaintenance(Boolean(state.settings.maintenance));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.user) return;
    refreshMe().then(() => bindPaidRemain()).catch(() => {});
  });
  try {
    const me = await api('/api/me');
    state.user = me.user;
    if (me.user.status === 'pending_liveness') return showScan();
    connectSocket();
    showHome();
  } catch {
    showWelcome();
  }
}

function showWelcome() {
  state.view = 'welcome';
  app.innerHTML = `
    <section class="screen welcome-screen">
      <div class="welcome-hero">
        <div class="brand-lockup">
          <span class="logo-aura" aria-hidden="true"></span>
          <img class="brand-logo" src="/assets/sakarwine-logo.png" alt="SAKARWINE" />
        </div>
        <h1>SAKARWINE</h1>
        <svg class="hero-wave" viewBox="0 0 375 56" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 24C62 52 118 4 188 24C248 42 312 8 375 26V56H0Z" fill="#ffffff"/>
        </svg>
      </div>
      <div class="welcome-card stack">
        <div class="field">
          <label>${t('username')}</label>
          <input id="login-user" autocomplete="username" />
        </div>
        <div class="field">
          <label>${t('pin6')}</label>
          <input id="login-pass" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" />
        </div>
        <button class="btn block" id="login-btn">${t('enterLounge')}</button>
        <button class="btn secondary block" id="goto-reg">${t('createAccount')}</button>
        <button class="btn ghost" id="goto-help">${t('forgotPin')}</button>
        ${I18n.switcherHtml('lang-switch')}
      </div>
    </section>`;
  $('#login-btn').onclick = login;
  $('#goto-reg').onclick = showRegister;
  $('#goto-help').onclick = () => showHelp(false);
  I18n.bindSwitcher('lang-switch');
}

async function login() {
  try {
    const data = await api('/api/login', {
      method: 'POST',
      json: { username: $('#login-user').value, password: $('#login-pass').value, lang: I18n.lang }
    });
    state.user = data.user;
    if (data.user.status === 'pending_liveness') return showScan();
    connectSocket();
    showHome();
  } catch (e) {
    toastErr(e);
  }
}

function yearOptions() {
  const y = new Date().getFullYear();
  let html = '';
  for (let i = y - 18; i >= 1950; i--) html += `<option value="${i}">${i}</option>`;
  return html;
}

function showRegister() {
  state.view = 'register';
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="back">${ICONS.back}</button>
        <h2>${t('joinTitle')}</h2>
      </div>
      <form id="reg" class="glass-card" style="overflow:auto">
        <label class="photo-pick">
          <input class="hidden-file" type="file" name="photo" accept="image/*" required />
          <div id="photo-preview" class="avatar ai">📷</div>
          <span class="small muted">${t('profilePhoto')}</span>
        </label>
        <div class="field">
          <label>${t('username')}</label>
          <input name="username" required minlength="1" maxlength="12" autocomplete="username" spellcheck="false" autocapitalize="none" pattern="${USERNAME_CHAR_CLASS}{1,12}" title="${t('errUsername')}" />
          <p class="small muted" style="margin:6px 0 0">${t('usernameRule')}</p>
        </div>
        <div class="field"><label>${t('pinExactly6')}</label><input name="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" required /></div>
        <div class="row-2">
          <div class="field"><label>${t('gender')}</label>
            <select name="gender" required>
              <option value="female">${t('female')}</option>
              <option value="male">${t('male')}</option>
            </select>
          </div>
          <div class="field"><label>${t('birthYear')}</label>
            <select name="birthYear">${yearOptions()}</select>
          </div>
        </div>
        <div class="field"><label>${t('phone')}</label><input name="phone" required inputmode="tel" /></div>
        <button class="btn block" type="submit">${t('continueScan')}</button>
      </form>
    </section>`;
  $('#back').onclick = showWelcome;
  const pick = $('input[name=photo]');
  pick.onchange = () => {
    const f = pick.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    $('#photo-preview').outerHTML = `<img id="photo-preview" class="avatar" src="${url}" alt="" />`;
  };
  $('#reg').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!usernamePatternOk(fd.get('username'))) {
      toast(t('errUsername'));
      return;
    }
    fd.append('lang', I18n.lang);
    try {
      const data = await api('/api/register', { method: 'POST', body: fd });
      state.user = data.user;
      showScan();
    } catch (err) {
      toastErr(err);
    }
  };
}

function showScan() {
  state.view = 'scan';
  app.innerHTML = `
    <section class="screen">
      <div class="topbar"><h2>${t('faceScan')}</h2></div>
      <p class="muted small">${t('scanHelp')}</p>
      <div class="scan-stage">
        <video id="cam" playsinline muted></video>
        <div class="face-guide"></div>
      </div>
      <div class="scan-hint" id="hint">${t('allowCamera')}</div>
      <button class="btn block" id="start-scan" style="margin-top:10px">${t('startScan')}</button>
    </section>`;
  $('#start-scan').onclick = async () => {
    $('#start-scan').disabled = true;
    try {
      const result = await Liveness.run({
        video: $('#cam'),
        onHint: (t) => { $('#hint').textContent = t; }
      });
      const data = await api('/api/me/liveness', { method: 'POST', json: result });
      state.user = data.user;
      const match = data.genderMatch ? t('matches') : t('differsFrom');
      modal(`
        <h3 style="margin-top:0">${t('youreIn')}</h3>
        <p>${t('accountId')} <strong>${data.user.accountId}</strong></p>
        <p class="small muted">${t('estimatedGender')}: <strong>${escapeHtml(genderLabel(result.estimatedGender))}</strong> (${match} ${t('yourProfile')}).</p>
        <button class="btn block" id="go-in">${t('meetSaka')}</button>`);
      $('#go-in').onclick = () => {
        closeModal();
        connectSocket();
        showHome({ tour: true, afterRegister: true, aiConversationId: data.aiConversationId });
      };
    } catch (err) {
      $('#start-scan').disabled = false;
      toast(I18n.error(err.message) || t('scanFailed'));
    }
  };
}

function nav(active) {
  const tab = (go, icon, label) =>
    `<button type="button" data-go="${go}" class="${active === go ? 'active' : ''}"><span class="icon-btn">${icon}</span>${label}</button>`;
  return `
    <nav class="nav" aria-label="${t('navHome')}">
      ${tab('home', ICONS.people, t('navHome'))}
      ${tab('chats', ICONS.chat, t('navChat'))}
      ${tab('groups', ICONS.group, t('navGroup'))}
      ${tab('profile', ICONS.me, t('navProfile'))}
      ${tab('help', ICONS.help, t('navHelp'))}
    </nav>`;
}

function bindNav() {
  document.querySelectorAll('.nav [data-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === 'home') showHome();
      else if (go === 'chats') showInbox();
      else if (go === 'groups') showGroups();
      else if (go === 'profile') showProfile();
      else if (go === 'help') showHelp(true);
    };
  });
}

function meBtnHtml() {
  if (!state.user) return '';
  return `<button type="button" class="home-me" id="goto-me" aria-label="${t('navMe')}">${avatarHtml(state.user, 'round home-me-ava')}</button>`;
}

function bindMeButton() {
  const meBtn = $('#goto-me');
  if (meBtn) meBtn.onclick = showProfile;
}

function startAdBanner() {
  if (state.adTimer) {
    clearInterval(state.adTimer);
    state.adTimer = null;
  }
  const box = $('#ad-banner');
  if (!box) return;
  api('/api/ads')
    .then(({ ads, rotateMs }) => {
      if (!ads || !ads.length) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      box.hidden = false;
      let i = 0;
      const paint = () => {
        const ad = ads[i % ads.length];
        box.innerHTML = `<img src="${ad.imageUrl}" alt="${escapeHtml(t('adBanner'))}" />`;
        i += 1;
      };
      paint();
      if (ads.length > 1) {
        state.adTimer = setInterval(paint, rotateMs || 5000);
      }
    })
    .catch(() => {
      box.hidden = true;
    });
}

function peopleGenderFilter() {
  const g = state.peopleGender;
  return g === 'male' || g === 'female' ? g : 'all';
}

async function loadHome() {
  const gender = peopleGenderFilter();
  const qs = gender === 'all' ? '' : `?gender=${encodeURIComponent(gender)}`;
  const { users } = await api('/api/users' + qs);
  state.users = users;
  paintHomeList();
}

function paintHomeList() {
  const list = $('#user-list');
  if (!list) return;
  const gender = peopleGenderFilter();
  const users = (state.users || []).filter((u) => gender === 'all' || u.gender === gender);
  list.innerHTML = users.map((u) => `
    <div class="user-row ${u.isAi ? '' : (u.gender === 'female' ? 'gender-female' : 'gender-male')}" data-id="${u.id}">
      ${avatarHtml(u)}
      <div class="meta">
        <div class="name">${escapeHtml(u.username)} ${u.isAi ? '· ' + t('guide') : ''} ${roleMark(u)}</div>
        <div class="sub">${u.online ? t('onlineNow') : t('offline')} · ${genderLabel(u.gender)}${u.blocked ? ' · ' + t('blocked') : ''}</div>
      </div>
      <span class="when">${u.online ? t('onlineNow') : ''}</span>
    </div>`).join('') || `<p class="settings-empty">${t('noPeople')}</p>`;
  list.querySelectorAll('.user-row').forEach((row) => {
    row.onclick = () => openChat(Number(row.dataset.id), { from: 'home' });
  });
}

function inboxPreview(last) {
  if (!last) return '';
  if (last.type === 'image') return t('photo');
  if (last.type === 'voice') return t('voice');
  return chatBody(last.body) || '';
}

function paintInboxList(conversations) {
  const list = $('#chat-list');
  if (!list) return;
  const items = conversations || [];
  list.innerHTML = items.map((c) => {
    if (c.kind === 'group') {
      const last = c.lastMessage || {};
      return `
    <div class="user-row" data-kind="group" data-gid="${c.groupId}">
      ${groupLogoHtml(c)}
      <div class="meta">
        <div class="name">${escapeHtml(c.name || '')}</div>
        <div class="sub">${escapeHtml(inboxPreview(last) || t('groupsTitle'))}</div>
      </div>
      <span class="when">${last.createdAt ? formatMsgTime(last.createdAt) : ''}</span>
    </div>`;
    }
    const peer = c.peer || {};
    const last = c.lastMessage || {};
    const gClass = peer.isAi ? '' : (peer.gender === 'female' ? 'gender-female' : 'gender-male');
    return `
    <div class="user-row ${gClass}" data-kind="dm" data-peer="${peer.id}">
      ${avatarHtml(peer)}
      <div class="meta">
        <div class="name">${escapeHtml(peer.username || '')} ${peer.isAi ? '· ' + t('guide') : ''} ${roleMark(peer)}</div>
        <div class="sub">${escapeHtml(inboxPreview(last))}</div>
      </div>
      <span class="when">${last.createdAt ? formatMsgTime(last.createdAt) : ''}</span>
    </div>`;
  }).join('') || `<p class="settings-empty">${t('noChats')}</p>`;
  list.querySelectorAll('.user-row').forEach((row) => {
    row.onclick = () => {
      if (row.dataset.kind === 'group') openGroupChat(Number(row.dataset.gid), { from: 'chats' });
      else openChat(Number(row.dataset.peer), { from: 'chats' });
    };
  });
}

async function loadInbox() {
  const list = $('#chat-list');
  if (!list) return;
  try {
    const data = await api('/api/conversations');
    paintInboxList(data.conversations || []);
  } catch (e) {
    list.innerHTML = `<p class="settings-empty">${escapeHtml(I18n.error(e && e.message))}</p>`;
  }
}

async function showInbox() {
  state.view = 'chats';
  const u = state.user;
  app.innerHTML = `
    <section class="screen home-screen">
      ${mastheadHtml()}
      <div class="screen-body">
      <div class="topbar">
        ${meBtnHtml()}
        <h2>${t('chatTitle')}</h2>
        <span class="pill-slot">${statusPill(u)}</span>
      </div>
      <div id="chat-list" class="user-list"></div>
      </div>
      ${nav('chats')}
    </section>`;
  bindNav();
  bindMeButton();
  bindPaidRemain();
  await loadInbox();
}

function leaveChat() {
  stopChatPresence();
  state.groupChat = null;
  if (state.chatFrom === 'chats') showInbox();
  else if (state.chatFrom === 'groups') showGroups();
  else showHome();
}

function groupLogoHtml(g) {
  if (g && g.logoUrl) return `<img class="avatar round" src="${escapeHtml(g.logoUrl)}" alt="" />`;
  return `<div class="avatar round ai">${ICONS.group}</div>`;
}

async function showGroups() {
  state.view = 'groups';
  const u = state.user;
  app.innerHTML = `
    <section class="screen home-screen">
      ${mastheadHtml()}
      <div class="screen-body">
      <div class="topbar">
        ${meBtnHtml()}
        <h2>${t('groupsTitle')}</h2>
        <button type="button" class="icon-btn" id="group-create" aria-label="${t('createGroup')}">${ICONS.plus}</button>
      </div>
      <div id="group-invites"></div>
      <div id="group-list" class="user-list"><p class="muted">${t('loading')}</p></div>
      <div id="group-discover"></div>
      </div>
      ${nav('groups')}
    </section>`;
  bindNav();
  bindMeButton();
  $('#group-create').onclick = showCreateGroup;
  try {
    const [inv, list, disc] = await Promise.all([
      api('/api/group-invites'),
      api('/api/groups'),
      api('/api/groups/discover')
    ]);
    const invBox = $('#group-invites');
    const invites = inv.invites || [];
    if (invites.length) {
      invBox.innerHTML = `<h3 class="group-section">${t('groupInvites')}</h3>` + invites.map((row) => `
        <div class="glass-card stack group-invite" data-id="${row.id}">
          <div class="user-row">
            ${groupLogoHtml(row.group)}
            <div class="meta">
              <div class="name">${escapeHtml((row.group && row.group.name) || '')}</div>
              <div class="sub">${t('inviteFrom', {
                name: (row.inviter && row.inviter.username) || '',
                id: (row.inviter && row.inviter.accountId) || '',
                group: (row.group && row.group.name) || ''
              })}</div>
            </div>
          </div>
          <div class="me-actions">
            <button type="button" class="btn" data-accept="${row.id}">${t('accept')}</button>
            <button type="button" class="btn secondary" data-decline="${row.id}">${t('decline')}</button>
          </div>
        </div>`).join('');
      invBox.querySelectorAll('[data-accept]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(`/api/group-invites/${btn.dataset.accept}/accept`, { method: 'POST' });
            toast(t('inviteAccepted'));
            showGroups();
          } catch (e) {
            toastErr(e);
          }
        };
      });
      invBox.querySelectorAll('[data-decline]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(`/api/group-invites/${btn.dataset.decline}/decline`, { method: 'POST' });
            toast(t('inviteDeclined'));
            showGroups();
          } catch (e) {
            toastErr(e);
          }
        };
      });
    } else {
      invBox.innerHTML = '';
    }
    const groups = list.groups || [];
    const box = $('#group-list');
    box.innerHTML = groups.map((g) => `
      <div class="user-row" data-id="${g.id}">
        ${groupLogoHtml(g)}
        <div class="meta">
          <div class="name">${escapeHtml(g.name)}</div>
          <div class="sub">${g.memberCount != null ? t('groupMemberCount', { n: g.memberCount }) : ''}</div>
        </div>
        <span class="when">${g.role === 'owner' ? t('groupOwner') : ''}</span>
      </div>`).join('') || `<p class="settings-empty">${t('noGroups')}</p>`;
    box.querySelectorAll('.user-row').forEach((row) => {
      row.onclick = () => showGroupDetail(Number(row.dataset.id));
    });
    const discBox = $('#group-discover');
    const others = (disc.groups || []).filter((g) => !g.joined);
    if (discBox) {
      discBox.innerHTML = `<h3 class="group-section">${t('discoverGroups')}</h3>` + (
        others.length
          ? others.map((g) => `
        <div class="user-row" data-id="${g.id}">
          ${groupLogoHtml(g)}
          <div class="meta">
            <div class="name">${escapeHtml(g.name)}</div>
            <div class="sub">${g.memberCount != null ? t('groupMemberCount', { n: g.memberCount }) : ''}</div>
          </div>
          ${g.requested
            ? `<span class="when">${t('joinRequested')}</span>`
            : `<button type="button" class="btn secondary" data-join="${g.id}">${t('requestJoin')}</button>`}
        </div>`).join('')
          : `<p class="settings-empty">${t('noDiscoverGroups')}</p>`
      );
      discBox.querySelectorAll('.user-row').forEach((row) => {
        const g = others.find((x) => x.id === Number(row.dataset.id));
        row.onclick = () => {
          if (g) showDiscoverPreview(g);
        };
      });
      discBox.querySelectorAll('[data-join]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const g = others.find((x) => x.id === Number(btn.dataset.join));
          if (g) showDiscoverPreview(g);
        };
      });
    }
  } catch (e) {
    toastErr(e);
  }
}

function showDiscoverPreview(g) {
  state.view = 'group-preview';
  state.discoverGroup = g;
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
        <h2>${escapeHtml(g.name || t('discoverGroups'))}</h2>
      </div>
      <div class="glass-card stack center me-card">
        ${groupLogoHtml(g)}
        <div class="me-name">${escapeHtml(g.name || '')}</div>
        ${g.memberCount != null ? `<div class="small muted">${t('groupMemberCount', { n: g.memberCount })}</div>` : ''}
        ${g.requested
          ? `<p class="small muted">${t('joinRequested')}</p>`
          : `<button type="button" class="btn block" id="req-join">${t('requestJoin')}</button>`}
      </div>
      </div>
      ${nav('groups')}
    </section>`;
  bindNav();
  $('#back').onclick = showGroups;
  if ($('#req-join')) {
    $('#req-join').onclick = async () => {
      try {
        await api(`/api/groups/${g.id}/join`, { method: 'POST' });
        toast(t('joinRequested'));
        showGroups();
      } catch (e) {
        toastErr(e);
      }
    };
  }
}

function showCreateGroup() {
  state.view = 'group-create';
  const can = Boolean(state.user && (state.user.paid || state.user.isSpecial));
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
        <h2>${t('createGroup')}</h2>
      </div>
      <div class="glass-card stack" style="text-align:left">
        ${can ? `
          <p class="small muted">${t('groupCreateHelp')}</p>
          <div class="field"><label>${t('groupName')}</label><input id="group-name" maxlength="40" required /></div>
          <div class="field"><label>${t('groupLogo')}</label><input id="group-logo" type="file" accept="image/*" /></div>
          <button type="button" class="btn block" id="group-save">${t('createGroup')}</button>
        ` : `
          <p>${t('errGroupPaid')}</p>
          <p class="small muted">${t('groupCreateHelp')}</p>
          <button type="button" class="btn block" id="group-upgrade">${t('navUpgrade')}</button>
        `}
      </div>
      </div>
      ${nav('groups')}
    </section>`;
  bindNav();
  $('#back').onclick = showGroups;
  if ($('#group-upgrade')) $('#group-upgrade').onclick = showUpgrade;
  if ($('#group-save')) {
    $('#group-save').onclick = async () => {
      const name = $('#group-name').value.trim();
      const logo = $('#group-logo').files[0];
      if (!name) return toast(t('errGroupName'));
      if (!logo) return toast(t('errGroupLogo'));
      const fd = new FormData();
      fd.append('name', name);
      fd.append('logo', logo);
      const btn = $('#group-save');
      btn.disabled = true;
      try {
        const data = await api('/api/groups', { method: 'POST', body: fd });
        toast(t('groupCreated'));
        showGroupDetail(data.group.id);
      } catch (e) {
        btn.disabled = false;
        if (e.code === 'GROUP_PAID' || e.code === 'UPGRADE') showUpgrade();
        toastErr(e);
      }
    };
  }
}

async function showGroupDetail(id) {
  state.view = 'group-detail';
  try {
    const data = await api(`/api/groups/${id}`);
    state.group = data.group;
    app.innerHTML = `
      <section class="screen">
        <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${escapeHtml(data.group.name)}</h2>
        </div>
        <div class="glass-card stack center me-card">
          ${groupLogoHtml(data.group)}
          <div class="me-name">${escapeHtml(data.group.name)}</div>
          <div class="small muted">${t('groupMemberCount', { n: data.members.length })}</div>
          <button type="button" class="btn block" id="open-group-chat">${t('openGroupChat')}</button>
        </div>
        ${data.group.role === 'owner' && (data.joinRequests || []).length ? `
        <h3 class="group-section">${t('joinRequests')}</h3>
        ${(data.joinRequests || []).map((row) => `
          <div class="glass-card stack group-invite">
            <div class="user-row">
              ${avatarHtml(row.user, 'round')}
              <div class="meta">
                <div class="name">${escapeHtml(row.user.username)}</div>
                <div class="sub">${escapeHtml(row.user.accountId || '')}</div>
              </div>
            </div>
            <div class="me-actions">
              <button type="button" class="btn" data-join-accept="${row.id}">${t('accept')}</button>
              <button type="button" class="btn secondary" data-join-decline="${row.id}">${t('decline')}</button>
            </div>
          </div>`).join('')}
        ` : ''}
        <h3 class="group-section">${t('addPeople')}</h3>
        <div class="glass-card stack" style="text-align:left">
          <div class="field"><label>${t('pinRecoveryAccountId')}</label><input id="group-aid" autocomplete="off" /></div>
          <button type="button" class="btn secondary block" id="group-lookup">${t('lookupGo')}</button>
          <div id="group-preview"></div>
        </div>
        <h3 class="group-section">${t('groupMembers')}</h3>
        <div class="user-list">
          ${data.members.map((m) => `
            <div class="user-row">
              ${avatarHtml(m, 'round')}
              <div class="meta">
                <div class="name">${escapeHtml(m.username)} ${m.role === 'owner' ? '· ' + t('groupOwner') : ''}</div>
                <div class="sub">${escapeHtml(m.accountId || '')}</div>
              </div>
              ${data.group.role === 'owner' && m.id !== state.user.id
                ? `<button type="button" class="btn secondary" data-kick="${m.id}">${t('kickMember')}</button>`
                : ''}
            </div>`).join('')}
        </div>
        </div>
        ${nav('groups')}
      </section>`;
    bindNav();
    $('#back').onclick = showGroups;
    $('#open-group-chat').onclick = () => openGroupChat(id, { from: 'groups' });
    document.querySelectorAll('[data-join-accept]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/groups/${id}/join-requests/${btn.dataset.joinAccept}/accept`, { method: 'POST' });
          toast(t('joinAcceptDone'));
          showGroupDetail(id);
        } catch (err) {
          toastErr(err);
        }
      };
    });
    document.querySelectorAll('[data-join-decline]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/groups/${id}/join-requests/${btn.dataset.joinDecline}/decline`, { method: 'POST' });
          toast(t('joinDeclineDone'));
          showGroupDetail(id);
        } catch (err) {
          toastErr(err);
        }
      };
    });
    document.querySelectorAll('[data-kick]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/groups/${id}/kick`, { method: 'POST', json: { userId: Number(btn.dataset.kick) } });
          toast(t('memberKicked'));
          showGroupDetail(id);
        } catch (err) {
          toastErr(err);
        }
      };
    });
    $('#group-lookup').onclick = async () => {
      const accountId = $('#group-aid').value.trim();
      if (!accountId) return toast(t('errAccountId'));
      const box = $('#group-preview');
      try {
        const looked = await api('/api/groups/lookup?accountId=' + encodeURIComponent(accountId));
        const u = looked.user;
        box.innerHTML = `
          <div class="user-row">
            ${avatarHtml(u, 'round')}
            <div class="meta">
              <div class="name">${escapeHtml(u.username)}</div>
              <div class="sub">${escapeHtml(u.accountId || '')}</div>
            </div>
            <button type="button" class="btn" id="group-add">${t('inviteSend')}</button>
          </div>`;
        $('#group-add').onclick = async () => {
          try {
            await api(`/api/groups/${id}/invites`, { method: 'POST', json: { userId: u.id } });
            toast(t('inviteSent'));
            box.innerHTML = '';
            $('#group-aid').value = '';
          } catch (e) {
            toastErr(e);
          }
        };
      } catch (e) {
        box.innerHTML = '';
        toastErr(e);
      }
    };
  } catch (e) {
    toastErr(e);
    showGroups();
  }
}

function addGroupChatMessage(message) {
  if (!state.groupChat || !message) return false;
  if (message.id != null && state.groupChat.messages.some((m) => m.id === message.id)) return false;
  state.groupChat.messages.push(message);
  return true;
}

async function openGroupChat(groupId, opts = {}) {
  try {
    if (opts.from === 'chats' || (!opts.from && state.view === 'chats')) state.chatFrom = 'chats';
    else if (state.view !== 'group-chat') state.chatFrom = 'groups';
    const data = await api(`/api/groups/${groupId}/messages`);
    state.groupChat = {
      id: data.group.id,
      name: data.group.name,
      logoUrl: data.group.logoUrl,
      role: data.group.role,
      window: data.window,
      messages: data.messages || []
    };
    renderGroupChat();
  } catch (e) {
    toastErr(e);
  }
}

function renderGroupChat() {
  state.view = 'group-chat';
  const c = state.groupChat;
  const expired = c.window && c.window.expired;
  const groupRemain = expired ? t('upgradeEnded') : formatRemain(c.window && c.window.remainingMs, c.window);
  app.innerHTML = `
    <section class="screen chat-screen">
      <div class="screen-body">
      <div class="topbar chat-head">
        <button class="chat-tool" id="back" aria-label="${t('back')}">${ICONS.back}</button>
        ${groupLogoHtml(c)}
        <div class="meta">
          <div class="name">${escapeHtml(c.name)}</div>
          <div class="sub">${escapeHtml(groupRemain || '')}</div>
        </div>
        <div class="chat-actions">
          <button class="chat-tool" id="leave-group" title="${t('leaveGroup')}" aria-label="${t('leaveGroup')}">${t('leaveGroup')}</button>
        </div>
      </div>
      ${expired ? `<div class="upgrade-banner">${t('groupChatUpgrade')}<br><button class="btn" id="go-up" style="margin-top:8px">${t('seePlans')}</button></div>` : ''}
      <div id="messages" class="messages">${renderThread(c.messages)}</div>
      </div>
      <div class="composer">
        <div class="composer-pill">
          <textarea id="text" rows="1" ${expired ? 'disabled' : ''} placeholder="${t('typeHere')}"></textarea>
        </div>
        <button class="chat-send" id="send" ${expired ? 'disabled' : ''} aria-label="${t('send')}">${ICONS.send}</button>
      </div>
    </section>`;
  $('#back').onclick = leaveChat;
  if ($('#go-up')) $('#go-up').onclick = () => { state.groupChat = null; showUpgrade(); };
  $('#leave-group').onclick = async () => {
    try {
      await api(`/api/groups/${c.id}/leave`, { method: 'POST' });
      toast(t('leftGroup'));
      leaveChat();
    } catch (e) {
      toastErr(e);
    }
  };
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
  const ta = $('#text');
  const syncComposer = () => {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(120, Math.max(24, ta.scrollHeight))}px`;
  };
  const sendText = async () => {
    const body = ta.value;
    if (!body.trim() || expired) return;
    try {
      const data = await api(`/api/groups/${c.id}/messages`, { method: 'POST', json: { body } });
      ta.value = '';
      syncComposer();
      c.window = data.window;
      addGroupChatMessage(data.message);
      box.innerHTML = renderThread(c.messages);
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      if (e.code === 'UPGRADE') {
        c.window = (e.data && e.data.window) || { expired: true, remainingMs: 0 };
        renderGroupChat();
      }
      toastErr(e);
    }
  };
  if (ta) {
    ta.oninput = syncComposer;
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    };
  }
  $('#send').onclick = sendText;
}

async function showHome(opts = {}) {
  state.view = 'home';
  const u = state.user;
  app.innerHTML = `
    <section class="screen home-screen">
      ${mastheadHtml()}
      <div class="screen-body">
      <div class="topbar">
        ${meBtnHtml()}
        <h2 id="home-title">${escapeHtml((u && u.username) || '')}</h2>
        <span class="pill-slot">${statusPill(u)}</span>
      </div>
      <div class="gender-filter" role="tablist" aria-label="${t('gender')}">
        <button type="button" class="gender-chip" role="tab" data-gender="all" aria-selected="${peopleGenderFilter() === 'all' ? 'true' : 'false'}">${t('filterAll')}</button>
        <button type="button" class="gender-chip" role="tab" data-gender="male" aria-selected="${peopleGenderFilter() === 'male' ? 'true' : 'false'}">${t('male')}</button>
        <button type="button" class="gender-chip" role="tab" data-gender="female" aria-selected="${peopleGenderFilter() === 'female' ? 'true' : 'false'}">${t('female')}</button>
      </div>
      <div id="ad-banner" class="ad-banner" hidden></div>
      <div id="user-list" class="user-list"></div>
      </div>
      ${nav('home')}
      <div id="upgrade-promo" class="upgrade-promo" hidden>
        <div class="upgrade-promo-card" role="dialog" aria-modal="true" aria-labelledby="upgrade-promo-title">
          <button type="button" class="upgrade-promo-x" id="upgrade-promo-x" aria-label="${t('close')}">${ICONS.close}</button>
          <p class="upgrade-promo-kicker">sakarwine</p>
          <p class="upgrade-promo-badge">50%</p>
          <h3 id="upgrade-promo-title">${t('upgradePromoTitle')}</h3>
          <p>${t('upgradePromoBody')}</p>
          <button type="button" class="btn block" id="upgrade-promo-go">${t('upgradePromoCta')}</button>
        </div>
      </div>
    </section>`;
  bindNav();
  bindMeButton();
  bindPaidRemain();
  document.querySelectorAll('.gender-chip').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.gender === 'male' || btn.dataset.gender === 'female' ? btn.dataset.gender : 'all';
      if (state.peopleGender === next) return;
      state.peopleGender = next;
      document.querySelectorAll('.gender-chip').forEach((chip) => {
        chip.setAttribute('aria-selected', chip.dataset.gender === next ? 'true' : 'false');
      });
      loadHome();
    };
  });
  startAdBanner();
  await loadHome();
  const startHomeTour = () => {
    if (!(opts.tour && !u.tourCompleted)) return;
    const ai = state.users.find((x) => x.isAi);
    Tour.start([
      { target: '#home-title', text: t('tourHome1'), arrow: 'down' },
      { target: '#user-list', text: t('tourHome2'), arrow: 'up' },
      {
        target: '#user-list .user-row',
        text: t('tourHome3'),
        arrow: 'down',
        before: () => {}
      }
    ]);
    if (opts.aiConversationId && ai) {
      setTimeout(() => openChat(ai.id, { fromTour: true }), 1600);
    }
  };
  const promo = $('#upgrade-promo');
  const promoHidden = (() => {
    try { return localStorage.getItem('sw_upgrade_promo') === '1'; } catch { return false; }
  })();
  const showPromo = promo && !u.isSpecial && (opts.afterRegister || !promoHidden);
  if (showPromo) {
    promo.hidden = false;
    promo.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const card = promo.querySelector('.upgrade-promo-card');
    if (card) {
      card.onclick = (e) => e.stopPropagation();
    }
    $('#upgrade-promo-x').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { localStorage.setItem('sw_upgrade_promo', '1'); } catch {}
      promo.hidden = true;
      startHomeTour();
    };
    $('#upgrade-promo-go').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showUpgrade();
    };
  } else {
    startHomeTour();
  }
}

function addChatMessage(message) {
  if (!state.chat || !message) return false;
  if (message.id != null && state.chat.messages.some((m) => m.id === message.id)) return false;
  state.chat.messages.push(message);
  return true;
}

function sameBubbleGroup(a, b) {
  if (!a || !b || !a.sender || !b.sender) return false;
  if (a.type === 'system' || b.type === 'system') return false;
  if (a.sender.id !== b.sender.id) return false;
  return Math.abs((Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)) < 120000;
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const loc = I18n.locale();
  const tstr = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return tstr;
  return `${d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })} · ${tstr}`;
}

function formatDateSep(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const loc = I18n.locale();
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'short' });
}

function shouldShowTime(prev, m) {
  if (!m || !m.createdAt) return false;
  if (!prev || !prev.createdAt) return true;
  return Math.abs((Number(m.createdAt) || 0) - (Number(prev.createdAt) || 0)) > 15 * 60 * 1000;
}

function stackClass(prev, m, next) {
  if (m.type === 'system' || !m.sender) return '';
  const withPrev = sameBubbleGroup(prev, m);
  const withNext = sameBubbleGroup(m, next);
  if (!withPrev && !withNext) return ' alone';
  if (!withPrev && withNext) return ' first';
  if (withPrev && withNext) return ' mid';
  return ' last';
}

function renderBubble(m, prev, next) {
  const mine = m.sender && state.user && m.sender.id === state.user.id;
  const media = m.type === 'image' || m.type === 'voice';
  const sys = m.type === 'system' || !m.sender;
  const cls = `bubble ${mine ? 'me' : 'them'}${m.sender && m.sender.isAi ? ' ai' : ''}${media ? ' media' : ''}${sys ? ' system' : ''}${stackClass(prev, m, next)}`;
  let inner = '';
  if (m.type === 'image' && m.imageLocked) {
    inner = `<div class="locked-photo" data-lock>${t('photosUnlock')}</div>`;
  } else if (m.type === 'image' && m.mediaUrl) {
    inner = `<img src="${m.mediaUrl}" alt="" />`;
  } else if (m.type === 'voice' && m.mediaUrl) {
    inner = `<audio controls src="${m.mediaUrl}"></audio>`;
  } else if (sys) {
    inner = `<span class="sys-note">${escapeHtml(chatBody(m.body))}</span>`;
  } else {
    const raw = m._showOrig && m.originalBody ? m.originalBody : (m.body || '');
    const shown = chatBody(raw);
    inner = `<span class="bubble-text">${escapeHtml(shown)}</span>`;
    if (m.translated && m.originalBody && m.originalBody !== m.body) {
      inner += `<button type="button" class="orig-toggle" data-mid="${m.id}">${m._showOrig ? t('showTranslation') : t('showOriginal')}</button>`;
    }
  }
  if (sys) return `<div class="${cls}" contenteditable="false">${inner}</div>`;
  const showAva = !mine && (!next || !sameBubbleGroup(m, next));
  const ava = mine
    ? ''
    : `<div class="bubble-ava ${showAva ? '' : 'is-empty'}">${showAva && m.sender ? avatarHtml(m.sender, 'round') : ''}</div>`;
  return `<div class="bubble-row ${mine ? 'me' : 'them'}">${ava}<div class="${cls}" contenteditable="false">${inner}</div></div>`;
}

function renderThread(messages) {
  const list = messages || [];
  let html = '';
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const prev = list[i - 1];
    const next = list[i + 1];
    if (shouldShowTime(prev, m)) {
      html += `<div class="chat-time">${escapeHtml(formatDateSep(m.createdAt))}</div>`;
    }
    html += renderBubble(m, prev, next);
  }
  return html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openChat(userId, opts = {}) {
  try {
    if (opts.from === 'chats' || (!opts.from && state.view === 'chats')) state.chatFrom = 'chats';
    else if (state.view !== 'chat') state.chatFrom = 'home';
    const opened = await api(`/api/conversations/with/${userId}`, { method: 'POST' });
    const full = await api(`/api/conversations/${opened.conversation.id}`);
    state.chat = {
      id: full.conversation.id,
      peer: full.conversation.peer,
      window: full.conversation.window,
      blocked: full.conversation.blocked,
      canDelete: full.conversation.canDelete,
      mutual: full.conversation.mutual,
      viewLang: full.conversation.viewLang,
      askViewLang: full.conversation.askViewLang,
      peerLang: full.conversation.peerLang,
      adminGate: full.conversation.adminGate || null,
      messages: full.messages
    };
    renderChat(opts);
  } catch (e) {
    const msg = I18n.error(e && e.message);
    if (e && e.status === 403 && /Admin account/i.test(String(e.message || ''))) {
      modal(`<h3 style="margin-top:0">${t('chatTitle')}</h3><p>${escapeHtml(msg)}</p><button class="btn block" id="m-ok">${t('close')}</button>`);
      const ok = $('#m-ok');
      if (ok) ok.onclick = closeModal;
      return;
    }
    toastErr(e);
  }
}

function stopChatPresence() {
  const id = state.presentingChatId;
  if (id) {
    if (state.socket) state.socket.emit('chat:leave', { conversationId: id });
    api(`/api/conversations/${id}/presence`, { method: 'POST', json: { action: 'leave' } }).catch(() => {});
    state.presentingChatId = null;
  }
}

function startChatPresence() {
  const id = state.chat && state.chat.id;
  if (!id) return;
  if (state.presentingChatId && state.presentingChatId !== id) stopChatPresence();
  state.presentingChatId = id;
  if (state.socket) state.socket.emit('chat:enter', { conversationId: id });
  api(`/api/conversations/${id}/presence`, { method: 'POST', json: { action: 'enter' } }).catch(() => {});
}

function formatRemain(ms, window) {
  if (window && window.hostVisitorChat) return t('unlimitedVisitor');
  if (window && window.special) return t('unlimited');
  if (ms == null) return t('unlimitedPaid');
  return '';
}

function remainingPaidParts(paidUntil, now = Date.now()) {
  const until = Number(paidUntil);
  const ms = until > now ? until - now : 0;
  return {
    ms,
    hours: Math.floor(ms / 3600000),
    minutes: Math.floor((ms % 3600000) / 60000),
    seconds: Math.floor((ms % 60000) / 1000)
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function paidCountdownLabel(paidUntil, now = Date.now()) {
  const parts = remainingPaidParts(paidUntil, now);
  if (!parts.ms) return '';
  return t('paidCountdown', { h: parts.hours, m: pad2(parts.minutes), s: pad2(parts.seconds) });
}

function freeCountdownLabel(freeUntil, now = Date.now()) {
  const parts = remainingPaidParts(freeUntil, now);
  if (!parts.ms) return '';
  return t('freeCountdown', { h: parts.hours, m: pad2(parts.minutes), s: pad2(parts.seconds) });
}

function paidStatusText(u, now = Date.now()) {
  if (u && u.isSpecial) return t('specialChat');
  const until = u && u.paidUntil;
  const label = paidCountdownLabel(until, now);
  if (label) return `${label} · ${t('paidUntil', { when: I18n.formatWhen(until) })}`;
  const freeLabel = freeCountdownLabel(u && u.freeUntil, now);
  if (freeLabel) return freeLabel;
  return t('notPaidYet');
}

function paidStatusHtml(u, now = Date.now()) {
  if (u && u.isSpecial) return escapeHtml(t('specialChat'));
  const until = u && u.paidUntil;
  const label = paidCountdownLabel(until, now);
  if (label) {
    return `<span class="paid-tick">${escapeHtml(label)}</span><span class="muted"> · ${escapeHtml(t('paidUntil', { when: I18n.formatWhen(until) }))}</span>`;
  }
  const freeLabel = freeCountdownLabel(u && u.freeUntil, now);
  if (freeLabel) return `<span class="paid-tick">${escapeHtml(freeLabel)}</span>`;
  return escapeHtml(t('notPaidYet'));
}

function paidPillText(paidUntil, now = Date.now()) {
  const lv = `<span class="badge-lv">${escapeHtml(t('lv', { n: (state.user && state.user.level) || 0 }))}</span>`;
  const label = paidCountdownLabel(paidUntil, now);
  return label ? `${escapeHtml(t('paid'))} · ${escapeHtml(label)} · ${lv}` : lv;
}

function tickPaidRemain(paidUntil, freeUntil) {
  if (state.paidTick) {
    clearInterval(state.paidTick);
    state.paidTick = null;
  }
  const paint = () => {
    const remainEl = $('#paid-remain');
    const pillEl = $('#paid-remain-pill');
    if (!remainEl && !pillEl) {
      if (state.paidTick) {
        clearInterval(state.paidTick);
        state.paidTick = null;
      }
      return;
    }
    const paidParts = remainingPaidParts(paidUntil);
    const freeParts = remainingPaidParts(freeUntil);
    if (remainEl) remainEl.innerHTML = paidStatusHtml({ paidUntil, freeUntil, isSpecial: false });
    if (pillEl) pillEl.innerHTML = paidPillText(paidUntil);
    if (state.user && !paidParts.ms) {
      state.user.paid = false;
      state.user.paidRemainingHours = 0;
    }
    if (!paidParts.ms && !freeParts.ms && state.paidTick) {
      clearInterval(state.paidTick);
      state.paidTick = null;
    }
  };
  paint();
  if (remainingPaidParts(paidUntil).ms || remainingPaidParts(freeUntil).ms) {
    state.paidTick = setInterval(paint, 1000);
  }
}

function promptChatLang(c, opts = {}) {
  if (!c) return;
  if (!opts.force && !c.askViewLang) return;
  if (!opts.force && c._askedViewLang) return;
  c._askedViewLang = true;
  const current = c.viewLang || I18n.lang;
  const choices = I18n.LANGS.map((l) =>
    `<button type="button" class="lang-choice ${l.code === current ? 'on' : ''}" data-lang="${l.code}">${l.native}</button>`
  ).join('');
  modal(`
    <h3 style="margin-top:0">${t('chooseChatLang')}</h3>
    <p class="small muted">${t('chatLangHint', { name: escapeHtml(c.peer.username) })}</p>
    <div class="lang-choices">${choices}</div>
    <button class="btn block" id="use-chat-lang">${t('useThisLang')}</button>`);
  let picked = current;
  modalEl.querySelectorAll('.lang-choice').forEach((btn) => {
    btn.onclick = () => {
      picked = btn.dataset.lang;
      modalEl.querySelectorAll('.lang-choice').forEach((b) => b.classList.toggle('on', b === btn));
    };
  });
  $('#use-chat-lang').onclick = async () => {
    try {
      const data = await api(`/api/conversations/${c.id}/view-lang`, { method: 'PUT', json: { lang: picked } });
      c.viewLang = data.viewLang;
      c.askViewLang = false;
      if (data.messages) c.messages = data.messages;
      closeModal();
      renderChat();
    } catch (e) {
      toastErr(e);
    }
  };
}

function renderChat(opts = {}) {
  state.view = 'chat';
  const c = state.chat;
  const expired = c.window.expired;
  const gate = c.adminGate || {};
  const gated = !expired && !c.peer.isAi && ((gate.waitForAdmin && !state.user.isAdmin) || (gate.closed && !state.user.isAdmin));
  const composerOff = expired || gated;
  const gateNote = gate.waitForAdmin && !state.user.isAdmin
    ? t('waitAdminFirst')
    : gate.closed && !state.user.isAdmin
      ? t('chatClosedByAdmin')
      : '';
  const presence = c.peer.online ? t('activeNow') : t('offline');
  const remain = formatRemain(c.window.remainingMs, c.window);
  const chatSub = remain ? `${presence} · ${remain}` : presence;
  app.innerHTML = `
    <section class="screen chat-screen">
      <div class="screen-body">
      <div class="topbar chat-head">
        <button class="chat-tool" id="back" aria-label="${t('back')}">${ICONS.back}</button>
        ${avatarHtml(c.peer)}
        <div class="meta">
          <div class="name">${t('chatTitle')} · ${escapeHtml(c.peer.username)} ${roleMark(c.peer)}</div>
          <div class="sub">${escapeHtml(chatSub)}</div>
        </div>
        <div class="chat-actions">
          <button class="chat-tool" id="chat-lang" title="${t('changeChatLang')}" aria-label="${t('changeChatLang')}">${ICONS.lang}</button>
          ${c.peer.isAi ? '' : `${c.peer.isAdmin || c.peer.blockable === false ? '' : `<button class="chat-tool" id="block" title="${t('blockBtn')}" aria-label="${t('blockBtn')}">${ICONS.block}</button>`}
          ${state.user.isAdmin && !c.peer.isAi ? `<button class="chat-tool" id="toggle-msg" title="${gate.messagingOpen === false ? t('reopenMessaging') : t('closeMessaging')}">${gate.messagingOpen === false ? t('reopenMessaging') : t('closeMessaging')}</button>` : ''}
          <button class="chat-tool" id="delete-chat" title="${t('deleteForMe')}" aria-label="${t('deleteForMe')}">${ICONS.trash}</button>`}
        </div>
      </div>
      ${expired ? `<div class="upgrade-banner">${t('upgradeEnded')}<br><button class="btn" id="go-up" style="margin-top:8px">${t('seePlans')}</button></div>` : ''}
      ${gateNote ? `<div class="upgrade-banner">${escapeHtml(gateNote)}</div>` : ''}
      <div id="messages" class="messages">${renderThread(c.messages)}</div>
      <div class="typing" id="typing"></div>
      </div>
      <div class="composer">
        <button class="composer-plus" id="plus-btn" aria-label="${t('photo')}" ${composerOff ? 'disabled' : ''}>+</button>
        <div class="plus-menu" id="plus-menu" hidden>
          <button type="button" id="img-btn">${t('photo')}</button>
          <button type="button" id="mic-btn">${t('voice')}</button>
        </div>
        <div class="composer-pill">
          <textarea id="text" rows="1" ${composerOff ? 'disabled' : ''} placeholder="${t('typeHere')}"></textarea>
        </div>
        <button class="chat-send" id="send" ${composerOff ? 'disabled' : ''} aria-label="${t('send')}">${ICONS.send}</button>
        <input id="img-file" class="hidden-file" type="file" accept="image/*" />
      </div>
    </section>`;
  $('#back').onclick = leaveChat;
  startChatPresence();
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
  box.onclick = (e) => {
    if (e.target.closest('[data-lock]')) {
      modal(`<h3 style="margin-top:0">${t('lockedPhoto')}</h3><p>${t('photosUnlockBody')}</p><button class="btn block" id="m-up">${t('navUpgrade')}</button>`);
      $('#m-up').onclick = () => { closeModal(); showUpgrade(); };
      return;
    }
    const tog = e.target.closest('.orig-toggle');
    if (tog) {
      const mid = Number(tog.dataset.mid);
      const msg = c.messages.find((m) => m.id === mid);
      if (!msg) return;
      msg._showOrig = !msg._showOrig;
      box.innerHTML = renderThread(c.messages);
    }
  };
  if ($('#chat-lang')) $('#chat-lang').onclick = () => promptChatLang(c, { force: true });
  if ($('#toggle-msg')) {
    $('#toggle-msg').onclick = async () => {
      try {
        const open = c.adminGate && c.adminGate.messagingOpen === false;
        const data = await api(`/api/conversations/${c.id}/messaging`, {
          method: 'POST',
          json: { open }
        });
        c.adminGate = data.adminGate;
        renderChat(opts);
      } catch (e) {
        toastErr(e);
      }
    };
  }
  if ($('#go-up')) $('#go-up').onclick = () => { stopChatPresence(); showUpgrade(); };
  if ($('#block')) $('#block').onclick = async () => {
    if (c.blocked) {
      await api(`/api/users/${c.peer.id}/block`, { method: 'DELETE' });
      toast(t('unblocked'));
      openChat(c.peer.id);
    } else {
      await api(`/api/users/${c.peer.id}/block`, { method: 'POST' });
      toast(t('blockedToast'));
      leaveChat();
    }
  };
  if ($('#delete-chat')) $('#delete-chat').onclick = () => {
    modal(`<h3 style="margin-top:0">${t('deleteChatTitle')}</h3>
      <p>${t('deleteChatBody', { name: escapeHtml(c.peer.username) })}</p>
      <button class="btn danger block" id="m-del">${t('deleteForMe')}</button>
      <button class="btn secondary block" id="m-cancel" style="margin-top:8px">${t('keepChat')}</button>`);
    $('#m-cancel').onclick = closeModal;
    $('#m-del').onclick = async () => {
      try {
        await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
        closeModal();
        toast(t('chatDeleted'));
        leaveChat();
      } catch (e) {
        toastErr(e);
      }
    };
  };
  let sending = false;
  const ta = $('#text');
  const syncComposer = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(120, Math.max(24, ta.scrollHeight))}px`;
  };
  const paintThread = () => {
    box.innerHTML = renderThread(c.messages);
    box.scrollTop = box.scrollHeight;
  };
  const sendText = async () => {
    const body = ta.value;
    if (sending || !body.trim()) return;
    sending = true;
    try {
      const data = await api(`/api/conversations/${c.id}/messages`, {
        method: 'POST',
        json: { type: 'text', body }
      });
      ta.value = '';
      syncComposer();
      c.window = data.window;
      if (data.adminGate) c.adminGate = data.adminGate;
      addChatMessage(data.message);
      paintThread();
    } catch (e) {
      if (e.data && e.data.adminGate) {
        c.adminGate = e.data.adminGate;
        renderChat();
      }
      if (e.code === 'UPGRADE') showUpgrade();
      toastErr(e);
    } finally {
      sending = false;
    }
  };
  $('#send').onclick = sendText;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });
  let typingT;
  ta.addEventListener('input', () => {
    syncComposer();
    if (state.socket) state.socket.emit('typing', { conversationId: c.id, typing: true });
    clearTimeout(typingT);
    typingT = setTimeout(() => state.socket && state.socket.emit('typing', { conversationId: c.id, typing: false }), 800);
  });
  syncComposer();
  const plusMenu = $('#plus-menu');
  $('#plus-btn').onclick = () => {
    plusMenu.hidden = !plusMenu.hidden;
  };
  $('#img-btn').onclick = () => {
    plusMenu.hidden = true;
    $('#img-file').click();
  };
  $('#img-file').onchange = async () => {
    const f = $('#img-file').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('type', 'image');
    fd.append('file', f);
    try {
      const data = await api(`/api/conversations/${c.id}/messages`, { method: 'POST', body: fd });
      addChatMessage(data.message);
      paintThread();
    } catch (e) {
      toastErr(e);
    }
  };
  let rec, chunks;
  $('#mic-btn').onclick = async () => {
    plusMenu.hidden = true;
    if (rec && rec.state === 'recording') {
      rec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        $('#mic-btn').classList.remove('live');
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const fd = new FormData();
        fd.append('type', 'voice');
        fd.append('file', blob, 'voice.webm');
        try {
          const data = await api(`/api/conversations/${c.id}/messages`, { method: 'POST', body: fd });
          addChatMessage(data.message);
          paintThread();
        } catch (e) {
          toastErr(e);
        }
      };
      rec.start();
      $('#mic-btn').classList.add('live');
      toast(t('recording'));
    } catch {
      toast(t('noMic'));
    }
  };
  if (c.askViewLang) promptChatLang(c);
  if (opts.fromTour) {
    setTimeout(() => {
      Tour.start([
        { target: '#text', text: t('tourChat1'), arrow: 'up' },
        { target: '#img-btn', text: t('tourChat2'), arrow: 'up' },
        { target: '#mic-btn', text: t('tourChat3'), arrow: 'up' }
      ]);
    }, 400);
  }
}

function money(n, c) {
  return `${Number(n).toLocaleString()} ${c}`;
}

async function showUpgrade() {
  state.view = 'upgrade';
  await refreshMe().catch(() => {});
  const pub = await api('/api/public-settings');
  state.settings = pub;
  const mine = await api('/api/upgrade/mine');
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <button type="button" class="icon-btn" id="up-back" aria-label="${t('backHome')}">${ICONS.back}</button>
        <h2>${t('upgradeTitle')}</h2>
        ${meBtnHtml()}
      </div>
      <div class="glass-card stack">
        ${state.user.isSpecial ? `
          <p>${t('specialUnlimited')}</p>
          <p class="small muted">${t('loungeBadge')} ${roleMark(state.user)}.</p>
        ` : `
        ${remainingPaidParts(state.user.paidUntil).ms ? `<p class="small" id="paid-remain">${paidStatusHtml(state.user)}</p>` : ''}
        <p class="small muted">${t('upgradeHelp')}</p>
        <div class="field"><label>${t('upgradeTargetId')}</label><input id="acc" value="${state.user.accountId}" autocomplete="off" /></div>
        <p class="small muted">${t('upgradeTargetHelp')}</p>
        <div class="field"><label>${t('hostCode')} <span class="muted">(${t('optional')})</span></label><input id="host-code" inputmode="numeric" maxlength="8" autocomplete="off" /></div>
        <p class="small muted">${t('hostCodeHelp')}</p>
        <div class="field"><label>${t('duration')}</label>
          <select id="months">${pub.quotes.map((q) => `<option value="${q.months}">${planLabel(q.months)}${q.discountPercent ? ` · ${t('planOff', { pct: q.discountPercent })}` : ''}</option>`).join('')}</select>
        </div>
        <div class="quote-card">
          <span id="q-label">${t('coverage')}</span>
          <strong id="q-amt"></strong>
        </div>
        <p class="small" id="q-detail"></p>
        <pre class="small muted" style="white-space:pre-wrap;font-family:inherit">${escapeHtml(pub.paymentInstructions)}</pre>
        <div class="field"><label>${t('paymentShot')}</label><input id="receipt" type="file" accept="image/*" /></div>
        <button class="btn block" id="submit-up">${t('submitApproval')}</button>
        <div class="small muted">${mine.upgrades.map((u) => `#${u.id} · ${planLabel(u.months)} · ${money(u.amount, u.currency)} · ${u.status}`).join('<br>') || t('noSubmissions')}</div>
        `}
      </div>
      </div>
      ${nav()}
    </section>`;
  bindNav();
  const upBack = $('#up-back');
  if (upBack) upBack.onclick = showHome;
  bindMeButton();
  bindPaidRemain();
  if (state.user.isSpecial) return;
  const paint = () => {
    const q = pub.quotes.find((x) => x.months === Number($('#months').value));
    $('#q-amt').textContent = money(q.amount, pub.currency);
    $('#q-detail').textContent = t('quoteDetail', {
      label: planLabel(q.months),
      gross: money(q.gross, pub.currency),
      save: q.discountPercent ? t('quoteSave', { pct: q.discountPercent }) : ''
    });
  };
  $('#months').onchange = paint;
  $('#months').value = '1';
  paint();
  $('#submit-up').onclick = async () => {
    const fd = new FormData();
    const targetId = $('#acc') && $('#acc').value.trim();
    if (!targetId) return toast(t('errAccountId'));
    fd.append('targetAccountId', targetId);
    fd.append('months', $('#months').value);
    const hostCode = $('#host-code').value.trim();
    if (hostCode && !/^\d{8}$/.test(hostCode)) return toast(t('errHostCode'));
    if (hostCode) fd.append('hostCode', hostCode);
    const file = $('#receipt').files[0];
    if (!file) return toast(t('addScreenshot'));
    fd.append('receipt', file);
    try {
      await api('/api/upgrade', { method: 'POST', body: fd });
      toast(t('submitted'));
      showUpgrade();
    } catch (e) {
      toastErr(e);
    }
  };
}

function hostStatusLine(u) {
  if (u.gender !== 'female') return '';
  if (u.isHost) return t('hostVerified');
  if (u.hostStatus === 'pending') return t('hostPending');
  if (u.hostStatus === 'rejected') return t('hostRejected');
  return t('hostNone');
}

function incomeDemoBlock() {
  const slots = [
    { key: 'apply', img: '/demo/host-demo-apply.png', src: '/uploads/host-demo-apply.mp4', title: t('hostDemoApply') },
    { key: 'code', img: '/demo/host-demo-code.png', src: '/uploads/host-demo-code.mp4', title: t('hostDemoCode') },
    { key: 'income', img: '/demo/host-demo-income.png', src: '/uploads/host-demo-income.mp4', title: t('hostDemoIncome') }
  ];
  return `
    <div class="income-demo">
      <h3>${t('howHostWorks')}</h3>
      <p>${t('hostIncomeHelp')}</p>
      <p class="host-earn">${t('hostIncomeExample')}</p>
      <div class="host-guide-videos">
        <div class="host-guide-kicker">${t('hostDemoTitle')}</div>
        <div class="host-guide-tabs" role="tablist" aria-label="${t('hostDemoTitle')}">
          ${slots.map((s, i) => `<button type="button" class="host-guide-tab" role="tab" data-guide-img="${escapeHtml(s.img)}" data-guide-src="${escapeHtml(s.src)}" data-guide-title="${escapeHtml(s.title)}" aria-selected="${i === 0 ? 'true' : 'false'}">${escapeHtml(s.title)}</button>`).join('')}
        </div>
        <div class="host-guide-stage">
          <img class="host-guide-img" id="host-guide-img" src="${escapeHtml(slots[0].img)}" alt="${escapeHtml(slots[0].title)}" />
          <video class="host-guide-video" id="host-guide-video" controls playsinline preload="metadata" hidden></video>
          <div class="host-guide-ph" id="host-guide-ph" hidden>
            <strong id="host-guide-ph-title">${escapeHtml(slots[0].title)}</strong>
            <span>${t('hostDemoPlaceholder')}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function bindHostGuideVideos() {
  const tabs = document.querySelectorAll('.host-guide-tab');
  const video = $('#host-guide-video');
  const img = $('#host-guide-img');
  const ph = $('#host-guide-ph');
  const phTitle = $('#host-guide-ph-title');
  if (!tabs.length || !ph) return;
  let gen = 0;
  const showImageOrPlaceholder = (imgSrc) => {
    if (video) video.hidden = true;
    if (imgSrc && img) {
      img.hidden = false;
      ph.hidden = true;
    } else {
      if (img) img.hidden = true;
      ph.hidden = false;
    }
  };
  const show = (tab) => {
    const my = ++gen;
    tabs.forEach((btn) => btn.setAttribute('aria-selected', btn === tab ? 'true' : 'false'));
    const title = tab.dataset.guideTitle || '';
    const src = tab.dataset.guideSrc || '';
    const imgSrc = tab.dataset.guideImg || '';
    if (phTitle) phTitle.textContent = title;
    if (img) {
      img.alt = title;
      img.onerror = () => {
        if (my !== gen) return;
        img.hidden = true;
        if (!video || video.hidden) ph.hidden = false;
      };
      img.onload = () => {
        if (my !== gen) return;
        if (video && !video.hidden) return;
        img.hidden = false;
        ph.hidden = true;
      };
      if (img.getAttribute('src') !== imgSrc) img.src = imgSrc;
      else if (img.complete && img.naturalWidth) {
        img.hidden = false;
        ph.hidden = true;
      }
    }
    showImageOrPlaceholder(imgSrc);
    if (!video) return;
    video.onloadeddata = null;
    video.onerror = null;
    video.hidden = true;
    video.removeAttribute('src');
    video.load();
    if (!src) return;
    video.onloadeddata = () => {
      if (my !== gen) return;
      if (img) img.hidden = true;
      ph.hidden = true;
      video.hidden = false;
    };
    video.onerror = () => {
      if (my !== gen) return;
      video.hidden = true;
      showImageOrPlaceholder(imgSrc);
    };
    video.src = src;
  };
  tabs.forEach((tab) => {
    tab.onclick = () => show(tab);
  });
  show(tabs[0]);
}

async function showProfile() {
  state.view = 'profile';
  await refreshMe().catch(() => {});
  if (state.view !== 'profile') return;
  const u = state.user;
  if (!u) return;
  const paidLine = u.isSpecial ? escapeHtml(t('specialChat')) : paidStatusHtml(u);
  const hostCard = u.gender === 'female' && u.isHost ? `
        <div class="glass-card stack" style="margin-top:12px;text-align:left">
          <h3 style="margin:0">${t('hostEarnings')}</h3>
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          ${u.hostCode ? `<p><span class="small muted">${t('hostCode')}</span><br><strong id="host-code-value">${escapeHtml(u.hostCode)}</strong></p>` : ''}
          <p><strong>${Number(u.hostBalance != null ? u.hostBalance : u.hostEarnings || 0).toLocaleString()} MMK</strong> ${t('available')}
            <span class="small muted"> · ${t('earned')} ${Number(u.hostEarnings || 0).toLocaleString()} · ${Number(u.hostCreditAmount || 500).toLocaleString()} × ${t('perVisitor')}</span></p>
          <p class="small muted">${t('hostRules')}</p>
          ${(u.hostIncomeLedger || []).length
            ? `<div class="ledger">${u.hostIncomeLedger.map((row) => `<div class="ledger-row">+${row.amount} · ${escapeHtml(row.partner.username)} · ${t('lv', { n: row.partner.level })} · ${I18n.formatWhen(row.createdAt)}</div>`).join('')}</div>`
            : `<p class="small muted">${t('noVisitors')}</p>`}
          <button class="btn ${u.canWithdraw ? '' : 'secondary'} block" id="withdraw" ${u.canWithdraw ? '' : 'disabled'}>${t('withdraw')}</button>
          ${!u.canWithdraw ? `<p class="small muted">${t('withdrawAt', { amount: Number(u.hostWithdrawMin || 100000).toLocaleString() })}</p>` : ''}
          ${(u.hostPayouts || []).length
            ? `<div class="ledger">${u.hostPayouts.map((p) => `<div class="ledger-row">${escapeHtml(I18n.statusLabel ? I18n.statusLabel(p.status) : p.status)} · −${p.amount} · ${p.method === 'kbz' ? t('kbz') : t('wave')} · ${escapeHtml(p.payeeName)}</div>`).join('')}</div>`
            : ''}
        </div>` : u.gender === 'female' ? `
        <div class="glass-card stack" style="margin-top:12px;text-align:left">
          <h3 style="margin:0">${t('applyHost')}</h3>
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          <p class="small muted">${t('hostApplyHelp')}</p>
          <button type="button" class="btn secondary block" id="go-host-apply">${t('hostApplyTitle')}</button>
        </div>` : '';
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <button type="button" class="icon-btn" id="me-back" aria-label="${t('backHome')}">${ICONS.back}</button>
        <h2>${t('you')}</h2>
        <button type="button" class="icon-btn" id="open-settings" aria-label="${t('settings')}">${ICONS.gear}</button>
      </div>
      <div class="glass-card stack center me-card">
        ${avatarHtml(u, 'round me-ava')}
        <div>
          <div class="me-name">${escapeHtml(u.username)}</div>
          <div class="muted">${escapeHtml(u.accountId || t('idHidden'))}</div>
        </div>
        <div class="small">${roleMark(u)} · ${genderLabel(u.gender)} · ${t('born', { year: u.birthYear })}<br><span id="paid-remain">${paidLine}</span></div>
        ${u.bio ? `<p class="profile-bio">${escapeHtml(u.bio)}</p>` : ''}
        <div class="me-actions">
          <button type="button" class="btn secondary" id="edit-profile">${t('editProfile')}</button>
          <button type="button" class="btn secondary" id="open-settings-row">${t('settings')}</button>
          ${u.isSpecial ? '' : `<button type="button" class="btn secondary" id="goto-upgrade">${t('navUpgrade')}</button>`}
        </div>
      </div>
      ${hostCard}
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  bindPaidRemain();
  const meBack = $('#me-back');
  if (meBack) meBack.onclick = showHome;
  $('#open-settings').onclick = showSettings;
  $('#open-settings-row').onclick = showSettings;
  $('#edit-profile').onclick = showEditProfile;
  if ($('#goto-upgrade')) $('#goto-upgrade').onclick = showUpgrade;
  if ($('#go-host-apply')) $('#go-host-apply').onclick = showHostApply;
  if ($('#withdraw') && !$('#withdraw').disabled) {
    $('#withdraw').onclick = () => {
      modal(`
        <h3 style="margin-top:0">${t('withdrawTitle', { amount: Number(u.hostBalance || 0).toLocaleString() })}</h3>
        <p class="small muted">${t('withdrawHint')}</p>
        <div class="field"><label>${t('wallet')}</label>
          <select id="wd-method"><option value="kbz">${t('kbz')}</option><option value="wave">${t('wave')}</option></select>
        </div>
        <div class="field"><label>${t('name')}</label><input id="wd-name" /></div>
        <div class="field"><label>${t('phone')}</label><input id="wd-phone" inputmode="tel" /></div>
        <button class="btn block" id="wd-go">${t('submitPayout')}</button>`);
      $('#wd-go').onclick = async () => {
        try {
          const data = await api('/api/me/withdraw', {
            method: 'POST',
            json: { method: $('#wd-method').value, name: $('#wd-name').value, phone: $('#wd-phone').value }
          });
          state.user = data.user;
          closeModal();
          toast(t('payoutSubmitted'));
          showProfile();
        } catch (e) {
          toastErr(e);
        }
      };
    };
  }
}

async function doLogout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* still leave the lounge */
  }
  state.user = null;
  if (state.socket) state.socket.disconnect();
  showWelcome();
}

function settingsRow(id, icon, label, extra = '') {
  return `
    <button type="button" class="settings-row" id="${id}">
      <span class="settings-ico">${icon}</span>
      <span class="settings-label">${label}</span>
      ${extra || `<span class="settings-chev" aria-hidden="true">${ICONS.chevron}</span>`}
    </button>`;
}

function showHostApply() {
  state.view = 'host-apply';
  const u = state.user;
  if (!u || u.gender !== 'female') return showSettings();
  const canApply = u.hostStatus === 'none' || u.hostStatus === 'rejected';
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${t('hostApplyTitle')}</h2>
        </div>
        <div class="glass-card stack" style="text-align:left">
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          <p class="small muted">${t('hostApplyHelp')}</p>
          ${u.hostCode ? `<p><span class="small muted">${t('hostCode')}</span><br><strong>${escapeHtml(u.hostCode)}</strong></p>` : ''}
          ${incomeDemoBlock()}
          ${u.hostStatus === 'pending' ? `<p class="small muted">${t('hostPending')}</p>` : ''}
          ${canApply ? `
          <h3>${t('idDocTitle')}</h3>
          <div class="id-doc-filter" role="tablist" aria-label="${t('idDocTitle')}">
            <button type="button" class="id-doc-chip" role="tab" data-id-type="nrc" aria-selected="true">${t('idDocNrc')}</button>
            <button type="button" class="id-doc-chip" role="tab" data-id-type="passport" aria-selected="false">${t('idDocPassport')}</button>
          </div>
          <p class="small muted" id="id-doc-note">${t('idDocNrcHelp')}</p>
          <div class="id-doc-photos" id="id-doc-photos">
            <label class="photo-pick">
              <input class="hidden-file" id="nrc-front" type="file" accept="image/*" />
              <div id="nrc-front-preview" class="avatar ai">🪪</div>
              <span class="small muted" id="id-doc-front-label">${t('nrcFront')}</span>
            </label>
            <label class="photo-pick" id="id-doc-back">
              <input class="hidden-file" id="nrc-back" type="file" accept="image/*" />
              <div id="nrc-back-preview" class="avatar ai">🪪</div>
              <span class="small muted">${t('nrcBack')}</span>
            </label>
          </div>
          <button class="btn block" id="host-apply-send">${t('hostApplySend')}</button>` : ''}
        </div>
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#back').onclick = showSettings;
  bindHostGuideVideos();
  const bindPreview = (id, previewId) => {
    const input = $(`#${id}`);
    if (!input) return;
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      $(`#${previewId}`).outerHTML = `<img id="${previewId}" class="avatar" src="${url}" alt="" />`;
    };
  };
  bindPreview('nrc-front', 'nrc-front-preview');
  bindPreview('nrc-back', 'nrc-back-preview');
  const syncIdDocUi = () => {
    const selected = document.querySelector('.id-doc-chip[aria-selected="true"]');
    const type = selected && selected.dataset.idType === 'passport' ? 'passport' : 'nrc';
    const backWrap = $('#id-doc-back');
    const photos = $('#id-doc-photos');
    const note = $('#id-doc-note');
    const frontLabel = $('#id-doc-front-label');
    if (backWrap) backWrap.hidden = type === 'passport';
    if (photos) photos.classList.toggle('is-passport', type === 'passport');
    if (note) note.textContent = type === 'passport' ? t('idDocPassportHelp') : t('idDocNrcHelp');
    if (frontLabel) frontLabel.textContent = type === 'passport' ? t('passportFront') : t('nrcFront');
    return type;
  };
  document.querySelectorAll('.id-doc-chip').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.id-doc-chip').forEach((chip) => {
        chip.setAttribute('aria-selected', chip === btn ? 'true' : 'false');
      });
      syncIdDocUi();
    };
  });
  syncIdDocUi();
  if ($('#host-apply-send')) {
    $('#host-apply-send').onclick = async () => {
      const idType = syncIdDocUi();
      const front = $('#nrc-front') && $('#nrc-front').files[0];
      const back = $('#nrc-back') && $('#nrc-back').files[0];
      if (idType === 'passport') {
        if (!front) return toast(t('uploadPassportFront'));
      } else if (!front || !back) {
        return toast(t('uploadNrcBoth'));
      }
      const fd = new FormData();
      fd.append('idType', idType);
      fd.append('nrcFront', front);
      if (idType === 'nrc') fd.append('nrcBack', back);
      try {
        const data = await api('/api/me/host-apply', { method: 'POST', body: fd });
        state.user = data.user;
        toast(t('hostApplySent'));
        showHostApply();
      } catch (e) {
        toastErr(e);
      }
    };
  }
}

function showSettings() {
  state.view = 'settings';
  const contact = String((state.settings && state.settings.adminContact) || '').trim();
  const defaultContact = 'Message the sakarwine admin with the phone number you used at registration. There is no self-serve password reset.';
  const extraContact = contact && contact !== defaultContact
    ? `<p class="small muted">${escapeHtml(contact)}</p>`
    : '';
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${t('settingsTitle')}</h2>
        </div>
        <div class="settings-flow">
        <div class="settings-list settings-lang">
          ${I18n.switcherHtml('lang-switch')}
        </div>
        <div class="settings-list settings-lang">
          <label class="lang-switch">
            <span>${t('chatViewLang')}</span>
            <select id="chat-view-lang" aria-label="${t('chatViewLang')}">
              <option value="ask" ${state.user && state.user.chatViewLang ? '' : 'selected'}>${t('askEachChat')}</option>
              ${I18n.LANGS.map((l) => `<option value="${l.code}" ${state.user && state.user.chatViewLang === l.code ? 'selected' : ''}>${l.native}</option>`).join('')}
            </select>
          </label>
          <p class="muted settings-lang-help">${t('chatViewLangHelp')}</p>
        </div>
        <div class="settings-list">
          ${settingsRow('go-edit', ICONS.me, t('editProfile'))}
          ${settingsRow('go-pin', ICONS.gem, t('changePin'))}
          ${settingsRow('go-blocked', ICONS.block, t('blockedList'))}
          ${state.user && state.user.gender === 'female' ? settingsRow('go-host', ICONS.gem, t('applyHost')) : ''}
        </div>
        <div class="settings-list settings-note-card">
          <div class="settings-note">
            <div class="settings-note-title">${t('pinNoteTitle')}</div>
            <p>${t('pinNoteBody')}</p>
            ${extraContact}
          </div>
        </div>
        <div class="settings-list">
          <button type="button" class="settings-row danger" id="logout">
            <span class="settings-label">${t('logOut')}</span>
          </button>
        </div>
        </div>
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#back').onclick = showProfile;
  $('#go-edit').onclick = showEditProfile;
  $('#go-pin').onclick = showChangePin;
  $('#go-blocked').onclick = showBlocked;
  if ($('#go-host')) $('#go-host').onclick = showHostApply;
  $('#logout').onclick = doLogout;
  I18n.bindSwitcher('lang-switch');
  const viewSel = $('#chat-view-lang');
  if (viewSel) {
    viewSel.onchange = async () => {
      try {
        const data = await api('/api/me/lang', { method: 'PUT', json: { chatViewLang: viewSel.value } });
        state.user = data.user;
      } catch (e) {
        toastErr(e);
      }
    };
  }
}

function showChangePin() {
  state.view = 'change-pin';
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${t('changePin')}</h2>
        </div>
        <div class="glass-card stack" style="text-align:left">
          <p class="small muted">${t('changePinHelp')}</p>
          <form id="pin-change-form" class="stack">
            <div class="field"><label for="pin-cur">${t('currentPin')}</label><input id="pin-cur" class="pin-digits" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="current-password" required /></div>
            <div class="field"><label for="pin-new">${t('newPin')}</label><input id="pin-new" class="pin-digits" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="new-password" required /></div>
            <div class="field"><label for="pin-confirm">${t('confirmPin')}</label><input id="pin-confirm" class="pin-digits" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="new-password" required /></div>
            <button type="submit" class="btn block" id="pin-save">${t('changePin')}</button>
          </form>
        </div>
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#back').onclick = showSettings;
  document.querySelectorAll('.pin-digits').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0, 6);
    });
  });
  $('#pin-change-form').onsubmit = async (e) => {
    e.preventDefault();
    const currentPin = $('#pin-cur').value.trim();
    const newPin = $('#pin-new').value.trim();
    const confirmPin = $('#pin-confirm').value.trim();
    if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin) || !/^\d{6}$/.test(confirmPin)) {
      return toast(t('errPin'));
    }
    if (newPin !== confirmPin) return toast(t('errPinMismatch'));
    if (newPin === currentPin) return toast(t('errPinSame'));
    const btn = $('#pin-save');
    btn.disabled = true;
    try {
      await api('/api/me/pin', { method: 'POST', json: { currentPin, newPin, confirmPin } });
      toast(t('pinChanged'));
      showSettings();
    } catch (err) {
      toastErr(err);
    } finally {
      btn.disabled = false;
    }
  };
}

function showEditProfile() {
  state.view = 'edit-profile';
  const u = state.user;
  const photo = avatarHtml(u, 'round me-ava').replace('<img ', '<img id="edit-preview" ');
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${t('editProfile')}</h2>
          <button type="button" class="btn ghost" id="save-profile">${t('done')}</button>
        </div>
        <div class="glass-card stack center">
          <label class="edit-photo">
            <input class="hidden-file" id="edit-photo" type="file" accept="image/*" />
            ${photo}
            <span class="edit-photo-change">${t('changePhoto')}</span>
          </label>
          <div class="field" style="width:100%;text-align:left">
            <label for="edit-username">${t('username')}</label>
            <input id="edit-username" value="${escapeHtml(u.username)}" required minlength="1" maxlength="12" autocomplete="username" spellcheck="false" autocapitalize="none" pattern="${USERNAME_CHAR_CLASS}{1,12}" title="${t('errUsername')}" />
          </div>
          <p class="small muted" style="text-align:left;margin:0">${t('usernameHelp')}</p>
          <div class="field" style="width:100%;text-align:left">
            <label for="edit-bio">${t('bio')}</label>
            <textarea id="edit-bio" maxlength="280" rows="4" placeholder="${escapeHtml(t('bioPlaceholder'))}">${escapeHtml(u.bio || '')}</textarea>
          </div>
          <p class="small muted" style="text-align:left;margin:0">${t('bioHelp')}</p>
        </div>
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#back').onclick = showSettings;
  $('#edit-photo').onchange = () => {
    const file = $('#edit-photo').files[0];
    const preview = $('#edit-preview');
    if (!file || !preview) return;
    const url = URL.createObjectURL(file);
    if (preview.tagName === 'IMG') {
      preview.src = url;
    } else {
      const img = document.createElement('img');
      img.className = 'avatar round me-ava';
      img.id = 'edit-preview';
      img.alt = '';
      img.src = url;
      preview.replaceWith(img);
    }
  };
  const save = async () => {
    const btn = $('#save-profile');
    btn.disabled = true;
    const fd = new FormData();
    fd.append('username', $('#edit-username').value.trim());
    fd.append('bio', ($('#edit-bio') && $('#edit-bio').value) || '');
    if (!usernamePatternOk($('#edit-username').value.trim())) {
      toast(t('errUsername'));
      btn.disabled = false;
      return;
    }
    const file = $('#edit-photo').files[0];
    if (file) fd.append('photo', file);
    try {
      const data = await api('/api/me/profile', { method: 'PUT', body: fd });
      state.user = data.user;
      toast(t('profileUpdated'));
      showSettings();
    } catch (e) {
      btn.disabled = false;
      toastErr(e);
    }
  };
  $('#save-profile').onclick = save;
}

async function showBlocked() {
  state.view = 'blocked';
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="${t('back')}">${ICONS.back}</button>
          <h2>${t('blockedList')}</h2>
        </div>
        <p class="muted small" style="margin-top:0">${t('blockedHelp')}</p>
        <div id="blocked-list" class="blocked-list"><p class="muted">${t('loading')}</p></div>
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#back').onclick = showSettings;
  try {
    const data = await api('/api/me/blocked');
    const box = $('#blocked-list');
    if (!data.users.length) {
      box.innerHTML = `<div class="settings-empty">${t('notBlocking')}</div>`;
      return;
    }
    box.innerHTML = data.users.map((u) => `
      <div class="user-row blocked-row" data-id="${u.id}">
        ${avatarHtml(u, 'round')}
        <div class="meta">
          <div class="name">${escapeHtml(u.username)}</div>
          <div class="sub">${u.online ? t('onlineNow') : t('offline')} · ${escapeHtml(genderLabel(u.gender))}</div>
        </div>
        <button type="button" class="btn secondary unblock" data-unblock="${u.id}">${t('unblock')}</button>
      </div>`).join('');
    box.querySelectorAll('[data-unblock]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/users/${btn.dataset.unblock}/block`, { method: 'DELETE' });
          toast(t('unblocked'));
          showBlocked();
        } catch (err) {
          toastErr(err);
        }
      };
    });
  } catch (e) {
    toastErr(e);
    const box = $('#blocked-list');
    if (box) box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function goHelpHome() {
  if (state.user) showHome();
  else showWelcome();
}

function showHelp(inApp = false) {
  state.view = 'help';
  const prefillId = (state.user && state.user.accountId) || '';
  app.innerHTML = `
    <section class="screen">
      ${inApp ? '<div class="screen-body">' : ''}
      <div class="topbar">
        <button type="button" class="back-home-btn" id="back-home">
          ${ICONS.back}
          <span>${t('backHome')}</span>
        </button>
        <h2>${t('helpTitle')}</h2>
        ${inApp ? meBtnHtml() : ''}
      </div>
      <div class="glass-card">
        <h3 style="margin-top:0">${t('pinRecovery')}</h3>
        <p>${t('pinRecoveryBody')}</p>
        <form id="pin-recovery-form" class="help-form stack">
          <div class="field">
            <label for="pin-aid">${t('pinRecoveryAccountId')}</label>
            <input id="pin-aid" name="accountId" required autocomplete="username" value="${escapeHtml(prefillId)}" />
          </div>
          <div class="field">
            <label for="pin-phone">${t('pinRecoveryPhone')}</label>
            <input id="pin-phone" name="phone" required inputmode="tel" autocomplete="tel" />
          </div>
          <button type="submit" class="btn block" id="pin-send">${t('pinRecoverySend')}</button>
          <p id="pin-ok" class="help-ok" hidden>${t('pinRecoverySent')}</p>
        </form>
      </div>
      ${inApp ? `</div>${nav('help')}` : ''}
    </section>`;
  $('#back-home').onclick = goHelpHome;
  const form = $('#pin-recovery-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const accountId = $('#pin-aid').value.trim();
    const phone = $('#pin-phone').value.trim();
    if (!accountId) return toast(t('errAccountId'));
    if (!/^[0-9+\s\-()]{7,20}$/.test(phone)) return toast(t('errPhone'));
    const btn = $('#pin-send');
    btn.disabled = true;
    try {
      await api('/api/pin-recovery', { method: 'POST', json: { accountId, phone } });
      form.reset();
      if (prefillId) $('#pin-aid').value = prefillId;
      $('#pin-ok').hidden = false;
      toast(t('pinRecoverySent'));
    } catch (err) {
      toastErr(err);
    } finally {
      btn.disabled = false;
    }
  };
  if (inApp) {
    bindNav();
    bindMeButton();
  }
}

boot().catch((e) => toastErr(e));
