// ===========================================================================
// EXTRAS: optional tools and an offline library for T.U.R.D.
// The kind of stuff people load onto small PCs, Steam Decks and go-bags:
// tiny Wikipedias, medical and survival references, repair guides, maps,
// books, local AI, and the apps that use them, split by Windows / Android.
//
//   Home       kits + staff picks + quick links
//   Library    Kiwix ZIM content (works on both platforms)
//   Apps       installable tools for the chosen platform
//   Local AI   runners + models
//   Guide      first aid / survival / radio reference, built in, no download
//   Tools      Morse, SOS light, compass, sun & moon, converters, CPR metronome
//   Downloads  what's on this device, progress, remove
//   Reader     opens .zim files right here (extras/zim.js)
//
// Native installs run through window.TURD_NATIVE.extras (src/native.js).
// In a plain browser it shows the verified official links instead.
// ===========================================================================
import { CATS, LIBRARY, APPS, AI, MODELS, KITS, ALL, CHECKED, byId } from "./extras/catalog.js";
import { GUIDE_GROUPS, GOBAG, MORSE } from "./extras/guide.js";
import { createEngine } from "./extras/engine.js";
import { TOOLS, mountTool } from "./extras/tools.js";

const THEME = { accent:"#ffc93c", accent2:"#e07a00", rgb:"255,201,60" };
const ICON = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style="display:block" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M8.2 8.6 12 12.4l3.8-3.8"/><path d="M4 13.5h3.6l1.6 2.6h5.6l1.6-2.6H20v5.3a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 18.8z"/></svg>`;
const TABS = [["home","Home"],["library","Library"],["apps","Apps"],["ai","Local AI"],["guide","Field Guide"],["tools","Tools"],["downloads","Downloads"]];

let K, panel, E, view = "home", cat = null, q = "", plat = null, guideSel = null, toolSel = null, toolOff = null;
let reader = null, readerHost = null, sysInfo = null, ollama = null, raf = 0, pendingIds = new Set(), queue = [], running = 0;

/* ------------------------------------------------------------ utils */
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtMB = mb=> mb==null ? "?" : mb>=1024 ? (mb/1024).toFixed(mb>=10240?0:1)+" GB" : mb>=1 ? Math.round(mb)+" MB" : Math.max(1,Math.round(mb*1024))+" KB";
const fmtB = b=> fmtMB(b/1048576);
const hue = id=>{ let h=0; for(const c of id) h=(h*31+c.charCodeAt(0))%360; return h; };
const mbFor = (it, p=plat)=> it.kind==="app" ? (p==="win" ? it.win && it.win.mb : it.and && it.and.mb) : it.mb;
const verified = (it, p=plat)=> it.kind==="app" ? !!(p==="win" ? it.win && (it.win.v || it.win.wg) : it.and && it.and.v) : !!it.v;
const inPlat = it=> E.available(it, plat);
const PLAT = { win:"Windows", and:"Android" };
const mono = it=>{ const w = it.name.replace(/[^A-Za-z0-9 ]/g," ").split(/\s+/).filter(Boolean); return ((w[0]||"?")[0] + (w[1]&&/^[A-Z0-9]/.test(w[1])?w[1][0]:(w[0]||"")[1]||"")).toUpperCase(); };

function ensureCss(){
  if(document.getElementById("xtr-css")) return;
  const l=document.createElement("link"); l.id="xtr-css"; l.rel="stylesheet"; l.href=new URL("./extras/extras.css", import.meta.url).href; document.head.appendChild(l);
}

/* ------------------------------------------------------------ shell */
function frame(){
  panel.innerHTML = K.head("Extras","XTR",`offline library · tools · checked ${CHECKED}`) + `
    <div class="xx-top">
      <div class="xx-plat" role="tablist" aria-label="Platform">
        <button class="xx-pl" data-plat="win" role="tab"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 5.3 10.4 4.3v7.1H3zM11.3 4.2 21 2.8v8.6h-9.7zM3 12.4h7.4v7.2L3 18.6zM11.3 12.4H21V21l-9.7-1.3z"/></svg>Windows</button>
        <button class="xx-pl" data-plat="and" role="tab"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.2 9h9.6v8.2a1.3 1.3 0 0 1-1.3 1.3h-.9V21a1.2 1.2 0 0 1-2.4 0v-2.5h-.4V21a1.2 1.2 0 0 1-2.4 0v-2.5h-.9a1.3 1.3 0 0 1-1.3-1.3zM5.2 9a1.1 1.1 0 0 1 1.1 1.1v4.7a1.1 1.1 0 0 1-2.2 0v-4.7A1.1 1.1 0 0 1 5.2 9m13.6 0a1.1 1.1 0 0 1 1.1 1.1v4.7a1.1 1.1 0 0 1-2.2 0v-4.7A1.1 1.1 0 0 1 18.8 9M7.3 8.2a4.9 4.9 0 0 1 2.4-3.7l-.9-1.6.4-.3 1 1.6a5 5 0 0 1 3.6 0l1-1.6.4.3-.9 1.6a4.9 4.9 0 0 1 2.4 3.7zm2.5-2a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1m4.4 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1"/></svg>Android</button>
      </div>
      <div class="xx-store" id="xxStore"></div>
      <div class="xx-search"><input id="xxQ" placeholder="Search everything: wikipedia, cpr, vpn, morse…" autocomplete="off" spellcheck="false" value="${esc(q)}"></div>
    </div>
    <nav class="xx-tabs">${TABS.map(([id,l])=>`<button class="t-link" data-view="${id}">${l}${id==="downloads"?`<sup id="xxDlN"></sup>`:""}</button>`).join("")}<button class="t-link xx-rtab" data-view="reader" hidden>Reader</button></nav>
    <div class="xx-body" id="xxBody"></div>`;
  panel.querySelector("#xxQ").addEventListener("input", e=>{ q = e.target.value; if(q && view==="reader") view="home"; draw(); });
  panel.addEventListener("click", onClick);
  panel.addEventListener("change", onChange);
}
function chrome(){
  panel.querySelectorAll("[data-plat]").forEach(b=>{ const on=b.dataset.plat===plat; b.classList.toggle("on",on); b.setAttribute("aria-selected",on); });
  panel.querySelectorAll(".xx-tabs [data-view]").forEach(b=>b.classList.toggle("on", !q && b.dataset.view===view));
  const rt = panel.querySelector(".xx-rtab"); if(rt) rt.hidden = !reader;
  const n = Object.values(E.all()).filter(s=>s.st==="active"||s.st==="resolving"||s.st==="verifying").length, sup = panel.querySelector("#xxDlN");
  if(sup) sup.textContent = n ? n : "";
  store();
}
function store(){
  const el = panel.querySelector("#xxStore"); if(!el) return;
  const st = E.all(), have = Object.entries(st).filter(([,s])=>s.st==="done"||s.st==="installed"), used = have.reduce((a,[,s])=>a+(s.total||0),0);
  const free = sysInfo && sysInfo.freeBytes;
  el.innerHTML = `<span class="xx-mode ${E.native?"live":""}">${E.native ? `● ${PLAT[E.plat]} app: installs in place` : "● Browser preview: official links"}</span>`
    + (free && !sysInfo.web ? `<span>${fmtB(free)} free</span>` : "")
    + (have.length ? `<span>${have.length} on device${used>1048576?" · "+fmtB(used):""}</span>` : "");
}

/* ------------------------------------------------------------ cards */
function actions(it){
  const s = E.state(it.id) || {}, links = E.links(it, plat), main = links.find(l=>l.main) || links[0];
  const busy = s.st==="active"||s.st==="resolving"||s.st==="verifying";
  let a = "";
  if(it.kind==="zim" && (s.st==="done") ) a += `<button class="t-btn sm" data-act="read" data-id="${it.id}">Read</button>`;
  if(it.kind==="app" && s.st==="installed" && plat==="and" && E.native) a += `<button class="t-btn sm" data-act="launch" data-id="${it.id}">Launch</button>`;
  if(busy) a += `<button class="t-btn sm ghost" data-act="cancel" data-id="${it.id}">Pause</button>`;
  else if(s.st==="done"||s.st==="installed") a += `<button class="xc-x" data-act="remove" data-id="${it.id}" title="Remove from this device">Remove</button>`;
  else if(E.native) a += `<button class="t-btn sm" data-act="install" data-id="${it.id}">${s.st==="paused"?"Resume":s.st==="error"?"Retry":it.kind==="app"?"Install":it.kind==="ollama"?"Pull":"Download"}</button>`;
  else if(main) a += `<a class="t-btn sm" href="${esc(main.url)}" target="_blank" rel="noopener" data-act="ext" data-id="${it.id}">${it.kind==="app"||it.kind==="ollama"?"Get":"Download"} ↗</a>`;
  const more = links.filter(l=>l!==main);
  if(!busy && more.length) a += more.map(l=>`<a class="xc-l" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
  const cmd = E.wingetCmd(it); if(cmd && (plat==="win" || it.kind==="ollama") && !E.native) a += `<button class="xc-l" data-act="copy" data-cmd="${esc(cmd)}" title="${esc(cmd)}">Copy command</button>`;
  return a;
}
function progress(it){
  const s = E.state(it.id); if(!s) return "";
  if(s.st==="resolving") return `<div class="xc-prog"><i class="ind"></i><span>Finding the newest official build…</span></div>`;
  if(s.st==="active"||s.st==="verifying"||s.st==="paused"){
    const pct = s.total ? Math.min(100, s.got/s.total*100) : 0, bps = E.speed(it.id), eta = bps>0 && s.total ? (s.total-s.got)/bps : 0;
    const line = s.st==="verifying" ? "Checking SHA-256…" : s.st==="paused" ? `Paused at ${fmtB(s.got||0)}` :
      `${fmtB(s.got||0)}${s.total?" / "+fmtB(s.total):""}${bps>0?` · ${fmtB(bps)}/s`:""}${eta>0?` · ${eta>5400?Math.round(eta/3600)+" h":eta>90?Math.round(eta/60)+" min":Math.round(eta)+" s"} left`:""}`;
    return `<div class="xc-prog"><i style="width:${pct.toFixed(1)}%" class="${s.total?"":"ind"}"></i><span>${line}${s.line?` · ${esc(s.line)}`:""}</span></div>`;
  }
  if(s.st==="error") return `<div class="xc-prog err"><span>${esc(s.err||"failed")}</span></div>`;
  if(s.st==="done"||s.st==="installed") return `<div class="xc-ok">${s.st==="installed"?"Installed":"On this device"}${s.version?` · ${esc(s.version)}`:""}${s.verified?" · SHA-256 verified":""}</div>`;
  return "";
}
function card(it, opts={}){
  const c = CATS[it.cat] || {}, mb = mbFor(it), v = verified(it);
  const src = it.kind==="app" ? (plat==="win" ? (it.win && (it.win.wg ? "winget · "+it.win.wg : it.win.page ? new URL(it.win.page||it.win.url).host : new URL(it.win.url).host)) : (it.and && (it.and.fd ? "F-Droid" : it.and.play ? "Google Play" : it.and.page ? new URL(it.and.page).host : ""))) : it.src;
  const note = it.kind==="app" && (plat==="win" ? it.win && it.win.note : it.and && it.and.note);
  return `<article class="xc ${it.star?"star":""} ${opts.wide?"wide":""}" data-id="${it.id}" style="--h:${hue(it.id)}">
    <div class="xc-art"><span class="g">${esc(c.icon||"◆")}</span><span class="m">${esc(mono(it))}</span></div>
    <div class="xc-body">
      <h3>${esc(it.name)}${it.star?`<span class="xc-star" title="Staff pick">★</span>`:""}</h3>
      <p>${esc(it.desc)}${note?` <span class="xc-note">${esc(note)}.</span>`:""}</p>
      <div class="xc-meta">${mb?`<b>${fmtMB(mb)}</b>`:`<b>size on install</b>`}${v&&mb?`<span class="ok" title="Size checked against the official source on ${CHECKED}">✓ checked</span>`:""}${it.ram?`<span>needs ~${it.ram} GB RAM</span>`:""}${src?`<span>${esc(src)}</span>`:""}${it.big?`<span class="warn">external drive</span>`:""}</div>
      ${progress(it)}
      <div class="xc-act">${actions(it)}</div>
    </div></article>`;
}
function refreshCard(id){
  const el = panel && panel.querySelector(`.xc[data-id="${CSS.escape(id)}"]`); const it = byId(id);
  if(!el || !it) return;
  const tmp = document.createElement("div"); tmp.innerHTML = card(it, { wide:el.classList.contains("wide") }); el.replaceWith(tmp.firstElementChild);
}

/* ------------------------------------------------------------ views */
function draw(){
  if(!panel) return;
  if(toolOff && !(view==="tools" && toolSel)){ toolOff(); toolOff=null; }
  chrome();
  const body = panel.querySelector("#xxBody");
  if(readerHost) readerHost.hidden = view!=="reader" || !!q;
  body.hidden = view==="reader" && !q;
  if(q) return search(body);
  if(view==="reader"){ showReader(); return; }
  ({ home, library:list("library"), apps:list("apps"), ai, guide, tools, downloads })[view](body);
  body.scrollTop = 0;
}
const list = tab => body => {
  const cats = Object.entries(CATS).filter(([,c])=>c.tab===tab);
  const items = (tab==="library" ? LIBRARY : APPS).filter(inPlat);
  if(cat && !cats.some(([k])=>k===cat)) cat = null;
  const shown = cat ? items.filter(i=>i.cat===cat) : items;
  const counts = Object.fromEntries(cats.map(([k])=>[k, items.filter(i=>i.cat===k).length]));
  body.innerHTML = `<div class="xx-split">
    <aside class="xx-cats"><button class="${cat?"":"on"}" data-cat="">All <span>${items.length}</span></button>${cats.filter(([k])=>counts[k]).map(([k,c])=>`<button class="${cat===k?"on":""}" data-cat="${k}"><i>${esc(c.icon)}</i>${esc(c.label)} <span>${counts[k]}</span></button>`).join("")}
      ${tab==="library" ? `<div class="xx-aside-note">Every library item is a Kiwix <b>.zim</b> file. Read it here in the <b>Reader</b>, or in the Kiwix app on any device. New builds land monthly; installs always fetch the newest one.</div>`
        : `<div class="xx-aside-note">Showing <b>${PLAT[plat]}</b> builds. ${plat==="win"?"Installs use winget when it's on the PC, otherwise the official installer with its SHA-256 from the winget manifest.":"APKs come from F-Droid or the developer; apps that only ship on Google Play open there."}</div>`}
    </aside>
    <div class="xx-grid">${shown.map(i=>card(i)).join("") || `<div class="t-empty sm"><h3>Nothing for ${PLAT[plat]} here</h3><p class="t-s">Switch platform at the top.</p></div>`}</div></div>`;
};
function kitItems(k){ return ALL.filter(i=>i.kits && i.kits.includes(k.id) && inPlat(i)); }
function home(body){
  const picks = [...LIBRARY, ...APPS, ...AI, ...MODELS].filter(i=>i.star && inPlat(i)).slice(0, 12);
  body.innerHTML = `
    <section class="xx-hero">
      <div class="xx-hero-l"><div class="t-cap">Offline library, ready in one tap</div>
        <h2>Carry the internet's most useful knowledge in your pocket.</h2>
        <p class="t-s">${LIBRARY.length} libraries · ${APPS.filter(a=>a.win).length} Windows apps · ${APPS.filter(a=>a.and).length} Android apps · ${AI.length+MODELS.length} local-AI picks · a built-in field guide. Every link and size checked against the official source on ${CHECKED}.</p>
        <div class="xx-hero-b"><button class="t-btn" data-act="openzim">Open a .zim file</button><button class="t-link" data-view="guide">Field guide →</button><button class="t-link" data-view="tools">Tools →</button></div></div>
      <div class="xx-quick">${[["fa-cpr","CPR"],["fa-bleed","Bleeding"],["fa-choke","Choking"],["sv-water","Safe water"],["cm-key","Emergency radio"],["fa-stroke","Stroke"]].map(([id,l])=>`<button data-guide="${id}"><b>${l}</b><span>works offline</span></button>`).join("")}</div>
    </section>
    <div class="t-cap">Kits <span class="t-k">${PLAT[plat]} · one tap installs the whole set</span></div>
    <div class="xx-kits">${KITS.map(k=>{ const its=kitItems(k); if(!its.length) return ""; const tot=its.reduce((a,i)=>a+(mbFor(i)||0),0);
      const done = its.filter(i=>{ const s=E.state(i.id); return s && (s.st==="done"||s.st==="installed"); }).length;
      return `<div class="xx-kit" style="--h:${hue(k.id)}"><h3>${esc(k.name)}</h3><p>${esc(k.blurb)}</p>
        <div class="xx-kit-list">${its.map(i=>`<span class="${(E.state(i.id)||{}).st==="done"||(E.state(i.id)||{}).st==="installed"?"ok":""}">${esc(i.name.split(" (")[0])}</span>`).join("")}</div>
        <div class="xx-kit-f"><b>${its.length} items · ${fmtMB(tot)}</b>${done?`<span>${done}/${its.length} on device</span>`:""}<button class="t-btn sm" data-kit="${k.id}">${E.native?"Install kit":"Get kit"}</button></div></div>`; }).join("")}</div>
    <div class="t-cap">Staff picks for ${PLAT[plat]}</div>
    <div class="xx-grid">${picks.map(i=>card(i)).join("")}</div>`;
}
function ai(body){
  const runners = AI.filter(inPlat), models = MODELS.filter(m=> m.kind==="gguf" || plat==="win");
  const ol = plat==="win" ? (ollama ? `<span class="ok">● Ollama is running · ${ollama.models.length} model${ollama.models.length===1?"":"s"} installed</span>` : `<span class="warn">● Ollama isn't running on this PC. Install it below, then pull a model.</span>`) : "";
  body.innerHTML = `<div class="xx-ai-top"><div><div class="t-cap">Private AI that runs on your own ${plat==="win"?"PC":"phone"}</div>
      <p class="t-s">No account, no internet once downloaded. Rule of thumb: you need free RAM about 1.2× the model size. ${plat==="win"?"T.U.R.D. pulls Ollama models directly and the Assistant can use them as its offline brain.":"Download a GGUF here, then load it in PocketPal, Maid or another runner."}</p></div><div class="xx-ai-st">${ol}</div></div>
    <div class="t-cap">Runners</div><div class="xx-grid">${runners.map(i=>card(i)).join("") || `<p class="t-s">No runners for this platform.</p>`}</div>
    <div class="t-cap">Models</div><div class="xx-grid">${models.map(i=>card(i)).join("")}</div>`;
}
function guide(body){
  const flat = GUIDE_GROUPS.flatMap(g=>g.items.map(i=>({...i,g:g.id})));
  const sel = flat.find(i=>i.id===guideSel) || flat[0];
  guideSel = sel.id;
  body.innerHTML = `<div class="xx-split guide">
    <aside class="xx-cats xg-nav">${GUIDE_GROUPS.map(g=>`<div class="xg-g">${esc(g.label)}</div>${g.items.map(i=>`<button class="${i.id===sel.id?"on":""}" data-guide="${i.id}">${esc(i.t)}</button>`).join("")}`).join("")}</aside>
    <article class="xg-doc"><div class="t-cap">${esc(GUIDE_GROUPS.find(g=>g.id===sel.g).label)} <span class="t-k">${esc(sel.k||"")}</span></div><h2>${esc(sel.t)}</h2>
      ${sel.list==="gobag" ? gobag() : sel.morse ? morseRef() : sel.html}
      <p class="xg-foot">Reference only, not a substitute for training. In an emergency call 911 (or your local number) first. For deeper reading grab <b>WikiMed</b>, <b>WikEM</b> or the <b>Post-disaster library</b> from the Library tab.</p></article></div>`;
}
function gobag(){
  const done = K.LS.get("turd_xtr_gobag", {}), all = GOBAG.flatMap(([,...xs])=>xs), n = all.filter(x=>done[x]).length;
  return `<div class="xg-bag-h"><div class="t-meter"><i style="width:${Math.round(n/all.length*100)}%"></i></div><span>${n} / ${all.length} packed</span><button class="xc-l" data-act="bagreset">Reset</button></div>
    <div class="xg-bag">${GOBAG.map(([h,...xs])=>`<div><h4>${esc(h)}</h4>${xs.map(x=>`<label class="xg-chk ${done[x]?"on":""}"><input type="checkbox" data-bag="${esc(x)}" ${done[x]?"checked":""}><span>${esc(x)}</span></label>`).join("")}</div>`).join("")}</div>`;
}
function morseRef(){
  return `<div class="xt-chart big">${Object.entries(MORSE).map(([k,v])=>`<span><b>${esc(k)}</b>${v.replace(/\./g,"·").replace(/-/g,"–")}</span>`).join("")}</div>
    <p class="xg-p">Timing: dot = 1 unit, dash = 3, gap inside a letter = 1, between letters = 3, between words = 7. SOS is sent as one run: <b>···–––···</b>.</p>
    <button class="t-btn sm" data-tool="morse">Open the Morse translator</button>`;
}
function tools(body){
  if(toolSel){ body.innerHTML = `<div class="xt-wrapper" id="xtTool"></div>`; toolOff = mountTool(body.querySelector("#xtTool"), toolSel, K, ()=>{ toolSel=null; draw(); }); return; }
  body.innerHTML = `<div class="xx-tools">${TOOLS.map(t=>`<button class="xx-tool" data-tool="${t.id}" style="--h:${hue(t.id)}"><b>${esc(t.name)}</b><span>${esc(t.sub)}</span></button>`).join("")}</div>
    <p class="t-s xx-pad">Everything here runs on the device with no internet. The compass needs a phone or tablet sensor; the SOS light works anywhere.</p>`;
}
function downloads(body){
  const st = E.all(), rows = Object.entries(st).map(([id,s])=>({ it:byId(id), s })).filter(r=>r.it && r.s.st).sort((a,b)=>(b.s.t||0)-(a.s.t||0));
  body.innerHTML = `<div class="xx-dl-top"><div><div class="t-cap">On this device</div>
      <p class="t-s">${E.native ? "Downloads resume if the connection drops or the app closes. Files with a published SHA-256 are verified before they're marked ready." : "This is the browser preview, so downloads go to your browser's Downloads folder. In the Windows or Android app they install in place, with progress, resume and checksum checks. Downloaded a .zim? Open it with the Reader."}</p></div>
      <div class="xx-dl-b">${E.native ? `<button class="t-btn sm ghost" data-act="pickdir">Storage location…</button>` : ""}<button class="t-btn sm" data-act="openzim">Open a .zim file</button></div></div>
    <div class="xx-grid">${rows.map(r=>card(r.it,{wide:1})).join("") || `<div class="t-empty sm"><h3>Nothing yet</h3><p class="t-s">Start with a kit on the Home tab, or the Pocket kit if space is tight.</p></div>`}</div>
    <div class="t-cap" id="xxRecentCap" hidden>Recent books</div><div class="xx-recent" id="xxRecent"></div>`;
  import("./extras/reader.js").then(async m=>{ const rec = await m.recentZims(); const el = body.querySelector("#xxRecent"); if(!el || !rec.length) return;
    body.querySelector("#xxRecentCap").hidden = false;
    el.innerHTML = rec.map(r=>`<button class="xx-book" data-recent="${esc(r.name)}"><b>${esc(r.name)}</b><span>${fmtB(r.size)}</span></button>`).join(""); });
}
function search(body){
  const s = q.toLowerCase().trim(), terms = s.split(/\s+/);
  const hit = t=> terms.every(w=>t.includes(w));
  const items = ALL.filter(i=>inPlat(i) && hit((i.name+" "+i.desc+" "+(CATS[i.cat]||{}).label+" "+(i.zim?i.zim.name:"")+" "+(i.and?i.and.pkg:"")+" "+(i.win?i.win.wg||"":"")).toLowerCase()));
  const g = GUIDE_GROUPS.flatMap(gr=>gr.items).filter(i=>hit((i.t+" "+(i.k||"")+" "+(i.html||"").replace(/<[^>]+>/g," ")).toLowerCase()));
  const tl = TOOLS.filter(t=>hit((t.name+" "+t.sub).toLowerCase()));
  body.innerHTML = (g.length||tl.length ? `<div class="t-cap">Field guide & tools</div><div class="xx-quick wide">${g.slice(0,8).map(i=>`<button data-guide="${i.id}"><b>${esc(i.t)}</b><span>${esc(i.k||"")}</span></button>`).join("")}${tl.map(t=>`<button data-tool="${t.id}"><b>${esc(t.name)}</b><span>tool</span></button>`).join("")}</div>` : "")
    + `<div class="t-cap">${items.length} result${items.length===1?"":"s"} for ${PLAT[plat]}</div><div class="xx-grid">${items.slice(0,60).map(i=>card(i)).join("")}</div>`
    + (!items.length && !g.length ? `<div class="t-empty sm"><h3>No matches</h3><p class="t-s">Try "wiki", "medical", "maps", "vpn" or "radio".</p></div>` : "");
}

/* ------------------------------------------------------------ reader */
async function showReader(){
  let host = readerHost;
  if(!host){ host = readerHost = document.createElement("div"); host.id="xxReader"; host.className="xx-reader"; }
  if(host.parentNode !== panel) panel.appendChild(host);
  host.hidden = false;
  if(!reader){
    const { createReader } = await import("./extras/reader.js");
    reader = createReader(host, { LS:K.LS, toast:K.toast, openExternal:u=>E.openExternal(u), onClose:()=>{ reader.destroy(); reader=null; host.remove(); readerHost=null; view="library"; draw(); } });
  }
}
async function openZim(src){
  view = "reader"; q = ""; const qi = panel.querySelector("#xxQ"); if(qi) qi.value = "";
  draw(); await showReader();
  try{ const z = await reader.open(src); K.toast(`${z.meta.Title || src.name} · ${z.count.toLocaleString()} entries`); }
  catch(e){ K.toast("Couldn't open: "+(e.message||e)); }
}

/* ------------------------------------------------------------ install queue (2 at a time) */
function enqueue(it){ if(pendingIds.has(it.id)) return; pendingIds.add(it.id); queue.push(it); pump(); }
function pump(){
  while(running<2 && queue.length){ const it = queue.shift(); running++;
    E.install(it, plat).finally(()=>{ running--; pendingIds.delete(it.id); tick(it.id); pump(); }); tick(it.id); }
}
const dirty = new Set(); let full = false;
function tick(id){ if(id) dirty.add(id); else full = true;
  if(raf) return;
  raf = requestAnimationFrame(()=>{ raf = 0; if(!panel){ dirty.clear(); full=false; return; }
    if(full) draw(); else dirty.forEach(refreshCard);
    dirty.clear(); full = false; chrome(); }); }

/* ------------------------------------------------------------ events */
async function onClick(ev){
  const t = ev.target.closest("[data-plat],[data-view],[data-cat],[data-act],[data-kit],[data-guide],[data-tool],[data-recent]"); if(!t) return;
  if(t.dataset.plat){ plat = t.dataset.plat; K.LS.set("turd_xtr_plat", plat); draw(); return; }
  if(t.dataset.view){ view = t.dataset.view; q=""; panel.querySelector("#xxQ").value=""; if(view!=="tools") toolSel=null; draw(); return; }
  if(t.dataset.cat!==undefined){ cat = t.dataset.cat || null; draw(); return; }
  if(t.dataset.guide){ guideSel = t.dataset.guide; view="guide"; q=""; panel.querySelector("#xxQ").value=""; draw(); return; }
  if(t.dataset.tool){ toolSel = t.dataset.tool; view="tools"; q=""; panel.querySelector("#xxQ").value=""; draw(); return; }
  if(t.dataset.recent){ const m = await import("./extras/reader.js"); const r = (await m.recentZims()).find(x=>x.name===t.dataset.recent);
    try{ openZim(await m.reopenRecent(r)); }catch(e){ K.toast(e.message||String(e)); } return; }
  if(t.dataset.kit){
    const k = KITS.find(x=>x.id===t.dataset.kit), its = kitItems(k).filter(i=>{ const s=E.state(i.id); return !s || !/done|installed/.test(s.st); });
    if(E.native){ its.forEach(enqueue); K.toast(`${k.name}: ${its.length} item${its.length===1?"":"s"} queued`); view="downloads"; draw(); }
    else kitLinks(k);
    return;
  }
  const act = t.dataset.act, it = t.dataset.id && byId(t.dataset.id);
  if(act==="install" && it){ enqueue(it); return; }
  if(act==="cancel" && it){ await E.cancel(it); tick(it.id); return; }
  if(act==="remove" && it){ if(!confirm(`Remove ${it.name} from this device?`)) return; await E.remove(it); K.toast(it.name+" removed"); tick(); return; }
  if(act==="read" && it){ const src = await E.zimSource(it); if(src) openZim(src); else K.toast("This build can't read files in place yet: open it in Kiwix"); return; }
  if(act==="launch" && it){ E.launch(it); return; }
  if(act==="copy"){ ev.preventDefault(); try{ await navigator.clipboard.writeText(t.dataset.cmd); K.toast("copied: "+t.dataset.cmd); }catch(e){ K.toast(t.dataset.cmd); } return; }
  if(act==="openzim"){ const m = await import("./extras/reader.js"); try{ openZim(await m.pickZim()); }catch(e){ if(e && e.name!=="AbortError") K.toast(e.message||String(e)); } return; }
  if(act==="pickdir"){ const d = await E.pickDir(); if(d){ K.LS.set("turd_xtr_dir", d.path); sysInfo = await E.info(); K.toast("Saving new downloads to "+d.path); chrome(); } return; }
  if(act==="bagreset"){ K.LS.set("turd_xtr_gobag", {}); draw(); return; }
  if(act==="ext" && E.native){ ev.preventDefault(); E.openExternal(t.href); }
}
function onChange(ev){
  const b = ev.target.closest("[data-bag]"); if(!b) return;
  const d = K.LS.get("turd_xtr_gobag", {}); d[b.dataset.bag] = b.checked; K.LS.set("turd_xtr_gobag", d);
  const sc = panel.querySelector(".xg-doc").scrollTop; draw(); panel.querySelector(".xg-doc") && (panel.querySelector(".xg-doc").scrollTop = sc);
}
function kitLinks(k){
  const its = kitItems(k), m = document.getElementById("modal"), body = document.getElementById("modalBody");
  body.innerHTML = `<div class="phead"><span class="k">KIT</span><h1>${esc(k.name)}</h1><span class="sub">${PLAT[plat]} · ${its.length} items</span></div>
    <p class="t-s" style="margin-bottom:12px">${esc(k.blurb)} In the T.U.R.D. app this installs everything in one tap. Here are the verified official links:</p>
    <table><thead><tr><th>Item</th><th>Size</th><th>Get it</th></tr></thead><tbody>${its.map(i=>{ const L=E.links(i,plat); return `<tr><td>${esc(i.name)}</td><td>${fmtMB(mbFor(i))}</td><td>${L.slice(0,2).map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(l.label)}</a>`).join(" · ")}</td></tr>`; }).join("")}</tbody></table>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn sm" onclick="document.getElementById('modal').classList.remove('show')">Close</button></div>`;
  m.classList.add("show");
}

/* ------------------------------------------------------------ section */
export default {
  id:"extras", icon:ICON, label:"Extras", theme:THEME,
  mount(p, ctx){
    K = ctx; panel = p; ensureCss();
    if(!E) E = createEngine({ LS:K.LS, http:K.http, toast:K.toast, onChange:id=>tick(id) });
    if(!plat) plat = K.LS.get("turd_xtr_plat", null) || E.plat;
    panel.classList.add("t-full","xx-panel");
    frame(); draw();
    E.info().then(i=>{ sysInfo=i; chrome(); });
    E.sync(ALL).then(r=>{ ollama = r.ollama ? r : null; if(view==="ai"||view==="downloads") draw(); else chrome(); });
  },
  unmount(){
    if(toolOff){ toolOff(); toolOff=null; }
    cancelAnimationFrame(raf); raf = 0;
    if(panel){ panel.removeEventListener("click", onClick); panel.removeEventListener("change", onChange); panel.classList.remove("xx-panel"); }
    panel = null;   // an open book stays open; the reader re-attaches on the next visit
  },
  summary(ctx){
    const st = (ctx.LS||K.LS).get("turd_xtr_state", {}), n = Object.values(st).filter(s=>s.st==="done"||s.st==="installed").length;
    return { title:"Extras", value: n ? String(n) : String(LIBRARY.length), note: n ? "offline items on this device" : "offline libraries ready to grab" };
  },
};
