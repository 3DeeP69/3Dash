// ===========================================================================
// T.U.R.D. PC STATUS — optional module for server.js (owned by the at-a-glance
// thread, used by the Home "PC status" card). Zero dependencies, free sources only.
//
//   require("./pcstats.js").attach(api, { readToken, bearer, send, online? });
//
// GET /api/pcstats  (admin token)  ->
//   { ok, host, os, uptime, t,
//     cpu:  { pct, cores, model },
//     ram:  { usedGB, totalGB, pct },
//     disk: { freeGB, totalGB, pct, drive } | null,
//     gpu:  { tempC, pct, name, src } | null,      // nvidia-smi, or LibreHardwareMonitor's web server
//     ollama: { up, version, models:[loaded model names] },
//     chat: { up:true, online:<connected users> } }
//
// Near-live (Home polls ~every 1.5 s) but light on a low-end PC:
//   · CPU: os.cpus() deltas every 1 s, only while someone looked in the last 20 s
//   · GPU: ONE long-running `nvidia-smi -lms 1500` while watched (no process spawn
//     per poll); else LibreHardwareMonitor's local web server, cached 2 s
//   · Ollama 5 s, disk 30 s; concurrent callers (PC + Fold) share one read
//   · a GPU tool that isn't installed is not retried for 10 minutes
// ===========================================================================
"use strict";
const os = require("os");
const fs = require("fs");
const http = require("http");
const { execFile, spawn } = require("child_process");

/* ---------------- CPU: rolling delta of os.cpus() times ---------------- */
const IDLE = 20e3;
let cpuPrev = null, cpuPct = null, cpuTimer = null, lastAsk = 0;
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
  return { idle, total };
}
function cpuTick() {
  const now = cpuTimes();
  if (cpuPrev) {
    const di = now.idle - cpuPrev.idle, dt = now.total - cpuPrev.total;
    if (dt > 0) cpuPct = Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
  }
  cpuPrev = now;
  if (Date.now() - lastAsk > IDLE) { clearInterval(cpuTimer); cpuTimer = null; cpuPrev = null; stopSmi(); }   // nobody watching: stop
}
function wakeCpu() {
  lastAsk = Date.now();
  if (!cpuTimer) { cpuTick(); cpuTimer = setInterval(cpuTick, 1000); cpuTimer.unref && cpuTimer.unref(); }
}

/* ---------------- tiny helpers ---------------- */
const cache = new Map(), inflight = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v;
  if (inflight.has(key)) return inflight.get(key);          // PC + Fold polling at once share one read
  const p = fn().catch(() => null).then(v => { cache.set(key, { t: Date.now(), v }); inflight.delete(key); return v; });
  inflight.set(key, p);
  return p;
}
function getJSON(url, ms = 1500) {
  return new Promise((res, rej) => {
    const r = http.get(url, { timeout: ms }, resp => {
      let d = ""; resp.setEncoding("utf8");
      resp.on("data", c => { d += c; if (d.length > 2e6) r.destroy(); });
      resp.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", rej);
  });
}
function run(cmd, args, ms = 2500) {
  return new Promise((res, rej) => execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, out) => e ? rej(e) : res(String(out))));
}
const GB = b => Math.round(b / 1073741824 * 10) / 10;

/* ---------------- disk ---------------- */
async function disk() {
  const drive = process.platform === "win32" ? ((process.env.SystemDrive || "C:") + "\\") : "/";
  if (!fs.promises.statfs) return null;                       // Node < 18.15
  const s = await fs.promises.statfs(drive);
  const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
  return { freeGB: GB(free), totalGB: GB(total), pct: total ? Math.round((1 - free / total) * 100) : null, drive };
}

/* ---------------- GPU: nvidia-smi, else LibreHardwareMonitor (free, optional) ---------------- */
let smiMissingUntil = 0, smi = null, smiLast = null;
function parseSmi(line) {
  const [t, u, ...name] = String(line).split(",").map(s => s.trim());
  return t && !isNaN(+t) ? { tempC: +t, pct: isNaN(+u) ? null : +u, name: name.join(",").trim(), src: "nvidia-smi" } : null;
}
// one nvidia-smi that prints a line every 1.5 s while someone is watching, instead of a spawn per poll
function startSmi() {
  if (smi || Date.now() < smiMissingUntil) return;
  try {
    smi = spawn("nvidia-smi", ["--query-gpu=temperature.gpu,utilization.gpu,name", "--format=csv,noheader,nounits", "-lms", "1500"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { smi = null; smiMissingUntil = Date.now() + 10 * 60e3; return; }
  let buf = "";
  smi.stdout.setEncoding("utf8");
  smi.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const g = parseSmi(buf.slice(0, i)); buf = buf.slice(i + 1); if (g) smiLast = { ...g, t: Date.now() }; } if (buf.length > 4096) buf = ""; });
  smi.on("error", () => { smiMissingUntil = Date.now() + 10 * 60e3; smi = null; smiLast = null; });
  smi.on("exit", () => { smi = null; });
}
function stopSmi() { if (smi) { try { smi.kill(); } catch (e) {} smi = null; } }
process.on("exit", stopSmi);
async function gpu() {
  if (Date.now() > smiMissingUntil) {
    startSmi();
    if (smiLast && Date.now() - smiLast.t < 5000) { const { t, ...g } = smiLast; return g; }
    if (!smiLast) {                                            // first look: one quick read so the card isn't blank
      try { const g = parseSmi((await run("nvidia-smi", ["--query-gpu=temperature.gpu,utilization.gpu,name", "--format=csv,noheader,nounits"])).split("\n")[0]); if (g) { smiLast = { ...g, t: Date.now() }; return g; } }
      catch (e) { smiMissingUntil = Date.now() + 10 * 60e3; stopSmi(); }
    }
  }
  // LibreHardwareMonitor → Options → Remote Web Server (port 8085) exposes /data.json (a big tree: read at most every 3 s)
  if (lhmLast && Date.now() - lhmLast.t < 3000) return lhmLast.v;
  const v = await lhm(); lhmLast = { t: Date.now(), v }; return v;
}
let lhmLast = null;
async function lhm() {
  try {
    const j = await getJSON("http://127.0.0.1:8085/data.json", 1200);
    let best = null;
    (function walk(n, path) {
      const here = path.concat(n.Text || "");
      if (n.Children && n.Children.length) return n.Children.forEach(c => walk(c, here));
      const v = parseFloat(String(n.Value || "").replace(",", "."));
      const p = here.join(" / ").toLowerCase();
      if (/gpu/.test(p) && /temperatures?/.test(p) && /core|gpu/.test((n.Text || "").toLowerCase()) && !isNaN(v) && (!best || /core/.test((n.Text || "").toLowerCase())))
        best = { tempC: Math.round(v), pct: null, name: (here.find(s => /nvidia|amd|radeon|intel|geforce|arc/i.test(s)) || "GPU"), src: "LibreHardwareMonitor" };
    })(j, []);
    if (best) return best;
  } catch (e) {}
  return null;
}

/* ---------------- Ollama ---------------- */
async function ollama() {
  const base = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/^(?!http)/, "http://");
  try {
    const v = await getJSON(base + "/api/version", 1500);
    let models = [];
    try { const ps = await getJSON(base + "/api/ps", 1500); models = (ps.models || []).map(m => m.name).slice(0, 4); } catch (e) {}
    return { up: true, version: v.version || null, models };
  } catch (e) { return { up: false, version: null, models: [] }; }
}

/* ---------------- endpoint ---------------- */
function attach(api, { readToken, bearer, send, online }) {
  api["GET /api/pcstats"] = async (req, res) => {
    const t = readToken(bearer(req));
    if (!t || t.role !== "admin") return send(res, 403, { ok: false, error: "admin clearance required" });
    const firstLook = !cpuTimer;
    wakeCpu();
    if (firstLook) await new Promise(r => setTimeout(r, 400));   // first sample needs a short window
    if (firstLook) cpuTick();
    const [d, g, o] = await Promise.all([cached("disk", 30e3, disk), cached("gpu", 1200, gpu), cached("ollama", 5e3, ollama)]);
    const tot = os.totalmem(), free = os.freemem();
    const cpus = os.cpus();
    send(res, 200, {
      ok: true, t: Date.now(), host: os.hostname(), os: `${os.type()} ${os.release()}`, uptime: Math.round(os.uptime()),
      cpu: { pct: cpuPct, cores: cpus.length, model: (cpus[0] && cpus[0].model || "").replace(/\s+/g, " ").trim() },
      ram: { usedGB: GB(tot - free), totalGB: GB(tot), pct: Math.round((1 - free / tot) * 100) },
      disk: d, gpu: g, ollama: o || { up: false, version: null, models: [] },
      chat: { up: true, online: typeof online === "function" ? online() : null },
    });
  };
}
module.exports = { attach };
