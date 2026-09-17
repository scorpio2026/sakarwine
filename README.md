# sakarwine

Premium real-time chatting for the web — green messenger-style lounge, 24-hour free chats, admin-approved upgrades, and a separate `/admin` dashboard.

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
| `HOST_CREDIT_AMOUNT` | Credit per approved upgrade that used the host’s code (default 500) |
| `HOST_WITHDRAW_MIN` | Balance that enables Withdraw (default 100000) |
| `OFFLINE_PURGE_MS` | Auto-close accounts with no activity this long (default 30 days) |
| `TRANSLATE_API_KEY` | Optional Google Cloud Translation (or LibreTranslate) key. If unset, chat falls back to MyMemory then original text |
| `TRANSLATE_URL` | Optional LibreTranslate base URL (used with `TRANSLATE_API_KEY`) |

`npm test` runs filter, pricing, and API flow checks.

## What users get

- Register with username (**max 12 characters**, English or Myanmar **letters and digits only** — no spaces or symbols), **exactly 6-digit PIN**, profile photo, male/female, birth year, and phone. A unique `SW########` account ID is assigned. Members with no uploaded photo show a **default avatar**: female on a **pink** background (`/assets/default-female.png`), male on a **black** background (`/assets/default-male.png`) until a custom male asset is provided.
- **Host apply is later, not at signup.** Female and male registration is the same (username, PIN, photo, gender, birth year, phone, face-scan). Becoming a **host** is only from **Me → Settings → Host application**: income form (occupation, monthly income in MMK, source) plus **Myanmar NRC front + back**. Admin approves that verification. After approval, a blue neon **host** label sits beside the level (or special) badge. NRC images are stored on disk and served only to `/admin` (no public or member URLs).
- **Host income:** a verified host gets an **8-digit host code** (shown on Me and in Settings). Members may optionally enter that code on **Upgrade**. Each time admin **approves** an upgrade that used the code, the host earns **500** — no per-person or lifetime cap. Blank code: upgrade proceeds with no host credit. Invalid code: the form is rejected. Chat time does not credit income. Withdraw lights up at **100,000**; she chooses **KBZ Pay** or **Wave** (name + phone). Balance is deducted immediately; admin **Done** sends the system note `ငွေဝင်ပါပြီ`. Hosts may keep messaging visitors who came to them without the 24-hour gate. Editing the income form after approval requires **Lv ≥ 1**. The income section includes a chat-style demo video (admin can replace the URL).
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
- **Settings** (Me → gear / Settings): app language (မြန်မာ / English / ไทย / 中文 / 한국어 / 日本語), **chat view language** (ask in each chat, or a default among the six), edit photo and username, manage the blocked list, **host application** (female accounts), and log out. Gender, birth year, phone, and PIN are not member-editable.
- The lounge UI (login through Settings) and admin chrome switch among **six languages**. Choice is stored in `localStorage` (`sw_lang`) and on the account (`ui_lang`); default is **Myanmar**.
- **Chat view language:** if the other person writes in a **different** language, sakarwine **asks once** which of the six languages to show for that chat (globe in the chat header to change later). If both sides already match, there is no prompt. A Settings default skips the per-chat prompt. Original text is stored with `source_lang` and stays available via **Show original**. Translations are cached. System notes and voice are not translated; image captions (text only) are. Set `TRANSLATE_API_KEY` (Google Cloud Translation, or LibreTranslate via `TRANSLATE_URL`) on Render. If the key is missing, sakarwine tries a free MyMemory fallback, then shows the original.
- The official **SAKARWINE** rainbow wordmark (`/assets/sakarwine-logo.png`) is the **app header / masthead** (People lounge) and welcome hero lockup — never a profile avatar. The mark sits on a **transparent** background (no black fill/box). Members with no uploaded photo use `/assets/default-female.png` or `/assets/default-male.png`.
- Forgot PIN? There is **no self-serve reset**. Help (`အကူအညီ`) is PIN recovery only: the screenshot Burmese + English copy, a form to send **account ID + registration phone** to admin, and a **Home** back button (`မူလစာမျက်နှာ`). Admin reviews the queue, then sets a new 6-digit PIN after verifying. The Settings PIN note still points members there.

## Upgrades

Users submit **account ID + payment screenshot**. A host’s **8-digit code is optional**. Admin must approve. Approval **starts the paid period immediately** and increments **level by 1**.

Plans are 1–12 months. **6 months prepaid = 30% off**. **12 months = 50% off**. The monthly amount is configured in `/admin` → Pricing. The upgrade screen shows duration covered and amount due.

While a paid period is still active, that account’s row in `/admin` → Accounts is **green**. After expiry it returns to the normal color. If a still-paid member submits another upgrade, a red **Extra upgrade** badge appears beside their name so admin can spot the additional purchase.

## Admin (`/admin`)

Login-protected. Admins can:

- See all registered accounts (ID, phone, level, status)
- Temporarily **suspend** or permanently **close** accounts
- Reset a PIN after matching the registered phone
- Review **PIN recovery requests** (Help form: account ID + registration phone). Dashboard count + **PIN recovery** tab. Open the dossier, reset the PIN after verifying, then mark reviewed. Submitting Help does **not** change the PIN.
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

Balances, levels, host credits, payouts, and admin rights are **server-authoritative**. Privilege fields and money amounts on request bodies are stripped. Upgrade prices come from the server quote; withdraw amount is the current available balance; host 500s are credited only when admin approves an upgrade that used that host’s code.

- PINs are bcrypt-hashed. Sessions are random httpOnly cookies (`SameSite=Lax`; `Secure` in production).
- `/admin` uses a separate cookie. Member requests cannot set admin, host, VVIP, or level.
- Rate limits on register, login, admin login, withdraw, broadcast, and presence.
- Foreign `Origin` rejected on mutating requests. CSP + `nosniff` + `DENY` framing.
- Uploads use MIME-derived extensions (client filenames ignored). NRC, receipts, and **phone numbers** are admin-only. Member APIs never include `phone` (home, chat, lightbox, `/api/me`, `/api/me/blocked`).
- `PUT /api/me/profile` accepts photo and username only. PIN, phone, gender, and privilege fields are ignored.
- Parameterized SQL. UI strings are escaped. Production 500s do not leak internals.
