// ===========================================================================
// PROJECTS — live status board for the owner's sites (3dms.netlify.app and
// its sister relay), with in-helmet previews, launch-inside view, site sync
// that spots what changed, and user-added projects.
// ===========================================================================
import { edgeFades, kit, $, $$, head, tilt, ago } from "./util.js";

let K, panel, stopTilt=()=>{}, view="grid", pingTimer=0;

/* Curated from the live sites on 2026-10-21. Sync refreshes title + section list at runtime. */
export const BUILTIN = [
  { id:"3dms", title:"3D MS", tagline:"Unofficial North Mississippi traffic-camera directory",
    url:"https://3dms.netlify.app", accent:"#2f8cff", glyph:"MS",
    stats:[["78","cameras"],["4","regions"],["5","live feeds"]],
    desc:"Camera wall for Southaven/DeSoto, Oxford, the I-22/US-78 corridor and the Golden Triangle, with in-browser AI detection, MDOT road alerts, NWS alerts and live radar.",
    features:[
      ["AI perception","TensorFlow.js + COCO-SSD vehicle and headlight detection with tracking, running fully in the browser."],
      ["Camera wall","6 / 9 / 12 / 16 grids, zoom, enhancement filters, auto-track, snapshots and saved views."],
      ["Road alerts","Live MDOT statewide alert feed for North MS."],
      ["Weather & radar","Open-Meteo conditions, NWS county alerts and an animated RainViewer radar."],
      ["Local context","Nearest police contacts, town-to-town distance, OpenStreetMap street view."],
      ["Reliability relay","Optional Cloudflare Worker (mdot-proxy-worker.js) that proxies feeds with CORS."],
      ["Auto-populate","Reads each MDOT camera page by site ID to pull stream URLs, 4 at a time."],
      ["Import / export","Directory export and import as .json."],
    ],
    tech:["TensorFlow.js","COCO-SSD","HLS","Cloudflare Workers","Open-Meteo","NWS","RainViewer","OSM"],
    links:[["Official MDOT viewer","https://www.mdottraffic.com/default.aspx?showMain=true"],["Cloudflare dashboard","https://dash.cloudflare.com/"]] },
  { id:"3dtn", title:"3D TN", tagline:"Tennessee + North MS camera relay",
    url:"https://tndot-proxy.ethanyoung2020.workers.dev/", accent:"#3ddc4a", glyph:"TN",
    stats:[["TDOT","ArcGIS feed"],["2","states"],["CF","worker"]],
    desc:"Sister dashboard served from a Cloudflare Worker: TDOT's public ArcGIS camera feed with snapshot fallback, the same AI detection, weather and alert stack.",
    features:[
      ["TDOT cameras","Names and coordinates from TDOT's public ArcGIS camera feed, with tnsnapshots.com fallback."],
      ["Video + snapshot","Video and snapshot modes, zoom, enhancement and fullscreen with auto-track cycling."],
      ["AI perception","Local COCO-SSD detection of vehicles and headlights; nothing uploaded."],
      ["Weather & alerts","Open-Meteo, NWS North MS alerts, MDOT statewide alerts and RainViewer radar."],
      ["Worker relay","Runs on Cloudflare Workers, doubling as the image/video proxy."],
    ],
    tech:["Cloudflare Workers","ArcGIS","TensorFlow.js","Open-Meteo","NWS"],
    links:[["Official TDOT SmartWay","https://smartway.tn.gov/traffic-app"]] },
];

const custom = ()=> K.LS.get("turd_prj_custom",[]);
const all = ()=> [...BUILTIN, ...custom()];
const status = ()=> K.LS.get("turd_prj_status",{});
const syncs = ()=> K.LS.get("turd_prj_cache",{});

/* ------------------------------------------------------------ status ping
   up:true = reached it · up:false = confirmed down · up:null = couldn't check.
   A failed request alone never means "down": the app may be offline, inside a
   sandboxed preview, or behind a strict content policy. So we also probe
   control hosts; only if those answer and the site still fails twice is it
   down. Native builds pass a CORS-free ctx.http, which also exposes HTTP status. */
const CONTROLS = ["https://www.gstatic.com/generate_204","https://1.1.1.1/cdn-cgi/trace"];
// Content-Security-Policy blocks (sandboxed previews, embedded webviews) announce themselves
// with a securitypolicyviolation event; a site we were *forbidden* to contact is "unknown", never "down".
const cspBlocked=new Set();
try{ document.addEventListener("securitypolicyviolation",e=>{ try{ cspBlocked.add(new URL(e.blockedURI).origin); }catch(_){ if(e.blockedURI) cspBlocked.add(e.blockedURI); } }); }catch(e){}
async function probe(http, url, ms=8000){
  const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),ms), t0=performance.now();
  const origin=new URL(url).origin;
  try{
    const r=await http(url,{mode:"no-cors",cache:"no-store",signal:ctl.signal,redirect:"follow"});
    // a real (non-opaque) response from a native/CORS-free fetch: 5xx means the site itself is broken
    if(r && r.type!=="opaque" && typeof r.status==="number" && r.status>=500) return {ok:false, hard:true, status:r.status};
    return {ok:true, ms:Math.round(performance.now()-t0)};
  }catch(e){ await new Promise(z=>setTimeout(z,0)); return {ok:false, csp:cspBlocked.has(origin)||cspBlocked.has("connect-src")}; }
  finally{ clearTimeout(to); }
}
let netCache={t:0, ok:null};
async function netWorks(http){
  if(navigator.onLine===false) return false;
  if(Date.now()-netCache.t<60e3) return netCache.ok;
  const rs=await Promise.all(CONTROLS.map(u=>probe(http,u,5000)));
  netCache={t:Date.now(), ok:rs.some(r=>r.ok)};
  return netCache.ok;
}
export async function ping(http=fetch, list){
  const out=K?status():JSON.parse(localStorage.getItem("turd_prj_status")||"{}");
  await Promise.all(list.map(async p=>{
    let r=await probe(http,p.url);
    if(r.csp){ out[p.id]={up:null, ms:null, t:Date.now(), why:"blocked"}; return; }
    if(!r.ok && !r.hard){ await new Promise(z=>setTimeout(z,1500)); r=await probe(http,p.url); }   // one retry for blips
    if(r.ok){ out[p.id]={up:true, ms:r.ms, t:Date.now()}; return; }
    if(r.hard){ out[p.id]={up:false, ms:null, code:r.status, t:Date.now()}; return; }
    const net=await netWorks(http);
    out[p.id]= net ? {up:false, ms:null, t:Date.now()} : {up:null, ms:null, t:Date.now(), why:navigator.onLine===false?"offline":"blocked"};
  }));
  try{ localStorage.setItem("turd_prj_status",JSON.stringify(out)); }catch(e){}
  return out;
}

/* ------------------------------------------------------------ site sync: read title + headings, diff vs last time */
async function sync(p){
  try{
    const r=await K.http(p.url,{cache:"no-store"}); const html=await r.text();
    const doc=new DOMParser().parseFromString(html,"text/html");
    const heads=[...doc.querySelectorAll("h1,h2,h3")].map(h=>h.textContent.trim().replace(/\s+/g," ")).filter(Boolean).slice(0,40);
    const s=syncs(), prev=s[p.id];
    const added = prev ? heads.filter(h=>!prev.heads.includes(h)) : [];
    s[p.id]={t:Date.now(), title:doc.title||p.title, heads, added};
    K.LS.set("turd_prj_cache",s);
    return {ok:true, added};
  }catch(e){ return {ok:false}; }
}

/* ------------------------------------------------------------ views */
function card(p, i){
  const st=status()[p.id], sy=syncs()[p.id];
  const dot = !st ? "pending" : st.up ? "up" : st.up===false ? "down" : "unk";
  return `<article class="pj-card t-tilt" data-id="${K.esc(p.id)}" style="--pc:${K.esc(p.accent||"var(--accent)")};animation-delay:${i*80}ms">
    <div class="pj-screen">
      <div class="pj-glyph">${K.esc(p.glyph||p.title.slice(0,2).toUpperCase())}</div>
      ${p.features?.length?`<ul class="pj-mods">${p.features.slice(0,5).map(([n])=>`<li>${K.esc(n)}</li>`).join("")}</ul>`:""}
      <div class="pj-scan"></div>
    </div>
    <div class="pj-body">
      <div class="pj-top"><h3>${K.esc(p.title)}</h3><span class="pj-st ${dot}"><i></i>${dot==="up"?`online · ${st.ms} ms`:dot==="down"?(st.code?`down · HTTP ${st.code}`:"down"):dot==="unk"?(st.why==="offline"?"you're offline":"can't check from here"):"checking…"}</span></div>
      <p class="pj-tag">${K.esc(p.tagline||"")}</p>
      ${p.stats?`<div class="pj-stats">${p.stats.map(([v,l])=>`<div><b>${K.esc(v)}</b><span>${K.esc(l)}</span></div>`).join("")}</div>`:""}
      ${sy&&sy.added&&sy.added.length?`<div class="pj-new">New on site: ${sy.added.slice(0,3).map(K.esc).join(", ")}</div>`:""}
      <div class="pj-foot"><span class="t-s">${(p.tech||[]).slice(0,4).map(K.esc).join(" · ")}</span><span class="pj-open">Open ▸</span></div>
    </div></article>`;
}

function grid(){
  view="grid";
  const list=all(), st=status(), up=list.filter(p=>st[p.id]?.up).length;
  panel.innerHTML = head("Projects","PRJ",`<span class="wx-tools"><button class="t-link" id="pjPing">⟳ Check status</button><button class="t-link" id="pjAdd">＋ Add project</button></span>`)+`
    <div class="pj-summary">
      <div><b>${list.length}</b><span>projects</span></div>
      <div><b class="ok">${up}</b><span>online</span></div>
      <div><b>${list.reduce((n,p)=>n+(p.features?.length||0),0)}</b><span>modules tracked</span></div>
      <div><b>${st[list[0]?.id]?.t?ago(st[list[0].id].t):"—"}</b><span>last check</span></div>
    </div>
    <div class="pj-grid">${list.map(card).join("")}</div>`;
  $("#pjPing",panel).onclick=()=>doPing(true);
  $("#pjAdd",panel).onclick=addForm;
  $$(".pj-card",panel).forEach(c=>{ c.onclick=()=>detail(c.dataset.id);
    c.tabIndex=0; c.setAttribute("role","button"); c.setAttribute("aria-label",`Open ${c.querySelector("h2,h3,.pj-title")?.textContent||"project"} details`);
    c.onkeydown=e=>{ if(e.target===c && (e.key==="Enter"||e.key===" ")){ e.preventDefault(); c.click(); } }; });
  // stagger iframe loads so we never stall the render thread
  stopTilt(); stopTilt=tilt(panel,".pj-card",7);
}

function detail(id){
  const p=all().find(x=>x.id===id); if(!p) return;
  view="detail";
  const st=status()[p.id], sy=syncs()[p.id], isCustom=!BUILTIN.some(b=>b.id===p.id);
  panel.innerHTML = head(K.esc(p.title),"PRJ",`<span class="wx-tools"><button class="t-link" id="pjBack">◂ All projects</button></span>`)+`
    <div class="pj-detail" style="--pc:${K.esc(p.accent||"var(--accent)")}">
      <div class="pj-live t-curve">
        <div class="pj-live-bar"><span class="pj-st ${st?.up?"up":st?.up===false?"down":"pending"}"><i></i>${st?.up?`online · ${st.ms} ms`:st?.up===false?"down":st?"can't check from here":"not checked"}</span>
          <span class="t-s">${K.esc(p.url)}</span>
          <a class="t-btn sm" href="${K.esc(p.url)}" target="_blank" rel="noopener">Open in browser ↗</a></div>
        <div class="pj-live-box"><div class="pj-live-ph"><div class="pj-glyph big">${K.esc(p.glyph||"")}</div><button class="t-btn" id="pjLaunch">▶ Launch inside the helmet</button>
          <p class="t-s">Runs the live site right here. If it stays blank, the site blocks embedding; use Open in browser.</p></div></div>
      </div>
      <div class="pj-info">
        <p class="pj-desc">${K.esc(p.desc||p.tagline||"")}</p>
        ${p.features?.length?`<div class="t-cap">Modules</div><div class="pj-feats">${p.features.map(([n,d])=>`<div class="pj-feat"><b>${K.esc(n)}</b><span>${K.esc(d)}</span></div>`).join("")}</div>`:""}
        ${p.tech?.length?`<div class="t-cap">Stack</div><p class="pj-tech">${p.tech.map(K.esc).join("  ·  ")}</p>`:""}
        ${p.links?.length?`<div class="t-cap">Related</div>${p.links.map(([n,u])=>`<a class="t-arrow" href="${K.esc(u)}" target="_blank" rel="noopener">${K.esc(n)} ↗</a>`).join("")}`:""}
        <div class="t-cap">Site sync</div>
        <p class="t-s" id="pjSyncTxt">${sy?`Last synced ${ago(sy.t)} · ${sy.heads.length} sections read${sy.added?.length?` · new: ${sy.added.map(K.esc).join(", ")}`:""}`:"Not synced yet. Sync reads the site's sections so T.U.R.D. can tell you what changed."}</p>
        <div class="row" style="gap:10px;margin-top:8px"><button class="t-btn sm" id="pjSync">⟳ Sync now</button>${isCustom?`<button class="t-btn sm danger" id="pjDel">Remove project</button>`:""}</div>
      </div>
    </div>`;
  $("#pjBack",panel).onclick=grid;
  const launch=()=>{ const box=$(".pj-live-box",panel); if(!box||box.querySelector("iframe")) return;
    box.insertAdjacentHTML("beforeend",`<iframe class="pj-full" src="${K.esc(p.url)}" title="${K.esc(p.title)}" allow="fullscreen" referrerpolicy="no-referrer"></iframe>`);
    const f=box.querySelector("iframe"); f.onload=()=>f.classList.add("on"); };
  $("#pjLaunch",panel).onclick=launch;
  if(!p.noFrame && K.LS.get("turd_prj_autolaunch",false)) setTimeout(launch,250);
  $("#pjSync",panel).onclick=async()=>{ $("#pjSyncTxt",panel).textContent="Syncing…"; const r=await sync(p);
    if(r.ok){ K.toast(r.added.length?`${r.added.length} new section(s) on ${p.title}`:`${p.title} synced, no changes`); detail(id); }
    else $("#pjSyncTxt",panel).textContent="The browser blocked reading this site (CORS). Sync works in the Windows and Android app builds."; };
  const del=$("#pjDel",panel); if(del) del.onclick=()=>{ K.LS.set("turd_prj_custom",custom().filter(x=>x.id!==id)); K.toast("project removed"); grid(); };
  stopTilt();
}

function addForm(){
  view="add";
  panel.innerHTML = head("Add project","PRJ",`<span class="wx-tools"><button class="t-link" id="pjBack">◂ Cancel</button></span>`)+`
    <form class="pj-form" id="pjForm">
      <div><label>Name</label><input name="title" required maxlength="40" placeholder="My new build"></div>
      <div><label>Link</label><input name="url" required type="url" placeholder="https://…"></div>
      <div class="full"><label>What is it?</label><input name="tagline" maxlength="90" placeholder="One line so future-you remembers"></div>
      <div class="full"><label>Stack (comma separated)</label><input name="tech" placeholder="Three.js, Netlify"></div>
      <div><label>Color</label><input name="accent" type="color" value="#2f8cff"></div>
      <div class="full row" style="justify-content:flex-end"><button class="t-btn" type="submit">Save project</button></div>
    </form>`;
  $("#pjBack",panel).onclick=grid;
  $("#pjForm",panel).onsubmit=e=>{ e.preventDefault(); const f=new FormData(e.target);
    let url=String(f.get("url")).trim(); if(!/^https?:\/\//i.test(url)){ K.toast("link must start with http(s)://"); return; }
    const p={ id:"c"+Date.now().toString(36), title:String(f.get("title")).trim(), url, tagline:String(f.get("tagline")||"").trim(),
      tech:String(f.get("tech")||"").split(",").map(s=>s.trim()).filter(Boolean), accent:String(f.get("accent")), glyph:String(f.get("title")).trim().slice(0,2).toUpperCase() };
    K.LS.set("turd_prj_custom",[...custom(),p]); K.toast("project added"); grid(); doPing(false); };
}

async function doPing(loud){
  const r=await ping(K.http, all());
  if(panel && view==="grid") grid();
  if(loud){ const v=all().map(p=>r[p.id]||{}), up=v.filter(x=>x.up).length, unk=v.filter(x=>x.up==null).length;
    K.toast(unk===v.length?"can't reach the network to check status":`${up}/${v.length} projects online${unk?` · ${unk} unchecked`:""}`); }
}

let stopFades=()=>{};
export default {
  id:"projects", icon:"▦", label:"Projects",
  theme:{ accent:"#3ddc4a", accent2:"#107c10", rgb:"61,220,74", bg:"#04140a", bg2:"#0a2414" },
  mount(el, ctx){ K=kit(ctx); panel=el; stopFades(); stopFades=edgeFades(el); el.classList.add("t-full","t-sec-pj"); grid(); doPing(false);
    clearInterval(pingTimer); pingTimer=setInterval(()=>doPing(false), 5*60e3); },
  // live sites (TF.js camera walls) keep running in hidden iframes, so tear them down on leave
  unmount(){ if(panel) panel.querySelectorAll("iframe").forEach(f=>{ f.src="about:blank"; f.remove(); }); stopFades(); stopFades=()=>{}; stopTilt(); clearInterval(pingTimer); panel=null; },
  async summary(ctx){ K=K||kit(ctx); const list=all(); let st=status();
    if(!Object.keys(st).length || Date.now()-(Object.values(st)[0]?.t||0)>5*60e3) st=await ping(K.http,list);
    return { total:list.length, up:list.filter(p=>st[p.id]?.up).length, unknown:list.filter(p=>st[p.id]?.up==null).length,
      items:list.map(p=>({id:p.id,title:p.title,url:p.url,up:st[p.id]?.up,ms:st[p.id]?.ms,added:syncs()[p.id]?.added||[]})) }; },
};
