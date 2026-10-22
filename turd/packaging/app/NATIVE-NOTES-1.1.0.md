# Native additions in v1.1.0 (native apps thread)

## Fold status on the PC (Bossman: yes, 2026-10-21)
- Server: `server/devstatus.js`, wired into `server.js` (literal require, so it's in the SEA bundle).
  - `POST /api/devstatus` (any signed-in token) body `{id, name, model, battery, charging, full, plug, tempC, storageFreeGB, storageTotalGB}`
  - `GET /api/devstatus` (signed in; admin sees all) -> `{ok, now, devices:[{id, user, name, model, battery, charging, full, plug, tempC, storageFreeGB, storageTotalGB, ip, lastSeen, ageSec, stale}]}`. `stale` = no report for 45+ min.
- Android reports on its own (`web/src/native.js`): on open, on resume, when charging flips or the battery moves 5%, every 5 min while open, and about every 30 min while closed (JobScheduler, network only, `TurdStatus.java`). Opt out with localStorage `turd_devstatus = false`.
- **Home card (weather/projects thread):** poll `GET /api/devstatus` with the chat token (`turd_token`) next to the PC status card. Show battery %, a charging bolt, free storage and "last seen Xm ago"; grey it out when `stale`.
- **Chat thread:** this endpoint can be folded into the PC-Fold sync later. Keep the paths and shape the same, or tell me first.

## Home network watch (`window.TURD_NATIVE.netwatch`)
- `request()` -> `{granted, reason?}` (no OS permission is needed; reports whether there is a LAN)
- `scan()` -> `[{ip, mac, vendor, hostname, gateway, self, rttMs?}]`, sorted by IP. The device itself is the row with `self:true`.
- `scanFull()` -> `{items, subnet, gateway, macs}`. `macs:false` means the OS hides MAC addresses (Android 10+).
- PC: ARP sweep of the /24 (SendARP, 24 threads), names from NetBIOS, then reverse DNS. Takes about 10-15 s.
- Fold: ping plus quick TCP probes, names from NetBIOS and reverse DNS. Takes about 10-20 s. MACs come only from NetBIOS (Windows PCs and NAS boxes). Phones and IoT devices usually show without a MAC or vendor, because Android doesn't let apps see them.
- Vendor names come from the offline IEEE OUI table `web/src/data/oui.json` (BSD-2, 40k prefixes). A randomized MAC shows "Private (randomized) address". `N.vendorOf(mac)` does the same lookup.

## Firewall (Bossman approved, 2026-10-21)
- The first time the PC app starts its chat server, Windows shows one admin prompt. It adds the inbound rule "T.U.R.D. chat server" (TCP, for turd-server.exe only, remoteip=localsubnet). If the prompt is cancelled, it isn't asked again automatically.
- `TURD_NATIVE.server.allowLan()` asks again. `server.status().firewall` reports whether the rule exists. The chat UI could show an "Allow phone access" button when `firewall` is false.
