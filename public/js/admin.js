'use strict';

const root = document.getElementById('admin-app');
let tab = 'accounts';
let socket;
let lookupQ = '';
let focusAccountId = null;

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
    err.data = data;
    throw err;
  }
  return data;
}

function money(n, c) {
  return `${Number(n).toLocaleString()} ${c || 'MMK'}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const USERNAME_RE = /^(?:[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]){1,12}$/;
const USERNAME_HINT = 'Letters and numbers only (English or Myanmar) · max 12. No spaces or symbols.';

const $ = (s, el = document) => el.querySelector(s);
const t = (k, p) => I18n.t(k, p);
let paintUi = null;

function showLogin() {
  paintUi = showLogin;
  root.innerHTML = `
    <div class="card login">
      <img class="admin-logo" src="/assets/sakarwine-logo.png" alt="SAKARWINE" />
      <h1>${t('adminTitle')}</h1>
      <p class="muted">${t('adminSub')}</p>
      <div class="field"><label>${t('username')}</label><input id="u" /></div>
      <div class="field"><label>${t('password')}</label><input id="p" type="password" /></div>
      <button id="go" class="block">${t('signIn')}</button>
      ${I18n.switcherHtml('admin-lang')}
      <p id="err" class="muted"></p>
    </div>`;
  I18n.bindSwitcher('admin-lang');
  $('#go').onclick = async () => {
    try {
      await api('/api/admin/login', { method: 'POST', json: { username: $('#u').value, password: $('#p').value } });
      bootDash();
    } catch (e) {
      $('#err').textContent = I18n.error(e.message);
    }
  };
}

function moderationButtons(a) {
  return `
    ${a.accountIdHidden
      ? `<button data-act="unhide-id" data-id="${a.id}">${t('unhideId')}</button>`
      : `<button class="ghost" data-act="hide-id" data-id="${a.id}">${t('hideId')}</button>`}
    ${a.status === 'active' ? `<button class="warn" data-act="suspend" data-id="${a.id}">${t('suspend')}</button>` : ''}
    ${a.status === 'suspended' ? `<button data-act="unsuspend" data-id="${a.id}">${t('unsuspend')}</button>` : ''}
    ${a.status !== 'closed' ? `<button class="danger" data-act="close" data-id="${a.id}">${t('closeAccount')}</button>` : ''}
    <button data-act="reset" data-id="${a.id}" data-phone="${esc(a.phone)}">${t('resetPin')}</button>`;
}

async function runAccountAction(btn) {
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'reset') {
    const phone = prompt('Confirm registered phone', btn.dataset.phone);
    const password = prompt('New 6-digit PIN');
    if (!password) return;
    await api(`/api/admin/accounts/${id}/reset-password`, { method: 'POST', json: { phone, password } });
    return;
  }
  await api(`/api/admin/accounts/${id}/${act}`, { method: 'POST' });
}

function hostMark(a) {
  return a.isHost ? ' <span class="badge-neon badge-host" data-badge="host">host</span>' : '';
}

function incomeLine(a) {
  if (a.gender !== 'female') return '';
  const src = { salary: 'Salary', business: 'Business', family: 'Family support', other: 'Other' }[a.incomeSource] || a.incomeSource || '—';
  return `${esc(a.occupation || '—')} · ${Number(a.monthlyIncome || 0).toLocaleString()} MMK · ${esc(src)}`;
}

function nrcBlock(a) {
  if (a.gender !== 'female') return '';
  const passport = a.idDocType === 'passport';
  const docLabel = passport ? 'Passport (front only)' : 'NRC (front + back)';
  return `
    <p class="muted">ID document: <strong>${esc(docLabel)}</strong></p>
    <div class="nrc-pair">
      ${a.nrcFrontUrl ? `<a href="${a.nrcFrontUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcFrontUrl}" alt="${passport ? 'Passport front' : 'NRC front'}" /></a>` : `<span class="muted">No ${passport ? 'passport' : 'NRC front'} photo</span>`}
      ${passport ? '' : a.nrcBackUrl ? `<a href="${a.nrcBackUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcBackUrl}" alt="NRC back" /></a>` : '<span class="muted">No NRC back</span>'}
    </div>
    <p class="muted">Host status: ${esc(a.hostStatus || 'none')}${a.isHost ? ' · verified host' : ''}</p>
    ${a.hostStatus === 'pending' || a.hostStatus === 'rejected' || (a.hostStatus === 'approved' && !a.isHost) ? `<div class="actions">
      <button data-host-ok="${a.id}">Approve host</button>
      <button class="danger" data-host-no="${a.id}">Reject</button>
    </div>` : a.hostStatus === 'approved' ? `<div class="actions"><button class="danger" data-host-no="${a.id}">Revoke host</button></div>` : ''}`;
}

function upgradeCard(u) {
  return `
    <div class="notice${u.paidActive ? ' paid-active' : ''}${u.extraUpgrade ? ' extra-upgrade' : ''}">
      <div class="row">
        <div>
          <span class="badge ${u.status}">${esc(u.status)}</span>
          <strong>${esc(u.accountId)}</strong>
          ${u.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
          · ${esc(u.username)}<br>
          Phone ${esc(u.phone)} · ${u.months} month(s) · ${money(u.amount, u.currency)} · current Lv ${u.level}
          ${u.hostCode ? `<div>Host code ${esc(u.hostCode)}</div>` : ''}
          <div class="muted">${new Date(u.createdAt).toLocaleString()}</div>
        </div>
        ${u.receiptUrl ? `<a href="${u.receiptUrl}" target="_blank"><img class="thumb" src="${u.receiptUrl}" alt="receipt" /></a>` : ''}
      </div>
      ${u.status === 'pending' ? `<div class="actions" style="margin-top:8px">
        <button data-ok="${u.id}">Approve (start paid period now)</button>
        <button class="danger" data-no="${u.id}">Reject</button>
      </div>` : ''}
    </div>`;
}

async function bootDash() {
  const me = await api('/api/admin/me');
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('upgrade:new', () => render());
  socket.on('pin-recovery:new', () => render());

  async function openDossier(q) {
    lookupQ = String(q || '').trim();
    if (!lookupQ) return;
    focusAccountId = lookupQ;
    await render();
  }

  function bindLookup() {
    const input = $('#lookup');
    const hits = $('#lookup-hits');
    let t;
    const paintHits = (matches) => {
      if (!matches.length) {
        hits.hidden = true;
        hits.innerHTML = '';
        return;
      }
      hits.hidden = false;
      hits.innerHTML = matches
        .map(
          (m) => `<button type="button" class="hit${m.paidActive ? ' paid-active' : ''}" data-aid="${esc(m.accountId)}">
            <strong>${esc(m.accountId)}</strong> · ${esc(m.username)}
            ${m.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
            <span class="muted"> · ${esc(m.phone)} · ${m.status}${m.badge ? ` · ${esc(m.badge)}` : ''}${m.paidActive ? ' · paid' : ''}</span>
          </button>`
        )
        .join('');
      hits.querySelectorAll('.hit').forEach((b) => {
        b.onclick = () => openDossier(b.dataset.aid);
      });
    };
    const search = async () => {
      lookupQ = input.value.trim();
      if (lookupQ.length < 2) {
        hits.hidden = true;
        return;
      }
      try {
        const data = await api(`/api/admin/search?q=${encodeURIComponent(lookupQ)}`);
        paintHits(data.matches);
      } catch {
        hits.hidden = true;
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(search, 180);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        openDossier(input.value);
      }
    });
    $('#lookup-go').onclick = () => openDossier(input.value);
  }

  async function paintDossier(panel) {
    let data;
    try {
      data = await api(`/api/admin/dossier?q=${encodeURIComponent(focusAccountId)}`);
    } catch (err) {
      const matches = err.data && err.data.matches;
      panel.innerHTML = `<p>${esc(err.message)}</p>
        ${(matches || []).map((m) => `<div class="notice" data-open-id="${esc(m.accountId)}" style="cursor:pointer">${esc(m.accountId)} · ${esc(m.username)}</div>`).join('')}
        <button data-leave>Back</button>`;
      panel.querySelectorAll('[data-open-id]').forEach((el) => {
        el.onclick = () => openDossier(el.dataset.openId);
      });
      panel.querySelector('[data-leave]').onclick = () => {
        focusAccountId = null;
        render();
      };
      return;
    }
    const a = data.user;
    focusAccountId = a.accountId;
    lookupQ = a.accountId;
    const paidLine = a.paidUntil ? new Date(a.paidUntil).toLocaleString() : 'Not paid';
    panel.innerHTML = `
      <div class="row">
        <button data-leave>← All accounts</button>
        <h2 style="margin:0">Account ${esc(a.accountId)}</h2>
      </div>
      <div class="dossier${a.paidActive ? ' paid-active' : ''}">
        <section>
          <h3>Profile</h3>
          <p>
            <strong>${esc(a.username)}</strong>
            ${a.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
            ${a.badge ? `<span class="badge-neon">${esc(a.badge)}</span>` : ''}
            ${hostMark(a)}
            <span class="badge ${a.status}">${esc(a.status)}</span>
            ${a.online ? '· online' : ''}
            ${a.createdByAdmin ? '· admin-created' : ''}
            ${a.isSpecial ? '· unlimited chat' : ''}
          </p>
          ${a.photoUrl ? `<img class="thumb user-ava" src="${a.photoUrl}" alt="" />` : ''}
          <p class="muted">Phone ${esc(a.phone)} · ${esc(a.gender)} · born ${a.birthYear}<br>
            Level ${a.level} · Paid until ${paidLine}<br>
            Account ID ${a.accountIdHidden ? 'hidden from lounge' : 'visible to lounge'}
            ${a.hostCode ? `<br>Host code ${esc(a.hostCode)}` : ''}
            ${a.bio ? `<br>Bio: ${esc(a.bio)}` : ''}
            ${a.gender === 'female' ? `<br>Income: ${incomeLine(a)}` : ''}</p>
          ${a.gender === 'female' ? `<h3>ID verification</h3>${nrcBlock(a)}` : ''}
          ${data.hostIncome ? `<h3>Host earnings</h3>
            <p><strong>${Number(data.hostIncome.hostBalance != null ? data.hostIncome.hostBalance : data.hostIncome.hostEarnings || 0).toLocaleString()} MMK</strong> available
              <span class="muted"> · earned ${Number(data.hostIncome.hostEarnings || 0).toLocaleString()} · ${data.hostIncome.hostCreditAmount} per approved upgrade that used their host code</span></p>
            ${(data.hostIncome.hostIncomeLedger || []).length
              ? data.hostIncome.hostIncomeLedger.map((row) => `<div class="muted">+${row.amount} · ${esc(row.partner && row.partner.username ? row.partner.username : 'upgrade')} · Lv ${row.partner && row.partner.level != null ? row.partner.level : '—'} · ${new Date(row.createdAt).toLocaleString()}</div>`).join('')
              : '<p class="muted">No qualifying upgrades credited yet.</p>'}
            ${(data.hostIncome.hostPayouts || []).length
              ? `<h3>Payouts</h3>${data.hostIncome.hostPayouts.map((p) => `<div class="muted">${esc(p.status)} · −${p.amount} · ${p.method === 'kbz' ? 'KBZ Pay' : 'Wave'} · ${esc(p.payeeName)} · ${esc(p.payeePhone)}</div>`).join('')}`
              : ''}` : ''}
          ${a.isSpecial || data.badges ? `<div class="field"><label>Role badge</label>
            <select id="dossier-badge">
              <option value="">(none / regular level)</option>
              ${data.badges.map((b) => `<option ${a.badge === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            </select>
            <button id="save-badge">Save badge</button>
          </div>` : ''}
          <div class="actions">${moderationButtons(a)}</div>
        </section>
        <section>
          <h3>Upgrades</h3>
          ${data.upgrades.length ? data.upgrades.map(upgradeCard).join('') : '<p class="muted">No upgrade submissions.</p>'}
        </section>
        <section>
          <h3>Chats</h3>
          ${data.conversations.length ? data.conversations.map((c) => `
            <div class="notice" data-open="${c.id}" style="cursor:pointer">
              <strong>#${c.id}</strong> with ${esc(c.peer.username)} (${esc(c.peer.accountId)}) · ${c.messageCount} messages
              <div class="muted">${c.lastMessage ? esc(c.lastMessage.body || c.lastMessage.type) : 'No messages'} · started ${new Date(c.startedAt).toLocaleString()}</div>
            </div>`).join('') : '<p class="muted">No conversations.</p>'}
          <div id="dossier-thread"></div>
        </section>
        <section>
          <h3>Blocks</h3>
          <p class="muted">Blocked by this account: ${data.blocked.length ? data.blocked.map((u) => esc(u.username)).join(', ') : 'none'}</p>
          <p class="muted">Blocked this account: ${data.blockedBy.length ? data.blockedBy.map((u) => esc(u.username)).join(', ') : 'none'}</p>
        </section>
      </div>`;
    panel.querySelector('[data-leave]').onclick = () => {
      focusAccountId = null;
      render();
    };
    panel.onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      const ok = e.target.closest('[data-ok]');
      const no = e.target.closest('[data-no]');
      const hostOk = e.target.closest('[data-host-ok]');
      const hostNo = e.target.closest('[data-host-no]');
      const open = e.target.closest('[data-open]');
      try {
        if (btn) {
          await runAccountAction(btn);
          await render();
        } else if (ok) {
          await api(`/api/admin/upgrades/${ok.dataset.ok}/approve`, { method: 'POST' });
          await render();
        } else if (no) {
          await api(`/api/admin/upgrades/${no.dataset.no}/reject`, { method: 'POST' });
          await render();
        } else if (hostOk) {
          await api(`/api/admin/accounts/${hostOk.dataset.hostOk}/host-approve`, { method: 'POST' });
          await render();
        } else if (hostNo) {
          await api(`/api/admin/accounts/${hostNo.dataset.hostNo}/host-reject`, { method: 'POST' });
          await render();
        } else if (open) {
          const thread = await api(`/api/admin/conversations/${open.dataset.open}`);
          const box = $('#dossier-thread');
          box.innerHTML = `
            <div class="chat-log">${thread.messages.map((m) => `
              <div class="msg"><div class="muted">${m.sender ? esc(m.sender.username) : 'system'} · ${new Date(m.createdAt).toLocaleString()}</div>
              ${m.type === 'image' && m.mediaUrl ? `<img class="thumb" src="${m.mediaUrl}" alt="" />` : ''}
              ${m.type === 'voice' && m.mediaUrl ? `<audio controls src="${m.mediaUrl}"></audio>` : ''}
              <div>${esc(m.body || m.type)}</div></div>`).join('')}</div>
            ${thread.conversation.involvesAdmin ? `<button data-msg="${thread.conversation.id}" data-msg-open="${thread.conversation.messagingOpen ? '0' : '1'}">${thread.conversation.messagingOpen ? 'Close messaging' : 'Reopen messaging'}</button>` : ''}
            <button data-expire="${thread.conversation.id}">Expire 24h free window</button>`;
          const msgBtn = box.querySelector('[data-msg]');
          if (msgBtn) {
            msgBtn.onclick = async (ev) => {
              ev.stopPropagation();
              await api(`/api/admin/conversations/${msgBtn.dataset.msg}/messaging`, {
                method: 'POST',
                json: { open: msgBtn.dataset.msgOpen === '1' }
              });
              await render();
            };
          }
          box.querySelector('[data-expire]').onclick = async (ev) => {
            ev.stopPropagation();
            await api(`/api/admin/conversations/${thread.conversation.id}/expire-free`, { method: 'POST' });
            alert('Free window expired for this chat.');
          };
        }
      } catch (err) {
        alert(err.message);
      }
    };
    const saveBadge = $('#save-badge');
    if (saveBadge) {
      saveBadge.onclick = async (e) => {
        e.stopPropagation();
        const badge = $('#dossier-badge').value;
        if (!badge) return alert('Pick a badge.');
        try {
          await api(`/api/admin/accounts/${a.id}/badge`, { method: 'POST', json: { badge } });
          await render();
        } catch (err) {
          alert(err.message);
        }
      };
    }
  }

  async function render() {
    paintUi = render;
    const stats = await api('/api/admin/stats');
    root.innerHTML = `
      <div class="row">
        <div>
          <h1>${t('adminTitle')}</h1>
          <div class="muted">${t('signedInAs', { name: me.username })}</div>
        </div>
        ${I18n.switcherHtml('admin-lang')}
        <button class="ghost" id="out">${t('signOut')}</button>
      </div>
      <div class="stats">
        <div class="stat"><span>${t('accounts')}</span><b>${stats.users}</b></div>
        <div class="stat"><span>${t('active')}</span><b>${stats.active}</b></div>
        <div class="stat"><span>${t('online')}</span><b>${stats.online}</b></div>
        <div class="stat"><span>${t('pendingUpgrades')}</span><b>${stats.pendingUpgrades}</b></div>
        <div class="stat"><span>${t('pendingHosts')}</span><b>${stats.pendingHosts || 0}</b></div>
        <div class="stat"><span>${t('payouts')}</span><b>${stats.pendingPayouts || 0}</b></div>
        <div class="stat"><span>${t('pendingPinRecovery')}</span><b>${stats.pendingPinRecovery || 0}</b></div>
        <div class="stat"><span>${t('chats')}</span><b>${stats.conversations}</b></div>
      </div>
      ${stats.pendingUpgrades ? `<div class="notice">New payment submissions need review — duration, receipt, account ID, and registered phone are in Upgrades.</div>` : ''}
      ${stats.pendingHosts ? `<div class="notice">Female host ID verifications need review in Hosts — NRC front/back or a passport photo (admin-only).</div>` : ''}
      ${stats.pendingPayouts ? `<div class="notice">${stats.pendingPayouts} host payout(s) waiting — transfer then press Done to send ငွေဝင်ပါပြီ.</div>` : ''}
      ${stats.pendingPinRecovery ? `<div class="notice">${stats.pendingPinRecovery} PIN recovery request(s) in PIN recovery — verify the phone, then Reset PIN from the dossier. There is no self-serve reset.</div>` : ''}
      <div class="lookup">
        <label class="field" style="margin:0;flex:1">
          <span>${t('findById')}</span>
          <input id="lookup" value="${esc(lookupQ)}" placeholder="Type SW######## — profile, chats, upgrades, moderation…" autocomplete="off" />
        </label>
        <button id="lookup-go">${t('openDossier')}</button>
        <div id="lookup-hits" class="lookup-hits" hidden></div>
      </div>
      <div class="tabs">
        <button data-t="accounts" class="${!focusAccountId && tab === 'accounts' ? 'on' : ''}">${t('tabAccounts')}</button>
        <button data-t="create" class="${!focusAccountId && tab === 'create' ? 'on' : ''}">${t('tabCreate')}</button>
        <button data-t="chats" class="${!focusAccountId && tab === 'chats' ? 'on' : ''}">${t('tabChats')}</button>
        <button data-t="upgrades" class="${!focusAccountId && tab === 'upgrades' ? 'on' : ''}">${t('tabUpgrades')} ${stats.pendingUpgrades ? `(${stats.pendingUpgrades})` : ''}</button>
        <button data-t="hosts" class="${!focusAccountId && tab === 'hosts' ? 'on' : ''}">${t('tabHosts')} ${stats.pendingHosts ? `(${stats.pendingHosts})` : ''}</button>
        <button data-t="payouts" class="${!focusAccountId && tab === 'payouts' ? 'on' : ''}">${t('tabPayouts')} ${stats.pendingPayouts ? `(${stats.pendingPayouts})` : ''}</button>
        <button data-t="pin-recovery" class="${!focusAccountId && tab === 'pin-recovery' ? 'on' : ''}">${t('tabPinRecovery')} ${stats.pendingPinRecovery ? `(${stats.pendingPinRecovery})` : ''}</button>
        <button data-t="broadcast" class="${!focusAccountId && tab === 'broadcast' ? 'on' : ''}">${t('tabBroadcast')}</button>
        <button data-t="ads" class="${!focusAccountId && tab === 'ads' ? 'on' : ''}">${t('tabAds')}</button>
        <button data-t="pricing" class="${!focusAccountId && tab === 'pricing' ? 'on' : ''}">${t('tabPricing')}</button>
        <button data-t="settings" class="${!focusAccountId && tab === 'settings' ? 'on' : ''}">${t('tabSettings')}</button>
      </div>
      <div class="card" id="panel">${t('loading')}</div>`;
    I18n.bindSwitcher('admin-lang');
    $('#out').onclick = async () => {
      await api('/api/admin/logout', { method: 'POST' });
      showLogin();
    };
    document.querySelectorAll('.tabs [data-t]').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.t;
        focusAccountId = null;
        render();
      };
    });
    bindLookup();
    const panel = $('#panel');
    if (focusAccountId) {
      await paintDossier(panel);
      return;
    }
    if (tab === 'accounts') {
      const { accounts } = await api('/api/admin/accounts');
      panel.innerHTML = `<div class="table-scroll"><table><thead><tr><th>${t('accounts')}</th><th>${t('phone')}</th><th>${t('rolePaid')}</th><th>${t('idVisibility')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>${accounts.map((a) => `
        <tr class="${a.paidActive ? 'paid-active' : ''}">
          <td><strong>${esc(a.username)}</strong>${a.extraUpgrade ? ` <span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}<br>
            <button class="ghost" data-open-id="${esc(a.accountId)}">${esc(a.accountId)}</button>
            ${a.isSpecial ? `<br><span class="badge-neon">${esc(a.badge || 'special')}</span>` : ''}${a.isHost ? `<br><span class="badge-neon badge-host" data-badge="host">host</span>` : ''}${a.hostStatus === 'pending' ? '<br><span class="muted">NRC pending</span>' : ''}</td>
          <td>${esc(a.phone)}<br><span class="muted">${esc(a.gender)} · ${a.birthYear}</span></td>
          <td>${a.isSpecial ? `Unlimited · ${esc(a.badge || 'special')}` : `Lv ${a.level}<br>${a.paidUntil ? new Date(a.paidUntil).toLocaleDateString() : '—'}`}</td>
          <td>${a.accountIdHidden ? t('hiddenFromLounge') : t('visible')}</td>
          <td><span class="badge ${a.status}">${a.status}</span> ${a.online ? '· online' : ''}${a.createdByAdmin ? '<br><span class="muted">admin-created</span>' : ''}</td>
          <td class="actions">${moderationButtons(a)}</td>
        </tr>`).join('')}</tbody></table></div>`;
      panel.onclick = async (e) => {
        const open = e.target.closest('[data-open-id]');
        if (open) {
          openDossier(open.dataset.openId);
          return;
        }
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        try {
          await runAccountAction(btn);
          render();
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'create') {
      const { badges } = await api('/api/admin/accounts');
      const year = new Date().getFullYear();
      let years = '';
      for (let i = year - 18; i >= 1950; i--) years += `<option value="${i}">${i}</option>`;
      panel.innerHTML = `
        <h2>Create special account</h2>
        <p class="muted">These accounts skip the 24-hour / paid upgrade gate (unlimited chatting). Role badges replace the normal level chip in the lounge with a neon glow. Account IDs are hidden from other members until you unhide them.</p>
        <form id="create-special">
          <div class="grid-form">
            <div class="field"><label>Username</label><input name="username" required minlength="1" maxlength="12" autocomplete="username" spellcheck="false" autocapitalize="none" pattern="[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]{1,12}" title="${esc(USERNAME_HINT)}" /></div>
            <div class="field"><label>6-digit PIN</label><input name="password" required pattern="\\d{6}" maxlength="6" /></div>
            <div class="field"><label>Gender</label>
              <select name="gender"><option value="female">Female</option><option value="male">Male</option></select>
            </div>
            <div class="field"><label>Birth year</label><select name="birthYear">${years}</select></div>
            <div class="field"><label>Phone</label><input name="phone" required /></div>
            <div class="field"><label>Role badge</label>
              <select name="badge" id="badge-select">
                ${badges.map((b) => `<option>${esc(b)}</option>`).join('')}
                <option value="__custom">Custom…</option>
              </select>
            </div>
          </div>
          <p class="muted">${esc(USERNAME_HINT)}</p>
          <div class="field" id="custom-badge-wrap" hidden>
            <label>Custom badge</label>
            <input id="custom-badge" maxlength="24" placeholder="e.g. ambassador" />
          </div>
          <div class="field"><label>Profile photo (optional)</label><input name="photo" type="file" accept="image/*" /></div>
          <p class="muted">Preview: <span class="badge-neon" id="badge-preview">${esc(badges[0] || 'VVIP')}</span></p>
          <button type="submit">Create unlimited account</button>
          <p id="create-msg" class="muted"></p>
        </form>`;
      const select = $('#badge-select');
      const preview = $('#badge-preview');
      const customWrap = $('#custom-badge-wrap');
      const custom = $('#custom-badge');
      const syncPreview = () => {
        const v = select.value === '__custom' ? (custom.value || 'custom') : select.value;
        preview.textContent = v;
        customWrap.hidden = select.value !== '__custom';
      };
      select.onchange = syncPreview;
      custom.oninput = syncPreview;
      $('#create-special').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!USERNAME_RE.test(String(fd.get('username') || '').trim())) {
          $('#create-msg').textContent = USERNAME_HINT;
          return;
        }
        let badge = fd.get('badge');
        if (badge === '__custom') badge = custom.value.trim();
        fd.set('badge', badge);
        try {
          const created = await api('/api/admin/accounts', { method: 'POST', body: fd });
          $('#create-msg').textContent = `Created ${created.user.username} · ${created.user.accountId} · ID hidden · unlimited chat`;
          await openDossier(created.user.accountId);
        } catch (err) {
          $('#create-msg').textContent = err.message;
        }
      };
    } else if (tab === 'chats') {
      const { conversations } = await api('/api/admin/conversations');
      panel.innerHTML = conversations.map((c) => `
        <div class="notice" style="cursor:pointer" data-open="${c.id}">
          <strong>#${c.id}</strong> ${c.users.map((u) => `${esc(u.username)} (${esc(u.accountId)})`).join(' ↔ ')}
          <div class="muted">${c.lastMessage ? esc(c.lastMessage.body || c.lastMessage.type) : 'No messages'} · started ${new Date(c.startedAt).toLocaleString()}</div>
        </div>`).join('') || '<p class="muted">No conversations yet.</p>';
      panel.onclick = async (e) => {
        const n = e.target.closest('[data-open]');
        if (!n) return;
        const data = await api(`/api/admin/conversations/${n.dataset.open}`);
        panel.innerHTML = `
          <button data-back>← Back</button>
          <p>${data.conversation.users.map((u) => `<button class="ghost" data-open-id="${esc(u.accountId)}">${esc(u.username)} · ${esc(u.accountId)}</button> · ${esc(u.phone)}`).join('<br>')}</p>
          ${data.conversation.involvesAdmin ? `<p class="muted">Member messaging: ${data.conversation.messagingOpen ? 'open' : 'closed'}
            <button data-msg="${data.conversation.id}" data-msg-open="${data.conversation.messagingOpen ? '0' : '1'}">${data.conversation.messagingOpen ? 'Close messaging' : 'Reopen messaging'}</button></p>` : ''}
          <div class="chat-log">${data.messages.map((m) => `
            <div class="msg"><div class="muted">${m.sender ? esc(m.sender.username) : 'system'} · ${new Date(m.createdAt).toLocaleString()}</div>
            ${m.type === 'image' && m.mediaUrl ? `<img class="thumb" src="${m.mediaUrl}" />` : ''}
            ${m.type === 'voice' && m.mediaUrl ? `<audio controls src="${m.mediaUrl}"></audio>` : ''}
            <div>${esc(m.body || m.type)}</div></div>`).join('')}</div>
          <button data-expire="${data.conversation.id}">Expire 24h free window (test)</button>`;
        panel.querySelector('[data-back]').onclick = render;
        panel.querySelectorAll('[data-open-id]').forEach((b) => {
          b.onclick = () => openDossier(b.dataset.openId);
        });
        const msgBtn = panel.querySelector('[data-msg]');
        if (msgBtn) {
          msgBtn.onclick = async () => {
            await api(`/api/admin/conversations/${msgBtn.dataset.msg}/messaging`, {
              method: 'POST',
              json: { open: msgBtn.dataset.msgOpen === '1' }
            });
            render();
          };
        }
        panel.querySelector('[data-expire]').onclick = async () => {
          await api(`/api/admin/conversations/${data.conversation.id}/expire-free`, { method: 'POST' });
          alert('Free window expired for this chat.');
        };
      };
    } else if (tab === 'upgrades') {
      const { upgrades } = await api('/api/admin/upgrades');
      panel.innerHTML = upgrades.map(upgradeCard).join('') || '<p class="muted">No upgrade submissions.</p>';
      panel.onclick = async (e) => {
        const ok = e.target.closest('[data-ok]');
        const no = e.target.closest('[data-no]');
        try {
          if (ok) await api(`/api/admin/upgrades/${ok.dataset.ok}/approve`, { method: 'POST' });
          if (no) await api(`/api/admin/upgrades/${no.dataset.no}/reject`, { method: 'POST' });
          if (ok || no) render();
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'hosts') {
      const { hosts } = await api('/api/admin/hosts');
      panel.innerHTML = hosts.length
        ? hosts
            .map(
              (a) => `
        <div class="notice${a.paidActive ? ' paid-active' : ''}">
          <div class="row">
            <div>
              <span class="badge ${a.hostStatus}">${esc(a.hostStatus)}</span>
              ${hostMark(a)}
              <strong>${esc(a.username)}</strong>
              ${a.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
              <button class="ghost" data-open-id="${esc(a.accountId)}">${esc(a.accountId)}</button><br>
              Phone ${esc(a.phone)} · ${incomeLine(a)}
            </div>
          </div>
          ${nrcBlock(a)}
        </div>`
            )
            .join('')
        : '<p class="muted">No female host verifications yet.</p>';
      panel.onclick = async (e) => {
        const open = e.target.closest('[data-open-id]');
        const ok = e.target.closest('[data-host-ok]');
        const no = e.target.closest('[data-host-no]');
        try {
          if (open) {
            openDossier(open.dataset.openId);
            return;
          }
          if (ok) await api(`/api/admin/accounts/${ok.dataset.hostOk}/host-approve`, { method: 'POST' });
          if (no) await api(`/api/admin/accounts/${no.dataset.hostNo}/host-reject`, { method: 'POST' });
          if (ok || no) render();
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'payouts') {
      const { payouts } = await api('/api/admin/payouts');
      panel.innerHTML = payouts.length
        ? payouts.map((p) => `
        <div class="notice">
          <span class="badge ${p.status}">${esc(p.status)}</span>
          <strong>${esc(p.host && p.host.username)}</strong>
          <button class="ghost" data-open-id="${esc(p.host && p.host.accountId)}">${esc(p.host && p.host.accountId)}</button><br>
          −${Number(p.amount).toLocaleString()} MMK · ${p.method === 'kbz' ? 'KBZ Pay' : 'Wave'}<br>
          ${esc(p.payeeName)} · ${esc(p.payeePhone)}
          <div class="muted">${new Date(p.createdAt).toLocaleString()}</div>
          ${p.status === 'pending' ? `<div class="actions" style="margin-top:8px"><button data-pay-done="${p.id}">Done (money sent)</button></div>` : ''}
        </div>`).join('')
        : '<p class="muted">No payout requests yet.</p>';
      panel.onclick = async (e) => {
        const open = e.target.closest('[data-open-id]');
        const done = e.target.closest('[data-pay-done]');
        try {
          if (open) return openDossier(open.dataset.openId);
          if (done) {
            await api(`/api/admin/payouts/${done.dataset.payDone}/done`, { method: 'POST' });
            render();
          }
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'pin-recovery') {
      const { requests } = await api('/api/admin/pin-recovery');
      panel.innerHTML = requests.length
        ? requests
            .map(
              (r) => `
        <div class="notice">
          <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
          <strong>${esc(r.accountId)}</strong>
          ${r.username ? ` · ${esc(r.username)}` : ''}
          ${r.accountFound ? `<button class="ghost" data-open-id="${esc(r.accountId)}">${esc(r.accountId)}</button>` : ''}<br>
          Submitted phone ${esc(r.phone)}
          <div class="muted">${
            r.matched
              ? 'Account ID and phone match a member — verify, then Reset PIN.'
              : r.accountFound
                ? 'Account found, but the submitted phone does not match. Do not reset until verified.'
                : 'No matching account. Review manually. Do not reset until verified.'
          }</div>
          <div class="muted">${new Date(r.createdAt).toLocaleString()}</div>
          ${r.status === 'pending' ? `<div class="actions" style="margin-top:8px">
            ${r.userId ? `<button data-act="reset" data-id="${r.userId}" data-phone="${esc(r.phone)}">${t('resetPin')}</button>` : ''}
            <button data-pin-done="${r.id}">Mark reviewed</button>
          </div>` : ''}
        </div>`
            )
            .join('')
        : '<p class="muted">No PIN recovery requests yet. Members send account ID + registration phone from Help.</p>';
      panel.onclick = async (e) => {
        const open = e.target.closest('[data-open-id]');
        const done = e.target.closest('[data-pin-done]');
        const reset = e.target.closest('button[data-act="reset"]');
        try {
          if (open) return openDossier(open.dataset.openId);
          if (reset) {
            await runAccountAction(reset);
            render();
            return;
          }
          if (done) {
            await api(`/api/admin/pin-recovery/${done.dataset.pinDone}/done`, { method: 'POST' });
            render();
          }
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'broadcast') {
      panel.innerHTML = `
        <h2>Broadcast</h2>
        <p class="muted">Send one system message and/or image to every active member. Chat video is still not allowed.</p>
        <div class="field"><label>System message</label><textarea id="bc-body" rows="4" placeholder="Optional text"></textarea></div>
        <div class="field"><label>Image (optional)</label><input id="bc-img" type="file" accept="image/*" /></div>
        <button id="bc-go">Send to everyone</button>
        <p id="bc-msg" class="muted"></p>`;
      $('#bc-go').onclick = async () => {
        const fd = new FormData();
        fd.append('body', $('#bc-body').value);
        const file = $('#bc-img').files[0];
        if (file) fd.append('image', file);
        try {
          const data = await api('/api/admin/broadcast', { method: 'POST', body: fd });
          $('#bc-msg').textContent = `Sent to ${data.sent} members.`;
        } catch (err) {
          $('#bc-msg').textContent = err.message;
        }
      };
    } else if (tab === 'ads') {
      const { ads } = await api('/api/admin/ads');
      panel.innerHTML = `
        <h2>Home ads</h2>
        <p class="muted">Shown above the people list. Multiple banners rotate every 5 seconds.</p>
        <div class="field"><label>New banner image</label><input id="ad-file" type="file" accept="image/*" /></div>
        <button id="ad-add">Add banner</button>
        <div id="ad-list" style="margin-top:16px;display:grid;gap:10px">
          ${ads.length ? ads.map((a) => `<div class="notice row"><img class="thumb" src="${a.imageUrl}" alt="" /><button class="danger" data-ad-del="${a.id}">Remove</button></div>`).join('') : '<p class="muted">No banners yet.</p>'}
        </div>`;
      $('#ad-add').onclick = async () => {
        const file = $('#ad-file').files[0];
        if (!file) return alert('Choose an image');
        const fd = new FormData();
        fd.append('image', file);
        try {
          await api('/api/admin/ads', { method: 'POST', body: fd });
          render();
        } catch (err) {
          alert(err.message);
        }
      };
      panel.onclick = async (e) => {
        const del = e.target.closest('[data-ad-del]');
        if (!del) return;
        try {
          await api(`/api/admin/ads/${del.dataset.adDel}`, { method: 'DELETE' });
          render();
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'pricing') {
      const s = await api('/api/admin/settings');
      panel.innerHTML = `
        <div class="field"><label>Monthly price</label><input id="price" type="number" value="${s.monthlyPrice}" /></div>
        <div class="field"><label>Currency</label><input id="cur" value="${s.currency}" /></div>
        <button id="savep">Save pricing</button>
        <table style="margin-top:16px"><thead><tr><th>Plan</th><th>List</th><th>Due</th><th>Discount</th></tr></thead>
        <tbody>${s.quotes.map((q) => `<tr><td>${q.label}</td><td>${money(q.gross, s.currency)}</td><td>${money(q.amount, s.currency)}</td><td>${q.discountPercent ? q.discountPercent + '%' : '—'}</td></tr>`).join('')}</tbody></table>
        <p class="muted">6 months prepaid = 30% off. 12 months = 50% off. Other durations are full monthly × months.</p>`;
      $('#savep').onclick = async () => {
        await api('/api/admin/settings', { method: 'PUT', json: { monthlyPrice: Number($('#price').value), currency: $('#cur').value } });
        render();
      };
    } else {
      const s = await api('/api/admin/settings');
      panel.innerHTML = `
        <div class="field"><label>Site name</label><input id="sn" value="${esc(s.siteName)}" /></div>
        <div class="field"><label>Payment instructions</label><textarea id="pi" rows="5">${esc(s.paymentInstructions)}</textarea></div>
        <div class="field"><label>Admin contact (PIN recovery)</label><textarea id="ac" rows="3">${esc(s.adminContact)}</textarea></div>
        <div class="field"><label>Income demo video URL</label><input id="dv" value="${esc(s.incomeDemoVideoUrl || '/demo/income-host.mp4')}" /></div>
        <p class="muted">Shown on the host income form as a chat-style sample. Default ships with the app. Use a site path or https URL.</p>
        <button id="saves">Save settings</button>`;
      $('#saves').onclick = async () => {
        await api('/api/admin/settings', {
          method: 'PUT',
          json: {
            siteName: $('#sn').value,
            paymentInstructions: $('#pi').value,
            adminContact: $('#ac').value,
            incomeDemoVideoUrl: $('#dv').value
          }
        });
        alert(t('saved'));
      };
    }
  }
  await render();
}

I18n.init();
I18n.onChange(() => {
  if (typeof paintUi === 'function') paintUi();
});
api('/api/admin/me').then(bootDash).catch(showLogin);
