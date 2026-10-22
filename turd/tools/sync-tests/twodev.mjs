// Two-device sync test: real server.js + real web app, two isolated browser contexts (PC + Fold4).
import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import { spawn } from "child_process"; import os from "os";
const ROOT = process.argv[2] || "/mnt/project-files/turd";
const THREE = fs.readFileSync(new URL("../deps/node_modules/three/build/three.module.js", import.meta.url));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "turdsync-"));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, [path.join(ROOT, "server/server.js")], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: "pw1234", GEOIP: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = ""; srv.stdout.on("data", d => srvLog += d); srv.stderr.on("data", d => srvLog += d);
await new Promise(r => setTimeout(r, 900));
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const ok = (name, cond, extra) => { results.push([cond ? "PASS" : "FAIL", name, extra || ""]); console.log(cond ? "PASS" : "FAIL", name, extra ? JSON.stringify(extra).slice(0, 300) : ""); };
const b = await chromium.launch({ args: ["--use-gl=swiftshader"] });
const errs = [];
async function device(name, ua, viewport) {
  const ctx = await b.newContext({ userAgent: ua, viewport });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.request().url().includes("three") ? r.fulfill({ body: THREE, contentType: "text/javascript" }) : r.abort());
  const pg = await ctx.newPage(); pg.on("pageerror", e => errs.push(name + ": " + e.message));
  await pg.goto(BASE + "/");
  return { ctx, pg, name };
}
async function login(d, user = "admin", pw = "pw1234") {
  await d.pg.fill("#u", user); await d.pg.fill("#p", pw); await d.pg.click("#loginForm button");
  await d.pg.waitForSelector(".navbtn.active", { timeout: 20000 });
  await d.pg.waitForFunction(() => window.TURD_SYNC && window.TURD_SYNC.status().ok, null, { timeout: 15000 });
  await d.pg.addStyleTag({ content: "#vbub{display:none!important}" });   // another thread's voice tip bubble
}
const LS = (d, k) => d.pg.evaluate(k => { const v = localStorage.getItem(k); try { return JSON.parse(v); } catch (e) { return v; } }, k);
const set = (d, k, v) => d.pg.evaluate(([k, v]) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)), [k, v]);
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 200)); } return false; };
const t0 = Date.now();

const PC = await device("pc", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", { width: 1600, height: 900 });
const FOLD = await device("fold", "Mozilla/5.0 (Linux; Android 14; SM-F936U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", { width: 412, height: 900 });

// pre-existing per-device data before the first link (both devices had a life before sync)
await set(PC, "turd_log", [{ id: "pc1", t: Date.now() - 9e5, txt: "PC entry from before sync", cat: "note", tags: [], pinned: false, done: false }]);
await set(FOLD, "turd_log", [{ id: "fd1", t: Date.now() - 8e5, txt: "Fold entry from before sync", cat: "task", tags: [], pinned: false, done: false }]);
await set(PC, "turd_wx_units", "F"); await set(FOLD, "turd_wx_units", "C");
await set(PC, "turd_ent_stats", { blocked: 10, opens: 4, since: 1000 }); await set(FOLD, "turd_ent_stats", { blocked: 5, opens: 1, since: 2000 });
await login(PC); await new Promise(r => setTimeout(r, 1500)); await login(FOLD);

ok("first link merges both logbooks", await until(async () => { const a = await LS(PC, "turd_log"), c = await LS(FOLD, "turd_log"); return a.length === 2 && c.length === 2; }), { pc: (await LS(PC, "turd_log")).map(e => e.id), fold: (await LS(FOLD, "turd_log")).map(e => e.id) });
ok("first link: settings follow the device that linked first (PC)", await until(async () => (await LS(FOLD, "turd_wx_units")) === "F"), await LS(FOLD, "turd_wx_units"));
ok("counters add up across devices (blocked 15, opens 5)", await until(async () => { const a = await LS(PC, "turd_ent_stats"), c = await LS(FOLD, "turd_ent_stats"); return a.blocked === 15 && c.blocked === 15 && a.opens === 5 && c.opens === 5; }), { pc: await LS(PC, "turd_ent_stats"), fold: await LS(FOLD, "turd_ent_stats") });

// live: logbook entry typed in the real UI on the PC appears on the Fold, and the Fold's open Logbook re-renders
await FOLD.pg.click('.navbtn[data-go="logbook"]'); await PC.pg.click('.navbtn[data-go="logbook"]');
await PC.pg.fill("#lgIn", "Typed on the PC #sync"); await PC.pg.click("#lgAdd");
const tLive = Date.now();
ok("PC logbook entry reaches Fold's open Logbook screen", await until(() => FOLD.pg.evaluate(() => document.querySelector("#sec-logbook").textContent.includes("Typed on the PC"))), { ms: Date.now() - tLive });

// concurrent edits to different items of the same key
await Promise.all([PC.pg.evaluate(() => { const d = JSON.parse(localStorage.getItem("turd_opsec") || "{}"); d[0] = true; localStorage.setItem("turd_opsec", JSON.stringify(d)); }),
                   FOLD.pg.evaluate(() => { const d = JSON.parse(localStorage.getItem("turd_opsec") || "{}"); d[3] = true; localStorage.setItem("turd_opsec", JSON.stringify(d)); })]);
ok("simultaneous OPSEC ticks on both devices both survive", await until(async () => { const a = await LS(PC, "turd_opsec"), c = await LS(FOLD, "turd_opsec"); return a[0] && a[3] && c[0] && c[3]; }), { pc: await LS(PC, "turd_opsec"), fold: await LS(FOLD, "turd_opsec") });

// offline: Fold goes off Wi-Fi, edits a lot; PC edits too; then Fold comes back
await FOLD.ctx.setOffline(true); await new Promise(r => setTimeout(r, 400));
await FOLD.pg.evaluate(() => { const l = JSON.parse(localStorage.getItem("turd_log")); l.unshift({ id: "off1", t: Date.now(), txt: "written offline on the Fold", cat: "note", tags: [], pinned: false, done: false });
  const e = l.find(x => x.id === "fd1"); e.done = true; localStorage.setItem("turd_log", JSON.stringify(l)); });
await FOLD.pg.evaluate(() => { const l = JSON.parse(localStorage.getItem("turd_log")).filter(x => x.id !== "pc1"); localStorage.setItem("turd_log", JSON.stringify(l)); });   // delete the PC's old entry
await FOLD.pg.evaluate(() => localStorage.setItem("turd_wx_places", JSON.stringify([{ name: "Tupelo", lat: 34.25, lon: -88.7 }])));
await FOLD.pg.evaluate(() => { const s = JSON.parse(localStorage.getItem("turd_ent_stats")); s.opens += 3; localStorage.setItem("turd_ent_stats", JSON.stringify(s)); });
await new Promise(r => setTimeout(r, 1200));
const queued = await FOLD.pg.evaluate(() => window.TURD_SYNC.status().pending);
ok("offline edits are queued on the Fold", queued > 0, { queued, chip: await FOLD.pg.$eval("#stSync", e => e.textContent) });
await PC.pg.evaluate(() => { const l = JSON.parse(localStorage.getItem("turd_log")); l.unshift({ id: "pc2", t: Date.now(), txt: "PC entry while Fold offline", cat: "idea", tags: [], pinned: true, done: false }); localStorage.setItem("turd_log", JSON.stringify(l)); });
await PC.pg.evaluate(() => { const s = JSON.parse(localStorage.getItem("turd_ent_stats")); s.opens += 2; localStorage.setItem("turd_ent_stats", JSON.stringify(s)); });
await PC.pg.evaluate(() => localStorage.setItem("turd_wx_units", JSON.stringify("C")));
await new Promise(r => setTimeout(r, 1500));
ok("PC never saw the offline edits yet", !(await LS(PC, "turd_log")).some(e => e.id === "off1"));
await FOLD.ctx.setOffline(false); await FOLD.pg.evaluate(() => dispatchEvent(new Event("online")));
const want = l => { const ids = l.map(e => e.id).sort().join(","); return ids === "fd1,off1,pc2,x".replace(",x", "") || null; };
ok("after reconnect both logbooks are identical and merged", await until(async () => {
  const a = await LS(PC, "turd_log"), c = await LS(FOLD, "turd_log");
  const ia = a.map(e => e.id).sort().join(), ic = c.map(e => e.id).sort().join();
  return ia === ic && a.some(e => e.id === "off1") && a.some(e => e.id === "pc2") && !a.some(e => e.id === "pc1") && a.find(e => e.id === "fd1")?.done;
}, 15000), { pc: (await LS(PC, "turd_log")).map(e => e.id + (e.done ? "✓" : "")), fold: (await LS(FOLD, "turd_log")).map(e => e.id + (e.done ? "✓" : "")) });
ok("offline counter increments add up (opens 5+3+2=10)", await until(async () => (await LS(PC, "turd_ent_stats")).opens === 10 && (await LS(FOLD, "turd_ent_stats")).opens === 10), { pc: await LS(PC, "turd_ent_stats"), fold: await LS(FOLD, "turd_ent_stats") });
ok("saved weather place made offline reaches PC", await until(async () => ((await LS(PC, "turd_wx_places")) || []).some(p => p.name === "Tupelo")));
ok("newer setting wins (PC switched to °C after)", await until(async () => (await LS(FOLD, "turd_wx_units")) === "C"));

// raw (non-JSON) values sync untouched
await PC.pg.evaluate(() => localStorage.setItem("turd_com_pane", "chat"));
ok("raw string values sync", await until(async () => (await FOLD.pg.evaluate(() => localStorage.getItem("turd_com_pane"))) === "chat"));

// security
await PC.pg.evaluate(() => { localStorage.setItem("turd_users", JSON.stringify({ admin: { pw: "SECRETPW" } })); localStorage.setItem("turd_audit", JSON.stringify([{ user: "intruder" }])); localStorage.setItem("turd_my_apikey", "sk-zzz"); });
await new Promise(r => setTimeout(r, 2500));
const foldUsers = await FOLD.pg.evaluate(() => localStorage.getItem("turd_users") || ""), foldAudit = await FOLD.pg.evaluate(() => localStorage.getItem("turd_audit") || "");
ok("passkeys, audit log and api keys never reach the other device", !foldUsers.includes("SECRETPW") && !foldAudit.includes("intruder") && !(await FOLD.pg.evaluate(() => localStorage.getItem("turd_my_apikey"))));
const files = fs.readdirSync(path.join(DATA, "sync")).map(f => fs.readFileSync(path.join(DATA, "sync", f), "utf8")).join("\n");
ok("server sync store has no passkey/audit/token/uplink", !/SECRETPW|intruder|sk-zzz|turd_token|turd_uplink|turd_users|turd_audit/.test(files), { bytes: files.length });

// device status: the PC sees the Fold's row
await FOLD.pg.evaluate(() => window.TURD_SYNC.now());
ok("PC knows the Fold's status (battery/storage/last seen)", await until(async () => (await PC.pg.evaluate(() => window.TURD_SYNC.devices())).some(d => d.name === "Galaxy Fold4" && d.online && d.free != null)), (await PC.pg.evaluate(() => window.TURD_SYNC.devices())));

// another operator on a third device never sees admin's data
const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "admin", pw: "pw1234" }) }).then(r => r.json());
await fetch(BASE + "/api/users", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + r.token }, body: JSON.stringify({ user: "joe", pw: "joejoe" }) });
const JOE = await device("joe", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36", { width: 412, height: 900 });
await login(JOE, "joe", "joejoe"); await new Promise(r => setTimeout(r, 1500));
ok("other operator's device gets none of admin's data", !((await LS(JOE, "turd_log")) || []).length && !(await LS(JOE, "turd_opsec")));

// Lock + sign back in keeps working (persisted queue/base)
await FOLD.pg.click("#stLock"); await FOLD.pg.waitForSelector("#loginForm"); await login(FOLD);
await PC.pg.evaluate(() => localStorage.setItem("turd_log_draft", JSON.stringify("half-written on PC")));
ok("after lock + re-login on Fold sync resumes", await until(async () => (await LS(FOLD, "turd_log_draft")) === "half-written on PC"));

await PC.pg.click('.navbtn[data-go="home"]'); await PC.pg.waitForTimeout(600);
ok("PC Home shows the Fold strip", await until(() => PC.pg.evaluate(() => (document.querySelector("#hmDev")||{}).textContent?.includes("Galaxy Fold4"))), await PC.pg.evaluate(() => (document.querySelector("#hmDev")||{}).textContent?.replace(/\s+/g," ")));
ok("PC's own row hides fake desktop battery", (await PC.pg.evaluate(() => window.TURD_SYNC.devices().find(d => d.me).battery)) === null);
// Fold battery drops → PC Home strip repaints without re-mounting Home
await PC.pg.evaluate(() => { window.__homeMounts = 0; document.querySelector("#hmDev").dataset.mark = "1"; });
await FOLD.pg.evaluate(() => { const r = JSON.parse(localStorage.getItem("turd_devices")); const me = Object.keys(r).find(k => k.startsWith("and-")); r[me].battery = 17; r[me].charging = false; localStorage.setItem("turd_devices", JSON.stringify(r)); });
ok("Fold battery change repaints PC Home strip in place", await until(() => PC.pg.evaluate(() => { const el = document.querySelector("#hmDev"); return el && el.dataset.mark === "1" && el.textContent.includes("17%"); })));
// native report (as the Android app sends it) shows up with temperature and real storage
const tokF = await FOLD.pg.evaluate(() => JSON.parse(localStorage.getItem("turd_token")));
await fetch(BASE + "/api/devstatus", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tokF }, body: JSON.stringify({ id: "fold4", name: "Galaxy Z Fold4", model: "SM-F936U", battery: 63, charging: false, tempC: 31.5, storageFreeGB: 88.4, storageTotalGB: 256 }) });
await PC.pg.click('.navbtn[data-go="logbook"]'); await PC.pg.click('.navbtn[data-go="home"]');
ok("PC Home uses the Fold's native report (temp + real storage)", await until(() => PC.pg.evaluate(() => { const t = document.querySelector("#hmDev")?.textContent || ""; return t.includes("Galaxy Z Fold4") && t.includes("32°C") && t.includes("88.4 GB"); }), 15000), await PC.pg.evaluate(() => document.querySelector("#hmDev")?.textContent.replace(/\s+/g, " ")));
await PC.pg.screenshot({ path: new URL("./pc-home.png", import.meta.url).pathname });
ok("no page errors", errs.length === 0, errs);
await PC.pg.screenshot({ path: new URL("./pc-logbook.png", import.meta.url).pathname });
await PC.pg.click("#stSync",{timeout:5000}).catch(e=>ok("sync chip clickable",false,e.message.slice(0,80))); await PC.pg.waitForTimeout(300); await PC.pg.screenshot({ path: new URL("./pc-sync-panel.png", import.meta.url).pathname });
await FOLD.pg.screenshot({ path: new URL("./fold-logbook.png", import.meta.url).pathname });
console.log(`\n${results.filter(r => r[0] === "PASS").length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await b.close(); srv.kill(); if (process.env.SRVLOG) console.log(srvLog);
process.exit(results.every(r => r[0] === "PASS") ? 0 : 1);
