# sakarwine

Premium real-time chatting for the web — glassmorphism lounge, 24-hour free chats, admin-approved upgrades, and a separate `/admin` dashboard.

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Admin: [http://localhost:3000/admin](http://localhost:3000/admin).

Default local admin login (change these before going live):

- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`

Copy `.env.example` into your shell or Render dashboard. The app reads standard environment variables (no extra dotenv package).

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (Render sets this) |
| `HOST` | Bind address, default `0.0.0.0` |
| `DATA_DIR` | SQLite + uploads directory (default `./data`) |
| `SESSION_SECRET` | Cookie signing / session entropy |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `/admin` login |
| `SITE_NAME` | Public brand (also editable in admin) |
| `FREE_CHAT_MS` | Free window per conversation (default 24 hours) |
| `HOST_CHAT_MS` | Continuous mutual chat required for host credit (default 10 minutes) |
| `HOST_CREDIT_AMOUNT` | Credit per qualifying visitor (default 500) |
| `HOST_WITHDRAW_MIN` | Balance that enables Withdraw (default 100000) |
| `OFFLINE_PURGE_MS` | Auto-close accounts with no activity this long (default 30 days) |

`npm test` runs filter, pricing, and API flow checks.

## What users get

- Register with username, **exactly 6-digit PIN**, profile photo, male/female, birth year, and phone. A unique `SW########` account ID is assigned.
- **Female accounts** include an **income form** (occupation, monthly income in MMK, source) and must upload **Myanmar NRC front + back** at registration. Admin approves that verification. After approval, a blue neon **host** label sits beside the level (or special) badge. NRC images are stored on disk and served only to `/admin` (no public or member URLs).
- **Host income:** a verified host earns **500** once per upgraded visitor (Lv ≥ 1) who **comes to talk** and stays in a **continuous mutual chat of at least 10 minutes**. Chats the host starts do not qualify. Going **offline** or **blocking** before 10 minutes voids that session. A different qualifying visitor adds another 500 — never per minute, never twice from the same account. Saka does not count. Withdraw lights up at **100,000**; she chooses **KBZ Pay** or **Wave** (name + phone). Balance is deducted immediately; admin **Done** sends the system note `ငွေဝင်ပါပြီ`. Hosts may keep messaging visitors who came to them without the 24-hour gate. Editing the income form after register requires **Lv ≥ 1**. The income section includes a chat-style demo video (admin can replace the URL).
- Face-scan liveness: turn your head left, then right. On-device camera tracking (skin-pixel centroid) estimates gender. **Limitation:** this is a pragmatic heuristic, not a biometric identity product — lighting, camera angle, makeup, and skin tone strongly affect results.
- After the scan, **Saka** (the AI guide account) opens a chat and a coach-mark tour explains people, photos, and voice notes.
- Home lists every active member, **online first**, then offline. An **ads banner** sits above the list (admin-managed; multiple images rotate every 5 seconds).
- Accounts with **no activity for 30 days** are auto-closed and stripped of personal data (chat history for the other person is kept).
- Each new conversation has **exactly 24 hours of free chatting**. After that, unpaid people in that chat see an upgrade prompt. Paid members may chat with unlimited people for the paid duration.
- Block anyone you don’t want. Images and voice notes are allowed; **video is not**.
- Filters: no Myanmar numbers starting with `09`; messages cannot start with `@`.
- Photos are **locked** until **Level 3** (three approved upgrades). Lower levels see a locked card and a notice on tap. You can always see photos you sent.
- **Chat history is per-user.** Deleting a conversation (trash in the chat header) clears it for you only. The other person — and admin — still keep the full thread. The Saka guide chat cannot be deleted.
- **Messages cannot be edited** after they are sent (no edit API or UI).
- Forgot PIN? There is **no self-serve reset**. Contact admin with the phone used at registration.

## Upgrades

Users submit **account ID + payment screenshot**. Admin must approve. Approval **starts the paid period immediately** and increments **level by 1**.

Plans are 1–12 months. **6 months prepaid = 30% off**. **12 months = 50% off**. The monthly amount is configured in `/admin` → Pricing. The upgrade screen shows duration covered and amount due.

## Admin (`/admin`)

Login-protected. Admins can:

- See all registered accounts (ID, phone, level, status)
- Temporarily **suspend** or permanently **close** accounts
- Reset a PIN after matching the registered phone
- Open any chat for moderation
- Review upgrade submissions (duration, receipt, account ID, registered phone) and approve/reject
- Configure site name, payment instructions, and monthly pricing
- **Look up any account ID** from the search box: typing surfaces matching IDs, and opening one shows a dossier (profile, chats, upgrades, blocks, NRC/income for female hosts, hide/unhide) so you can manage that account in one place.
- Review **female host / NRC** submissions (income + ID photos) and approve/reject. Approval grants the blue host badge.
- Review **host payouts**, mark Done after transfer, **broadcast** a system message/image to everyone, and manage **home ad banners**.

Pending upgrades show as a dashboard notice / badge.

## Deploy on Render

This repo includes a Blueprint (`render.yaml`): a Node **web service** plus a **persistent disk** at `/opt/render/project/src/data` so SQLite and uploads survive restarts.

The service binds `0.0.0.0` and uses `process.env.PORT`.

1. Push this repo to GitHub (already the case for `scorpio2026/sakarwine`).
2. In Render: **New → Blueprint**, pick the repo, or open [https://dashboard.render.com/blueprints/new](https://dashboard.render.com/blueprints/new).
3. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` when prompted (`sync: false`).
4. Use at least a **Starter** plan if you want the attached disk and an always-on URL. Free web services spin down after idle time, **cannot attach disks**, and lose the SQLite file on every deploy. Persistence still works locally and on a paid instance with the disk in `render.yaml`.
5. After the first deploy, the public site is `https://sakarwine.onrender.com` (or the name Render assigns). Admin is `https://<your-service>.onrender.com/admin`.

Health check: `GET /health`.

## Data

SQLite file: `$DATA_DIR/sakarwine.sqlite`. Uploads (profiles, chat photos, voice, receipts, NRC, ads) live under `$DATA_DIR/uploads`. NRC is admin-only. On Render, that directory is the disk mount.

## Security

Balances, levels, host credits, payouts, and admin rights are **server-authoritative**. The client cannot send a level, badge, host flag, or payout amount that the server will trust. Sessions are httpOnly cookies (`SameSite=Lax`). PINs are bcrypt-hashed. Admin routes require an admin session. Host income is credited only from server-side presence duration — never from a client-reported “10 minutes”. Sensitive routes are rate-limited; mutating requests with a foreign `Origin` are rejected. Parameterized SQL is used throughout.
