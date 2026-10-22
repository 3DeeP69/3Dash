# T.U.R.D. releases

Newest first. Older versions stay here, marked superseded.

| File | Current version | Where |
|---|---|---|
| Windows installer (.exe) | **v1.3.0** | `v1.3.0/TURD-1.3.0-windows-setup.exe` |
| Windows .msi | from GitHub CI | appears on the GitHub release once Bossman publishes it |
| Fold4 APK | **v1.3.0** | `v1.3.0/TURD-1.3.0-android.apk` |
| Desktop zip | retired after v1.1.0 | the installer runs its own server now |

Superseded: v1.2.0, v1.1.0, v1.0.1 (desktop zip), v1.0.0. Full history in `CHANGELOG.md`.
On Bossman's PC: `D:\AI\T.U.R.D\Install` holds the current .exe + .apk; older ones go to `D:\AI\T.U.R.D\Older versions`.

## For the build threads
1. Before building, stamp the number: `node turd/releases/stamp-version.mjs X.Y.Z`
   (Android: use the `TURD_VERSION` / `TURD_VERSION_CODE` it prints. The code must keep going up.)
2. Name files `TURD-X.Y.Z-windows-setup.exe`, `TURD-X.Y.Z-windows.msi`, `TURD-X.Y.Z-android.apk`, `TURD-X.Y.Z-desktop.zip`.
3. Sign the APK with `packaging/app/keys/turd-release.jks`, or it won't install over the old one.
4. Message the "App releases and versions" thread with the paths and a plain-English list of changes. That thread files them here, updates the CHANGELOG and posts them.

## GitHub (3DeeP69/3Dash)
Linked (private). Claude sessions cannot create tags or releases there; Bossman publishes each release on github.com using `vX.Y.Z/RELEASE-NOTES.md`, which triggers the Windows CI build.
- **Split:** the installers thread owns the repo source + CI. The releases thread owns tags, GitHub Releases and release notes. Tags = `v` + `turd/VERSION`.
- **ci/build-apps.yml fixes needed before it goes in:**
  1. `TURD_VERSION_CODE: github.run_number` → must be major*10000+minor*100+patch from the tag (1.1.0 = 10100). Otherwise CI APKs can't install over ours.
  2. Never commit `packaging/app/keys/`, `server/data/`, `vendor-cache/`, `node_modules/`, `screenshots/`, `downloads/`, `releases/v*/` binaries (.gitignore them). If ANDROID_KEYSTORE_* secrets can't be set, the release APK stays the one signed here with the project key; CI provides the .exe/.msi only.
  3. Look at what's already in 3Dash before the first push; don't overwrite it.
