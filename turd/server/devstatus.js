// ===========================================================================
// T.U.R.D. DEVICE STATUS — optional module for server.js (owned by the native
// apps thread). The Fold (Android app) reports its battery, charging state and
// free storage here; the PC's Home shows them with a "last seen" time.
//
//   require("./devstatus.js").attach(api, { readToken, bearer, body, send, F });
//
// POST /api/devstatus  (any signed-in token)
//   body { id, name, model, battery, charging, full, plug, tempC, storageFreeGB, storageTotalGB, ts }
//   -> { ok }
//   Sent by web/src/native.js (app open: on start, resume, charge change, every 5 min)
//   and by TurdStatus.java (app closed: about every 30 min, network only).
// GET  /api/devstatus  (signed in; admin sees every device, others see their own)
//   -> { ok, now, devices:[{ id, user, name, model, battery, charging, full, plug, tempC,
//                            storageFreeGB, storageTotalGB, lastSeen, ageSec, stale, ip }] }
//   stale = no report for 45+ min (background reports are ~30 min apart).
//
// Kept in memory and in DATA_DIR/devstatus.json (written at most every 30 s).
// No dependencies, nothing leaves this PC.
// ===========================================================================
"use strict";
const fs = require("fs");
const path = require("path");

const STALE_MS = 45 * 60e3;
const MAX_DEVICES = 20;
let DEV = {}, file = null, dirty = false, timer = null;

const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);
const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").slice(0, n) : "");

function load() {
  try { DEV = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch (e) { DEV = {}; }
}
function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try { fs.writeFileSync(file + ".tmp", JSON.stringify(DEV)); fs.renameSync(file + ".tmp", file); } catch (e) {}
  }, 30e3);
  if (timer.unref) timer.unref();
}

function view(d, now) {
  const age = Math.max(0, now - d.lastSeen);
  return Object.assign({}, d, { ageSec: Math.round(age / 1000), stale: age > STALE_MS });
}

exports.attach = function (api, h) {
  const { readToken, bearer, body, send } = h;
  file = (h.F || (n => path.join(process.env.DATA_DIR || path.join(__dirname, "data"), n)))("devstatus.json");
  load();

  api["POST /api/devstatus"] = async (req, res) => {
    const t = readToken(bearer(req));
    if (!t) return send(res, 401, { ok: false, error: "login required" });
    let b;
    try { b = await body(req); } catch (e) { return send(res, 400, { ok: false, error: "bad json" }); }
    const id = str(b.id, 40).replace(/[^\w-]/g, "");
    if (!id) return send(res, 400, { ok: false, error: "id required" });
    const key = t.user + ":" + id;
    if (!DEV[key] && Object.keys(DEV).length >= MAX_DEVICES) {
      // forget the device heard from longest ago
      const oldest = Object.keys(DEV).sort((a, c) => DEV[a].lastSeen - DEV[c].lastSeen)[0];
      delete DEV[oldest];
    }
    DEV[key] = {
      id, user: t.user,
      name: str(b.name, 60) || "Phone",
      model: str(b.model, 60),
      battery: num(b.battery, 0, 100),
      charging: !!b.charging,
      full: !!b.full,
      plug: ["ac", "usb", "wireless", "other", "none"].includes(b.plug) ? b.plug : "none",
      tempC: num(b.tempC, -40, 120),
      storageFreeGB: num(b.storageFreeGB, 0, 1e5),
      storageTotalGB: num(b.storageTotalGB, 0, 1e5),
      ip: (req.socket.remoteAddress || "").replace(/^::ffff:/, ""),
      lastSeen: Date.now(),
    };
    save();
    send(res, 200, { ok: true });
  };

  api["GET /api/devstatus"] = async (req, res) => {
    const t = readToken(bearer(req));
    if (!t) return send(res, 401, { ok: false, error: "login required" });
    const now = Date.now();
    const devices = Object.values(DEV)
      .filter(d => t.role === "admin" || d.user === t.user)
      .sort((a, c) => c.lastSeen - a.lastSeen)
      .map(d => view(d, now));
    send(res, 200, { ok: true, now, devices });
  };
};
