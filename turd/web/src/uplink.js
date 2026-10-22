// ===========================================================================
// T.U.R.D. UPLINK CLIENT — talks to server/server.js for multi-user accounts,
// login and realtime chat. Core.js uses login()/setPass() so operator accounts
// live on the server (shared across devices) instead of per-device localStorage.
//
// Configure the endpoint once (persisted): set window.TURD_UPLINK or, in the
// Chat section, paste a server URL — stored in localStorage "turd_uplink".
// When no endpoint is set, configured() is false and everything falls back to
// the shell's local admin/admin so the app still runs fully offline.
// ===========================================================================
const LSget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function endpoint() {
  let u = (typeof window !== "undefined" && window.TURD_UPLINK) || LSget("turd_uplink", "");
  return (u || "").replace(/\/+$/, "");
}
export function setEndpoint(url) {
  const v = (url || "").trim().replace(/\/+$/, "");
  LSset("turd_uplink", v);
  if (v) LSset("turd_uplink_last", v);   // remember the last good address so re-linking is one tap
}
export function configured() { return !!endpoint(); }
// last server address this device linked to (survives a cleared turd_uplink), for pre-fill
export function lastEndpoint() { return endpoint() || LSget("turd_uplink_last", "") || ""; }

/* Native desktop (Windows app) hosts the chat server itself. If no endpoint is set
   yet — first launch, a boot race where the server wasn't up when the page loaded, or
   storage got cleared — discover the running local server and link to it, so chat just
   works and can't get stuck on the "link a server" screen. No-op in a plain browser,
   or once an endpoint is already configured. */
export async function ensureEndpoint() {
  if (endpoint()) return endpoint();
  const N = (typeof window !== "undefined") && window.TURD_NATIVE;
  if (!N || !N.server) return endpoint();
  for (let i = 0; i < 6 && !endpoint(); i++) {
    try {
      const s = await N.server.status();
      if (s && s.running && s.port) { setEndpoint("http://127.0.0.1:" + s.port); break; }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));   // server is still autostarting — wait and retry
  }
  return endpoint();
}

/* Use the native CORS-free bridge (window.TURD_HTTP, set by native.js in the Tauri /
   Capacitor apps) for api calls, so cross-origin and mixed-content http requests to the
   local server aren't blocked by the app's webview. In a plain browser it's window.fetch. */
const httpFetch = (...a) => ((typeof window !== "undefined" && window.TURD_HTTP) || fetch)(...a);

/* a bus that mirrors every frame from whichever chat socket is currently live,
   plus a stable proxy so the calendar keeps receiving {type:"cal"} frames
   across chat reconnects (the underlying WebSocket object changes on reconnect) */
const wsBus = new EventTarget();
let _liveWs = null;
export function chatSocketProxy() {
  const map = new WeakMap();
  return {
    addEventListener(type, fn) { if (type !== "message") return; const h = e => fn(e); map.set(fn, h); wsBus.addEventListener("message", h); },
    removeEventListener(type, fn) { if (type !== "message") return; const h = map.get(fn); if (h) wsBus.removeEventListener("message", h); },
    send(data) { try { if (_liveWs && _liveWs.readyState === 1) _liveWs.send(data); } catch (e) {} },
    get readyState() { return _liveWs ? _liveWs.readyState : 3; },
  };
}

/* session token lives here once logged in */
let TOKEN = LSget("turd_token", "") || "";
export function token() { return TOKEN; }
export function clearToken() { TOKEN = ""; LSset("turd_token", ""); }

/* connection details the browser can report about itself (for the admin log) */
function clientInfo() {
  try {
    return {
      screen: `${screen.width}x${screen.height}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      lang: navigator.language || "",
    };
  } catch (e) { return {}; }
}

async function post(pathname, body, auth) {
  const headers = { "content-type": "application/json" };
  if (auth && TOKEN) headers.authorization = "Bearer " + TOKEN;
  const r = await httpFetch(endpoint() + pathname, { method: "POST", headers, body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ...j };
}

/* ---- auth API used by core.js (returns the shell's {ok,fresh,role} shape) ---- */
export async function login(user, pw) {
  const j = await post("/api/login", { user, pw, client: clientInfo() });
  if (j.ok && j.token) { TOKEN = j.token; LSset("turd_token", TOKEN); }
  return { ok: !!j.ok, fresh: !!j.fresh, role: j.role || "user", token: j.token || "" };
}
export async function register(user, pw) {
  const j = await post("/api/register", { user, pw, client: clientInfo() });
  if (j.ok && j.token) { TOKEN = j.token; LSset("turd_token", TOKEN); }
  return j;
}
export async function setPass(user, pw) {
  const j = await post("/api/setpass", { pw }, true);
  if (j.ok && j.token) { TOKEN = j.token; LSset("turd_token", TOKEN); }
  return j;
}
export async function createUser(user, pw, role) {
  return await post("/api/users", { user, pw, role: role || "user" }, true);
}
export async function auditHTML() {
  if (!TOKEN) return "";
  try {
    const r = await httpFetch(endpoint() + "/api/audit", { headers: { authorization: "Bearer " + TOKEN } });
    if (!r.ok) return "";
    const j = await r.json();
    return j.ok ? j.html : "";
  } catch (e) { return ""; }
}
export async function logout() {
  try { await post("/api/logout", {}, true); } catch (e) {}   // best-effort server revoke
  clearToken();
}
export async function health() {
  try { const r = await httpFetch(endpoint() + "/api/health"); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

/* ---- Quick Drop: send a link/text/photo/file between the user's own devices ---- */
export async function dropList() {
  try { const r = await httpFetch(endpoint() + "/api/drop", { headers: { authorization: "Bearer " + TOKEN } }); return r.ok ? ((await r.json()).drops || []) : []; } catch (e) { return []; }
}
export async function dropText(kind, text) { return await post("/api/drop", { kind, text }, true); }
export async function dropUpload(name, mime, blob) {
  try {
    const r = await httpFetch(endpoint() + "/api/drop/file?name=" + encodeURIComponent(name) + "&mime=" + encodeURIComponent(mime),
      { method: "POST", headers: { authorization: "Bearer " + TOKEN }, body: blob });
    return r.ok ? await r.json() : { ok: false, error: "upload failed (" + r.status + ")" };
  } catch (e) { return { ok: false, error: "upload failed" }; }
}
export async function dropFetch(id) { return await httpFetch(endpoint() + "/api/drop/file/" + encodeURIComponent(id), { headers: { authorization: "Bearer " + TOKEN } }); }
export async function dropDelete(id) {
  try { const r = await httpFetch(endpoint() + "/api/drop/" + encodeURIComponent(id), { method: "DELETE", headers: { authorization: "Bearer " + TOKEN } }); return r.ok; } catch (e) { return false; }
}
// live drop pushes ride the shared chat WS; subscribe to the frame bus and filter
export function onDrop(cb) {
  const h = e => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (d && d.type === "drop") cb(d); };
  wsBus.addEventListener("message", h);
  return () => wsBus.removeEventListener("message", h);
}

/* ===========================================================================
   Realtime chat socket. Emits events via a tiny on()/off() bus.
   =========================================================================== */
export function connectChat() {
  const bus = new EventTarget();
  const api = {
    sock: null, ready: false, closedByUs: false, retry: 0,
    on(ev, fn) { const h = e => fn(e.detail); bus.addEventListener(ev, h); return () => bus.removeEventListener(ev, h); },
    send(text) { this._raw({ type: "msg", text }); },
    typing() { this._raw({ type: "typing" }); },
    _raw(o) { try { if (this.ready) this.sock.send(JSON.stringify(o)); } catch (e) {} },
    close() { this.closedByUs = true; try { this.sock && this.sock.close(); } catch (e) {} },
    _url() {
      const ep = endpoint();
      const wsBase = ep.replace(/^http/, "ws");
      const c = clientInfo();
      const q = new URLSearchParams({ token: TOKEN, screen: c.screen || "", tz: c.tz || "", lang: c.lang || "" });
      return `${wsBase}/ws?${q}`;
    },
    _open() {
      let s; try { s = new WebSocket(this._url()); } catch (e) { bus.dispatchEvent(new CustomEvent("error", { detail: e })); return; }
      this.sock = s; _liveWs = s;
      s.onopen = () => { this.ready = true; this.retry = 0; bus.dispatchEvent(new CustomEvent("open", {})); };
      s.onmessage = e => {
        try { wsBus.dispatchEvent(new MessageEvent("message", { data: e.data })); } catch (x) { wsBus.dispatchEvent(Object.assign(new Event("message"), { data: e.data })); }
        let d; try { d = JSON.parse(e.data); } catch (x) { return; }
        bus.dispatchEvent(new CustomEvent(d.type || "msg", { detail: d }));
      };
      s.onclose = () => {
        this.ready = false; if (_liveWs === s) _liveWs = null; bus.dispatchEvent(new CustomEvent("close", {}));
        if (!this.closedByUs) { this.retry = Math.min(this.retry + 1, 6); setTimeout(() => this._open(), 600 * this.retry); }
      };
      s.onerror = () => bus.dispatchEvent(new CustomEvent("error", {}));
    },
  };
  api._open();
  return api;
}

/* Community calendar hook: calendar.js calls this when configured(). We hand its
   remoteTransport factory the API base, our token, and a reconnect-safe socket
   proxy that surfaces {type:"cal"} frames from the shared chat WebSocket. */
export async function calendarTransport(make) {
  return make({ base: endpoint(), token: TOKEN, socket: chatSocketProxy() });
}

export default { endpoint, setEndpoint, configured, ensureEndpoint, lastEndpoint, login, register, setPass, createUser, logout, auditHTML, health, dropList, dropText, dropUpload, dropFetch, dropDelete, onDrop, connectChat, calendarTransport, chatSocketProxy, token, clearToken };
