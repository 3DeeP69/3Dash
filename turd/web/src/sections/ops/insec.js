// INSEC — own-network & device security audit ("opsec and insec").
// DEFENSIVE ONLY. It reads what the other Spy Tools already found about the
// operator's OWN surroundings and turns it into a ranked list of things to fix:
//   • WiFi (from WiFi/RF): open / WEP / WPA1 networks, possible evil-twins
//     (same SSID on two BSSIDs or two security levels), hidden SSIDs
//   • LAN (from Network Watch): new / unknown / untrusted devices on your own network
//   • Exposed ports (from Network Recon): risky services reachable on a host you scanned
//   • This device: adapter capability summary, secure-context / app posture
// Nothing here scans or touches anything new — it only grades data you already gathered,
// so it is safe to open any time and is strictly about the owner's own gear.
import { getLastWifi, getCaps } from "../radar.js";
import { getNetDevices } from "../netwatch.js";
import { getLastRecon } from "./recon.js";

// ports that shouldn't usually be exposed on a home LAN device (plaintext / admin / db / remote)
const RISKY_PORTS = {
  23: ["Telnet", "unencrypted remote login — disable it, use SSH"],
  21: ["FTP", "plaintext file transfer — prefer SFTP/HTTPS"],
  2323: ["Telnet-alt", "unencrypted remote login"],
  445: ["SMB", "file sharing exposed — keep it off the open internet, patch it"],
  139: ["NetBIOS", "legacy file sharing — disable if unused"],
  3389: ["RDP", "remote desktop exposed — lock behind VPN, enable NLA"],
  5900: ["VNC", "remote desktop — often unauthenticated, tunnel it"],
  5555: ["ADB", "Android debug bridge open — disable wireless ADB"],
  3306: ["MySQL", "database reachable — bind to localhost"],
  5432: ["Postgres", "database reachable — bind to localhost"],
  6379: ["Redis", "often no auth — bind to localhost / set a password"],
  1433: ["MSSQL", "database reachable — restrict to LAN"],
  27017: ["MongoDB", "database reachable — enable auth, bind local"],
  9100: ["Printer (raw)", "raw print port — fine on LAN, never expose it"],
  161: ["SNMP", "device mgmt — change the default community string"],
};

// returns { score, grade, findings:[{sev,area,title,detail,fix}] }  sev 3=high 2=med 1=low 0=good
export function audit(ctx) {
  const LS = ctx && ctx.LS;
  const findings = [];
  const add = (sev, area, title, detail, fix) => findings.push({ sev, area, title, detail, fix });

  // ---- WiFi ----
  const wifi = getLastWifi();
  if (wifi.length) {
    const bySsid = {};
    wifi.forEach(w => {
      const s = secLevel(w);
      const name = w.ssid || "";
      if (name) (bySsid[name] = bySsid[name] || []).push({ bssid: (w.bssid || "").toUpperCase(), sec: s.k });
      if (s.risk >= 3) add(3, "WiFi", `Insecure network in range: “${name || "(hidden)"}” (${s.lbl})`,
        s.k === "open" ? "An open network near you has no encryption — anything on it can be read." : "WEP is trivially cracked and counts as no protection.",
        "Don't join it. If it's yours, switch the router to WPA2/WPA3.");
      else if (s.risk === 2) add(2, "WiFi", `Weak encryption: “${name}” (WPA1)`,
        "WPA1/TKIP is deprecated and crackable.", "If it's yours, move it to WPA2 or WPA3 in the router settings.");
      if (!name) add(1, "WiFi", "Hidden network nearby", "A hidden SSID isn't more secure — it just doesn't broadcast its name.", "No action needed; noted for awareness.");
    });
    // evil-twin heuristic: same SSID on 2+ BSSIDs, or the same name offered at two security levels
    Object.entries(bySsid).forEach(([name, aps]) => {
      const bssids = new Set(aps.map(a => a.bssid).filter(Boolean));
      const secs = new Set(aps.map(a => a.sec));
      if (bssids.size > 1 && secs.size > 1) add(3, "WiFi", `Possible evil-twin: “${name}”`,
        `Seen on ${bssids.size} access points with different security — a classic rogue-AP pattern.`,
        "Verify your real AP's BSSID; avoid auto-joining this SSID until you're sure.");
      else if (bssids.size > 1) add(1, "WiFi", `“${name}” on ${bssids.size} access points`,
        "Could just be mesh/extenders, but worth knowing.", "Fine if you run a mesh; otherwise check what the extra radio is.");
    });
  }

  // ---- LAN ----
  const devs = getNetDevices(LS);
  if (devs.length) {
    const unknown = devs.filter(d => !d.known && !d.self && !d.gateway);
    if (unknown.length) add(unknown.length > 1 ? 2 : 1, "Network", `${unknown.length} unknown device${unknown.length > 1 ? "s" : ""} on your network`,
      unknown.slice(0, 4).map(d => (d.name || d.ip) + (d.vendor ? ` (${d.vendor})` : "")).join(", ") + (unknown.length > 4 ? "…" : ""),
      "Open Network Watch, identify each one, and trust the ones you recognise. Investigate anything you can't place.");
    else if (devs.length) add(0, "Network", "Every device on your network is recognised", `${devs.length} device${devs.length > 1 ? "s" : ""}, all known or trusted.`, "Keep naming new devices as they appear.");
  }

  // ---- Exposed ports ----
  const recon = getLastRecon();
  if (recon.host && recon.open.length) {
    recon.open.forEach(p => {
      const r = RISKY_PORTS[p.port];
      if (r) add(2, "Ports", `${r[0]} open on ${recon.host} (:${p.port})`, r[1], `If you don't use it, close it on ${recon.host}. If you do, restrict it to the LAN / behind a VPN.`);
    });
    if (!recon.open.some(p => RISKY_PORTS[p.port])) add(0, "Ports", `No high-risk ports open on ${recon.host}`, `${recon.open.length} open port${recon.open.length > 1 ? "s" : ""}, none on the risky list.`, "Re-scan after any change to that host.");
  }

  // ---- This device ----
  const caps = getCaps();
  const plat = (caps && caps.platform) || ((document.documentElement.dataset.native) ? "app" : "browser");
  if (plat === "browser") add(0, "Device", "Running in the browser preview", "Monitor mode, injection and native scans only exist in the Windows / Linux / Android app build.", "Install the app for full WiFi/RF + recon capability.");
  if (typeof window !== "undefined" && window.isSecureContext === false)
    add(2, "Device", "Page not served over a secure context", "WiFi, Bluetooth and location features need HTTPS or localhost.", "Use the packaged app or an https/localhost URL.");

  // ---- Score ----
  const real = findings.filter(f => f.sev > 0);
  const penalty = real.reduce((a, f) => a + (f.sev === 3 ? 28 : f.sev === 2 ? 12 : 4), 0);
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  findings.sort((a, b) => b.sev - a.sev);
  return { score, grade, findings, ran: wifi.length || devs.length || (recon.host ? 1 : 0) };
}

function secLevel(w) {
  const s = String(w.security || w.capabilities || "").toUpperCase();
  if (/WPA3|SAE/.test(s)) return { k: "wpa3", risk: 0, lbl: "WPA3" };
  if (/EAP|ENTERPRISE|802\.1X/.test(s)) return { k: "ent", risk: 0, lbl: "Enterprise" };
  if (/WPA2|RSN/.test(s)) return { k: "wpa2", risk: 0, lbl: "WPA2" };
  if (/WPA/.test(s)) return { k: "wpa", risk: 2, lbl: "WPA1" };
  if (/WEP/.test(s)) return { k: "wep", risk: 3, lbl: "WEP" };
  if (s === "OPEN" || s === "NONE" || w.secure === false) return { k: "open", risk: 3, lbl: "OPEN" };
  return { k: "wpa2", risk: 0, lbl: "secured" };
}

const SEVLBL = ["good", "low", "medium", "high"];
export function insecSummary(ctx) { const a = audit(ctx); return { title: "Posture", value: a.ran ? a.grade : "—", note: a.ran ? a.score + "/100" : "run a scan" }; }

export function mountInsec(el, ctx) {
  const { head, esc } = ctx;
  const box = document.createElement("div");
  box.className = "insec-wrap";
  el.appendChild(box);

  const draw = () => {
    const a = audit(ctx);
    if (!a.ran) {
      box.innerHTML = `<div class="t-card insec-empty">
        <div class="t-cap">Security posture</div>
        <p class="t-s">Nothing to grade yet. Run a <b>WiFi/RF</b> scan, a <b>Network</b> scan, or a <b>Recon</b> scan, then come back — this reviews what those found, on your own gear only.</p>
        <button class="t-btn sm" id="insRefresh">↻ Re-check</button></div>`;
    } else {
      const counts = [0, 0, 0, 0]; a.findings.forEach(f => counts[f.sev]++);
      box.innerHTML = `<div class="t-card insec-head r${a.score >= 75 ? 0 : a.score >= 60 ? 2 : 3}">
          <div class="ins-score"><div class="ins-grade">${a.grade}</div><div class="ins-num">${a.score}<span>/100</span></div></div>
          <div class="ins-head-r"><div class="t-cap">Security posture</div>
            <div class="ins-chips">
              ${counts[3] ? `<span class="ins-chip r3">${counts[3]} high</span>` : ""}
              ${counts[2] ? `<span class="ins-chip r2">${counts[2]} medium</span>` : ""}
              ${counts[1] ? `<span class="ins-chip r1">${counts[1]} low</span>` : ""}
              ${counts[0] ? `<span class="ins-chip r0">${counts[0]} ok</span>` : ""}
            </div>
            <button class="t-link" id="insRefresh">↻ re-check</button></div></div>
        <div class="insec-list">${a.findings.map(f => `
          <div class="ins-f r${f.sev}">
            <div class="ins-f-dot"></div>
            <div class="ins-f-body">
              <div class="ins-f-top"><span class="ins-area">${esc(f.area)}</span><span class="ins-sev">${SEVLBL[f.sev]}</span></div>
              <div class="ins-f-title">${esc(f.title)}</div>
              <div class="ins-f-detail">${esc(f.detail)}</div>
              ${f.fix ? `<div class="ins-f-fix">→ ${esc(f.fix)}</div>` : ""}
            </div></div>`).join("")}</div>
        <p class="muted mono insec-foot">Defensive review of your own networks and devices only. It grades what the other tools found — it doesn't scan anything new.</p>`;
    }
    const r = box.querySelector("#insRefresh"); if (r) r.onclick = draw;
  };
  draw();
  return () => { box.remove(); };
}

(function () {
  if (document.getElementById("insec-css")) return;
  const s = document.createElement("style"); s.id = "insec-css"; s.textContent = `
  .insec-wrap{padding-inline:10px;max-width:900px}
  .insec-head{display:flex;gap:18px;align-items:center}
  .ins-score{display:flex;align-items:baseline;gap:10px;flex:0 0 auto}
  .ins-grade{font-size:46px;font-weight:800;line-height:1;color:var(--accent)}
  .insec-head.r2 .ins-grade{color:#ffd23f}.insec-head.r3 .ins-grade{color:#ff6b6b}
  .ins-num{font-family:var(--mono);font-size:18px;color:var(--ink)}.ins-num span{font-size:12px;color:var(--ink-dim)}
  .ins-head-r{flex:1;min-width:0}
  .ins-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}
  .ins-chip{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:6px}
  .ins-chip.r3{background:rgba(255,92,92,.18);color:#ff9a9a}.ins-chip.r2{background:rgba(255,210,63,.18);color:#ffe08a}
  .ins-chip.r1{background:rgba(255,255,255,.1);color:var(--ink-dim)}.ins-chip.r0{background:rgba(54,224,122,.16);color:#5ef0a0}
  .insec-list{margin-top:14px;display:flex;flex-direction:column;gap:10px}
  .ins-f{display:flex;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid var(--glass-line);background:rgba(255,255,255,.03)}
  .ins-f-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:var(--ink-dim)}
  .ins-f.r3{border-color:rgba(255,92,92,.5);background:rgba(255,92,92,.06)}.ins-f.r3 .ins-f-dot{background:#ff6b6b;box-shadow:0 0 8px #ff6b6b}
  .ins-f.r2{border-color:rgba(255,210,63,.4)}.ins-f.r2 .ins-f-dot{background:#ffd23f;box-shadow:0 0 8px rgba(255,210,63,.6)}
  .ins-f.r0{border-color:rgba(54,224,122,.35)}.ins-f.r0 .ins-f-dot{background:#36e07a;box-shadow:0 0 8px #36e07a}
  .ins-f-body{min-width:0;flex:1}
  .ins-f-top{display:flex;gap:8px;align-items:center;margin-bottom:3px}
  .ins-area{font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--accent)}
  .ins-sev{font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim)}
  .ins-f-title{font-size:15px;color:var(--ink);word-break:break-word}
  .ins-f-detail{font-size:13px;color:var(--ink-dim);margin-top:3px;line-height:1.45}
  .ins-f-fix{font-size:12px;color:var(--ink);margin-top:6px;opacity:.9;line-height:1.45}
  .insec-foot{font-size:10px;line-height:1.5;margin-top:12px}
  .insec-empty .t-s{margin:8px 0 12px}`;
  document.head.appendChild(s);
})();
