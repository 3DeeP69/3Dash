// ===========================================================================
// T.U.R.D. DEVICE SYNC — keeps every device of the same operator in step
// (PC ⇄ Fold4) through the desktop server. Owned by the "Device sync" thread.
//
// Sections don't change anything: this engine watches localStorage, diffs each
// synced key against the last copy it synced, and turns the change into small
// "cells" so two devices editing different things never clobber each other:
//
//   lww      whole value, last write wins            (settings, toggles, drafts)
//   list     one cell per array item (by id) + an     (logbook, custom projects,
//            "#order" cell                            reminders, saved places …)
//   map      one cell per object field                (OPSEC checklist, prefs …)
//   counter  per-device slices that add up            (entertainment stats)
//
// Server contract (server.js, chat thread): POST /api/sync {dev, ops:[cell]} and
// GET /api/sync?since=REV&wait=SEC (long-poll). Cell = {k, id, v, ts, dev, del?}.
// Server keeps per-cell last-write-wins (ts, then dev) for the logged-in user.
//
// Edits made offline queue in turd_sync_meta and merge the next time the PC is
// reachable. NEVER synced: logins/passkeys, tokens, the admin access log, the
// server address, caches, and things that only make sense on one device.
//
//   import("./sync.js").then(m => m.start(session))     // core.js after login
//   window.TURD_SYNC.status() / .now() / .devices()
// ===========================================================================
import * as UP from "./uplink.js";

/* ------------------------------------------------------------- key policy */
// Never leaves the device (exact keys). Security first, then per-device/caches.
const NEVER = new Set([
  "turd_users", "turd_audit", "turd_token",                      // credentials + admin-only log
  "turd_uplink", "turd_uplink_last",                             // each device reaches the PC differently
  "turd_quality",                                                // tuned to each device's GPU
  "turd_voice_on",                                               // always-listening mic is a per-device choice
  "turd_wx_cache", "turd_prj_cache", "turd_prj_status", "turd_cal_cache",
  "turd_pc_last", "turd_games_last",                             // caches that refill themselves
  "turd_cal_events", "turd_cal_seeded", "turd_cal_focus",        // calendar syncs through /api/events already
  "turd_chat_demo", "turd_chat_demo_who",
  "turd_as_offline",                                             // per-device upload queue (would double-send)
  "turd_xtr_state", "turd_xtr_dir", "turd_xtr_plat",             // downloaded files live on one device
  "turd_home_layout_dev", "turd_home_follow",                     // Home layout is per device unless "same layout on all my devices" (turd_home_layout) is on
]);
const NEVER_RX = /token|secret|passw|apikey|api_key|credential|_cache$|^turd_sync/i;

// Merge strategy per key; anything else under turd_* is "lww", so new
// features sync automatically unless they're added to NEVER.
const STRAT = {
  turd_log:          { s: "list", id: "id", add: "front" },
  turd_prj_custom:   { s: "list", id: "id", add: "end" },
  turd_ent_custom:   { s: "list", id: "id", add: "end" },
  turd_as_reminders: { s: "list", id: "id", add: "end" },
  turd_wx_places:    { s: "list", id: "name", add: "front", max: 8 },
  turd_ent_recent:   { s: "list", id: e => (e && e.app) + "|" + (e && e.url), add: "front", sort: (a, b) => (b.t || 0) - (a.t || 0), max: 24 },
  turd_ent_prefs:    { s: "map" },
  turd_opsec:        { s: "map" },
  turd_xtr_gobag:    { s: "map" },
  turd_devices:      { s: "map" },                               // every device's own status row
  turd_ent_stats:    { s: "counter", min: ["since"] },
};

export function synced(k) {
  return typeof k === "string" && k.startsWith("turd_") && !NEVER.has(k) && !NEVER_RX.test(k);
}
const stratOf = k => STRAT[k] || { s: "lww" };

/* ------------------------------------------------------------- helpers */
const _set = Storage.prototype.setItem, _rm = Storage.prototype.removeItem, _clear = Storage.prototype.clear;
const raw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const putRaw = (k, v) => { try { v == null ? _rm.call(localStorage, k) : _set.call(localStorage, k, v); } catch (e) {} };
const jget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const jput = (k, v) => putRaw(k, JSON.stringify(v));
const parse = s => { if (s == null) return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } };
// stable stringify so key order never looks like a change
const canon = v => v === undefined ? "∅" : JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, n) => (o[n] = x[n], o), {}) : x);
const idOf = (st, item, i) => { const f = st.id || "id"; const v = typeof f === "function" ? f(item) : (item && item[f]); return v == null ? "#" + canon(item) : String(v); };
const now = () => Date.now() + (META.skew || 0);                 // server-aligned clock for fair LWW
const rnd = () => (crypto.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(16).slice(2, 14));

/* ------------------------------------------------------------- state */
// META = { user, dev, rev, skew, pending:{ "k\u0001id": cell }, last, err }
// BASE = { key: rawString }   — what this device last agreed with the server
// CTR  = { key: { field: { dev: n } } }  — counter slices
const MK = "turd_sync_meta", BK = "turd_sync_base", CK = "turd_sync_ctr", DK = "turd_sync_dev";
let META = jget(MK, null) || {};
let BASE = jget(BK, null) || {};
let CTR = jget(CK, null) || {};
let DEV = raw(DK); try { DEV = DEV && JSON.parse(DEV); } catch (e) {}
if (!DEV) { DEV = platform().slice(0, 3) + "-" + rnd(); jput(DK, DEV); }
META.pending = META.pending || {};
let saveT = 0;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(persistNow, 150); };
const persistNow = () => { clearTimeout(saveT); jput(MK, META); jput(BK, BASE); jput(CK, CTR); };
const PK = (k, id) => k + "\u0001" + id;

function platform() {
  const N = typeof window !== "undefined" && window.TURD_NATIVE;
  if (N && N.platform) return N.platform === "android" ? "android" : (N.platform === "windows" || N.platform === "win" ? "windows" : N.platform);
  return /Android/i.test(navigator.userAgent) ? "android" : /Windows/i.test(navigator.userAgent) ? "windows" : "web";
}

/* ------------------------------------------------------------- local diff → cells */
function cellsFor(k, before, after, seed) {
  // before/after: raw strings (or null). seed → oldest timestamp so existing server data wins on first link.
  const st = stratOf(k), ts = seed ? 1 : now(), out = [];
  const cell = (id, v, del) => out.push(del ? { k, id, ts, dev: DEV, del: true } : { k, id, v, ts, dev: DEV });
  const A = parse(before), B = parse(after);
  const kind = (st.s === "list" && (Array.isArray(B) || (B === undefined && after == null))) ? "list"
    : (st.s === "map" || st.s === "counter") && (B === undefined && after == null || (B && typeof B === "object" && !Array.isArray(B))) ? st.s : "lww";
  if (kind === "lww") { if (before !== after) cell("", after, after == null); return out; }
  if (kind === "list") {
    const a = Array.isArray(A) ? A : [], b = Array.isArray(B) ? B : [];
    const am = new Map(a.map((x, i) => [idOf(st, x, i), x])), bm = new Map(b.map((x, i) => [idOf(st, x, i), x]));
    for (const [id, x] of bm) if (!am.has(id) || canon(am.get(id)) !== canon(x)) cell(id, x);
    for (const id of am.keys()) if (!bm.has(id)) cell(id, null, true);
    const ao = [...am.keys()].join("\u0002"), bo = [...bm.keys()].join("\u0002");
    if (ao !== bo || seed) cell("#order", [...bm.keys()]);
    return out;
  }
  const a = (A && typeof A === "object") ? A : {}, b = (B && typeof B === "object") ? B : {};
  if (kind === "map") {
    for (const f of Object.keys(b)) if (!(f in a) || canon(a[f]) !== canon(b[f])) cell(f, b[f]);
    for (const f of Object.keys(a)) if (!(f in b)) cell(f, null, true);
    return out;
  }
  // counter: numeric fields become this device's cumulative slice; the rest is per-field LWW
  const c = CTR[k] = CTR[k] || {};
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (typeof b[f] === "number" && !(st.min || []).includes(f)) {
      const delta = seed ? b[f] - sumOthers(k, f) : b[f] - (typeof a[f] === "number" ? a[f] : 0);
      if (!delta && !seed) continue;
      const s = c[f] = c[f] || {}; s[DEV] = Math.max(0, (s[DEV] || 0) + (seed ? 0 : delta));
      if (seed) s[DEV] = Math.max(0, delta);
      cell(f + "@" + DEV, s[DEV]);
    } else if (canon(a[f]) !== canon(b[f]) || seed) cell("=" + f, b[f], !(f in b));
  }
  return out;
}
const sumOthers = (k, f) => Object.entries((CTR[k] || {})[f] || {}).reduce((n, [d, v]) => d === DEV ? n : n + (+v || 0), 0);

/* capture local edits for the given keys (or all) into the pending queue */
function capture(keys) {
  if (!RUN) return 0;
  let n = 0;
  const list = keys || allKeys();
  for (const k of list) {
    if (!synced(k)) continue;
    const cur = raw(k), seed = !(k in BASE);
    if (!seed && BASE[k] === cur) continue;
    if (seed && cur == null) continue;
    for (const c of cellsFor(k, seed ? null : BASE[k], cur, seed)) {
      const p = PK(c.k, c.id), old = META.pending[p];
      if (seed && old) continue;
      META.pending[p] = c; n++;
    }
    BASE[k] = cur;
  }
  if (n) { persist(); kick(); }
  return n;
}
function allKeys() {
  const s = new Set(Object.keys(BASE));
  try { for (let i = 0; i < localStorage.length; i++) s.add(localStorage.key(i)); } catch (e) {}
  return [...s];
}

/* ------------------------------------------------------------- remote cells → local */
function applyRemote(items) {
  if (!items || !items.length) return [];
  capture([...new Set(items.map(c => c && c.k).filter(Boolean))]);   // fold unsynced local edits into pending first
  const byKey = new Map();
  for (const c of items) {
    if (!c || !synced(c.k)) continue;
    const p = PK(c.k, c.id), mine = META.pending[p];
    if (mine) { if (mine.ts > c.ts || (mine.ts === c.ts && mine.dev >= c.dev)) continue; delete META.pending[p]; }
    if (!byKey.has(c.k)) byKey.set(c.k, []);
    byKey.get(c.k).push(c);
  }
  const changed = [];
  for (const [k, cells] of byKey) {
    const st = stratOf(k), cur = raw(k);
    let next = cur;
    const lwwCell = cells.filter(c => c.id === "").pop();
    if (st.s === "lww" || lwwCell) {
      if (lwwCell && !META.pending[PK(k, "")]) next = lwwCell.del ? null : (typeof lwwCell.v === "string" ? lwwCell.v : JSON.stringify(lwwCell.v));
    } else if (st.s === "list") {
      let arr = parse(cur); if (!Array.isArray(arr)) arr = [];
      const idx = new Map(arr.map((x, i) => [idOf(st, x, i), x]));
      let order = null;
      for (const c of cells) {
        if (META.pending[PK(k, c.id)]) continue;
        if (c.id === "#order") { order = Array.isArray(c.v) ? c.v : null; continue; }
        if (c.del) { idx.delete(c.id); continue; }
        if (!idx.has(c.id)) { st.add === "end" ? arr.push(c.v) : arr.unshift(c.v); }
        idx.set(c.id, c.v);
      }
      // rebuild in current order with replacements, drop deletions
      let ids = arr.map((x, i) => idOf(st, x, i)).filter((id, i, a) => idx.has(id) && a.indexOf(id) === i);
      if (order && !META.pending[PK(k, "#order")]) {
        const pos = new Map(order.map((id, i) => [id, i]));
        const known = ids.filter(id => pos.has(id)).sort((x, y) => pos.get(x) - pos.get(y));
        const unknown = ids.filter(id => !pos.has(id));
        ids = st.add === "end" ? [...known, ...unknown] : [...unknown, ...known];
      }
      let out = ids.map(id => idx.get(id));
      if (st.sort) out.sort(st.sort);
      if (st.max) out = out.slice(0, st.max);
      next = JSON.stringify(out);
    } else if (st.s === "map") {
      let o = parse(cur); if (!o || typeof o !== "object" || Array.isArray(o)) o = {};
      for (const c of cells) { if (META.pending[PK(k, c.id)]) continue; if (c.del) delete o[c.id]; else o[c.id] = c.v; }
      next = JSON.stringify(o);
    } else if (st.s === "counter") {
      let o = parse(cur); if (!o || typeof o !== "object" || Array.isArray(o)) o = {};
      const ctr = CTR[k] = CTR[k] || {};
      for (const c of cells) {
        if (META.pending[PK(k, c.id)]) continue;
        if (c.id.startsWith("=")) { const f = c.id.slice(1); if (c.del) delete o[f]; else o[f] = c.v; continue; }
        const at = c.id.lastIndexOf("@"); if (at < 1) continue;
        const f = c.id.slice(0, at), d = c.id.slice(at + 1);
        (ctr[f] = ctr[f] || {})[d] = c.del ? 0 : (+c.v || 0);
      }
      for (const f of Object.keys(ctr)) o[f] = Object.values(ctr[f]).reduce((n, v) => n + (+v || 0), 0);
      for (const f of (st.min || [])) { const m = cells.find(c => c.id === "=" + f); if (m && typeof m.v === "number" && typeof parse(cur)?.[f] === "number") o[f] = Math.min(m.v, parse(cur)[f]); }
      next = JSON.stringify(o);
    }
    if (next !== cur) { putRaw(k, next); changed.push(k); }
    BASE[k] = raw(k);
  }
  persist();
  return changed;
}

/* ------------------------------------------------------------- network */
const http = (u, o) => ((typeof window !== "undefined" && window.TURD_HTTP) || fetch)(u, o);
let RUN = false, SESSION = null, busy = false, again = false, kickT = 0, backoff = 0, pollAbort = null, loopOn = false, listeners = new Set();
const authH = () => ({ "content-type": "application/json", authorization: "Bearer " + UP.token() });

function tokenUser() {
  try { const t = UP.token(); if (!t) return ""; const b = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(b)).u || ""; } catch (e) { return ""; }
}
const ready = () => RUN && UP.configured() && UP.token() && (!SESSION || !SESSION.user || tokenUser() === SESSION.user);

function kick(ms = 700) { clearTimeout(kickT); kickT = setTimeout(cycle, ms); }

async function push() {
  const sent = Object.values(META.pending).slice(0, 1500);
  if (!sent.length) return true;
  const r = await http(UP.endpoint() + "/api/sync", { method: "POST", headers: authH(), body: JSON.stringify({ dev: DEV, ops: sent }) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("login needed"), { auth: true });
  if (r.status === 404) throw Object.assign(new Error("server too old for sync"), { old: true });
  if (!r.ok) throw new Error("push " + r.status);
  const j = await r.json().catch(() => ({}));
  if (j.now) META.skew = j.now - Date.now();
  for (const c of sent) { const p = PK(c.k, c.id); if (META.pending[p] === c) delete META.pending[p]; }
  const ch = applyRemote(j.items || []);            // server tells us about cells it kept over ours
  persist(); if (ch.length) notify(ch);
  return Object.keys(META.pending).length === 0;
}
async function pull(wait) {
  const q = new URLSearchParams({ since: String(META.rev || 0), wait: String(wait || 0), dev: DEV });
  let ctl = null; try { ctl = new AbortController(); pollAbort = ctl; } catch (e) {}
  const r = await http(UP.endpoint() + "/api/sync?" + q, { headers: authH(), signal: ctl ? ctl.signal : undefined });
  pollAbort = null;
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("login needed"), { auth: true });
  if (r.status === 404) throw Object.assign(new Error("server too old for sync"), { old: true });
  if (!r.ok) throw new Error("pull " + r.status);
  const j = await r.json();
  if (j.now) META.skew = j.now - Date.now();
  const ch = applyRemote(j.items || []);
  if (typeof j.rev === "number") META.rev = Math.max(META.rev || 0, j.rev);
  META.last = Date.now(); META.err = ""; persist();
  if (ch.length) notify(ch);
  return ch;
}
/* one push + pull round; serialized */
async function cycle() {
  if (!RUN) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    capture();
    if (!ready()) { META.err = !UP.configured() ? "no server linked" : !UP.token() ? "sign in while the PC is reachable" : "signed in as someone else"; emit(); return; }
    heartbeat(false);
    await push();
    await pull(0);
    backoff = 0; emit();
    loop();
  } catch (e) {
    META.err = e.auth ? "sign in again to resume sync" : e.old ? "PC server needs the sync update" : "PC not reachable — changes saved, will sync later";
    persist(); emit();
    backoff = Math.min(60000, (backoff || 2000) * 2);
    clearTimeout(kickT); kickT = setTimeout(cycle, e.auth || e.old ? 120000 : backoff);
  } finally {
    busy = false;
    if (again) { again = false; kick(50); }
  }
}
/* long-poll loop: near-instant updates from the other device */
async function loop() {
  if (loopOn || !RUN) return; loopOn = true;
  while (RUN && ready() && !document.hidden) {
    const t0 = Date.now();
    try {
      const ch = await pull(20); if (Object.keys(META.pending).length) await push(); emit();
      if (!ch.length && Date.now() - t0 < 1500) await new Promise(r => setTimeout(r, 4000));   // server without long-poll → gentle polling
    }
    catch (e) { if (e && e.name === "AbortError") continue; loopOn = false; kick(backoff = Math.min(60000, (backoff || 2000) * 2)); return; }
  }
  loopOn = false;
}

/* ------------------------------------------------------------- this device's status row (turd_devices) */
// The PC's Home shows the Fold's battery / charging / free storage / last seen from here.
let lastBeat = 0, battery = null, beatT = 0;
async function readBattery() {
  try { if (!battery && navigator.getBattery) { battery = await navigator.getBattery(); ["levelchange", "chargingchange"].forEach(ev => battery.addEventListener(ev, () => heartbeat(true))); } } catch (e) {}
  return battery;
}
let storageEst = null, storageAt = 0;
async function heartbeat(force) {
  if (!RUN) return;
  const t = Date.now();
  if (!force && t - lastBeat < 60000) return;
  lastBeat = t;
  const b = await readBattery();
  if (t - storageAt > 300000) {
    storageAt = t;
    try {
      const N = window.TURD_NATIVE;
      const info = N && N.info ? await N.info().catch(() => null) : null;
      if (info && info.freeBytes) storageEst = { free: info.freeBytes, total: info.totalBytes || null, src: "device" };
      else if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); storageEst = { free: Math.max(0, (e.quota || 0) - (e.usage || 0)), total: e.quota || null, src: "app" }; }
    } catch (e) {}
  }
  const rows = jget("turd_devices", {}) || {};
  const prev = rows[DEV] || {};
  // desktops without a battery report a fake 100% "charging" with chargingTime 0 — hide that
  const noBatt = !b || (platform() !== "android" && b.level === 1 && b.charging && !b.chargingTime);
  rows[DEV] = {
    name: deviceName(), platform: platform(), user: (SESSION && SESSION.user) || prev.user || "",
    battery: noBatt ? null : Math.round(b.level * 100), charging: noBatt ? null : !!b.charging,
    free: storageEst ? storageEst.free : (prev.free ?? null), total: storageEst ? storageEst.total : (prev.total ?? null), freeSrc: storageEst ? storageEst.src : prev.freeSrc,
    seen: now(), app: appVersion() || prev.app || "",
  };
  _set.call(localStorage, "turd_devices", JSON.stringify(rows));
  capture(["turd_devices"]);
}
function appVersion() { const v = window.TURD_VERSION; return typeof v === "string" ? v : (v && (v.version || v.web)) || ""; }
function deviceName() {
  const ua = navigator.userAgent || "";
  if (/SM-F936/i.test(ua)) return "Galaxy Fold4";
  const m = ua.match(/Android [\d.]+; ([^;)]+)/); if (m && !/^K$/.test(m[1])) return m[1].trim();
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Browser";
}
export function devices() {
  const rows = jget("turd_devices", {}) || {};
  return Object.entries(rows).map(([id, r]) => ({ id, ...r, me: id === DEV, online: r.seen && (Date.now() + (META.skew || 0) - r.seen) < 3 * 60000 }))
    .sort((a, b) => (b.seen || 0) - (a.seen || 0));
}

/* ------------------------------------------------------------- UI refresh after remote changes */
// Which open section to re-render for which keys. Sections that hold live state
// (assistant stream, entertainment players, chat) are never yanked — they pick
// the change up next time they open.
const LIVE_SECTIONS = new Set(["assistant", "entertainment", "chat", "radar"]);
const REL = { home: () => true, logbook: k => k.startsWith("turd_log"), weather: k => k.startsWith("turd_wx_"), projects: k => k.startsWith("turd_prj_"),
  opsec: k => k === "turd_opsec", extras: k => k.startsWith("turd_xtr_") };
let deferred = new Set(), deferT = 0;
function notify(keys) {
  try { window.dispatchEvent(new CustomEvent("turd:sync", { detail: { keys } })); } catch (e) {}
  if (keys.includes("turd_as_reminders")) import("./sections/assistant/context.js").then(m => m.armAll && m.armAll()).catch(() => {});
  keys.forEach(k => deferred.add(k));
  refresh();
}
function refresh() {
  clearTimeout(deferT);
  const sec = document.body && document.body.dataset.section;
  if (!sec || !deferred.size) return;
  if (deferred.has("turd_devices")) {                              // device status: repaint the strip, never re-mount Home for it
    deferred.delete("turd_devices");
    const el = document.getElementById("hmDev");
    if (el) import("./sections/devstat.js").then(m => { const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); el.innerHTML = m.devStripHTML(esc); }).catch(() => {});
  }
  const rel = REL[sec]; const keys = [...deferred];
  if (!rel || LIVE_SECTIONS.has(sec) || !keys.some(rel)) { deferred.clear(); return; }
  const panel = document.getElementById("sec-" + sec), a = document.activeElement;
  const busyUi = (a && panel && panel.contains(a) && a.matches && a.matches("input,textarea,select,[contenteditable]")) || document.querySelector("#modal.show") || (panel && panel.querySelector(".hm-editing, .hm-edit-card")) || (panel && panel.classList.contains("hm-editing"));   // Home Customize mode
  if (busyUi) { deferT = setTimeout(refresh, 2500); return; }                 // don't re-render under the operator's fingers
  deferred.clear();
  const btn = document.querySelector(`.navbtn[data-go="${sec}"]`);
  if (btn) { const y = panel ? panel.scrollTop : 0; btn.click(); if (panel) requestAnimationFrame(() => { panel.scrollTop = y; }); }
}
addEventListener("focusout", () => { if (deferred.size) { clearTimeout(deferT); deferT = setTimeout(refresh, 400); } });

/* ------------------------------------------------------------- status chip in the status bar */
function emit() { listeners.forEach(f => { try { f(status()); } catch (e) {} }); chip(); }
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function status() {
  return { running: RUN, device: DEV, user: SESSION && SESSION.user, rev: META.rev || 0, pending: Object.keys(META.pending || {}).length,
    last: META.last || 0, error: META.err || "", linked: UP.configured(), ok: RUN && ready() && !META.err };
}
const ago = t => { if (!t) return "never"; const s = Math.round((Date.now() - t) / 1000); return s < 10 ? "just now" : s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : Math.round(s / 3600) + "h ago"; };
function chip() {
  if (typeof document === "undefined") return;
  let b = document.getElementById("stSync");
  const bar = document.querySelector("#st-tools");                  // built by core right after login
  if (!bar) { setTimeout(chip, 400); return; }
  if (!b) { b = document.createElement("button"); b.className = "st-btn"; b.id = "stSync"; b.onclick = openPanel; }
  if (b.parentNode !== bar) bar.prepend(b);
  const s = status();
  b.textContent = s.ok ? (s.pending ? "⇅ syncing" : "⇅ synced") : s.pending ? `⇅ ${s.pending} queued` : "⇅ sync off";
  b.title = s.ok ? `Synced with your PC ${ago(s.last)}` : (s.error || "sync not running");
  b.style.color = s.ok ? "" : "var(--ink-faint, #7a8aa0)";
}
setInterval(chip, 30000);
function openPanel() {
  const m = document.getElementById("modal"), body = document.getElementById("modalBody"); if (!m || !body) return;
  const s = status(), esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const gb = n => n == null ? "—" : n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : Math.round(n / 1e6) + " MB";
  const rows = devices().map(d => `<tr><td>${esc(d.name)}${d.me ? " <span class='muted'>(this)</span>" : ""}</td><td class="${d.online ? "ok" : ""}">${d.online ? "online" : "last seen " + ago(d.seen)}</td>
    <td>${d.battery == null ? "—" : d.battery + "%" + (d.charging ? " ⚡" : "")}</td><td>${gb(d.free)} free</td></tr>`).join("");
  body.innerHTML = `<div class="phead"><span class="k">SYNC</span><h1>Device sync</h1><span class="sub">${s.ok ? "everything in step · " + ago(s.last) : esc(s.error || "not running")}</span></div>
    <div class="card"><p class="muted">Your logbook, tasks, settings, saved places, custom projects and apps, reminders, entertainment history and checklists follow you between devices through your PC.
    Passkeys, sign-in tokens and the admin access log never leave a device.</p>
    <table style="margin-top:12px"><thead><tr><th>device</th><th>state</th><th>battery</th><th>storage</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted">no devices yet</td></tr>`}</tbody></table>
    <p class="muted mono" style="font-size:11px;margin-top:12px">this device ${esc(s.device)} · rev ${s.rev} · ${s.pending} change${s.pending === 1 ? "" : "s"} waiting</p>
    <div class="row" style="gap:8px;margin-top:14px"><button class="btn" id="syncNow">SYNC NOW</button><button class="btn sm" id="syncClose">CLOSE</button></div></div>`;
  m.classList.add("show");
  document.getElementById("syncClose").onclick = () => m.classList.remove("show");
  document.getElementById("syncNow").onclick = async () => { await syncNow(); openPanel(); };
}

/* ------------------------------------------------------------- lifecycle */
let hooked = false;
function hook() {
  if (hooked) return; hooked = true;
  Storage.prototype.setItem = function (k, v) { const r = _set.call(this, k, v); if (this === localStorage && RUN && synced(k)) touch(k); return r; };
  Storage.prototype.removeItem = function (k) { const r = _rm.call(this, k); if (this === localStorage && RUN && synced(k)) touch(k); return r; };
  Storage.prototype.clear = function () { const r = _clear.call(this); if (this === localStorage && RUN) touch(null); return r; };
}
let touched = new Set(), touchT = 0;
function touch(k) { k == null ? allKeys().forEach(x => touched.add(x)) : touched.add(k); clearTimeout(touchT); touchT = setTimeout(() => { const ks = [...touched]; touched.clear(); capture(ks); }, 60); }

/* Different operator on this device → park the old operator's synced data and
   start clean, so one person's logbook never lands in another's account. */
function switchUser(user) {
  if (!META.user || META.user === user) { META.user = user; return; }
  const park = { meta: META, base: BASE, ctr: CTR, data: {} };
  for (const k of allKeys()) if (synced(k) && k !== "turd_devices") { park.data[k] = raw(k); }
  jput("turd_sync_park_" + META.user, park);
  for (const k of Object.keys(park.data)) putRaw(k, null);
  const back = jget("turd_sync_park_" + user, null);
  if (back) { for (const [k, v] of Object.entries(back.data || {})) putRaw(k, v); META = back.meta || {}; BASE = back.base || {}; CTR = back.ctr || {}; putRaw("turd_sync_park_" + user, null); }
  else { META = { pending: {} }; BASE = {}; CTR = {}; }
  META.pending = META.pending || {}; META.user = user; persistNow();
}

export function start(session) {
  SESSION = session || null;
  if (SESSION && SESSION.user) switchUser(SESSION.user);
  hook();
  RUN = true;
  persistNow();
  cycle();
  chip();
  if (!start._wired) {
    start._wired = true;
    addEventListener("online", () => kick(200));
    addEventListener("focus", () => kick(200));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { heartbeat(true); kick(100); } else { persistNow(); try { pollAbort && pollAbort.abort(); } catch (e) {} } });
    addEventListener("turd:uplink", () => kick(300));
    addEventListener("pagehide", persistNow);
    addEventListener("storage", e => { if (e.key && synced(e.key)) touch(e.key); });   // another tab on this device
    beatT = setInterval(() => { heartbeat(false); if (!loopOn) kick(0); }, 5 * 60000);
  }
  return status();
}
export function stop() { RUN = false; try { pollAbort && pollAbort.abort(); } catch (e) {} persistNow(); emit(); }
export async function syncNow() { lastBeat = 0; await cycle(); return status(); }

/* test + debug surface */
export const _internals = { cellsFor, applyRemote, capture, get META() { return META; }, get BASE() { return BASE; }, get DEV() { return DEV; }, STRAT, NEVER };
if (typeof window !== "undefined") window.TURD_SYNC = { start, stop, status, now: syncNow, devices, onStatus, synced };
export default { start, stop, status, syncNow, devices, onStatus, synced };
