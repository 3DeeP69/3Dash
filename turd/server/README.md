# T.U.R.D. Uplink Server

The small backend that makes **Chat** multi-user and powers the admin-only
connection log. The **core is zero-dependency** — Node 18+ core modules only (it speaks
its own WebSocket). One file: `server.js`.

## Run locally
```bash
cd server
node server.js                 # http://localhost:8787  (also serves ../web)
# open http://localhost:8787, log in admin / admin
```
To point the web app at a remote server instead, open **Chat → Link uplink** and
paste the URL (stored per-device). When no uplink is linked, Chat still runs in
**local-demo** mode (two tabs of the same browser) and the rest of T.U.R.D. uses
the offline admin/admin login.

## What it does
- **Accounts** — scrypt-hashed passkeys in `data/users.json`. First operator is
  `admin`/`admin` (forced rotation on first login, same as the shell). Anyone can
  an operator account. **Invite-only by default** — the admin creates accounts from the Chat deck's network log (or `POST /api/users`); set `OPEN_SIGNUP=1` for public self-registration.
- **Login** — issues a signed (HMAC) 7-day token; rotating a passkey or deleting
  a user revokes old tokens.
- **Chat** — one shared room, realtime over WebSocket, last 500 messages kept in
  `data/chat.json`. Messages carry only the sender's name + role.
- **Admin connection log** — `data/audit.jsonl`. For **every login attempt and
  every chat connection** it records: operator, result, IP, a coarse
  location/network lookup of that IP, the device the browser reports
  (user-agent → browser / OS / device, screen size), timezone, language, and the
  session's start/end, duration and message count.

## Privacy model (read this)
Connection details live **only** in the audit store. `GET /api/audit` returns
them **only** to a token whose role is `admin`. They are **never** sent to other
users and never appear in chat. The Chat deck shows every participant a plain
notice that their connection is logged for the admin. Turn geo lookups off
entirely with `GEOIP=0` (device/IP are still recorded; only the city/ISP lookup
is skipped). This is the owner's own server and the owner's own admin — tell your
users what's captured.

## Environment
| var | default | meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port (hosts inject this) |
| `DATA_DIR` | `./data` | where users/chat/audit/secret live |
| `STATIC_DIR` | `../web` | serve the web app too; `""` to disable |
| `GEOIP` | `1` | resolve city/ISP for public IPs (`0` to disable) |
| `OPEN_SIGNUP` | `0` | invite-only by default; `1` allows public self-registration |
| `ADMIN_PASSWORD` | – | seed admin with this instead of `admin/admin` |

## API
- `POST /api/login` `{user,pw,client}` → `{ok,role,fresh,token,user}`
- `POST /api/register` `{user,pw,client}` → same (403 if signup disabled)
- `POST /api/users` `{user,pw,role}` (admin token) → create an operator (invite-only)
- `GET  /api/users` (admin token) → list operators
- `POST /api/setpass` `{pw}` (Bearer token) → new token
- `GET  /api/audit` (admin Bearer token) → `{ok, html, count}`
- `GET  /api/health` → `{ok, version, online}`
- `GET  /ws?token=…&screen=…&tz=…&lang=…` → WebSocket chat

## Hosting (free tiers)
Any host that runs a Node process and keeps a WebSocket open works. Easiest:
- **Render** (free web service) — build `npm install` (none for the core; run it only if you enable the optional AI assistant), start
  `node server.js`; it sets `PORT`. Add a **persistent disk** mounted at
  `./data` so accounts/log survive restarts (free tier disk is small but enough).
- **Fly.io** / **Railway** — same idea, both keep WebSockets alive.
- A **Raspberry Pi / old PC** on the owner's network also works (`node server.js`)
  and keeps all data on the owner's hardware.

Avoid platforms that only do serverless HTTP functions — they drop WebSockets.
