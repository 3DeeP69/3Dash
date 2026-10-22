# T.U.R.D. native apps (Windows + Android)

One web codebase (`turd/web`), two shells:

| | Windows | Android |
|---|---|---|
| Shell | Tauri v2 + WebView2 (`src-tauri/`) | Capacitor 8 (`android/`) |
| Output | `T.U.R.D._x.y.z_x64-setup.exe` (+ `.msi` in CI) | `app-release.apk` |
| Native layer | `src-tauri/src/native.rs`, `radar.rs`, `server.rs` | `android/app/src/main/java/app/turd/hud/TurdNativePlugin.java`, `TurdDownloadService.java` |
| Entertainment views | `src-tauri/src/entertainment.rs` | `.../hud/ent/TurdWebPlugin.java` |
| Chat + assistant server | bundled `turd-server.exe`, starts with the app, lives in the tray | connects to the PC (or any server) |

JS side of everything native: `turd/web/src/native.js` (`window.TURD_NATIVE`, `window.TURD_HTTP`).
The API is documented at the top of that file; Extras' use of it is in `web/src/sections/extras/NATIVE.md`.

## Build
```bash
npm ci                                   # also patches @capacitor/android (scripts/patch-capacitor.mjs)
node scripts/prepare-web.mjs             # turd/web → dist/ (three.js + fonts bundled, works offline)

# Android
npx cap sync android && node scripts/patch-capacitor.mjs
cd android && ./gradlew assembleRelease  # → android/app/build/outputs/apk/release/app-release.apk

# Windows (on Windows)
node scripts/build-server-sea.mjs win-msvc
npx tauri build                           # → src-tauri/target/release/bundle/{nsis,msi}/
# Windows (cross-compiled from Linux, NSIS only; what produced the first build)
node scripts/build-server-sea.mjs win
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
```
CI: copy `ci/build-apps.yml` to `.github/workflows/` in the repo. It builds both, plus the `.msi`,
and publishes a GitHub Release when you push a `v1.2.3` tag.

## Tests
- `node tests/app-test.mjs` boots `dist/` offline the way each app does (Android mock at Fold4 cover
  344×882 and open 690×829, Windows mock at 1366×768), logs in, opens every section, runs a radar scan.
- `cargo build` in `src-tauri`, then `node tests/native-selftest.mjs src-tauri/target/debug/turd` (Linux,
  needs xvfb). It runs the real download, resume, cancel, sha256, readRange, unzip and server code against a flaky local server.

## Signing
- **Android:** `keys/turd-release.jks` is a self-signed key (alias `turd`). It is **not in git**; its
  passwords live in `keys/keystore.properties` on the build machine and in the repo's Actions secrets.
  Android installs updates only over an app signed with the same key, so keep this file. For the Play Store or a "real" key, generate one with `keytool`, put it in CI
  secrets (`ANDROID_KEYSTORE_B64` etc., see the workflow). Switching keys means uninstalling once.
- **Windows:** the installer is unsigned for now, so SmartScreen says "Windows protected your PC" →
  **More info → Run anyway**. To remove that, buy a code-signing certificate (or use Azure Trusted
  Signing), add it as `WINDOWS_PFX_B64` / `WINDOWS_PFX_PASSWORD`, and CI signs both installers.

## Notes
- Android AndroidX versions are pinned in `android/variables.gradle` to one consistent set
  (appcompat 1.7.1's own graph). `ci/container-offline-m2.gradle` is only for the cloud build box,
  where Google's Maven host is blocked.
- Windows app data: `%APPDATA%\app.turd.hud\` (settings, chat server data in `server\`).
  Extras default to `Documents\T.U.R.D. Extras`. Android Extras live in the app's storage
  (`Android/data/app.turd.hud/files/extras`, or the SD card's equivalent).
