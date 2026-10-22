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
// Cost: CPU is sampled from os.cpus() deltas only while someone is looking (a
// request in the last 60s); GPU/Ollama/disk results are cached 10-15s; a GPU
// tool that isn't installed is not retried for 10 minutes.
// ===========================================================================
"use strict";
const os = require("os");
const fs = require("fs");
const http = require("http");
const { execFile } = require("child_process");

/* ---------------- CPU: rolling delta of os.cpus() times ---------------- */
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
  if (Date.now() - lastAsk > 60e3) { clearInterval(cpuTimer); cpuTimer = null; cpuPrev = null; }   // nobody watching: stop
}
function wakeCpu() {
  lastAsk = Date.now();
  if (!cpuTimer) { cpuTick(); cpuTimer = setInterval(cpuTick, 2000); cpuTimer.unref && cpuTimer.unref(); }
}

/* ---------------- tiny helpers ---------------- */
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v;
  const v = await fn().catch(() => null);
  cache.set(key, { t: Date.now(), v });
  return v;
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
let smiMissingUntil = 0;
async function gpu() {
  if (Date.now() > smiMissingUntil) {
    try {
      const out = await run("nvidia-smi", ["--query-gpu=temperature.gpu,utilization.gpu,name", "--format=csv,noheader,nounits"]);
      const [t, u, ...name] = out.split("\n")[0].split(",").map(s => s.trim());
      if (t && !isNaN(+t)) return { tempC: +t, pct: isNaN(+u) ? null : +u, name: name.join(",").trim(), src: "nvidia-smi" };
    } catch (e) { smiMissingUntil = Date.now() + 10 * 60e3; }
  }
  // LibreHardwareMonitor → Options → Remote Web Server (port 8085) exposes /data.json
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
    const [d, g, o] = await Promise.all([cached("disk", 15e3, disk), cached("gpu", 10e3, gpu), cached("ollama", 10e3, ollama)]);
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
