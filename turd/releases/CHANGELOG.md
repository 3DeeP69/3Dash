# T.U.R.D. changelog

Every build is filed under `releases/vX.Y.Z/`. Only the newest version is current; everything below it is **superseded**.
The newest files are also mirrored in `turd/downloads/`.

To check which build you have: the version is shown under the login form and next to the T.U.R.D. wordmark (tap it for what's new). Builds before v1.0.1 don't show it.

---

## v1.1.0 (2026-10-21) · CURRENT

Windows installer, Fold4 APK and desktop zip, all v1.1.0.

| File | Size | SHA-256 |
|---|---|---|
| `TURD-1.1.0-windows-setup.exe` | 107 MB | `024324483a92…ec5e0` |
| `TURD-1.1.0-android.apk` | 45 MB | `d50d67960a1b…ef828` |
| `TURD-1.1.0-desktop.zip` | 42 MB | `99756bd526de…f66f77` |

Install over the old version. Your accounts, logbook and chat stay. The APK is signed with the same key as v1.0.0 (checked), so the Fold4 updates in place. The files are much bigger now because they include the offline voice model (46 MB).

**New**
- **Device sync.** Logbook, tasks, settings, saved places, custom projects and sites, reminders, entertainment history and checklists follow you between the PC and the Fold4 through your PC, about a second apart. Edits made away from home Wi-Fi merge when the Fold gets back. Passkeys, sign-in tokens and the access log never sync. The "⇅ synced" button in the top bar shows your devices and has Sync now.
- **"Hey T.U.R.D." hands-free voice.** Say it from any screen, then "go to weather" or ask anything, and it answers aloud. It runs fully offline, with an indicator and an off switch in the top bar. The Assistant's mic button works offline too.
- **Play tab in Entertainment.** Your Steam, Epic and GOG games appear as cover tiles, and you can launch them on the PC from the PC or the Fold (admin only, logged).
- **Now Playing.** Shows what the PC is playing, with art, controls and a small visualizer. Works from the Fold too.
- **Home: PC status card** with CPU, RAM, GPU temp, free disk, assistant and chat server state, readable from the Fold. GPU temp needs NVIDIA drivers or LibreHardwareMonitor with its web server on.
- **Home on the PC: Fold4 strip** with battery, charging, free storage, battery temperature and last seen.
- **"Before you go" on Log out.** Shows today's log, tasks done, open tasks you can tick off, tomorrow's weather and first event, and lets you leave a last note before you choose Log out or Stay. Log out now ends the session on the server; Lock is still a quick local lock.
- **Quick Drop.** Send a link, note or file between your own devices from Chat (the "⇅ DROP" button).
- **Wake PC.** The Fold's ⚡ button wakes the PC over Wi-Fi and learns its address by itself.
- **Home network watch** scans the devices on your network from both the PC and the Fold.
- Deep-space login screen, and the version number on the login screen and status bar.

**Fixed**
- **Wi-Fi scanner** on both devices. The PC asks for Windows location access (Windows 11 needs it to list Wi-Fi). The Fold only needs "Nearby devices". If something is still blocked, it tells you why.
- **Chat** remembers its server, the Fold finds the PC's chat server by itself, and the PC adds one firewall rule (a single admin prompt, home network only) so the Fold can get through.
- **Entertainment "handler error"** on Android is gone. Sites that can't open show the reason and "Try again". Google, Apple, Microsoft and Twitch sign-in pop-ups work, fullscreen and the tray button keep working, and the first tile isn't clipped on small PC screens.
- Deleting calendar events and drops from the phone works again.
- Cleaner borders and less blur on the PC.

**Known**
- No .msi yet. It needs a Windows build on GitHub, and the Claude app still can't see the 3Dash repo.
- The PC app's built-in server reports itself as 1.0.0 (a leftover label; it is the 1.1.0 server). This is fixed for the next build.
- Not tested on a real PC or Fold yet, only in emulated sizes. Tell me anything that breaks.

---

## v1.0.1 (2026-10-21) · desktop folder build · SUPERSEDED by v1.1.0

Only the desktop zip changed. The Windows installer and Fold4 APK are still v1.0.0 until v1.1.0.

| File | Size | SHA-256 |
|---|---|---|
| `TURD-1.0.1-desktop.zip` | 294 KB | see `v1.0.1/SHA256SUMS.txt` |

**Fixed**
- Chat no longer forgets its server and drops back to "link a server". It remembers the last address, so re-linking is one tap.

**New**
- Version number on the login screen and in the status bar. Tap it for what's new.
- Deep-space login screen.
- Entertainment shows the reason and a "Try again" button when a site can't open.

**Cleanup**
- The zip went from 3.5 MB to 294 KB. It now holds only what runs on your PC (web app, server, start scripts). Build tools and the Android signing key are no longer inside it.

How to use: unzip, then double-click `start-windows.bat` (needs Node.js). Your old `server/data` folder (accounts, chat, calendar) can be copied over from the previous folder.

---

## v1.0.0 (2026-10-21) · SUPERSEDED by v1.1.0

First native builds.

| File | Size | SHA-256 |
|---|---|---|
| `TURD-1.0.0-windows-setup.exe` | 24.2 MB | `e2ccd7e4…11f01c` |
| `TURD-1.0.0-android.apk` | 3.4 MB | `d7ec607b…ad660e6b` |

- Windows installer (unsigned: "More info → Run anyway"). The PC hosts chat and the assistant from the tray.
- Fold4 APK, signed with the project's own key. Later versions install over it and keep your data.
- All sections: home, assistant, weather, projects, logbook, OPSEC, radar, community (calendar + chat), entertainment, extras.
- Known problems (fixed in v1.1.0): Entertainment "handler error", chat forgets its linked server, Wi-Fi scanner fails.
- No .msi yet (needs a Windows build machine or a GitHub repo). The desktop zip from this day wasn't archived.
