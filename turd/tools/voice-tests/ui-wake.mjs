import { createRequire } from "module";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
import fs from "fs"; import path from "path";
const HERE = path.dirname(new URL(import.meta.url).pathname), OUT = path.join(HERE, "out"); fs.mkdirSync(OUT, { recursive: true });
const THREE = fs.readFileSync(path.join(HERE, "deps/node_modules/three/build/three.module.js"));
const B = "http://127.0.0.1:8799", only = process.argv[2] || "all";
const now = Math.floor(Date.now() / 1000 / 3600) * 3600, hrs = Array.from({ length: 25 }, (_, i) => now + i * 3600), days = Array.from({ length: 7 }, (_, i) => now - (now % 86400) + i * 86400);
const fc = { current: { temperature_2m: 61, apparent_temperature: 59, relative_humidity_2m: 72, dew_point_2m: 52, weather_code: 2, is_day: 0, cloud_cover: 40, precipitation: 0, pressure_msl: 1014, wind_speed_10m: 8, wind_direction_10m: 200, wind_gusts_10m: 15, visibility: 16000, uv_index: 0 },
  hourly: { time: hrs, temperature_2m: hrs.map((_, i) => 58 + 10 * Math.sin(i / 4)), precipitation_probability: hrs.map((_, i) => i > 6 && i < 10 ? 70 : 10), weather_code: hrs.map((_, i) => i > 6 && i < 10 ? 61 : 2), is_day: hrs.map((_, i) => i > 3 && i < 15 ? 1 : 0) },
  daily: { time: days, weather_code: [2, 3, 61, 0, 1, 95, 71], temperature_2m_max: [68, 64, 60, 70, 72, 66, 50], temperature_2m_min: [52, 49, 47, 50, 55, 48, 33], sunrise: days.map(d => d + 12 * 3600), sunset: days.map(d => d + 23 * 3600), uv_index_max: [5, 4, 2, 6, 7, 3, 2], precipitation_probability_max: [20, 30, 85, 0, 10, 60, 40], precipitation_sum: [0, 0, .5, 0, 0, .2, .1], wind_speed_10m_max: [10, 12, 15, 8, 7, 20, 14] } };
const ctl = j => fetch("http://127.0.0.1:9911/__ctl", { method: "POST", body: JSON.stringify(j) });
const errors = [];
const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture=/tmp/claude-0/-home-claude/29844631-3a82-52d4-8603-0e851bad09d4/scratchpad/wake/seq.wav","--autoplay-policy=no-user-gesture-required","--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });

async function page(label, vp, { mobile, uplink = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  const pg = await ctx.newPage();
  pg.on("response", r => { if (r.status() >= 400) errors.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  pg.on("requestfailed", r => errors.push(`[${label}] FAILED ${r.url().slice(0,100)}`));
  pg.on("pageerror", e => errors.push(`[${label}] pageerror ${e.message}`));
  pg.on("console", m => { if (m.type() === "error") errors.push(`[${label}] console ${m.text()}`); });
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, async r => { const u = r.request().url();
    if (u.includes("three")) return r.fulfill({ body: THREE, contentType: "text/javascript" });
    if (u.includes("api.open-meteo.com")) return r.fulfill({ json: fc });
    if (u.includes("air-quality")) return r.fulfill({ json: { current: { us_aqi: 42 } } });
    if (u.includes("weather.gov")) return r.fulfill({ json: { features: [] } });
    if (u.includes("bigdatacloud")) return r.fulfill({ json: { city: "Southaven", principalSubdivisionCode: "US-MS", countryCode: "US" } });
    return r.abort(); });
  await pg.addInitScript(([up]) => {
    if (up) localStorage.setItem("turd_uplink", JSON.stringify(up));
    localStorage.setItem("turd_users", JSON.stringify({ admin: { pw: "admin", fresh: false, role: "admin" } }));
    if (!localStorage.getItem("turd_log")) { const n = Date.now(); localStorage.setItem("turd_log", JSON.stringify([
      { id: "a", t: n - 3e5, txt: "Order new SD cards for the dashcam", cat: "task", tags: [], pinned: false, done: false },
      { id: "b", t: n - 6e5, txt: "Idea: night-mode auto switch for the camera wall", cat: "idea", tags: [], pinned: true, done: false },
      { id: "d", t: n - 86400e3, txt: "Link the remaining Oxford camera feeds #3dms", cat: "task", tags: ["3dms"], pinned: false, done: false }])); }
  }, [uplink ? B : ""]);
  await pg.goto(B + "/");
  await pg.fill("#p", "admin"); await pg.press("#p", "Enter");
  await pg.waitForTimeout(900);
  if (await pg.$("#npSkip")) await pg.click("#npSkip");
  await pg.waitForSelector('.navbtn[data-go="assistant"]', { timeout: 15000 });
  // warm weather cache once so the snapshot has data
  await pg.click('.navbtn[data-go="weather"]'); await pg.waitForTimeout(1200);
  await pg.click('.navbtn[data-go="assistant"]'); await pg.waitForTimeout(1500);
  return { pg, ctx };
}
const shot = (pg, n) => pg.screenshot({ path: path.join(OUT, n + ".png") });
const ask = async (pg, t) => { await pg.fill(".as-bar textarea", t); await pg.keyboard.press("Enter"); };
const idle = pg => pg.waitForFunction(() => !document.querySelector(".as-root.busy"), null, { timeout: 30000 });
const lastA = pg => pg.$$eval(".as-a", a => { const x = a[a.length - 1]; return { text: x.querySelector(".as-a-body").innerText, meta: x.querySelector(".as-meta").innerText, acts: [...x.querySelectorAll(".as-act")].map(e => e.innerText) }; });

const { pg, ctx } = await page("wake", { width: 1440, height: 860 });
const t0 = Date.now(); pg.on("console", m => { if (m.text().startsWith("[voice]")) console.log(((Date.now()-t0)/1000).toFixed(1), m.text()); });
await pg.evaluate(() => {
  window.__ev = []; const T0 = performance.now(); const log = (k, v) => window.__ev.push([((performance.now() - T0) / 1000).toFixed(1), k, v]);
  window.TURD_VOICE_DEBUG=1; addEventListener("turd:ask", e => log("ASK", e.detail.text));
  new MutationObserver(() => log("SEC", document.body.dataset.section)).observe(document.body, { attributes: true, attributeFilter: ["data-section"] });
  const iv = setInterval(() => { const b = document.querySelector("#vbub .t"); if (!b) return; clearInterval(iv);
    new MutationObserver(() => log("BUB", b.textContent)).observe(b, { childList: true, characterData: true, subtree: true }); }, 100);
  const iv2 = setInterval(() => { if (window.TURD_VOICE) { clearInterval(iv2); log("STATE", TURD_VOICE.state); TURD_VOICE.on(s => log("STATE", s)); } }, 50);
});
console.log("voice btn:", await pg.$eval("#st-voice", e => e.innerText).catch(() => "none"), "| card:", await pg.$eval("#vbub", e => e.className + " " + e.innerText.slice(0, 80)).catch(() => ""));
await shot(pg, "wake-1-offer");
await pg.click('#vbub [data-v="on"]').catch(e => console.log("no offer card", e.message));
await pg.waitForFunction(() => window.TURD_VOICE && TURD_VOICE.state === "listening", null, { timeout: 120000 }).catch(e => console.log("never listening"));
console.log("listening after", ((Date.now() - t0) / 1000).toFixed(1), "s");
await shot(pg, "wake-2-listening");
for (let i = 0; i < 16; i++) { await pg.waitForTimeout(5000); if (i === 3) await shot(pg, "wake-3-mid"); }
require("fs").writeFileSync("out/wake-ev.txt", (await pg.evaluate(() => window.__ev)).map(e => e.join(" ")).join("\n"));
await shot(pg, "wake-4-end");
await b.close();
console.log("ERRORS:\n" + [...new Set(errors)].filter(e => !/fonts|netlify|workers|gstatic|1\.1\.1\.1|ERR_FAILED|ERR_ABORTED/.test(e)).join("\n"));
