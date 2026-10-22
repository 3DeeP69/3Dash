// ===========================================================================
// CHAT — realtime comms deck for everyone logged in.
//
// Two transports, chosen automatically:
//   • UPLINK  — server/server.js (real multi-user across devices). Used when an
//               uplink endpoint is configured. The SERVER records each
//               connection's details (IP, approx location/network, device,
//               screen, timezone, language, session timing) to its admin-only
//               audit store — surfaced in the hidden Access Log, never in chat.
//   • DEMO    — BroadcastChannel loopback so two tabs of THIS browser can chat
//               with no server at all, to demo the deck. No details recorded.
//
// Self-contained: injects its own CSS, owns only this file. Theme = comms violet.
// ===========================================================================
import up from "../uplink.js";

const ACCENT = "#9b7bff", ACCENT2 = "#5b3fff", RGB = "155,123,255";
const DEMO_KEY = "turd_chat_demo";

let K, host = null, panel, link = null, communityOff = null, roster = [], typingTimer = null, typingShown = {}, wiredResize = null, onUplinkEvt = null, dropOff = null;

/* ------------------------------------------------------------ styles */
function injectCSS() {
  if (document.getElementById("chat-css")) return;
  const s = document.createElement("style"); s.id = "chat-css";
  s.textContent = `
  .ch-wrap{display:grid;grid-template-columns:230px 1fr;gap:16px;height:min(72vh,640px)}
  @media(max-width:760px){.ch-wrap{grid-template-columns:1fr;height:auto}.ch-side{display:none}}
  /* compact = chat docked beside the community calendar; fills its pane, no roster rail */
  .ch-wrap.compact{grid-template-columns:1fr;gap:0;height:100%;min-height:0}
  .ch-wrap.compact .ch-side{display:none}
  .ch-wrap.compact .ch-main{height:100%}
  .ch-bar .deck{color:var(--ink-dim)}.ch-bar .deck #chCount{color:var(--accent)}
  .ch-side{display:flex;flex-direction:column;gap:12px;min-height:0}
  .ch-card{background:rgba(var(--accent-rgb),.05);border:1px solid var(--glass-line);border-radius:16px;padding:14px 16px}
  .ch-cap{font-family:var(--mono);font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--ink-dim);margin-bottom:10px}
  .ch-ros{display:flex;flex-direction:column;gap:7px;overflow:auto}
  .ch-ro{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink)}
  .ch-ro .pip{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok);flex:none}
  .ch-ro .rr{margin-left:auto;font-family:var(--mono);font-size:9px;letter-spacing:1px;color:var(--accent);text-transform:uppercase}
  .ch-ro.admin .rr{color:var(--bad)}
  .ch-main{display:flex;flex-direction:column;min-height:0;background:rgba(0,0,0,.22);border:1px solid var(--glass-line);border-radius:18px;overflow:hidden}
  .ch-bar{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--glass-line);font-family:var(--mono);font-size:11px;letter-spacing:1px;color:var(--ink-dim)}
  .ch-bar .st{display:flex;align-items:center;gap:7px}
  .ch-bar .st .pip{width:8px;height:8px;border-radius:50%;background:var(--ink-faint)}
  .ch-bar .st.on .pip{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .ch-bar .st.off .pip{background:var(--bad);box-shadow:0 0 8px var(--bad)}
  .ch-bar .mode{margin-left:auto;color:var(--accent);border:1px solid var(--glass-line);border-radius:6px;padding:2px 8px;font-size:9px;letter-spacing:1.4px;text-transform:uppercase}
  .ch-bar .mode.demo{color:var(--warn)}
  .ch-netbtn{margin-left:auto;font-family:var(--mono);font-size:9px;letter-spacing:1.4px;text-transform:uppercase;cursor:pointer;color:var(--bad);background:transparent;border:1px solid rgba(255,92,122,.4);border-radius:6px;padding:3px 9px}
  .ch-netbtn:hover{background:rgba(255,92,122,.12)}
  .ch-bar .ch-netbtn + .mode{margin-left:10px}
  .ch-netwrap{position:absolute;inset:0;z-index:5;background:rgba(2,4,9,.92);backdrop-filter:blur(6px);border-radius:18px;overflow:auto;padding:20px 22px}
  .ch-netwrap .close{position:sticky;top:0;float:right;cursor:pointer;color:var(--ink);background:rgba(255,92,122,.12);border:1px solid rgba(255,92,122,.4);border-radius:8px;padding:4px 10px;font-family:var(--mono);font-size:11px}
  .ch-netwrap table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}
  .ch-netwrap th,.ch-netwrap td{text-align:left;padding:7px 9px;border-bottom:1px solid rgba(255,92,122,.15)}
  .ch-netwrap th{color:var(--bad);text-transform:uppercase;font-size:9px;letter-spacing:1px}
  .ch-netwrap td.ok{color:var(--ok)}.ch-netwrap td.bad{color:var(--bad)}
  .ch-log{flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:2px;scroll-behavior:smooth}
  .ch-log::-webkit-scrollbar{width:8px}.ch-log::-webkit-scrollbar-thumb{background:rgba(var(--accent-rgb),.35);border-radius:8px}
  /* message rows — console lines, no bubbles */
  .ch-m{padding:6px 10px 6px 12px;border-left:2px solid transparent;border-radius:0 8px 8px 0;transition:.15s}
  .ch-m:hover{background:rgba(var(--accent-rgb),.05);border-left-color:rgba(var(--accent-rgb),.5)}
  .ch-m.mine{border-left-color:var(--accent)}
  .ch-m.me-run,.ch-m.run{padding-top:1px}
  .ch-h{display:flex;align-items:baseline;gap:9px;margin-bottom:1px}
  .ch-h .nm{font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--accent)}
  .ch-h .nm.admin{color:var(--bad)}
  .ch-h .nm.mine{color:var(--ink)}
  .ch-h .tg{font-family:var(--mono);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--bad);border:1px solid rgba(255,92,122,.4);border-radius:4px;padding:0 4px}
  .ch-h .tm{font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-left:auto}
  .ch-t{font-size:14px;line-height:1.5;color:var(--ink);word-wrap:break-word;overflow-wrap:anywhere}
  .ch-t a{color:var(--accent)}
  .ch-sys{align-self:center;font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--ink-faint);padding:4px 0;text-transform:uppercase}
  .ch-typ{height:18px;padding:0 18px 6px;font-family:var(--mono);font-size:11px;color:var(--ink-dim);font-style:italic}
  .ch-foot{border-top:1px solid var(--glass-line);padding:12px 14px}
  .ch-in{display:flex;gap:10px;align-items:flex-end}
  .ch-in textarea{resize:none;min-height:42px;max-height:120px;line-height:1.4}
  .ch-send{flex:none;font-family:var(--mono);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;color:#04121a;background:linear-gradient(180deg,var(--accent),var(--accent2));border:0;border-radius:10px;padding:0 18px;height:42px;box-shadow:0 0 16px rgba(var(--accent-rgb),.5)}
  .ch-send:disabled{opacity:.45;cursor:default;box-shadow:none}
  .ch-note{margin-top:9px;font-family:var(--mono);font-size:10px;letter-spacing:.5px;color:var(--ink-dim);line-height:1.55}
  .ch-note b{color:var(--accent);font-weight:600;white-space:nowrap}
  .ch-note .ch-pill,.ch-note>span:first-child{margin-right:6px}
  .ch-setup{max-width:520px;margin:0 auto}
  .ch-setup .row{gap:10px;margin:14px 0}
  /* centered empty state (shown before an uplink is linked) */
  .ch-empty{height:100%;min-height:min(60vh,520px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;max-width:460px;margin:0 auto;padding:24px}
  .ch-empty-ico{width:84px;height:84px;border-radius:24px;display:grid;place-items:center;font-size:40px;color:var(--accent);
    background:radial-gradient(120% 120% at 50% 0,rgba(var(--accent-rgb),.22),rgba(var(--accent-rgb),.05));border:1px solid var(--glass-line);box-shadow:0 0 34px rgba(var(--accent-rgb),.3)}
  .ch-empty h2{font-size:22px;letter-spacing:1px;color:var(--ink)}
  .ch-empty p{font-size:13px;line-height:1.6;color:var(--ink-dim);max-width:400px}
  .ch-big{font-family:var(--mono);font-size:13px;letter-spacing:1.4px;text-transform:uppercase;cursor:pointer;color:#04121a;
    background:linear-gradient(180deg,var(--accent),var(--accent2));border:0;border-radius:12px;padding:13px 26px;box-shadow:0 0 22px rgba(var(--accent-rgb),.5);transition:.2s}
  .ch-big:hover{filter:brightness(1.08);transform:translateY(-1px)}
  .ch-empty .ch-or{font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-dim);opacity:.7;margin-top:4px}
  .ch-link-row{display:flex;gap:8px;width:100%;max-width:400px}
  .ch-link-row input{flex:1}
  .ch-pill{display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--accent);border:1px solid var(--glass-line);border-radius:6px;padding:3px 9px}
  /* quick drop overlay */
  .ch-drop-compose{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
  .ch-drop-compose textarea{flex:1;min-width:150px;resize:none;min-height:40px;max-height:120px;line-height:1.4}
  .ch-drop-list{margin-top:12px;display:flex;flex-direction:column;gap:8px;overflow:auto}
  .ch-drop-it{display:flex;align-items:center;gap:10px;background:rgba(var(--accent-rgb),.05);border:1px solid var(--glass-line);border-radius:12px;padding:9px 12px}
  .ch-drop-it .di-ico{flex:none;font-size:18px;opacity:.85}
  .ch-drop-it .di-main{flex:1;min-width:0}
  .ch-drop-it .di-name{font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ch-drop-it .di-txt{font-size:13px;color:var(--ink);word-break:break-word}
  .ch-drop-it .di-txt a{color:var(--accent)}
  .ch-drop-it .di-sub{font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:2px}
  .ch-drop-it button{flex:none;font-family:var(--mono);font-size:11px;cursor:pointer;color:var(--ink-dim);background:transparent;border:1px solid var(--glass-line);border-radius:8px;padding:4px 8px}
  .ch-drop-it button:hover{color:var(--accent);border-color:var(--accent)}
  `;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------ helpers */
const esc = s => K.esc(String(s == null ? "" : s));
const fmt = txt => esc(txt)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const timeOf = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function me() { const s = K.session || {}; return (s.user || "operator"); }
function myRole() { const s = K.session || {}; return (s.role || "user"); }

/* ------------------------------------------------------------ render shell */
const DEMO_NOTE = `<span class="ch-pill">DEMO</span> Same-browser preview — open a second tab to chat with yourself. No details recorded.`;
const LOG_NOTE = `<span>🔒</span> Your connection (<b>IP, approx. location, device, browser</b>) is logged for the admin only, in the hidden Access Log — never shown in chat.`;

function renderShell(mode, compact) {
  const demo = mode === "demo";
  const main = `
      <div class="ch-main">
        <div class="ch-bar">
          <span class="st off" id="chStat"><span class="pip"></span><span id="chStatT">connecting…</span></span>
          ${compact ? `<span class="deck">· <span id="chCount">0</span> on deck</span>` : ""}
          ${!demo ? `<button class="ch-netbtn" id="chDrop" title="Quick Drop — send a link, note or file to your devices">⇅ DROP</button>` : ""}
          ${(!demo && myRole() === "admin") ? `<button class="ch-netbtn" id="chNet" title="Admin network log">⬡ NET LOG</button>` : ""}
          <span class="mode ${demo ? "demo" : ""}">${demo ? "local demo" : "uplink"}</span>
        </div>
        <div class="ch-log" id="chLog"></div>
        <div class="ch-typ" id="chTyp"></div>
        <div class="ch-foot">
          <div class="ch-in">
            <textarea id="chIn" rows="1" placeholder="Message everyone on deck…  (Enter to send, Shift+Enter = newline)"></textarea>
            <button class="ch-send" id="chSend" disabled>Send</button>
          </div>
          <div class="ch-note">${demo ? DEMO_NOTE : LOG_NOTE}</div>
        </div>
      </div>`;
  const side = compact ? "" : `
      <div class="ch-side">
        <div class="ch-card" style="flex:1;display:flex;flex-direction:column;min-height:0">
          <div class="ch-cap">On deck · <span id="chCount">0</span></div>
          <div class="ch-ros" id="chRoster"></div>
        </div>
      </div>`;
  panel.innerHTML = (compact ? "" : K.head("Chat", "COMMS", `operator ${esc(me())}`))
    + `<div class="ch-wrap${compact ? " compact" : ""}">${side}${main}</div>`;
  wireComposer();
  autoResize();
  const net = panel.querySelector("#chNet");
  if (net) net.onclick = openNetLog;
  const dp = panel.querySelector("#chDrop");
  if (dp) dp.onclick = openDrop;
}

// Admin-only: pull the server's connection log and show it over the chat panel.
// The server returns pre-escaped HTML and enforces admin role on the token too.
async function openNetLog() {
  const main = panel.querySelector(".ch-main"); if (!main) return;
  let wrap = main.querySelector(".ch-netwrap");
  if (wrap) { wrap.remove(); return; }
  wrap = document.createElement("div"); wrap.className = "ch-netwrap";
  wrap.innerHTML = `<button class="close">✕ close</button><div class="muted mono" style="font-size:11px">loading network log…</div>`;
  main.appendChild(wrap);
  wrap.querySelector(".close").onclick = () => wrap.remove();
  const html = await up.auditHTML();
  const close = wrap.querySelector(".close");
  wrap.innerHTML = ""; wrap.appendChild(close);
  // invite-only operator management
  const admin = document.createElement("div");
  admin.className = "card"; admin.style.cssText = "margin-bottom:18px";
  admin.innerHTML = `<div class="ch-cap" style="margin-bottom:8px">Invite an operator</div>
    <div class="row" style="gap:8px"><input id="nuU" placeholder="operator id" style="max-width:180px">
      <input id="nuP" type="password" placeholder="passkey" style="max-width:180px">
      <select id="nuR" style="max-width:120px"><option value="user">user</option><option value="admin">admin</option></select>
      <button class="btn sm" id="nuGo">Create</button></div>
    <div id="nuMsg" class="muted mono" style="font-size:11px;min-height:16px;margin-top:6px"></div>`;
  wrap.appendChild(admin);
  const nm = (t, ok) => { const el = admin.querySelector("#nuMsg"); el.textContent = t; el.style.color = ok ? "var(--ok)" : "var(--bad)"; };
  admin.querySelector("#nuGo").onclick = async () => {
    const u = admin.querySelector("#nuU").value.trim(), p = admin.querySelector("#nuP").value, role = admin.querySelector("#nuR").value;
    if (!u || !p) { nm("id and passkey required"); return; }
    nm("creating…", true);
    const r = await up.createUser(u, p, role);
    if (!r.ok) { nm(r.error || "could not create"); return; }
    nm(`✓ operator "${u}" created — share the passkey with them`, true);
    admin.querySelector("#nuU").value = ""; admin.querySelector("#nuP").value = "";
    openNetLog(); openNetLog();   // refresh the log
  };
  const box = document.createElement("div");
  box.innerHTML = html || `<p class="muted mono" style="font-size:12px">No log available (admin clearance required, or uplink offline).</p>`;
  wrap.appendChild(box);
}

function fmtSize(n) { n = +n || 0; return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

// Quick Drop: a "my devices" note-to-self deck over the chat panel — send a link, note or
// file from one signed-in device and it shows up on the others (relayed through the server).
async function openDrop() {
  const main = panel.querySelector(".ch-main"); if (!main) return;
  let wrap = main.querySelector(".ch-dropwrap");
  const teardown = () => { if (dropOff) { try { dropOff(); } catch (e) {} dropOff = null; } };
  if (wrap) { wrap.remove(); teardown(); return; }
  wrap = document.createElement("div"); wrap.className = "ch-netwrap ch-dropwrap";
  wrap.innerHTML = `<button class="close">✕ close</button>
    <div class="ch-cap" style="margin-bottom:8px">⇅ Quick Drop · your devices</div>
    <p class="muted mono" style="font-size:11px;margin-bottom:12px">Send a link, note or file to your other signed-in devices. Everything stays on your own server.</p>
    <div class="ch-drop-compose">
      <textarea id="dpText" rows="1" placeholder="Paste a link or type a note…"></textarea>
      <button class="btn sm" id="dpSend">Send</button>
      <label class="btn sm" style="cursor:pointer">📎 File<input id="dpFile" type="file" style="display:none"></label>
    </div>
    <div id="dpMsg" class="muted mono" style="font-size:11px;min-height:15px;margin:6px 0"></div>
    <div class="ch-drop-list" id="dpList"><div class="muted" style="font-size:12px">loading…</div></div>`;
  main.appendChild(wrap);
  const listEl = wrap.querySelector("#dpList");
  const dmsg = (t, ok) => { const e = wrap.querySelector("#dpMsg"); if (e) { e.textContent = t || ""; e.style.color = ok ? "var(--ok)" : "var(--bad)"; } };
  wrap.querySelector(".close").onclick = () => { wrap.remove(); teardown(); };

  const row = d => {
    const when = timeOf(d.t), dev = d.dev ? esc(d.dev) : "";
    if (d.kind === "file") return `<div class="ch-drop-it"><div class="di-ico">📄</div><div class="di-main"><div class="di-name">${esc(d.name || "file")}</div><div class="di-sub">${fmtSize(d.size)}${dev ? " · " + dev : ""} · ${when}</div></div><button class="di-dl" data-id="${esc(d.id)}" data-name="${esc(d.name || "file")}">⤓ save</button><button class="di-del" data-id="${esc(d.id)}">✕</button></div>`;
    const isLink = d.kind === "link" || /^https?:\/\//.test(d.text || "");
    const body = isLink ? `<a href="${esc(d.text)}" target="_blank" rel="noopener">${esc(d.text)}</a>` : esc(d.text);
    return `<div class="ch-drop-it"><div class="di-ico">${isLink ? "🔗" : "✎"}</div><div class="di-main"><div class="di-txt">${body}</div><div class="di-sub">${dev ? dev + " · " : ""}${when}</div></div><button class="di-copy" data-copy="${esc(d.text)}">copy</button><button class="di-del" data-id="${esc(d.id)}">✕</button></div>`;
  };
  const refresh = async () => {
    const drops = await up.dropList();
    if (!wrap.isConnected) return;
    listEl.innerHTML = drops.length ? drops.slice().reverse().map(row).join("") : `<div class="muted" style="font-size:12px">nothing dropped yet — send something above</div>`;
    listEl.querySelectorAll(".di-del").forEach(b => b.onclick = async () => { b.disabled = true; await up.dropDelete(b.dataset.id); refresh(); });
    listEl.querySelectorAll(".di-copy").forEach(b => b.onclick = () => { try { navigator.clipboard.writeText(b.dataset.copy); dmsg("copied", true); } catch (e) { dmsg("copy not available"); } });
    listEl.querySelectorAll(".di-dl").forEach(b => b.onclick = async () => {
      dmsg("downloading…", true);
      try { const r = await up.dropFetch(b.dataset.id); const blob = await r.blob(); const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = b.dataset.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); dmsg("saved", true); }
      catch (e) { dmsg("download failed"); }
    });
  };
  wrap.querySelector("#dpSend").onclick = async () => {
    const t = wrap.querySelector("#dpText"), v = t.value.trim(); if (!v) return;
    const r = await up.dropText(/^https?:\/\//.test(v) ? "link" : "text", v);
    if (r && r.ok) { t.value = ""; dmsg("sent", true); refresh(); } else dmsg((r && r.error) || "could not send");
  };
  wrap.querySelector("#dpText").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); wrap.querySelector("#dpSend").click(); } };
  wrap.querySelector("#dpFile").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 100 * 1024 * 1024) { dmsg("file too big (100 MB max)"); e.target.value = ""; return; }
    dmsg(`uploading ${f.name}…`, true);
    const r = await up.dropUpload(f.name, f.type || "application/octet-stream", f);
    if (r && r.ok) { dmsg("sent", true); refresh(); } else dmsg((r && r.error) || "upload failed");
    e.target.value = "";
  };
  await refresh();
  dropOff = up.onDrop(() => refresh());   // live: a drop from another device refreshes the list
}

function renderSetup() {
  panel.innerHTML = K.head("Chat", "COMMS", "uplink not linked") + `
    <div class="ch-empty">
      <div class="ch-empty-ico">✉</div>
      <h2>Comms deck</h2>
      <p>Real-time chat for everyone logged in. Try it right now across tabs of this browser, or link your uplink server so operators on other devices can join.</p>
      <button class="ch-big" id="chDemo">▶ Try local demo</button>
      <div class="ch-or">${up.lastEndpoint && up.lastEndpoint() ? "reconnect to your server" : "or link a server"}</div>
      <div class="ch-link-row"><input id="chEp" placeholder="http://192.168.x.x:8787" value="${esc(up.lastEndpoint ? up.lastEndpoint() : up.endpoint())}"><button class="btn" id="chLink">Link</button></div>
      <div id="chEpMsg" class="muted mono" style="font-size:11px;min-height:16px"></div>
    </div>`;
  const msg = (t, ok) => { const el = panel.querySelector("#chEpMsg"); el.textContent = t; el.style.color = ok ? "var(--ok)" : "var(--bad)"; };
  panel.querySelector("#chLink").onclick = async () => {
    const url = panel.querySelector("#chEp").value.trim();
    if (!/^https?:\/\//.test(url)) { msg("enter a full http(s) URL"); return; }
    up.setEndpoint(url); msg("pinging…", true);
    const h = await up.health();
    if (!h) { msg("no response — check the URL / that the server is running"); return; }
    msg(`linked · uplink v${h.version || "?"} · ${h.online || 0} online`, true);
    K.toast("uplink linked");
    setTimeout(start, 500);
  };
  panel.querySelector("#chDemo").onclick = () => { try { localStorage.setItem(DEMO_KEY, "1"); } catch (e) {} start(); };
}

/* ------------------------------------------------------------ message list */
let lastAuthor = null;
function clearLog() { lastAuthor = null; const l = panel.querySelector("#chLog"); if (l) l.innerHTML = ""; }
function sys(text) { const l = panel.querySelector("#chLog"); if (!l) return; const d = document.createElement("div"); d.className = "ch-sys"; d.textContent = text; l.appendChild(d); scrollDown(); lastAuthor = null; }
function addMsg(m) {
  const l = panel.querySelector("#chLog"); if (!l) return;
  const mine = m.user === me();
  const run = lastAuthor === m.user;
  const d = document.createElement("div");
  d.className = "ch-m" + (mine ? " mine" : "") + (run ? " run" : "");
  const roleCls = m.role === "admin" ? " admin" : "";
  d.innerHTML = (run ? "" : `<div class="ch-h"><span class="nm${roleCls}${mine ? " mine" : ""}">${esc(m.user)}</span>${m.role === "admin" ? '<span class="tg">admin</span>' : ""}<span class="tm">${timeOf(m.t)}</span></div>`)
    + `<div class="ch-t">${fmt(m.text)}</div>`;
  l.appendChild(d); lastAuthor = m.user; scrollDown();
}
function scrollDown() { const l = panel.querySelector("#chLog"); if (l) l.scrollTop = l.scrollHeight; }
function setStat(on, text) {
  const s = panel.querySelector("#chStat"); if (!s) return;
  s.className = "st " + (on ? "on" : "off"); panel.querySelector("#chStatT").textContent = text;
  const btn = panel.querySelector("#chSend"); if (btn) btn.disabled = !on;
}
function setRoster(list) {
  roster = list || []; const r = panel.querySelector("#chRoster"); const c = panel.querySelector("#chCount");
  if (c) c.textContent = roster.length;
  if (!r) return;
  r.innerHTML = roster.length ? roster.map(u => `<div class="ch-ro ${u.role === "admin" ? "admin" : ""}"><span class="pip"></span><span>${esc(u.user)}${u.user === me() ? " (you)" : ""}</span><span class="rr">${esc(u.role || "user")}</span></div>`).join("") : `<div class="muted" style="font-size:12px">just you so far</div>`;
}
function showTyping(user) {
  typingShown[user] = Date.now();
  const names = Object.keys(typingShown).filter(u => u !== me() && Date.now() - typingShown[u] < 3000);
  const el = panel.querySelector("#chTyp"); if (el) el.textContent = names.length ? (names.length === 1 ? `${names[0]} is typing…` : `${names.length} operators typing…`) : "";
  clearTimeout(typingTimer); typingTimer = setTimeout(() => { const e2 = panel.querySelector("#chTyp"); if (e2) e2.textContent = ""; }, 3000);
}

/* ------------------------------------------------------------ composer */
function autoResize() { const t = panel.querySelector("#chIn"); if (!t) return; t.style.height = "42px"; t.style.height = Math.min(120, t.scrollHeight) + "px"; }
function wireComposer() {
  const t = panel.querySelector("#chIn"), btn = panel.querySelector("#chSend");
  const fire = () => { const v = t.value.trim(); if (!v || !link) return; link.send(v); t.value = ""; autoResize(); };
  t.oninput = () => { autoResize(); if (link && link.typing) link.typing(); };
  t.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fire(); } };
  btn.onclick = fire;
}

/* ------------------------------------------------------------ transports */
// DEMO transport: BroadcastChannel loopback across tabs of the same browser.
function demoTransport() {
  let bc; try { bc = new BroadcastChannel("turd-chat-demo"); } catch (e) { bc = null; }
  const seen = JSON.parse(sessionStorage.getItem("turd_chat_demo_hist") || "[]");
  const whoKey = "turd_chat_demo_who";
  const me_ = { user: me(), role: myRole(), tab: Math.random().toString(36).slice(2) };
  const api = {
    _handlers: {},
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    _emit(ev, d) { (this._handlers[ev] || []).forEach(f => f(d)); },
    send(text) { const m = { type: "msg", id: Math.random().toString(36).slice(2), user: me_.user, role: me_.role, text, t: Date.now() }; push(m); bc && bc.postMessage(m); api._emit("msg", m); },
    typing() { bc && bc.postMessage({ type: "typing", user: me_.user }); },
    close() { bc && bc.postMessage({ type: "bye", who: me_ }); try { bc && bc.close(); } catch (e) {} },
  };
  function push(m) { seen.push(m); while (seen.length > 120) seen.shift(); try { sessionStorage.setItem("turd_chat_demo_hist", JSON.stringify(seen)); } catch (e) {} }
  // presence via localStorage heartbeat
  function beat() { try { const who = JSON.parse(localStorage.getItem(whoKey) || "{}"); who[me_.tab] = { user: me_.user, role: me_.role, t: Date.now() }; localStorage.setItem(whoKey, JSON.stringify(who)); } catch (e) {} roster_(); }
  function roster_() { try { const who = JSON.parse(localStorage.getItem(whoKey) || "{}"); const live = Object.values(who).filter(x => Date.now() - x.t < 6000); const uniq = {}; live.forEach(x => uniq[x.user] = x.role); api._emit("presence", { roster: Object.entries(uniq).map(([user, role]) => ({ user, role })) }); } catch (e) {} }
  if (bc) bc.onmessage = e => { const d = e.data; if (d.type === "msg") { push(d); api._emit("msg", d); } else if (d.type === "typing") api._emit("typing", d); else if (d.type === "bye") roster_(); };
  const hb = setInterval(beat, 2500); const rb = setInterval(roster_, 3000);
  const origClose = api.close.bind(api); api.close = () => { clearInterval(hb); clearInterval(rb); try { const who = JSON.parse(localStorage.getItem(whoKey) || "{}"); delete who[me_.tab]; localStorage.setItem(whoKey, JSON.stringify(who)); } catch (e) {} origClose(); };
  setTimeout(() => { api._emit("open", {}); api._emit("hello", { history: seen }); beat(); }, 60);
  return api;
}

/* ------------------------------------------------------------ wire a transport to the UI */
function bind(l, demo) {
  link = l;
  setStat(false, "connecting…");
  l.on("open", () => setStat(true, demo ? "demo ready" : "online"));
  l.on("close", () => setStat(false, "reconnecting…"));
  l.on("error", () => setStat(false, "link error"));
  l.on("hello", d => { clearLog(); (d.history || []).forEach(addMsg); if (d.roster) setRoster(d.roster); if (!d.history || !d.history.length) sys("— start of transmission —"); });
  l.on("msg", addMsg);
  l.on("typing", d => showTyping(d.user));
  l.on("presence", d => { if (d.roster) setRoster(d.roster); if (d.joined && d.joined.user !== me()) sys(`${d.joined.user} joined`); if (d.left) sys(`${d.left.user} left`); });
}

/* ------------------------------------------------------------ start / page assembly */
const readDemo = () => { try { return localStorage.getItem(DEMO_KEY) === "1"; } catch (e) { return false; } };

async function start() {
  // tear down any previous community mount before re-deciding
  try { if (communityOff) communityOff(); } catch (e) {}
  communityOff = null;
  const demoFlag = readDemo();

  // on the native desktop app, self-link to the server this PC is hosting (survives a
  // boot race / cleared storage) so we don't get stuck on the link screen
  if (!demoFlag && up.ensureEndpoint) { try { await up.ensureEndpoint(); } catch (e) {} }

  // gates that need the full panel (not the split)
  if (!up.configured() && !demoFlag) { panel = host; renderSetup(); return; }
  if (up.configured() && !demoFlag && !up.token()) { panel = host; renderConnect(); return; }

  // usable state → put the community calendar centre-stage with chat docked beside it
  const mode = demoFlag ? "demo" : "uplink";
  try {
    const page = await import("../community/page.js");
    if (page && page.mountCommunity) {
      let transport;
      if (mode === "demo") { try { const cal = await import("../community/calendar.js"); if (cal.localTransport) transport = cal.localTransport(); } catch (e) {} }
      communityOff = page.mountCommunity(host, K, { title: "Community", key: "COMMS", transport, mountChat: el => renderChatInto(el, mode) });
      return;
    }
  } catch (e) { /* community module not present — fall back to chat-only */ }
  panel = host;
  renderShell(mode, false);
  bind(mode === "demo" ? demoTransport() : up.connectChat(), mode === "demo");
}

// Render the chat deck into a host element (the calendar page's chat pane).
function renderChatInto(el, mode) {
  panel = el;
  renderShell(mode, true);
  bind(mode === "demo" ? demoTransport() : up.connectChat(), mode === "demo");
  return () => { try { if (link && link.close) link.close(); } catch (e) {} link = null; };
}

// lightweight passkey prompt when an uplink is configured but we have no token yet
function renderConnect() {
  panel.innerHTML = K.head("Chat", "COMMS", "uplink login") + `
    <div class="ch-setup card">
      <h3 style="margin-bottom:8px">Connect to chat</h3>
      <p class="muted" style="font-size:13px">Sign in to the uplink to join the deck. Operator accounts are <b>invite-only</b> — the admin creates them from the Chat deck's network log.</p>
      <div class="row" style="margin-top:12px"><input id="cu" placeholder="operator id" value="${esc(me())}"></div>
      <div class="row"><input id="cp" type="password" placeholder="passkey"></div>
      <div id="cmsg" class="muted mono" style="font-size:11px;min-height:16px"></div>
      <div class="row"><button class="btn" id="cGo">Sign in</button>
        <button class="btn sm" id="cDemo" style="margin-left:auto">demo instead</button></div>
    </div>`;
  const msg = (t, ok) => { const el = panel.querySelector("#cmsg"); el.textContent = t; el.style.color = ok ? "var(--ok)" : "var(--bad)"; };
  const go = async () => {
    const u = panel.querySelector("#cu").value.trim(), p = panel.querySelector("#cp").value;
    if (!u || !p) { msg("id and passkey required"); return; }
    msg("…", true);
    const r = await up.login(u, p);
    if (!r.ok) { msg(r.error || "access denied"); return; }
    if (K.session) { K.session.user = u; K.session.role = r.role; K.session.token = up.token(); }
    msg("connected", true); setTimeout(start, 350);
  };
  panel.querySelector("#cGo").onclick = go;
  panel.querySelector("#cp").onkeydown = e => { if (e.key === "Enter") go(); };
  panel.querySelector("#cDemo").onclick = () => { try { localStorage.setItem(DEMO_KEY, "1"); } catch (e) {} start(); };
}

/* ------------------------------------------------------------ section contract */
export default {
  id: "chat",
  icon: "✉",
  label: "Chat",
  theme: { accent: ACCENT, accent2: ACCENT2, rgb: RGB },
  mount(panelEl, ctx) {
    K = ctx; host = panelEl; panel = panelEl; injectCSS();
    host.classList.add("t-full");
    typingShown = {};
    // the native Android app can discover the server after the page has loaded (LAN
    // scan) and fire window "turd:uplink" {url}; re-run start() so chat links itself
    onUplinkEvt = () => { try { if (!readDemo()) start(); } catch (e) {} };
    try { window.addEventListener("turd:uplink", onUplinkEvt); } catch (e) {}
    start();
  },
  unmount() {
    try { if (communityOff) communityOff(); } catch (e) {}
    communityOff = null;
    try { if (link && link.close) link.close(); } catch (e) {}
    link = null; clearTimeout(typingTimer); panel = host;
    try { if (onUplinkEvt) window.removeEventListener("turd:uplink", onUplinkEvt); } catch (e) {} onUplinkEvt = null;
    try { if (dropOff) dropOff(); } catch (e) {} dropOff = null;
  },
  summary(ctx) {
    const online = roster.length;
    return { title: "Chat", value: online ? `${online} on deck` : "comms", note: up.configured() ? "uplink ready" : "tap to link" };
  },
};
