'use strict';

const root = document.getElementById('admin-app');
let tab = 'accounts';
let socket;

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { credentials: 'include', ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function money(n, c) {
  return `${Number(n).toLocaleString()} ${c || 'MMK'}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showLogin() {
  root.innerHTML = `
    <div class="card login">
      <h1>sakarwine admin</h1>
      <p class="muted">Protected lounge controls</p>
      <div class="field"><label>Username</label><input id="u" /></div>
      <div class="field"><label>Password</label><input id="p" type="password" /></div>
      <button id="go">Sign in</button>
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

const $ = (s, el = document) => el.querySelector(s);

async function bootDash() {
  const me = await api('/api/admin/me');
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('upgrade:new', () => {
    if (tab === 'upgrades') render();
    else render();
  });
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
        <div class="stat"><span>Chats</span><b>${stats.conversations}</b></div>
      </div>
      ${stats.pendingUpgrades ? `<div class="notice">New payment submissions need review — duration, receipt, account ID, and registered phone are in Upgrades.</div>` : ''}
      <div class="tabs">
        <button data-t="accounts" class="${tab === 'accounts' ? 'on' : ''}">Accounts</button>
        <button data-t="chats" class="${tab === 'chats' ? 'on' : ''}">Chats</button>
        <button data-t="upgrades" class="${tab === 'upgrades' ? 'on' : ''}">Upgrades ${stats.pendingUpgrades ? `(${stats.pendingUpgrades})` : ''}</button>
        <button data-t="pricing" class="${tab === 'pricing' ? 'on' : ''}">Pricing</button>
        <button data-t="settings" class="${tab === 'settings' ? 'on' : ''}">Settings</button>
      </div>
      <div class="card" id="panel">Loading…</div>`;
    $('#out').onclick = async () => {
      await api('/api/admin/logout', { method: 'POST' });
      showLogin();
    };
    document.querySelectorAll('.tabs [data-t]').forEach((b) => {
      b.onclick = () => { tab = b.dataset.t; render(); };
    });
    const panel = $('#panel');
    if (tab === 'accounts') {
      const { accounts } = await api('/api/admin/accounts');
      panel.innerHTML = `<table><thead><tr><th>Account</th><th>Phone</th><th>Lv / paid</th><th>Status</th><th></th></tr></thead><tbody>${accounts.map((a) => `
        <tr>
          <td><strong>${a.username}</strong><br><span class="muted">${a.accountId}</span></td>
          <td>${a.phone}<br><span class="muted">${a.gender} · ${a.birthYear}</span></td>
          <td>Lv ${a.level}<br>${a.paidUntil ? new Date(a.paidUntil).toLocaleDateString() : '—'}</td>
          <td><span class="badge ${a.status}">${a.status}</span> ${a.online ? '· online' : ''}</td>
          <td class="actions">
            ${a.status === 'active' ? `<button class="warn" data-act="suspend" data-id="${a.id}">Suspend</button>` : ''}
            ${a.status === 'suspended' ? `<button data-act="unsuspend" data-id="${a.id}">Unsuspend</button>` : ''}
            ${a.status !== 'closed' ? `<button class="danger" data-act="close" data-id="${a.id}">Close</button>` : ''}
            <button data-act="reset" data-id="${a.id}" data-phone="${a.phone}">Reset PIN</button>
          </td>
        </tr>`).join('')}</tbody></table>`;
      panel.onclick = async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        try {
          if (act === 'reset') {
            const phone = prompt('Confirm registered phone', btn.dataset.phone);
            const password = prompt('New 6-digit PIN');
            if (!password) return;
            await api(`/api/admin/accounts/${id}/reset-password`, { method: 'POST', json: { phone, password } });
          } else {
            await api(`/api/admin/accounts/${id}/${act}`, { method: 'POST' });
          }
          render();
        } catch (err) {
          alert(err.message);
        }
      };
    } else if (tab === 'chats') {
      const { conversations } = await api('/api/admin/conversations');
      panel.innerHTML = conversations.map((c) => `
        <div class="notice" style="cursor:pointer" data-open="${c.id}">
          <strong>#${c.id}</strong> ${c.users.map((u) => `${u.username} (${u.accountId})`).join(' ↔ ')}
          <div class="muted">${c.lastMessage ? (c.lastMessage.body || c.lastMessage.type) : 'No messages'} · started ${new Date(c.startedAt).toLocaleString()}</div>
        </div>`).join('') || '<p class="muted">No conversations yet.</p>';
      panel.onclick = async (e) => {
        const n = e.target.closest('[data-open]');
        if (!n) return;
        const data = await api(`/api/admin/conversations/${n.dataset.open}`);
        panel.innerHTML = `
          <button data-back>← Back</button>
          <p>${data.conversation.users.map((u) => `${u.username} · ${u.accountId} · ${u.phone}`).join('<br>')}</p>
          <div class="chat-log">${data.messages.map((m) => `
            <div class="msg"><div class="muted">${m.sender ? m.sender.username : 'system'} · ${new Date(m.createdAt).toLocaleString()}</div>
            ${m.type === 'image' && m.mediaUrl ? `<img class="thumb" src="${m.mediaUrl}" />` : ''}
            ${m.type === 'voice' && m.mediaUrl ? `<audio controls src="${m.mediaUrl}"></audio>` : ''}
            <div>${esc(m.body || m.type)}</div></div>`).join('')}</div>
          <button data-expire="${data.conversation.id}">Expire 24h free window (test)</button>`;
        panel.querySelector('[data-back]').onclick = render;
        panel.querySelector('[data-expire]').onclick = async () => {
          await api(`/api/admin/conversations/${data.conversation.id}/expire-free`, { method: 'POST' });
          alert('Free window expired for this chat.');
        };
      };
    } else if (tab === 'upgrades') {
      const { upgrades } = await api('/api/admin/upgrades');
      panel.innerHTML = upgrades.map((u) => `
        <div class="notice">
          <div class="row">
            <div>
              <span class="badge ${u.status}">${u.status}</span>
              <strong>${u.accountId}</strong> · ${u.username}<br>
              Phone ${u.phone} · ${u.months} month(s) · ${money(u.amount, u.currency)} · current Lv ${u.level}
              <div class="muted">${new Date(u.createdAt).toLocaleString()}</div>
            </div>
            ${u.receiptUrl ? `<a href="${u.receiptUrl}" target="_blank"><img class="thumb" src="${u.receiptUrl}" alt="receipt" /></a>` : ''}
          </div>
          ${u.status === 'pending' ? `<div class="actions" style="margin-top:8px">
            <button data-ok="${u.id}">Approve (start paid period now)</button>
            <button class="danger" data-no="${u.id}">Reject</button>
          </div>` : ''}
        </div>`).join('') || '<p class="muted">No upgrade submissions.</p>';
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
        <div class="field"><label>Site name</label><input id="sn" value="${s.siteName}" /></div>
        <div class="field"><label>Payment instructions</label><textarea id="pi" rows="5">${s.paymentInstructions}</textarea></div>
        <div class="field"><label>Admin contact (PIN recovery)</label><textarea id="ac" rows="3">${s.adminContact}</textarea></div>
        <button id="saves">Save settings</button>`;
      $('#saves').onclick = async () => {
        await api('/api/admin/settings', {
          method: 'PUT',
          json: {
            siteName: $('#sn').value,
            paymentInstructions: $('#pi').value,
            adminContact: $('#ac').value
          }
        });
        alert('Saved');
      };
    }
  }
  await render();
}

api('/api/admin/me').then(bootDash).catch(showLogin);
