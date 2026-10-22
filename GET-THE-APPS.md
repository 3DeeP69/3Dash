# Getting the T.U.R.D. apps (and sending them to testers)

## The short version
There are **two** things, and only one of them is the app:

| File | What it is | Use it? |
|---|---|---|
| `TURD-x.y.z-windows-setup.exe` | **The real Windows app.** Double-click → it installs → it runs. The chat/assistant server it needs runs *invisibly inside it*. No `.bat`, no "localhost" steps. | ✅ Yes |
| `TURD-x.y.z-android.apk` | **The real Android app.** Copy to the phone, tap it, install, open. | ✅ Yes |
| `TURD-x.y.z-desktop.zip` | A developer "run from a folder" copy (unzip, run a script, localhost). | ❌ Ignore it |

The installer is fully self-contained: on any PC, it hosts its own server, so the first screen is the login (admin / admin, then it makes you set a passkey). It does **not** need your PC or any other server to run.

## Why you couldn't put the .exe on GitHub
GitHub won't accept a big file (the `.exe` is ~110 MB) as a normal file in the code — the web uploader stops at 25 MB. Big apps are attached to a **Release** instead, which allows files up to 2 GB. You don't upload them by hand: GitHub builds them for you (below).

## Getting working downloads — two ways

### A) Straight from us (simplest, always works)
The **App releases and versions** thread hands you the finished `.exe` and `.apk` as direct downloads. Save them, double-click to run, and send the same files to testers (email, Drive, a USB stick — anything). Nothing else needed.

### B) A GitHub Release (a shareable link, built automatically)
1. On github.com, open **3DeeP69/3Dash → Releases → Draft a new release**.
2. In **Choose a tag**, type `v1.2.0` (match `turd/VERSION`) and pick **Create new tag on publish**.
3. Give it a title (e.g. `T.U.R.D. 1.2.0`), then **Publish release**.
4. Publishing the tag starts the build (Actions tab). In a few minutes the Windows **.exe** and **.msi** appear on the release automatically.
5. Download them from the release page, and share that page's links with testers.

> If the repo is **private**, only people you invite can download from the release. To hand the app to outside testers, either make the repo public, or just use option **A** and send them the files directly.

### Signed Android builds in GitHub (optional, one-time)
GitHub can also build the signed APK, but it needs the signing key as a secret first. You only do this once:

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Add four secrets: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. I'll give you the exact values privately when you're ready (the key must never go in the code).

Until those are set, the Android job just **skips** (it won't fail the release), and you use the signed APK we hand you in option **A**.

## Clean on your PC
Use the installer, not the old folder/zip. The installer keeps everything in one place and your data in one app-data folder, so there are no loose `server/`, `web/` or `.bat` files to manage. If you still have the old `D:\AI\turd` folder copy, you can delete it once the installed app works.
