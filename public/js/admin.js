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

const $ = (s, el = document) => el.querySelector(s);

function showLogin() {
  root.innerHTML = `
    <div class="card login">
      <h1>sakarwine admin</h1>
      <p class="muted">Protected lounge controls</p>
      <div class="field"><label>Username</label><input id="u" /></div>
      <div class="field"><label>Password</label><input id="p" type="password" /></div>
      <button id="go" class="block">Sign in</button>
      <p id="err" class="muted"></p>
    </div>`;
  $('#go').onclick = async () => {
    try {
      await api('/api/admin/login', { method: 'POST', json: { username: $('#u').value, password: $('#p').value } });
      bootDash();
    } catch (e) {
      $('#err').textContent = e.message;
    }
  };
}

function moderationButtons(a) {
  return `
    ${a.accountIdHidden
      ? `<button data-act="unhide-id" data-id="${a.id}">Unhide ID</button>`
      : `<button class="ghost" data-act="hide-id" data-id="${a.id}">Hide ID</button>`}
    ${a.status === 'active' ? `<button class="warn" data-act="suspend" data-id="${a.id}">Suspend</button>` : ''}
    ${a.status === 'suspended' ? `<button data-act="unsuspend" data-id="${a.id}">Unsuspend</button>` : ''}
    ${a.status !== 'closed' ? `<button class="danger" data-act="close" data-id="${a.id}">Close</button>` : ''}
    <button data-act="reset" data-id="${a.id}" data-phone="${esc(a.phone)}">Reset PIN</button>`;
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
  return `
    <div class="nrc-pair">
      ${a.nrcFrontUrl ? `<a href="${a.nrcFrontUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcFrontUrl}" alt="NRC front" /></a>` : '<span class="muted">No NRC front</span>'}
      ${a.nrcBackUrl ? `<a href="${a.nrcBackUrl}" target="_blank" rel="noopener"><img class="thumb nrc-thumb" src="${a.nrcBackUrl}" alt="NRC back" /></a>` : '<span class="muted">No NRC back</span>'}
    </div>
    <p class="muted">Host status: ${esc(a.hostStatus || 'none')}${a.isHost ? ' · verified host' : ''}</p>
    ${a.hostStatus === 'pending' || a.hostStatus === 'rejected' || (a.hostStatus === 'approved' && !a.isHost) ? `<div class="actions">
      <button data-host-ok="${a.id}">Approve host</button>
      <button class="danger" data-host-no="${a.id}">Reject</button>
    </div>` : a.hostStatus === 'approved' ? `<div class="actions"><button class="danger" data-host-no="${a.id}">Revoke host</button></div>` : ''}`;
}

function upgradeCard(u) {
  return `
    <div class="notice">
      <div class="row">
        <div>
          <span class="badge ${u.status}">${esc(u.status)}</span>
          <strong>${esc(u.accountId)}</strong> · ${esc(u.username)}<br>
          Phone ${esc(u.phone)} · ${u.months} month(s) · ${money(u.amount, u.currency)} · current Lv ${u.level}
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
          (m) => `<button type="button" class="hit" data-aid="${esc(m.accountId)}">
            <strong>${esc(m.accountId)}</strong> · ${esc(m.username)}
            <span class="muted"> · ${esc(m.phone)} · ${m.status}${m.badge ? ` · ${esc(m.badge)}` : ''}</span>
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
      <div class="dossier">
        <section>
          <h3>Profile</h3>
          <p>
            <strong>${esc(a.username)}</strong>
            ${a.badge ? `<span class="badge-neon">${esc(a.badge)}</span>` : ''}
            ${hostMark(a)}
            <span class="badge ${a.status}">${esc(a.status)}</span>
            ${a.online ? '· online' : ''}
            ${a.createdByAdmin ? '· admin-created' : ''}
            ${a.isSpecial ? '· unlimited chat' : ''}
          </p>
          ${a.photoUrl ? `<img class="thumb" src="${a.photoUrl}" alt="" />` : ''}
          <p class="muted">Phone ${esc(a.phone)} · ${esc(a.gender)} · born ${a.birthYear}<br>
            Level ${a.level} · Paid until ${paidLine}<br>
            Account ID ${a.accountIdHidden ? 'hidden from lounge' : 'visible to lounge'}
            ${a.gender === 'female' ? `<br>Income: ${incomeLine(a)}` : ''}</p>
          ${a.gender === 'female' ? `<h3>NRC verification</h3>${nrcBlock(a)}` : ''}
          ${data.hostIncome ? `<h3>Host earnings</h3>
            <p><strong>${Number(data.hostIncome.hostBalance != null ? data.hostIncome.hostBalance : data.hostIncome.hostEarnings || 0).toLocaleString()} MMK</strong> available
              <span class="muted"> · earned ${Number(data.hostIncome.hostEarnings || 0).toLocaleString()} · ${data.hostIncome.hostCreditAmount} per Lv 1+ visitor after a continuous 10-minute chat they started</span></p>
            ${(data.hostIncome.hostIncomeLedger || []).length
              ? data.hostIncome.hostIncomeLedger.map((row) => `<div class="muted">+${row.amount} · ${esc(row.partner.username)} · Lv ${row.partner.level} · ${new Date(row.createdAt).toLocaleString()}</div>`).join('')
              : '<p class="muted">No qualifying visitors credited yet.</p>'}
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
            <button data-expire="${thread.conversation.id}">Expire 24h free window</button>`;
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
    const stats = await api('/api/admin/stats');
    root.innerHTML = `
      <div class="row">
        <div>
          <h1>sakarwine admin</h1>
          <div class="muted">Signed in as ${me.username}</div>
        </div>
        <button class="ghost" id="out">Sign out</button>
      </div>
      <div class="stats">
        <div class="stat"><span>Accounts</span><b>${stats.users}</b></div>
        <div class="stat"><span>Active</span><b>${stats.active}</b></div>
        <div class="stat"><span>Online</span><b>${stats.online}</b></div>
        <div class="stat"><span>Pending upgrades</span><b>${stats.pendingUpgrades}</b></div>
        <div class="stat"><span>Pending hosts</span><b>${stats.pendingHosts || 0}</b></div>
        <div class="stat"><span>Payouts</span><b>${stats.pendingPayouts || 0}</b></div>
        <div class="stat"><span>Chats</span><b>${stats.conversations}</b></div>
      </div>
      ${stats.pendingUpgrades ? `<div class="notice">New payment submissions need review — duration, receipt, account ID, and registered phone are in Upgrades.</div>` : ''}
      ${stats.pendingHosts ? `<div class="notice">Female NRC verifications need review in Hosts — income form plus NRC front/back (admin-only).</div>` : ''}
      ${stats.pendingPayouts ? `<div class="notice">${stats.pendingPayouts} host payout(s) waiting — transfer then press Done to send ငွေဝင်ပါပြီ.</div>` : ''}
      <div class="lookup">
        <label class="field" style="margin:0;flex:1">
          <span>Find by account ID</span>
          <input id="lookup" value="${esc(lookupQ)}" placeholder="Type SW######## — profile, chats, upgrades, moderation…" autocomplete="off" />
        </label>
        <button id="lookup-go">Open dossier</button>
        <div id="lookup-hits" class="lookup-hits" hidden></div>
      </div>
      <div class="tabs">
        <button data-t="accounts" class="${!focusAccountId && tab === 'accounts' ? 'on' : ''}">Accounts</button>
        <button data-t="create" class="${!focusAccountId && tab === 'create' ? 'on' : ''}">Create special</button>
        <button data-t="chats" class="${!focusAccountId && tab === 'chats' ? 'on' : ''}">Chats</button>
        <button data-t="upgrades" class="${!focusAccountId && tab === 'upgrades' ? 'on' : ''}">Upgrades ${stats.pendingUpgrades ? `(${stats.pendingUpgrades})` : ''}</button>
        <button data-t="hosts" class="${!focusAccountId && tab === 'hosts' ? 'on' : ''}">Hosts ${stats.pendingHosts ? `(${stats.pendingHosts})` : ''}</button>
        <button data-t="payouts" class="${!focusAccountId && tab === 'payouts' ? 'on' : ''}">Payouts ${stats.pendingPayouts ? `(${stats.pendingPayouts})` : ''}</button>
        <button data-t="broadcast" class="${!focusAccountId && tab === 'broadcast' ? 'on' : ''}">Broadcast</button>
        <button data-t="ads" class="${!focusAccountId && tab === 'ads' ? 'on' : ''}">Ads</button>
        <button data-t="pricing" class="${!focusAccountId && tab === 'pricing' ? 'on' : ''}">Pricing</button>
        <button data-t="settings" class="${!focusAccountId && tab === 'settings' ? 'on' : ''}">Settings</button>
      </div>
      <div class="card" id="panel">Loading…</div>`;
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
      panel.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Account</th><th>Phone</th><th>Role / paid</th><th>ID visibility</th><th>Status</th><th></th></tr></thead><tbody>${accounts.map((a) => `
        <tr>
          <td><strong>${esc(a.username)}</strong><br>
            <button class="ghost" data-open-id="${esc(a.accountId)}">${esc(a.accountId)}</button>
            ${a.isSpecial ? `<br><span class="badge-neon">${esc(a.badge || 'special')}</span>` : ''}${a.isHost ? `<br><span class="badge-neon badge-host" data-badge="host">host</span>` : ''}${a.hostStatus === 'pending' ? '<br><span class="muted">NRC pending</span>' : ''}</td>
          <td>${esc(a.phone)}<br><span class="muted">${esc(a.gender)} · ${a.birthYear}</span></td>
          <td>${a.isSpecial ? `Unlimited · ${esc(a.badge || 'special')}` : `Lv ${a.level}<br>${a.paidUntil ? new Date(a.paidUntil).toLocaleDateString() : '—'}`}</td>
          <td>${a.accountIdHidden ? 'Hidden from lounge' : 'Visible'}</td>
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
            <div class="field"><label>Username</label><input name="username" required minlength="3" maxlength="20" /></div>
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
        <div class="notice">
          <div class="row">
            <div>
              <span class="badge ${a.hostStatus}">${esc(a.hostStatus)}</span>
              ${hostMark(a)}
              <strong>${esc(a.username)}</strong>
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
        alert('Saved');
      };
    }
  }
  await render();
}

api('/api/admin/me').then(bootDash).catch(showLogin);
