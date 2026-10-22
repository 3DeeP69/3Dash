# Handoff from "Device sync" for v1.1.0 (2026-10-21)

Web-only change, plus `/api/sync` already in the shared `server/server.js` (chat thread).

Files: new `web/src/sync.js`, new `web/src/sections/devstat.js`, one line in `web/src/core.js` startApp,
small edits in `web/src/sections/home.js` (#hmDev strip) and `sections.css` (line `#hmPc:empty,#hmDev:empty`).
Doc: `turd/SYNC.md`. Tests: `tools/sync-tests/twodev.mjs` — 22/22 pass on the real server + app.

## Changelog lines (v1.1.0 → New)
- Device sync: your logbook, tasks, settings, saved places, custom projects and sites, reminders,
  entertainment history and checklists now follow you between the PC and the Fold4 through your PC.
  Changes show up on the other device in about a second. Edits made while the Fold is away from home
  Wi-Fi are kept and merge when it's back.
- "⇅ synced" button in the status bar: sync state, your devices (battery, storage, last seen), Sync now.
- Home on the PC: a Fold4 strip with battery, charging, free storage, battery temperature and last seen.
- Passkeys, sign-in tokens, the admin access log and render quality never sync.

Both the PC server and the apps need this build for sync to work (an older PC server shows
"PC server needs the sync update" on the ⇅ button).
