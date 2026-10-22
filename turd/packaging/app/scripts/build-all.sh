#!/usr/bin/env bash
# Full release build from Linux: web bundle, Android APK, Windows setup .exe.
# usage: scripts/build-all.sh 1.1.0 [outdir]
set -euo pipefail
V="$1"; OUT="${2:-out/v$V}"
IFS=. read -r MA MI PA <<<"$V"; CODE=$((MA*10000+MI*100+PA))
cd "$(dirname "$0")/.."
export TURD_VERSION="$V" TURD_VERSION_CODE="$CODE"
node scripts/prepare-web.mjs "${TURD_WEB:-../../web}"
npx cap sync android >/dev/null && node scripts/patch-capacitor.mjs
(cd android && ./gradlew assembleRelease --no-daemon -q)
node scripts/build-server-sea.mjs win "${TURD_SERVER:-../../server}" >/dev/null
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
mkdir -p "$OUT"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/TURD-$V-android.apk"
cp "src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/T.U.R.D._${V}_x64-setup.exe" "$OUT/TURD-$V-windows-setup.exe"
(cd "$OUT" && sha256sum TURD-$V-* > SHA256SUMS.txt && cat SHA256SUMS.txt)
