# T.U.R.D. — Totally Unreliable & Really Dumb

A heavily-polished **3D astronaut-helmet HUD dashboard**. One web codebase, shipped to
**Windows** (Tauri) and **Android** (Capacitor).

## Why this stack
- **UI core:** plain HTML/CSS + **Three.js** (WebGL). No framework tax, runs the curved-visor
  lattice smoothly even on modest hardware. A built-in **QUALITY: HIGH/MED/LOW** toggle
  (bottom-right) scales pixel ratio + particle count so it adapts until we know your specs.
- **Windows:** **Tauri** wraps the same `web/` folder in a tiny Rust shell using the OS WebView2.
  Installers are a few MB (vs. ~150 MB Electron) and idle RAM is a fraction of Electron's — the
  right call for "runs very well on my hardware."
- **Android:** **Capacitor** wraps the identical `web/` into a native APK/AAB and exposes native
  Bluetooth/Wi-Fi scanning that the browser can't do on its own.

Everything in `web/` is the single source of truth. Both wrappers just load it.

## What's built (v1)
- **Login deck** — first operator is `admin` / `admin`. Every attempt (granted or denied) is
  appended to a **hidden, admin-only access log**. First successful `admin/admin` login forces a
  passkey rotation. Open the log: click the **T.U.R.D.** wordmark **5×**, or type **`audit`**.
- **Curved helmet HUD** — live WebGL background (icosphere lattice + core + starfield), SVG visor
  arcs, vignette, sheen, scanlines, corner reticles. Full-screen sections.
- **Per-section theme** — each section recolors the whole background + HUD (projects=cyan,
  weather=ice-blue, opsec=green, logbook=amber, radar=magenta).
- **Projects** — pulled from `3dms.netlify.app` (camera relay, TF.js detection, Cloudflare proxy, …).
- **Weather** — live Open-Meteo (keyless), geolocates you, current + 10-hour strip.
- **OPSEC / Privacy** — defensive hardening checklist for *your own* devices, with a score meter.
- **Logbook** — local entries, add/delete, timestamped.
- **BT / Wi-Fi Radar** — animated scope GUI. Web Bluetooth scan in-browser; native sweep via the
  wrappers (see `packaging/NATIVE_RADAR.md`).

## Run it
```bash
# any static server works
cd web && python3 -m http.server 5173
# open http://localhost:5173
```
Or open the live preview artifact (link in the thread).

## Package it
- Windows: `packaging/tauri/` + `packaging/BUILD_WINDOWS.md`
- Android: `packaging/capacitor/` + `packaging/BUILD_ANDROID.md`

## Notes / open questions
- **Your hardware specs** decide the default QUALITY tier and whether we lean on heavier 3D
  (post-processing, bloom). Tell me CPU / GPU / RAM and I'll tune defaults.
- Logbook + audit are currently `localStorage`. For the native builds I'll move them to an
  encrypted-at-rest store (per-device key) so they survive updates and can't be read off-device.
