// Stamp one version number into every place a T.U.R.D. build reads it.
// Owned by the "App releases and versions" thread. Run BEFORE building:
//
//   node turd/releases/stamp-version.mjs 1.1.0
//
// Updates: turd/VERSION, web/src/version.js (VERSION + DATE), server/server.js + package.json,
//          packaging/app/package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
// Prints the env for the Android build (gradle reads TURD_VERSION / TURD_VERSION_CODE).
// versionCode = major*10000 + minor*100 + patch, so every release installs over the last
// (v1.0.0 shipped with versionCode 1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const v = (process.argv[2] || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(v)) { console.error("usage: node stamp-version.mjs X.Y.Z"); process.exit(1); }
const [maj, min, pat] = v.split(".").map(Number);
const code = maj * 10000 + min * 100 + pat;
const date = new Date().toISOString().slice(0, 10);

const turd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function edit(rel, fn) {
  const p = path.join(turd, rel);
  if (!fs.existsSync(p)) { console.warn("skip (missing): " + rel); return; }
  const a = fs.readFileSync(p, "utf8"), b = fn(a);
  if (a !== b) fs.writeFileSync(p, b);
  console.log((a !== b ? "stamped  " : "already  ") + rel);
}

fs.writeFileSync(path.join(turd, "VERSION"), v + "\n"); console.log("stamped  VERSION");
edit("web/src/version.js", s => s.replace(/var VERSION = "[^"]*";/, `var VERSION = "${v}";`).replace(/var DATE = "[^"]*";/, `var DATE = "${date}";`));
edit("server/server.js", s => s.replace(/^const VERSION = "[^"]*";/m, `const VERSION = "${v}";`));
edit("server/package.json", s => s.replace(/("version":\s*)"[^"]*"/, `$1"${v}"`));
edit("packaging/app/package.json", s => s.replace(/("version":\s*)"[^"]*"/, `$1"${v}"`));
edit("packaging/app/src-tauri/tauri.conf.json", s => s.replace(/("version":\s*)"[^"]*"/, `$1"${v}"`));
edit("packaging/app/src-tauri/Cargo.toml", s => s.replace(/^version = "[^"]*"/m, `version = "${v}"`));

console.log(`\nAndroid build env:\n  export TURD_VERSION=${v} TURD_VERSION_CODE=${code}`);
console.log(`Output names:\n  TURD-${v}-windows-setup.exe  TURD-${v}-windows.msi  TURD-${v}-android.apk  TURD-${v}-desktop.zip`);
console.log(`Hand the files to the releases thread; it files them under releases/v${v}/.`);
