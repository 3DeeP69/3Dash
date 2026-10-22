# T.U.R.D. changelog

Every build is filed under `releases/vX.Y.Z/`. Only the newest version is current; everything below it is **superseded**.
The newest files are also mirrored in `turd/downloads/`.

To check which build you have: the version is shown under the login form and next to the T.U.R.D. wordmark (tap it for what's new). Builds before v1.0.1 don't show it.

---

## Next (not built yet, planned as v1.4.0)

The deep polish pass is in the shared code and waiting for the next build:
- **Controller everywhere:** the D-pad or left stick now moves through the buttons inside every section. A selects, B goes back, and LB/RB switch sections. The focused control glows, a hint bar shows the buttons, and it keeps its place when a section refreshes.
- **Keyboard:** Tab no longer wanders into the hidden login screen, and the focus rings are clearer. The Home Weather and Projects tiles and the Projects cards can all be reached with Tab, Enter or the controller.
- **Offline:** the Home weather and projects tiles say "unavailable · Retry" instead of spinning forever. The Spy Tools map says "Map tiles can't load right now", with Retry.
- **Mic:** errors are plain now, such as "No microphone found" or "Mic is busy in another app".
- **Short screens and the Fold:**
  - On short screens and a sideways Fold, Home tiles stay readable and the page scrolls.
  - The Assistant's suggestions no longer slide under the Ask bar.
  - On the Fold cover, the briefing row is tidier, calendar cards stay inside their edges, and sideways rows fade at the edge to show there's more.
- **Faster:** animations pause in sections you aren't looking at, and Weather draws 40–55% faster. Memory stays flat over long use.

---

## v1.3.0 (2026-10-22) · CURRENT

Windows installer and Fold4 APK, both v1.3.0. This is the "damn near perfection" pass.

| File | Size | SHA-256 |
|---|---|---|
| `TURD-1.3.0-windows-setup.exe` | 112 MB | `5ea8f44e8c71…e74645` |
| `TURD-1.3.0-android.apk` | 47 MB | `1f6af9f8191a…5d9507` |

Install over v1.2.0. Your accounts, logbook and chat stay. The APK is signed with the same key (checked: code 10300, cert 6fc5df18…), so the Fold updates in place.

**Fixed**
- **The map works with no API key.** The map is built into the app now and uses free map tiles, so the grey "needs an API key" screen is gone. It only needs internet, and there's no paid key, ever.
- **Cleaner edges and borders in every section:**
  - Sound, Ambient and Quality sit on one row.
  - The status bar no longer wraps or gets cut off on a laptop or a sideways Fold.
  - Status rows on the phone don't overlap.
  - The Access log and Device sync tables scroll on phones.
  - The ambient screen fully covers the dashboard.
  - The pill tags are gone.
  - Buttons are big enough to tap.
  - Spy Tools matches the other sections.
- Sharper text, status strips on Home that line up, and cleaner Customize labels.

**New**
- **Live PC monitor on Home.** It updates every 1.5 seconds with smoothly animated values, and it's lighter on the PC.
- **Spoken briefing.** Use "Play briefing" on Home, or say "Hey T.U.R.D., read my briefing", to hear your greeting, next event, weather, tasks and projects read aloud. "Read at login" plays it after the boot chime. It's off by default.
- **Internet health on Home.** Shows whether you're online, your last speed test and your last outage. The card stays hidden until there's data.

**Known**
- Windows still says "Windows protected your PC" because the installer isn't code-signed. Click More info, then Run anyway.
- The spoken briefing uses the phone's built-in voice. If the Fold stays silent, tell me and I'll add a native voice.

---

## v1.2.0 (2026-10-22) · SUPERSEDED by v1.3.0

Windows installer and Fold4 APK, both v1.2.0. There is no desktop zip anymore: the installer is the app.

| File | Size | SHA-256 |
|---|---|---|
| `TURD-1.2.0-windows-setup.exe` | 112 MB | `3e9ba286bcba…8857f8` |
| `TURD-1.2.0-android.apk` | 47 MB | `bd5a6d26b1c9…0073a1` |

**How to run it:** double-click the .exe to install, then open T.U.R.D. from the Start menu. There's no .bat to run and nothing to start on localhost, because the app runs its own server inside it. On the Fold, copy the .apk over and tap it. You can send both files to testers as they are. Each tester's PC runs its own copy, and their first login is admin / admin.

Install over v1.1.0. Your accounts, logbook and chat stay. The APK is signed with the same key (checked: code 10200, cert 6fc5df18…), so the Fold updates in place.

**New**
- **Spy Tools tab** (replaces OPSEC):
  - One live map with aircraft, police and government aircraft, and ALPR (license plate) cameras, each with layer filters.
  - The Wi-Fi/Bluetooth scanner and home network watch now live together in Scanner.
  - Recon has a port scan for your own network.
- **Ambient screen when idle:** a big clock, weather and your next event, drifting slowly to protect the screen. The AMBIENT chip sets Off, 2, 4 or 8 minutes. It keeps the Fold awake only while charging.
- **Console sounds:** a PS3-style boot chime plus navigation, select, open, close and error sounds, pitched to each section's theme. The SOUND chip mutes them or sets the volume.
- **Customizable Home:** show or hide cards and drag them into any order with touch, mouse, keyboard or a controller (hold a card, press Y, or use "✎ Customize Home"). The layout is saved per device, or shared across devices with one switch.
- **Gadget batteries on Home:** controllers, earbuds and headsets that report a battery level. The card only shows up when one of them does.

**Fixed**
- **Adding a chat user:** the invite fields in NET LOG can be clicked and typed into again. They were sliding under the top bar.
- The PC app's built-in server now reports the right version instead of 1.0.0.

**Known**
- The .msi only appears after you publish the GitHub release, because GitHub's Windows build makes it.
- Windows still says "Windows protected your PC" because the installer isn't code-signed. Click More info, then Run anyway. Testers will see this too.
- Map tiles and aircraft need internet.
- Not tested on a real PC or Fold yet, only emulated sizes. Tell me anything that breaks.

---

## v1.1.0 (2026-10-21) · SUPERSEDED by v1.3.0

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
- The .msi is built by GitHub (Windows CI) and added to the GitHub release when that build succeeds.
- The PC app's built-in server reports itself as 1.0.0 (a leftover label; it is the 1.1.0 server). This is fixed for the next build.
- Not tested on a real PC or Fold yet, only in emulated sizes. Tell me anything that breaks.

---

## v1.0.1 (2026-10-21) · desktop folder build · SUPERSEDED by v1.3.0

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

## v1.0.0 (2026-10-21) · SUPERSEDED by v1.3.0

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
