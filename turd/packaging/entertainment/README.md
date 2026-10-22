# Entertainment — native in-app web views

The Entertainment section (`web/src/sections/entertainment.js`) opens YouTube, TikTok,
Twitch, Reddit, SoundCloud and any site you add **inside T.U.R.D.** In the Windows and
Android apps every site runs in a real native web view laid exactly over the viewer, so
nothing is "embedded" and no site can refuse to load. In the browser preview the sites
block framing, so official embed players stand in.

| | Windows (Tauri) | Android (Capacitor) | Browser preview |
|---|---|---|---|
| Full sites in-app, logged in | yes, WebView2 child views | yes, native WebViews | embed players only |
| Network ad blocking | yes, `WebResourceRequested` | yes, `shouldInterceptRequest` | no |
| Ad payload stripping, clean mode | yes, document-start script | yes, document-start script | no |
| Links stay in-app, no "open the app" hops | yes | yes (+ intent:// fallbacks) | n/a |
| Warm apps (pre-loaded, instant open) | yes | yes (pre-rastered) | no |
| Fullscreen video | whole window | whole screen, bars hidden | player's own |
| Hardware back button | n/a | page back, then leaves viewer | n/a |

One source of truth for blocking: `web/src/sections/ent/shield.js`. The page script and
the network rules are sent to the native side with every `open`, so updating that file
updates both apps.

## What the shield does
- **Network:** about 90 ad and tracker hosts and 22 ad paths (YouTube `pagead`, `api/stats/ads`,
  `get_midroll_`, TikTok ad APIs, Reddit/Twitch ad endpoints, all major exchanges) are
  answered locally with an empty 204.
- **YouTube:** strips `adPlacements` / `playerAds` / `adSlots` out of the player response
  before the player reads it (inline `ytInitialPlayerResponse`, `fetch().json()` and
  `JSON.parse`), removes promoted shelves, hides every ad slot, and if an ad still slips
  through it is muted, fast-forwarded and skipped. The "ad blockers are not allowed"
  wall is removed and playback resumed.
- **TikTok:** sponsored videos are removed from the For You feed data; login pop-ups,
  "Get app" banners and the loading splash are hidden; scrolling is never locked.
- **Twitch:** ad and telemetry endpoints blocked; server-stitched ad breaks are muted and
  covered with a quiet card until the stream returns. (Twitch stitches ads into the video
  itself, so they can be hidden and muted but not cut out.)
- **Reddit / SoundCloud:** promoted posts and audio promos removed, app nags hidden.
- **Clean mode** (per app, on by default): cookie walls, upsells, "open in app" bars,
  sign-in nags. **Ad shield** and **Keep warm** are per-app toggles in the launcher.

## Windows (Tauri v2)
Files: `tauri/entertainment.rs` (verified with `cargo check --target x86_64-pc-windows-msvc`
against tauri 2.12 / webview2-com 0.39 / windows 0.62).

1. Copy `entertainment.rs` into `src-tauri/src/`.
2. `src-tauri/Cargo.toml`:
   ```toml
   tauri = { version = "2", features = ["unstable"] }   # child webviews
   serde = { version = "1", features = ["derive"] }
   [target.'cfg(windows)'.dependencies]
   webview2-com = "0.39"
   windows = "0.62"
   ```
3. `src-tauri/src/lib.rs`:
   ```rust
   mod entertainment;
   tauri::Builder::default()
       .manage(entertainment::EntState::default())
       .invoke_handler(tauri::generate_handler![
           entertainment::ent_open, entertainment::ent_bounds, entertainment::ent_show,
           entertainment::ent_hide, entertainment::ent_hide_all, entertainment::ent_nav,
           entertainment::ent_close, entertainment::ent_state, entertainment::ent_rules,
       ])
   ```
   (merge with any other commands in the same `generate_handler!`).
4. Nothing else: app commands are callable from the main window by default, and the
   remote sites get **no** access to Tauri IPC.

## Android (Capacitor)
Files: `android/TurdWebPlugin.java` (verified with `javac` against the Android 15 framework
and Capacitor 8.5.3; it only needs androidx.activity + androidx.webkit, which Capacitor
already ships).

1. Copy to `android/app/src/main/java/app/turd/hud/ent/TurdWebPlugin.java`.
2. Register it in `MainActivity.java`:
   ```java
   public class MainActivity extends BridgeActivity {
       @Override public void onCreate(Bundle savedInstanceState) {
           registerPlugin(app.turd.hud.ent.TurdWebPlugin.class);
           super.onCreate(savedInstanceState);
       }
   }
   ```
3. `AndroidManifest.xml` already has `INTERNET`. For smooth video add
   `android:hardwareAccelerated="true"` on `<application>` (default on modern targets).

## How it fits together
`entertainment.js` → `ent/bridge.js` picks Tauri (`__TAURI_INTERNALS__.invoke`), Android
(`Capacitor.registerPlugin("TurdWeb")`) or the web demo. The viewer's empty area
(`.ent-vp`) is measured and sent as the native view's bounds; a ResizeObserver keeps it
aligned. Leaving the section hides the views (media paused) but keeps them loaded, so
coming back is instant. The shell's overlays (audit log, login) temporarily hide them.
