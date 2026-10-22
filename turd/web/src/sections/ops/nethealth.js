// Spy Tools — INTERNET HEALTH. Two parts, both free/keyless:
//   SPEED TEST  client-side down/up/ping/jitter via Cloudflare's public speed endpoints
//               (speed.cloudflare.com/__down and /__up) — no key, CORS-enabled.
//   OUTAGE VIEW reads the PC server's uplink endpoints when present:
//               GET /net/status  → {online, since, lastOutage}
//               GET /net/outages → [{start, end, durationSec}]
//               + an export link to the full log. Degrades to a "waiting for server" note
//               until the Chat/server thread ships those paths.
// Fetches go through ctx.http (= window.TURD_HTTP in the app, CORS-free). Returns a cleanup fn.

const lsGet = (k) => { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
const fmtMbps = v => v >= 100 ? v.toFixed(0) : v.toFixed(1);
const fmtDur = s => { s = Math.round(s); if (s < 60) return s + "s"; const m = Math.floor(s / 60); if (m < 60) return m + "m " + (s % 60) + "s"; const h = Math.floor(m / 60); return h + "h " + (m % 60) + "m"; };
const fmtWhen = t => { try { return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return String(t); } };

async function ping(http, n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try { await http("https://speed.cloudflare.com/__down?bytes=0", { cache: "no-store" }); } catch (e) { continue; }
    arr.push(performance.now() - t0);
  }
  if (!arr.length) return { ping: null, jitter: null };
  arr.sort((a, b) => a - b);
  const med = arr[Math.floor(arr.length / 2)];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const jit = Math.sqrt(arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length);
  return { ping: med, jitter: jit };
}
async function download(http, bytes, onProg) {
  const t0 = performance.now(); let got = 0;
  const r = await http("https://speed.cloudflare.com/__down?bytes=" + bytes, { cache: "no-store" });
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader();
    for (; ;) { const { done, value } = await rd.read(); if (done) break; got += value.length; if (onProg) onProg(got * 8 / ((performance.now() - t0) / 1000) / 1e6); }
  } else { const ab = await r.arrayBuffer(); got = ab.byteLength; }
  const s = (performance.now() - t0) / 1000;
  return s > 0 ? got * 8 / s / 1e6 : 0;
}
async function upload(http, bytes) {
  const body = new Uint8Array(bytes);
  const t0 = performance.now();
  await http("https://speed.cloudflare.com/__up", { method: "POST", body, cache: "no-store" });
  const s = (performance.now() - t0) / 1000;
  return s > 0 ? bytes * 8 / s / 1e6 : 0;
}

export function mountNetHealth(el, ctx) {
  const { esc, head, toast } = ctx;
  const http = ctx.http;
  let dead = false, running = false;

  el.innerHTML = head("Internet Health", "NET", "speed · uptime") + `
    <div class="nh-wrap">
      <div class="t-card nh-speed">
        <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="t-cap">Speed test</div>
          <button class="t-btn" id="nhGo">▸ RUN TEST</button>
        </div>
        <div class="nh-readout">
          ${gauge("down", "DOWN", "Mbps")}
          ${gauge("up", "UP", "Mbps")}
          ${gauge("ping", "PING", "ms")}
          ${gauge("jit", "JITTER", "ms")}
        </div>
        <div id="nhPhase" class="nh-phase mono"></div>
        <p class="muted mono" style="font-size:10px;margin-top:6px">Measured against Cloudflare's public speed service. No account, no key.</p>
      </div>
      <div class="t-card nh-out">
        <div class="t-cap">Connection uptime</div>
        <div id="nhOut"><p class="t-s">Checking the PC server…</p></div>
      </div>
    </div>`;

  function gauge(id, lbl, unit) {
    return `<div class="nh-g"><div class="nh-v"><b id="nh-${id}">—</b><span>${unit}</span></div><div class="nh-l">${lbl}</div></div>`;
  }
  const setV = (id, v) => { const n = el.querySelector("#nh-" + id); if (n) n.textContent = v; };
  const phase = m => { const n = el.querySelector("#nhPhase"); if (n) n.textContent = m; };

  const run = async () => {
    if (running) return; running = true;
    const btn = el.querySelector("#nhGo"); if (btn) btn.disabled = true;
    ["down", "up", "ping", "jit"].forEach(k => setV(k, "—"));
    try {
      phase("measuring latency…");
      const p = await ping(http, 6); if (dead) return;
      setV("ping", p.ping == null ? "✕" : Math.round(p.ping)); setV("jit", p.jitter == null ? "✕" : Math.round(p.jitter));
      phase("measuring download…");
      let best = 0;
      for (const b of [1e6, 1e7, 2.5e7]) { const m = await download(http, b, live => setV("down", fmtMbps(live))); if (dead) return; best = Math.max(best, m); setV("down", fmtMbps(best)); }
      phase("measuring upload…");
      let bu = 0;
      for (const b of [2e6, 8e6]) { const m = await upload(http, b); if (dead) return; bu = Math.max(bu, m); setV("up", fmtMbps(bu)); }
      phase("done · " + new Date().toLocaleTimeString([], { hour12: false }));
    } catch (e) {
      phase("test failed: " + String(e && e.message || e));
      toast("speed test failed — check your connection");
    } finally { running = false; if (btn) btn.disabled = false; }
  };
  el.querySelector("#nhGo").onclick = run;

  /* ---- outage view (server-backed; graceful if the endpoints aren't live yet) ---- */
  const outEl = el.querySelector("#nhOut");
  const openExt = url => { const N = window.TURD_NATIVE; if (N && N.openExternal) N.openExternal(url); else window.open(url, "_blank", "noopener"); };
  (async () => {
    const base = lsGet("turd_uplink"), tok = lsGet("turd_token");
    if (!base) { outEl.innerHTML = `<p class="t-s">Sign in to your PC server (Chat tab) to track internet outages.</p>`; return; }
    const root = String(base).replace(/\/+$/, "");
    const h = tok ? { authorization: "Bearer " + tok } : {};
    let status = null, outages = null;
    try { const r = await http(root + "/api/net/status", { headers: h }); if (r.ok) status = await r.json(); } catch (e) {}
    try { const r = await http(root + "/api/net/outages", { headers: h }); if (r.ok) outages = await r.json(); } catch (e) {}
    if (dead) return;
    if (!status && !outages) {
      outEl.innerHTML = `<p class="t-s">Outage tracking arrives with the next PC-server update — it'll show your connection's uptime and recent drops here.</p>`;
      return;
    }
    const src = status || outages;                     // both carry online/since
    const online = !!(src && src.online);
    const since = src && src.since ? fmtWhen(src.since) : "";
    const up = status && status.uptimeSec ? fmtDur(status.uptimeSec) : "";
    const up24 = status && typeof status.uptime24h === "number" ? ` · 24h ${status.uptime24h.toFixed(1)}%` : "";
    const list = (outages && Array.isArray(outages.outages)) ? outages.outages
      : Array.isArray(outages) ? outages : (outages && outages.items) || [];
    outEl.innerHTML = `
      <div class="nh-status ${online ? "up" : "down"}"><span class="dot"></span>${online ? "Online" : "Offline"}${online && up ? ` · up ${esc(up)}` : since ? ` · since ${esc(since)}` : ""}${esc(up24)}</div>
      ${list.length ? `<div class="nh-olist">` + list.slice(0, 12).map(o =>
      `<div class="nh-o"><span>${esc(fmtWhen(o.start))}${o.end ? " → " + esc(fmtWhen(o.end)) : " → ongoing"}</span><b>${esc(fmtDur(o.durationSec != null ? o.durationSec : ((o.end || Date.now()) - o.start) / 1000))}</b></div>`).join("") + `</div>`
        : `<p class="t-s">No outages logged yet — your connection's been solid.</p>`}
      <button class="t-link" id="nhExport" style="margin-top:8px">⤓ export downtime log</button>`;
    const ex = el.querySelector("#nhExport");
    if (ex) ex.onclick = () => openExt(root + "/api/net/export?fmt=csv" + (tok ? "&token=" + encodeURIComponent(tok) : ""));
  })();

  return () => { dead = true; };
}

/* styles */
(function () {
  if (document.getElementById("nethealth-css")) return;
  const s = document.createElement("style"); s.id = "nethealth-css"; s.textContent = `
  .nh-wrap{display:grid;grid-template-columns:1fr;gap:18px;padding-inline:10px;max-width:920px}
  .nh-readout{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0 6px}
  .nh-g{text-align:center;padding:14px 8px;border-radius:14px;background:rgba(var(--accent-rgb),.06);border:1px solid var(--glass-line)}
  .nh-v{display:flex;align-items:baseline;justify-content:center;gap:4px}
  .nh-v b{font-size:30px;font-weight:600;color:#fff;line-height:1;font-variant-numeric:tabular-nums}
  .nh-v span{font-family:var(--mono);font-size:10px;color:var(--ink-dim)}
  .nh-l{font-family:var(--mono);font-size:10px;letter-spacing:2px;color:var(--accent);margin-top:6px}
  .nh-phase{font-size:11px;color:var(--ink-dim);min-height:15px;margin-top:4px}
  .nh-status{display:flex;align-items:center;gap:9px;font-size:15px;color:var(--ink);font-weight:600;margin:4px 0 12px}
  .nh-status .dot{width:10px;height:10px;border-radius:50%;box-shadow:0 0 10px currentColor}
  .nh-status.up{color:#36e07a}.nh-status.down{color:#ff5c5c}
  .nh-status.up .dot,.nh-status.down .dot{background:currentColor}
  .nh-olist{margin-top:4px}
  .nh-o{display:flex;justify-content:space-between;gap:12px;padding:8px 4px;font-size:13px;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 15%,rgba(255,255,255,.06) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .nh-o:last-child{background-image:none}
  .nh-o span{font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
  .nh-o b{color:#ffb98a;font-family:var(--mono)}
  @media(max-width:620px){.nh-readout{grid-template-columns:repeat(2,1fr)}}`;
  document.head.appendChild(s);
})();
