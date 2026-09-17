'use strict';

const root = document.getElementById('admin-app');
let tab = 'accounts';
let desk = null;
const MONEY_TABS = ['upgrades', 'create', 'hosts', 'payouts'];
const OTHER_TABS = ['accounts', 'chats', 'pin-recovery', 'broadcast', 'ads', 'pricing', 'settings'];
let socket;
let lookupQ = '';
let focusAccountId = null;
let broadcastMode = 'all';
let broadcastTargets = [];

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

function paidHoursLabel(paidUntil, now = Date.now()) {
  const parts = remainingPaidParts(paidUntil, now);
  if (!parts.ms) return '';
  const m = String(parts.minutes).padStart(2, '0');
  const s = String(parts.seconds).padStart(2, '0');
  return t('paidCountdown', { h: parts.hours, m, s });
}

function paidRemainLine(paidUntil, now = Date.now()) {
  const parts = remainingPaidParts(paidUntil, now);
  if (!parts.ms) return t('notPaidYet');
  return `${new Date(paidUntil).toLocaleString()} · ${paidHoursLabel(paidUntil, now)}`;
}

let paidTick = null;
function stopPaidTick() {
  if (paidTick) {
    clearInterval(paidTick);
    paidTick = null;
  }
}

function startPaidTick(el, paidUntil) {
  stopPaidTick();
  if (!el) return;
  const paint = () => {
    if (!el.isConnected) {
      stopPaidTick();
      return;
    }
    el.textContent = paidRemainLine(paidUntil);
    if (!remainingPaidParts(paidUntil).ms) stopPaidTick();
  };
  paint();
  if (remainingPaidParts(paidUntil).ms) paidTick = setInterval(paint, 1000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const USERNAME_RE = /^(?:[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]){1,12}$/;

const $ = (s, el = document) => el.querySelector(s);
const t = (k, p) => I18n.t(k, p);
const st = (s) => (I18n.statusLabel ? I18n.statusLabel(s) : s);
function gLabel(g) {
  if (g === 'female') return t('female');
  if (g === 'male') return t('male');
  return g || '';
}
function monthsLabel(n) {
  return Number(n) === 1 ? t('planMonths', { n }) : t('planMonthsMany', { n });
}
let paintUi = null;

function setAdminLoginChrome(on) {
  document.body.classList.toggle('is-admin-login', on);
  document.body.classList.toggle('is-admin-dash', !on);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#0b0714';
}

function showLogin() {
  paintUi = showLogin;
  setAdminLoginChrome(true);
  document.title = t('adminTitle');
  root.innerHTML = `
    <div class="admin-login-stage">
      <div class="admin-login-glow" aria-hidden="true"></div>
      <div class="card login">
        <img class="admin-logo" src="/assets/sakarwine-logo.png" alt="SAKARWINE" />
        <h1>${t('adminTitle')}</h1>
        <p class="muted">${t('adminSub')}</p>
        <div class="field underline-field">
          <div class="underline-wrap">
            <span class="field-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3.2 3.8-5 7-5s5.6 1.8 7 5"/></svg>
            </span>
            <div class="underline-body">
              <label for="u">${t('username')}</label>
              <input id="u" autocomplete="username" />
            </div>
          </div>
        </div>
        <div class="field underline-field">
          <div class="underline-wrap">
            <span class="field-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
            </span>
            <div class="underline-body">
              <label for="p">${t('password')}</label>
              <input id="p" type="password" autocomplete="current-password" />
            </div>
          </div>
        </div>
        <button id="go" class="block login-cta">${t('signIn')}</button>
        ${I18n.switcherHtml('admin-lang')}
        <p id="err" class="err-msg"></p>
      </div>
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
    const phone = prompt(t('confirmPhone'), btn.dataset.phone);
    const password = prompt(t('newPinPrompt'));
    if (!password) return;
    await api(`/api/admin/accounts/${id}/reset-password`, { method: 'POST', json: { phone, password } });
    return;
  }
  await api(`/api/admin/accounts/${id}/${act}`, { method: 'POST' });
}

function hostMark(a) {
  return a.isHost ? ` <span class="badge-neon badge-host" data-badge="host">${t('host')}</span>` : '';
}

function moneyPending(stats) {
  return (Number(stats.pendingUpgrades) || 0) + (Number(stats.pendingHosts) || 0) + (Number(stats.pendingPayouts) || 0);
}

function otherPending(stats) {
  return Number(stats.pendingPinRecovery) || 0;
}

function tabLabel(id, stats) {
  const labels = {
    accounts: t('tabAccounts'),
    create: t('tabCreate'),
    chats: t('tabChats'),
    upgrades: t('tabUpgrades'),
    hosts: t('tabHosts'),
    payouts: t('tabPayouts'),
    'pin-recovery': t('tabPinRecovery'),
    broadcast: t('tabBroadcast'),
    ads: t('tabAds'),
    pricing: t('tabPricing'),
    settings: t('tabSettings')
  };
  const counts = {
    upgrades: stats.pendingUpgrades,
    hosts: stats.pendingHosts,
    payouts: stats.pendingPayouts,
    'pin-recovery': stats.pendingPinRecovery
  };
  const n = counts[id];
  return `${labels[id] || id}${n ? ` (${n})` : ''}`;
}

function pickMoneyTab(stats) {
  if (stats.pendingUpgrades) return 'upgrades';
  if (stats.pendingHosts) return 'hosts';
  if (stats.pendingPayouts) return 'payouts';
  return 'upgrades';
}

function pickOtherTab(stats) {
  if (stats.pendingPinRecovery) return 'pin-recovery';
  return 'accounts';
}

function enterDesk(next, stats) {
  desk = next;
  focusAccountId = null;
  if (next === 'money' && !MONEY_TABS.includes(tab)) tab = pickMoneyTab(stats);
  if (next === 'other' && !OTHER_TABS.includes(tab)) tab = pickOtherTab(stats);
}

function deskBadge(n) {
  const count = Number(n) || 0;
  return count ? `<span class="desk-badge">${count}</span>` : '';
}

function deskHomeHtml(stats) {
  const moneyN = moneyPending(stats);
  const otherN = otherPending(stats);
  return `
    <p class="muted desk-lead">${t('adminDeskChoose')}</p>
    <div class="desk-grid">
      <button type="button" class="desk-card" data-desk="money">
        <span class="desk-card-title">${esc(t('adminDeskMoney'))}${deskBadge(moneyN)}</span>
        <span class="desk-card-help">${esc(t('adminDeskMoneyHelp'))}</span>
        <span class="desk-card-meta">
          <span>${esc(t('pendingUpgrades'))}: <b>${stats.pendingUpgrades || 0}</b></span>
          <span>${esc(t('pendingHosts'))}: <b>${stats.pendingHosts || 0}</b></span>
          <span>${esc(t('payouts'))}: <b>${stats.pendingPayouts || 0}</b></span>
        </span>
      </button>
      <button type="button" class="desk-card" data-desk="other">
        <span class="desk-card-title">${esc(t('adminDeskOther'))}${deskBadge(otherN)}</span>
        <span class="desk-card-help">${esc(t('adminDeskOtherHelp'))}</span>
        <span class="desk-card-meta">
          <span>${esc(t('pendingPinRecovery'))}: <b>${stats.pendingPinRecovery || 0}</b></span>
          <span>${esc(t('accounts'))}: <b>${stats.users}</b></span>
          <span>${esc(t('chats'))}: <b>${stats.conversations}</b></span>
        </span>
      </button>
    </div>`;
}

function deskWorkHtml(stats) {
  const isMoney = desk === 'money';
  const deskTabs = isMoney ? MONEY_TABS : OTHER_TABS;
  const pending = isMoney ? moneyPending(stats) : otherPending(stats);
  const statsHtml = isMoney
    ? `<div class="stats">
        <div class="stat"><span>${t('pendingUpgrades')}</span><b>${stats.pendingUpgrades}</b></div>
        <div class="stat"><span>${t('pendingHosts')}</span><b>${stats.pendingHosts || 0}</b></div>
        <div class="stat"><span>${t('payouts')}</span><b>${stats.pendingPayouts || 0}</b></div>
      </div>
      ${stats.pendingUpgrades ? `<div class="notice">${t('adminNoticeUpgrades')}</div>` : ''}
      ${stats.pendingHosts ? `<div class="notice">${t('adminNoticeHosts')}</div>` : ''}
      ${stats.pendingPayouts ? `<div class="notice">${t('adminNoticePayouts', { n: stats.pendingPayouts })}</div>` : ''}`
    : `<div class="stats">
        <div class="stat"><span>${t('accounts')}</span><b>${stats.users}</b></div>
        <div class="stat"><span>${t('active')}</span><b>${stats.active}</b></div>
        <div class="stat"><span>${t('online')}</span><b>${stats.online}</b></div>
        <div class="stat"><span>${t('pendingPinRecovery')}</span><b>${stats.pendingPinRecovery || 0}</b></div>
        <div class="stat"><span>${t('chats')}</span><b>${stats.conversations}</b></div>
      </div>
      ${stats.pendingPinRecovery ? `<div class="notice">${t('adminNoticePin', { n: stats.pendingPinRecovery })}</div>` : ''}`;
  const lookupHtml = isMoney
    ? ''
    : `<div class="lookup">
        <label class="field" style="margin:0;flex:1">
          <span>${t('findById')}</span>
          <input id="lookup" value="${esc(lookupQ)}" placeholder="${esc(t('lookupPlaceholder'))}" autocomplete="off" />
        </label>
        <button id="lookup-go">${t('openDossier')}</button>
        <div id="lookup-hits" class="lookup-hits" hidden></div>
      </div>`;
  const tabsHtml = deskTabs
    .map((id) => `<button data-t="${id}" class="${!focusAccountId && tab === id ? 'on' : ''}">${esc(tabLabel(id, stats))}</button>`)
    .join('');
  return `
    <div class="desk-bar">
      <button type="button" class="ghost" id="desk-back">${t('adminDeskBack')}</button>
      <h2 class="desk-bar-title">${esc(isMoney ? t('adminDeskMoney') : t('adminDeskOther'))}${deskBadge(pending)}</h2>
    </div>
    ${statsHtml}
    ${lookupHtml}
    <div class="tabs">${tabsHtml}</div>
    <div class="card" id="panel">${t('loading')}</div>`;
}

function nrcBlock(a) {
  if (a.gender !== 'female') return '';
  const passport = a.idDocType === 'passport';
  const docLabel = passport ? t('idDocPassportOnly') : t('idDocNrcPair');
  return `
    <p class="muted">${t('idDocLabel')}: <strong>${esc(docLabel)}</strong></p>
    <div class="nrc-pair">
      ${a.nrcFrontUrl ? `<a href="${a.nrcFrontUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcFrontUrl}" alt="${esc(passport ? t('passportFront') : t('nrcFront'))}" /></a>` : `<span class="muted">${esc(t('noPhotoFront'))}</span>`}
      ${passport ? '' : a.nrcBackUrl ? `<a href="${a.nrcBackUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcBackUrl}" alt="${esc(t('nrcBack'))}" /></a>` : `<span class="muted">${esc(t('noNrcBack'))}</span>`}
    </div>
    <p class="muted">${t('hostStatusLabel')}: ${esc(st(a.hostStatus || 'none'))}${a.isHost ? ` · ${t('verifiedHost')}` : ''}</p>
    ${a.hostStatus === 'pending' || a.hostStatus === 'rejected' || (a.hostStatus === 'approved' && !a.isHost) ? `<div class="actions">
      <button data-host-ok="${a.id}">${t('approveHost')}</button>
      <button class="danger" data-host-no="${a.id}">${t('rejectHost')}</button>
    </div>` : a.hostStatus === 'approved' ? `<div class="actions"><button class="danger" data-host-no="${a.id}">${t('revokeHost')}</button></div>` : ''}`;
}

function upgradeCard(u) {
  const gift = Boolean(u.gift);
  const payer = u.submitter || { accountId: u.accountId, username: u.username, phone: u.phone };
  const target = u.target || payer;
  return `
    <div class="notice${u.paidActive ? ' paid-active' : ''}${u.extraUpgrade ? ' extra-upgrade' : ''}">
      <div class="row">
        <div>
          <span class="badge ${u.status}">${esc(st(u.status))}</span>
          ${gift ? `<span class="extra-upgrade-badge">${esc(t('upgradeGift'))}</span>` : `<span class="muted">${esc(t('upgradeSelf'))}</span>`}
          ${u.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
          <div><strong>${esc(t('upgradePaidBy'))}</strong> ${esc(payer.accountId)} · ${esc(payer.username)} · ${esc(payer.phone)}</div>
          <div><strong>${esc(t('upgradeFor'))}</strong> ${esc(target.accountId)} · ${esc(target.username)}${target.phone ? ` · ${esc(target.phone)}` : ''}</div>
          <div>${esc(monthsLabel(u.months))} · ${money(u.amount, u.currency)} · ${esc(t('targetLv', { lv: t('lv', { n: target.level != null ? target.level : u.level }) }))}</div>
          ${u.hostCode ? `<div>${esc(t('hostCodeUsed', { code: u.hostCode }))}</div>` : ''}
          <div class="muted">${new Date(u.createdAt).toLocaleString(I18n.locale())}</div>
        </div>
        ${u.receiptUrl ? `<a href="${u.receiptUrl}" target="_blank"><img class="thumb" src="${u.receiptUrl}" alt="${esc(t('receiptAlt'))}" /></a>` : ''}
      </div>
      ${u.status === 'pending' ? `<div class="actions" style="margin-top:8px">
        <button data-ok="${u.id}">${t('approveStartPaid')}</button>
        <button class="danger" data-no="${u.id}">${t('rejectHost')}</button>
      </div>` : ''}
    </div>`;
}

async function bootDash() {
  setAdminLoginChrome(false);
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
    if (!input) return;
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
            <span class="muted"> · ${esc(m.phone)} · ${st(m.status)}${m.badge ? ` · ${esc(m.badge)}` : ''}${m.paidActive ? ` · ${t('paidShort')}` : ''}</span>
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
      panel.innerHTML = `<p>${esc(I18n.error(err.message))}</p>
        ${(matches || []).map((m) => `<div class="notice" data-open-id="${esc(m.accountId)}" style="cursor:pointer">${esc(m.accountId)} · ${esc(m.username)}</div>`).join('')}
        <button data-leave>${t('back')}</button>`;
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
    const paidLine = paidRemainLine(a.paidUntil);
    panel.innerHTML = `
      <div class="row">
        <button data-leave>${t('allAccounts')}</button>
        <h2 style="margin:0">${t('accountHeading', { id: a.accountId })}</h2>
      </div>
      <div class="dossier${a.paidActive ? ' paid-active' : ''}">
        <section>
          <h3>${t('profileSection')}</h3>
          <p>
            <strong>${esc(a.username)}</strong>
            ${a.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
            ${a.badge ? `<span class="badge-neon" data-badge="${esc(a.badge)}">${esc(a.badge)}</span>` : ''}
            ${hostMark(a)}
            <span class="badge ${a.status}">${esc(st(a.status))}</span>
            ${a.online ? `· ${t('onlineShort')}` : ''}
            ${a.createdByAdmin ? `· ${t('adminCreated')}` : ''}
            ${a.isSpecial ? `· ${t('unlimitedChat')}` : ''}
          </p>
          ${a.photoUrl ? `<img class="thumb user-ava" src="${a.photoUrl}" alt="" />` : ''}
          <p class="muted">${t('phone')} ${esc(a.phone)} · ${esc(gLabel(a.gender))} · ${t('born', { year: a.birthYear })}<br>
            <span class="badge-lv">${t('lv', { n: a.level })}</span> · ${t('paidUntilLabel')} <span id="admin-paid-remain" class="paid-tick">${esc(paidLine)}</span><br>
            ${t('accountId')} ${a.accountIdHidden ? t('idHiddenLounge') : t('idVisibleLounge')}
            ${a.hostCode ? `<br>${t('hostCode')} ${esc(a.hostCode)}` : ''}
            ${a.bio ? `<br>${t('bio')}: ${esc(a.bio)}` : ''}</p>
          ${a.gender === 'female' ? `<h3>${t('idVerification')}</h3>${nrcBlock(a)}` : ''}
          ${data.hostIncome ? `<h3>${t('hostEarnings')}</h3>
            <p><strong>${Number(data.hostIncome.hostBalance != null ? data.hostIncome.hostBalance : data.hostIncome.hostEarnings || 0).toLocaleString()} MMK</strong> ${t('available')}
              <span class="muted"> · ${t('earned')} ${Number(data.hostIncome.hostEarnings || 0).toLocaleString()} · ${t('adminHostCreditHelp', { amount: data.hostIncome.hostCreditAmount })}</span></p>
            ${(data.hostIncome.hostIncomeLedger || []).length
              ? data.hostIncome.hostIncomeLedger.map((row) => `<div class="muted">+${row.amount} · ${esc(row.partner && row.partner.username ? row.partner.username : t('upgradeTitle'))} · ${row.partner && row.partner.level != null ? t('lv', { n: row.partner.level }) : '—'} · ${new Date(row.createdAt).toLocaleString(I18n.locale())}</div>`).join('')
              : `<p class="muted">${t('noHostCredits')}</p>`}
            ${(data.hostIncome.hostPayouts || []).length
              ? `<h3>${t('payouts')}</h3>${data.hostIncome.hostPayouts.map((p) => `<div class="muted">${esc(st(p.status))} · −${p.amount} · ${p.method === 'kbz' ? t('kbz') : t('wave')} · ${esc(p.payeeName)} · ${esc(p.payeePhone)}</div>`).join('')}`
              : ''}` : ''}
          ${a.isSpecial || data.badges ? `<div class="field"><label>${t('roleBadge')}</label>
            <select id="dossier-badge">
              <option value="">${t('roleBadgeNone')}</option>
              ${data.badges.map((b) => `<option ${a.badge === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            </select>
            <button id="save-badge">${t('saveBadge')}</button>
          </div>` : ''}
          <div class="actions">${moderationButtons(a)}</div>
        </section>
        <section>
          <h3>${t('tabUpgrades')}</h3>
          ${data.upgrades.length ? data.upgrades.map(upgradeCard).join('') : `<p class="muted">${t('noUpgrades')}</p>`}
        </section>
        <section>
          <h3>${t('tabChats')}</h3>
          ${data.conversations.length ? data.conversations.map((c) => `
            <div class="notice" data-open="${c.id}" style="cursor:pointer">
              <strong>#${c.id}</strong> ${t('withUser', { name: c.peer.username })} (${esc(c.peer.accountId)}) · ${t('messagesCount', { n: c.messageCount })}
              <div class="muted">${c.lastMessage ? esc((I18n.localizeChatBody && I18n.localizeChatBody(c.lastMessage.body, { name: '' })) || c.lastMessage.body || c.lastMessage.type) : t('noMessages')} · ${t('startedLabel')} ${new Date(c.startedAt).toLocaleString(I18n.locale())}</div>
            </div>`).join('') : `<p class="muted">${t('noConversations')}</p>`}
          <div id="dossier-thread"></div>
        </section>
        <section>
          <h3>${t('blocksSection')}</h3>
          <p class="muted">${t('blockedByThis')}: ${data.blocked.length ? data.blocked.map((u) => esc(u.username)).join(', ') : t('noneLabel')}</p>
          <p class="muted">${t('blockedThis')}: ${data.blockedBy.length ? data.blockedBy.map((u) => esc(u.username)).join(', ') : t('noneLabel')}</p>
        </section>
      </div>`;
    startPaidTick(panel.querySelector('#admin-paid-remain'), a.paidUntil);
    panel.querySelector('[data-leave]').onclick = () => {
      stopPaidTick();
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
              <div class="msg"><div class="muted">${m.sender ? esc(m.sender.username) : t('systemSender')} · ${new Date(m.createdAt).toLocaleString(I18n.locale())}</div>
              ${m.type === 'image' && m.mediaUrl ? `<img class="thumb" src="${m.mediaUrl}" alt="" />` : ''}
              ${m.type === 'voice' && m.mediaUrl ? `<audio controls src="${m.mediaUrl}"></audio>` : ''}
              <div>${esc((I18n.localizeChatBody && I18n.localizeChatBody(m.body, { name: a.username })) || m.body || m.type)}</div></div>`).join('')}</div>
            ${thread.conversation.involvesAdmin ? `<button data-msg="${thread.conversation.id}" data-msg-open="${thread.conversation.messagingOpen ? '0' : '1'}">${thread.conversation.messagingOpen ? t('closeMessaging') : t('reopenMessaging')}</button>` : ''}
            <button data-expire="${thread.conversation.id}">${t('expireFree')}</button>`;
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
            alert(t('expireFreeOk'));
          };
        }
      } catch (err) {
        alert(I18n.error(err.message));
      }
    };
    const saveBadge = $('#save-badge');
    if (saveBadge) {
      saveBadge.onclick = async (e) => {
        e.stopPropagation();
        const badge = $('#dossier-badge').value;
        if (!badge) return alert(t('errBadge'));
        try {
          await api(`/api/admin/accounts/${a.id}/badge`, { method: 'POST', json: { badge } });
          await render();
        } catch (err) {
          alert(I18n.error(err.message));
        }
      };
    }
  }

  async function render() {
    paintUi = render;
    const stats = await api('/api/admin/stats');
    document.title = t('adminTitle');
    root.innerHTML = `
      <div class="admin-dash">
        <div class="admin-dash-glow" aria-hidden="true"></div>
        <header class="admin-head">
          <div>
            <h1>${t('adminTitle')}</h1>
            <div class="muted">${t('signedInAs', { name: me.username })}</div>
          </div>
          ${I18n.switcherHtml('admin-lang')}
          <button class="ghost" id="out">${t('signOut')}</button>
        </header>
        ${desk ? deskWorkHtml(stats) : deskHomeHtml(stats)}
      </div>`;
    I18n.bindSwitcher('admin-lang');
    $('#out').onclick = async () => {
      await api('/api/admin/logout', { method: 'POST' });
      desk = null;
      tab = 'accounts';
      showLogin();
    };
    document.querySelectorAll('[data-desk]').forEach((b) => {
      b.onclick = () => {
        enterDesk(b.dataset.desk, stats);
        render();
      };
    });
    const deskBack = $('#desk-back');
    if (deskBack) {
      deskBack.onclick = () => {
        desk = null;
        focusAccountId = null;
        render();
      };
    }
    if (!desk) return;
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
      panel.innerHTML = `<div class="account-id-list">${accounts.map((a) => `
        <button type="button" class="account-id-chip ${a.paidActive ? 'paid-active' : ''}" data-open-id="${esc(a.accountId)}">${esc(a.accountId)}</button>`).join('')}
      </div>`;
      panel.onclick = (e) => {
        const open = e.target.closest('[data-open-id]');
        if (open) openDossier(open.dataset.openId);
      };
    } else if (tab === 'create') {
      const { badges } = await api('/api/admin/accounts');
      const year = new Date().getFullYear();
      let years = '';
      for (let i = year - 18; i >= 1950; i--) years += `<option value="${i}">${i}</option>`;
      panel.innerHTML = `
        <h2>${t('createSpecialTitle')}</h2>
        <p class="muted">${t('createSpecialHelp')}</p>
        <form id="create-special">
          <div class="grid-form">
            <div class="field"><label>${t('username')}</label><input name="username" required minlength="1" maxlength="12" autocomplete="username" spellcheck="false" autocapitalize="none" pattern="[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]{1,12}" title="${esc(t('usernameRule'))}" /></div>
            <div class="field"><label>${t('pin6')}</label><input name="password" required pattern="\\d{6}" maxlength="6" /></div>
            <div class="field"><label>${t('gender')}</label>
              <select name="gender"><option value="female">${t('female')}</option><option value="male">${t('male')}</option></select>
            </div>
            <div class="field"><label>${t('birthYear')}</label><select name="birthYear">${years}</select></div>
            <div class="field"><label>${t('phone')}</label><input name="phone" required /></div>
            <div class="field"><label>${t('roleBadge')}</label>
              <select name="badge" id="badge-select">
                ${badges.map((b) => `<option>${esc(b)}</option>`).join('')}
                <option value="__custom">${t('customOption')}</option>
              </select>
            </div>
          </div>
          <p class="muted">${esc(t('usernameRule'))}</p>
          <div class="field" id="custom-badge-wrap" hidden>
            <label>${t('customBadge')}</label>
            <input id="custom-badge" maxlength="24" placeholder="${esc(t('customBadgePh'))}" />
          </div>
          <div class="field"><label>${t('photoOptional')}</label><input name="photo" type="file" accept="image/*" /></div>
          <p class="muted">${t('previewLabel')}: <span class="badge-neon" id="badge-preview" data-badge="${esc(badges[0] || 'VVIP')}">${esc(badges[0] || 'VVIP')}</span></p>
          <button type="submit">${t('createUnlimited')}</button>
          <p id="create-msg" class="muted"></p>
        </form>`;
      const select = $('#badge-select');
      const preview = $('#badge-preview');
      const customWrap = $('#custom-badge-wrap');
      const custom = $('#custom-badge');
      const syncPreview = () => {
        const v = select.value === '__custom' ? (custom.value || 'custom') : select.value;
        preview.textContent = v;
        preview.dataset.badge = v;
        customWrap.hidden = select.value !== '__custom';
      };
      select.onchange = syncPreview;
      custom.oninput = syncPreview;
      $('#create-special').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!USERNAME_RE.test(String(fd.get('username') || '').trim())) {
          $('#create-msg').textContent = t('usernameRule');
          return;
        }
        let badge = fd.get('badge');
        if (badge === '__custom') badge = custom.value.trim();
        fd.set('badge', badge);
        try {
          const created = await api('/api/admin/accounts', { method: 'POST', body: fd });
          $('#create-msg').textContent = t('createdSpecial', { name: created.user.username, id: created.user.accountId });
          await openDossier(created.user.accountId);
        } catch (err) {
          $('#create-msg').textContent = I18n.error(err.message);
        }
      };
    } else if (tab === 'chats') {
      const { conversations } = await api('/api/admin/conversations');
      panel.innerHTML = conversations.map((c) => `
        <div class="notice" style="cursor:pointer" data-open="${c.id}">
          <strong>#${c.id}</strong> ${c.users.map((u) => `${esc(u.username)} (${esc(u.accountId)})`).join(' ↔ ')}
          <div class="muted">${c.lastMessage ? esc((I18n.localizeChatBody && I18n.localizeChatBody(c.lastMessage.body, { name: '' })) || c.lastMessage.body || c.lastMessage.type) : t('noMessages')} · ${t('startedLabel')} ${new Date(c.startedAt).toLocaleString(I18n.locale())}</div>
        </div>`).join('') || `<p class="muted">${t('noConversations')}</p>`;
      panel.onclick = async (e) => {
        const n = e.target.closest('[data-open]');
        if (!n) return;
        const data = await api(`/api/admin/conversations/${n.dataset.open}`);
        panel.innerHTML = `
          <button data-back>${t('back')}</button>
          <p>${data.conversation.users.map((u) => `<button class="ghost" data-open-id="${esc(u.accountId)}">${esc(u.username)} · ${esc(u.accountId)}</button> · ${esc(u.phone)}`).join('<br>')}</p>
          ${data.conversation.involvesAdmin ? `<p class="muted">${t('memberMessaging')}: ${data.conversation.messagingOpen ? t('msgOpen') : t('msgClosed')}
            <button data-msg="${data.conversation.id}" data-msg-open="${data.conversation.messagingOpen ? '0' : '1'}">${data.conversation.messagingOpen ? t('closeMessaging') : t('reopenMessaging')}</button></p>` : ''}
          <div class="chat-log">${data.messages.map((m) => `
            <div class="msg"><div class="muted">${m.sender ? esc(m.sender.username) : t('systemSender')} · ${new Date(m.createdAt).toLocaleString(I18n.locale())}</div>
            ${m.type === 'image' && m.mediaUrl ? `<img class="thumb" src="${m.mediaUrl}" />` : ''}
            ${m.type === 'voice' && m.mediaUrl ? `<audio controls src="${m.mediaUrl}"></audio>` : ''}
            <div>${esc((I18n.localizeChatBody && I18n.localizeChatBody(m.body, { name: '' })) || m.body || m.type)}</div></div>`).join('')}</div>
          <button data-expire="${data.conversation.id}">${t('expireFree')}</button>`;
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
          alert(t('expireFreeOk'));
        };
      };
    } else if (tab === 'upgrades') {
      const { upgrades } = await api('/api/admin/upgrades');
      panel.innerHTML = upgrades.map(upgradeCard).join('') || `<p class="muted">${t('noUpgrades')}</p>`;
      panel.onclick = async (e) => {
        const ok = e.target.closest('[data-ok]');
        const no = e.target.closest('[data-no]');
        try {
          if (ok) await api(`/api/admin/upgrades/${ok.dataset.ok}/approve`, { method: 'POST' });
          if (no) await api(`/api/admin/upgrades/${no.dataset.no}/reject`, { method: 'POST' });
          if (ok || no) render();
        } catch (err) {
          alert(I18n.error(err.message));
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
              <span class="badge ${a.hostStatus}">${esc(st(a.hostStatus))}</span>
              ${hostMark(a)}
              <strong>${esc(a.username)}</strong>
              ${a.extraUpgrade ? `<span class="extra-upgrade-badge">${esc(t('extraUpgrade'))}</span>` : ''}
              <button class="ghost" data-open-id="${esc(a.accountId)}">${esc(a.accountId)}</button><br>
              ${t('phone')} ${esc(a.phone)}
            </div>
          </div>
          ${nrcBlock(a)}
        </div>`
            )
            .join('')
        : `<p class="muted">${t('noHostVerifications')}</p>`;
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
          alert(I18n.error(err.message));
        }
      };
    } else if (tab === 'payouts') {
      const { payouts } = await api('/api/admin/payouts');
      panel.innerHTML = payouts.length
        ? payouts.map((p) => `
        <div class="notice">
          <span class="badge ${p.status}">${esc(st(p.status))}</span>
          <strong>${esc(p.host && p.host.username)}</strong>
          <button class="ghost" data-open-id="${esc(p.host && p.host.accountId)}">${esc(p.host && p.host.accountId)}</button><br>
          −${Number(p.amount).toLocaleString()} MMK · ${p.method === 'kbz' ? t('kbz') : t('wave')}<br>
          ${esc(p.payeeName)} · ${esc(p.payeePhone)}
          <div class="muted">${new Date(p.createdAt).toLocaleString(I18n.locale())}</div>
          ${p.status === 'pending' ? `<div class="actions" style="margin-top:8px"><button data-pay-done="${p.id}">${t('doneMoneySent')}</button></div>` : ''}
        </div>`).join('')
        : `<p class="muted">${t('noPayouts')}</p>`;
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
          alert(I18n.error(err.message));
        }
      };
    } else if (tab === 'pin-recovery') {
      const { requests } = await api('/api/admin/pin-recovery');
      panel.innerHTML = requests.length
        ? requests
            .map(
              (r) => `
        <div class="notice">
          <span class="badge ${esc(r.status)}">${esc(st(r.status))}</span>
          <strong>${esc(r.accountId)}</strong>
          ${r.username ? ` · ${esc(r.username)}` : ''}
          ${r.accountFound ? `<button class="ghost" data-open-id="${esc(r.accountId)}">${esc(r.accountId)}</button>` : ''}<br>
          ${t('submittedPhone')} ${esc(r.phone)}
          <div class="muted">${
            r.matched
              ? t('noticePinMatch')
              : r.accountFound
                ? t('noticePinPhoneMismatch')
                : t('noticePinNoAccount')
          }</div>
          <div class="muted">${new Date(r.createdAt).toLocaleString(I18n.locale())}</div>
          ${r.status === 'pending' ? `<div class="actions" style="margin-top:8px">
            ${r.userId ? `<button data-act="reset" data-id="${r.userId}" data-phone="${esc(r.phone)}">${t('resetPin')}</button>` : ''}
            <button data-pin-done="${r.id}">${t('markReviewed')}</button>
          </div>` : ''}
        </div>`
            )
            .join('')
        : `<p class="muted">${t('noPinRequests')}</p>`;
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
          alert(I18n.error(err.message));
        }
      };
    } else if (tab === 'broadcast') {
      panel.innerHTML = `
        <h2>${t('broadcastTitle')}</h2>
        <p class="muted">${t('broadcastHelp')}</p>
        <div class="field">
          <label>${t('broadcastAudience')}</label>
          <div class="row" style="gap:16px;flex-wrap:wrap">
            <label><input type="radio" name="bc-mode" value="all" ${broadcastMode === 'all' ? 'checked' : ''} /> ${t('broadcastToAll')}</label>
            <label><input type="radio" name="bc-mode" value="ids" ${broadcastMode === 'ids' ? 'checked' : ''} /> ${t('broadcastToIds')}</label>
          </div>
        </div>
        <div id="bc-ids-wrap" ${broadcastMode === 'ids' ? '' : 'hidden'}>
          <div class="field lookup">
            <label>${t('broadcastPickIds')}</label>
            <input id="bc-id-q" value="" placeholder="${esc(t('broadcastPickPh'))}" autocomplete="off" />
            <div id="bc-id-hits" class="lookup-hits" hidden></div>
          </div>
          <div id="bc-id-list"></div>
        </div>
        <div class="field"><label>${t('systemMessage')}</label><textarea id="bc-body" rows="4" placeholder="${esc(t('optionalText'))}"></textarea></div>
        <div class="field"><label>${t('imageOptional')}</label><input id="bc-img" type="file" accept="image/*" /></div>
        <button id="bc-go">${broadcastMode === 'ids' ? t('sendToSelected') : t('sendEveryone')}</button>
        <p id="bc-msg"></p>`;
      const paintBcStatus = (text, isError) => {
        const el = $('#bc-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = text ? `notice${isError ? ' is-error' : ''}` : '';
      };
      const paintBcTargets = () => {
        const list = $('#bc-id-list');
        if (!list) return;
        list.innerHTML = broadcastTargets.length
          ? broadcastTargets
              .map(
                (a) =>
                  `<div class="notice row"><strong>${esc(a.accountId)}</strong> · ${esc(a.username)}<button type="button" class="ghost" data-bc-del="${esc(a.accountId)}">${t('remove')}</button></div>`
              )
              .join('')
          : `<p class="muted">${t('broadcastSelectedNone')}</p>`;
        list.querySelectorAll('[data-bc-del]').forEach((btn) => {
          btn.onclick = () => {
            broadcastTargets = broadcastTargets.filter((x) => x.accountId !== btn.dataset.bcDel);
            paintBcTargets();
          };
        });
      };
      const addBcTarget = async (accountId) => {
        const id = String(accountId || '').trim();
        if (!id) return;
        if (broadcastTargets.some((x) => x.accountId.toLowerCase() === id.toLowerCase())) {
          $('#bc-id-q').value = '';
          const hits = $('#bc-id-hits');
          if (hits) hits.hidden = true;
          return;
        }
        try {
          const data = await api(`/api/admin/search?q=${encodeURIComponent(id)}`);
          const matches = data.matches || [];
          const exact = matches.find((m) => String(m.accountId).toLowerCase() === id.toLowerCase()) || matches[0];
          if (!exact || !exact.accountId) {
            paintBcStatus(I18n.error('Account not found.'), true);
            return;
          }
          if (!broadcastTargets.some((x) => x.accountId === exact.accountId)) {
            broadcastTargets.push({ accountId: exact.accountId, username: exact.username });
          }
          paintBcTargets();
          $('#bc-id-q').value = '';
          const hits = $('#bc-id-hits');
          if (hits) {
            hits.hidden = true;
            hits.innerHTML = '';
          }
        } catch (err) {
          paintBcStatus(I18n.error(err.message), true);
        }
      };
      paintBcTargets();
      document.querySelectorAll('input[name="bc-mode"]').forEach((radio) => {
        radio.onchange = () => {
          broadcastMode = radio.value === 'ids' ? 'ids' : 'all';
          const wrap = $('#bc-ids-wrap');
          if (wrap) wrap.hidden = broadcastMode !== 'ids';
          const go = $('#bc-go');
          if (go) go.textContent = broadcastMode === 'ids' ? t('sendToSelected') : t('sendEveryone');
        };
      });
      const qInput = $('#bc-id-q');
      const hits = $('#bc-id-hits');
      let searchT;
      if (qInput && hits) {
        const paintHits = (matches) => {
          if (!matches.length) {
            hits.hidden = true;
            hits.innerHTML = '';
            return;
          }
          hits.hidden = false;
          hits.innerHTML = matches
            .map(
              (m) => `<button type="button" class="hit" data-aid="${esc(m.accountId)}">
                <strong>${esc(m.accountId)}</strong> · ${esc(m.username)}
              </button>`
            )
            .join('');
          hits.querySelectorAll('.hit').forEach((b) => {
            b.onclick = () => addBcTarget(b.dataset.aid);
          });
        };
        qInput.addEventListener('input', () => {
          clearTimeout(searchT);
          searchT = setTimeout(async () => {
            const q = qInput.value.trim();
            if (q.length < 2) {
              hits.hidden = true;
              return;
            }
            try {
              const data = await api(`/api/admin/search?q=${encodeURIComponent(q)}`);
              paintHits(data.matches || []);
            } catch {
              hits.hidden = true;
            }
          }, 180);
        });
        qInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addBcTarget(qInput.value);
          }
        });
      }
      $('#bc-go').onclick = async () => {
        if (broadcastMode === 'ids' && !broadcastTargets.length) {
          paintBcStatus(t('errBroadcastTargets'), true);
          return;
        }
        const fd = new FormData();
        fd.append('body', $('#bc-body').value);
        fd.append('mode', broadcastMode);
        if (broadcastMode === 'ids') {
          fd.append('accountIds', JSON.stringify(broadcastTargets.map((a) => a.accountId)));
        }
        const file = $('#bc-img').files[0];
        if (file) fd.append('image', file);
        const go = $('#bc-go');
        if (go) go.disabled = true;
        try {
          const data = await api('/api/admin/broadcast', { method: 'POST', body: fd });
          $('#bc-body').value = '';
          $('#bc-img').value = '';
          paintBcStatus(t('sentToMembers', { n: data.sent }));
        } catch (err) {
          paintBcStatus(I18n.error(err.message), true);
        } finally {
          if (go) go.disabled = false;
        }
      };
    } else if (tab === 'ads') {
      const { ads } = await api('/api/admin/ads');
      panel.innerHTML = `
        <h2>${t('homeAds')}</h2>
        <p class="muted">${t('adsHelp')}</p>
        <div class="field"><label>${t('newBanner')}</label><input id="ad-file" type="file" accept="image/*" /></div>
        <button id="ad-add">${t('addBanner')}</button>
        <div id="ad-list" style="margin-top:16px;display:grid;gap:10px">
          ${ads.length ? ads.map((a) => `<div class="notice row"><img class="thumb" src="${a.imageUrl}" alt="" /><button class="danger" data-ad-del="${a.id}">${t('remove')}</button></div>`).join('') : `<p class="muted">${t('noBanners')}</p>`}
        </div>`;
      $('#ad-add').onclick = async () => {
        const file = $('#ad-file').files[0];
        if (!file) return alert(t('chooseImage'));
        const fd = new FormData();
        fd.append('image', file);
        try {
          await api('/api/admin/ads', { method: 'POST', body: fd });
          render();
        } catch (err) {
          alert(I18n.error(err.message));
        }
      };
      panel.onclick = async (e) => {
        const del = e.target.closest('[data-ad-del]');
        if (!del) return;
        try {
          await api(`/api/admin/ads/${del.dataset.adDel}`, { method: 'DELETE' });
          render();
        } catch (err) {
          alert(I18n.error(err.message));
        }
      };
    } else if (tab === 'pricing') {
      const s = await api('/api/admin/settings');
      panel.innerHTML = `
        <div class="field"><label>${t('monthlyPrice')}</label><input id="price" type="number" value="${s.monthlyPrice}" /></div>
        <div class="field"><label>${t('currencyLabel')}</label><input id="cur" value="${s.currency}" /></div>
        <button id="savep">${t('savePricing')}</button>
        <table style="margin-top:16px"><thead><tr><th>${t('planCol')}</th><th>${t('listCol')}</th><th>${t('dueCol')}</th><th>${t('discountCol')}</th></tr></thead>
        <tbody>${s.quotes.map((q) => `<tr><td>${esc(monthsLabel(q.months))}</td><td>${money(q.gross, s.currency)}</td><td>${money(q.amount, s.currency)}</td><td>${q.discountPercent ? q.discountPercent + '%' : '—'}</td></tr>`).join('')}</tbody></table>
        <p class="muted">${t('pricingHelp')}</p>`;
      $('#savep').onclick = async () => {
        await api('/api/admin/settings', { method: 'PUT', json: { monthlyPrice: Number($('#price').value), currency: $('#cur').value } });
        render();
      };
    } else {
      const s = await api('/api/admin/settings');
      panel.innerHTML = `
        <div class="field"><label>${t('siteNameLabel')}</label><input id="sn" value="${esc(s.siteName)}" /></div>
        <div class="field"><label>${t('freeTrialDays')}</label><input id="free-trial-days" type="number" min="1" max="365" step="1" value="${Number(s.freeTrialDays) || 7}" /></div>
        <p class="muted">${t('freeTrialDaysHelp')}</p>
        <div class="field"><label>${t('paymentInstructions')}</label><textarea id="pi" rows="5">${esc(s.paymentInstructions)}</textarea></div>
        <div class="field"><label>${t('adminContactLabel')}</label><textarea id="ac" rows="3">${esc(s.adminContact)}</textarea></div>
        <p class="muted">${t('hostDemoAdminHelp')}</p>
        <div class="field">
          <label><input type="checkbox" id="maint" ${s.maintenance ? 'checked' : ''} /> ${t('maintenanceMode')}</label>
        </div>
        <p class="muted">${t('maintenanceHelp')}</p>
        <button id="saves">${t('saveSettings')}</button>`;
      $('#saves').onclick = async () => {
        await api('/api/admin/settings', {
          method: 'PUT',
          json: {
            siteName: $('#sn').value,
            freeTrialDays: Number($('#free-trial-days').value),
            paymentInstructions: $('#pi').value,
            adminContact: $('#ac').value,
            maintenance: $('#maint').checked
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
