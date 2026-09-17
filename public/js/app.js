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
  gem: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l8-6 8 6-8 10L4 10z"/><path d="M4 10h16M12 4v16"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3.2 3.8-5 7-5s5.6 1.8 7 5"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 6l-6 6 6 6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l16-7-7 16-2-7-7-2z"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M7 17l4-4 3 3 3-3 3 4"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg>`,
  block: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M7 7l10 10"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.4 6.4l1.1 1.1M16.5 16.5l1.1 1.1M17.6 6.4l-1.1 1.1M7.5 16.5l-1.1 1.1"/><circle cx="12" cy="12" r="7.2"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>`
};

function toast(msg) {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 2800);
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
  if (user.isAi || !user.photoUrl) {
    return `<div class="avatar ai ${cls}"${tap}>🍷</div>`;
  }
  return `<img class="avatar ${cls}" alt="" src="${user.photoUrl}"${tap} />`;
}

async function openProfilePhoto(userId) {
  try {
    const data = await api(`/api/users/${userId}/card`);
    const u = data.user;
    const photo = u.photoUrl
      ? `<img class="profile-lite-photo" src="${escapeHtml(u.photoUrl)}" alt="${escapeHtml(u.username)}" />`
      : `<div class="avatar ai profile-lite-photo" style="width:120px;height:120px;margin:0 auto;font-size:3rem">🍷</div>`;
    modal(`
      <div class="profile-lite">
        ${photo}
        <h3 style="margin:12px 0 4px">${escapeHtml(u.username)}</h3>
        <p class="profile-id">${escapeHtml(u.accountId || '—')}</p>
        <button class="btn secondary block" id="photo-close">Close</button>
      </div>`);
    $('#photo-close').onclick = closeModal;
  } catch (e) {
    toast(e.message);
  }
}

function roleMark(user) {
  let core = '';
  if (user && user.badge) {
    core = `<span class="badge-neon" data-badge="${escapeHtml(user.badge)}">${escapeHtml(user.badge)}</span>`;
  } else {
    const lv = user && user.level != null ? user.level : 0;
    core = `<span class="badge-lv">Lv ${lv}</span>`;
  }
  if (user && user.isHost) {
    core += ` <span class="badge-neon badge-host" data-badge="host">host</span>`;
  }
  return core;
}

function statusPill(user) {
  if (user && user.isSpecial) return roleMark(user);
  return `<span class="pill">${user && user.paid ? 'Paid' : 'Free 24h'} · Lv ${user.level}</span>`;
}

function petals() {
  const layer = document.querySelector('.petal-layer');
  layer.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDuration = `${8 + Math.random() * 10}s`;
    p.style.animationDelay = `${Math.random() * 8}s`;
    p.style.opacity = String(0.25 + Math.random() * 0.35);
    layer.appendChild(p);
  }
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
      toast(message.body || 'New system message');
    } else if (message.sender && message.sender.id !== state.user.id) {
      toast(`New message from ${message.sender.username}`);
    }
  });
  socket.on('presence', () => {
    if (state.view === 'home') loadHome();
  });
  socket.on('typing', ({ conversationId, typing }) => {
    if (state.chat && state.chat.id === conversationId) {
      const el = $('#typing');
      if (el) el.textContent = typing ? `${state.chat.peer.username} is typing…` : '';
    }
  });
  socket.on('upgrade:approved', (payload) => {
    toast(`Upgrade approved · you’re now Lv ${payload.level}`);
    refreshMe();
  });
  socket.on('host:approved', () => {
    toast('Host verification approved');
    refreshMe().then(() => {
      if (state.view === 'home') loadHome();
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('host:rejected', () => {
    toast('Host verification was not approved. You can re-upload NRC from Me.');
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('host:income', (payload) => {
    toast(`+${payload.amount} host credit from ${payload.partnerUsername}`);
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
    toast('ငွေဝင်ပါပြီ');
    refreshMe().then(() => {
      if (state.view === 'profile') showProfile();
    });
  });
  socket.on('broadcast', () => {
    refreshMe();
  });
  socket.on('account:status', () => {
    toast('Your account status changed.');
    location.reload();
  });
}

async function refreshMe() {
  const data = await api('/api/me');
  state.user = data.user;
  return data.user;
}

async function boot() {
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
  app.innerHTML = `
    <section class="screen">
      <div class="brand-lockup">
        <div class="logo-3d">${ICONS.wine}</div>
        <h1>${state.settings.siteName}</h1>
        <p class="muted">Cute. Premium. Real-time.</p>
      </div>
      <div class="glass-card stack" style="margin-top:auto">
        <div class="field">
          <label>Username</label>
          <input id="login-user" autocomplete="username" />
        </div>
        <div class="field">
          <label>6-digit PIN</label>
          <input id="login-pass" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" />
        </div>
        <button class="btn block" id="login-btn">Enter lounge</button>
        <button class="btn secondary block" id="goto-reg">Create account</button>
        <button class="btn ghost" id="goto-help">Forgot PIN?</button>
      </div>
    </section>`;
  $('#login-btn').onclick = login;
  $('#goto-reg').onclick = showRegister;
  $('#goto-help').onclick = showHelp;
}

async function login() {
  try {
    const data = await api('/api/login', {
      method: 'POST',
      json: { username: $('#login-user').value, password: $('#login-pass').value }
    });
    state.user = data.user;
    if (data.user.status === 'pending_liveness') return showScan();
    connectSocket();
    showHome();
  } catch (e) {
    toast(e.message);
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
        <h2>Join sakarwine</h2>
      </div>
      <form id="reg" class="glass-card" style="overflow:auto">
        <label class="photo-pick">
          <input class="hidden-file" type="file" name="photo" accept="image/*" required />
          <div id="photo-preview" class="avatar ai">📷</div>
          <span class="small muted">Profile photo</span>
        </label>
        <div class="field"><label>Username</label><input name="username" required minlength="3" maxlength="20" /></div>
        <div class="field"><label>Password (exactly 6 digits)</label><input name="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" required /></div>
        <div class="row-2">
          <div class="field"><label>Gender</label>
            <select name="gender" required>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div class="field"><label>Birth year</label>
            <select name="birthYear">${yearOptions()}</select>
          </div>
        </div>
        <div class="field"><label>Phone number</label><input name="phone" required inputmode="tel" /></div>
        <div id="female-extra">
          <h3>Income</h3>
          <p class="small muted">Required for female accounts. Admin reviews this with your NRC.</p>
          <div class="field"><label>Occupation / work</label><input name="occupation" minlength="2" maxlength="80" /></div>
          <div class="row-2">
            <div class="field"><label>Monthly income (MMK)</label><input name="monthlyIncome" inputmode="numeric" /></div>
            <div class="field"><label>Income source</label>
              <select name="incomeSource">
                <option value="salary">Salary</option>
                <option value="business">Business</option>
                <option value="family">Family support</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <h3>Myanmar NRC</h3>
          <p class="small muted">Front and back photos of your national ID. Only the sakarwine admin can open these files.</p>
          <div class="row-2">
            <label class="photo-pick">
              <input class="hidden-file" type="file" name="nrcFront" accept="image/*" />
              <div id="nrc-front-preview" class="avatar ai">🪪</div>
              <span class="small muted">NRC front</span>
            </label>
            <label class="photo-pick">
              <input class="hidden-file" type="file" name="nrcBack" accept="image/*" />
              <div id="nrc-back-preview" class="avatar ai">🪪</div>
              <span class="small muted">NRC back</span>
            </label>
          </div>
        </div>
        <button class="btn block" type="submit">Continue to face scan</button>
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
    try {
      const data = await api('/api/register', { method: 'POST', body: fd });
      state.user = data.user;
      showScan();
    } catch (err) {
      toast(err.message);
    }
  };
}

function showScan() {
  state.view = 'scan';
  app.innerHTML = `
    <section class="screen">
      <div class="topbar"><h2>Face scan</h2></div>
      <p class="muted small">Move your head left, then right. On-device camera tracking checks liveness and estimates gender. This is a heuristic — lighting and angle affect it — not an identity guarantee.</p>
      <div class="scan-stage">
        <video id="cam" playsinline muted></video>
        <div class="face-guide"></div>
      </div>
      <div class="scan-hint" id="hint">Allow camera to begin</div>
      <button class="btn block" id="start-scan" style="margin-top:10px">Start scan</button>
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
      const match = data.genderMatch ? 'matches' : 'differs from';
      modal(`
        <h3 style="margin-top:0">You’re in</h3>
        <p>Account ID <strong>${data.user.accountId}</strong></p>
        <p class="small muted">Estimated gender: <strong>${result.estimatedGender}</strong> (${match} your profile).</p>
        <button class="btn block" id="go-in">Meet Saka</button>`);
      $('#go-in').onclick = () => {
        closeModal();
        connectSocket();
        showHome({ tour: true, aiConversationId: data.aiConversationId });
      };
    } catch (err) {
      $('#start-scan').disabled = false;
      toast(err.message || 'Camera scan failed');
    }
  };
}

function nav(active) {
  return `
    <nav class="nav">
      <button data-go="home" class="${active === 'home' ? 'active' : ''}"><span class="icon-btn">${ICONS.people}</span>People</button>
      <button data-go="upgrade" class="${active === 'upgrade' ? 'active' : ''}"><span class="icon-btn">${ICONS.gem}</span>Upgrade</button>
      <button data-go="profile" class="${active === 'profile' ? 'active' : ''}"><span class="icon-btn">${ICONS.me}</span>Me</button>
      <button data-go="help" class="${active === 'help' ? 'active' : ''}"><span class="icon-btn">${ICONS.chat}</span>Help</button>
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
  const list = $('#user-list');
  if (!list) return;
  list.innerHTML = users.map((u) => `
    <div class="user-row" data-id="${u.id}">
      ${avatarHtml(u)}
      <div class="meta">
        <div class="name">${u.username} ${u.isAi ? '· guide' : ''} ${roleMark(u)}</div>
        <div class="sub">${u.online ? 'Online now' : 'Offline'} · ${u.gender}${u.blocked ? ' · blocked' : ''}</div>
      </div>
      <span class="dot ${u.online ? 'on' : ''}"></span>
    </div>`).join('');
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
          <div class="muted small">Hello, ${u.username}</div>
          <h2 id="home-title">${state.settings.siteName}</h2>
        </div>
        <span class="pill-slot">${statusPill(u)}</span>
      </div>
      <div id="ad-banner" class="ad-banner" hidden></div>
      <div id="user-list" class="user-list"></div>
      </div>
      ${nav('home')}
    </section>`;
  bindNav();
  startAdBanner();
  await loadHome();
  if (opts.tour && !u.tourCompleted) {
    const ai = state.users.find((x) => x.isAi);
    Tour.start([
      { target: '#home-title', text: 'Welcome. This is your sakarwine lounge — glass, gold, and people who want to talk.', arrow: 'down' },
      { target: '#user-list', text: 'Everyone is listed here. Online friends rise to the top. Tap a name to start a 24-hour free chat.', arrow: 'up' },
      {
        target: '#user-list .user-row',
        text: 'I’ll open our guide chat next so you can try photos and voice notes.',
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
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${t}`;
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
    inner = `<div class="locked-photo" data-lock>Photos unlock at Level 3. Tap for details.</div>`;
  } else if (m.type === 'image' && m.mediaUrl) {
    inner = `<img src="${m.mediaUrl}" alt="" />`;
  } else if (m.type === 'voice' && m.mediaUrl) {
    inner = `<audio controls src="${m.mediaUrl}"></audio>`;
  } else if (sys) {
    inner = `<span class="sys-note">${escapeHtml(m.body || '')}</span>`;
  } else {
    inner = escapeHtml(m.body || '');
  }
  return `<div class="${cls}" contenteditable="false">${inner}</div>`;
}

function renderThread(messages) {
  const list = messages || [];
  let html = '';
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const prev = list[i - 1];
    const next = list[i + 1];
    if (shouldShowTime(prev, m)) {
      html += `<div class="chat-time">${escapeHtml(formatMsgTime(m.createdAt))}</div>`;
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
      messages: full.messages
    };
    renderChat(opts);
  } catch (e) {
    toast(e.message);
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
    return `<div class="host-earn" id="host-earn">+${m.creditAmount} credited for this partner</div>`;
  }
  if (m.hostOpened) {
    return `<div class="host-earn dim" id="host-earn">This chat does not earn income — they need to come talk to you.</div>`;
  }
  if (!m.partnerQualifies) {
    return `<div class="host-earn dim" id="host-earn">Host credit needs a visitor at Lv 1+ (one approved upgrade).</div>`;
  }
  if (m.voided) {
    return `<div class="host-earn dim" id="host-earn">This session was voided (block). It does not earn income.</div>`;
  }
  return `<div class="host-earn" id="host-earn">Continuous chat ${formatChatMs(m.streakMs || m.totalMs)} / ${formatChatMs(m.neededMs)} toward +${m.creditAmount}. Stay online — leaving or blocking resets the session.</div>`;
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
  if (window && window.hostVisitorChat) return 'Unlimited with this visitor';
  if (window && window.special) return 'Unlimited';
  if (ms == null) return 'Unlimited while paid';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m free left`;
}

function renderChat(opts = {}) {
  state.view = 'chat';
  const c = state.chat;
  const expired = c.window.expired;
  app.innerHTML = `
    <section class="screen chat-screen">
      <div class="screen-body">
      <div class="topbar chat-head">
        <button class="chat-tool" id="back" aria-label="Back">${ICONS.back}</button>
        <div class="chat-ava">
          ${avatarHtml(c.peer, 'round')}
          <span class="ava-on ${c.peer.online ? 'on' : ''}"></span>
        </div>
        <div class="meta">
          <div class="name">${escapeHtml(c.peer.username)} ${roleMark(c.peer)}</div>
          <div class="sub">${c.peer.online ? 'Active now' : 'Offline'} · ${formatRemain(c.window.remainingMs, c.window)}</div>
        </div>
        ${c.peer.isAi ? '' : `<div class="chat-actions">
          ${c.peer.isAdmin || c.peer.blockable === false ? '' : `<button class="chat-tool" id="block" title="Block" aria-label="Block">${ICONS.block}</button>`}
          <button class="chat-tool" id="delete-chat" title="Delete for me" aria-label="Delete chat">${ICONS.trash}</button>
        </div>`}
      </div>
      ${expired ? `<div class="upgrade-banner">Free 24 hours has ended for this chat. Upgrade to keep talking.<br><button class="btn" id="go-up" style="margin-top:8px">See plans</button></div>` : ''}
      ${hostCreditBanner(c)}
      <div id="messages" class="messages">${renderThread(c.messages)}</div>
      <div class="typing" id="typing"></div>
      </div>
      <div class="composer">
        <button class="chat-tool" id="img-btn" aria-label="Photo" ${expired ? 'disabled' : ''}>${ICONS.image}</button>
        <div class="composer-pill">
          <textarea id="text" rows="1" ${expired ? 'disabled' : ''} placeholder="Message…"></textarea>
          <button class="chat-send" id="send" hidden ${expired ? 'disabled' : ''}>Send</button>
        </div>
        <button class="chat-tool" id="mic-btn" aria-label="Voice note" ${expired ? 'disabled' : ''}>${ICONS.mic}</button>
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
      modal(`<h3 style="margin-top:0">Locked photo</h3><p>Only Level 3+ members (three approved upgrades) can see chat photos clearly. Upgrade to raise your level.</p><button class="btn block" id="m-up">Upgrade</button>`);
      $('#m-up').onclick = () => { closeModal(); showUpgrade(); };
    }
  };
  if ($('#go-up')) $('#go-up').onclick = () => { stopChatPresence(); showUpgrade(); };
  if ($('#block')) $('#block').onclick = async () => {
    if (c.blocked) {
      await api(`/api/users/${c.peer.id}/block`, { method: 'DELETE' });
      toast('Unblocked');
      openChat(c.peer.id);
    } else {
      await api(`/api/users/${c.peer.id}/block`, { method: 'POST' });
      toast('Blocked');
      stopChatPresence();
      showHome();
    }
  };
  if ($('#delete-chat')) $('#delete-chat').onclick = () => {
    modal(`<h3 style="margin-top:0">Delete this chat?</h3>
      <p>This only clears the history on <strong>your</strong> account. ${escapeHtml(c.peer.username)} will still keep the conversation. Messages cannot be edited or undone.</p>
      <button class="btn danger block" id="m-del">Delete for me</button>
      <button class="btn secondary block" id="m-cancel" style="margin-top:8px">Keep chat</button>`);
    $('#m-cancel').onclick = closeModal;
    $('#m-del').onclick = async () => {
      try {
        await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
        closeModal();
        toast('Chat deleted for you only');
        stopChatPresence();
        showHome();
      } catch (e) {
        toast(e.message);
      }
    };
  };
  let sending = false;
  const ta = $('#text');
  const syncComposer = () => {
    const has = ta.value.trim().length > 0;
    $('#send').hidden = !has;
    if ($('#mic-btn')) $('#mic-btn').hidden = has;
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
      toast(e.message);
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
  $('#img-btn').onclick = () => $('#img-file').click();
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
      toast(e.message);
    }
  };
  let rec, chunks;
  $('#mic-btn').onclick = async () => {
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
          toast(e.message);
        }
      };
      rec.start();
      $('#mic-btn').classList.add('live');
      toast('Recording… tap mic again to send');
    } catch {
      toast('Microphone not available');
    }
  };
  if (opts.fromTour) {
    setTimeout(() => {
      Tour.start([
        { target: '#text', text: 'Type here. Don’t start with @, and don’t share 09 phone numbers.', arrow: 'up' },
        { target: '#img-btn', text: 'The photo button sends a picture. Recipients below Level 3 see it locked.', arrow: 'up' },
        { target: '#mic-btn', text: 'Tap the mic to send a voice note. Video is not allowed.', arrow: 'up' }
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
      <div class="topbar"><h2>Upgrade</h2>${statusPill(state.user)}</div>
      <div class="glass-card stack">
        ${state.user.isSpecial ? `
          <p>This special account already has <strong>unlimited chatting</strong> — no upgrade is required.</p>
          <p class="small muted">Your lounge badge is ${roleMark(state.user)}.</p>
        ` : `
        <p class="small muted">Your account ID is required on the transfer. Admin approval starts the paid period immediately. Each approval raises your level by 1. Photos unlock at Level 3.</p>
        <div class="field"><label>Account ID</label><input id="acc" value="${state.user.accountId}" readonly /></div>
        <div class="field"><label>Duration</label>
          <select id="months">${pub.quotes.map((q) => `<option value="${q.months}">${q.label}${q.discountPercent ? ` · ${q.discountPercent}% off` : ''}</option>`).join('')}</select>
        </div>
        <div class="quote-card">
          <span id="q-label">Coverage</span>
          <strong id="q-amt"></strong>
        </div>
        <p class="small" id="q-detail"></p>
        <pre class="small muted" style="white-space:pre-wrap;font-family:inherit">${escapeHtml(pub.paymentInstructions)}</pre>
        <div class="field"><label>Payment screenshot</label><input id="receipt" type="file" accept="image/*" /></div>
        <button class="btn block" id="submit-up">Submit for admin approval</button>
        <div class="small muted">${mine.upgrades.map((u) => `#${u.id} · ${u.months} mo · ${money(u.amount, u.currency)} · ${u.status}`).join('<br>') || 'No submissions yet.'}</div>
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
    $('#q-detail').textContent = `${q.label} coverage · list ${money(q.gross, pub.currency)}${q.discountPercent ? ` · prepaid save ${q.discountPercent}%` : ''}`;
  };
  $('#months').onchange = paint;
  $('#months').value = '1';
  paint();
  $('#submit-up').onclick = async () => {
    const fd = new FormData();
    fd.append('accountId', state.user.accountId);
    fd.append('months', $('#months').value);
    const file = $('#receipt').files[0];
    if (!file) return toast('Add your transfer screenshot');
    fd.append('receipt', file);
    try {
      await api('/api/upgrade', { method: 'POST', body: fd });
      toast('Submitted. Admin will review.');
      showUpgrade();
    } catch (e) {
      toast(e.message);
    }
  };
}

function incomeSourceLabel(v) {
  return { salary: 'Salary', business: 'Business', family: 'Family support', other: 'Other' }[v] || v || '—';
}

function hostStatusLine(u) {
  if (u.gender !== 'female') return '';
  if (u.isHost) return 'Verified host';
  if (u.hostStatus === 'pending') return 'NRC submitted — waiting for admin';
  if (u.hostStatus === 'rejected') return 'Host verification was not approved. Re-upload NRC below.';
  return 'Complete NRC verification to earn a host badge.';
}

function incomeDemoBlock(u) {
  const src = u.incomeDemoVideoUrl || '/demo/income-host.mp4';
  return `
    <div class="income-demo">
      <h3>How host income works</h3>
      <p class="small muted">Sample chat only. Members still cannot send video messages.</p>
      <div class="chat-demo" role="img" aria-label="Sample chat showing how host income is earned">
        <div class="chat-demo-head">
          <span class="badge-lv">Lv 1</span> koKo <span class="muted">visited you · sample</span>
        </div>
        <div class="chat-demo-thread">
          <div class="bubble them">Hi, I came to talk.</div>
          <div class="bubble me">Stay here 10 minutes — hosts earn 500 once.</div>
          <div class="bubble them chat-demo-clip">
            <video class="income-video" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video>
            <span class="small muted">Sample walkthrough inside this chat</span>
          </div>
          <div class="host-earn">+500 credited for this partner</div>
        </div>
        <div class="chat-demo-bar muted small">Composer locked in this sample · video is not a chat send</div>
      </div>
    </div>`;
}

function showProfile() {
  state.view = 'profile';
  const u = state.user;
  const paidLine = u.paidUntil ? `Paid until ${new Date(u.paidUntil).toLocaleString()}` : 'Not paid yet';
  const formLocked = u.gender === 'female' && !u.canEditIncome;
  const femaleForm = u.gender === 'female' ? `
        <div class="glass-card stack" style="margin-top:12px;text-align:left">
          <h3 style="margin:0">Income</h3>
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          ${incomeDemoBlock(u)}
          ${formLocked ? `<p class="small muted">Upgrade at least once (Lv 1+) to edit the income form.</p>` : ''}
          <div class="field"><label>Occupation / work</label><input id="inc-occ" ${formLocked ? 'disabled' : ''} value="${escapeHtml(u.occupation || '')}" minlength="2" maxlength="80" /></div>
          <div class="row-2">
            <div class="field"><label>Monthly income (MMK)</label><input id="inc-amt" ${formLocked ? 'disabled' : ''} inputmode="numeric" value="${u.monthlyIncome != null ? escapeHtml(String(u.monthlyIncome)) : ''}" /></div>
            <div class="field"><label>Income source</label>
              <select id="inc-src" ${formLocked ? 'disabled' : ''}>
                ${['salary', 'business', 'family', 'other'].map((s) => `<option value="${s}" ${u.incomeSource === s ? 'selected' : ''}>${incomeSourceLabel(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn block" id="save-income" ${formLocked ? 'disabled' : ''}>Save income</button>
          ${u.isHost ? `
          <h3>Host earnings</h3>
          <p><strong>${Number(u.hostBalance != null ? u.hostBalance : u.hostEarnings || 0).toLocaleString()} MMK</strong> available
            <span class="small muted"> · earned ${Number(u.hostEarnings || 0).toLocaleString()} · ${Number(u.hostCreditAmount || 500).toLocaleString()} per qualifying visitor</span></p>
          <p class="small muted">An upgraded member (Lv 1+) must come talk to you. Stay in a continuous mutual chat for 10 minutes. You open the chat → no credit. Offline or block before 10 minutes voids that session. Each visitor credits once.</p>
          ${(u.hostIncomeLedger || []).length
            ? `<div class="ledger">${u.hostIncomeLedger.map((row) => `<div class="ledger-row">+${row.amount} · ${escapeHtml(row.partner.username)} · Lv ${row.partner.level} · ${new Date(row.createdAt).toLocaleString()}</div>`).join('')}</div>`
            : '<p class="small muted">No qualifying visitors yet.</p>'}
          <button class="btn ${u.canWithdraw ? '' : 'secondary'} block" id="withdraw" ${u.canWithdraw ? '' : 'disabled'}>Withdraw</button>
          ${!u.canWithdraw ? `<p class="small muted">Withdraw lights up at ${(u.hostWithdrawMin || 100000).toLocaleString()} MMK.</p>` : ''}
          ${(u.hostPayouts || []).length
            ? `<div class="ledger">${u.hostPayouts.map((p) => `<div class="ledger-row">${p.status} · −${p.amount} · ${p.method === 'kbz' ? 'KBZ Pay' : 'Wave'} · ${escapeHtml(p.payeeName)}</div>`).join('')}</div>`
            : ''}` : ''}
          ${u.hostStatus === 'rejected' || u.hostStatus === 'none' ? `
          <h3>Myanmar NRC</h3>
          <p class="small muted">Front and back. Admin-only after upload.</p>
          <div class="row-2">
            <label class="photo-pick"><input class="hidden-file" id="nrc-front" type="file" accept="image/*" /><span class="small muted">NRC front</span></label>
            <label class="photo-pick"><input class="hidden-file" id="nrc-back" type="file" accept="image/*" /><span class="small muted">NRC back</span></label>
          </div>
          <button class="btn secondary block" id="save-nrc">Submit NRC</button>` : ''}
        </div>` : '';
  app.innerHTML = `
    <section class="screen">
      <div class="screen-body">
      <div class="topbar">
        <h2>You</h2>
        <button type="button" class="icon-btn" id="open-settings" aria-label="Settings">${ICONS.gear}</button>
      </div>
      <div class="glass-card stack center me-card">
        ${avatarHtml(u, 'round me-ava')}
        <div>
          <div class="me-name">${escapeHtml(u.username)}</div>
          <div class="muted">${escapeHtml(u.accountId || 'Account ID hidden from the lounge')}</div>
        </div>
        <div class="small">${roleMark(u)} · ${u.gender} · born ${u.birthYear}<br>${u.isSpecial ? 'Unlimited chat · special account' : paidLine}${u.gender === 'female' && u.occupation ? `<br>${escapeHtml(u.occupation)} · ${Number(u.monthlyIncome || 0).toLocaleString()} MMK` : ''}</div>
        <div class="me-actions">
          <button type="button" class="btn secondary" id="edit-profile">Edit profile</button>
          <button type="button" class="btn secondary" id="open-settings-row">Settings</button>
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
        toast('Income saved');
        showProfile();
      } catch (e) {
        toast(e.message);
      }
    };
  }
  if ($('#withdraw') && !$('#withdraw').disabled) {
    $('#withdraw').onclick = () => {
      modal(`
        <h3 style="margin-top:0">Withdraw ${Number(u.hostBalance || 0).toLocaleString()} MMK</h3>
        <p class="small muted">Balance is held immediately. Admin marks Done after the transfer.</p>
        <div class="field"><label>Wallet</label>
          <select id="wd-method"><option value="kbz">KBZ Pay</option><option value="wave">Wave</option></select>
        </div>
        <div class="field"><label>Name</label><input id="wd-name" /></div>
        <div class="field"><label>Phone</label><input id="wd-phone" inputmode="tel" /></div>
        <button class="btn block" id="wd-go">Submit payout</button>`);
      $('#wd-go').onclick = async () => {
        try {
          const data = await api('/api/me/withdraw', {
            method: 'POST',
            json: { method: $('#wd-method').value, name: $('#wd-name').value, phone: $('#wd-phone').value }
          });
          state.user = data.user;
          closeModal();
          toast('Payout submitted. Balance is on hold.');
          showProfile();
        } catch (e) {
          toast(e.message);
        }
      };
    };
  }
  if ($('#save-nrc')) {
    $('#save-nrc').onclick = async () => {
      const front = $('#nrc-front').files[0];
      const back = $('#nrc-back').files[0];
      if (!front || !back) return toast('Upload NRC front and back');
      const fd = new FormData();
      fd.append('nrcFront', front);
      fd.append('nrcBack', back);
      try {
        const data = await api('/api/me/nrc', { method: 'POST', body: fd });
        state.user = data.user;
        toast('NRC submitted for admin review');
        showProfile();
      } catch (e) {
        toast(e.message);
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
  const contact = state.settings && state.settings.adminContact
    ? escapeHtml(state.settings.adminContact)
    : 'Message the sakarwine admin with the phone number you used at registration.';
  app.innerHTML = `
    <section class="screen settings-screen">
      <div class="screen-body">
        <div class="topbar">
          <button type="button" class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>
          <h2>Settings</h2>
        </div>
        <div class="settings-list">
          ${settingsRow('go-edit', ICONS.me, 'Edit profile')}
          ${settingsRow('go-blocked', ICONS.block, 'Blocked')}
        </div>
        <div class="settings-list settings-note-card">
          <div class="settings-note">
            <div class="settings-note-title">Forgot or change PIN</div>
            <p>There is no self-serve reset. Contact the sakarwine admin with the <strong>phone number you used at registration</strong>. They will verify it and set a new 6-digit PIN.</p>
            <p class="small muted">${contact}</p>
          </div>
        </div>
        <div class="settings-list">
          <button type="button" class="settings-row danger" id="logout">
            <span class="settings-label">Log out</span>
          </button>
        </div>
      </div>
    </section>`;
  $('#back').onclick = showProfile;
  $('#go-edit').onclick = showEditProfile;
  $('#go-blocked').onclick = showBlocked;
  $('#logout').onclick = doLogout;
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
          <button type="button" class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>
          <h2>Edit profile</h2>
          <button type="button" class="btn ghost" id="save-profile">Done</button>
        </div>
        <div class="glass-card stack center">
          <label class="edit-photo">
            <input class="hidden-file" id="edit-photo" type="file" accept="image/*" />
            ${photo}
            <span class="edit-photo-change">Change photo</span>
          </label>
          <div class="field" style="width:100%;text-align:left">
            <label for="edit-username">Username</label>
            <input id="edit-username" value="${escapeHtml(u.username)}" maxlength="20" autocomplete="username" />
          </div>
          <p class="small muted" style="text-align:left;margin:0">Letters, numbers, and underscores · 3–20 characters. Gender, birth year, and PIN stay as they are.</p>
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
    const file = $('#edit-photo').files[0];
    if (file) fd.append('photo', file);
    try {
      const data = await api('/api/me/profile', { method: 'PUT', body: fd });
      state.user = data.user;
      toast('Profile updated');
      showSettings();
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
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
          <button type="button" class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>
          <h2>Blocked</h2>
        </div>
        <p class="muted small" style="margin-top:0">People you block cannot message you. Unblock anytime.</p>
        <div id="blocked-list" class="blocked-list"><p class="muted">Loading…</p></div>
      </div>
    </section>`;
  $('#back').onclick = showSettings;
  try {
    const data = await api('/api/me/blocked');
    const box = $('#blocked-list');
    if (!data.users.length) {
      box.innerHTML = '<div class="settings-empty">You’re not blocking anyone.</div>';
      return;
    }
    box.innerHTML = data.users.map((u) => `
      <div class="user-row blocked-row" data-id="${u.id}">
        ${avatarHtml(u, 'round')}
        <div class="meta">
          <div class="name">${escapeHtml(u.username)}</div>
          <div class="sub">${u.online ? 'Online' : 'Offline'} · ${escapeHtml(u.gender || '')}</div>
        </div>
        <button type="button" class="btn secondary unblock" data-unblock="${u.id}">Unblock</button>
      </div>`).join('');
    box.querySelectorAll('[data-unblock]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/users/${btn.dataset.unblock}/block`, { method: 'DELETE' });
          toast('Unblocked');
          showBlocked();
        } catch (err) {
          toast(err.message);
        }
      };
    });
  } catch (e) {
    toast(e.message);
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
        <h2>Help</h2>
      </div>
      <div class="glass-card">
        <h3 style="margin-top:0">PIN recovery</h3>
        <p>There is no self-serve reset. Contact the sakarwine admin and give the <strong>phone number you used at registration</strong>. They will verify it and set a new 6-digit PIN.</p>
        <p class="small muted">${escapeHtml(state.settings.adminContact || '')}</p>
        <h3>Chat history</h3>
        <p>Deleting a conversation removes it from <strong>your</strong> history only. The other person still keeps every message. You cannot edit any message after it is sent.</p>
        <h3>Female host verification</h3>
        <p>Female accounts include an income form and must upload Myanmar NRC (front + back) at registration. After admin approval, a blue <strong>host</strong> badge sits beside your level. NRC photos are stored for admin review only.</p>
        <p>Hosts earn <strong>500</strong> only when an upgraded member (Lv 1+) <strong>comes to talk</strong> and you stay in a <strong>continuous 10-minute</strong> mutual chat. Chats you start do not count. Each visitor credits once. Going offline or blocking before 10 minutes voids that session. Withdraw opens at 100,000 via KBZ Pay or Wave. Hosts may keep talking without the 24-hour gate to members who visited them. Editing the income form needs Lv 1+.</p>
      </div>
      ${inApp ? `</div>${nav('help')}` : ''}
    </section>`;
  if ($('#back')) $('#back').onclick = showWelcome;
  if (inApp) bindNav();
}

boot().catch((e) => toast(e.message));
