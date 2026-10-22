// End-to-end check of the packaged web bundle (dist/) as each native app runs it.
//   node tests/app-test.mjs [outDir]
// For each platform (android, windows) and viewport (Fold4 cover, Fold4 open, PC):
//   - boots fully offline: every non-local request is blocked unless mocked below, so
//     three.js and the fonts must come from the bundle
//   - mocks the native side (Capacitor plugin / Tauri invoke) the way the real apps answer
//   - logs in with admin/admin, passes the first-login passkey screen
//   - opens every section, screenshots it, runs a native radar scan, checks project
//     status went through TURD_NATIVE.http, and collects page errors
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const out = path.resolve(process.argv[2] || path.join(here, "out"));
fs.mkdirSync(out, { recursive: true });

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(dist, p);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "content-type": mime[path.extname(f)] || "application/octet-stream" }); r.end(d); });
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}/`;

// (Windows runs need the chat server on 127.0.0.1:8787, e.g. PORT=8787 DATA_DIR=$(mktemp -d) node server/server.js)
// what the native side answers (same shapes as TurdNativePlugin.java / native.rs)
const NATIVE_MOCK = (platform) => `
(() => {
  const calls = window.__natCalls = [];
  const site = btoa('<html><head><title>3D MS</title></head><body><h1>3D MS</h1><h2>Camera wall</h2></body></html>');
  const answers = {
    info: { platform: "${platform}", version: "1.0.0", device: "test", freeBytes: 5e10 },
    http: a => ({ status: 200, statusText: "OK", url: a.url, headers: { "content-type": "text/html" }, body: site }),
    radarPermissions: { wifi: "granted", ble: "granted", locationOn: true, bluetoothOn: true },
    radarRequest: { wifi: "granted", ble: "granted" },
    wifiScan: { items: [ { ssid: "HomeNet_5G", bssid: "aa:bb:cc:00:11:22", rssi: -41, freq: 5180, channel: 36, secure: true },
                         { ssid: "xfinitywifi", bssid: "aa:bb:cc:00:11:23", rssi: -78, freq: 2437, channel: 6, secure: false } ] },
    bleScan: { items: [ { id: "C0:FF:EE:00:00:01", name: "Galaxy Buds2", rssi: -52, vendor: "Samsung" },
                        { id: "C0:FF:EE:00:00:02", name: "Unknown BLE", rssi: -88, vendor: "Apple" } ] },
    extrasInfo: { dir: "/extras", freeBytes: 5e10, totalBytes: 2.5e11, platform: "${platform}" },
    extrasDirs: { items: [ { path: "/extras", label: "Phone storage", freeBytes: 5e10, totalBytes: 2.5e11, removable: false } ] },
    extrasList: { items: [] },
    isInstalled: { map: {} },
    netwatchRequest: { granted: true },
    netwatchScan: { items: [ { ip: "192.168.1.1", mac: "", vendor: "", hostname: "router.lan", gateway: true, self: false },
                             { ip: "192.168.1.30", mac: "B8:27:EB:12:34:56", vendor: "", hostname: "", gateway: false, self: false },
                             { ip: "192.168.1.20", mac: "00:15:5D:00:00:01", vendor: "", hostname: "GAMING-PC", gateway: false, self: true } ], subnet: "192.168.1.0/24", macs: true },
    serverStatus: { running: true, managed: true, port: 8787, urls: ["http://127.0.0.1:8787", "http://192.168.1.20:8787"], autostart: true },
  };
  // the PC app talks to its own chat server through native http: pass those to the real local server
  const local = async a => {
    const r = await fetch(a.url, { method: a.method || "GET", headers: a.headers || {}, body: a.body ? atob(a.body) : undefined });
    const u8 = new Uint8Array(await r.arrayBuffer()); let s = ""; for (const c of u8) s += String.fromCharCode(c);
    const h = {}; r.headers.forEach((v, k) => h[k] = v);
    return { status: r.status, statusText: r.statusText, url: r.url, headers: h, body: btoa(s) };
  };
  const answer = (m, a) => { calls.push(m); if (m === "http" && String(a.url).startsWith("http://127.0.0.1:8787/")) return local(a); const v = answers[m]; return Promise.resolve(typeof v === "function" ? v(a) : (v || { ok: true })); };
  ${platform === "android" ? `
  const plugins = {};
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => "android", Plugins: plugins,
    registerPlugin(name) {
      return plugins[name] || (plugins[name] = new Proxy({}, { get: (_, m) => m === "addListener"
        ? () => Promise.resolve({ remove(){} })
        : (a) => name === "TurdNative" ? answer(m, a) : Promise.resolve({ ok: true, items: [], views: [] }) }));
    },
  };` : `
  window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => {
    if (cmd.startsWith("nat_")) { const m = cmd.slice(4).replace(/_([a-z])/g, (_, c) => c.toUpperCase()); return answer(m, args && args.a); }
    calls.push(cmd); return Promise.resolve(cmd === "ent_state" ? { views: [] } : null);
  } };
  window.__TAURI__ = { event: { listen: () => Promise.resolve(() => {}) } };`}
})();`;

const now = Math.floor(Date.now() / 3600e3) * 3600;
const hrs = Array.from({ length: 25 }, (_, i) => now + i * 3600);
const days = Array.from({ length: 7 }, (_, i) => now - (now % 86400) + i * 86400);
const fc = { current: { temperature_2m: 61, apparent_temperature: 59, relative_humidity_2m: 72, dew_point_2m: 52, weather_code: 2, is_day: 0, cloud_cover: 40, precipitation: 0, pressure_msl: 1014, wind_speed_10m: 8, wind_direction_10m: 200, wind_gusts_10m: 15, visibility: 16000, uv_index: 0 },
  hourly: { time: hrs, temperature_2m: hrs.map((_, i) => 58 + 10 * Math.sin(i / 4)), precipitation_probability: hrs.map(() => 10), weather_code: hrs.map(() => 2), is_day: hrs.map((_, i) => i > 3 && i < 15 ? 1 : 0) },
  daily: { time: days, weather_code: [2, 3, 61, 0, 1, 95, 71], temperature_2m_max: [68, 64, 60, 70, 72, 66, 50], temperature_2m_min: [52, 49, 47, 50, 55, 48, 33], sunrise: days.map(d => d + 12 * 3600), sunset: days.map(d => d + 23 * 3600), uv_index_max: [5, 4, 2, 6, 7, 3, 2], precipitation_probability_max: [20, 30, 85, 0, 10, 60, 40], precipitation_sum: [0, 0, .5, 0, 0, .2, .1], wind_speed_10m_max: [10, 12, 15, 8, 7, 20, 14] } };

const VIEWS = [
  { label: "fold-cover", vp: { width: 344, height: 882 }, dpr: 2.6, mobile: true },
  { label: "fold-open", vp: { width: 690, height: 829 }, dpr: 2.6, mobile: true },
  { label: "pc", vp: { width: 1366, height: 768 }, dpr: 1, mobile: false },
];
const PLATFORMS = (process.env.PLATFORMS || "android,windows").split(",");
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const report = [];
let failures = 0;

for (const platform of PLATFORMS) for (const v of VIEWS) {
  if (platform === "windows" && v.mobile) continue;
  if (platform === "android" && !v.mobile) continue;
  const label = `${platform}-${v.label}`;
  const errs = [], blocked = new Set();
  const ctx = await b.newContext({ viewport: v.vp, deviceScaleFactor: v.dpr, isMobile: v.mobile, hasTouch: v.mobile });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errs.push("pageerror " + e.message));
  pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console.error " + m.text().slice(0, 200)); });
  // local services that are simply not running in the test (chat server, Ollama) are expected to refuse
  pg.on("requestfailed", q => { const u = q.url(); if (!/^http:\/\/127\.0\.0\.1:(8787|11434)\//.test(u) && !blocked.has(new URL(u).host)) errs.push("requestfailed " + u.slice(0, 120)); });
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1).*/, r => {
    const u = r.request().url();
    if (u.includes("api.open-meteo.com")) return r.fulfill({ json: fc });
    if (u.includes("air-quality")) return r.fulfill({ json: { current: { us_aqi: 42, pm2_5: 8 } } });
    if (u.includes("weather.gov")) return r.fulfill({ json: { features: [] } });
    if (u.includes("bigdatacloud")) return r.fulfill({ json: { city: "Southaven", principalSubdivisionCode: "US-MS", countryCode: "US" } });
    blocked.add(new URL(u).host); return r.abort();
  });
  await pg.addInitScript(NATIVE_MOCK(platform));
  const t0 = Date.now();
  await pg.goto(base);
  const plat = await pg.evaluate(() => window.TURD_NATIVE && window.TURD_NATIVE.platform);
  // real first-login flow: admin/admin → rotate passkey screen → keep default
  await pg.fill("#u", "admin"); await pg.fill("#p", "admin"); await pg.click("#loginForm button");
  try { await pg.waitForSelector("#npSkip", { timeout: 4000 }); await pg.click("#npSkip"); } catch (e) {}
  let booted = true;
  try { await pg.waitForSelector(".navbtn", { timeout: 20000 }); } catch (e) { booted = false; }
  const bootMs = Date.now() - t0;
  const ids = booted ? await pg.$$eval(".navbtn", bs => bs.map(x => x.dataset.go)) : [];
  const three = await pg.evaluate(() => !!document.querySelector("#scene") && document.querySelector("#scene").width > 0);
  const fonts = await pg.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === "loaded").map(f => f.family).filter((x, i, a) => a.indexOf(x) === i); });
  const res = { label, platform: plat, booted, bootMs, sections: ids, three, fonts, radar: null, projectsViaNative: null };
  for (const s of ids) {
    await pg.click(`.navbtn[data-go="${s}"]`).catch(() => {});
    await pg.waitForTimeout(1300);
    if (s === "radar") {
      const btn = await pg.$("#natScan");
      if (btn) { await btn.click(); await pg.waitForTimeout(800); res.radar = await pg.$$eval("#devList .dev .n", n => n.map(x => x.textContent.trim())); }
      else res.radar = "no native scan button";
    }
    if (s === "netwatch") res.netwatch = await pg.evaluate(async () => window.TURD_NATIVE && window.TURD_NATIVE.netwatch ? (await window.TURD_NATIVE.netwatch.scan()).map(r => r.ip + " " + (r.vendor || "-")) : null);
    await pg.screenshot({ path: path.join(out, `${label}-${s}.png`) });
  }
  res.projectsViaNative = (await pg.evaluate(() => window.__natCalls.filter(c => c === "http").length)) > 0;
  res.nativeCalls = [...new Set(await pg.evaluate(() => window.__natCalls))];
  res.errors = errs; res.blockedHosts = [...blocked];
  if (!booted || errs.length || plat !== platform) failures++;
  report.push(res);
  console.log(JSON.stringify(res));
  await ctx.close();
}
await b.close(); srv.close();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(failures ? `FAIL (${failures} runs with problems)` : "PASS");
process.exit(failures ? 1 : 0);
