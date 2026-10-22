// SPY TOOLS — the rebuilt OPSEC tab. One section, four tools:
//   MAP      live map: public ADS-B aircraft, police (gov/police aircraft + UK incident
//            open data), DeFlock/OSM ALPR + CCTV cameras — one map with layer filters
//   SCANNER  the old BT/Wi-Fi radar + Home Network Watch, merged in here (./radar.js, ./netwatch.js)
//   RECON    "nmap and all" — native TCP-connect port scan of a host on your own network
//   OPSEC    the device-hardening checklist (kept from the original tab)
// Section id stays "opsec" so core's ORDER/registry is untouched. Sub-tool modules live
// in ./ops/. Only the visible sub-tab is mounted; switching unmounts the previous one.
import { edgeFades } from "./util.js";
import { mountMap } from "./ops/map.js";
import { mountRecon } from "./ops/recon.js";
import { mountRadar, unmountRadar } from "./radar.js";
import { mountNetwatch, unmountNetwatch } from "./netwatch.js";

const ITEMS = [
  ["Full-disk encryption on", "BitLocker (Windows) / file-based encryption (Android) so a lost device can't be read."],
  ["Screen lock + biometric", "Short auto-lock timeout with PIN/biometric fallback."],
  ["OS + app updates current", "Patch promptly — most real compromises are known, already-fixed bugs."],
  ["App permission review", "Revoke location/mic/camera from apps that don't need them."],
  ["DNS / tracker filtering", "Encrypted DNS or a filtering resolver to cut tracking and malicious domains."],
  ["VPN on untrusted Wi-Fi", "Tunnel traffic on public networks you don't control."],
  ["Unique passkeys + manager", "No reuse; a password manager + hardware/passkey where possible."],
  ["2FA on key accounts", "App-based or hardware 2FA, not SMS, on email + financial logins."],
  ["Radios off when idle", "Bluetooth/Wi-Fi off when unused = fewer passive-tracking handles on you."],
  ["Encrypted backups", "So recovery never means lowering your security."],
];
const score = LS => Math.round(ITEMS.filter((_, i) => LS.get("turd_opsec", {})[i]).length / ITEMS.length * 100);

const TABS = [
  { id: "map", icon: "🛰", label: "Map" },
  { id: "scan", icon: "◎", label: "Scanner" },
  { id: "recon", icon: "⌁", label: "Recon" },
  { id: "harden", icon: "⛨", label: "OPSEC" },
];

let stopFades = () => {}, cleanup = () => {}, curTab = "map";

export default {
  id: "opsec", icon: "🛰", label: "Spy Tools",
  theme: { accent: "#38e0ff", accent2: "#7a5cff", rgb: "56,224,255" },
  mount(el, ctx) {
    const { esc } = ctx;
    el.classList.add("t-full", "t-sec-spy");
    stopFades(); stopFades = edgeFades(el);
    el.innerHTML = `
      <div class="spy-head">
        <div class="spy-title"><span class="k">OPS</span><h1>Spy Tools</h1></div>
        <div class="spy-tabs" role="tablist">
          ${TABS.map(t => `<button class="spy-tab ${t.id === curTab ? "on" : ""}" data-tab="${t.id}" role="tab" aria-selected="${t.id === curTab}"><span class="i">${t.icon}</span>${esc(t.label)}</button>`).join("")}
        </div>
      </div>
      <div id="spyBody" class="spy-body"></div>`;
    const body = el.querySelector("#spyBody");

    const showTab = id => {
      try { cleanup(); } catch (e) {} cleanup = () => {};
      curTab = id;
      el.querySelectorAll(".spy-tab").forEach(b => { const on = b.dataset.tab === id; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
      body.innerHTML = "";
      if (id === "map") {
        const d = document.createElement("div"); d.className = "spy-pane"; body.appendChild(d);
        cleanup = mountMap(d, ctx) || (() => {});
      } else if (id === "recon") {
        const d = document.createElement("div"); d.className = "spy-pane"; body.appendChild(d);
        cleanup = mountRecon(d, ctx) || (() => {});
      } else if (id === "scan") {
        const r = document.createElement("div"); r.className = "spy-pane"; body.appendChild(r);
        const n = document.createElement("div"); n.className = "spy-pane spy-pane-gap"; body.appendChild(n);
        mountRadar(r, ctx); mountNetwatch(n, ctx);
        cleanup = () => { try { unmountRadar(); } catch (e) {} try { unmountNetwatch(); } catch (e) {} };
      } else {
        renderHarden(body, ctx);
      }
    };
    el.querySelectorAll(".spy-tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
    showTab(TABS.some(t => t.id === curTab) ? curTab : "map");
  },
  unmount() { try { cleanup(); } catch (e) {} cleanup = () => {}; stopFades(); stopFades = () => {}; },
  summary(ctx) { return { title: "Spy Tools", value: score(ctx.LS) + "%", note: "hardening" }; },
};

function renderHarden(body, ctx) {
  const { LS, esc } = ctx;
  const render = () => {
    const done = LS.get("turd_opsec", {}), pct = score(LS), n = ITEMS.filter((_, i) => done[i]).length;
    body.innerHTML = `
      <div class="ops-wrap">
        <div class="t-card ops-score"><div class="t-cap">Hardening score</div>
          <div class="ops-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" class="bg"/><circle cx="60" cy="60" r="50" class="fg" style="stroke-dasharray:${3.14 * pct} 314;${pct ? "" : "opacity:0"}"/></svg>
            <div><b>${pct}%</b><span>${n} / ${ITEMS.length} done</span></div></div>
          <p class="t-s">Defensive privacy checklist for devices you own. Nothing here scans or touches anyone else.</p></div>
        <div class="t-card ops-list"><div class="t-cap">Checklist</div>` + ITEMS.map((o, i) => `<button class="check ${done[i] ? "on" : ""}" data-i="${i}" aria-pressed="${!!done[i]}"><span class="box">${done[i] ? "✓" : ""}</span>
          <span class="txt"><b>${esc(o[0])}</b><span>${esc(o[1])}</span></span></button>`).join("") + `</div>
      </div>`;
    body.querySelectorAll(".check").forEach(b => b.onclick = () => { const d = LS.get("turd_opsec", {}); d[b.dataset.i] = !d[b.dataset.i]; LS.set("turd_opsec", d); render(); });
  };
  render();
}

/* inline styles: tab shell + hardening checklist + map/recon chrome */
(function () {
  if (document.getElementById("spy-css")) return;
  const s = document.createElement("style"); s.id = "spy-css"; s.textContent = `
  .t-sec-spy .spy-head{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:flex-end;justify-content:space-between;padding:0 10px 4px}
  .spy-title{display:flex;align-items:baseline;gap:12px}
  .spy-title .k{font-family:var(--mono);font-size:11px;letter-spacing:3px;color:var(--accent);opacity:.8}
  .spy-title h1{margin:0;font-size:clamp(22px,3.4vw,32px);font-weight:600;letter-spacing:.5px}
  .spy-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .spy-tab{display:inline-flex;align-items:center;gap:7px;font-family:var(--font);font-size:13px;color:var(--ink-dim);cursor:pointer;
    background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:11px;padding:8px 14px;transition:.18s}
  .spy-tab .i{font-size:15px;line-height:1;filter:grayscale(.3)}
  .spy-tab:hover{color:var(--ink);background:rgba(var(--accent-rgb),.08)}
  .spy-tab.on{color:#04121a;background:var(--accent);border-color:var(--accent);box-shadow:0 0 16px rgba(var(--accent-rgb),.5)}
  .spy-tab.on .i{filter:none}
  .spy-body{padding-top:14px}
  .spy-pane-gap{margin-top:22px}

  /* live map */
  .ops-map-wrap{padding-inline:10px}
  .ops-map-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .ops-map-sp{flex:1 1 10px}
  .ops-tg{display:inline-flex;align-items:center;gap:6px;font-family:var(--font);font-size:12px;color:var(--ink-dim);cursor:pointer;
    background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:9px;padding:6px 11px;transition:.16s}
  .ops-tg .i{font-size:13px}
  .ops-tg:hover{color:var(--ink)}
  .ops-tg.on{color:var(--ink);background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.6);box-shadow:inset 0 0 10px rgba(var(--accent-rgb),.12)}
  .ops-tg.alt.on{background:rgba(255,210,63,.16);border-color:rgba(255,210,63,.6);color:#ffe08a}
  .ops-src{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-dim)}
  .ops-src select{font-family:var(--font);font-size:12px;color:var(--ink);background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:9px;padding:6px 8px}
  .ops-map{position:relative;height:min(66vh,620px);border-radius:16px;overflow:hidden;border:1px solid var(--glass-line);background:#05080f;box-shadow:inset 0 0 50px rgba(0,0,0,.6)}
  .ops-scan-panel{margin:0 0 10px;padding:14px 16px;border:1px solid rgba(255,122,63,.4);border-radius:14px;background:rgba(255,122,63,.06)}
  .ops-scan-panel[hidden]{display:none}
  .ops-scan-head{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:#ffb98a;font-weight:600;margin-bottom:10px}
  .ops-scan-x{background:none;border:0;color:var(--ink-dim);cursor:pointer;font-size:16px}
  .ops-scan-grp{margin-bottom:10px}
  .ops-scan-reg{font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim);margin-bottom:5px}
  .ops-scan-feed{display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid var(--glass-line);border-radius:9px;padding:8px 12px;margin:4px 0;color:var(--ink);cursor:pointer;font-family:var(--font);font-size:13px;transition:.15s}
  .ops-scan-feed:hover{background:rgba(255,122,63,.14);border-color:rgba(255,122,63,.5)}
  .ops-scan-note{font-size:10px;color:var(--ink-dim);margin:6px 0 0;line-height:1.5}
  .ops-map-foot{display:flex;flex-wrap:wrap;gap:10px 18px;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:var(--ink-dim)}
  #opsMapStat{color:var(--accent)}
  .ops-map-legend{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font-family:var(--mono);font-size:10px;letter-spacing:.5px}
  .ops-map-legend .lg{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
  .lg.air{background:#39d0ff}.lg.gov{background:#ffd23f}.lg.alpr{background:#ff3fb0}.lg.cam{background:#9a6bff}.lg.inc{background:#ff7a3f}
  .ops-plane,.ops-govair{background:none;border:0}
  .ops-govair{font-size:15px;line-height:16px;color:#ffd23f;text-shadow:0 0 4px #000;text-align:center}
  .leaflet-popup-content{font-family:var(--font);font-size:13px;line-height:1.5}
  .leaflet-popup-content b{color:#0b1b2a}
  .pp-gov{background:#ffd23f;color:#3a2a00;font-size:9px;padding:1px 5px;border-radius:4px;font-family:var(--mono)}
  .pp-emg{background:#ff4d4d;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;font-family:var(--mono)}
  .pp-dim{color:#7488;font-size:11px}

  /* recon */
  .ops-recon{display:grid;grid-template-columns:1fr;gap:18px;padding-inline:10px;max-width:900px}
  .rc-form{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
  .rc-form label{display:flex;flex-direction:column;gap:5px;font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim);flex:1 1 160px}
  .rc-form input{font-family:var(--mono);font-size:14px;background:rgba(0,0,0,.35);border:1px solid var(--glass-line);border-radius:9px;padding:9px 12px;color:var(--ink)}
  .rc-form input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 10px rgba(var(--accent-rgb),.3)}
  .rc-form .t-btn{flex:0 0 auto}
  .rc-note{font-size:10px;margin-top:10px;line-height:1.5}
  .rc-state{font-family:var(--mono);font-size:12px;color:var(--accent);margin-top:10px;min-height:16px}
  .rc-bar{height:4px;border-radius:4px;background:rgba(var(--accent-rgb),.15);overflow:hidden}
  .rc-bar i{display:block;height:100%;width:40%;background:var(--accent);animation:rcslide 1s linear infinite}
  @keyframes rcslide{0%{margin-left:-40%}100%{margin-left:100%}}
  .rc-table{width:100%;border-collapse:collapse;font-size:13px}
  .rc-table th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim);padding:6px 8px;border-bottom:1px solid var(--glass-line)}
  .rc-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,.05)}
  .rc-table .rc-p{font-family:var(--mono);color:var(--accent);font-weight:600}
  .rc-table .rc-d{color:var(--ink-dim);font-family:var(--mono);font-size:12px}

  /* hardening checklist (kept) */
  .ops-wrap{display:grid;grid-template-columns:320px 1fr;gap:22px;align-items:start;padding-inline:10px}
  .ops-score{position:sticky;top:0}
  .ops-ring{position:relative;width:170px;height:170px;margin:10px auto 16px}
  .ops-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
  .ops-ring circle{fill:none;stroke-width:9}.ops-ring .bg{stroke:rgba(255,255,255,.08)}
  .ops-ring .fg{stroke:var(--accent);stroke-linecap:round;filter:drop-shadow(0 0 8px var(--accent));transition:stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)}
  .ops-ring>div{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
  .ops-ring b{font-size:40px;color:#fff;font-weight:600;line-height:1}
  .ops-ring span{font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-dim);margin-top:4px}
  .check{display:flex;align-items:flex-start;gap:14px;width:100%;text-align:left;background:none;border:0;cursor:pointer;color:inherit;font-family:var(--font);
    padding:12px 8px;border-radius:12px;transition:background .2s;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.07) 15%,rgba(255,255,255,.07) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .check:last-child{background-image:none}
  .check:hover{background-color:rgba(var(--accent-rgb),.06)}
  .check .box{flex:0 0 22px;height:22px;border:2px solid rgba(var(--accent-rgb),.55);border-radius:7px;display:grid;place-items:center;transition:.2s;margin-top:1px;color:#04121a;font-size:13px;font-weight:700}
  .check.on .box{background:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent)}
  .check .txt b{display:block;font-size:15px;color:var(--ink);font-weight:600}
  .check .txt>span{font-size:13px;color:var(--ink-dim);line-height:1.45}
  .check.on .txt b{color:#fff}
  @media(max-width:1100px){.ops-wrap{grid-template-columns:1fr}.ops-score{position:static}}
  @media(max-width:700px){.ops-map{height:62vh}.spy-head{align-items:flex-start}}`;
  document.head.appendChild(s);
})();
