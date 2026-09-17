'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const toastEl = $('#toast');
const modalEl = $('#modal');

const state = {
  user: null,
  settings: null,
  users: [],
  socket: null,
  view: 'welcome',
  chat: null,
  typing: false
};

const ICONS = {
  wine: `<svg viewBox="0 0 48 48" fill="none"><path d="M16 8h16l-2 16a8 8 0 1 1-12 0L16 8z" fill="#f3d0c4" opacity=".95"/><path d="M22 32v8h-4v2h12v-2h-4v-8" stroke="#f7e7d2" stroke-width="2"/><path d="M18 14h12" stroke="#8b2252" stroke-width="2" opacity=".5"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 19c1-3 3.5-5 6-5s5 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 19c.4-1.6 1.6-3 3.4-3.6"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6h14v9H8l-3 3V6z"/></svg>`,
  bubble: `<svg viewBox="0 0 48 48" fill="none"><rect x="8" y="10" width="32" height="22" rx="8" fill="#fff"/><path d="M18 32l-6 8 2-8h4z" fill="#fff"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l16-8-6 16-2-6-8-2z"/></svg>`,
  gem: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l8-6 8 6-8 10L4 10z"/><path d="M4 10h16M12 4v16"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3.2 3.8-5 7-5s5.6 1.8 7 5"/></svg>`,
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
  return g || '';
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
  else if (v === 'chat' && state.chat) renderChat();
  else if (v === 'upgrade') showUpgrade();
  else if (v === 'profile') showProfile();
  else if (v === 'settings') showSettings();
  else if (v === 'edit-profile') showEditProfile();
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
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.code = data.code;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
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
    const photo = u.photoUrl
      ? `<img class="profile-lite-photo" src="${escapeHtml(u.photoUrl)}" alt="${escapeHtml(u.username)}" />`
      : avatarHtml(u, 'profile-lite-photo');
    modal(`
      <div class="profile-lite">
        ${photo}
        <h3 style="margin:12px 0 4px">${escapeHtml(u.username)}</h3>
        <p class="profile-id">${escapeHtml(u.accountId || '—')}</p>
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
  return `<span class="pill">${user && user.paid ? t('paid') : t('free24h')} · ${t('lv', { n: user.level })}</span>`;
}

function petals() {}

function syncLang(code) {
  if (!state.user) return;
  api('/api/me/lang', { method: 'PUT', json: { lang: code || I18n.lang } }).catch(() => {});
}

function usernamePatternOk(value) {
  return /^(?:[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]){1,12}$/.test(String(value || '').trim());
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  const socket = io({ transports: ['websocket', 'polling'] });
  state.socket = socket;
  socket.on('message', ({ conversationId, message }) => {
    if (state.chat && state.chat.id === conversationId) {
      addChatMessage(message);
      const box = $('#messages');
      if (box) {
        box.innerHTML = renderThread(state.chat.messages);
        box.scrollTop = box.scrollHeight;
      }
    } else if (!message.sender) {
      toast(message.body || t('newSystem'));
    } else if (message.sender && message.sender.id !== state.user.id) {
      toast(t('newMessageFrom', { name: message.sender.username }));
    }
  });
  socket.on('presence', () => {
    if (state.view === 'home') loadHome();
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
    toast(t('hostCreditFrom', { amount: payload.amount, name: payload.partnerUsername }));
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
    if (state.chat) {
      state.chat.mutual = state.chat.mutual || {};
      state.chat.mutual.credited = true;
      const el = $('#host-earn');
      if (el) el.outerHTML = hostCreditBanner(state.chat);
    }
  });
  socket.on('chat:mutual', ({ conversationId, mutual }) => {
    if (state.chat && state.chat.id === conversationId && mutual) {
      state.chat.mutual = mutual;
      const el = $('#host-earn');
      if (el) el.outerHTML = hostCreditBanner(state.chat);
    }
  });
  socket.on('payout:done', () => {
    toast(t('payoutDone'));
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
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
  state.settings = await api('/api/public-settings');
  document.title = state.settings.siteName;
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
  const name = escapeHtml(state.settings.siteName || 'sakarwine');
  app.innerHTML = `
    <section class="screen welcome-screen">
      <div class="welcome-hero">
        <img class="brand-logo" src="/assets/sakarwine-logo.png" alt="${name}" />
        <h1>${name}</h1>
        <div class="hero-mark">${ICONS.bubble}</div>
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
  $('#goto-help').onclick = showHelp;
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
        <div class="field"><label>${t('username')}</label><input name="username" required minlength="1" maxlength="12" /></div>
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
        <div id="female-extra">
          <h3>${t('income')}</h3>
          <p class="small muted">${t('incomeFemaleNote')}</p>
          <div class="field"><label>${t('occupation')}</label><input name="occupation" minlength="2" maxlength="80" /></div>
          <div class="row-2">
            <div class="field"><label>${t('monthlyIncome')}</label><input name="monthlyIncome" inputmode="numeric" /></div>
            <div class="field"><label>${t('incomeSource')}</label>
              <select name="incomeSource">
                <option value="salary">${t('salary')}</option>
                <option value="business">${t('business')}</option>
                <option value="family">${t('family')}</option>
                <option value="other">${t('other')}</option>
              </select>
            </div>
          </div>
          <h3>${t('nrcTitle')}</h3>
          <p class="small muted">${t('nrcNote')}</p>
          <div class="row-2">
            <label class="photo-pick">
              <input class="hidden-file" type="file" name="nrcFront" accept="image/*" />
              <div id="nrc-front-preview" class="avatar ai">🪪</div>
              <span class="small muted">${t('nrcFront')}</span>
            </label>
            <label class="photo-pick">
              <input class="hidden-file" type="file" name="nrcBack" accept="image/*" />
              <div id="nrc-back-preview" class="avatar ai">🪪</div>
              <span class="small muted">${t('nrcBack')}</span>
            </label>
          </div>
        </div>
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
  const bindNrcPreview = (name, previewId) => {
    const input = $(`input[name=${name}]`);
    if (!input) return;
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      $(`#${previewId}`).outerHTML = `<img id="${previewId}" class="avatar" src="${url}" alt="" />`;
    };
  };
  bindNrcPreview('nrcFront', 'nrc-front-preview');
  bindNrcPreview('nrcBack', 'nrc-back-preview');
  const genderSel = $('select[name=gender]');
  const extra = $('#female-extra');
  const syncFemale = () => {
    const female = genderSel.value === 'female';
    extra.hidden = !female;
    extra.querySelectorAll('input, select').forEach((el) => {
      if (el.name === 'occupation' || el.name === 'monthlyIncome' || el.name === 'incomeSource' || el.name === 'nrcFront' || el.name === 'nrcBack') {
        el.required = female;
      }
    });
  };
  genderSel.onchange = syncFemale;
  syncFemale();
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
        <p class="small muted">${t('estimatedGender')}: <strong>${result.estimatedGender}</strong> (${match} ${t('yourProfile')}).</p>
        <button class="btn block" id="go-in">${t('meetSaka')}</button>`);
      $('#go-in').onclick = () => {
        closeModal();
        connectSocket();
        showHome({ tour: true, aiConversationId: data.aiConversationId });
      };
    } catch (err) {
      $('#start-scan').disabled = false;
      toast(err.message || t('scanFailed'));
    }
  };
}

function nav(active) {
  return `
    <nav class="nav">
      <button data-go="home" class="${active === 'home' ? 'active' : ''}"><span class="icon-btn">${ICONS.people}</span>${t('navPeople')}</button>
      <button data-go="upgrade" class="${active === 'upgrade' ? 'active' : ''}"><span class="icon-btn">${ICONS.gem}</span>${t('navUpgrade')}</button>
      <button data-go="profile" class="${active === 'profile' ? 'active' : ''}"><span class="icon-btn">${ICONS.me}</span>${t('navMe')}</button>
      <button data-go="help" class="${active === 'help' ? 'active' : ''}"><span class="icon-btn">${ICONS.chat}</span>${t('navHelp')}</button>
    </nav>`;
}

function bindNav() {
  document.querySelectorAll('.nav [data-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === 'home') showHome();
      if (go === 'upgrade') showUpgrade();
      if (go === 'profile') showProfile();
      if (go === 'help') showHelp(true);
    };
  });
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
        box.innerHTML = `<img src="${ad.imageUrl}" alt="ad" />`;
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

async function loadHome() {
  const { users } = await api('/api/users');
  state.users = users;
  paintHomeList();
}

function paintHomeList() {
  const list = $('#user-list');
  if (!list) return;
  const q = (($('#people-search') && $('#people-search').value) || '').trim().toLowerCase();
  const users = (state.users || []).filter((u) => {
    if (!q) return true;
    const hay = `${u.username} ${u.accountId || ''} ${u.badge || ''}`.toLowerCase();
    return hay.includes(q);
  });
  list.innerHTML = users.map((u) => `
    <div class="user-row" data-id="${u.id}">
      ${avatarHtml(u)}
      <div class="meta">
        <div class="name">${escapeHtml(u.username)} ${u.isAi ? '· ' + t('guide') : ''} ${roleMark(u)}</div>
        <div class="sub">${u.online ? t('onlineNow') : t('offline')} · ${genderLabel(u.gender)}${u.blocked ? ' · ' + t('blocked') : ''}</div>
      </div>
      <span class="when">${u.online ? t('onlineNow') : ''}</span>
    </div>`).join('') || `<p class="settings-empty">${t('loading')}</p>`;
  list.querySelectorAll('.user-row').forEach((row) => {
    row.onclick = () => openChat(Number(row.dataset.id));
  });
}

async function showHome(opts = {}) {
  state.view = 'home';
  const u = state.user;
  app.innerHTML = `
    <section class="screen home-screen">
      <div class="screen-body">
      <div class="topbar">
        <div>
          <img class="brand-logo" src="/assets/sakarwine-logo.png" alt="${escapeHtml(state.settings.siteName)}" style="width:148px;margin:0 0 4px" />
          <h2 id="home-title">${t('contactsTitle')}</h2>
        </div>
        <span class="pill-slot">${statusPill(u)}</span>
      </div>
      <label class="search-bar">
        ${ICONS.search}
        <input id="people-search" type="search" placeholder="${t('searchPeople')}" autocomplete="off" />
      </label>
      <div id="ad-banner" class="ad-banner" hidden></div>
      <div id="user-list" class="user-list"></div>
      </div>
      <button type="button" class="fab" id="home-fab" aria-label="${t('searchPeople')}">${ICONS.plus}</button>
      ${nav('home')}
    </section>`;
  bindNav();
  const search = $('#people-search');
  if (search) search.addEventListener('input', paintHomeList);
  const fab = $('#home-fab');
  if (fab) fab.onclick = () => {
    if (search) {
      search.focus();
      search.scrollIntoView({ block: 'nearest' });
    }
  };
  startAdBanner();
  await loadHome();
  if (opts.tour && !u.tourCompleted) {
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
    inner = `<span class="sys-note">${escapeHtml(m.body || '')}</span>`;
  } else {
    const shown = m._showOrig && m.originalBody ? m.originalBody : (m.body || '');
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
      messages: full.messages
    };
    renderChat(opts);
  } catch (e) {
    toastErr(e);
  }
}

function formatChatMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 60000) return `${Math.round(n / 1000)}s`;
  const m = Math.floor(n / 60000);
  const s = Math.floor((n % 60000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function hostCreditBanner(c) {
  const m = c.mutual;
  if (!m || !state.user || !state.user.isHost || c.peer.isAi) return '';
  if (m.credited) {
    return `<div class="host-earn" id="host-earn">${t('hostCredited', { amount: m.creditAmount })}</div>`;
  }
  if (m.hostOpened) {
    return `<div class="host-earn dim" id="host-earn">${t('hostNoEarn')}</div>`;
  }
  if (!m.partnerQualifies) {
    return `<div class="host-earn dim" id="host-earn">${t('hostNeedLv1')}</div>`;
  }
  if (m.voided) {
    return `<div class="host-earn dim" id="host-earn">${t('hostVoided')}</div>`;
  }
  return `<div class="host-earn" id="host-earn">${t('hostProgress', { have: formatChatMs(m.streakMs || m.totalMs), need: formatChatMs(m.neededMs), amount: m.creditAmount })}</div>`;
}

function stopChatPresence() {
  if (state.chatPing) {
    clearInterval(state.chatPing);
    state.chatPing = null;
  }
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
  api(`/api/conversations/${id}/presence`, { method: 'POST', json: { action: 'enter' } })
    .then((data) => {
      if (data.mutual && state.chat && state.chat.id === id) {
        state.chat.mutual = data.mutual;
        const el = $('#host-earn');
        if (el) el.outerHTML = hostCreditBanner(state.chat);
      }
    })
    .catch(() => {});
  if (state.chatPing) clearInterval(state.chatPing);
  state.chatPing = setInterval(() => {
    if (!state.chat || state.chat.id !== id) return;
    if (state.socket) state.socket.emit('chat:ping', { conversationId: id });
    api(`/api/conversations/${id}/presence`, { method: 'POST', json: { action: 'ping' } })
      .then((data) => {
        if (data.mutual && state.chat && state.chat.id === id) {
          state.chat.mutual = data.mutual;
          const el = $('#host-earn');
          if (el) el.outerHTML = hostCreditBanner(state.chat);
        }
      })
      .catch(() => {});
  }, 5000);
}

function formatRemain(ms, window) {
  if (window && window.hostVisitorChat) return t('unlimitedVisitor');
  if (window && window.special) return t('unlimited');
  if (ms == null) return t('unlimitedPaid');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return t('freeLeft', { h, m });
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
  app.innerHTML = `
    <section class="screen chat-screen">
      <div class="screen-body">
      <div class="topbar chat-head">
        <button class="chat-tool" id="back" aria-label="${t('back')}">${ICONS.back}</button>
        <div class="meta">
          <div class="name">${t('chatTitle')} · ${escapeHtml(c.peer.username)} ${roleMark(c.peer)}</div>
          <div class="sub">${c.peer.online ? t('activeNow') : t('offline')} · ${formatRemain(c.window.remainingMs, c.window)}</div>
        </div>
        <div class="chat-actions">
          <button class="chat-tool" id="chat-lang" title="${t('changeChatLang')}" aria-label="${t('changeChatLang')}">${ICONS.lang}</button>
          ${c.peer.isAi ? '' : `${c.peer.isAdmin || c.peer.blockable === false ? '' : `<button class="chat-tool" id="block" title="${t('blockBtn')}" aria-label="${t('blockBtn')}">${ICONS.block}</button>`}
          <button class="chat-tool" id="delete-chat" title="${t('deleteForMe')}" aria-label="${t('deleteForMe')}">${ICONS.trash}</button>`}
        </div>
      </div>
      ${expired ? `<div class="upgrade-banner">${t('upgradeEnded')}<br><button class="btn" id="go-up" style="margin-top:8px">${t('seePlans')}</button></div>` : ''}
      ${hostCreditBanner(c)}
      <div id="messages" class="messages">${renderThread(c.messages)}</div>
      <div class="typing" id="typing"></div>
      </div>
      <div class="composer">
        <button class="composer-plus" id="plus-btn" aria-label="${t('photo')}" ${expired ? 'disabled' : ''}>+</button>
        <div class="plus-menu" id="plus-menu" hidden>
          <button type="button" id="img-btn">${t('photo')}</button>
          <button type="button" id="mic-btn">${t('voice')}</button>
        </div>
        <div class="composer-pill">
          <textarea id="text" rows="1" ${expired ? 'disabled' : ''} placeholder="${t('typeHere')}"></textarea>
        </div>
        <button class="chat-send" id="send" ${expired ? 'disabled' : ''} aria-label="${t('send')}">${ICONS.send}</button>
        <input id="img-file" class="hidden-file" type="file" accept="image/*" />
      </div>
    </section>`;
  $('#back').onclick = () => {
    stopChatPresence();
    showHome();
  };
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
  if ($('#go-up')) $('#go-up').onclick = () => { stopChatPresence(); showUpgrade(); };
  if ($('#block')) $('#block').onclick = async () => {
    if (c.blocked) {
      await api(`/api/users/${c.peer.id}/block`, { method: 'DELETE' });
      toast(t('unblocked'));
      openChat(c.peer.id);
    } else {
      await api(`/api/users/${c.peer.id}/block`, { method: 'POST' });
      toast(t('blockedToast'));
      stopChatPresence();
      showHome();
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
        stopChatPresence();
        showHome();
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
      addChatMessage(data.message);
      paintThread();
    } catch (e) {
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
      <div class="topbar"><h2>${t('upgradeTitle')}</h2>${statusPill(state.user)}</div>
      <div class="glass-card stack">
        ${state.user.isSpecial ? `
          <p>${t('specialUnlimited')}</p>
          <p class="small muted">${t('loungeBadge')} ${roleMark(state.user)}.</p>
        ` : `
        <p class="small muted">${t('upgradeHelp')}</p>
        <div class="field"><label>${t('accountId')}</label><input id="acc" value="${state.user.accountId}" readonly /></div>
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
      ${nav('upgrade')}
    </section>`;
  bindNav();
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
    fd.append('accountId', state.user.accountId);
    fd.append('months', $('#months').value);
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

function incomeSourceLabel(v) {
  return { salary: t('salary'), business: t('business'), family: t('family'), other: t('other') }[v] || v || '—';
}

function hostStatusLine(u) {
  if (u.gender !== 'female') return '';
  if (u.isHost) return t('hostVerified');
  if (u.hostStatus === 'pending') return t('hostPending');
  if (u.hostStatus === 'rejected') return t('hostRejected');
  return t('hostNone');
}

function incomeDemoBlock(u) {
  const src = u.incomeDemoVideoUrl || '/demo/income-host.mp4';
  return `
    <div class="income-demo">
      <h3>${t('howHostWorks')}</h3>
      <p class="small muted">${t('sampleChatOnly')}</p>
      <div class="chat-demo" role="img" aria-label="${t('howHostWorks')}">
        <div class="chat-demo-head">
          <span class="badge-lv">Lv 1</span> koKo <span class="muted">${t('visitedSample')}</span>
        </div>
        <div class="chat-demo-thread">
          <div class="bubble them">${t('demoHi')}</div>
          <div class="bubble me">${t('demoStay')}</div>
          <div class="bubble them chat-demo-clip">
            <video class="income-video" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video>
            <span class="small muted">${t('demoWalkthrough')}</span>
          </div>
          <div class="host-earn">${t('hostCredited', { amount: 500 })}</div>
        </div>
        <div class="chat-demo-bar muted small">${t('demoComposer')}</div>
      </div>
    </div>`;
}

function showProfile() {
  state.view = 'profile';
  const u = state.user;
  const paidLine = u.paidUntil ? t('paidUntil', { when: I18n.formatWhen(u.paidUntil) }) : t('notPaidYet');
  const formLocked = u.gender === 'female' && !u.canEditIncome;
  const femaleForm = u.gender === 'female' ? `
        <div class="glass-card stack" style="margin-top:12px;text-align:left">
          <h3 style="margin:0">${t('income')}</h3>
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          ${incomeDemoBlock(u)}
          ${formLocked ? `<p class="small muted">${t('incomeLocked')}</p>` : ''}
          <div class="field"><label>${t('occupation')}</label><input id="inc-occ" ${formLocked ? 'disabled' : ''} value="${escapeHtml(u.occupation || '')}" minlength="2" maxlength="80" /></div>
          <div class="row-2">
            <div class="field"><label>${t('monthlyIncome')}</label><input id="inc-amt" ${formLocked ? 'disabled' : ''} inputmode="numeric" value="${u.monthlyIncome != null ? escapeHtml(String(u.monthlyIncome)) : ''}" /></div>
            <div class="field"><label>${t('incomeSource')}</label>
              <select id="inc-src" ${formLocked ? 'disabled' : ''}>
                ${['salary', 'business', 'family', 'other'].map((s) => `<option value="${s}" ${u.incomeSource === s ? 'selected' : ''}>${incomeSourceLabel(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn block" id="save-income" ${formLocked ? 'disabled' : ''}>${t('saveIncome')}</button>
          ${u.isHost ? `
          <h3>${t('hostEarnings')}</h3>
          <p><strong>${Number(u.hostBalance != null ? u.hostBalance : u.hostEarnings || 0).toLocaleString()} MMK</strong> ${t('available')}
            <span class="small muted"> · ${t('earned')} ${Number(u.hostEarnings || 0).toLocaleString()} · ${Number(u.hostCreditAmount || 500).toLocaleString()} ${t('perVisitor')}</span></p>
          <p class="small muted">${t('hostRules')}</p>
          ${(u.hostIncomeLedger || []).length
            ? `<div class="ledger">${u.hostIncomeLedger.map((row) => `<div class="ledger-row">+${row.amount} · ${escapeHtml(row.partner.username)} · ${t('lv', { n: row.partner.level })} · ${I18n.formatWhen(row.createdAt)}</div>`).join('')}</div>`
            : `<p class="small muted">${t('noVisitors')}</p>`}
          <button class="btn ${u.canWithdraw ? '' : 'secondary'} block" id="withdraw" ${u.canWithdraw ? '' : 'disabled'}>${t('withdraw')}</button>
          ${!u.canWithdraw ? `<p class="small muted">${t('withdrawAt', { amount: Number(u.hostWithdrawMin || 100000).toLocaleString() })}</p>` : ''}
          ${(u.hostPayouts || []).length
            ? `<div class="ledger">${u.hostPayouts.map((p) => `<div class="ledger-row">${p.status} · −${p.amount} · ${p.method === 'kbz' ? t('kbz') : t('wave')} · ${escapeHtml(p.payeeName)}</div>`).join('')}</div>`
            : ''}` : ''}
          ${u.hostStatus === 'rejected' || u.hostStatus === 'none' ? `
          <h3>${t('nrcTitle')}</h3>
          <p class="small muted">${t('nrcAdminOnly')}</p>
          <div class="row-2">
            <label class="photo-pick"><input class="hidden-file" id="nrc-front" type="file" accept="image/*" /><span class="small muted">${t('nrcFront')}</span></label>
            <label class="photo-pick"><input class="hidden-file" id="nrc-back" type="file" accept="image/*" /><span class="small muted">${t('nrcBack')}</span></label>
          </div>
          <button class="btn secondary block" id="save-nrc">${t('submitNrc')}</button>` : ''}
        </div>` : '';
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <h2>${t('you')}</h2>
        <button type="button" class="icon-btn" id="open-settings" aria-label="${t('settings')}">${ICONS.gear}</button>
      </div>
      <div class="glass-card stack center me-card">
        ${avatarHtml(u, 'round me-ava')}
        <div>
          <div class="me-name">${escapeHtml(u.username)}</div>
          <div class="muted">${escapeHtml(u.accountId || t('idHidden'))}</div>
        </div>
        <div class="small">${roleMark(u)} · ${genderLabel(u.gender)} · ${t('born', { year: u.birthYear })}<br>${u.isSpecial ? t('specialChat') : paidLine}${u.gender === 'female' && u.occupation ? `<br>${escapeHtml(u.occupation)} · ${Number(u.monthlyIncome || 0).toLocaleString()} MMK` : ''}</div>
        <div class="me-actions">
          <button type="button" class="btn secondary" id="edit-profile">${t('editProfile')}</button>
          <button type="button" class="btn secondary" id="open-settings-row">${t('settings')}</button>
        </div>
      </div>
      ${femaleForm}
      </div>
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#open-settings').onclick = showSettings;
  $('#open-settings-row').onclick = showSettings;
  $('#edit-profile').onclick = showEditProfile;
  if ($('#save-income')) {
    $('#save-income').onclick = async () => {
      try {
        const data = await api('/api/me/income', {
          method: 'PUT',
          json: {
            occupation: $('#inc-occ').value,
            monthlyIncome: $('#inc-amt').value,
            incomeSource: $('#inc-src').value
          }
        });
        state.user = data.user;
        toast(t('incomeSaved'));
        showProfile();
      } catch (e) {
        toastErr(e);
      }
    };
  }
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
  if ($('#save-nrc')) {
    $('#save-nrc').onclick = async () => {
      const front = $('#nrc-front').files[0];
      const back = $('#nrc-back').files[0];
      if (!front || !back) return toast(t('uploadNrcBoth'));
      const fd = new FormData();
      fd.append('nrcFront', front);
      fd.append('nrcBack', back);
      try {
        const data = await api('/api/me/nrc', { method: 'POST', body: fd });
        state.user = data.user;
        toast(t('nrcSubmitted'));
        showProfile();
      } catch (e) {
        toastErr(e);
      }
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
          <p class="small muted settings-lang-help">${t('chatViewLangHelp')}</p>
        </div>
        <div class="settings-list">
          ${settingsRow('go-edit', ICONS.me, t('editProfile'))}
          ${settingsRow('go-blocked', ICONS.block, t('blockedList'))}
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
    </section>`;
  $('#back').onclick = showProfile;
  $('#go-edit').onclick = showEditProfile;
  $('#go-blocked').onclick = showBlocked;
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

function showEditProfile() {
  state.view = 'edit-profile';
  const u = state.user;
  const photo = u.photoUrl
    ? `<img class="avatar round me-ava" id="edit-preview" alt="" src="${escapeHtml(u.photoUrl)}" />`
    : `<div class="avatar ai round me-ava" id="edit-preview">🍷</div>`;
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
            <input id="edit-username" value="${escapeHtml(u.username)}" maxlength="12" autocomplete="username" />
          </div>
          <p class="small muted" style="text-align:left;margin:0">${t('usernameHelp')}</p>
        </div>
      </div>
    </section>`;
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
    </section>`;
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

function showHelp(inApp = false) {
  state.view = 'help';
  app.innerHTML = `
    <section class="screen">
      ${inApp ? '<div class="screen-body">' : ''}
      <div class="topbar">
        ${inApp ? '' : `<button class="icon-btn" id="back">${ICONS.back}</button>`}
        <h2>${t('helpTitle')}</h2>
      </div>
      <div class="glass-card">
        <h3 style="margin-top:0">${t('pinRecovery')}</h3>
        <p>${t('pinRecoveryBody')}</p>
        <p class="small muted">${escapeHtml(state.settings.adminContact || '')}</p>
        <h3>${t('chatHistory')}</h3>
        <p>${t('chatHistoryBody')}</p>
        <h3>${t('femaleHost')}</h3>
        <p>${t('femaleHostBody')}</p>
        <p>${t('femaleHostIncome')}</p>
      </div>
      ${inApp ? `</div>${nav('help')}` : ''}
    </section>`;
  if ($('#back')) $('#back').onclick = showWelcome;
  if (inApp) bindNav();
}

boot().catch((e) => toastErr(e));
