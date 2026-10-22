/* ---------------------------------------------------------------------------
   Internet health monitor  (server/netmon.js)
   Owned by the core/chat thread; read by the Spy Tools tab + Home status card.

   A light background reachability check runs on the desktop server itself.
   Every ~45s it probes a few public hosts; if ALL of them fail for N
   consecutive checks the link is marked DOWN, and it comes back UP as soon as
   any probe recovers. Every outage is logged as {start,end,durationSec} and
   persisted, so the owner can prove ISP downtime and export the log.

   No API keys, no third-party account. LAN-only, like the rest of the server:
   every endpoint needs a valid Bearer token.

   attach(api, { readToken, bearer, send, F })
     GET /api/net/status            -> { ok, online, since, uptimeSec, checking, lastOutage? }
     GET /api/net/outages           -> { ok, online, since, outages:[{start,end,durationSec}] }  (newest first, end null while ongoing)
     GET /api/net/export?fmt=csv|json -> downloadable CSV (default) or JSON of the outage log
--------------------------------------------------------------------------- */
const net = require("net");
const https = require("https");
const fs = require("fs");

// Probe targets. IP probes catch a dead link without needing DNS; the HTTPS
// probe by hostname also catches DNS failure. "Online" = ANY of these succeeds.
const TARGETS = [
  { kind: "tcp", host: "1.1.1.1", port: 443 },        // Cloudflare DNS
  { kind: "tcp", host: "8.8.8.8", port: 443 },        // Google DNS
  { kind: "https", url: "https://www.google.com/generate_204" },
];
const INTERVAL_MS = 45000;   // how often to probe
const PROBE_TIMEOUT = 4000;  // per-probe timeout
const DOWN_AFTER = 2;        // consecutive all-fail checks before we call it DOWN
const MAX_OUTAGES = 1000;    // keep the log bounded

function tcpProbe(host, port) {
  return new Promise(resolve => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = ok => { if (done) return; done = true; try { sock.destroy(); } catch (e) {} resolve(ok); };
    sock.setTimeout(PROBE_TIMEOUT);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}
function httpsProbe(url) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; resolve(ok); };
    const req = https.get(url, r => { r.resume(); finish(r.statusCode > 0); });
    req.on("error", () => finish(false));
    req.setTimeout(PROBE_TIMEOUT, () => { req.destroy(); finish(false); });
  });
}
function probeOnce() {
  return Promise.all(TARGETS.map(t => t.kind === "tcp" ? tcpProbe(t.host, t.port) : httpsProbe(t.url)))
    .then(res => res.some(Boolean));
}

/* Pure outage state machine, factored out so it can be unit-tested without the
   network. Mutates `s` ({online,since,fails,firstFailTs,outages}) in place and
   returns true when the online/offline state changed (so the caller can save). */
function applyProbe(s, anyUp, t) {
  if (anyUp) {
    s.fails = 0; s.firstFailTs = 0;
    if (!s.online) {
      const o = s.outages.length && s.outages[s.outages.length - 1].end == null ? s.outages[s.outages.length - 1] : null;
      if (o) { o.end = t; o.durationSec = Math.max(0, Math.round((t - o.start) / 1000)); }
      s.online = true; s.since = t; return true;
    }
    return false;
  }
  if (s.firstFailTs === 0) s.firstFailTs = t;
  s.fails++;
  if (s.online && s.fails >= DOWN_AFTER) {
    s.online = false; s.since = s.firstFailTs;
    s.outages.push({ start: s.firstFailTs, end: null, durationSec: null });
    if (s.outages.length > MAX_OUTAGES) s.outages = s.outages.slice(-MAX_OUTAGES);
    return true;
  }
  return false;
}

/* Pure: total downtime seconds inside [from,to], clipping each outage to the
   window and treating an open outage (end null) as lasting until `to`. */
function downtimeInWindow(outages, from, to) {
  let down = 0;
  for (const o of outages) {
    const start = Math.max(o.start, from);
    const end = Math.min(o.end == null ? to : o.end, to);
    if (end > start) down += (end - start);
  }
  return Math.round(down / 1000); // seconds
}
/* Rolling uptime % over the trailing `windowMs`, to 2 decimals. */
function uptimePct(outages, now, windowMs) {
  const downSec = downtimeInWindow(outages, now - windowMs, now);
  const winSec = windowMs / 1000;
  return Math.round(Math.max(0, Math.min(1, (winSec - downSec) / winSec)) * 10000) / 100;
}

function attach(api, helpers) {
  const { readToken, bearer, send, F } = helpers;
  const STORE = F("netmon.json");

  // state
  const s = { online: true, since: Date.now(), fails: 0, firstFailTs: 0, outages: [] };
  let saveTimer = null;

  try {
    const raw = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (raw && Array.isArray(raw.outages)) s.outages = raw.outages;
    if (raw && typeof raw.online === "boolean") { s.online = raw.online; s.since = raw.since || s.since; }
    // if we were mid-outage when the server last stopped, that outage stays open
  } catch (e) { /* first run */ }

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(STORE, JSON.stringify({ online: s.online, since: s.since, outages: s.outages.slice(-MAX_OUTAGES) })); } catch (e) {}
    }, 800);
  };

  async function tick() {
    let anyUp;
    try { anyUp = await probeOnce(); } catch (e) { anyUp = false; }
    if (applyProbe(s, anyUp, Date.now())) save();
  }

  // kick off the background loop (unref so it never holds the process open)
  const timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
  tick(); // run one immediately so status is live right after boot

  const auth = (req, res) => { const tok = readToken(bearer(req)); if (!tok) { send(res, 401, { ok: false }); return null; } return tok; };

  api["GET /api/net/status"] = (req, res) => {
    if (!auth(req, res)) return;
    const last = s.outages.length ? s.outages[s.outages.length - 1] : null;
    const now = Date.now();
    send(res, 200, {
      ok: true, online: s.online, since: s.since,
      uptimeSec: s.online ? Math.round((now - s.since) / 1000) : 0,
      uptime24h: uptimePct(s.outages, now, 24 * 3600 * 1000),
      uptime7d: uptimePct(s.outages, now, 7 * 24 * 3600 * 1000),
      checking: true,
      lastOutage: last || undefined,
    });
  };

  api["GET /api/net/outages"] = (req, res) => {
    if (!auth(req, res)) return;
    send(res, 200, { ok: true, online: s.online, since: s.since, outages: s.outages.slice().reverse() });
  };

  api["GET /api/net/export"] = (req, res) => {
    if (!auth(req, res)) return;
    const fmt = (new URL(req.url, "http://x").searchParams.get("fmt") || "csv").toLowerCase();
    const rows = s.outages.slice().reverse();
    if (fmt === "json") {
      res.writeHead(200, { "content-type": "application/json", "content-disposition": 'attachment; filename="internet-outages.json"', "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ exported: Date.now(), online: s.online, outages: rows }, null, 2));
      return;
    }
    const iso = ms => ms == null ? "" : new Date(ms).toISOString();
    const hms = s => { if (s == null) return "ongoing"; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}h ${m}m ${x}s`; };
    const lines = ["start,end,duration_seconds,duration_hms"];
    for (const o of rows) lines.push(`${iso(o.start)},${iso(o.end)},${o.durationSec == null ? "" : o.durationSec},${hms(o.durationSec)}`);
    res.writeHead(200, { "content-type": "text/csv", "content-disposition": 'attachment; filename="internet-outages.csv"', "access-control-allow-origin": "*" });
    res.end(lines.join("\r\n"));
  };
}

module.exports = { attach, applyProbe, downtimeInWindow, uptimePct, DOWN_AFTER, _targets: TARGETS };
