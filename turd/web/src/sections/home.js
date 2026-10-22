// ===========================================================================
// HOME — "log in and know what you need to." One curved glance:
// greeting + clock, a spoken-style briefing, weather / today / projects
// wrapped around you like the inside of the visor, quick log, open tasks.
//
// Every block is a card from the registry in homecards.js. "Customize" (or
// holding any card, or Y on a controller) lets the owner hide cards and drag
// them into any order; strips take a full row, tiles share rows of up to 3.
// ===========================================================================
import { edgeFades, kit, $, $$, tilt, greeting, ago, countUp, lowFx } from "./util.js";
import { wxIcon } from "./icons.js";
import * as WX from "./wxdata.js";
import logbook, { quickAdd, CATS } from "./logbook.js";
import projects from "./projects.js";
import { fetchStats, livePaint } from "./pcstat.js";
import { devStripHTML, fetchDevices } from "./devstat.js";   // Fold status via device sync (Device-sync thread)
import { registerCard, getCard, onCards, getLayout, saveLayout, follows, setFollow, resetLayout } from "./homecards.js";
import { registerBatteries } from "./btbat.js";
import "./netcard.js";                                      // internet health: only when the PC server reports it              // gadget batteries: only when the native app reports one

const plain = s=> String(s).replace(/\*\*(.+?)\*\*/g,"$1").replace(/`([^`]+)`/g,"$1");
// Optional community calendar (built by another thread). Missing file → silently skipped.
let calMod=null;
const loadCal = ()=> calMod ??= import("../community/calendar.js").then(m=>{
  if(!document.querySelector('link[data-turd="community"]')){
    const l=document.createElement("link"); l.rel="stylesheet"; l.dataset.turd="community";
    l.href=new URL("../community/community.css", import.meta.url).href; document.head.appendChild(l);
  }
  return m;
}).catch(()=>null);
let K, panel, stopTilt=()=>{}, clock=0, refreshT=0;

function sentence(w, lg, pj, ev){
  const parts=[];
  if(ev) parts.push(`Next up: <b>${K.esc(ev.title)}</b> ${ev.allDay?new Date(ev.start).toLocaleDateString([], {weekday:"long"}):new Date(ev.start).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}.`);
  if(w){
    parts.push(`It's <b>${w.temp}°</b> and ${w.label.toLowerCase()} in ${K.esc(w.loc)}, heading for ${w.hi}° today.`);
    if(w.rain) parts.push(`Rain likely around <b>${WX.fmtHour(w.rain.t)}</b> (${w.rain.p}%).`);
    else parts.push(`No rain expected in the next 12 hours.`);
    if(w.alerts.length) parts.push(`<b class="bad">${w.alerts.length} weather alert${w.alerts.length>1?"s":""}</b> active: ${K.esc(w.alerts[0].event)}.`);
  }
  if(lg){
    if(lg.open) parts.push(`You have <b>${lg.open} open task${lg.open>1?"s":""}</b>.`);
    if(lg.streak>1) parts.push(`Logbook streak: ${lg.streak} days.`);
  }
  if(pj){
    if(pj.up===pj.total) parts.push(`All ${pj.total} projects are online.`);
    else if(pj.unknown===pj.total) parts.push(`Project status can't be checked right now.`);
    else { const down=pj.items.filter(i=>i.up===false).map(i=>K.esc(i.title)); if(down.length) parts.push(`<b class="bad">${down.join(", ")} ${down.length>1?"are":"is"} unreachable.</b>`); }
    const fresh=pj.items.filter(i=>i.added.length); if(fresh.length) parts.push(`New on ${K.esc(fresh[0].title)}: ${K.esc(fresh[0].added[0])}.`);
  }
  return parts.join(" ");
}

function wxTile(w){
  if(!w) return `<div class="hm-tile hm-wx t-tilt" data-go="weather"><div class="t-k">Weather</div>${wxFail?failHTML("Weather"):`<div class="t-loading sm"><i></i><i></i><i></i></div>`}</div>`;
  return `<div class="hm-tile hm-wx t-tilt" data-go="weather">
    <div class="t-k">Weather · ${K.esc(w.loc)}</div>
    <div class="hm-wx-now">${wxIcon(w.kind,w.isDay,86)}<div><div class="hm-big"><span id="hmT">0</span>°</div><div class="t-s">${K.esc(w.label)}</div></div></div>
    <div class="hm-kv"><span>High / low</span><b>${w.hi}° / ${w.lo}°</b></div>
    <div class="hm-kv"><span>Feels like</span><b>${w.feels}°</b></div>
    <div class="hm-kv"><span>Wind</span><b>${w.wind} ${w.windU}</b></div>
    <div class="hm-kv"><span>Rain</span><b>${w.rain?`${w.rain.p}% at ${WX.fmtHour(w.rain.t)}`:"none in 12h"}</b></div>
    ${w.aqi!=null?`<div class="hm-kv"><span>Air quality</span><b>${w.aqi}</b></div>`:""}
    ${w.alerts.length?`<div class="hm-alert">▲ ${K.esc(w.alerts[0].event)}</div>`:""}
    ${w.next?.length?`<div class="hm-strip">${w.next.map(h=>`<div><span>${WX.fmtHour(h.t)}</span>${wxIcon(WX.wmo(h.c)[1],h.day,28)}<b>${h.v}°</b>${h.p>=30?`<em>${h.p}%</em>`:""}</div>`).join("")}</div>`:""}
    <div class="hm-go">Open weather ▸</div></div>`;
}

function todayTile(lg){
  const cat=e=>CATS[e.cat]||CATS.note;
  return `<div class="hm-tile hm-today t-tilt">
    <div class="t-k">Today · ${new Date().toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"})}</div>
    <div class="hm-quick"><input id="hmLog" placeholder="Log something… (Enter)" autocomplete="off">
      <select id="hmCat">${Object.entries(CATS).map(([k,c])=>`<option value="${k}">${c.label}</option>`).join("")}</select></div>
    <div class="hm-cols">
      <div><div class="t-cap">Open tasks</div>${lg.tasks.length?lg.tasks.map(t=>`<button class="hm-task" data-id="${t.id}"><i></i>${K.esc(plain(t.txt).slice(0,80))}</button>`).join(""):`<p class="t-s">Nothing open. Clean slate.</p>`}</div>
      <div><div class="t-cap">Pinned</div>${lg.pinned.length?lg.pinned.slice(0,3).map(e=>`<p class="hm-pin" style="--cc:${cat(e).color}">${K.esc(plain(e.txt).slice(0,90))}</p>`).join(""):`<p class="t-s">Pin a log entry to keep it here.</p>`}</div>
    </div>
    ${lg.recent?.length?`<div class="t-cap hm-recent-cap" style="margin-top:14px">Recent log</div><div class="hm-recent">${lg.recent.map(e=>`<div style="--cc:${cat(e).color}"><span>${ago(e.t)}</span><p>${K.esc(plain(e.txt).slice(0,110))}</p></div>`).join("")}</div>`:""}
    <div class="hm-foot"><span>${lg.last?`Last entry ${ago(lg.last.t)}: “${K.esc(plain(lg.last.txt).slice(0,60))}${lg.last.txt.length>60?"…":""}”`:"No log entries yet."}</span>
      <button class="hm-go" data-go="logbook">Open logbook ▸</button></div></div>`;
}

function pjTile(pj){
  if(!pj) return `<div class="hm-tile hm-pj t-tilt" data-go="projects"><div class="t-k">Projects</div>${pjFail?failHTML("Projects"):`<div class="t-loading sm"><i></i><i></i><i></i></div>`}</div>`;
  return `<div class="hm-tile hm-pj t-tilt" data-go="projects">
    <div class="t-k">Projects</div>
    <div class="hm-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" class="bg"/>
      <circle cx="60" cy="60" r="50" class="fg" style="stroke-dasharray:${314*(pj.up/Math.max(1,pj.total))} 314"/></svg>
      <div><b>${pj.unknown===pj.total?"—":`${pj.up}/${pj.total}`}</b><span>${pj.unknown===pj.total?"can't check":"online"}</span></div></div>
    ${pj.items.map(i=>`<div class="hm-kv"><span><i class="hm-dot ${i.up?"up":i.up===false?"down":""}"></i>${K.esc(i.title)}</span><b class="${i.up==null?"hm-unk":""}">${i.up?i.ms+" ms":i.up===false?"down":"not checked"}</b></div>`).join("")}
    <div class="hm-links">${pj.items.map(i=>`<a href="${K.esc(i.url||"#")}" target="_blank" rel="noopener">Open ${K.esc(i.title)} ↗</a>`).join("")}</div>
    <div class="hm-go">Open projects ▸</div></div>`;
}

/* ------------------------------------------------------------ data → cards */
let lastW=null,lastLg=null,lastPj=null;
let wxFail=false, pjFail=false;
const failHTML = what=>`<div class="t-s hm-fail">${what} unavailable right now.</div><button class="hm-go" data-retry>Retry ▸</button>`;
async function render(){
  lastLg=logbook.summary(K);
  if(!lastW) lastW=WX.brief(WX.cached());
  refreshAll();
  // a hung or offline fetch must never leave loading dots up forever: give up after 12 s, keep what we had
  const to=(p,ms=12000)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),ms))]);
  const [w,pj]=await Promise.allSettled([to(WX.load(K.http).then(WX.brief)), to(projects.summary(K))]);
  wxFail=w.status!=="fulfilled"; pjFail=pj.status!=="fulfilled";
  if(!panel) return;
  if(w.status==="fulfilled") lastW=w.value;
  lastLg=logbook.summary(K); if(!pjFail) lastPj=pj.value;
  refreshAll();
}
const refresh = (...ids)=> ids.forEach(id=>{ try{ live.get(id)?.handle?.refresh?.(); }catch(e){ console.warn("[home] card",id,e); } });
function refreshAll(){ if(!panel) return; live.forEach((c,id)=>refresh(id)); stopTilt(); stopTilt=editing?()=>{}:tilt(panel,".hm-tile",6); }

const goLinks = el=>{ $$("[data-retry]",el).forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); if(editing) return; wxFail=pjFail=false; refresh("weather","projects"); render(); })); goLinks0(el); };
const goLinks0 = el=> $$("[data-go]",el).forEach(n=>{
  n.addEventListener("click",e=>{ if(editing||e.target.closest("input,select,a,.hm-task,[data-retry]")) return; e.stopPropagation(); K.show(n.dataset.go); });
  if(!n.matches("a,button")){   // tiles are divs: make them reachable by Tab and the controller, Enter/Space opens
    n.tabIndex=0; n.setAttribute("role","link"); n.setAttribute("aria-label",`Open ${n.dataset.go}`);
    n.addEventListener("keydown",e=>{ if(e.target!==n || (e.key!=="Enter"&&e.key!==" ")) return; e.preventDefault(); n.click(); });
  } });

/* ------------------------------------------------------------ built-in cards */
registerCard({ id:"brief", label:"Greeting & briefing", icon:"☀", kind:"strip", order:10,
  mount(b){ const paint=()=>{ const user=K.session?.user||"operator";
      b.innerHTML=`<div class="hm-top"><div><div class="hm-hello">${greeting()}, <b>${K.esc(user)}</b></div>
        <div class="hm-brief">${sentence(lastW,lastLg,lastPj,nextEvent)||"Bringing systems online…"}</div></div>
        <div class="hm-clock"><div id="hmClock">--:--</div><span id="hmDate"></span></div></div>`; tick(); };
    paint(); return { refresh:paint }; } });

registerCard({ id:"pc", label:"PC status", icon:"▤", kind:"strip", order:20, admin:true,
  mount(b){ b.id="hmPc"; const paint=()=>livePaint(b, pcLast, K.esc); paint(); return { refresh:paint }; } });

registerCard({ id:"fold", label:"Fold status", icon:"▯", kind:"strip", order:25,
  mount(b){ b.id="hmDev"; const paint=()=>{ b.innerHTML=devStripHTML(K.esc); }; paint(); return { refresh:paint }; } });

registerCard({ id:"np", label:"Now Playing", icon:"♪", kind:"strip", order:30, admin:true,
  mount(b, ctx){
    let stop=null, dead=false; const host=document.createElement("div"); host.hidden=true; b.appendChild(host);
    if(!document.getElementById("ent-css")){ const l=document.createElement("link"); l.id="ent-css"; l.rel="stylesheet"; l.href=new URL("./ent/ent.css", import.meta.url).href; document.head.appendChild(l); }
    import("./ent/nowplaying.js").then(m=>{ if(!dead && m.mountNowPlaying) stop=m.mountNowPlaying(host, ctx, {variant:"dock"}); }).catch(()=>{});
    return { destroy(){ dead=true; try{ typeof stop==="function"?stop():stop?.stop?.(); }catch(e){} } }; } });

registerCard({ id:"events", label:"Upcoming events", icon:"◷", kind:"strip", order:40,
  mount(b){ b.id="hmEvents"; b.classList.add("hm-events"); b.hidden=true; events(b); return { refresh(){} }; } });

registerCard({ id:"weather", label:"Weather", icon:"☁", kind:"tile", weight:1, order:50,
  mount(b){ const paint=()=>{ b.innerHTML=wxTile(lastW); if(lastW) countUp($("#hmT",b), lastW.temp, {dur:900}); goLinks(b); }; paint(); return { refresh:paint }; } });

registerCard({ id:"today", label:"Today & quick log", icon:"✎", kind:"tile", weight:1.35, order:60,
  mount(b){
    const paint=()=>{
      const a=document.activeElement; if(b.contains(a) && a.id==="hmLog" && a.value) return;   // never wipe a half-typed entry
      b.innerHTML=todayTile(lastLg||logbook.summary(K)); goLinks(b);
      const inp=$("#hmLog",b);
      inp.onkeydown=e=>{ if(e.key==="Enter"&&inp.value.trim()){ quickAdd(K, inp.value.trim(), $("#hmCat",b).value); K.toast("logged"); inp.value="";
        lastLg=logbook.summary(K); paint(); refresh("brief"); $("#hmLog",b)?.focus(); } };
      $$(".hm-task",b).forEach(t=>t.onclick=()=>{ if(editing) return; const l=K.LS.get("turd_log",[]); const e=l.find(x=>x.id===t.dataset.id); if(e){ e.done=true; e.doneAt=Date.now(); K.LS.set("turd_log",l); }
        t.classList.add("done"); K.toast("task complete ✓"); setTimeout(()=>{ lastLg=logbook.summary(K); paint(); refresh("brief"); },500); });
    };
    paint(); return { refresh:paint }; } });

registerCard({ id:"projects", label:"Projects", icon:"◆", kind:"tile", weight:1, order:70,
  mount(b){ const paint=()=>{ b.innerHTML=pjTile(lastPj); goLinks(b); }; paint(); return { refresh:paint }; } });

let nextEvent=null;
async function events(box){
  const m=await loadCal();
  if(!m || !box || !box.isConnected || typeof m.renderUpcomingStrip!=="function") return;
  try{
    const ev=(typeof m.upcoming==="function" && m.upcoming(1)[0]) || null;
    box.hidden=false; m.renderUpcomingStrip(box, K);
    if((ev?.id)!==(nextEvent?.id)){ nextEvent=ev; const b=panel&&$(".hm-brief",panel); if(b) b.innerHTML=sentence(lastW,lastLg,lastPj,ev); }
  }catch(e){ box.hidden=true; }
}

function tick(){
  const c=panel&&$("#hmClock",panel); if(!c) return;
  const d=new Date();
  c.textContent=d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  $("#hmDate",panel).textContent=d.toLocaleDateString([], {weekday:"short", month:"short", day:"numeric", year:"numeric"});
}

/* ------------------------------------------------------------ board: mount cards in the saved order */
const live=new Map();      // id -> { el, body, handle }
let layout=null, editing=false, held=null, heldSnap=null, stopCards=()=>{};
const allowed = d=> d && (!d.admin || K.session?.role==="admin");
const mq = matchMedia("(max-width:1100px)");

function build(){
  live.forEach(c=>{ try{ c.handle?.destroy?.(); }catch(e){} }); live.clear();
  panel.innerHTML=`<div class="hm-editbar" id="hmEditbar" hidden></div><div class="hm-board" id="hmBoard"></div>
    <div class="hm-tray" id="hmTray" hidden></div>
    <div class="hm-custom-row"><button class="hm-custom" id="hmCustom" title="Show, hide and reorder Home cards (or hold any card · Y on a controller)">✎ Customize Home</button></div>`;
  $("#hmCustom",panel).onclick=()=>editMode(true);
  layout=getLayout();
  layout.order.forEach(id=>{ if(!layout.hidden.has(id)) mountCard(id); });
  place();
}
function mountCard(id){
  const d=getCard(id); if(!allowed(d) || live.has(id)) return null;
  const el=document.createElement("section"); el.className=`hm-card hm-k-${d.kind}${d.quiet?" hm-quiet":""}`; el.dataset.card=id;
  const body=document.createElement("div"); body.className="hm-body"; el.appendChild(body);
  $("#hmBoard",panel).appendChild(el);
  const c={el, body, handle:null}; live.set(id,c);
  try{ c.handle=d.mount(body, K)||null; }catch(e){ body.innerHTML=`<div class="hm-cardfault">${K.esc(d.label)}: ${K.esc(e.message)}</div>`; }
  if(editing) addOverlay(id);
  return c;
}
function unmountCard(id){ const c=live.get(id); if(!c) return; try{ c.handle?.destroy?.(); }catch(e){} c.el.remove(); live.delete(id); }

// rows: each strip is its own row; consecutive tiles share a row (max 3) on a 24-column grid
function place(){
  const board=panel&&$("#hmBoard",panel); if(!board) return;
  const ids=layout.order.filter(id=>live.has(id)), rows=[]; let cur=null;
  ids.forEach(id=>{ const c=live.get(id), d=getCard(id); board.appendChild(c.el);
    if(d.kind==="tile"){ if(!cur||cur.length===3){ cur=[]; rows.push({tiles:cur}); } cur.push(id); } else { cur=null; rows.push({strip:id}); } });
  if(mq.matches){ ids.forEach(id=>{ const s=live.get(id).el.style; s.gridRow=s.gridColumn=""; }); board.style.gridTemplateRows=""; board.classList.add("stack"); return; }
  board.classList.remove("stack");
  const tileRows=rows.filter(r=>r.tiles).length, tpl=[];
  rows.forEach((r,i)=>{
    if(r.strip){ tpl.push("auto"); const s=live.get(r.strip).el.style; s.gridRow=String(i+1); s.gridColumn="1 / -1"; return; }
    tpl.push(editing?"minmax(320px,auto)":tileRows>1?"minmax(min(340px,46vh),1fr)":"minmax(0,1fr)");
    const tot=r.tiles.reduce((a,id)=>a+(getCard(id).weight||1),0); let col=1;
    r.tiles.forEach((id,j)=>{ const span=j===r.tiles.length-1?25-col:Math.max(4,Math.round(24*(getCard(id).weight||1)/tot));
      const s=live.get(id).el.style; s.gridRow=String(i+1); s.gridColumn=`${col} / span ${span}`; col+=span; });
  });
  board.style.gridTemplateRows=tpl.join(" ");
}
// FLIP: animate cards from where they were to where place() put them
function reflow(){
  const before=new Map(); live.forEach((c,id)=>{ if(id!==drag?.id) before.set(id,c.el.getBoundingClientRect()); });
  place();
  if(lowFx()) return;
  live.forEach((c,id)=>{ const a=before.get(id); if(!a) return; const b=c.el.getBoundingClientRect(), dx=a.left-b.left, dy=a.top-b.top;
    if(!dx&&!dy) return; c.el.style.transition="none"; c.el.style.transform=`translate(${dx}px,${dy}px)`;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ c.el.style.transition="transform .32s cubic-bezier(.2,.8,.2,1)"; c.el.style.transform=""; })); });
}
const store = ()=> saveLayout(layout);

/* ------------------------------------------------------------ customize mode */
const visibleIds = ()=> layout.order.filter(id=>live.has(id) && live.get(id).el.getClientRects().length);   // skips quiet cards with nothing to show
function addOverlay(id){
  const c=live.get(id), d=getCard(id); if(!c || $(".hm-ov",c.el)) return;
  const ov=document.createElement("div"); ov.className="hm-ov"; ov.tabIndex=0; ov.setAttribute("role","button");
  ov.setAttribute("aria-label",`${d.label} card. Enter to pick up and move, H to hide.`);
  ov.innerHTML=`<div class="hm-ov-bar"><span class="hm-grip" title="Drag to move" aria-hidden="true">⠿</span><b><i>${K.esc(d.icon)}</i>${K.esc(d.label)}</b>
    <span class="hm-ov-acts"><button data-a="up" title="Move earlier" tabindex="-1">◀</button><button data-a="down" title="Move later" tabindex="-1">▶</button><button data-a="hide" title="Hide this card" tabindex="-1">Hide</button></span></div>
    <em class="hm-ov-held">Moving · ◀ ▶ to place · Enter / Ⓐ to drop</em>`;
  c.el.appendChild(ov); c.el.classList.add("hm-edit-card");
}
function editMode(on){
  if(!panel) return;
  editing=on;
  const bar=$("#hmEditbar",panel), tray=$("#hmTray",panel);
  panel.classList.toggle("hm-editing",on);
  window.TURD_OVERLAY=on;
  removeEventListener("keydown",onEditKey,true);
  if(!on){
    if(held) drop(false);
    bar.hidden=tray.hidden=true;
    live.forEach(c=>{ $(".hm-ov",c.el)?.remove(); c.el.classList.remove("hm-edit-card","hm-held","hm-lift"); c.el.style.transform=""; });
    place();
    $("#hmCustom",panel)?.focus({preventScroll:true});
    refreshAll(); return;
  }
  stopTilt(); stopTilt=()=>{};
  $$(".hm-tile",panel).forEach(t=>t.style.transform="");
  bar.hidden=false;
  bar.innerHTML=`<div class="hm-eb-txt"><span class="hm-eb-k">CUSTOMIZE</span><h2>Arrange your Home</h2>
      <p>Drag a card by its <b>⠿</b> handle, or use <b>◀ ▶</b>. Hide what you don't need, bring it back from Hidden cards.<span class="hm-eb-pad"> Controller: Ⓐ pick up / drop · D-pad ◀ ▶ move · Ⓨ hide · Ⓑ done.</span></p></div>
    <div class="hm-eb-acts">
      <label class="hm-follow" title="Off: this device keeps its own layout. On: your PC and Fold share one layout."><input type="checkbox" id="hmFollow" ${follows()?"checked":""}><span></span>Same layout on all my devices</label>
      <button class="hm-eb-btn" id="hmReset">Reset</button><button class="hm-eb-btn go" id="hmDone">✓ Done</button></div>`;
  $("#hmDone",bar).onclick=()=>editMode(false);
  $("#hmReset",bar).onclick=()=>{ applyLayout(resetLayout()); K.toast("Home layout reset"); };
  $("#hmFollow",bar).onchange=e=>{ setFollow(e.target.checked); applyLayout(getLayout());
    K.toast(e.target.checked?"This layout now follows you to your other devices":"This device keeps its own layout now"); };
  live.forEach((c,id)=>addOverlay(id));
  place(); paintTray();
  addEventListener("keydown",onEditKey,true);
  if(!panel.contains(document.activeElement) || !document.activeElement.classList.contains("hm-ov")) setTimeout(()=>$(".hm-ov",panel)?.focus({preventScroll:true}),60);
  panel.scrollTo?.({top:0,behavior:lowFx()?"auto":"smooth"});
}
function applyLayout(l){
  layout=l;
  [...live.keys()].forEach(id=>{ if(layout.hidden.has(id)) unmountCard(id); });
  layout.order.forEach(id=>{ if(!layout.hidden.has(id)) mountCard(id); });
  reflow(); paintTray();
}
function paintTray(){
  const tray=$("#hmTray",panel); if(!tray) return;
  const hid=layout.order.filter(id=>layout.hidden.has(id) && allowed(getCard(id)));
  tray.hidden=!editing;
  tray.innerHTML=`<span class="hm-tray-k">Hidden cards</span>`+(hid.length?hid.map(id=>{ const d=getCard(id);
    return `<button class="hm-chip" data-show="${K.esc(id)}"><i>${K.esc(d.icon)}</i>${K.esc(d.label)}<b>＋</b></button>`; }).join(""):`<span class="hm-tray-none">None. Every card is on your Home.</span>`);
  $$(".hm-chip",tray).forEach(b=>b.onclick=()=>showCard(b.dataset.show));
}
function hideCard(id){
  const ids=visibleIds(), i=ids.indexOf(id);
  if(held===id){ held=null; heldSnap=null; }
  layout.hidden.add(id); unmountCard(id); reflow(); store(); paintTray();
  const next=ids[i+1]||ids[i-1]; const ov=next&&live.get(next)&&$(".hm-ov",live.get(next).el);
  (ov||$(".hm-chip",panel))?.focus({preventScroll:true});
  K.toast(`${getCard(id).label} hidden`);
}
function showCard(id){
  layout.hidden.delete(id); mountCard(id); reflow(); store(); paintTray();
  const c=live.get(id); if(c){ $(".hm-ov",c.el)?.focus({preventScroll:true}); c.el.scrollIntoView({block:"nearest",behavior:lowFx()?"auto":"smooth"}); }
}
// move id one visible step earlier/later, or to sit right before/after a target
function step(id, dir){
  const ids=visibleIds(), i=ids.indexOf(id), j=i+dir; if(i<0||j<0||j>=ids.length) return false;
  moveNear(id, ids[j], dir>0); return true;
}
function moveNear(id, target, after){
  const o=layout.order; o.splice(o.indexOf(id),1);
  o.splice(o.indexOf(target)+(after?1:0),0,id);
  reflow();
}
function pickUp(id){ held=id; heldSnap=layout.order.slice(); live.get(id)?.el.classList.add("hm-held"); }
function drop(cancel){
  if(!held) return; const id=held;
  live.get(id)?.el.classList.remove("hm-held"); held=null;
  if(cancel && heldSnap){ layout.order=heldSnap; reflow(); } else store();
  heldSnap=null; $(".hm-ov",live.get(id)?.el)?.focus({preventScroll:true});
}

const focusables = ()=> [...$$(".hm-ov",panel), ...$$(".hm-chip",panel)];
function moveFocus(d){ const f=focusables(); if(!f.length) return; const i=f.indexOf(document.activeElement);
  const n=f[i<0?0:(i+d+f.length)%f.length]; n.focus({preventScroll:true}); n.scrollIntoView({block:"nearest"}); }
const cardOf = n=> n?.closest?.(".hm-card")?.dataset.card;
const focusHeld = ()=> held && $(".hm-ov",live.get(held)?.el)?.focus({preventScroll:true});

function onEditKey(e){
  if(!panel || !editing) return;
  const k=e.key, stop=()=>{ e.preventDefault(); e.stopImmediatePropagation(); };
  if(e.target.closest?.("input,select,textarea") && k!=="Escape") return;
  if(["[","]","PageUp","PageDown"].includes(k)){ stop(); return; }   // no section flipping while arranging
  if(k==="Escape"){ stop(); held?drop(true):editMode(false); return; }
  const id=cardOf(document.activeElement), onOv=document.activeElement?.classList.contains("hm-ov");
  if(held){
    if(k==="ArrowLeft"||k==="ArrowUp"){ stop(); step(held,-1); focusHeld(); }
    else if(k==="ArrowRight"||k==="ArrowDown"){ stop(); step(held,1); focusHeld(); }
    else if(k==="Enter"||k===" "){ stop(); drop(false); }
    return;
  }
  if(onOv && (k==="Enter"||k===" ")){ stop(); pickUp(id); return; }
  if(onOv && (k==="h"||k==="H"||k==="Delete"||k==="Backspace")){ stop(); hideCard(id); return; }
  if(!panel.contains(document.activeElement) || onOv || document.activeElement.classList.contains("hm-chip")){
    if(k==="ArrowLeft"||k==="ArrowUp"){ stop(); moveFocus(-1); }
    else if(k==="ArrowRight"||k==="ArrowDown"){ stop(); moveFocus(1); }
  }
}

/* pointer: drag from the handle (any pointer) or anywhere on the card (mouse/pen) */
let drag=null;
function onPointerDown(e){
  if(!editing) return longPressStart(e);
  const btn=e.target.closest?.(".hm-ov-acts button"), ov=e.target.closest?.(".hm-ov");
  if(btn){ const id=cardOf(btn), a=btn.dataset.a; e.preventDefault();
    if(a==="hide") hideCard(id); else { step(id, a==="up"?-1:1); store(); $(".hm-ov",live.get(id)?.el)?.focus({preventScroll:true}); }
    return; }
  if(!ov) return;
  if(e.pointerType==="touch" && !e.target.closest(".hm-grip,.hm-ov-bar")) return;   // on touch, the card body still scrolls the page
  const id=cardOf(ov), el=live.get(id).el, r=el.getBoundingClientRect();
  drag={id, el, x0:e.clientX, y0:e.clientY, gx:e.clientX-r.left, gy:e.clientY-r.top, on:false, pid:e.pointerId};
  try{ ov.setPointerCapture(e.pointerId); }catch(_){}
  ov.focus({preventScroll:true});
  e.preventDefault();
}
function onPointerMove(e){
  if(lp && Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10) longPressCancel();
  if(!drag || e.pointerId!==drag.pid) return;
  if(!drag.on){ if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<5) return;
    drag.on=true; held=drag.id; heldSnap=layout.order.slice(); drag.el.classList.add("hm-lift","hm-held"); }
  const under=document.elementsFromPoint(e.clientX,e.clientY).map(n=>n.closest?.(".hm-card")).find(n=>n && n!==drag.el && panel.contains(n));
  if(under){
    const tid=under.dataset.card, r=under.getBoundingClientRect();
    const sideways=getCard(tid).kind==="tile" && getCard(drag.id).kind==="tile" && !mq.matches;
    const after = sideways ? e.clientX>r.left+r.width/2 : e.clientY>r.top+r.height/2;
    const o=visibleIds(), ti=o.indexOf(tid);
    if(o[after?ti+1:ti-1]!==drag.id) moveNear(drag.id, tid, after);
  }
  lift(e.clientX,e.clientY);
  autoScroll(e.clientY);
}
function lift(x,y){ const el=drag.el; el.style.transition="none"; el.style.transform=""; const r=el.getBoundingClientRect();
  el.style.transform=`translate(${x-drag.gx-r.left}px,${y-drag.gy-r.top}px) scale(1.02)`; }
function onPointerUp(e){
  longPressCancel();
  if(swallowClick) setTimeout(()=>{ swallowClick=false; },0);   // the click after a long press may land elsewhere or never fire
  if(!drag || e.pointerId!==drag.pid) return;
  const d=drag; drag=null; stopAuto();
  if(!d.on) return;
  d.el.classList.remove("hm-lift");
  const r0=d.el.getBoundingClientRect(); d.el.style.transform=""; const r1=d.el.getBoundingClientRect();
  if(!lowFx()){ d.el.style.transition="none"; d.el.style.transform=`translate(${r0.left-r1.left}px,${r0.top-r1.top}px)`;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ d.el.style.transition="transform .28s cubic-bezier(.2,.8,.2,1)"; d.el.style.transform=""; })); }
  drop(e.type==="pointercancel");
}
let autoT=0;
function autoScroll(y){
  stopAuto(); const r=panel.getBoundingClientRect(), edge=70;
  const v = y<r.top+edge ? -14 : y>r.bottom-edge ? 14 : 0; if(!v) return;
  const go=()=>{ if(!panel) return; panel.scrollTop+=v; autoT=requestAnimationFrame(go); }; autoT=requestAnimationFrame(go);
}
function stopAuto(){ cancelAnimationFrame(autoT); autoT=0; }

/* hold any card for ~0.6s to start customizing (console-style) */
let lp=null, swallowClick=false;
function longPressStart(e){
  if(e.button>0 || e.target.closest?.("input,select,textarea,a,button,.hm-task")) return;
  const card=e.target.closest?.(".hm-card"); if(!card) return;
  lp={x:e.clientX,y:e.clientY,t:setTimeout(()=>{ lp=null; swallowClick=true; try{ navigator.vibrate?.(18); }catch(_){} editMode(true);
    $(".hm-ov",card)?.focus({preventScroll:true}); },600)};
}
function longPressCancel(){ if(lp){ clearTimeout(lp.t); lp=null; } }
function onClickCapture(e){ if(swallowClick){ swallowClick=false; e.stopPropagation(); e.preventDefault(); } }
function onContextMenu(e){ if(editing || lp || swallowClick) e.preventDefault(); }

/* controller: Y opens Customize on Home; while customizing Ⓐ pick/drop, Ⓑ cancel/done, Ⓨ hide, D-pad ◀ ▶ move.
   (D-pad ▲ ▼ and the bumpers stay with the shell's section switching.) */
let padRaf=0; const padPrev={};
function pollPad(){
  const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
  if(!panel || !pads.length){ padRaf=0; return; }
  const busy=document.getElementById("modal")?.classList.contains("show") || document.querySelector(".fw-root");
  pads.forEach(p=>{ const hit=n=>{ const on=!!p.buttons[n]?.pressed, k=p.index+":"+n, was=padPrev[k]; padPrev[k]=on; return on&&!was; };
    const A=hit(0), B=hit(1), Y=hit(3), L=hit(14), R=hit(15);
    if(busy) return;
    if(!editing){ if(Y && panel.offsetParent) editMode(true); return; }
    const a=document.activeElement, id=cardOf(a);
    if(held){ if(L) step(held,-1); if(R) step(held,1); if(A) return drop(false); if(B) return drop(true); focusHeld(); return; }
    if(A){ if(a?.classList.contains("hm-ov")) pickUp(id); else if(a?.classList.contains("hm-chip")) a.click(); else moveFocus(0); }
    if(Y && id && a?.classList.contains("hm-ov")) hideCard(id);
    if(B) editMode(false);
    if(L) moveFocus(-1); if(R) moveFocus(1);
  });
  padRaf=requestAnimationFrame(pollPad);
}
function startPad(){ if(!padRaf && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) padRaf=requestAnimationFrame(pollPad); }
addEventListener("gamepadconnected",()=>{ if(panel) startPad(); });

let stopFades=()=>{};
/* PC status strip: admin only, near-live (~1.5 s; 2 s on touch devices) while Home is actually on screen.
   One request at a time, so a slow network never stacks calls. Fold status keeps its own 10 s pace. */
let pcLast=null, pcT=0, pcBusy=false, devAt=0;
const PC_MS = matchMedia("(hover: none)").matches ? 2000 : 1500;
async function pcPoll(){
  if(!panel || pcBusy || document.hidden || K.session?.role!=="admin" || !panel.offsetParent) return;
  pcBusy=true;
  try{
    pcLast=await fetchStats(); refresh("pc");
    if(Date.now()-devAt>10e3){ devAt=Date.now(); await fetchDevices(); devPaint(); }
  }finally{ pcBusy=false; }
}
const devPaint = ()=> refresh("fold");

const onMQ=()=>{ if(panel) place(); };
/* for the spoken login briefing (voice/briefing.js): plain-text versions of what Home shows */
const toText = h=>{ const d=document.createElement("div"); d.innerHTML=h||""; return d.textContent.replace(/\s+/g," ").trim(); };
window.TURD_HOME = {
  briefing(){ return K ? toText(sentence(lastW,lastLg,lastPj,nextEvent)) : ""; },
  pcLine(){ const d=pcLast?.state==="ok"&&pcLast.d; if(!d) return "";
    const bits=[]; if(d.cpu?.pct!=null) bits.push(`${d.cpu.pct} percent CPU`); if(d.gpu?.tempC!=null) bits.push(`GPU at ${d.gpu.tempC} degrees`);
    if(d.ram?.pct!=null) bits.push(`memory ${d.ram.pct} percent used`);
    return bits.length?`Your PC is at ${bits.join(", ")}${d.ollama?.up?", and the assistant model is up":""}.`:""; },
};
export default {
  id:"home", icon:"⌂", label:"Home",
  theme:{ accent:"#2f8cff", accent2:"#0050d0", rgb:"47,140,255", bg:"#020a1c", bg2:"#06173a" },
  mount(el, ctx){ K=kit(ctx); panel=el; stopFades(); stopFades=edgeFades(el); el.classList.add("t-full","t-sec-hm");
    registerBatteries(); build(); render();
    // cards registered later (other threads' modules) appear without a reload
    stopCards(); stopCards=onCards(()=>{ if(!panel) return; layout=getLayout();
      layout.order.forEach(id=>{ if(!layout.hidden.has(id) && !live.has(id)) mountCard(id); }); place(); if(editing) paintTray(); });
    el.addEventListener("pointerdown",onPointerDown); el.addEventListener("click",onClickCapture,true); el.addEventListener("contextmenu",onContextMenu);
    addEventListener("pointermove",onPointerMove); addEventListener("pointerup",onPointerUp); addEventListener("pointercancel",onPointerUp);
    mq.addEventListener?.("change",onMQ);
    clearInterval(clock); clock=setInterval(tick, 1000*15);
    clearInterval(refreshT); refreshT=setInterval(render, 10*60e3);
    devAt=0; pcPoll(); clearInterval(pcT); pcT=setInterval(pcPoll, PC_MS);
    startPad(); },
  unmount(){
    if(editing){ if(held) drop(false); editing=false; window.TURD_OVERLAY=false; removeEventListener("keydown",onEditKey,true); }
    held=null; drag=null; longPressCancel(); stopAuto();
    live.forEach(c=>{ try{ c.handle?.destroy?.(); }catch(e){} }); live.clear();
    stopCards(); stopCards=()=>{};
    if(panel){ panel.removeEventListener("pointerdown",onPointerDown); panel.removeEventListener("click",onClickCapture,true); panel.removeEventListener("contextmenu",onContextMenu); panel.classList.remove("hm-editing"); }
    removeEventListener("pointermove",onPointerMove); removeEventListener("pointerup",onPointerUp); removeEventListener("pointercancel",onPointerUp);
    mq.removeEventListener?.("change",onMQ);
    cancelAnimationFrame(padRaf); padRaf=0;
    stopFades(); stopFades=()=>{}; stopTilt(); clearInterval(clock); clearInterval(refreshT); clearInterval(pcT); panel=null; },
};
