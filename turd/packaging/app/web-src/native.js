// ===========================================================================
// T.U.R.D. NATIVE BRIDGE: one API over the Windows app (Tauri) and the Android
// app (Capacitor). Loaded as a classic script before core.js. In a plain browser it
// does nothing, and window.TURD_NATIVE stays undefined, so sections feature-detect:
//
//   const N = window.TURD_NATIVE;  if(N){ ... }
//
//   N.platform                      "windows" | "android"
//   N.http(url, opts)               CORS-free fetch → Response (also window.TURD_HTTP)
//   N.on(event, fn) → off()         "extras:progress" {id, received, total, line?, state}
//                                   "server:log" {line}   (Windows chat host)
//   N.openExternal(url)             system browser / Play / F-Droid / any app link
//   N.info()                        {platform, version, device, freeBytes}
//
//   N.radar.permissions()           {wifi, ble} → "granted" | "denied" | "prompt"
//   N.radar.request()               asks for the scan permissions, → same shape
//   N.radar.wifi()                  [{ssid, bssid, rssi, freq, channel, secure}]
//   N.radar.ble({ms})               [{name, id, rssi}]   (scans for ms, default 6000)
//
//   N.extras.info({dir?})           {dir, freeBytes, totalBytes, platform}
//   N.extras.dirs()                 [{path, label, freeBytes, totalBytes, removable}]
//   N.extras.pickDir()              {path} | null   (Windows folder picker; Android → dirs())
//   N.extras.list({dir?})           [{id, name, size, path, mtime, partial}]
//   N.extras.download({id,url,name,sha256?,dir?})  → {id, path, size}; resumes a .part
//   N.extras.cancel(id) / remove(id)
//   N.extras.open(id)               launch .exe/.msi, APK installer, or default viewer
//   N.extras.readText(id)           small text files
//   N.extras.readRange(id, off, len) → Uint8Array (≤16 MB per call, 64-bit-safe offsets)
//   N.extras.unzip(id)              → {dir}
//   N.extras.isInstalled(ids[])     {id: version | null}   (Android pkgs / winget ids)
//   N.extras.launch(pkg)            Android: start an installed app
//   N.extras.winget(id)             Windows: silent winget install → {ok, code}
//   N.extras.spawn(path, args[])    Windows: → {pid}      N.extras.kill(pid)
//
//   N.net.info()                    {wifi, addrs:[{ip, prefix}]}   this device on the LAN
//   N.findServer({port?, timeoutMs?}) → {url, version, host?} | null
//                                   scans this device's /24 for a T.U.R.D. chat server
//   N.wake(mac?)                    Wake-on-LAN magic packet → {ok, sent}; with no mac uses
//                                   the PC learned from the server (localStorage turd_wake)
//   N.wakeTarget()                  {mac, name, url} | null   the PC that wake() will wake
//
//   N.recon.ports({host,ports,timeoutMs}) [{port, open, service}] — TCP scan of a host on your LAN
//   N.bt.batteries()                [{name, kind:"controller"|"earbuds"|"headset"|"other", level, charging?}]
//   N.netwatch                      request() / scan() -> [{ip, mac, vendor, hostname, gateway, self}]
//   N.vendorOf(mac)                 offline OUI vendor lookup
//   N.device (Android)              status() battery/charging/storage, report() to the PC,
//                                   background(on) ~30-min reports while the app is closed
//   N.server (Windows only)         host the chat server on this PC (allowLan(): firewall rule)
//     .status() {running, port, urls[], autostart}   .start({port?})   .stop()
//     .setAutostart(bool)
// ===========================================================================
(function(){
  "use strict";
  if (window.TURD_NATIVE) return;
  var T = window.__TAURI_INTERNALS__;
  var C = window.Capacitor;
  var kind = (T && typeof T.invoke === "function") ? "windows"
           : (C && C.isNativePlatform && C.isNativePlatform()) ? "android" : null;
  if (!kind) return;

  var P = null;
  if (kind === "android") { try { P = C.registerPlugin("TurdNative"); } catch (e) { return; } }

  function call(method, args){
    args = args || {};
    if (kind === "windows") return T.invoke("nat_" + method.replace(/[A-Z]/g, function(c){ return "_" + c.toLowerCase(); }), { a: args });
    return P[method](args);
  }
  // Capacitor resolves objects only, so list-shaped results come back as {items:[...]} / {map:{...}}
  function items(r){ return r && Array.isArray(r.items) ? r.items : (Array.isArray(r) ? r : []); }
  function map(r){ return r && r.map ? r.map : (r || {}); }

  function on(evt, fn){
    var off = null, dead = false;
    if (kind === "windows") {
      var ev = window.__TAURI__ && window.__TAURI__.event;
      if (ev) ev.listen(evt, function(e){ fn(e.payload); }).then(function(u){ if (dead) u(); else off = u; });
    } else {
      P.addListener(evt, fn).then(function(h){ if (dead) h.remove(); else off = function(){ h.remove(); }; });
    }
    return function(){ dead = true; if (off) try { off(); } catch (e) {} };
  }

  /* ---------------------------------------------------------- http */
  function b64ToBytes(s){ var bin = atob(s || ""), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(u8){ var s = "", CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  async function bodyB64(body){
    if (body == null) return null;
    if (typeof body === "string") return bytesToB64(new TextEncoder().encode(body));
    if (body instanceof URLSearchParams) return bytesToB64(new TextEncoder().encode(body.toString()));
    if (body instanceof ArrayBuffer) return bytesToB64(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) return bytesToB64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    if (body instanceof Blob) return bytesToB64(new Uint8Array(await body.arrayBuffer()));
    return bytesToB64(new TextEncoder().encode(String(body)));
  }
  async function http(input, opts){
    opts = opts || {};
    var url = typeof input === "string" ? input : (input && input.url) || String(input);
    try { url = new URL(url, location.href).href; } catch (e) {}
    // local files and our own origin go through the normal fetch
    if (!/^https?:/i.test(url) || url.indexOf(location.origin) === 0) return fetch(input, opts);
    var headers = {};
    if (opts.headers) {
      if (typeof Headers !== "undefined" && opts.headers instanceof Headers) opts.headers.forEach(function(v, k){ headers[k] = v; });
      else if (Array.isArray(opts.headers)) opts.headers.forEach(function(kv){ headers[kv[0]] = kv[1]; });
      else Object.keys(opts.headers).forEach(function(k){ headers[k] = String(opts.headers[k]); });
    }
    var sig = opts.signal;
    if (sig && sig.aborted) throw new DOMException("Aborted", "AbortError");
    var req = call("http", {
      url: url, method: (opts.method || "GET").toUpperCase(), headers: headers,
      body: await bodyB64(opts.body), timeoutMs: opts.timeoutMs || 30000,
      follow: opts.redirect !== "manual" && opts.redirect !== "error",
    });
    var r = await (sig ? Promise.race([req, new Promise(function(_, rej){ sig.addEventListener("abort", function(){ rej(new DOMException("Aborted", "AbortError")); }, { once: true }); })]) : req);
    var status = r.status | 0;
    if (status < 200 || status > 599) status = status >= 100 && status < 200 ? 200 : 599;
    var nullBody = status === 204 || status === 205 || status === 304 || (opts.method || "").toUpperCase() === "HEAD";
    var res = new Response(nullBody ? null : b64ToBytes(r.body), { status: status, statusText: r.statusText || "", headers: r.headers || {} });
    try { Object.defineProperty(res, "url", { value: r.url || url }); } catch (e) {}
    return res;
  }

  var N = {
    platform: kind,
    http: http,
    on: on,
    info: function(){ return call("info"); },
    openExternal: function(url){ return call("openExternal", { url: url }); },
    radar: {
      permissions: function(){ return call("radarPermissions"); },
      request: function(){ return call("radarRequest"); },
      wifi: function(){ return call("wifiScan").then(items); },
      ble: function(o){ return call("bleScan", { ms: (o && o.ms) || 6000 }).then(items); },
    },
    extras: {
      info: function(o){ return call("extrasInfo", o || {}); },
      dirs: function(){ return call("extrasDirs").then(items); },
      pickDir: function(){ return call("extrasPickDir").then(function(r){ return r && r.path ? r : null; }); },
      list: function(o){ return call("extrasList", o || {}).then(items); },
      download: function(o){ return call("extrasDownload", o); },
      cancel: function(id){ return call("extrasCancel", { id: id }); },
      remove: function(id){ return call("extrasRemove", { id: id }); },
      open: function(id){ return call("extrasOpen", { id: id }); },
      readText: function(id){ return call("extrasReadText", { id: id }).then(function(r){ return r.text; }); },
      readRange: function(id, offset, length){ return call("extrasReadRange", { id: id, offset: offset, length: length }).then(function(r){ return b64ToBytes(r.data); }); },
      unzip: function(id){ return call("extrasUnzip", { id: id }); },
      isInstalled: function(ids){ return call("isInstalled", { ids: ids || [] }).then(map); },
      launch: function(pkg){ return call("launch", { pkg: pkg }); },
      winget: function(id){ return call("winget", { id: id }); },
      spawn: function(p, args){ return call("spawn", { path: p, args: args || [] }); },
      kill: function(pid){ return call("kill", { pid: pid }); },
      openExternal: function(url){ return call("openExternal", { url: url }); },
    },
  };
  /* ---------------------------------------------------------- LAN: find the PC, wake the PC */
  function lsGet(k){ try { var v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }
  function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  async function health(url, ms){
    try {
      var r = await http(url.replace(/\/+$/, "") + "/api/health", { timeoutMs: ms || 1500 });
      if (!r.ok) return null;
      var j = await r.json();
      return j && j.ok ? j : null;
    } catch (e) { return null; }
  }
  // the server reports the PC it runs on (Windows app passes TURD_HOST_MAC); keep it for Wake PC
  function learnHost(url, j){
    if (j && j.host && j.host.mac) lsSet("turd_wake", { mac: j.host.mac, name: j.host.name || "PC", url: url, t: Date.now() });
  }
  N.net = { info: function(){ return call("netInfo"); } };
  N.findServer = async function(o){
    o = o || {};
    var port = o.port || 8787, ms = o.timeoutMs || 900;
    var info = await N.net.info().catch(function(){ return { addrs: [] }; });
    var cands = [];
    (info.addrs || []).forEach(function(a){
      var p = a.ip.split(".").map(Number); if (p.length !== 4) return;
      for (var i = 1; i < 255; i++) if (i !== p[3]) cands.push(p[0] + "." + p[1] + "." + p[2] + "." + i);
    });
    var found = null, idx = 0;
    async function worker(){
      while (!found && idx < cands.length) {
        var url = "http://" + cands[idx++] + ":" + port, j = await health(url, ms);
        if (j && !found) { found = { url: url, version: j.version, host: j.host || null }; learnHost(url, j); }
      }
    }
    var ws = []; for (var w = 0; w < 32; w++) ws.push(worker());
    await Promise.all(ws);
    return found;
  };
  // Fold status on the PC (battery, charging, storage, last seen): see server/devstatus.js
  N.device = {
    status: function(){ return call("deviceStatus"); },
    report: async function(){
      var url = lsGet("turd_uplink"), tok = lsGet("turd_token");
      if (!url || !tok) return { ok: false, reason: "not signed in to a chat server" };
      var st = await call("deviceStatus");
      var r = await http(url.replace(/\/+$/, "") + "/api/devstatus", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify(st), timeoutMs: 5000 });
      return { ok: r.ok, status: r.status };
    },
    background: function(on){
      return call("statusReporter", { url: lsGet("turd_uplink") || "", token: lsGet("turd_token") || "", enabled: on !== false, minutes: 30 });
    },
  };
  // Home network watch: who is on this Wi-Fi. Rows {ip, mac, vendor, hostname, gateway, self, rttMs?}.
  // Vendors come from the bundled offline IEEE OUI table (src/data/oui.json, ~780 KB, loaded once).
  // On the Fold, Android hides MAC addresses from apps, so mac/vendor are often "" there
  // (Windows PCs still report theirs through NetBIOS).
  var ouiP = null;
  function oui(){
    if (!ouiP) ouiP = fetch(new URL("src/data/oui.json", document.baseURI)).then(function(r){ return r.json(); }).then(function(j){
      var m = new Map(); j.m.split(";").forEach(function(e){ m.set(e.slice(0, 6), j.v[parseInt(e.slice(6), 16)]); }); return m;
    }).catch(function(){ ouiP = null; return new Map(); });
    return ouiP;
  }
  N.vendorOf = async function(mac){
    var hex = String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    if (hex.length < 6) return "";
    if (parseInt(hex.slice(0, 2), 16) & 2) return "Private (randomized) address";
    return (await oui()).get(hex.slice(0, 6)) || "";
  };
  async function withVendors(rows){
    for (var i = 0; i < rows.length; i++) if (rows[i].mac && !rows[i].vendor) rows[i].vendor = await N.vendorOf(rows[i].mac);
    return rows;
  }
  N.netwatch = {
    request: function(){ return call("netwatchRequest"); },
    scan: function(){ return call("netwatchScan").then(function(r){ return withVendors(items(r)); }); },
    // the same scan plus {devices (= items), subnet, gateway, macs:boolean (false = this OS hides MAC addresses)}
    scanFull: function(){ return call("netwatchScan").then(async function(r){ r.items = await withVendors(items(r)); r.devices = r.items; return r; }); },
  };
  // Battery of already-connected Bluetooth gadgets (controller, earbuds, headset). Read-only:
  // no scan, no pairing, no new permission. Returns [] when nothing reports a level. (Windows reads
  // the GATT Battery Service; Android reads connected bonded devices, needs BLUETOOTH_CONNECT.)
  N.bt = { batteries: function(){ return call("btBatteries").then(items); } };
  // Spy tools recon: bounded TCP connect scan of one host on your own network.
  // recon.ports({host, ports?[], timeoutMs?}) -> [{port, open:true, service}] (only open ports returned).
  N.recon = {
    ports: function(o){
      o = o || {};
      return call("portScan", { host: o.host, ports: o.ports, timeoutMs: o.timeoutMs }).then(function(r){
        return items(r).map(function(x){ return { port: x.port, open: true, service: x.service || "" }; });
      });
    },
  };
  N.wakeTarget = function(){ return lsGet("turd_wake"); };
  N.wake = function(mac){
    var t = lsGet("turd_wake");
    mac = mac || (t && t.mac);
    if (!mac) return Promise.reject(new Error("No PC paired yet. Open Chat once while the PC is on, or enter its MAC address."));
    return call("wakeOnLan", { mac: mac });
  };

  if (kind === "windows") N.server = {
    status: function(){ return call("serverStatus"); },
    start: function(o){ return call("serverStart", o || {}); },
    stop: function(){ return call("serverStop"); },
    setAutostart: function(on){ return call("serverAutostart", { on: !!on }); },
    allowLan: function(){ return call("serverFirewall"); },   // one admin prompt: firewall rule, local network only
  };

  // Windows: F11 toggles true fullscreen (the visor with no window chrome)
  if (kind === "windows") addEventListener("keydown", function(e){
    if (e.key === "F11") { e.preventDefault(); call("fullscreen").catch(function(){}); }
  });

  // wake word model: the apps carry it as .tgz (scripts/prepare-web.mjs renames it, because
  // Android's asset packer unpacks *.gz). web/src/voice/wake.js reads this.
  window.TURD_VOSK_MODEL = "en-us-small-0.15.tgz";
  window.TURD_NATIVE = N;
  window.TURD_HTTP = http;
  document.documentElement.dataset.native = kind;

  // Android: if no chat server is linked (or the saved one stopped answering), look for the
  // PC on this Wi-Fi and link it. Announced with a "turd:uplink" event for open sections.
  if (kind === "android") setTimeout(async function(){
    try {
      var cur = lsGet("turd_uplink");
      if (cur) { var j = await health(cur, 2500); if (j) { learnHost(cur, j); return; } }
      var f = await N.findServer();
      if (f && f.url !== cur) {
        lsSet("turd_uplink", f.url);
        window.dispatchEvent(new CustomEvent("turd:uplink", { detail: f }));
      }
    } catch (e) {}
  }, 1200);

  // Android: keep the PC's "Fold status" card current. Reports on open, on resume, when
  // charging flips or the battery moves 5%, every 5 min while open, and every ~30 min in the
  // background (JobScheduler, network only). Turn off with localStorage turd_devstatus = false.
  if (kind === "android") (function(){
    var last = 0, bgKey = "";
    function enabled(){ return lsGet("turd_devstatus") !== false; }
    async function tick(force){
      if (!enabled() || (!force && Date.now() - last < 60e3)) return;
      var url = lsGet("turd_uplink"), tok = lsGet("turd_token");
      if (!url || !tok) return;
      last = Date.now();
      try { await N.device.report(); } catch (e) {}
      var k = url + "|" + tok;
      if (k !== bgKey) { bgKey = k; N.device.background(true).catch(function(){}); }
    }
    setTimeout(function(){ tick(true); }, 4000);
    setInterval(function(){ if (!document.hidden) tick(true); }, 5 * 60e3);
    document.addEventListener("visibilitychange", function(){ if (!document.hidden) tick(false); });
    window.addEventListener("turd:uplink", function(){ setTimeout(function(){ tick(true); }, 1500); });
    // signing in happens in this window (no "storage" event), so notice a new token cheaply
    setInterval(function(){ var t = lsGet("turd_token"), u = lsGet("turd_uplink"); if (t && u && (u + "|" + t) !== bgKey) tick(true); }, 20e3);
    N.on("device:status", function(){ tick(true); });
    if (!enabled()) N.device.background(false).catch(function(){});
  })();

  // Windows host mode: if this PC hosts the chat server and no server address was
  // chosen yet, point the app at it so login and chat work immediately.
  if (N.server) N.server.status().then(function(s){
    try {
      if (s && s.running && !localStorage.getItem("turd_uplink")) {
        localStorage.setItem("turd_uplink", JSON.stringify("http://127.0.0.1:" + s.port));
      }
    } catch (e) {}
  }).catch(function(){});
})();
