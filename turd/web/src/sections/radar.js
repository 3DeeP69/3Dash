// WiFi & RF TOOLS — cross-platform wireless recon for the operator's OWN surroundings.
// Shows the radios/adapters this device exposes and what each can do (monitor mode,
// packet injection, bands), then scans WiFi + Bluetooth LE with graceful degradation:
//   best:   native per-adapter scan (Windows / Linux / Android) via window.TURD_NATIVE.radar
//   less:   Web Bluetooth (browser) for BLE only
//   always: a demo sweep so the panel is never empty
// Capability detection is best-effort and driver/OS-agnostic: anything it can't determine
// is shown as "unknown" rather than failing, so obscure adapters still work for what they can.
// Native API (web/src/native.js, filled by the installers thread):
//   N.radar.adapters()      → [{id,name,driver,chipset,bands,monitor,injection,up,mac}]  (null fields = unknown)
//   N.radar.capabilities()  → {platform, wifiScan, monitor, injection, ble, adapters, note}
//   N.radar.wifi()/ble()    → existing scans
import { edgeFades } from "./util.js";

let DEVICES = [];     // BLE/contacts from the last scan
let WIFI = [];        // WiFi networks from the last scan (for the INSEC audit)
let CAPS = null;      // last capabilities()
let stopFades = () => {};

export function getLastWifi() { return WIFI.slice(); }
export function getCaps() { return CAPS; }

const band = f => f >= 5900 ? "6" : f >= 4900 ? "5" : f ? "2.4" : "";
// classify WiFi security from whatever the native layer gives us (security string or secure bool)
export function secOf(x) {
  const s = String(x.security || x.capabilities || x.enc || "").toUpperCase();
  if (/WPA3|SAE/.test(s)) return { k: "wpa3", risk: 0, lbl: "WPA3" };
  if (/EAP|ENTERPRISE|802\.1X/.test(s)) return { k: "ent", risk: 0, lbl: "Enterprise" };
  if (/WPA2|RSN/.test(s)) return { k: "wpa2", risk: 0, lbl: "WPA2" };
  if (/WPA/.test(s)) return { k: "wpa", risk: 2, lbl: "WPA1" };
  if (/WEP/.test(s)) return { k: "wep", risk: 3, lbl: "WEP" };
  if (s === "OPEN" || s === "NONE" || x.secure === false) return { k: "open", risk: 3, lbl: "OPEN" };
  if (x.secure === true) return { k: "wpa2", risk: 0, lbl: "secured" };
  return { k: "unknown", risk: 1, lbl: "?" };
}
const platformName = () => {
  if (CAPS && CAPS.platform) return CAPS.platform;   // authoritative value from native code
  const N = window.TURD_NATIVE;
  if (N && N.os) { const o = typeof N.os === "function" ? N.os() : N.os; if (o) return String(o).toLowerCase(); } // real OS (UA-sniffed, sync)
  const d = (document.documentElement.dataset.native || "").toLowerCase();
  if (d === "android") return "android";
  if (d === "windows") return "windows/linux";       // last-resort fallback for an older build
  return "browser";
};

function paint(scope) {
  scope.querySelectorAll(".blip").forEach(b => b.remove());
  const all = DEVICES.concat(WIFI.map(w => ({ name: w.ssid, wifi: true, rssi: w.rssi })));
  all.forEach((d, i) => {
    const b = document.createElement("div"); b.className = "blip" + (d.ble ? " ble" : d.wifi ? " wifi" : "");
    const ang = ((i * 47) % 360) * Math.PI / 180, dist = 10 + (100 - Math.min(100, (d.rssi ? d.rssi + 100 : 60))) * 1.25;
    b.style.left = (50 + Math.cos(ang) * dist / 3) + "%"; b.style.top = (50 + Math.sin(ang) * dist / 3) + "%"; b.title = d.name || "";
    scope.appendChild(b);
  });
}
const cap = v => v === true ? '<span class="cap yes">yes</span>' : v === false ? '<span class="cap no">no</span>' : '<span class="cap unk">unknown</span>';

function renderAdapters(box, ctx) {
  const { esc } = ctx;
  const plat = platformName();
  const list = (CAPS && CAPS._adapters) || [];
  if (!list.length) {
    const c = CAPS || {};
    box.innerHTML = `<div class="adp-sum">
        <span class="adp-plat">${esc(plat)}</span>
        <span class="adp-cap">WiFi scan ${cap(c.wifiScan)}</span>
        <span class="adp-cap">monitor ${cap(c.monitor)}</span>
        <span class="adp-cap">injection ${cap(c.injection)}</span>
        <span class="adp-cap">Bluetooth ${cap(c.ble)}</span>
      </div>
      <p class="muted mono adp-note">${esc(c.note || (plat === "browser"
      ? "Browser preview — adapter capabilities aren't exposed here. The Windows/Linux/Android app reports your real radios and what each can do."
      : "Adapter details weren't reported by this build; scanning uses whatever the OS allows (passive scan)."))}</p>`;
    return;
  }
  box.innerHTML = `<div class="adp-grid">` + list.map(a => `
    <div class="adp ${a.up ? "up" : ""}">
      <div class="adp-h"><b>${esc(a.name || a.id || "radio")}</b>${a.up ? '<span class="adp-dot"></span>' : ""}</div>
      <div class="adp-meta">${esc([a.driver, a.chipset].filter(Boolean).join(" · ") || "driver unknown")}${a.bands && a.bands.length ? " · " + esc(a.bands.join("/")) + " GHz" : ""}</div>
      <div class="adp-caps"><span>monitor ${cap(a.monitor)}</span><span>injection ${cap(a.injection)}</span></div>
    </div>`).join("") + `</div>
    <p class="muted mono adp-note">${esc(plat)} · ${list.length} radio${list.length > 1 ? "s" : ""}. "unknown" = the driver didn't report it; the radio still works for everything it supports.</p>`;
}

async function loadCaps() {
  const N = window.TURD_NATIVE;
  if (!N || !N.radar) { CAPS = null; return; }
  try {
    const c = (N.radar.capabilities ? await N.radar.capabilities() : {}) || {};
    if (N.radar.adapters) { try { c._adapters = await N.radar.adapters() || []; } catch (e) { c._adapters = []; } }
    CAPS = c;
  } catch (e) { CAPS = null; }
}

const RADAR = {
  id: "radar", icon: "◎", label: "WiFi/RF",
  theme: { accent: "#ff5ca8", accent2: "#b04cff", rgb: "255,92,168" },
  mount(el, ctx) {
    const { head, toast, esc } = ctx;
    el.classList.add("t-full", "t-sec-rdr");
    stopFades(); stopFades = edgeFades(el);
    const N = window.TURD_NATIVE;
    el.innerHTML = head("WiFi / RF Tools", "RDR", "wireless recon · your surroundings") + `
      <div class="t-card adp-card"><div class="t-cap">Radios &amp; capabilities</div><div id="adpBox"><p class="t-s">detecting…</p></div></div>
      <div class="radar-wrap">
        <div class="t-card"><div class="t-cap">Scope</div><div class="scope" id="scope"><div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div class="ring r4"></div>
          <div class="cross"></div><div class="cross2"></div><div class="sweep"></div></div>
          <div class="row" style="justify-content:center;margin-top:16px;gap:10px;flex-wrap:wrap">
            ${N && N.radar ? '<button class="t-btn sm" id="natScan">◉ FULL SCAN</button>' : ''}
            <button class="t-btn sm" id="btScan">⌁ BLUETOOTH</button>
            <button class="t-link" id="simScan">◎ DEMO</button></div>
          <p class="muted mono" style="font-size:10px;text-align:center;margin-top:10px">Discovers signals near <b>you</b>. Passive — nothing connects or transmits without your tap.</p>
        </div>
        <div class="t-card"><div class="t-cap">WiFi networks</div><div id="wifiList"><p class="t-s rdr-empty">No scan yet.</p></div>
          <div class="t-cap" style="margin-top:16px">Bluetooth &amp; other</div><div id="devList"><p class="t-s rdr-empty">No scan yet.</p></div></div>
      </div>`;
    const scope = el.querySelector("#scope"), devList = el.querySelector("#devList"), wifiList = el.querySelector("#wifiList"), adpBox = el.querySelector("#adpBox");

    const renderLists = () => {
      wifiList.innerHTML = WIFI.length ? WIFI.slice().sort((a, b) => (b.rssi || -100) - (a.rssi || -100)).map(w => {
        const s = secOf(w), bd = band(w.freq);
        return `<div class="dev wifi-row r${s.risk}"><div><div class="n">${esc(w.ssid || "(hidden)")} <span class="sec ${s.k}">${s.lbl}</span></div>
          <div class="s">${esc(`ch ${w.channel || "?"}${bd ? " · " + bd + " GHz" : ""} · ${w.rssi != null ? w.rssi + " dBm" : "~"}${w.bssid ? " · " + w.bssid : ""}`)}</div></div>
          <div class="bar"><i style="width:${Math.min(100, Math.max(10, (w.rssi ? w.rssi + 100 : 50)))}%"></i></div></div>`;
      }).join("") : `<p class="t-s rdr-empty">No WiFi networks yet. Run a scan.</p>`;
      devList.innerHTML = DEVICES.length ? DEVICES.map(d => `
        <div class="dev"><div><div class="n">${esc(d.name || "unnamed")} ${d.ble ? '<span class="tag">BLE</span>' : ''}</div>
          <div class="s">${d.id ? esc(d.id + (d.vendor ? " · " + d.vendor : "") + (d.rssi ? " · " + d.rssi + " dBm" : "")) : "signal " + (d.rssi || "~") + " dBm"}</div></div>
          <div class="bar"><i style="width:${Math.min(100, Math.max(10, (d.rssi ? d.rssi + 100 : 50)))}%"></i></div></div>`).join("") : `<p class="t-s rdr-empty">No Bluetooth contacts yet.</p>`;
      paint(scope);
    };

    loadCaps().then(() => renderAdapters(adpBox, ctx));

    const nativeScan = async (which) => {
      const btn = which === "ble" ? el.querySelector("#btScan") : el.querySelector("#natScan"); if (btn) btn.disabled = true;
      scope.classList.add("scanning"); toast(which === "ble" ? "sweeping Bluetooth…" : "sweeping WiFi + Bluetooth…");
      let permErr = ""; try { await N.radar.request(); } catch (e) { permErr = String(e && e.message || e); }
      const [w, b] = await Promise.allSettled([which === "ble" ? Promise.resolve([]) : N.radar.wifi(), N.radar.ble({ ms: 6000 })]);
      if (w.status === "fulfilled") WIFI = (w.value || []).map(x => ({ ssid: x.ssid, bssid: x.bssid, rssi: x.rssi, channel: x.channel, freq: x.freq, secure: x.secure, security: x.security || x.capabilities }));
      DEVICES = [];
      if (b.status === "fulfilled") (b.value || []).forEach(x => DEVICES.push({ name: x.name, id: x.id, ble: true, rssi: x.rssi, vendor: x.vendor }));
      DEVICES.sort((a, c) => (c.rssi || -100) - (a.rssi || -100));
      scope.classList.remove("scanning"); if (btn) btn.disabled = false;
      const errW = w.status === "rejected" ? String(w.reason && w.reason.message || w.reason) : "";
      const errB = b.status === "rejected" ? String(b.reason && b.reason.message || b.reason) : "";
      const errs = [errW, errB, permErr].filter(Boolean);
      const n = WIFI.length + DEVICES.length;
      if (n) toast(`${WIFI.length} networks · ${DEVICES.length} BT${errs.length ? " · " + errs[0] : ""}`);
      else if (errs.length) toast("scan failed: " + errs.join(" / "));
      else toast("nothing in range");
      renderLists();
    };
    const natBtn = el.querySelector("#natScan");
    if (natBtn) natBtn.onclick = () => nativeScan("all");
    el.querySelector("#btScan").onclick = async () => {
      if (N && N.radar) { nativeScan("ble"); return; }
      if (!navigator.bluetooth) { toast("Web Bluetooth not available here — use the app build"); return; }
      try {
        const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [] });
        DEVICES.unshift({ name: dev.name || "unnamed", id: dev.id, ble: true, rssi: -55 }); renderLists(); toast("contact: " + (dev.name || "unnamed"));
      } catch (e) { toast("scan cancelled"); }
    };
    el.querySelector("#simScan").onclick = () => {
      const ssids = [["HOME-5G", "WPA2", 5180], ["NETGEAR24", "WPA2", 2412], ["xfinitywifi", "OPEN", 2437], ["Linksys", "WEP", 2462], ["ATT-Fiber", "WPA3", 5745], ["", "WPA2", 2412]];
      WIFI = ssids.map(([ssid, security, freq]) => ({ ssid, security, freq, channel: freq > 5000 ? 36 : 6, rssi: -40 - Math.floor(Math.random() * 55), bssid: Array.from({ length: 6 }, () => ("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2)).join(":").toUpperCase() }));
      const bt = ["AirPods", "Galaxy Buds", "Tile", "Fitbit", "ESP32"];
      DEVICES = bt.slice(0, 3 + Math.floor(Math.random() * 3)).map(n => ({ name: n, ble: true, rssi: -45 - Math.floor(Math.random() * 45) }));
      renderLists(); toast(`${WIFI.length} networks · ${DEVICES.length} BT (demo)`);
    };
    renderLists();
  },
  unmount() { stopFades(); stopFades = () => {}; },
  summary() { return { title: "WiFi/RF", value: WIFI.length + DEVICES.length, note: "signals" }; },
};
export default RADAR;
export function mountRadar(el, ctx) { return RADAR.mount(el, ctx); }
export function unmountRadar() { return RADAR.unmount && RADAR.unmount(); }

/* scope + adapter styles */
(function () {
  if (document.getElementById("radar-css")) return;
  const s = document.createElement("style"); s.id = "radar-css"; s.textContent = `
  .adp-card{margin:0 10px 18px}
  .adp-sum{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:4px 0}
  .adp-plat{font-family:var(--mono);font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);background:rgba(var(--accent-rgb),.12);border:1px solid rgba(var(--accent-rgb),.4);padding:3px 9px;border-radius:7px}
  .adp-cap{font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
  .cap{font-family:var(--mono);font-size:11px;padding:1px 6px;border-radius:5px;margin-left:2px}
  .cap.yes{background:rgba(54,224,122,.18);color:#5ef0a0}.cap.no{background:rgba(255,92,92,.16);color:#ff9a9a}.cap.unk{background:rgba(255,255,255,.08);color:var(--ink-dim)}
  .adp-note{font-size:10px;line-height:1.5;margin-top:8px}
  .adp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:6px 0}
  .adp{padding:11px 13px;border-radius:12px;border:1px solid var(--glass-line);background:rgba(255,255,255,.03)}
  .adp.up{border-color:rgba(var(--accent-rgb),.5);background:rgba(var(--accent-rgb),.06)}
  .adp-h{display:flex;align-items:center;gap:7px}.adp-h b{font-size:14px;color:var(--ink)}
  .adp-dot{width:7px;height:7px;border-radius:50%;background:#36e07a;box-shadow:0 0 8px #36e07a}
  .adp-meta{font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin:4px 0 7px;word-break:break-word}
  .adp-caps{display:flex;gap:10px;font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
  .radar-wrap{display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:22px;align-items:start;padding-inline:10px}
  @media(max-width:1100px){.radar-wrap{grid-template-columns:1fr}}
  .scope{position:relative;width:min(100%,380px);aspect-ratio:1;margin:6px auto 0;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.08),transparent 70%);border:1px solid var(--glass-line);box-shadow:inset 0 0 40px rgba(var(--accent-rgb),.12)}
  .scope .ring{position:absolute;border:1px solid rgba(var(--accent-rgb),.18);border-radius:50%;inset:0}
  .scope .ring.r2{inset:16.7%}.scope .ring.r3{inset:33.3%}.scope .ring.r4{inset:45%}
  .scope .cross,.scope .cross2{position:absolute;background:rgba(var(--accent-rgb),.18)}
  .scope .cross{left:50%;top:0;bottom:0;width:1px}.scope .cross2{top:50%;left:0;right:0;height:1px}
  .scope .sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(var(--accent-rgb),.5),transparent 32%);animation:spin 3.2s linear infinite;mask:radial-gradient(circle,transparent 0,#000 1px)}
  .blip{position:absolute;width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);transform:translate(-50%,-50%);transition:.4s;cursor:pointer}
  .blip.ble{background:var(--accent2);box-shadow:0 0 12px var(--accent2)}
  .blip.wifi{background:#ffd23f;box-shadow:0 0 12px #ffd23f}
  .blip::after{content:"";position:absolute;inset:-6px;border:1px solid currentColor;border-radius:50%;opacity:.5;animation:ping 1.8s infinite}
  @keyframes ping{to{transform:scale(2.2);opacity:0}}
  .dev{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 6px;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.07) 15%,rgba(255,255,255,.07) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .dev:last-child{background-image:none}
  .dev .n{font-size:15px;color:var(--ink)}.dev .tag{border:0;padding:0 0 0 6px;color:var(--accent2)}
  .dev .s{font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
  .sec{font-family:var(--mono);font-size:9px;letter-spacing:1px;padding:1px 6px;border-radius:5px;margin-left:6px;vertical-align:middle}
  .sec.open,.sec.wep{background:rgba(255,92,92,.18);color:#ff9a9a}.sec.wpa{background:rgba(255,210,63,.18);color:#ffe08a}
  .sec.wpa2,.sec.wpa3,.sec.ent{background:rgba(54,224,122,.16);color:#5ef0a0}.sec.unknown{background:rgba(255,255,255,.08);color:var(--ink-dim)}
  .wifi-row.r3 .bar i{background:#ff5c5c}.wifi-row.r2 .bar i{background:#ffd23f}
  .scope.scanning .sweep{animation-duration:1.1s}
  .rdr-empty{padding:16px 6px}
  .bar{width:60px;height:6px;border-radius:6px;background:rgba(0,0,0,.4);overflow:hidden;flex:0 0 auto}.bar i{display:block;height:100%;background:var(--accent)}
  /* potato / reduced-motion: drop the GPU-costly sweep + ping, keep everything readable */
  body.q-low .scope .sweep,body.q-low .scope.scanning .sweep{animation:none;background:conic-gradient(from 0deg,rgba(var(--accent-rgb),.3),transparent 32%)}
  body.q-low .blip::after{display:none}
  body.q-low .blip{transition:none}
  @media (prefers-reduced-motion:reduce){.scope .sweep{animation:none}.blip::after{display:none}}`;
  document.head.appendChild(s);
})();
