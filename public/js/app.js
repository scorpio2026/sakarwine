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
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>`
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
  if (user.isAi || !user.photoUrl) {
    return `<div class="avatar ai ${cls}">🍷</div>`;
  }
  return `<img class="avatar ${cls}" alt="" src="${user.photoUrl}" />`;
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
      state.chat.messages.push(message);
      const box = $('#messages');
      if (box) {
        box.insertAdjacentHTML('beforeend', renderBubble(message));
        box.scrollTop = box.scrollHeight;
      }
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
    <section class="screen">
      <div class="topbar">
        <div>
          <div class="muted small">Hello, ${u.username}</div>
          <h2 id="home-title">${state.settings.siteName}</h2>
        </div>
        <span class="pill-slot">${statusPill(u)}</span>
      </div>
      <div id="user-list" class="user-list"></div>
      ${nav('home')}
    </section>`;
  bindNav();
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

function renderBubble(m) {
  const mine = m.sender && state.user && m.sender.id === state.user.id;
  const cls = `bubble ${mine ? 'me' : 'them'}${m.sender && m.sender.isAi ? ' ai' : ''}`;
  let inner = '';
  if (m.type === 'image' && m.imageLocked) {
    inner = `<div class="locked-photo" data-lock>Photos unlock at Level 3 (3 approved upgrades). Tap for details.</div>`;
  } else if (m.type === 'image' && m.mediaUrl) {
    inner = `<img src="${m.mediaUrl}" alt="photo" />`;
  } else if (m.type === 'voice' && m.mediaUrl) {
    inner = `<audio controls src="${m.mediaUrl}"></audio>`;
  } else {
    inner = escapeHtml(m.body || '');
  }
  return `<div class="${cls}" contenteditable="false">${inner}</div>`;
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
  if (!m.partnerQualifies) {
    return `<div class="host-earn dim" id="host-earn">Host credit needs a partner at Lv 1+ (one approved upgrade).</div>`;
  }
  return `<div class="host-earn" id="host-earn">Mutual chat ${formatChatMs(m.totalMs)} / ${formatChatMs(m.neededMs)} toward +${m.creditAmount} with this member</div>`;
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
    <section class="screen">
      <div class="topbar chat-head">
        <button class="icon-btn" id="back">${ICONS.back}</button>
        ${avatarHtml(c.peer)}
        <div class="meta">
          <div class="name">${c.peer.username} ${roleMark(c.peer)}</div>
          <div class="sub">${c.peer.online ? 'Online' : 'Offline'} · ${formatRemain(c.window.remainingMs, c.window)}</div>
        </div>
        ${c.peer.isAi ? '' : `<div class="chat-actions">
          <button class="icon-btn" id="block" title="Block">${ICONS.block}</button>
          <button class="icon-btn" id="delete-chat" title="Delete for me">${ICONS.trash}</button>
        </div>`}
      </div>
      ${expired ? `<div class="upgrade-banner">Free 24 hours has ended for this chat. Upgrade to keep talking with unlimited people during your paid period.<br><button class="btn" id="go-up" style="margin-top:8px">See plans</button></div>` : ''}
      ${hostCreditBanner(c)}
      <div id="messages" class="messages">${c.messages.map(renderBubble).join('')}</div>
      <div class="typing" id="typing"></div>
      <div class="composer">
        <button class="icon-btn" id="img-btn" ${expired ? 'disabled' : ''}>${ICONS.image}</button>
        <button class="icon-btn" id="mic-btn" ${expired ? 'disabled' : ''}>${ICONS.mic}</button>
        <textarea id="text" ${expired ? 'disabled' : ''} placeholder="Say something lovely…"></textarea>
        <button class="icon-btn" id="send" ${expired ? 'disabled' : ''}>${ICONS.send}</button>
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
  const sendText = async () => {
    const body = $('#text').value;
    if (sending || !body.trim()) return;
    sending = true;
    try {
      const data = await api(`/api/conversations/${c.id}/messages`, {
        method: 'POST',
        json: { type: 'text', body }
      });
      $('#text').value = '';
      c.window = data.window;
      c.messages.push(data.message);
      box.insertAdjacentHTML('beforeend', renderBubble(data.message));
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      if (e.code === 'UPGRADE') showUpgrade();
      toast(e.message);
    } finally {
      sending = false;
    }
  };
  $('#send').onclick = sendText;
  $('#text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });
  let typingT;
  $('#text').addEventListener('input', () => {
    if (state.socket) state.socket.emit('typing', { conversationId: c.id, typing: true });
    clearTimeout(typingT);
    typingT = setTimeout(() => state.socket && state.socket.emit('typing', { conversationId: c.id, typing: false }), 800);
  });
  $('#img-btn').onclick = () => $('#img-file').click();
  $('#img-file').onchange = async () => {
    const f = $('#img-file').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('type', 'image');
    fd.append('file', f);
    try {
      const data = await api(`/api/conversations/${c.id}/messages`, { method: 'POST', body: fd });
      c.messages.push(data.message);
      box.insertAdjacentHTML('beforeend', renderBubble(data.message));
      box.scrollTop = box.scrollHeight;
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
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const fd = new FormData();
        fd.append('type', 'voice');
        fd.append('file', blob, 'voice.webm');
        try {
          const data = await api(`/api/conversations/${c.id}/messages`, { method: 'POST', body: fd });
          c.messages.push(data.message);
          box.insertAdjacentHTML('beforeend', renderBubble(data.message));
          box.scrollTop = box.scrollHeight;
        } catch (e) {
          toast(e.message);
        }
      };
      rec.start();
      toast('Recording… tap mic again to send');
    } catch {
      toast('Microphone not available');
    }
  };
  if (opts.fromTour) {
    setTimeout(() => {
      Tour.start([
        { target: '#text', text: 'Type here. Don’t start with @, and don’t share 09 phone numbers.', arrow: 'up' },
        { target: '#img-btn', text: 'The raised picture button sends a photo. Recipients below Level 3 see it locked.', arrow: 'up' },
        { target: '#mic-btn', text: 'Hold the mic to send a voice note. Video is not allowed.', arrow: 'up' }
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
      <div class="topbar"><h2>Upgrade</h2>${statusPill(state.user)}</div>
      <div class="glass-card stack" style="overflow:auto;flex:1">
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

function showProfile() {
  state.view = 'profile';
  const u = state.user;
  const paidLine = u.paidUntil ? `Paid until ${new Date(u.paidUntil).toLocaleString()}` : 'Not paid yet';
  const femaleForm = u.gender === 'female' ? `
        <div class="glass-card stack" style="margin-top:12px;text-align:left">
          <h3 style="margin:0">Income</h3>
          <p class="small muted">${escapeHtml(hostStatusLine(u))}</p>
          <div class="field"><label>Occupation / work</label><input id="inc-occ" value="${escapeHtml(u.occupation || '')}" minlength="2" maxlength="80" /></div>
          <div class="row-2">
            <div class="field"><label>Monthly income (MMK)</label><input id="inc-amt" inputmode="numeric" value="${u.monthlyIncome != null ? escapeHtml(String(u.monthlyIncome)) : ''}" /></div>
            <div class="field"><label>Income source</label>
              <select id="inc-src">
                ${['salary', 'business', 'family', 'other'].map((s) => `<option value="${s}" ${u.incomeSource === s ? 'selected' : ''}>${incomeSourceLabel(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn block" id="save-income">Save income</button>
          ${u.isHost ? `
          <h3>Host earnings</h3>
          <p><strong>${Number(u.hostEarnings || 0).toLocaleString()} MMK</strong>
            <span class="small muted"> · ${Number(u.hostCreditAmount || 500).toLocaleString()} per qualifying partner</span></p>
          <p class="small muted">A qualifying chat is at least 10 minutes together with someone at Lv 1+ (one approved upgrade). Each partner credits once — not per minute.</p>
          ${(u.hostIncomeLedger || []).length
            ? `<div class="ledger">${u.hostIncomeLedger.map((row) => `<div class="ledger-row">+${row.amount} · ${escapeHtml(row.partner.username)} · Lv ${row.partner.level} · ${new Date(row.createdAt).toLocaleString()}</div>`).join('')}</div>`
            : '<p class="small muted">No qualifying partners yet.</p>'}` : ''}
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
      <div class="topbar"><h2>You</h2></div>
      <div class="glass-card stack center">
        ${avatarHtml(u)}
        <div>
          <div style="font-family:var(--display);font-size:1.6rem">${u.username}</div>
          <div class="muted">${u.accountId || 'Account ID hidden from the lounge'}</div>
        </div>
        <div class="small">${roleMark(u)} · ${u.gender} · born ${u.birthYear}<br>Phone ${u.phone}<br>${u.isSpecial ? 'Unlimited chat · special account' : paidLine}${u.gender === 'female' && u.occupation ? `<br>${escapeHtml(u.occupation)} · ${Number(u.monthlyIncome || 0).toLocaleString()} MMK` : ''}</div>
        <button class="btn secondary block" id="logout">Sign out</button>
      </div>
      ${femaleForm}
      ${nav('profile')}
    </section>`;
  bindNav();
  $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    state.user = null;
    if (state.socket) state.socket.disconnect();
    showWelcome();
  };
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

function showHelp(inApp = false) {
  state.view = 'help';
  app.innerHTML = `
    <section class="screen">
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
        <p>Hosts earn <strong>500</strong> in Income for each upgraded member (Lv 1+) they share a <strong>mutual chat of at least 10 minutes</strong> with. Another qualifying partner adds another 500. Duration is tracked while both of you have the chat open.</p>
      </div>
      ${inApp ? nav('help') : ''}
    </section>`;
  if ($('#back')) $('#back').onclick = showWelcome;
  if (inApp) bindNav();
}

boot().catch((e) => toast(e.message));
