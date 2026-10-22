// Spy Tools — NETWORK RECON ("nmap and all"). TCP-connect port scan of a host on the
// operator's OWN network, run natively (a browser can't open raw sockets):
//   window.TURD_NATIVE.recon.ports({host, ports:[...], timeoutMs}) → [{port, open, service?, banner?}]
//   window.TURD_NATIVE.recon.nmap?({host, args}) → {raw}           (Windows, if nmap is installed)
// Falls back to a demo result in a plain browser / older app so the panel is always usable.
// Scans are scoped to a single host you enter; the UI keeps the target explicit.

const SERVICES = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http", 110: "pop3",
  111: "rpcbind", 135: "msrpc", 139: "netbios", 143: "imap", 161: "snmp", 389: "ldap",
  443: "https", 445: "smb", 465: "smtps", 514: "syslog", 515: "printer", 548: "afp",
  554: "rtsp", 587: "submission", 631: "ipp", 993: "imaps", 995: "pop3s",
  1080: "socks", 1433: "mssql", 1521: "oracle", 1723: "pptp", 1883: "mqtt", 1900: "ssdp",
  2049: "nfs", 2082: "cpanel", 3000: "dev/http", 3306: "mysql", 3389: "rdp", 3478: "stun",
  5000: "upnp/http", 5060: "sip", 5353: "mdns", 5432: "postgres", 5555: "adb", 5900: "vnc",
  6379: "redis", 7070: "rtsp", 8008: "http", 8060: "roku", 8080: "http-alt", 8081: "http",
  8123: "homeassistant", 8443: "https-alt", 8787: "T.U.R.D.", 8883: "mqtts", 9000: "http",
  9100: "printer", 32400: "plex", 49152: "upnp",
};
const COMMON = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 554, 587, 631, 993, 995,
  1433, 1883, 3306, 3389, 5000, 5060, 5353, 5432, 5900, 6379, 8008, 8060, 8080, 8123, 8443, 8787, 9100, 32400];

function parsePorts(spec) {
  if (!spec || /^common$/i.test(spec)) return COMMON.slice();
  const out = new Set();
  spec.split(/[,\s]+/).forEach(tok => {
    const m = tok.match(/^(\d+)-(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let p = a; p <= Math.min(b, 65535); p++) out.add(p); }
    else if (/^\d+$/.test(tok)) out.add(+tok);
  });
  return [...out].filter(p => p >= 1 && p <= 65535).slice(0, 2048);
}
const demoScan = (host, ports) => ports.map(p => ({
  port: p, open: [80, 443, 22, 445, 8787, 8080].includes(p) && Math.random() > .3, service: SERVICES[p],
})).filter(r => r.open || Math.random() > .97);

export function mountRecon(el, ctx) {
  const { esc, toast, head, LS } = ctx;
  const N = window.TURD_NATIVE;
  const last = LS.get("turd_recon_host", "");
  el.innerHTML = head("Network Recon", "NMAP", "TCP port scan · your network") + `
    <div class="ops-recon">
      <div class="t-card">
        <div class="rc-form">
          <label>Target host <input id="rcHost" placeholder="192.168.1.1" value="${esc(last)}" autocomplete="off" spellcheck="false"></label>
          <label>Ports <input id="rcPorts" placeholder="common · 1-1024 · 22,80,443" value="common" autocomplete="off" spellcheck="false"></label>
          <button class="t-btn" id="rcGo">▸ SCAN</button>
        </div>
        <p class="muted mono rc-note">${N && N.recon ? "Native TCP-connect scan." : N ? "This app build has no scanner yet — showing a demo. (Pending native update.)" : "Browser preview — showing a demo. Real scans run in the Windows/Android app."} Scan only hosts on networks you own or are authorised to test.</p>
        <div id="rcState" class="rc-state"></div>
      </div>
      <div class="t-card"><div class="t-cap">Open ports</div><div id="rcOut" class="rc-out"><p class="t-s">No scan yet.</p></div></div>
    </div>`;

  const hostEl = el.querySelector("#rcHost"), portsEl = el.querySelector("#rcPorts");
  const out = el.querySelector("#rcOut"), state = el.querySelector("#rcState"), go = el.querySelector("#rcGo");

  const run = async () => {
    const host = hostEl.value.trim();
    if (!host) { toast("enter a target host"); hostEl.focus(); return; }
    LS.set("turd_recon_host", host);
    const ports = parsePorts(portsEl.value.trim());
    if (!ports.length) { toast("no valid ports"); return; }
    go.disabled = true; state.textContent = `scanning ${host} · ${ports.length} ports…`;
    out.innerHTML = `<div class="rc-bar"><i></i></div>`;
    let rows = [];
    try {
      if (N && N.recon && N.recon.ports) {
        rows = await N.recon.ports({ host, ports, timeoutMs: 800 }) || [];
      } else {
        await new Promise(r => setTimeout(r, 900));
        rows = demoScan(host, ports);
      }
    } catch (e) { state.textContent = "scan failed: " + String(e && e.message || e); go.disabled = false; return; }
    const open = rows.filter(r => r.open).sort((a, b) => a.port - b.port);
    state.textContent = `${host} · ${open.length} open of ${ports.length} scanned · ${new Date().toLocaleTimeString([], { hour12: false })}`;
    out.innerHTML = open.length ? `<table class="rc-table"><thead><tr><th>port</th><th>service</th><th>detail</th></tr></thead><tbody>` +
      open.map(r => `<tr><td class="rc-p">${r.port}</td><td>${esc(r.service || SERVICES[r.port] || "—")}</td><td class="rc-d">${esc(r.banner || (r.port === 8787 ? "T.U.R.D. server" : ""))}</td></tr>`).join("") +
      `</tbody></table>` : `<p class="t-s">No open ports found on ${esc(host)}.</p>`;
    go.disabled = false;
  };
  go.onclick = run;
  [hostEl, portsEl].forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") run(); }));
  return () => {};
}
