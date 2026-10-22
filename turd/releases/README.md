# T.U.R.D. releases

Newest first. Older versions stay here, marked superseded.

| File | Current version | Where |
|---|---|---|
| Windows installer (.exe) | **v1.1.0** | `v1.1.0/TURD-1.1.0-windows-setup.exe` |
| Windows .msi | none yet | needs GitHub CI |
| Fold4 APK | **v1.1.0** | `v1.1.0/TURD-1.1.0-android.apk` |
| Desktop zip (run with Node) | **v1.1.0** | `v1.1.0/TURD-1.1.0-desktop.zip` |

Superseded: v1.0.1 (desktop zip), v1.0.0 (.exe + APK). Full history in `CHANGELOG.md`.

## For the build threads
1. Before building, stamp the number: `node turd/releases/stamp-version.mjs X.Y.Z`
   (Android: use the `TURD_VERSION` / `TURD_VERSION_CODE` it prints. The code must keep going up.)
2. Name files `TURD-X.Y.Z-windows-setup.exe`, `TURD-X.Y.Z-windows.msi`, `TURD-X.Y.Z-android.apk`, `TURD-X.Y.Z-desktop.zip`.
3. Sign the APK with `packaging/app/keys/turd-release.jks`, or it won't install over the old one.
4. Message the "App releases and versions" thread with the paths and a plain-English list of changes. That thread files them here, updates the CHANGELOG and posts them.

## GitHub (3DeeP69/3Dash)
Not linked yet (2026-10-21 14:50: add_repo says "link your GitHub account"; Bossman has the Connect GitHub link).
- **Split:** the installers thread owns the repo source + CI. The releases thread owns tags, GitHub Releases and release notes. Tags = `v` + `turd/VERSION`.
- **ci/build-apps.yml fixes needed before it goes in:**
  1. `TURD_VERSION_CODE: github.run_number` → must be major*10000+minor*100+patch from the tag (1.1.0 = 10100). Otherwise CI APKs can't install over ours.
  2. Never commit `packaging/app/keys/`, `server/data/`, `vendor-cache/`, `node_modules/`, `screenshots/`, `downloads/`, `releases/v*/` binaries (.gitignore them). If ANDROID_KEYSTORE_* secrets can't be set, the release APK stays the one signed here with the project key; CI provides the .exe/.msi only.
  3. Look at what's already in 3Dash before the first push; don't overwrite it.
