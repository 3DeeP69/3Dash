#!/usr/bin/env node
// ===========================================================================
// T.U.R.D. UPLINK SERVER — accounts, login, realtime chat, admin audit.
// Core is zero-dependency: Node 18+ core modules only (own RFC 6455 WebSocket).
// The optional AI assistant (server/assistant.js, see server/ASSISTANT.md) adds the
// official Anthropic SDK; if it's not installed the assistant degrades gracefully.
//
//   node server.js            -> http://localhost:8787  (also serves ../web)
//
// ENV
//   PORT=8787            listen port (hosts like Render inject this)
//   DATA_DIR=./data      users.json, chat.json, audit.jsonl, secret
//   STATIC_DIR=../web    the T.U.R.D. web app; set "" to disable static hosting
//   GEOIP=1              resolve city/network for public IPs (ipwho.is, cached)
//   ADMIN_PASSWORD=...   optional: seed admin with this instead of admin/admin
//
// WHAT THE ADMIN LOG RECORDS (and ONLY the admin log — never the chat, never
// other users): for each login attempt and each chat connection we store the
// operator name, the result, the connecting IP, a coarse geo/network lookup of
// that IP, and the connection details the browser reports (user-agent ->
// browser/OS/device, screen size, timezone, language), plus session start/end,
// duration and message count. GET /api/audit returns this to an admin token
// only. Chat messages themselves carry just the sender's name + role.
// ===========================================================================
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const STATIC_DIR = process.env.STATIC_DIR === "" ? null : path.resolve(process.env.STATIC_DIR || path.join(__dirname, "..", "web"));
const GEOIP = process.env.GEOIP !== "0";
const VERSION = "1.4.0";

const MAX_MSG = 2000, HISTORY = 500, AUDIT_MEM = 5000;
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 7;            // 7 days

fs.mkdirSync(DATA_DIR, { recursive: true });
const F = n => path.join(DATA_DIR, n);
const readJSON = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), "utf8")); } catch (e) { return d; } };
const writeJSON = (n, v) => { const tmp = F(n + ".tmp"); fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, F(n)); };
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const now = () => Date.now();
const rid = (n = 9) => crypto.randomBytes(n).toString("base64url");

/* ------------------------------------------------------------- secret + tokens */
let SECRET;
try { SECRET = fs.readFileSync(F("secret"), "utf8").trim(); } catch (e) {}
if (!SECRET) { SECRET = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(F("secret"), SECRET, { mode: 0o600 }); }
const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
function makeToken(u, role, sid) {
  const body = Buffer.from(JSON.stringify({ u, r: role, sid, exp: now() + TOKEN_TTL, v: (USERS[u] || {}).tv || 0 })).toString("base64url");
  return body + "." + sign(body);
}
function readToken(tok) {
  if (typeof tok !== "string" || !tok.includes(".")) return null;
  const [body, mac] = tok.split(".");
  const want = sign(body);
  if (!mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch (e) { return null; }
  const rec = USERS[p.u];
  if (!rec || p.exp < now() || (rec.tv || 0) !== p.v) return null;   // deleted user / rotated passkey -> revoked
  if (REVOKED[p.sid]) return null;                                   // this session was logged out
  return { user: p.u, role: rec.role, sid: p.sid, exp: p.exp };
}

/* ------------------------------------------------------------- users */
const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("hex") });
const checkPw = (pw, rec) => { try { const h = crypto.scryptSync(String(pw), rec.salt, 32); return crypto.timingSafeEqual(h, Buffer.from(rec.hash, "hex")); } catch (e) { return false; } };
let USERS = readJSON("users.json", null);
if (!USERS) {
  const pw = process.env.ADMIN_PASSWORD || "admin";
  USERS = { admin: { ...hashPw(pw), role: "admin", fresh: !process.env.ADMIN_PASSWORD, created: now(), tv: 0 } };
  writeJSON("users.json", USERS);
}
const saveUsers = () => writeJSON("users.json", USERS);
const validName = u => typeof u === "string" && /^[a-z0-9_.-]{2,24}$/i.test(u);

/* ------------------------------------------------------------- revoked sessions (logout) */
// Log out one session without rotating the passkey: revoke that token's sid until it expires.
let REVOKED = readJSON("revoked.json", {});
(function pruneRevoked() { const n = now(); let ch = false; for (const sid in REVOKED) if (REVOKED[sid] < n) { delete REVOKED[sid]; ch = true; } if (ch) try { writeJSON("revoked.json", REVOKED); } catch (e) {} })();
const saveRevoked = debounce(() => writeJSON("revoked.json", REVOKED), 500);

/* ------------------------------------------------------------- chat history */
let CHAT = readJSON("chat.json", []);
const saveChat = debounce(() => writeJSON("chat.json", CHAT.slice(-HISTORY)), 800);

/* ------------------------------------------------------------- audit (admin-only) */
// audit.jsonl holds full records and {patch:id,...} lines that update a record
// in place (used to close out a session with end time / duration / msg count).
let AUDIT = [];
(function loadAudit() {
  let lines = [];
  try { lines = fs.readFileSync(F("audit.jsonl"), "utf8").split("\n").filter(Boolean); } catch (e) { return; }
  const byId = new Map(), order = [];
  for (const ln of lines) {
    let o; try { o = JSON.parse(ln); } catch (e) { continue; }
    if (o.patch) { const r = byId.get(o.patch); if (r) { const { patch, ...rest } = o; Object.assign(r, rest); } }
    else { byId.set(o.id, o); order.push(o.id); }
  }
  AUDIT = order.map(id => byId.get(id)).filter(Boolean).slice(-AUDIT_MEM);
})();
function audit(entry) {
  const e = { id: rid(6), t: now(), ...entry };
  AUDIT.push(e); if (AUDIT.length > AUDIT_MEM) AUDIT.splice(0, AUDIT.length - AUDIT_MEM);
  fs.appendFile(F("audit.jsonl"), JSON.stringify(e) + "\n", () => {});
  return e;
}
function patchAudit(id, extra) {
  const e = AUDIT.find(x => x.id === id); if (!e) return;
  Object.assign(e, extra);
  fs.appendFile(F("audit.jsonl"), JSON.stringify({ patch: id, ...extra }) + "\n", () => {});
}

/* ------------------------------------------------------------- community events */
// Shared calendar events (owned by the Community calendar module on the client).
// Persisted to data/events.json; broadcast over the chat WS as {type:"cal",…}.
const EVT_CATS = ["meetup", "game", "stream", "movie", "trip", "bday", "work", "other"];
const EVT_REPEAT = ["none", "weekly", "biweekly", "monthly", "yearly"];
const MAX_EVENTS = 2000, EVT_SPAN = 62 * 864e5;
let EVENTS = readJSON("events.json", []);
const saveEvents = debounce(() => writeJSON("events.json", EVENTS.slice(-MAX_EVENTS)), 500);
const clampStr = (v, n) => String(v == null ? "" : v).slice(0, n);
function sanitizeEvent(d, owner, prev) {
  const start = +d.start, end = +d.end;
  if (!isFinite(start) || !isFinite(end) || end <= start || end - start > EVT_SPAN) return null;
  const cat = EVT_CATS.includes(d.cat) ? d.cat : "other";
  const repeat = EVT_REPEAT.includes(d.repeat) ? d.repeat : "none";
  const title = clampStr(d.title, 120).trim(); if (!title) return null;
  return {
    id: prev ? prev.id : rid(7),
    title, start, end, allDay: !!d.allDay, cat,
    where: clampStr(d.where, 160), notes: clampStr(d.notes, 2000),
    repeat, until: d.until != null && isFinite(+d.until) ? +d.until : null,
    by: prev ? prev.by : owner,                       // owner is server-set, never client
    created: prev ? prev.created : now(), updated: now(),
    rsvp: prev ? (prev.rsvp || {}) : {},
  };
}

/* ------------------------------------------------------------- device sync (per-user cell store) */
// Everyone's per-device app data (logbook, settings, …) syncs across their own devices as
// "cells": {k,id,v,ts,dev,del?,r}. Pure per-cell last-write-wins — the client (web/src/sync.js,
// owned by the Device-sync thread) splits localStorage keys into cells; the server only resolves
// conflicts, assigns a monotonic rev, and fans changes out (long-poll + a WS nudge).
const SYNC_DIR = path.join(DATA_DIR, "sync");
fs.mkdirSync(SYNC_DIR, { recursive: true });
const SYNC_MAXVAL = 256 * 1024, SYNC_MAXUSER = 8 * 1024 * 1024, SYNC_MAXOPS = 2000;
const syncDenied = k => typeof k !== "string" || !k || k === "turd_users" || k === "turd_audit"
  || /^turd_token/.test(k) || /^turd_uplink/.test(k) || /^turd_sync/.test(k) || /token|secret|passw|apikey/i.test(k);
const cellLen = c => (c.del || c.v == null) ? 0 : (typeof c.v === "string" ? c.v.length : JSON.stringify(c.v).length);
const syncCache = new Map();    // user -> { rev, cells: Map("k\u0000id" -> cell), bytes }
const syncWaiters = new Map();  // user -> Set(resolveFns) held by GET long-poll
const syncSavers = new Map();
const syncFile = user => path.join(SYNC_DIR, encodeURIComponent(user) + ".json");
function syncLoad(user) {
  let st = syncCache.get(user); if (st) return st;
  let raw = { rev: 0, cells: {} };
  try { raw = JSON.parse(fs.readFileSync(syncFile(user), "utf8")) || raw; } catch (e) {}
  const cells = new Map(); let bytes = 0;
  for (const c of Object.values(raw.cells || {})) { cells.set(c.k + "\u0000" + (c.id || ""), c); bytes += cellLen(c); }
  st = { rev: raw.rev || 0, cells, bytes }; syncCache.set(user, st); return st;
}
function syncSave(user) {
  if (syncSavers.has(user)) return;
  syncSavers.set(user, setTimeout(() => {
    syncSavers.delete(user); const st = syncCache.get(user); if (!st) return;
    const obj = { rev: st.rev, cells: {} }; for (const [key, c] of st.cells) obj.cells[key] = c;
    try { const tmp = syncFile(user) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, syncFile(user)); } catch (e) {}
  }, 800));
}
function syncNotify(user, rev) {
  const w = syncWaiters.get(user); if (w) { for (const fn of [...w]) try { fn(); } catch (e) {} }
  for (const [sock, m] of LIVE) if (m.user === user) wsSend(sock, { type: "sync", rev });   // bonus nudge
}

/* ------------------------------------------------------------- quick drop (per-user device↔device relay) */
// One-tap send of a link/text/photo/file between a user's own devices (lives in the chat section).
// Metadata in data/drops/<user>/index.json (chronological), files in data/drops/<user>/<id>.
const DROP_DIR = path.join(DATA_DIR, "drops");
const DROP_KEEP = 100, DROP_MAXFILE = 100 * 1024 * 1024, DROP_MAXUSER = 500 * 1024 * 1024, DROP_MAXTEXT = 8 * 1024;
const dropDirFor = user => path.join(DROP_DIR, encodeURIComponent(user));
const dropIndexFile = user => path.join(dropDirFor(user), "index.json");
function dropLoad(user) { try { const l = JSON.parse(fs.readFileSync(dropIndexFile(user), "utf8")); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function dropSave(user, list) { const dir = dropDirFor(user); fs.mkdirSync(dir, { recursive: true }); const tmp = dropIndexFile(user) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, dropIndexFile(user)); }
function dropEvict(user, list) {   // keep newest DROP_KEEP; trim until file bytes <= DROP_MAXUSER
  let bytes = list.reduce((n, d) => n + (d.size || 0), 0);
  while (list.length > DROP_KEEP || (bytes > DROP_MAXUSER && list.length)) {
    const old = list.shift(); if (!old) break; bytes -= old.size || 0;
    if (old.kind === "file") { try { fs.unlinkSync(path.join(dropDirFor(user), old.id)); } catch (e) {} }
  }
}
function broadcastUser(user, obj) { for (const [sock, m] of LIVE) if (m.user === user) wsSend(sock, obj); }

/* ------------------------------------------------------------- geo/network lookup */
const GEO_CACHE = new Map();
function clientIP(req) {
  const xf = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  let ip = xf || req.socket.remoteAddress || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}
const isPrivate = ip => !ip || ip === "::1" || ip === "127.0.0.1" || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd");
function geo(ip) {
  return new Promise(resolve => {
    if (!GEOIP || isPrivate(ip)) return resolve({ place: isPrivate(ip) ? "local network" : "", net: "" });
    if (GEO_CACHE.has(ip)) return resolve(GEO_CACHE.get(ip));
    const done = v => { GEO_CACHE.set(ip, v); resolve(v); };
    const req = https.get(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country,connection`, r => {
      let b = ""; r.on("data", d => b += d); r.on("end", () => {
        try { const j = JSON.parse(b); if (!j.success) return done({ place: "", net: "" });
          done({ place: [j.city, j.region, j.country].filter(Boolean).join(", "), net: (j.connection && (j.connection.isp || j.connection.org)) || "" });
        } catch (e) { done({ place: "", net: "" }); }
      });
    });
    req.on("error", () => done({ place: "", net: "" }));
    req.setTimeout(4000, () => { req.destroy(); done({ place: "", net: "" }); });
  });
}
// Parse the user-agent the browser sends into readable browser / OS / device.
function ua(s) {
  s = String(s || "");
  const m = (re, i = 1) => { const x = s.match(re); return x ? x[i] : ""; };
  let browser = m(/Edg\/([\d.]+)/) ? "Edge " + m(/Edg\/([\d.]+)/)
    : /OPR\//.test(s) ? "Opera " + m(/OPR\/([\d.]+)/)
    : /Firefox\//.test(s) ? "Firefox " + m(/Firefox\/([\d.]+)/)
    : /Chrome\//.test(s) ? "Chrome " + m(/Chrome\/([\d.]+)/)
    : /Safari\//.test(s) && /Version\//.test(s) ? "Safari " + m(/Version\/([\d.]+)/)
    : "";
  let os = /Windows NT 10/.test(s) ? "Windows 10/11"
    : /Windows NT/.test(s) ? "Windows"
    : /Android ([\d.]+)/.test(s) ? "Android " + m(/Android ([\d.]+)/)
    : /iPhone OS ([\d_]+)/.test(s) ? "iOS " + m(/iPhone OS ([\d_]+)/).replace(/_/g, ".")
    : /iPad/.test(s) ? "iPadOS"
    : /Mac OS X ([\d_]+)/.test(s) ? "macOS " + m(/Mac OS X ([\d_]+)/).replace(/_/g, ".")
    : /Linux/.test(s) ? "Linux" : "";
  let device = /Mobile|iPhone|Android.*Mobile/.test(s) ? "phone" : /iPad|Tablet/.test(s) ? "tablet" : "desktop";
  return { browser: browser.trim(), os: os.trim(), device };
}

/* ------------------------------------------------------------- JSON http helpers */
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" }); res.end(b); };
function body(req) {
  return new Promise((resolve, reject) => { let b = "", n = 0;
    req.on("data", d => { n += d.length; if (n > 1e6) { reject(new Error("too large")); req.destroy(); } b += d; });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const bearer = req => { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7) : (new URL(req.url, "http://x").searchParams.get("token") || ""); };

/* ------------------------------------------------------------- audit -> admin HTML */
function auditHTML() {
  const rows = AUDIT.slice().reverse();
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dur = ms => { if (ms == null) return ""; const s = Math.round(ms / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h"; };
  const body = rows.length ? rows.map(r => {
    const kind = r.kind === "chat" ? (r.end ? "CHAT ✓" : "CHAT ●") : (r.ok ? "LOGIN ✓" : "LOGIN ✕");
    const cls = r.kind === "chat" ? (r.end ? "" : "ok") : (r.ok ? "ok" : "bad");
    const dev = [r.ua && r.ua.browser, r.ua && r.ua.os, r.ua && r.ua.device].filter(Boolean).join(" · ");
    const net = [r.place, r.net].filter(Boolean).join(" · ");
    const extra = r.kind === "chat"
      ? `online ${dur(r.dur)} · ${r.msgs || 0} msg${r.msgs === 1 ? "" : "s"}`
      : (r.note || "");
    return `<tr><td>${esc(new Date(r.t).toLocaleString())}</td><td>${esc(r.user)}</td>
      <td class="${cls}">${kind}</td><td>${esc(r.ip)}</td><td>${esc(net)}</td>
      <td>${esc(dev)}${r.screen ? ` · ${esc(r.screen)}` : ""}</td>
      <td>${esc([r.tz, r.lang].filter(Boolean).join(" · "))}</td><td>${esc(extra)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="muted">no network uplinks recorded yet</td></tr>`;
  return `<div class="phead" style="--accent:#ff5c7a;margin-top:26px"><span class="k">NET</span><h1>Network Uplinks</h1><span class="sub">${rows.length} records · server-side · admin-only</span></div>
    <p class="muted" style="font-family:var(--mono);font-size:11px;margin-bottom:10px">Captured for every login &amp; chat connection — IP, approximate location/network, device, screen, timezone &amp; language. Visible only here.</p>
    <table><thead><tr><th>time</th><th>operator</th><th>event</th><th>ip</th><th>location · network</th><th>device</th><th>zone · lang</th><th>detail</th></tr></thead><tbody>${body}</tbody></table>`;
}

/* ===========================================================================
   HTTP API
   =========================================================================== */
const api = {
  async "POST /api/login"(req, res) {
    const d = await body(req).catch(() => ({}));
    const user = String(d.user || "").trim(), pw = String(d.pw || "");
    const ip = clientIP(req), g = await geo(ip), det = ua(req.headers["user-agent"]);
    const client = d.client || {};
    const base = { kind: "login", user: user.slice(0, 40), ip, place: g.place, net: g.net, ua: det,
      screen: String(client.screen || "").slice(0, 16), tz: String(client.tz || "").slice(0, 48), lang: String(client.lang || "").slice(0, 24) };
    const rec = USERS[user];
    if (!rec || !checkPw(pw, rec)) { audit({ ...base, ok: false, note: rec ? "bad passkey" : "unknown operator" }); return send(res, 401, { ok: false }); }
    audit({ ...base, ok: true, note: "granted" });
    const sid = rid(6);
    send(res, 200, { ok: true, role: rec.role, fresh: !!rec.fresh, token: makeToken(user, rec.role, sid), user });
  },

  async "POST /api/register"(req, res) {
    // Invite-only by default (OPEN_SIGNUP=1 to allow public self-registration).
    if (process.env.OPEN_SIGNUP !== "1") return send(res, 403, { ok: false, error: "invite-only — ask the admin to create your operator account" });
    const d = await body(req).catch(() => ({}));
    const user = String(d.user || "").trim(), pw = String(d.pw || "");
    if (!validName(user)) return send(res, 400, { ok: false, error: "name must be 2–24 letters/digits/._-" });
    if (pw.length < 4) return send(res, 400, { ok: false, error: "passkey needs 4+ characters" });
    if (USERS[user]) return send(res, 409, { ok: false, error: "operator id already taken" });
    USERS[user] = { ...hashPw(pw), role: "user", fresh: false, created: now(), tv: 0 }; saveUsers();
    const ip = clientIP(req), g = await geo(ip), det = ua(req.headers["user-agent"]), client = d.client || {};
    audit({ kind: "login", user, ok: true, note: "account created", ip, place: g.place, net: g.net, ua: det,
      screen: String(client.screen || "").slice(0, 16), tz: String(client.tz || "").slice(0, 48), lang: String(client.lang || "").slice(0, 24) });
    const sid = rid(6);
    send(res, 200, { ok: true, role: "user", fresh: false, token: makeToken(user, "user", sid), user });
  },

  async "POST /api/users"(req, res) {
    // admin-only: create an operator account (invite-only flow)
    const t = readToken(bearer(req)); if (!t || t.role !== "admin") return send(res, 403, { ok: false, error: "admin clearance required" });
    const d = await body(req).catch(() => ({}));
    const user = String(d.user || "").trim(), pw = String(d.pw || ""), role = d.role === "admin" ? "admin" : "user";
    if (!validName(user)) return send(res, 400, { ok: false, error: "name must be 2–24 letters/digits/._-" });
    if (pw.length < 4) return send(res, 400, { ok: false, error: "passkey needs 4+ characters" });
    if (USERS[user]) return send(res, 409, { ok: false, error: "operator id already taken" });
    USERS[user] = { ...hashPw(pw), role, fresh: false, created: now(), createdBy: t.user, tv: 0 }; saveUsers();
    audit({ kind: "login", user, ok: true, note: `account created by ${t.user}`, ip: clientIP(req) });
    send(res, 200, { ok: true, user, role });
  },

  async "GET /api/users"(req, res) {
    const t = readToken(bearer(req)); if (!t || t.role !== "admin") return send(res, 403, { ok: false, error: "admin clearance required" });
    send(res, 200, { ok: true, users: Object.entries(USERS).map(([u, r]) => ({ user: u, role: r.role, created: r.created, createdBy: r.createdBy || null })) });
  },

  async "POST /api/setpass"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false });
    const d = await body(req).catch(() => ({}));
    const pw = String(d.pw || ""); if (pw.length < 4) return send(res, 400, { ok: false, error: "passkey needs 4+ characters" });
    const rec = USERS[t.user]; if (!rec) return send(res, 404, { ok: false });
    Object.assign(rec, hashPw(pw), { fresh: false, tv: (rec.tv || 0) + 1 }); saveUsers();   // tv++ revokes old tokens
    audit({ kind: "login", user: t.user, ok: true, note: "passkey rotated", ip: clientIP(req) });
    send(res, 200, { ok: true, token: makeToken(t.user, rec.role, rid(6)), role: rec.role, user: t.user });
  },

  async "POST /api/logout"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 200, { ok: true });   // already invalid/expired
    REVOKED[t.sid] = t.exp || (now() + TOKEN_TTL); saveRevoked();                     // revoke just this session
    for (const [sock, m] of LIVE) if (m.sid === t.sid) { try { sock.end(); } catch (e) {} }   // close handler records session end
    audit({ kind: "login", user: t.user, ok: true, note: "logged out", ip: clientIP(req) });
    send(res, 200, { ok: true });
  },

  async "GET /api/audit"(req, res) {
    const t = readToken(bearer(req));
    if (!t || t.role !== "admin") return send(res, 403, { ok: false, error: "admin clearance required" });
    send(res, 200, { ok: true, html: auditHTML(), count: AUDIT.length });
  },

  async "GET /api/events"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    send(res, 200, { events: EVENTS });
  },

  async "POST /api/events"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    const d = await body(req).catch(() => ({}));
    const prev = d.id ? EVENTS.find(e => e.id === d.id) : null;
    if (prev && prev.by !== t.user && t.role !== "admin") return send(res, 403, { ok: false, error: "only the owner or an admin can edit this event" });
    const ev = sanitizeEvent(d, t.user, prev);
    if (!ev) return send(res, 400, { ok: false, error: "invalid event (title, and end>start within 62 days)" });
    if (prev) EVENTS[EVENTS.indexOf(prev)] = ev;
    else { EVENTS.push(ev); if (EVENTS.length > MAX_EVENTS) EVENTS.splice(0, EVENTS.length - MAX_EVENTS); }
    saveEvents(); broadcast({ type: "cal", op: "put", event: ev });
    send(res, 200, { event: ev });
  },

  async "POST /api/sync"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    const d = await body(req).catch(() => ({}));
    const ops = Array.isArray(d.ops) ? d.ops : [];
    if (ops.length > SYNC_MAXOPS) return send(res, 413, { ok: false, error: "too many ops" });
    const reqDev = String(d.dev || "").slice(0, 64);
    const st = syncLoad(t.user); let changed = false; const back = new Map();
    for (const op of ops) {
      if (!op || syncDenied(op.k)) continue;
      const ts = +op.ts; if (!isFinite(ts)) continue;
      const id = String(op.id == null ? "" : op.id);
      const dev = String(op.dev || reqDev || "").slice(0, 64);
      const del = !!op.del;
      const nc = { k: op.k, id, v: del ? null : op.v, ts, dev, del };
      const vlen = cellLen(nc);
      if (vlen > SYNC_MAXVAL) return send(res, 413, { ok: false, error: "cell too large" });
      const ck = op.k + "\u0000" + id;
      const ex = st.cells.get(ck);
      if (ex && !(ts > ex.ts || (ts === ex.ts && dev > (ex.dev || "")))) { back.set(ck, ex); continue; }   // lost LWW → hand the winner back
      const oldLen = ex ? cellLen(ex) : 0;
      if (st.bytes - oldLen + vlen > SYNC_MAXUSER) return send(res, 413, { ok: false, error: "quota exceeded" });
      nc.r = ++st.rev; st.cells.set(ck, nc); st.bytes += vlen - oldLen; changed = true;
    }
    if (changed) { syncSave(t.user); syncNotify(t.user, st.rev); }
    // items = the winning server cell for every op that lost, so a behind-clock device still learns it
    send(res, 200, { ok: true, rev: st.rev, now: Date.now(), items: [...back.values()] });
  },

  async "GET /api/sync"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    const q = new URL(req.url, "http://x").searchParams;
    const since = +q.get("since") || 0, wait = Math.min(Math.max(+q.get("wait") || 0, 0), 25);
    const st = syncLoad(t.user);
    const collect = () => [...st.cells.values()].filter(c => (c.r || 0) > since);
    const items = collect();
    if (items.length || !wait) return send(res, 200, { ok: true, rev: st.rev, now: Date.now(), items });
    let w = syncWaiters.get(t.user); if (!w) { w = new Set(); syncWaiters.set(t.user, w); }   // long-poll hold
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); w.delete(finish); send(res, 200, { ok: true, rev: st.rev, now: Date.now(), items: collect() }); };
    const timer = setTimeout(finish, wait * 1000);
    w.add(finish);
    req.on("close", () => { if (done) return; done = true; clearTimeout(timer); w.delete(finish); });
  },

  async "GET /api/drop"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    send(res, 200, { ok: true, drops: dropLoad(t.user).slice(-50) });
  },

  async "POST /api/drop"(req, res) {
    const t = readToken(bearer(req)); if (!t) return send(res, 401, { ok: false, error: "login required" });
    const d = await body(req).catch(() => ({}));
    const kind = d.kind === "link" ? "link" : "text";
    const text = String(d.text || "").slice(0, DROP_MAXTEXT); if (!text.trim()) return send(res, 400, { ok: false, error: "empty drop" });
    const drop = { id: rid(7), kind, text, by: t.user, dev: String(d.dev || "").slice(0, 64), t: now() };
    const list = dropLoad(t.user); list.push(drop); dropEvict(t.user, list); dropSave(t.user, list);
    broadcastUser(t.user, { type: "drop", op: "put", drop });
    send(res, 200, { ok: true, drop });
  },

  async "GET /api/health"(req, res) { send(res, 200, { ok: true, version: VERSION, online: [...LIVE.values()].length, host: { mac: process.env.TURD_HOST_MAC || null, name: process.env.TURD_HOST_NAME || null } }); },
};

/* dynamic /api/events/:id routes (handled before the static map) */
async function eventsDynamic(req, res, m) {
  const t = readToken(bearer(req)); if (!t) { send(res, 401, { ok: false, error: "login required" }); return true; }
  const id = decodeURIComponent(m[1]);
  const idx = EVENTS.findIndex(e => e.id === id);
  if (req.method === "DELETE" && !m[2]) {
    if (idx < 0) { send(res, 404, { ok: false }); return true; }
    if (EVENTS[idx].by !== t.user && t.role !== "admin") { send(res, 403, { ok: false, error: "only the owner or an admin can delete this event" }); return true; }
    EVENTS.splice(idx, 1); saveEvents(); broadcast({ type: "cal", op: "del", id });
    res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); return true;
  }
  if (req.method === "POST" && m[2] === "rsvp") {
    if (idx < 0) { send(res, 404, { ok: false }); return true; }
    const d = await body(req).catch(() => ({}));
    const ev = EVENTS[idx]; ev.rsvp = ev.rsvp || {};
    if (d.state === "going" || d.state === "maybe") ev.rsvp[t.user] = d.state;
    else delete ev.rsvp[t.user];                       // null / anything else clears
    ev.updated = now(); saveEvents(); broadcast({ type: "cal", op: "put", event: ev });
    send(res, 200, { event: ev }); return true;
  }
  return false;
}

/* dynamic quick-drop file routes (handled before the static map, like events):
   POST /api/drop/file?name=&mime=&dev= (streamed upload), GET /api/drop/file/:id (download),
   DELETE /api/drop/:id. Files relay through the user's own server — never leave their box. */
async function dropFile(req, res, id) {
  const t = readToken(bearer(req)); if (!t) { send(res, 401, { ok: false, error: "login required" }); return true; }
  const dir = dropDirFor(t.user);
  if (req.method === "GET" && id) {
    const drop = dropLoad(t.user).find(d => d.id === id && d.kind === "file");
    if (!drop) { send(res, 404, { ok: false }); return true; }
    const fp = path.join(dir, id);
    fs.stat(fp, (e, st) => {
      if (e) { send(res, 404, { ok: false }); return; }
      res.writeHead(200, { "content-type": drop.mime || "application/octet-stream", "content-length": st.size,
        "content-disposition": `attachment; filename="${encodeURIComponent(drop.name || "file")}"`, "access-control-allow-origin": "*" });
      fs.createReadStream(fp).pipe(res);
    });
    return true;
  }
  if (req.method === "POST" && !id) {
    const u = new URL(req.url, "http://x");
    const name = String(u.searchParams.get("name") || "file").slice(0, 200);
    const mime = String(u.searchParams.get("mime") || "application/octet-stream").slice(0, 100);
    const dev = String(u.searchParams.get("dev") || "").slice(0, 64);
    fs.mkdirSync(dir, { recursive: true });
    const newId = rid(7), fp = path.join(dir, newId), tmp = fp + ".part";
    const ws = fs.createWriteStream(tmp); let size = 0, aborted = false;
    const fail = (code, err) => { if (aborted) return; aborted = true; try { ws.destroy(); } catch (e) {} try { fs.unlinkSync(tmp); } catch (e) {} send(res, code, { ok: false, error: err }); try { req.destroy(); } catch (e) {} };
    req.on("data", chunk => { size += chunk.length; if (size > DROP_MAXFILE) fail(413, "file too large"); });
    req.on("error", () => fail(400, "upload error"));
    ws.on("error", () => fail(500, "write error"));
    req.pipe(ws);
    ws.on("finish", () => {
      if (aborted) return;
      try { fs.renameSync(tmp, fp); } catch (e) { send(res, 500, { ok: false }); return; }
      const drop = { id: newId, kind: "file", name, mime, size, by: t.user, dev, t: now() };
      const list = dropLoad(t.user); list.push(drop); dropEvict(t.user, list); dropSave(t.user, list);
      broadcastUser(t.user, { type: "drop", op: "put", drop });
      send(res, 200, { ok: true, drop });
    });
    return true;
  }
  return false;
}
async function dropDelete(req, res, id) {
  const t = readToken(bearer(req)); if (!t) { send(res, 401, { ok: false, error: "login required" }); return true; }
  const list = dropLoad(t.user); const idx = list.findIndex(d => d.id === id);
  if (idx < 0) { send(res, 404, { ok: false }); return true; }
  const [d] = list.splice(idx, 1);
  if (d.kind === "file") { try { fs.unlinkSync(path.join(dropDirFor(t.user), d.id)); } catch (e) {} }
  dropSave(t.user, list); broadcastUser(t.user, { type: "drop", op: "del", id });
  res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); return true;
}

/* Optional PC-stats module (server/pcstats.js; owned by the Home thread). Admin-only
   GET /api/pcstats. online:() reads LIVE at request time, so the const-below order is fine. */
try { require("./pcstats.js").attach(api, { readToken, bearer, send, online: () => LIVE.size }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("pcstats module error:", e.message); }

/* Optional AI-assistant module (server/assistant.js; see server/ASSISTANT.md).
   Adds /api/assistant/* keys
   to the api map; absent file is a silent no-op. Owned by the assistant thread. */
try { require("./assistant.js").attach(api, { readToken, bearer, body, send, F, audit }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("assistant module error:", e.message); }

/* Optional game-launcher module (server/games.js; owned by the entertainment thread).
   Literal require so the SEA esbuild bundle picks it up; absent file is a silent no-op. */
try { require("./games.js").attach(api, { readToken, bearer, body, send, audit, F }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("games module error:", e.message); }

/* Optional Now-Playing module (server/media.js; owned by the entertainment thread).
   Adds /api/media, /api/media/art, POST /api/media/control, and SSE /api/media/stream (writes its own headers). */
try { require("./media.js").attach(api, { readToken, bearer, body, send, audit, F }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("media module error:", e.message); }

/* Optional device-status module (server/devstatus.js; owned by the native apps thread).
   The Fold reports battery/charging/storage; the PC's Home shows it. Literal require for the SEA bundle. */
try { require("./devstatus.js").attach(api, { readToken, bearer, body, send, F }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("devstatus module error:", e.message); }

/* Optional internet-health module (server/netmon.js; owned by the core/chat thread).
   Background ISP-outage monitor + exportable downtime log; read by Spy Tools + Home.
   Adds GET /api/net/status, /api/net/outages, /api/net/export. Literal require for the SEA bundle. */
try { require("./netmon.js").attach(api, { readToken, bearer, send, F }); }
catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.log("netmon module error:", e.message); }

/* ===========================================================================
   STATIC FILES (serve the web app in dev / single-box deploys)
   =========================================================================== */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
function serveStatic(req, res) {
  if (!STATIC_DIR) return send(res, 404, { error: "not found" });
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const fp = path.join(STATIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!fp.startsWith(STATIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(fp, (e, buf) => {
    if (e) return send(res, 404, { error: "not found" });
    let out = buf;
    // When WE serve the app, auto-point its uplink at this same origin so there's
    // no manual "Link uplink" step (localhost desktop, LAN, or a hosted URL).
    if (fp.endsWith("index.html")) {
      const inj = `<script>window.TURD_UPLINK=location.origin;</script>`;
      out = Buffer.from(buf.toString().replace("</head>", inj + "\n</head>"));
    }
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(out);
  });
}

/* ===========================================================================
   SERVER + WEBSOCKET UPGRADE
   =========================================================================== */
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const pathname = new URL(req.url, "http://x").pathname;
    const key = req.method + " " + pathname;
    if (api[key]) return api[key](req, res);
    const em = pathname.match(/^\/api\/events\/([^/]+)(?:\/(rsvp))?$/);
    if (em && (req.method === "DELETE" || req.method === "POST")) { if (await eventsDynamic(req, res, em)) return; }
    const dmF = pathname.match(/^\/api\/drop\/file(?:\/([^/]+))?$/);
    if (dmF && (req.method === "POST" || req.method === "GET")) { if (await dropFile(req, res, dmF[1])) return; }
    const dmD = pathname.match(/^\/api\/drop\/([^/]+)$/);
    if (dmD && dmD[1] !== "file" && req.method === "DELETE") { if (await dropDelete(req, res, dmD[1])) return; }
    if (req.method === "GET") return serveStatic(req, res);
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: "server error" }); }
});

/* ---- minimal RFC 6455 WebSocket (no deps) ---- */
const LIVE = new Map();   // ws -> { user, role, sid, auditId, start, msgs }
function wsAccept(key) { return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64"); }
function wsSend(sock, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const len = data.length; let head;
  if (len < 126) { head = Buffer.from([0x81, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  try { sock.write(Buffer.concat([head, data])); } catch (e) {}
}
function broadcast(obj, exclude) { for (const sock of LIVE.keys()) if (sock !== exclude) wsSend(sock, obj); }
function roster() { return [...LIVE.values()].map(m => ({ user: m.user, role: m.role })); }

server.on("upgrade", async (req, socket) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname !== "/ws") { socket.destroy(); return; }
  const t = readToken(u.searchParams.get("token") || "");
  if (!t) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  const key = req.headers["sec-websocket-key"];
  socket.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\nConnection: Upgrade\r\n" + "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n");

  const ip = clientIP(req), g = await geo(ip), det = ua(req.headers["user-agent"]);
  const client = { screen: u.searchParams.get("screen") || "", tz: u.searchParams.get("tz") || "", lang: u.searchParams.get("lang") || "" };
  const a = audit({ kind: "chat", user: t.user, role: t.role, ip, place: g.place, net: g.net, ua: det,
    screen: client.screen.slice(0, 16), tz: client.tz.slice(0, 48), lang: client.lang.slice(0, 24), note: "connected" });
  const meta = { user: t.user, role: t.role, sid: t.sid, auditId: a.id, start: now(), msgs: 0 };
  LIVE.set(socket, meta);

  wsSend(socket, { type: "hello", user: t.user, role: t.role, history: CHAT.slice(-120), roster: roster() });
  broadcast({ type: "presence", roster: roster(), joined: { user: t.user, role: t.role } }, socket);

  let buf = Buffer.alloc(0);
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (masked) off += 4; if (buf.length < off + len) break;
      const mask = masked ? buf.slice(off - 4, off) : null;
      const payload = buf.slice(off, off + len); buf = buf.slice(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 0x8) { try { socket.end(); } catch (e) {} return; }      // close
      if (op === 0x9) { try { socket.write(Buffer.from([0x8a, 0])); } catch (e) {} continue; } // ping->pong
      if (op === 0x1) handleMsg(socket, payload.toString("utf8"));
    }
  });
  const close = () => {
    const m = LIVE.get(socket); if (!m) return; LIVE.delete(socket);
    patchAudit(m.auditId, { end: now(), dur: now() - m.start, msgs: m.msgs, note: "disconnected" });
    broadcast({ type: "presence", roster: roster(), left: { user: m.user } });
  };
  socket.on("close", close); socket.on("error", close); socket.on("end", close);
});

function handleMsg(socket, raw) {
  const m = LIVE.get(socket); if (!m) return;
  let d; try { d = JSON.parse(raw); } catch (e) { return; }
  if (d.type === "typing") { broadcast({ type: "typing", user: m.user }, socket); return; }
  if (d.type === "msg") {
    const text = String(d.text || "").slice(0, MAX_MSG).trim(); if (!text) return;
    m.msgs++;
    const msg = { id: rid(6), type: "msg", user: m.user, role: m.role, text, t: now() };
    CHAT.push(msg); if (CHAT.length > HISTORY) CHAT.splice(0, CHAT.length - HISTORY); saveChat();
    broadcast(msg);
  }
}

server.listen(PORT, () => {
  console.log(`T.U.R.D. uplink v${VERSION} on :${PORT}  (data: ${DATA_DIR}, static: ${STATIC_DIR || "off"}, geoip: ${GEOIP ? "on" : "off"})`);
});
