# T.U.R.D. device sync

Owner: "Device sync" thread. Server side: "Chat for logged-in users" thread (`server/server.js`, `/api/sync`).

Everything you do in T.U.R.D. on one device shows up on your other devices (PC ⇄ Fold4), through the
T.U.R.D. server on your PC. Free, nothing leaves your home network.

## How it works

- `web/src/sync.js` starts right after login (one line in `core.js` `startApp`). Sections don't need any
  change: it watches `localStorage`, diffs each synced key against the copy it last synced, and sends only
  what changed, split into small "cells" so two devices editing different things never overwrite each other.
- Cell = `{k, id, v, ts, dev, del?}`. The server keeps per-cell last-write-wins (newer `ts` wins, tie → higher
  `dev`). Clocks are aligned to the PC's clock (`now` in every reply) so a phone with a drifting clock still
  plays fair.
- Live: a 20 s long-poll (`GET /api/sync?since=REV&wait=20`) means changes land on the other device in well
  under a second. Also syncs on focus, resume, network back, and every 5 min.
- Offline: edits queue in `turd_sync_meta` (survives restarts and Lock) and merge the next time the PC is
  reachable. The "⇅" button in the status bar shows `synced` / `N queued` / `sync off`; tap it for the device
  list and "Sync now".
- First link of a device: lists (logbook etc.) are merged item by item; settings follow whatever the server
  already has (the first device that linked), so a fresh install never resets your PC.
- Different operator on the same device: the previous operator's synced data is parked locally and restored
  when they sign back in. One person's data never goes into another's account; the server scopes every cell
  to the token's user.
- Open screens refresh themselves when the other device changes their data (Home, Logbook, Weather, Projects,
  OPSEC, Extras). Never while you're typing in it, and never for screens with live state (Assistant,
  Entertainment players, Chat, Radar): those pick up changes the next time you open them.

## Merge strategy per key

| Key | Strategy | What it is |
|---|---|---|
| `turd_log` | list by `id` (new at front) | Logbook entries, tasks, pins, done ticks |
| `turd_log_draft` | whole value | Half-typed logbook entry (start on phone, finish on PC) |
| `turd_log_wx` | whole value | "Stamp current weather" toggle |
| `turd_wx_loc`, `turd_wx_units` | whole value | Chosen weather location, °F/°C |
| `turd_wx_places` | list by `name` (max 8) | Saved weather places |
| `turd_prj_custom` | list by `id` (new at end) | Your own added projects |
| `turd_prj_autolaunch` | whole value | Projects auto-launch toggle |
| `turd_opsec` | per field | OPSEC checklist ticks |
| `turd_ent_custom` | list by `id` (new at end) | Your added entertainment sites |
| `turd_ent_prefs` | per field (per app) | Entertainment per-app preferences |
| `turd_ent_recent` | list by app+url, newest first, max 24 | "Where you left off" |
| `turd_ent_stats` | counter (per-device slices add up) | Ads blocked / opens; `since` = earliest |
| `turd_ent_mode` | whole value | Watch / Play mode |
| `turd_as_reminders` | list by `id` | Assistant reminders (fire on whichever device is open) |
| `turd_as_conv` | whole value | Current assistant conversation (continue it on the other device) |
| `turd_as_local` | whole value | On-device assistant chat log |
| `turd_as_voice`, `turd_as_effort` | whole value | Assistant voice + effort settings |
| `turd_voice_hinted` | whole value | Voice tip already shown |
| `turd_xtr_gobag` | per field | Go-bag checklist |
| `turd_xtr_night` | whole value | Reader night mode |
| `turd_netwatch` | whole value | Named / trusted devices on your home network |
| `turd_cal_view`, `turd_com_pane` | whole value | Calendar view, Community pane |
| `turd_wake` | whole value | The PC to wake (lets the Fold learn it from the PC) |
| `turd_devstatus` | whole value | Fold status reporting on/off |
| `turd_home_layout` | whole value | Shared Home layout (used only when "same layout on all my devices" is on) |
| `turd_devices` | per field (one per device) | Each device's own status row (battery, storage, last seen) |
| any new `turd_*` key | whole value | New features sync automatically unless listed below |

## Never synced

| Key | Why |
|---|---|
| `turd_users`, `turd_audit` | Local passkeys and the admin-only access log. Never leave the device. |
| `turd_token` | Sign-in token. |
| `turd_uplink`, `turd_uplink_last` | Each device reaches the PC at a different address (PC: 127.0.0.1, Fold: LAN IP). |
| `turd_quality` | Render quality is tuned to each device's GPU (low-end PC vs Fold). |
| `turd_voice_on` | The always-listening "Hey T.U.R.D." mic is a per-device choice (battery on the Fold). |
| `turd_wx_cache`, `turd_prj_cache`, `turd_prj_status`, `turd_cal_cache`, `turd_pc_last`, `turd_games_last` | Caches that refill themselves. |
| `turd_cal_events`, `turd_cal_seeded`, `turd_cal_focus` | The calendar already syncs through `/api/events`. |
| `turd_home_layout_dev`, `turd_home_follow` | Each device's own Home layout and its "same layout on all my devices" switch. |
| `turd_chat_demo*` | Demo-mode chat. |
| `turd_as_offline` | Per-device upload queue; syncing it would send answers twice. |
| `turd_xtr_state`, `turd_xtr_dir`, `turd_xtr_plat` | Downloaded files and folders exist on one device only. |
| `turd_sync_*` | The sync engine's own bookkeeping. |
| anything matching `token`, `secret`, `passw`, `apikey`, `api_key`, `credential`, or ending `_cache` | Blocked on the device **and** on the server. |

To make a new key device-only, add it to `NEVER` in `web/src/sync.js`. To give it item-level merging,
add it to `STRAT`.

## Fold status on the PC's Home

`web/src/sections/devstat.js` draws a strip under the PC strip on Home: battery (ring), charging, free
storage, battery temperature, app version, online / last seen. It prefers the Android app's native report
(`/api/devstatus`, sent every ~30 min even while the app is closed) and fills in live values from sync while
the Fold has T.U.R.D. open.

## Tests

`tools/sync-tests/twodev.mjs` — real server + real app in two browser contexts (PC + Fold4). 22/22 pass:
first-link merge, live update into an open Logbook (≈0.1 s), simultaneous edits, offline edits that merge on
reconnect, counters adding up, raw values, secrets never reaching the other device or the server store,
per-operator isolation, lock + re-login, and the Home strip (sync rows and native report).
