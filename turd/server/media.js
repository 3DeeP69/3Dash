// ===========================================================================
// T.U.R.D. NOW PLAYING — optional module for server.js (owned by the
// entertainment thread). Zero dependencies, free, Windows built-ins only.
//
//   require("./media.js").attach(api, { readToken, bearer, body, send, audit });
//
// What's playing comes from Windows' own media controls (the same source as the
// volume flyout: Spotify, YouTube in any browser, VLC, Windows Media Player...).
// Sound levels for the visualizer come from the default speaker's peak meter
// (IAudioMeterInformation): no audio is recorded, it's one number per channel.
//
// GET  /api/media           (admin)  { ok, supported, host, playing, status, title, artist, album, app, appId,
//                                      position, duration, at, art:<rev or 0> }
// GET  /api/media/art?rev=  (admin)  album art image for the current track
// GET  /api/media/stream    (admin)  Server-Sent Events: "info" on change, "level" [peak,l,r] ~20/s while playing
// POST /api/media/control   (admin)  { action: "toggle"|"play"|"pause"|"next"|"prev" }
//
// Cost: one hidden powershell.exe is started on first use and closed again after
// 2 minutes with nobody looking. Levels are only sampled while a stream is open.
// Test overrides: TURD_MEDIA_MOCK=1 fakes a player (any OS); TURD_MEDIA_PS / TURD_MEDIA_SCRIPT swap the helper.
// ===========================================================================
"use strict";
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const WIN = process.platform === "win32";
const MOCK = process.env.TURD_MEDIA_MOCK === "1";
const PS = process.env.TURD_MEDIA_PS || "";            // tests: another PowerShell (pwsh) ...
const PS_SCRIPT = process.env.TURD_MEDIA_SCRIPT || "";  // ... and/or another helper script

/* ---------------------------------------------------------------- the PowerShell helper */
// Kept inline so the single-file server build carries it. Line protocol:
// stdin: info | art | lv | toggle | play | pause | next | prev | quit
// stdout: one JSON object per line ({t:"info"...} {t:"art"...} {t:"lv",v:[peak,l,r]} {t:"ok"} {t:"err"})
const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Out($o){ [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

# ---- speaker peak meter (Core Audio COM), compiled once
$meterOk = $false
try {
Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices;
namespace TurdAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
    [PreserveSig] int GetMeteringChannelCount(out int count);
    [PreserveSig] int GetChannelsPeakValues(int count, [In, Out, MarshalAs(UnmanagedType.LPArray)] float[] peaks);
  }
  public static class Meter {
    static IAudioMeterInformation m; static DateTime got = DateTime.MinValue;
    static void Acquire() {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));   // eRender, eMultimedia
      Guid iid = typeof(IAudioMeterInformation).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));               // CLSCTX_ALL
      m = (IAudioMeterInformation)o; got = DateTime.UtcNow;
    }
    // [peak, left, right]; re-acquires every 10s so a headset switch is followed
    public static float[] Read() {
      try {
        if (m == null || (DateTime.UtcNow - got).TotalSeconds > 10) Acquire();
        float p; m.GetPeakValue(out p);
        int n; m.GetMeteringChannelCount(out n);
        float l = p, r = p;
        if (n >= 2) { var c = new float[n]; if (m.GetChannelsPeakValues(n, c) == 0) { l = c[0]; r = c[1]; } }
        return new float[] { p, l, r };
      } catch { m = null; return new float[] { -1, -1, -1 }; }
    }
  }
}
'@
$meterOk = $true
} catch { Out @{ t='warn'; msg="meter: $($_.Exception.Message)" } }

# ---- media session (WinRT)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskG = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') })[0]
function Await($op, [Type]$type){ $t = $asTaskG.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(5000); $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$Mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Session(){
  # prefer whatever is actually playing over Windows' "current" pick
  $all = @($Mgr.GetSessions())
  foreach($s in $all){ try { if($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'){ return $s } } catch {} }
  $c = $Mgr.GetCurrentSession(); if($c){ return $c }
  if($all.Count){ return $all[0] }
  return $null
}
$script:last = $null
function Info(){
  $s = Session
  if(-not $s){ $script:last = $null; return @{ t='info'; playing=$false; status='none' } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pi = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
  $script:last = $p
  $st = $pi.PlaybackStatus.ToString()
  $c = $pi.Controls
  return @{ t='info'; playing=($st -eq 'Playing'); status=$st.ToLower(); title=[string]$p.Title; artist=[string]$p.Artist; album=[string]$p.AlbumTitle
    appId=[string]$s.SourceAppUserModelId; position=[math]::Round($tl.Position.TotalSeconds,1); duration=[math]::Round($tl.EndTime.TotalSeconds,1)
    updated=[math]::Round(($tl.LastUpdatedTime.ToUnixTimeMilliseconds()),0); hasArt=($null -ne $p.Thumbnail)
    canNext=[bool]$c.IsNextEnabled; canPrev=[bool]$c.IsPreviousEnabled; canPause=[bool]$c.IsPauseEnabled; canPlay=[bool]$c.IsPlayEnabled }
}
function Art(){
  $p = $script:last
  if(-not $p -or -not $p.Thumbnail){ return @{ t='art'; b64='' } }
  $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $st = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
  $ms = New-Object System.IO.MemoryStream; $st.CopyTo($ms); $st.Dispose()
  return @{ t='art'; type=[string]$ras.ContentType; b64=[Convert]::ToBase64String($ms.ToArray()) }
}
function Ctl($a){
  $s = Session; if(-not $s){ return @{ t='err'; msg='nothing is playing' } }
  $op = switch($a){ 'toggle' { $s.TryTogglePlayPauseAsync() } 'play' { $s.TryPlayAsync() } 'pause' { $s.TryPauseAsync() } 'next' { $s.TrySkipNextAsync() } 'prev' { $s.TrySkipPreviousAsync() } }
  $ok = Await $op ([bool])
  return @{ t='ok'; ok=[bool]$ok }
}

Out @{ t='ready'; meter=$meterOk }
$inv = [Globalization.CultureInfo]::InvariantCulture
# plain blocking reads: the server asks for levels (~20/s) only while someone is watching
while($true){
  $cmd = [Console]::In.ReadLine()
  if($null -eq $cmd -or $cmd -eq 'quit'){ break }
  try {
    switch -regex ($cmd){
      '^lv$' {
        if($meterOk){ $v = [TurdAudio.Meter]::Read() } else { $v = @(-1,-1,-1) }
        $j = ($v | ForEach-Object { ([math]::Round([double]$_, 3)).ToString($inv) }) -join ','
        [Console]::Out.WriteLine('{"t":"lv","v":[' + $j + ']}'); [Console]::Out.Flush()
      }
      '^info$' { Out (Info) }
      '^art$'  { Out (Art) }
      '^(toggle|play|pause|next|prev)$' { Out (Ctl $cmd) }
    }
  } catch { Out @{ t='err'; msg=$_.Exception.Message } }
}
`;

/* ---------------------------------------------------------------- helper process */
let proc = null, buf = "", waiters = [], ready = null, idleT = null, F = null, levelSubs = 0;
const levelListeners = new Set();
function helperPath() {
  if (PS_SCRIPT) return PS_SCRIPT;
  const p = F("media-helper.ps1");
  try { if (fs.readFileSync(p, "utf8") === HELPER) return p; } catch (e) {}
  fs.writeFileSync(p, "\ufeff" + HELPER);   // BOM: Windows PowerShell 5.1 reads UTF-8 only with one
  return p;
}
function start() {
  if (proc) return ready;
  const exe = PS || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  proc = spawn(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath()],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  buf = "";
  ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("media helper did not start")), 20000);
    waiters.push({ want: "ready", resolve: v => { clearTimeout(to); resolve(v); }, reject });
  });
  ready.catch(() => {});
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", d => {
    buf += d; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      if (m.t === "warn") { console.log("[media]", m.msg); continue; }
      const w = waiters.findIndex(x => x.want === m.t || (m.t === "err" && x.want !== "ready"));
      if (w >= 0) { const [x] = waiters.splice(w, 1); m.t === "err" ? x.reject(new Error(m.msg)) : x.resolve(m); }
    }
  });
  proc.stderr.on("data", d => { const s = String(d).trim(); if (s) console.log("[media] helper:", s.slice(0, 300)); });
  proc.on("exit", () => { proc = null; ready = null; waiters.splice(0).forEach(w => w.reject(new Error("media helper stopped"))); });
  return ready;
}
function stop() { if (proc) { try { proc.stdin.write("quit\n"); } catch (e) {} setTimeout(() => { try { proc && proc.kill(); } catch (e) {} }, 1500); } }
function touch() { clearTimeout(idleT); idleT = setTimeout(() => { if (!levelSubs) stop(); }, 120e3); idleT.unref && idleT.unref(); }
// one request at a time keeps replies in order
let chain = Promise.resolve();
function ask(cmd, want) {
  const run = async () => {
    await start(); touch();
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error("media helper timed out")); }, 8000);
      const w = { want, resolve: v => { clearTimeout(to); resolve(v); }, reject: e => { clearTimeout(to); reject(e); } };
      waiters.push(w); proc.stdin.write(cmd + "\n");
    });
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
// visualizer levels: polled ~20/s while a stream is open, skipped if the helper is busy (art, info)
let lvT = null, lvBusy = false;
function levels(on) {
  clearInterval(lvT); lvT = null; if (!on) return;
  lvT = setInterval(() => {
    if (lvBusy || !cur.playing) return; lvBusy = true;
    ask("lv", "lv").then(m => { if (m.v && m.v[0] >= 0) levelListeners.forEach(f => f(m.v)); }).catch(() => {}).finally(() => { lvBusy = false; });
  }, 50);
}

/* ---------------------------------------------------------------- mock player (tests / non-Windows demo) */
const mock = {
  tracks: [
    { title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming", appId: "Spotify.exe", duration: 243 },
    { title: "Lo-fi beats to code to", artist: "Chill Ops", album: "", appId: "MSEdge", duration: 3600 },
    { title: "Resonance", artist: "HOME", album: "Odyssey", appId: "Spotify.exe", duration: 212 },
  ], i: 0, playing: true, pos: 37, at: Date.now(),
  now() { return this.playing ? this.pos + (Date.now() - this.at) / 1000 : this.pos; },
  info() { const t = this.tracks[this.i]; return { t: "info", playing: this.playing, status: this.playing ? "playing" : "paused", ...t,
    position: Math.round(this.now() * 10) / 10, updated: Date.now(), hasArt: true, canNext: true, canPrev: true, canPause: true, canPlay: true }; },
  ctl(a) {
    this.pos = this.now(); this.at = Date.now();
    if (a === "toggle") this.playing = !this.playing; if (a === "play") this.playing = true; if (a === "pause") this.playing = false;
    if (a === "next" || a === "prev") { this.i = (this.i + (a === "next" ? 1 : this.tracks.length - 1)) % this.tracks.length; this.pos = 0; this.playing = true; }
    return { t: "ok", ok: true };
  },
  art() {
    const t = this.tracks[this.i], h = [200, 330, 20][this.i];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><radialGradient id="g" cx=".3" cy=".25" r=".9"><stop offset="0" stop-color="hsl(${h},90%,65%)"/><stop offset=".6" stop-color="hsl(${h + 40},70%,25%)"/><stop offset="1" stop-color="#05070d"/></radialGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="210" cy="200" r="70" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/><text x="24" y="270" font-family="sans-serif" font-weight="700" font-size="30" fill="#fff">${t.artist}</text></svg>`;
    return { t: "art", type: "image/svg+xml", b64: Buffer.from(svg).toString("base64") };
  },
};
let mockT = null;
function mockLevels(on) {
  clearInterval(mockT); mockT = null; if (!on) return;
  let ph = 0;
  mockT = setInterval(() => {
    if (!mock.playing) return;
    ph += 0.05; const beat = Math.pow(Math.max(0, Math.sin(ph * 7.5)), 6), base = 0.35 + 0.15 * Math.sin(ph * 1.3);
    const l = Math.min(1, base + beat * 0.5 + Math.random() * 0.08), r = Math.min(1, base + beat * 0.45 + Math.random() * 0.08);
    levelListeners.forEach(f => f([Math.max(l, r), l, r]));
  }, 50);
}

/* ---------------------------------------------------------------- shared state */
const APPS = [[/spotify/i, "Spotify"], [/chrome/i, "Chrome"], [/msedge|edge/i, "Edge"], [/firefox/i, "Firefox"], [/opera/i, "Opera"], [/brave/i, "Brave"],
  [/vlc/i, "VLC"], [/zunemusic|music\.ui|media ?player/i, "Media Player"], [/foobar/i, "foobar2000"], [/itunes|applemusic/i, "Apple Music"],
  [/tidal/i, "TIDAL"], [/deezer/i, "Deezer"], [/amazon/i, "Amazon Music"], [/discord/i, "Discord"], [/turd|tauri/i, "T.U.R.D."]];
const appName = id => { for (const [re, n] of APPS) if (re.test(id || "")) return n; return (id || "").replace(/\.exe$/i, "").split(/[!\\/]/).pop() || "Media"; };

let cur = { playing: false, status: "none", art: 0 }, artCache = { rev: 0, type: "", buf: null }, rev = 0, lastKey = "";
async function getInfo() {
  const m = MOCK ? mock.info() : await ask("info", "info");
  const key = [m.title, m.artist, m.album, m.appId].join("\u0001");
  if (key !== lastKey) { lastKey = key; rev++; artCache = { rev: 0, type: "", buf: null }; }
  // Windows only refreshes the timeline now and then; send when it was true so clients extrapolate
  const at = m.updated && m.updated > 0 ? m.updated : Date.now();
  cur = { playing: !!m.playing, status: m.status || "none", title: m.title || "", artist: m.artist || "", album: m.album || "",
    app: appName(m.appId), appId: m.appId || "", position: m.position || 0, duration: m.duration || 0, at,
    art: m.hasArt ? rev : 0, can: { next: m.canNext !== false, prev: m.canPrev !== false, pause: m.canPause !== false, play: m.canPlay !== false } };
  return cur;
}
async function getArt(r) {
  if (artCache.buf && artCache.rev === rev) return artCache;
  const a = MOCK ? mock.art() : await ask("art", "art");
  if (!a.b64) return null;
  artCache = { rev, type: a.type || "image/jpeg", buf: Buffer.from(a.b64, "base64") };
  return artCache;
}

/* ---------------------------------------------------------------- SSE stream */
const streams = new Set();
let infoT = null;
function sse(res, ev, data) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} }
function onLevel(v) { if (!cur.playing) return; const r = v.map(x => Math.round(x * 1000) / 1000); for (const s of streams) sse(s, "level", r); }
async function infoTick() {
  try {
    const before = JSON.stringify([cur.title, cur.artist, cur.playing, cur.status, cur.art, Math.round(cur.position)]);
    await getInfo();
    const after = JSON.stringify([cur.title, cur.artist, cur.playing, cur.status, cur.art, Math.round(cur.position)]);
    if (before !== after) for (const s of streams) sse(s, "info", cur);
  } catch (e) {}
}
function streamsChanged() {
  const n = streams.size;
  if (n && !infoT) { infoT = setInterval(infoTick, 1500); levelListeners.add(onLevel); MOCK ? mockLevels(true) : levels(true); levelSubs = n; }
  else if (!n && infoT) { clearInterval(infoT); infoT = null; levelListeners.delete(onLevel); MOCK ? mockLevels(false) : levels(false); levelSubs = 0; touch(); }
  else levelSubs = n;
}

/* ---------------------------------------------------------------- attach */
exports.attach = function (api, h) {
  const { readToken, bearer, body, send, audit } = h;
  F = h.F || (n => path.join(process.env.DATA_DIR || path.join(__dirname, "data"), n));
  const supported = WIN || MOCK || !!PS;
  const admin = (req, res) => { const t = readToken(bearer(req)); if (!t || t.role !== "admin") { send(res, 403, { ok: false, error: "admin clearance required" }); return null; } return t; };
  const local = req => { const a = (req.socket.remoteAddress || "").replace(/^::ffff:/, ""); return a === "127.0.0.1" || a === "::1"; };

  api["GET /api/media"] = async (req, res) => {
    if (!admin(req, res)) return;
    if (!supported) return send(res, 200, { ok: true, supported: false, host: os.hostname(), platform: process.platform });
    try { send(res, 200, { ok: true, supported: true, host: os.hostname(), local: local(req), ...(await getInfo()) }); }
    catch (e) { send(res, 200, { ok: true, supported: true, host: os.hostname(), playing: false, status: "error", error: e.message }); }
  };

  api["GET /api/media/art"] = async (req, res) => {
    if (!admin(req, res) || !supported) return;
    try {
      const a = await getArt();
      if (!a) return send(res, 404, { ok: false });
      res.writeHead(200, { "content-type": a.type, "cache-control": "private, max-age=86400", "access-control-allow-origin": "*" });
      res.end(a.buf);
    } catch (e) { send(res, 404, { ok: false, error: e.message }); }
  };

  api["GET /api/media/stream"] = async (req, res) => {
    if (!admin(req, res)) return;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive",
      "access-control-allow-origin": "*", "x-accel-buffering": "no" });
    res.write("retry: 3000\n\n");
    if (!supported) { sse(res, "info", { supported: false, platform: process.platform }); return res.end(); }
    streams.add(res); streamsChanged();
    try { sse(res, "info", await getInfo()); } catch (e) { sse(res, "info", { playing: false, status: "error", error: e.message }); }
    const ka = setInterval(() => { try { res.write(": k\n\n"); } catch (e) {} }, 20000);
    req.on("close", () => { clearInterval(ka); streams.delete(res); streamsChanged(); });
  };

  api["POST /api/media/control"] = async (req, res) => {
    const t = admin(req, res); if (!t) return;
    if (!supported) return send(res, 200, { ok: false, error: "media controls work on the Windows PC" });
    let b; try { b = await body(req); } catch (e) { return send(res, 400, { ok: false }); }
    const a = String(b.action || "");
    if (!/^(toggle|play|pause|next|prev)$/.test(a)) return send(res, 400, { ok: false, error: "unknown action" });
    try {
      const r = MOCK ? mock.ctl(a) : await ask(a, "ok");
      if (!local(req) && audit) audit({ kind: "media", user: t.user, action: a, ip: (req.socket.remoteAddress || "").replace(/^::ffff:/, ""), note: "remote media control" });
      await new Promise(r => setTimeout(r, 250));   // let the player apply it before we read back
      const info = await getInfo().catch(() => cur);
      for (const s of streams) sse(s, "info", info);
      send(res, 200, { ok: !!r.ok, ...info });
    } catch (e) { send(res, 200, { ok: false, error: e.message }); }
  };
};
exports._helper = HELPER;   // for tests
