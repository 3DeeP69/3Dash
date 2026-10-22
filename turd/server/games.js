// ===========================================================================
// T.U.R.D. GAMES — optional module for server.js (owned by the Entertainment
// thread). Finds the games installed on this PC and launches them, for the
// Entertainment "Play" view on the PC itself and on the phone (the phone talks
// to this server over the home network with the same login as chat).
//
//   require("./games.js").attach(api, { readToken, bearer, body, send, audit });
//
// Zero dependencies, nothing paid, nothing online:
//   Steam   appmanifest_*.acf in every library from libraryfolders.vdf;
//           cover art straight from Steam's own cache (appcache/librarycache)
//   Epic    %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item
//   GOG     HKLM\SOFTWARE\WOW6432Node\GOG.com\Games (registry)
//   Custom  any .exe added from the PC itself
//
// API (admin token only, every launch goes to the admin log):
//   GET  /api/games                     { ok, host, platform, games:[{id,name,source,lastPlayed,sizeGB,art:{portrait,hero,logo,header},cdn}] }
//   GET  /api/games/art?id=&kind=&token= image bytes (portrait|hero|logo|header)
//   POST /api/games/launch  {id}        { ok, name }       launches only ids from the scan
//   POST /api/games/custom  {name,exe}  add a game (only from this PC: loopback)
//   POST /api/games/remove  {id}        remove a custom game
//
// Test overrides: TURD_STEAM_DIR, TURD_EPIC_DIR, TURD_GAMES_DRYRUN=1 (launch logs instead of starting)
// ===========================================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");

const WIN = process.platform === "win32";
const DRY = process.env.TURD_GAMES_DRYRUN === "1";
const CACHE_MS = 60e3;

/* ---------------------------------------------------------------- helpers */
const exists = p => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
const readText = p => { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } };
const regQuery = (key, args = []) => new Promise(resolve => {
  if (!WIN) return resolve("");
  execFile("reg", ["query", key, ...args], { windowsHide: true, timeout: 8000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? "" : String(out)));
});

/** Minimal Valve KeyValues (VDF/ACF) parser: quoted keys, quoted values, nested {}. */
function vdf(text) {
  const root = {}, stack = [root]; let key = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g; let m;
  while ((m = re.exec(text))) {
    const cur = stack[stack.length - 1];
    if (m[2] === "{") { const o = {}; if (key != null) { cur[key] = o; key = null; } stack.push(o); }
    else if (m[2] === "}") { if (stack.length > 1) stack.pop(); }
    else { const s = m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"'); if (key == null) key = s; else { cur[key] = s; key = null; } }
  }
  return root;
}
const lower = o => { const r = {}; for (const k in o) r[k.toLowerCase()] = o[k] && typeof o[k] === "object" ? lower(o[k]) : o[k]; return r; };

/* ---------------------------------------------------------------- Steam */
const NOT_GAMES = /redistributable|steamworks common|proton|steam linux runtime|steamvr|soundtrack|dedicated server|\bsdk\b|benchmark/i;
async function steamDir() {
  if (process.env.TURD_STEAM_DIR) return process.env.TURD_STEAM_DIR;
  const out = await regQuery("HKCU\\Software\\Valve\\Steam", ["/v", "SteamPath"]);
  const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
  const cands = [m && m[1].trim(), "C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"].filter(Boolean);
  return cands.find(exists) || null;
}
/** Steam's own cover art: old flat layout (<id>_library_600x900.jpg) or the 2024+ per-app folders. */
function steamArt(steam, appid) {
  const lc = path.join(steam, "appcache", "librarycache"), out = {};
  const want = { portrait: ["library_600x900_2x.jpg", "library_600x900.jpg"], hero: ["library_hero.jpg"], logo: ["logo.png"], header: ["header.jpg", "library_header.jpg"] };
  const dir = path.join(lc, String(appid));
  let nested = [];
  if (exists(dir)) {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile()) nested.push(path.join(dir, e.name));
        else if (e.isDirectory()) for (const f of fs.readdirSync(path.join(dir, e.name))) nested.push(path.join(dir, e.name, f));
      }
    } catch (e) {}
  }
  for (const [kind, names] of Object.entries(want)) {
    for (const n of names) {
      const flat = path.join(lc, `${appid}_${n}`);
      if (exists(flat)) { out[kind] = flat; break; }
      const hit = nested.find(p => path.basename(p) === n);
      if (hit) { out[kind] = hit; break; }
    }
  }
  return out;
}
async function scanSteam() {
  const steam = await steamDir(); if (!steam) return [];
  const libs = new Set([steam]);
  const lf = readText(path.join(steam, "steamapps", "libraryfolders.vdf")) || readText(path.join(steam, "config", "libraryfolders.vdf"));
  if (lf) {
    const root = lower(vdf(lf)); const f = root.libraryfolders || {};
    for (const k in f) { const v = f[k]; const p = typeof v === "string" ? v : v && v.path; if (p) libs.add(p.replace(/\\\\/g, "\\")); }
  }
  const games = [];
  for (const lib of libs) {
    const sa = path.join(lib, "steamapps"); let files = [];
    try { files = fs.readdirSync(sa).filter(f => /^appmanifest_\d+\.acf$/i.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const st = lower(vdf(readText(path.join(sa, f)) || "")).appstate; if (!st || !st.appid || !st.name) continue;
      if (NOT_GAMES.test(st.name)) continue;
      const flags = +st.stateflags || 0;
      if (flags && !(flags & 4)) continue;                       // 4 = fully installed
      games.push({
        id: "steam:" + st.appid, name: st.name, source: "steam", appid: st.appid,
        lastPlayed: (+st.lastplayed || 0) * 1000, sizeGB: st.sizeondisk ? +(st.sizeondisk / 1e9).toFixed(1) : null,
        launch: { uri: "steam://rungameid/" + st.appid }, _art: steamArt(steam, st.appid),
        cdn: `https://cdn.cloudflare.steamstatic.com/steam/apps/${st.appid}/`,
      });
    }
  }
  return games;
}

/* ---------------------------------------------------------------- Epic */
async function scanEpic() {
  const dir = process.env.TURD_EPIC_DIR || path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith(".item")); } catch (e) { return []; }
  const out = [];
  for (const f of files) {
    let j; try { j = JSON.parse(readText(path.join(dir, f))); } catch (e) { continue; }
    if (!j || !j.DisplayName || !j.AppName || j.bIsIncompleteInstall) continue;
    if ((j.AppCategories || []).some(c => /plugins|engine/i.test(c)) && !(j.AppCategories || []).includes("games")) continue;
    out.push({
      id: "epic:" + j.AppName, name: j.DisplayName, source: "epic", lastPlayed: 0,
      sizeGB: j.InstallSize ? +(j.InstallSize / 1e9).toFixed(1) : null,
      launch: { uri: `com.epicgames.launcher://apps/${encodeURIComponent(j.CatalogNamespace + ":" + j.CatalogItemId + ":" + j.AppName)}?action=launch&silent=true` },
      _art: {},
    });
  }
  return out;
}

/* ---------------------------------------------------------------- GOG */
async function scanGog() {
  const out = await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", ["/s"]); if (!out) return [];
  const games = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const v = k => { const m = new RegExp("^\\s+" + k + "\\s+REG_SZ\\s+(.*)$", "mi").exec(block); return m ? m[1].trim() : ""; };
    const id = v("gameID"), name = v("gameName") || v("GAMENAME"), exe = v("exe") || v("EXE"), dir = v("path") || v("PATH");
    if (!id || !name || !exe) continue;
    games.push({ id: "gog:" + id, name, source: "gog", lastPlayed: 0, sizeGB: null, launch: { exe, cwd: dir || path.dirname(exe) }, _art: {} });
  }
  return games;
}

/* ---------------------------------------------------------------- custom */
let F = null;
const customFile = () => F("games-custom.json");
const readCustom = () => { try { return JSON.parse(fs.readFileSync(customFile(), "utf8")); } catch (e) { return []; } };
const writeCustom = list => fs.writeFileSync(customFile(), JSON.stringify(list, null, 1));
function scanCustom() {
  return readCustom().map(c => ({ id: c.id, name: c.name, source: "pc", lastPlayed: c.lastPlayed || 0, sizeGB: null, launch: { exe: c.exe, cwd: path.dirname(c.exe) }, _art: {} }));
}

/* ---------------------------------------------------------------- library (cached) */
let LIB = null, LIB_T = 0, SCANNING = null;
const PLAYED = {};   // launches through T.U.R.D. bump "last played" for non-Steam games
async function library(force) {
  if (!force && LIB && Date.now() - LIB_T < CACHE_MS) return LIB;
  if (SCANNING) return SCANNING;
  SCANNING = (async () => {
    const parts = await Promise.all([scanSteam(), scanEpic(), scanGog()].map(p => p.catch(() => [])));
    const all = [...parts.flat(), ...scanCustom()];
    for (const g of all) if (PLAYED[g.id] && PLAYED[g.id] > g.lastPlayed) g.lastPlayed = PLAYED[g.id];
    all.sort((a, b) => (b.lastPlayed - a.lastPlayed) || a.name.localeCompare(b.name));
    LIB = all; LIB_T = Date.now(); SCANNING = null; return all;
  })();
  return SCANNING;
}
const publicGame = g => ({ id: g.id, name: g.name, source: g.source, lastPlayed: g.lastPlayed, sizeGB: g.sizeGB,
  art: Object.fromEntries(Object.keys(g._art || {}).map(k => [k, true])), cdn: g.cdn || null });

/* ---------------------------------------------------------------- launch */
function launch(g) {
  return new Promise((resolve, reject) => {
    if (DRY) { console.log("[games] dry-run launch", g.id, JSON.stringify(g.launch)); return resolve(); }
    if (!WIN) return reject(new Error("launching games works on the Windows PC"));
    let child;
    try {
      // URIs (steam://, Epic) and shortcuts (.lnk/.url/.bat) go through the shell, real .exe files start directly
      const target = g.launch.uri || (/\.exe$/i.test(g.launch.exe) ? null : g.launch.exe);
      if (target) child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: true });
      else child = spawn(g.launch.exe, [], { cwd: g.launch.cwd, detached: true, stdio: "ignore" });
    } catch (e) { return reject(e); }
    child.once("error", reject);
    child.unref();
    setTimeout(resolve, 150);
  });
}

/* ---------------------------------------------------------------- attach */
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
exports.attach = function (api, h) {
  const { readToken, bearer, body, send, audit } = h;
  F = h.F || (n => path.join(process.env.DATA_DIR || path.join(__dirname, "data"), n));
  const admin = (req, res) => { const t = readToken(bearer(req)); if (!t || t.role !== "admin") { send(res, 403, { ok: false, error: "admin clearance required" }); return null; } return t; };
  const local = req => { const a = (req.socket.remoteAddress || "").replace(/^::ffff:/, ""); return a === "127.0.0.1" || a === "::1"; };

  api["GET /api/games"] = async (req, res) => {
    if (!admin(req, res)) return;
    const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
    const lib = await library(force);
    send(res, 200, { ok: true, host: os.hostname(), platform: process.platform, local: local(req), games: lib.map(publicGame) });
  };

  api["GET /api/games/art"] = async (req, res) => {
    if (!admin(req, res)) return;
    const q = new URL(req.url, "http://x").searchParams;
    const g = (await library()).find(x => x.id === q.get("id"));
    const p = g && g._art && g._art[q.get("kind") || "portrait"];
    if (!p) return send(res, 404, { ok: false });
    fs.readFile(p, (err, buf) => {
      if (err) return send(res, 404, { ok: false });
      res.writeHead(200, { "content-type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream",
        "cache-control": "private, max-age=86400", "access-control-allow-origin": "*" });
      res.end(buf);
    });
  };

  api["POST /api/games/launch"] = async (req, res) => {
    const t = admin(req, res); if (!t) return;
    const d = await body(req).catch(() => ({}));
    const g = (await library()).find(x => x.id === String(d.id || ""));
    if (!g) return send(res, 404, { ok: false, error: "game not found on this PC" });
    try {
      await launch(g);
      PLAYED[g.id] = Date.now(); if (LIB) LIB_T = 0;   // re-sort on next list
      if (g.source === "pc") { const c = readCustom(); const it = c.find(x => x.id === g.id); if (it) { it.lastPlayed = Date.now(); writeCustom(c); } }
      if (audit) audit({ kind: "game", user: t.user, ok: true, note: `launched ${g.name}${local(req) ? "" : " remotely"}` });
      send(res, 200, { ok: true, name: g.name, host: os.hostname() });
    } catch (e) {
      if (audit) audit({ kind: "game", user: t.user, ok: false, note: `launch failed: ${g.name}: ${e.message}` });
      send(res, 500, { ok: false, error: e.message });
    }
  };

  api["POST /api/games/custom"] = async (req, res) => {
    const t = admin(req, res); if (!t) return;
    if (!local(req)) return send(res, 403, { ok: false, error: "add games from the PC itself" });
    const d = await body(req).catch(() => ({}));
    const exe = String(d.exe || "").trim(), name = String(d.name || "").trim().slice(0, 60);
    if (!name || !/\.(exe|lnk|bat|url)$/i.test(exe) || !path.isAbsolute(exe)) return send(res, 400, { ok: false, error: "need a name and the full path to an .exe" });
    if (!DRY && !exists(exe)) return send(res, 400, { ok: false, error: "that file doesn't exist on this PC" });
    const c = readCustom(); const id = "pc:" + Date.now().toString(36);
    c.push({ id, name, exe }); writeCustom(c); LIB_T = 0;
    send(res, 200, { ok: true, id });
  };

  api["POST /api/games/remove"] = async (req, res) => {
    if (!admin(req, res)) return;
    const d = await body(req).catch(() => ({}));
    writeCustom(readCustom().filter(x => x.id !== d.id)); LIB_T = 0;
    send(res, 200, { ok: true });
  };
};
exports._test = { vdf, scanSteam, scanEpic, library };
