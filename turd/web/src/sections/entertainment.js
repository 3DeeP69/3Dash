// ===========================================================================
// ENTERTAINMENT — console-style launcher for YouTube, TikTok, Twitch, Reddit,
// SoundCloud and any site you add. Sites open inside T.U.R.D. in a native
// web view (Windows: Tauri/WebView2, Android: Capacitor/WebView) laid over the
// viewer, with the Shield (ent/shield.js) killing ads, app nags and splash
// screens. Favourite apps are kept warm in the background so they open with
// no load at all. In the browser preview, embed players stand in.
// ===========================================================================
import { APPS, GLYPHS, siteFor, themeFor } from "./ent/catalog.js";
import { scriptFor, networkRules } from "./ent/shield.js";
import { createBridge } from "./ent/bridge.js";
import * as Demo from "./ent/demo.js";
import { mountPlay } from "./ent/games.js";
import { mountNowPlaying, lastPlaying } from "./ent/nowplaying.js";

const BASE_THEME = { accent:"#ff3b5c", accent2:"#a0122e", rgb:"255,59,92" };
const SEARCH = {
  youtube:"https://www.youtube.com/results?search_query=", tiktok:"https://www.tiktok.com/search?q=",
  twitch:"https://www.twitch.tv/search?term=", reddit:"https://www.reddit.com/search/?q=",
  soundcloud:"https://soundcloud.com/search?q=",
};
const MSEARCH = { youtube:"https://m.youtube.com/results?search_query=" };

let K, panel, B, view = "launcher", focus = 0, sub = 0, active = null;
let pollT = 0, ro = null, offs = [], opened = new Set(), lastState = {}, blockedBase = 0;
let playOff = null, playSeq = 0;   // Play (PC games) view cleanup
let npEl = null, npOff = null;     // Now Playing dock: one live instance moved between re-renders

/* ------------------------------------------------------------ storage */
const prefsAll = ()=> K.LS.get("turd_ent_prefs", {});
const prefs = id=>{ const a = all().find(x=>x.id===id) || {}; return { shield:true, clean:true, warm:!!a.warm, ...(prefsAll()[id]||{}) }; };
const setPref = (id, k, v)=>{ const p = prefsAll(); p[id] = { ...prefs(id), [k]:v }; K.LS.set("turd_ent_prefs", p); };
const custom = ()=> K.LS.get("turd_ent_custom", []);
const all = ()=> [...APPS, ...custom()];
const recent = ()=> K.LS.get("turd_ent_recent", []);
const stats = ()=> K.LS.get("turd_ent_stats", { blocked:0, opens:0, since:Date.now() });
const mode = ()=> K.LS.get("turd_ent_mode", "watch") === "play" ? "play" : "watch";
const fmt = n=> n >= 10000 ? (n/1000).toFixed(n>=100000?0:1)+"k" : n.toLocaleString();

/* ------------------------------------------------------------ theme */
function setTheme(t){
  if(!t) return;
  if(typeof K.setTheme === "function"){ K.setTheme(t); return; }
  if(window.TURD && typeof window.TURD.setTheme === "function"){ window.TURD.setTheme(t); return; }
  const s = document.body.style; s.setProperty("--accent", t.accent); s.setProperty("--accent2", t.accent2); s.setProperty("--accent-rgb", t.rgb);
}

// a game has no brand colour, so its visor tint comes from the same hue as its generated cover
function gameTheme(g){
  let h = 0; for(const c of g.name) h = (h*31 + c.charCodeAt(0)) >>> 0; h %= 360;
  const hsl = (l)=>{ const a = .8 * Math.min(l, 1-l), f = n=>{ const k = (n + h/30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k-3, 9-k, 1)))); }; return [f(0), f(8), f(4)]; };
  const hex = c=> "#" + c.map(v=>v.toString(16).padStart(2,"0")).join(""), c1 = hsl(.58), c2 = hsl(.3);
  return { accent:hex(c1), accent2:hex(c2), rgb:c1.join(",") };
}

/* ------------------------------------------------------------ styles (own file, so sections.css stays untouched) */
function ensureCss(){
  if(document.getElementById("ent-css")) return;
  const l = document.createElement("link"); l.id = "ent-css"; l.rel = "stylesheet";
  l.href = new URL("./ent/ent.css", import.meta.url).href; document.head.appendChild(l);
}

/* ------------------------------------------------------------ native view helpers */
const mobile = ()=> B.kind === "android";
const homeUrl = a=> mobile() && a.murl ? a.murl : a.url;
function openReq(a, url, visible){
  const p = prefs(a.id), site = a.site || siteFor(a.url) || a.id;
  return { id:a.id, url:url || homeUrl(a), script: scriptFor(site === "web" ? "generic" : site, p), visible,
    shield:p.shield, rules: networkRules(), ...rect() };
}
function rect(){
  const vp = panel && panel.querySelector(".ent-vp");
  if(!vp) return { x:0, y:0, w:1, h:1 };
  const r = vp.getBoundingClientRect();
  return { x:Math.round(r.left), y:Math.round(r.top), w:Math.max(1,Math.round(r.width)), h:Math.max(1,Math.round(r.height)) };
}
async function ensureView(a, url, visible){
  if(B.kind === "web") return;
  let r;
  if(!opened.has(a.id) || url){ opened.add(a.id); r = await B.open(openReq(a, url, visible)); }
  else if(visible) r = await B.show(a.id, rect());
  if(r && !r.ok){ opened.delete(a.id); if(visible) openFailed(a, url, r.e); }
}
// A native failure shows a clear card with the real reason and a retry, never a dead black box.
function openFailed(a, url, why){
  const vp = panel && panel.querySelector(".ent-vp"); if(!vp || !active || active.id !== a.id) return;
  vp.querySelector(".ent-fail")?.remove(); vp.querySelector(".ent-boot")?.classList.add("gone");
  vp.insertAdjacentHTML("beforeend", `<div class="ent-fail"><b>${K.esc(a.name)} didn't open</b>
    <p>${K.esc(String(why||"unknown error").slice(0,300))}</p><button class="btn" id="entRetry">Try again</button></div>`);
  vp.querySelector("#entRetry").onclick = ()=>{ vp.querySelector(".ent-fail")?.remove(); vp.querySelector(".ent-boot")?.classList.remove("gone"); B.close(a.id).then(()=>ensureView(a, url, true)); };
}
async function warmUp(){
  if(B.kind === "web") return;
  await B.rules(networkRules());
  for(const a of all()){
    if(prefs(a.id).warm && !opened.has(a.id)){ opened.add(a.id); const r = await B.open(openReq(a, null, false)); if(!r.ok) opened.delete(a.id); }
  }
}
// Native views float above the page, so step aside when the shell shows an overlay.
function watchOverlays(){
  const els = ["#modal", "#login"].map(s=>document.querySelector(s)).filter(Boolean);
  const check = ()=>{
    const covered = els.some(el=> el.id === "modal" ? el.classList.contains("show") : !el.classList.contains("hide"));
    if(view !== "viewer" || !active) return;
    if(covered) B.hide(active.id); else B.show(active.id, rect());
  };
  const mo = new MutationObserver(check); els.forEach(el=>mo.observe(el, { attributes:true, attributeFilter:["class"] }));
  offs.push(()=>mo.disconnect());
}

/* ------------------------------------------------------------ launcher */
function subItems(a){
  const p = prefs(a.id), isCustom = !APPS.includes(a), items = [];
  items.push({ k:"open", label:`Open ${a.name}`, hint:opened.has(a.id) && B.kind!=="web" ? "ready instantly" : "" });
  const r = recent().find(x=>x.app===a.id);
  if(r) items.push({ k:"resume", label:"Pick up where you left off", hint:r.title || r.url });
  if(SEARCH[a.id]) items.push({ k:"search", label:`Search ${a.name}`, hint:"type, then Enter" });
  items.push({ k:"shield", label:"Ad shield", val:p.shield });
  items.push({ k:"clean", label:"Clean mode", hint:"hides app nags, pop-ups and splash screens", val:p.clean });
  items.push({ k:"warm", label:"Keep warm", hint:"preloaded in the background so it opens with no wait", val:p.warm });
  if(isCustom) items.push({ k:"remove", label:"Remove from launcher" });
  return items;
}
function tile(a, i){
  const g = GLYPHS[a.id] || GLYPHS.web, t = a.theme || BASE_THEME;
  const warm = B.kind !== "web" && opened.has(a.id);
  return `<button class="ent-tile${i===focus?" on":""}" data-i="${i}" style="--c:${t.accent};--c2:${t.accent2};--crgb:${t.rgb}" aria-label="${K.esc(a.name)}">
    <span class="ent-orb"><span class="ent-glyph${a.id==="tiktok"?" tt":""}">${g}</span></span>
    <span class="ent-name">${K.esc(a.name)}</span>
    <span class="ent-tag">${K.esc(a.tagline || new URL(a.url).hostname.replace(/^www\./,""))}</span>
    ${warm?`<i class="ent-warm" title="loaded and ready"></i>`:""}
  </button>`;
}
const modesHtml = m=> `<div class="ent-modes" role="tablist" aria-label="Entertainment mode">
    <button role="tab" data-mode="watch" class="${m==="watch"?"on":""}" aria-selected="${m==="watch"}">Watch</button>
    <button role="tab" data-mode="play" class="${m==="play"?"on":""}" aria-selected="${m==="play"}">Play</button></div>`;
// what the PC is playing, docked under Watch and Play; hidden by itself when nothing plays
function dockNp(){
  if(!npEl){ npEl = document.createElement("div"); npOff = mountNowPlaying(npEl, K, { variant:"dock" }); }
  const st = panel.querySelector(".ent-stage"); if(st){ st.appendChild(npEl); npEl.dispatchEvent(new Event("np:show")); }
}
function wireModes(){ panel.querySelectorAll("[data-mode]").forEach(b=> b.onclick = ()=> setMode(b.dataset.mode)); }
function stopPlay(){ playSeq++; const f = playOff; playOff = null; if(f) Promise.resolve(f).then(fn=>{ try{ fn && fn(); }catch(e){} }); }
function setMode(m){ if(m === mode()) return; K.LS.set("turd_ent_mode", m); launcher(); }
function playView(){
  stopPlay();
  const st = stats();
  panel.innerHTML = `
  ${K.head("Entertainment", "ENT", "Your PC games · launch here or from your phone")}
  <div class="ent-stage play">${modesHtml("play")}<div class="gm-root" id="entPlay"></div></div>`;
  wireModes(); setTheme(BASE_THEME); dockNp();
  const seq = playSeq;
  playOff = mountPlay(panel.querySelector("#entPlay"), K, { onTheme: g=>{ if(seq === playSeq) setTheme(gameTheme(g)); } })
    .catch(e=>{ console.warn("[ent] play:", e); const el = panel.querySelector("#entPlay");
      if(el) el.innerHTML = `<div class="gm-msg"><b>Games didn't load</b><p>${K.esc(e.message||String(e))}</p></div>`; return null; });
}
function launcher(){
  if(mode() === "play") return playView();
  stopPlay();
  const list = all(), a = list[focus] || list[0], st = stats();
  const where = B.kind === "tauri" ? "Windows in-app view" : B.kind === "android" ? "Android in-app view" : "Browser preview";
  const rec = recent().slice(0, 6);
  panel.innerHTML = `
  ${K.head("Entertainment", "ENT", `${where} · ${fmt(st.blocked)} ads and trackers blocked`)}
  <div class="ent-stage">${modesHtml("watch")}
    <div class="ent-search"><span class="ent-s-ico">⌕</span>
      <input id="entQ" placeholder="Search ${K.esc(a.name)}" autocomplete="off" spellcheck="false">
      <span class="ent-s-app" id="entQApp">${K.esc(a.name)}</span></div>
    <div class="ent-row" id="entRow">${list.map(tile).join("")}
      <button class="ent-tile add" data-add="1" aria-label="Add a site"><span class="ent-orb"><span class="ent-glyph">${GLYPHS.add}</span></span>
        <span class="ent-name">Add a site</span><span class="ent-tag">any link, same shield</span></button></div>
    <div class="ent-sub" id="entSub"></div>
    ${rec.length?`<div class="ent-recent"><div class="ent-cap">Recently watched</div><div class="ent-rec-row">${rec.map((r,i)=>{
      const ap = list.find(x=>x.id===r.app); if(!ap) return ""; const t = ap.theme || BASE_THEME;
      return `<button class="ent-rec" data-rec="${i}" style="--c:${t.accent}"><span class="ent-rec-g">${GLYPHS[ap.id]||GLYPHS.web}</span>
        <span class="ent-rec-t">${K.esc((r.title||r.url).slice(0,70))}</span><span class="ent-rec-a">${K.esc(ap.name)}</span></button>`; }).join("")}</div></div>`:""}
  </div>`;
  renderSub();
  layoutRow(); wireModes(); dockNp();
  const row = panel.querySelector("#entRow");
  row.addEventListener("click", e=>{
    const b = e.target.closest(".ent-tile"); if(!b) return;
    if(b.dataset.add) return addSite();
    const i = +b.dataset.i; if(i === focus) launch(all()[i]); else { focus = i; sub = 0; refocus(); }
  });
  row.addEventListener("pointerover", e=>{ const b = e.target.closest(".ent-tile[data-i]"); if(b && +b.dataset.i !== focus && matchMedia("(hover:hover)").matches){ focus = +b.dataset.i; sub = 0; refocus(); } });
  panel.querySelector("#entSub").addEventListener("click", e=>{ const b = e.target.closest("[data-k]"); if(b){ sub = +b.dataset.n; act(b.dataset.k); } });
  panel.querySelectorAll("[data-rec]").forEach(b=> b.onclick = ()=>{ const r = recent()[+b.dataset.rec]; const ap = all().find(x=>x.id===r.app); if(ap) launch(ap, r.url); });
  const q = panel.querySelector("#entQ");
  q.addEventListener("keydown", e=>{
    if(e.key === "Enter" && q.value.trim()){ e.preventDefault(); const ap = all()[focus]; search(ap, q.value.trim()); }
    if((e.key === "ArrowLeft" || e.key === "ArrowRight") && !q.value){ e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1); }
  });
  setTheme((a && a.theme) || BASE_THEME);
}
function renderSub(){
  const el = panel.querySelector("#entSub"), a = all()[focus]; if(!el || !a) return;
  const items = subItems(a); sub = Math.min(sub, items.length-1);
  el.innerHTML = items.map((it, n)=>`<button class="ent-si${n===sub?" on":""}" data-k="${it.k}" data-n="${n}">
    <span class="ent-si-l">${K.esc(it.label)}</span>
    ${"val" in it ? `<span class="ent-sw${it.val?" y":""}"><i></i></span>` : ""}
    ${it.hint?`<span class="ent-si-h">${K.esc(it.hint)}</span>`:""}</button>`).join("");
  if(sub > 0) el.querySelector(".ent-si.on")?.scrollIntoView({ block:"nearest" });   // short windows: keep the picked row on screen
  const qa = panel.querySelector("#entQApp"), q = panel.querySelector("#entQ");
  if(qa) qa.textContent = a.name;
  if(q) q.placeholder = SEARCH[a.id] ? `Search ${a.name}` : `Go to a page on ${a.name}`;
}
// XMB-style curve: tiles bend away from the focused one like the inside of the visor
function layoutRow(){
  const tiles = [...panel.querySelectorAll(".ent-tile")];
  tiles.forEach((t, i)=>{
    const d = i - focus, ad = Math.abs(d);
    t.style.setProperty("--d", d); t.style.setProperty("--ad", ad);
    t.classList.toggle("on", i === focus);
  });
  const on = tiles[focus]; if(on) on.scrollIntoView({ block:"nearest", inline:"center", behavior:"smooth" });
}
function refocus(){ layoutRow(); renderSub(); const a = all()[focus]; if(a) setTheme(a.theme || BASE_THEME); }
function move(d){ const n = all().length; focus = (focus + d + n) % n; sub = 0; refocus(); }

async function act(k){
  const a = all()[focus]; if(!a) return;
  if(k === "open") return launch(a);
  if(k === "resume"){ const r = recent().find(x=>x.app===a.id); return launch(a, r && r.url); }
  if(k === "search"){ const q = panel.querySelector("#entQ"); q.focus(); return; }
  if(k === "remove"){ K.LS.set("turd_ent_custom", custom().filter(x=>x.id!==a.id)); B.close(a.id); opened.delete(a.id); focus = 0; return launcher(); }
  if(k === "shield" || k === "clean" || k === "warm"){
    const p = prefs(a.id); setPref(a.id, k, !p[k]);
    if(k === "warm" && !p.warm && B.kind !== "web" && !opened.has(a.id)){ opened.add(a.id); B.open(openReq(a, null, false)); }
    // shield/clean changes need a fresh page so the new script runs at document-start
    if((k === "shield" || k === "clean") && opened.has(a.id)){ B.close(a.id); opened.delete(a.id); if(prefs(a.id).warm){ opened.add(a.id); B.open(openReq(a, null, false)); } }
    K.toast(`${a.name}: ${k === "warm" ? "keep warm" : k === "clean" ? "clean mode" : "ad shield"} ${!p[k] ? "on" : "off"}`);
    renderSub(); layoutRow();
  }
}
function search(a, q){
  if(/^https?:\/\//i.test(q)) return launch(a, q);
  const base = (mobile() && MSEARCH[a.id]) || SEARCH[a.id];
  if(base) return launch(a, base + encodeURIComponent(q));
  try{ return launch(a, new URL(q.replace(/^\//,""), homeUrl(a)).href); }catch(e){ return launch(a); }
}
function addSite(){
  panel.querySelector(".ent-stage").insertAdjacentHTML("beforeend", `<div class="ent-add" id="entAdd"><form class="ent-add-card">
    <div class="ent-cap">Add a site to the launcher</div>
    <label>Name</label><input id="entAN" placeholder="e.g. Kick" required maxlength="24">
    <label>Link</label><input id="entAU" placeholder="https://kick.com" required>
    <p class="ent-add-n">It opens in the same in-app view with the ad shield on. Known sites (YouTube, TikTok, Twitch, Reddit, SoundCloud links) get their full rules.</p>
    <div class="ent-add-b"><button type="button" class="btn" id="entAC">Cancel</button><button class="btn" type="submit">Add</button></div></form></div>`);
  const box = panel.querySelector("#entAdd"); panel.querySelector("#entAN").focus();
  panel.querySelector("#entAC").onclick = ()=> box.remove();
  box.querySelector("form").onsubmit = e=>{
    e.preventDefault();
    let url = panel.querySelector("#entAU").value.trim(); if(!/^https?:\/\//i.test(url)) url = "https://" + url;
    try{ new URL(url); }catch(err){ K.toast("That link doesn't look right"); return; }
    const name = panel.querySelector("#entAN").value.trim() || new URL(url).hostname;
    const c = custom(); const id = "c_" + Date.now().toString(36);
    c.push({ id, name, url, murl:url, tagline:new URL(url).hostname.replace(/^www\./,""), site:siteFor(url), theme:themeFor(url), warm:false });
    K.LS.set("turd_ent_custom", c); focus = APPS.length + c.length - 1; launcher(); K.toast(`${name} added`);
  };
}

/* ------------------------------------------------------------ viewer */
function viewer(a, url){
  const list = all(), t = a.theme || BASE_THEME;
  panel.innerHTML = `
  <div class="ent-viewer" style="--c:${t.accent};--crgb:${t.rgb}">
    <div class="ent-bar">
      <button class="ent-ib" data-nav="back" title="Back (Alt+←)">‹</button>
      <button class="ent-ib" data-nav="forward" title="Forward (Alt+→)">›</button>
      <button class="ent-ib" data-nav="reload" title="Reload">⟳</button>
      <button class="ent-ib" data-nav="home" title="${K.esc(a.name)} home">⌂</button>
      <div class="ent-apps">${list.map(x=>`<button class="ent-app${x.id===a.id?" on":""}" data-sw="${x.id}" title="${K.esc(x.name)}" style="--c:${(x.theme||BASE_THEME).accent}">${GLYPHS[x.id]||GLYPHS.web}</button>`).join("")}</div>
      <div class="ent-title" id="entTitle">${K.esc(a.name)}</div>
      <div class="ent-shield" id="entShield" title="Ads and trackers blocked in this view">${prefs(a.id).shield ? `<b id="entBlk">0</b> blocked` : `shield off`}</div>
      <button class="ent-ib x" data-nav="exit" title="Close">✕</button>
      <i class="ent-prog" id="entProg"></i>
    </div>
    <div class="ent-vp" id="entVp">
      <div class="ent-boot"><span class="ent-glyph${a.id==="tiktok"?" tt":""}">${GLYPHS[a.id]||GLYPHS.web}</span></div>
    </div>
  </div>`;
  panel.querySelector(".ent-bar").addEventListener("click", e=>{
    const n = e.target.closest("[data-nav]"), s = e.target.closest("[data-sw]");
    if(n){ const k = n.dataset.nav; if(k === "exit") return closeViewer(); if(k === "home") return navTo(homeUrl(active)); if(B.kind === "web") return Demo.nav(k); B.nav(active.id, k); }
    if(s && s.dataset.sw !== active.id){ const ap = all().find(x=>x.id===s.dataset.sw); if(ap) launch(ap); }
  });
  if(B.kind === "web") Demo.mount(panel.querySelector("#entVp"), a, url, K, { onTitle:t=>{ const el = panel.querySelector("#entTitle"); if(el) el.textContent = t; }, onRecent:(u,ti)=>remember(a,u,ti) });
}
function navTo(url){ if(B.kind === "web") return Demo.nav("home"); ensureView(active, url, true); }

async function launch(a, url){
  if(B.kind !== "web") B.hideAll();
  active = a; view = "viewer";
  const s = stats(); s.opens++; K.LS.set("turd_ent_stats", s);
  setTheme(a.theme || BASE_THEME);
  viewer(a, url);
  K.setLoc && K.setLoc(`ent · ${a.name.toLowerCase()}`);
  // wait for layout to settle so the native view lands on the exact viewer rect
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  await ensureView(a, url, true);
}
function closeViewer(){
  if(B.kind !== "web" && active) B.hide(active.id);
  if(B.kind === "web") Demo.unmount();
  view = "launcher"; const i = all().findIndex(x=>active && x.id===active.id); if(i >= 0) focus = i;
  active = null; launcher();
}
function remember(a, url, title){
  if(!url || /^about:/.test(url)) return;
  const home = [a.url, a.murl].filter(Boolean).map(u=>u.replace(/\/+$/,""));
  if(home.includes(url.replace(/\/+$/,""))) return;           // the front page isn't "where you left off"
  const r = recent().filter(x=> !(x.app===a.id && x.url===url) );
  r.unshift({ app:a.id, url, title:(title||"").replace(/\s*[-–|]\s*(YouTube|TikTok|Twitch|Reddit|SoundCloud).*$/i,"").trim(), t:Date.now() });
  K.LS.set("turd_ent_recent", r.slice(0, 24));
}

/* ------------------------------------------------------------ live state from the native views */
async function poll(){
  const st = await B.state(); if(!st || !st.views) return;
  let total = 0;
  for(const [id, v] of Object.entries(st.views)){
    total += v.blocked || 0;
    const prev = lastState[id];
    if(v.url && (!prev || prev.url !== v.url || prev.title !== v.title) && !v.loading){
      const a = all().find(x=>x.id===id); if(a) remember(a, v.url, v.title);
    }
  }
  // persist a lifetime counter across restarts
  const s = stats(); const delta = Math.max(0, total - blockedBase); if(delta){ s.blocked += delta; blockedBase = total; K.LS.set("turd_ent_stats", s); }
  lastState = st.views;
  if(view === "viewer" && active){
    const v = st.views[active.id] || {};
    const ti = panel.querySelector("#entTitle"), bk = panel.querySelector("#entBlk"), pr = panel.querySelector("#entProg");
    if(ti && v.title) ti.textContent = v.title;
    if(bk) bk.textContent = fmt(v.blocked || 0);
    if(pr) pr.classList.toggle("on", !!v.loading);
    panel.querySelector('[data-nav="back"]')?.toggleAttribute("disabled", v.canBack === false);
    panel.querySelector('[data-nav="forward"]')?.toggleAttribute("disabled", v.canForward === false);
  }
}

/* ------------------------------------------------------------ keys */
function onKey(e){
  if(!panel || !panel.isConnected || document.body.dataset.section !== "entertainment") return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if(view === "viewer"){
    if(e.key === "Escape" && !document.querySelector("#modal.show")){ e.preventDefault(); closeViewer(); }
    if(e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")){ e.preventDefault(); const k = e.key === "ArrowLeft" ? "back" : "forward"; B.kind === "web" ? Demo.nav(k) : B.nav(active.id, k); }
    return;
  }
  if(typing || panel.querySelector("#entAdd")) return;
  if(mode() === "play") return playKey(e);
  if((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.altKey){ e.preventDefault(); return setMode("play"); }
  // The rail is vertical: Up/Down keep moving along it, Left/Right always drive the app row.
  const onRail = document.activeElement?.classList?.contains("navbtn");
  const n = subItems(all()[focus] || APPS[0]).length;
  if(e.key === "ArrowLeft"){ e.preventDefault(); e.stopImmediatePropagation(); move(-1); }
  else if(e.key === "ArrowRight"){ e.preventDefault(); e.stopImmediatePropagation(); move(1); }
  else if(onRail && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) return;
  else if(e.key === "ArrowDown"){ e.preventDefault(); sub = (sub + 1) % n; renderSub(); }
  else if(e.key === "ArrowUp"){ e.preventDefault(); sub = (sub - 1 + n) % n; renderSub(); }
  else if(e.key === "Enter"){ e.preventDefault(); const it = subItems(all()[focus])[sub]; if(it) act(it.k); }
  else if(/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey){ const a = all()[+e.key-1]; if(a) launch(a); }
  else if(e.key === "/"){ e.preventDefault(); panel.querySelector("#entQ")?.focus(); }
}

// Play view: arrows walk the cover grid like a console library, Enter launches, Esc / W goes back to Watch
function playKey(e){
  if(e.key === "Escape" || e.key === "w" || e.key === "W"){ if(document.querySelector("#modal.show")) return; e.preventDefault(); return setMode("watch"); }
  if(!/^Arrow/.test(e.key)) return;
  if(document.activeElement?.classList?.contains("navbtn") && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
  const items = [...panel.querySelectorAll(".gm-play, .gm-card")]; if(!items.length) return;
  e.preventDefault(); e.stopImmediatePropagation();
  let i = items.indexOf(document.activeElement);
  if(i < 0){ items[0].focus(); return; }
  const cards = items.filter(x=>x.classList.contains("gm-card"));
  const cols = Math.max(1, cards.filter(c=> cards[0] && c.offsetTop === cards[0].offsetTop).length);
  const isPlay = items[i].classList.contains("gm-play"), ci = isPlay ? -1 : cards.indexOf(items[i]);
  let next = items[i];
  if(e.key === "ArrowRight") next = isPlay ? cards[0] : cards[Math.min(ci+1, cards.length-1)];
  else if(e.key === "ArrowLeft") next = isPlay ? items[i] : ci === 0 ? (items.find(x=>x.classList.contains("gm-play")) || cards[0]) : cards[ci-1];
  else if(e.key === "ArrowDown") next = isPlay ? cards[0] : cards[Math.min(ci+cols, cards.length-1)];
  else if(e.key === "ArrowUp") next = isPlay ? items[i] : ci - cols < 0 ? (items.find(x=>x.classList.contains("gm-play")) || cards[0]) : cards[ci-cols];
  if(next){ next.focus({ preventScroll:true }); next.scrollIntoView({ block:"nearest", behavior:"smooth" }); }
}

/* ------------------------------------------------------------ section */
export default {
  id:"entertainment",
  icon:`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style="display:block"><rect x="2.5" y="5" width="19" height="13" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 8.8v5.4l4.6-2.7z" fill="currentColor"/><path d="M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  label:"Entertain",
  theme: BASE_THEME,
  mount(p, ctx){
    K = ctx; panel = p; ensureCss();
    if(!B) B = createBridge();
    panel.classList.add("t-full","ent-panel");
    view === "viewer" && active ? (viewer(active), ensureView(active, null, true)) : launcher();
    addEventListener("keydown", onKey, true);   // capture: runs before the shell's rail keys
    const place = ()=>{ if(view === "viewer" && active && B.kind !== "web") B.bounds(active.id, rect()); };
    ro = new ResizeObserver(place); ro.observe(panel); addEventListener("resize", place);
    // the section animates in (scale 1.04 → 1); re-place once it has settled
    const sec = panel.parentElement; const te = ()=>place(); sec && sec.addEventListener("transitionend", te);
    offs.push(()=>{ removeEventListener("resize", place); sec && sec.removeEventListener("transitionend", te); });
    watchOverlays();
    if(B.kind !== "web"){
      // native extras must never take the tab down with them
      try{
        setTimeout(()=>warmUp().catch(e=>console.warn("[ent] warm-up:", e)), 350);
        pollT = setInterval(()=>poll().catch(()=>{}), 800);
        offs.push(B.onBack(()=>{ if(view === "viewer") closeViewer(); }));
      }catch(e){ console.warn("[ent] native setup:", e); }
    }
  },
  unmount(){
    removeEventListener("keydown", onKey, true);
    stopPlay();
    if(npOff){ try{ npOff(); }catch(e){} npOff = null; npEl = null; }
    if(ro){ ro.disconnect(); ro = null; }
    clearInterval(pollT); offs.forEach(f=>{ try{ f(); }catch(e){} }); offs = [];
    if(B && B.kind !== "web") B.hideAll();     // stay warm, just out of sight (media is paused natively)
    if(B && B.kind === "web") Demo.unmount();
    if(panel) panel.classList.remove("t-full","ent-panel");
  },
  summary(ctx){
    const s = (ctx.LS || K.LS).get("turd_ent_stats", { blocked:0 }), r = (ctx.LS || K.LS).get("turd_ent_recent", [])[0];
    const np = lastPlaying(ctx.LS || K.LS);
    if(np) return { title:"Now playing", value: (np.title || np.artist || "").slice(0, 28), note: [np.artist, np.app].filter(Boolean).join(" · ") };
    return { title:"Entertainment", value: fmt(s.blocked||0), note: r ? `ads blocked · last: ${(r.title||r.url).slice(0,40)}` : "ads and trackers blocked" };
  },
};
