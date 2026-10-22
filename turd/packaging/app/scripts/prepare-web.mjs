// Builds dist/ — the exact web bundle both native apps ship.
//   1. copies turd/web (single source of truth) into dist/
//   2. vendors three.js + the Google fonts so the apps boot fully offline
//   3. remaps the CDN import with an import map (no section code is edited)
//   4. loads src/native.js first so TURD_NATIVE / TURD_HTTP exist before core.js
//
// usage: node scripts/prepare-web.mjs [path/to/turd/web]   (default: ../../web, then $TURD_WEB)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.resolve(process.argv[2] || process.env.TURD_WEB || path.join(root, "..", "..", "web"));
const dist = path.join(root, "dist");
const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

if (!fs.existsSync(path.join(src, "index.html"))) { console.error("no index.html in " + src); process.exit(1); }
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true, filter: p => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p) });

// three.js — from the npm package pinned in package.json (same 0.160.0 the CDN serves)
fs.mkdirSync(path.join(dist, "vendor", "fonts"), { recursive: true });
fs.copyFileSync(path.join(root, "node_modules", "three", "build", "three.module.min.js"), path.join(dist, "vendor", "three.module.js"));

// fonts — cached in vendor-cache/ so offline rebuilds and CI work without Google
const cache = path.join(root, "vendor-cache", "fonts");
fs.mkdirSync(cache, { recursive: true });
let css;
const cssFile = path.join(cache, "fonts.css");
if (fs.existsSync(cssFile)) css = fs.readFileSync(cssFile, "utf8");
else {
  const raw = await (await fetch(FONT_CSS, { headers: { "user-agent": UA } })).text();
  // keep latin + latin-ext only; the HUD never renders cyrillic/greek/vietnamese
  const blocks = raw.split(/(?=\/\* )/).filter(b => /\/\* latin(-ext)? \*\//.test(b));
  css = blocks.join("");
  for (const u of [...new Set(css.match(/https:\/\/fonts\.gstatic\.com[^)]+/g) || [])]) {
    const name = u.split("/").slice(-3).join("-");
    const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
    fs.writeFileSync(path.join(cache, name), buf);
    css = css.split(u).join("./" + name);
  }
  fs.writeFileSync(cssFile, css);
}
for (const f of fs.readdirSync(cache)) fs.copyFileSync(path.join(cache, f), path.join(dist, "vendor", "fonts", f));

// index.html — local fonts, import map, native bridge first
let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, "");
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link href="./vendor/fonts/fonts.css" rel="stylesheet">');
const inject = `<script type="importmap">${JSON.stringify({ imports: { [THREE_CDN]: "./vendor/three.module.js" } })}</script>
<script src="./src/native.js"></script>
`;
if (!html.includes("./src/native.js")) html = html.replace(/<script type="module"/, inject + '<script type="module"');
fs.writeFileSync(path.join(dist, "index.html"), html);

// Android's asset packer unpacks and renames anything ending in .gz, so the wake-word model ships
// as .tgz (native.js sets window.TURD_VOSK_MODEL to match). Same file, new name.
for (const f of ["en-us-small-0.15.tar.gz"]) {
  const p = path.join(dist, "vendor", "vosk", f);
  if (fs.existsSync(p)) fs.renameSync(p, p.replace(/\.tar\.gz$/, ".tgz"));
}

// fail loudly if anything still points at a CDN the apps can't rely on
const left = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (/\.(js|html|css)$/.test(e.name) && !p.includes(path.join("vendor", ""))) {
    const t = fs.readFileSync(p, "utf8");
    for (const m of t.matchAll(/(?:import\s[^;]*?from\s*|import\(\s*)["'](https?:\/\/[^"']+)["']/g)) if (m[1] !== THREE_CDN) left.push(path.relative(dist, p) + " -> " + m[1]);
  }
} })(dist);
if (left.length) console.warn("WARNING: remote module imports still present:\n  " + left.join("\n  "));
if (!fs.existsSync(path.join(dist, "src", "native.js"))) console.warn("WARNING: src/native.js missing in web/ — native features will be off");
console.log("dist ready from " + src);
