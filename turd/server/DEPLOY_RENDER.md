# Deploying the T.U.R.D. uplink to Render (free)

This puts the chat + community-calendar server online so your PC, phone and
other people can reach each other. The web app is served from the same URL.

## What you need to know first (Render free tier)
- **WebSockets work** — chat and live calendar sync are fine.
- **It sleeps after 15 minutes idle** and takes **~1 minute to wake** on the next
  visit. First person in after a quiet spell waits a few seconds.
- **No persistent disk on free** — so operator accounts, chat history and calendar
  events **reset whenever the service redeploys or restarts**. Fine for casual use
  (you just re-invite operators), but if you want it to *stick*:
  - switch `plan: free` → `plan: starter` ($7/mo) in `render.yaml` and uncomment
    the `disk:` block + `DATA_DIR` (one-line change, gives durable storage), **or**
  - run the server on your **own PC / Raspberry Pi** instead (`node server/server.js`)
    — all data stays on your hardware.

## Steps
1. **Get the code on GitHub.** Render deploys from a Git repo. If Claude has your
   GitHub connected it can push this project for you; otherwise create a repo and
   upload the `turd/` folder (it already contains `render.yaml`).
2. **Create the service.** On [render.com](https://render.com) → **New ▸ Blueprint**,
   pick the repo. Render reads `render.yaml` and sets everything up.
3. **Set your admin passkey.** Render will prompt for `ADMIN_PASSWORD` (it's marked
   `sync:false` so it's never committed). Pick a strong one — this replaces the
   default `admin/admin` so your public URL isn't wide open.
4. **Deploy.** First build takes a minute or two. When it's live you'll get a URL
   like `https://turd-uplink.onrender.com`.
5. **Point the app at it.** Open that URL (or your installed T.U.R.D. app) → **Chat**
   → **Link uplink** → paste the same URL. Log in as `admin` with the passkey you set.
6. **Invite people.** In Chat open **⬡ NET LOG → Invite an operator**, create an id +
   passkey for each person, and share it with them. That's it.

## Settings reference
All optional, set under the service's **Environment** tab:

| var | default | meaning |
|-----|---------|---------|
| `ADMIN_PASSWORD` | (you set it) | seeds the admin passkey on first boot |
| `GEOIP` | `1` | approx. location/ISP in the admin log; `0` turns it off |
| `OPEN_SIGNUP` | `0` | invite-only; `1` would allow public self-registration |
| `STATIC_DIR` | `../web` | serve the web app from this URL; `""` for API only |
| `DATA_DIR` | `./data` | where data is written (point at a mounted disk for persistence) |
