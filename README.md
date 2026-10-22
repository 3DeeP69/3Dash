# 3Dash

**T.U.R.D.** ("Totally Unreliable & Really Dumb") is a personal 3D HUD dashboard for Windows and Android.

- `turd/web`: the app (Three.js, plain ES modules)
- `turd/server`: the home chat and assistant server, hosted by the Windows app
- `turd/packaging/app`: the Windows (Tauri) and Android (Capacitor) apps. See its README for build steps.
- `turd/releases/CHANGELOG.md`: what changed in each version

Pushing a tag `vX.Y.Z` that matches `turd/VERSION` builds the Windows installers (.exe and .msi) and the Android APK in GitHub Actions and attaches them to a GitHub Release (`.github/workflows/build-apps.yml`). The signing key is kept in the repository's Actions secrets and is never committed.
