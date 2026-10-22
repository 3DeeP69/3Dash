// ===========================================================================
// T.U.R.D. CORE — shell, 3D scene, login, hidden audit, section registry.
// Owned by the "core" thread. Section modules self-register against this.
//
// SECTION CONTRACT (default export of each ./sections/<id>.js):
//   {
//     id:    "weather",                 // unique, also the dynamic-import filename
//     icon:  "❂",                       // single glyph for the nav rail
//     label: "Weather",                 // tooltip / title
//     theme: { accent:"#6ad6ff", accent2:"#3f8bff", rgb:"106,214,255" },
//     mount(panelEl, ctx) {...},        // render into the panel; called on each show
//     unmount() {...}?,                 // optional cleanup when leaving
//     summary(ctx) {...}?,              // optional -> { title, value, note } for Home tiles
//   }
//   ctx = { LS, toast, esc, head, show(id), session, setLoc(text), sections() }
//
// Nav order follows ORDER below; unknown ids append in load order.
// ===========================================================================
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* ---- known section files (dynamic-imported; missing files are skipped) ---- */
const SECTION_FILES = ["home","assistant","weather","projects","logbook","chat","opsec","entertainment","extras"]; // radar+netwatch fold into the Spy Tools (opsec) tab, no longer standalone sections
const ORDER = ["home","assistant","weather","logbook","chat","opsec","entertainment","extras","projects"]; // Projects lands at the bottom of the rail

/* ------------------------------------------------------------- utilities */
export const LS = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} },
};
export const $ = (s,r=document)=>r.querySelector(s);
export const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
export const esc = s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const head = (title,key,sub)=>`<div class="phead t-phead"><span class="k">${esc(key)}</span><h1>${esc(title)}</h1><span class="sub">${esc(sub||"")}</span></div>`;
export const toast = (()=>{ const el=$("#toast"); let t; return m=>{ el.textContent=m; el.classList.add("show"); clearTimeout(t); t=setTimeout(()=>el.classList.remove("show"),2600);};})();
const setLoc = t=>{ $("#st-loc").textContent=t; };

/* ------------------------------------------------------------- registry */
const registered = new Map();            // id -> def
export function registerSection(def){
  if(!def || !def.id){ console.warn("[TURD] bad section def",def); return; }
  registered.set(def.id, def);
  // live insert only after boot; startApp builds the stage + nav once for the initial load
  if(BOOTED){ buildStage(); buildNav(); if(current) markNav(current); else show(orderedIds()[0]); }
}
const orderedIds = ()=> [...registered.keys()].sort((a,b)=>{
  const ia=ORDER.indexOf(a), ib=ORDER.indexOf(b);
  return (ia<0?99:ia)-(ib<0?99:ib);
});
window.TURD = { registerSection, LS, esc, head, toast, setTheme:(t)=>applyTheme(t), sections:()=>[...registered.values()] };

/* ------------------------------------------------------------- auth + audit */
const AUTH = {
  users(){ let u=LS.get("turd_users",null); if(!u){ u={admin:{pw:"admin",fresh:true,role:"admin"}}; LS.set("turd_users",u);} return u; },
  saveUsers(u){ LS.set("turd_users",u); },
  log(user,ok,note){ const a=LS.get("turd_audit",[]);
    a.push({t:Date.now(),user:String(user||"").slice(0,40),ok,note:note||"",ua:navigator.userAgent.slice(0,80),tz:Intl.DateTimeFormat().resolvedOptions().timeZone});
    if(a.length>500) a.splice(0,a.length-500); LS.set("turd_audit",a); },
  audit(){ return LS.get("turd_audit",[]); },
  attempt(user,pw){ const u=this.users(),rec=u[user];
    if(rec&&rec.pw===pw){ this.log(user,true,"granted"); return {ok:true,fresh:rec.fresh,role:rec.role}; }
    this.log(user,false,rec?"bad passkey":"unknown operator"); return {ok:false}; },
  setPass(user,pw){ const u=this.users(); if(u[user]){ u[user].pw=pw; u[user].fresh=false; this.saveUsers(u); this.log(user,true,"passkey rotated"); } },
};
let SESSION=null, BOOTED=false;

/* ------------------------------------------------------------- 3D scene */
let renderer,scene,camera,wave,waveB,core,glow,stars,raf;
function autoQuality(){ // defaults tuned to the owner's FLOOR hardware: Galaxy Fold4 + a low-end gaming PC.
  // MED is the safe default for both — and because the desktop PR floor is native 1x and text/HUD are
  // DOM (always native DPR), MED still looks sharp on the PC; HIGH only adds scene lushness, not crispness.
  try{ const mem=navigator.deviceMemory||4, cores=navigator.hardwareConcurrency||4,
    mobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent||""),
    fine=(typeof matchMedia!=="undefined" && matchMedia("(pointer:fine)").matches);
    if(mem<=2||cores<=2) return "LOW";                         // very weak device
    if(fine && !mobile) return (mem>=8 && cores>=12) ? "HIGH" : "MED";  // desktop: MED unless clearly strong
    return (mobile||mem<=4||cores<=4) ? "MED" : "HIGH";        // phones/tablets incl. Fold4 → MED
  }catch(e){ return "MED"; } }
let QUALITY_LOCKED=!!LS.get("turd_quality",null);           // operator picked a tier manually
let QUALITY=LS.get("turd_quality",null)||autoQuality();     // otherwise auto-pick
let frame=0, fpsAcc=0, fpsN=0, lastGov=0, lastFrameT=0, PR=1, baseFps=0;  // frame-governor state
// desktop (a real pointer) keeps the XMB wave lines crisp — never resample below 1x there;
// phones can still drop to 0.75 under load. Fixes "everything is a bit blurry on PC".
const PR_FLOOR=(typeof matchMedia!=="undefined" && matchMedia("(pointer:fine)").matches)?Math.min(devicePixelRatio||1,1):0.75;
document.body.dataset.quality=QUALITY; document.body.classList.toggle("q-low",QUALITY==="LOW");
const target={ color:new THREE.Color("#2f8cff") };   // console-blue base (XMB)
const target2={ color:new THREE.Color("#0050d0") };  // secondary (wave depth layer)
const mouse={ x:0, y:0 };
function initScene(){
  const canvas=$("#scene");
  renderer=new THREE.WebGLRenderer({canvas,antialias:QUALITY!=="LOW",alpha:true,powerPreference:"high-performance"});
  PR=Math.min(devicePixelRatio,QUALITY==="HIGH"?2:QUALITY==="MED"?1.5:1); renderer.setPixelRatio(PR); baseFps=0;
  scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0x03060f,0.03);
  camera=new THREE.PerspectiveCamera(60,1,0.1,140); camera.position.set(0,2.4,17);
  // --- PS3 XMB-style flowing wave ribbon: the hero backdrop, recolors from the active theme ---
  const segX=QUALITY==="HIGH"?170:QUALITY==="MED"?110:64, segY=QUALITY==="HIGH"?44:26;
  wave=new THREE.Mesh(new THREE.PlaneGeometry(110,30,segX,segY),waveMat(target.color,0.32,
    "sin(position.x*0.16+uT*0.9)*1.4 + cos(position.y*0.2+uT*0.65)*1.1 + sin((position.x+position.y)*0.08+uT*0.5)*0.7"));
  wave.rotation.x=-Math.PI/2.35; wave.position.y=-5; scene.add(wave);
  // deeper second wave layer (accent2) for XMB-style parallax depth
  waveB=new THREE.Mesh(new THREE.PlaneGeometry(130,34,segX,segY),waveMat(target2.color,0.15,
    "sin(position.x*0.13-uT*0.8)*1.6 + cos(position.y*0.17-uT*0.5)*1.0"));
  waveB.rotation.x=-Math.PI/2.35; waveB.position.set(0,-6.6,-4); scene.add(waveB);
  // soft additive bloom glow behind the wave
  const gc=document.createElement("canvas"); gc.width=gc.height=256; const gx=gc.getContext("2d");
  const grd=gx.createRadialGradient(128,128,0,128,128,128); grd.addColorStop(0,"rgba(255,255,255,.95)"); grd.addColorStop(.4,"rgba(255,255,255,.25)"); grd.addColorStop(1,"rgba(255,255,255,0)");
  gx.fillStyle=grd; gx.fillRect(0,0,256,256);
  glow=new THREE.Mesh(new THREE.PlaneGeometry(52,52),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(gc),color:target.color.clone(),transparent:true,opacity:0.45,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.position.set(0,-1,-16); scene.add(glow);
  // drifting glow core
  core=new THREE.Mesh(new THREE.IcosahedronGeometry(1.7,1),new THREE.MeshBasicMaterial({color:target.color.clone(),wireframe:true,transparent:true,opacity:0.4}));
  core.position.set(6,4.2,-10); scene.add(core);
  // starfield
  const N=QUALITY==="HIGH"?2400:QUALITY==="MED"?1300:650, pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){ const r=16+Math.random()*34,a=Math.random()*Math.PI*2,b=Math.acos(2*Math.random()-1);
    pos[i*3]=r*Math.sin(b)*Math.cos(a); pos[i*3+1]=r*Math.sin(b)*Math.sin(a); pos[i*3+2]=r*Math.cos(b); }
  const pg=new THREE.BufferGeometry(); pg.setAttribute("position",new THREE.BufferAttribute(pos,3));
  stars=new THREE.Points(pg,new THREE.PointsMaterial({color:0xbcd8ff,size:0.055,transparent:true,opacity:0.7})); scene.add(stars);
  resize(); addEventListener("resize",resize); addEventListener("pointermove",onPointer);
  animate();
}
// wireframe wave material whose z-displacement runs in the vertex shader (uT = seconds) — zero per-frame CPU
const WAVE_T={ value:0 };
function waveMat(color,opacity,z){
  const m=new THREE.MeshBasicMaterial({color:color.clone(),wireframe:true,transparent:true,opacity});
  m.onBeforeCompile=sh=>{ sh.uniforms.uT=WAVE_T;
    sh.vertexShader="uniform float uT;\n"+sh.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\n  transformed.z = "+z+";"); };
  return m;
}
function onPointer(e){ mouse.x=(e.clientX/innerWidth-0.5); mouse.y=(e.clientY/innerHeight-0.5); }
function disposeScene(){
  cancelAnimationFrame(raf);
  scene.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  renderer.dispose(); renderer=null;
}
function resize(){ renderer.setSize(innerWidth,innerHeight,false); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); }
function animate(){ raf=requestAnimationFrame(animate); frame++;
  if(window.TURD_IDLE && (frame%6)!==0) return;   // idle ambient mode: drop to ~10fps to spare the low-end PC + Fold battery
  const t=performance.now()*0.001;
  WAVE_T.value=t;
  wave.material.color.lerp(target.color,0.05); waveB.material.color.lerp(target2.color,0.05);
  glow.material.color.lerp(target.color,0.05); glow.scale.setScalar(1+Math.sin(t*0.8)*0.08); glow.lookAt(camera.position);
  core.rotation.x-=0.003; core.rotation.y+=0.005; core.material.color.lerp(target.color,0.05);
  stars.rotation.y-=0.00025;
  camera.position.x+=(mouse.x*3-camera.position.x)*0.035; camera.position.y+=(2.4-mouse.y*2-camera.position.y)*0.035; camera.lookAt(0,0,-5);
  renderer.render(scene,camera);
  // frame governor (device-relative): learn this device's own cap first (handles 30/60/120Hz panels
  // and power-saving), then act only on real jank — trim pixelRatio before dropping a whole tier.
  const now=performance.now();
  if(lastFrameT){ fpsAcc+=now-lastFrameT; if(++fpsN>=60){ const fps=1000/(fpsAcc/fpsN); fpsAcc=0; fpsN=0;
    if(!baseFps){ baseFps=fps; }                              // first full window = baseline
    else if(!QUALITY_LOCKED && now-lastGov>5000 && fps<baseFps*0.7 && fps<50){ lastGov=now;
      if(PR>PR_FLOOR){ PR=Math.max(PR_FLOOR,+(PR-0.25).toFixed(2)); renderer.setPixelRatio(PR); renderer.setSize(innerWidth,innerHeight,false); }
      else if(QUALITY!=="LOW"){ QUALITY=QUALITY==="HIGH"?"MED":"LOW"; document.body.dataset.quality=QUALITY; document.body.classList.toggle("q-low",QUALITY==="LOW");
        const pv=$("#perf-val"); if(pv) pv.textContent=QUALITY; disposeScene(); initScene(); return; } } } }
  lastFrameT=now;
}

/* ------------------------------------------------------------- theming */
function applyTheme(theme){
  if(!theme) return;
  const b=document.body.style;
  if(theme.accent) b.setProperty("--accent",theme.accent);
  if(theme.accent2) b.setProperty("--accent2",theme.accent2);
  if(theme.rgb) b.setProperty("--accent-rgb",theme.rgb);
  if(theme.accent) target.color=new THREE.Color(theme.accent);
  if(theme.accent2) target2.color=new THREE.Color(theme.accent2);
}

/* ------------------------------------------------------------- stage / nav */
function buildStage(){
  const stage=$("#stage");
  orderedIds().forEach(id=>{
    if(stage.querySelector(`[data-sec="${id}"]`)) return;
    const sec=document.createElement("section"); sec.className="section"; sec.dataset.sec=id;
    const panel=document.createElement("div"); panel.className="panel"; panel.id="sec-"+id;
    sec.appendChild(panel); stage.appendChild(sec);
  });
}
function buildNav(){
  const nav=$("#nav"); nav.innerHTML="";
  orderedIds().forEach(id=>{ const def=registered.get(id);
    const btn=document.createElement("button"); btn.className="navbtn"; btn.dataset.go=id;
    btn.title=def.label||id; btn.setAttribute("aria-label",def.label||id);
    btn.innerHTML=`<span class="ico" aria-hidden="true">${def.icon||"●"}</span><span class="lbl">${esc(def.label||id)}</span>`;
    btn.onclick=()=>show(id); nav.appendChild(btn);
  });
}
let current=null, currentDef=null;
function markNav(id){ $$(".navbtn").forEach(b=>{ const on=b.dataset.go===id; b.classList.toggle("active",on); on?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current"); }); }
export function show(id){
  const def=registered.get(id); if(!def) return;
  if(currentDef && currentDef.unmount){ try{ currentDef.unmount(); }catch(e){} }
  current=id; currentDef=def;
  document.body.dataset.section=id;
  applyTheme(def.theme);
  $$(".section").forEach(s=>s.classList.toggle("show",s.dataset.sec===id));
  markNav(id);
  const panel=$("#sec-"+id);
  try{ def.mount(panel, ctx); }catch(e){ panel.innerHTML=head(def.label||id,"ERR","module fault")+`<div class="card"><p>${esc(e.message)}</p></div>`; }
}
const ctx = { LS, toast, esc, head, show, get session(){ return SESSION; }, setLoc, setTheme:applyTheme,
  // CORS-free fetch for sections (project status, site sync, weather). Web = plain fetch;
  // native builds set window.TURD_HTTP (Capacitor CapacitorHttp / Tauri http plugin) for reliable cross-origin.
  get http(){ return (typeof window!=="undefined" && window.TURD_HTTP) || (window.fetch ? window.fetch.bind(window) : fetch); },
  sections:()=>[...registered.values()] };

/* ------------------------------------------------------------- hidden audit */
function openAudit(){
  if(!SESSION || SESSION.role!=="admin"){ toast("admin clearance required"); return; }
  const a=AUTH.audit().slice().reverse();
  $("#modalBody").innerHTML=`<div class="phead" style="--accent:#ff5c7a"><span class="k">SEC</span><h1>Access Log</h1><span class="sub">${a.length} attempts · admin-only</span></div>
    <div class="row" style="justify-content:flex-end;margin-bottom:12px;gap:8px"><button class="btn sm" id="auditClr">CLEAR LOG</button><button class="btn sm" id="auditClose">CLOSE</button></div>
    <table><thead><tr><th>time</th><th>operator</th><th>result</th><th>note</th><th>zone</th></tr></thead><tbody>`+
    (a.length?a.map(r=>`<tr><td>${new Date(r.t).toLocaleString()}</td><td>${esc(r.user)}</td><td class="${r.ok?"ok":"bad"}">${r.ok?"GRANTED":"DENIED"}</td><td>${esc(r.note)}</td><td>${esc(r.tz||"")}</td></tr>`).join(""):`<tr><td colspan="5" class="muted">no attempts logged</td></tr>`)+`</tbody></table>`;
  $("#modal").classList.add("show");
  $("#auditClose").onclick=()=>$("#modal").classList.remove("show");
  $("#auditClr").onclick=()=>{ LS.set("turd_audit",[]); openAudit(); toast("access log cleared"); };
}
let brandClicks=0,brandTimer,typed="";
$("#brand").addEventListener("click",()=>{ brandClicks++; clearTimeout(brandTimer); brandTimer=setTimeout(()=>brandClicks=0,900); if(brandClicks>=5){ brandClicks=0; openAudit(); } });
addEventListener("keydown",e=>{ if(/^[a-z]$/i.test(e.key) && !e.target.closest?.("input,textarea,select,[contenteditable]")){ typed=(typed+e.key.toLowerCase()).slice(-6); if(typed.endsWith("audit")) openAudit(); } if(e.key==="Escape"){ $("#modal").classList.remove("show"); const bg=$("#byg"); if(bg) bg.classList.remove("show"); } });

/* ------------------------------------------------------------- perf toggle */
$("#perf").onclick=()=>{ const o=["HIGH","MED","LOW"]; QUALITY=o[(o.indexOf(QUALITY)+1)%3]; QUALITY_LOCKED=true; LS.set("turd_quality",QUALITY);
  $("#perf-val").textContent=QUALITY; document.body.dataset.quality=QUALITY; document.body.classList.toggle("q-low",QUALITY==="LOW");
  if(renderer){ disposeScene(); initScene(); } toast("render quality: "+QUALITY); };

/* ------------------------------------------------------------- clock + boot */
setInterval(()=>{ $("#st-clock").textContent=new Date().toLocaleTimeString([],{hour12:false}); },1000);
(function boot(){ const lines=["> cold-boot T.U.R.D. core","> mounting HUD lattice … ok","> calibrating visor curvature … ok","> audit subsystem … armed","> loading section modules …","> awaiting operator uplink"];
  let i=0,el=$("#boot"); (function step(){ if(i<lines.length){ el.textContent+=(i?"\n":"")+lines[i++]; setTimeout(step,240); } })(); })();

/* ------------------------------------------------------------- login flow */
async function loadSections(){
  await Promise.all(SECTION_FILES.map(async id=>{
    try{ const m=await import(`./sections/${id}.js`); if(m && m.default) registerSection(m.default); }
    catch(e){ /* module not present yet — skip silently */ }
  }));
}
async function startApp(){
  $("#login").classList.add("hide");
  // device sync (./sync.js, Device-sync thread): keeps this operator's data in step across PC + Fold
  import("./sync.js").then(m=>m.start&&m.start(SESSION)).catch(()=>{});
  // the 3D scene is decorative — if WebGL is unavailable it must not block the app booting
  // (sections, voice, nav). The body keeps its XMB gradient as the backdrop in that case.
  if(!renderer){ try{ initScene(); }catch(e){ renderer=null; document.body.classList.add("no-scene"); console.warn("[TURD] 3D scene unavailable, continuing without it:",e); } }
  $("#perf-val").textContent=QUALITY;
  await loadSections();
  buildStage(); buildNav(); BOOTED=true; buildSessionTools();
  // "Hey T.U.R.D." hands-free voice (offline; ./voice/wake.js, owned by the assistant thread)
  import("./voice/wake.js").then(m=>m.init(ctx)).catch(()=>{});
  // idle ambient mode (./idle.js): console screensaver after a few minutes; it sets window.TURD_IDLE
  import("./idle.js").then(m=>m.init(ctx)).catch(()=>{});
  // console sounds (./sfx.js): Web-Audio boot chime + soft UI cues; self-wires via DOM observers
  import("./sfx.js").then(m=>m.init(ctx)).catch(()=>{});
  const first=orderedIds()[0];
  if(first) show(first);
  else $("#stage").innerHTML=`<div class="section show"><div class="panel">${head("No sections","—","")}<div class="card"><p class="muted">No section modules loaded yet. They're being built in a parallel thread and will appear here automatically.</p></div></div></div>`;
}
/* status-bar tools: Access log exists in the DOM only for admins; Lock is for everyone */
function buildSessionTools(){
  const bar=$("#status .rstat"); if(!bar || $("#st-tools")) return;
  const android = typeof window!=="undefined" && window.TURD_NATIVE && window.TURD_NATIVE.platform==="android";
  const t=document.createElement("span"); t.id="st-tools";
  t.innerHTML=(android?`<button class="st-btn" id="stWake" title="Wake your PC over the network (Wake-on-LAN)">⚡ Wake PC</button>`:"")+
    (SESSION&&SESSION.role==="admin"?`<button class="st-btn" id="stAudit" title="Admin-only access log">⛨ Access log</button>`:"")+
    `<button class="st-btn" id="stLogout" title="Evening recap, then sign out (ends the server session too)">⏏ Log out</button>`+
    `<button class="st-btn" id="stLock" title="Lock T.U.R.D. — quick return to the login deck">⏻ Lock</button>`;
  bar.prepend(t);
  const wk=$("#stWake"); if(wk) wk.onclick=openWake;
  const a=$("#stAudit"); if(a) a.onclick=openAudit;
  $("#stLogout").onclick=openBeforeYouGo;
  $("#stLock").onclick=()=>{ SESSION=null; location.reload(); };
}
/* Wake-on-LAN: wake the operator's PC from the Fold app (Android only). The native bridge
   learns the PC from the chat server; if it hasn't yet, the operator enters the MAC by hand. */
async function openWake(){
  const N=window.TURD_NATIVE; if(!N || !N.wake){ toast("wake not available on this device"); return; }
  let tgt=null; try{ tgt=await N.wakeTarget(); }catch(e){}
  const tip='Turn on Wake-on-LAN in your PC\'s BIOS, and in Device Manager → network adapter → Power Management tick "Allow this device to wake the computer" (and "Only allow a magic packet").';
  $("#modalBody").innerHTML=`<div class="phead"><span class="k">NET</span><h1>Wake PC</h1><span class="sub">${tgt?esc(tgt.name||tgt.mac):"no PC learned yet"}</span></div>
    <div class="card">`+
    (tgt?`<p class="muted">Send a Wake-on-LAN magic packet to <b>${esc(tgt.name||tgt.mac)}</b>.</p>`
        :`<div class="f"><label>PC MAC address</label><input id="wakeMac" placeholder="AA:BB:CC:DD:EE:FF" autocomplete="off"></div>`)+
    `<div class="row" style="gap:8px;margin-top:14px"><button class="btn" id="wakeGo">⚡ SEND WAKE</button><button class="btn sm" id="wakeClose">CLOSE</button></div>
     <p class="muted mono" style="font-size:11px;margin-top:16px;line-height:1.55">${esc(tip)}</p></div>`;
  $("#modal").classList.add("show");
  $("#wakeClose").onclick=()=>$("#modal").classList.remove("show");
  $("#wakeGo").onclick=async()=>{
    const mac=tgt?null:(($("#wakeMac").value||"").trim());
    if(!tgt && !mac){ toast("enter the PC's MAC address"); return; }
    const go=$("#wakeGo"); go.disabled=true;
    try{ const r=await N.wake(mac||undefined); toast(r&&r.sent?"wake packet sent":(r&&r.ok?"wake sent":"wake failed")); if(r&&r.sent) setTimeout(()=>$("#modal").classList.remove("show"),600); }
    catch(e){ toast("wake failed: "+String(e&&e.message||e)); }
    go.disabled=false;
  };
}
/* "Before you go": a full-screen evening recap shown when the operator taps Log out, with
   Log out / Stay. Prefers the weather/logbook thread's full recap module (farewell.js:
   beforeYouGo(ctx) → Promise<boolean>, true=Log out); if that's absent, core composes a quick
   recap from each section's summary(). Log out ends the uplink/server session (Lock stays a quick local lock). */
async function openBeforeYouGo(){
  try{ const m=await import("./sections/farewell.js"); if(m && m.beforeYouGo){ const go=await m.beforeYouGo(ctx); if(go) doLogout(); return; } }catch(e){ /* fall through to the built-in recap */ }
  ensureBygStyles();
  let ov=$("#byg"); if(!ov){ ov=document.createElement("div"); ov.id="byg"; document.body.appendChild(ov); }
  ov.innerHTML=`<div class="byg-card"><div class="byg-head"><span class="k">Before you go</span><h1>Signing off${SESSION&&SESSION.user?", "+esc(SESSION.user):""}</h1></div>
    <div class="byg-body" id="bygBody"><p class="muted">preparing your recap…</p></div>
    <div class="row" style="gap:10px;justify-content:center;margin-top:20px"><button class="btn" id="bygOut">⏏ LOG OUT</button><button class="btn sm" id="bygStay">STAY</button></div></div>`;
  ov.classList.add("show");
  ov.onclick=e=>{ if(e.target===ov) ov.classList.remove("show"); };
  const stay=$("#bygStay"); if(stay) stay.onclick=()=>ov.classList.remove("show");
  const out=$("#bygOut"); if(out) out.onclick=doLogout;
  try{ const h=await recapHTML(); const b=$("#bygBody"); if(b) b.innerHTML=h; }catch(e){ const b=$("#bygBody"); if(b) b.innerHTML='<p class="muted">Recap unavailable.</p>'; }
}
function ensureBygStyles(){ if(document.getElementById("byg-css")) return;
  const s=document.createElement("style"); s.id="byg-css"; s.textContent=`
  #byg{position:fixed;inset:0;z-index:25;display:none;place-items:center;background:radial-gradient(130% 100% at 50% -20%,rgba(16,30,66,.5),rgba(2,4,9,.92));opacity:0;transition:opacity .4s}
  #byg.show{display:grid;opacity:1}
  .byg-card{width:min(640px,92vw);max-height:86vh;overflow:auto;text-align:center;padding:30px 30px 26px;border-radius:22px;background:var(--glass);border:1px solid rgba(var(--accent-rgb),.4);box-shadow:0 30px 90px rgba(0,0,0,.6)}
  .byg-head .k{font-family:var(--mono);font-size:10px;letter-spacing:4px;color:var(--accent);text-transform:uppercase}
  .byg-head h1{font-size:26px;margin:6px 0 4px;color:var(--ink)}
  .byg-lead{color:var(--ink-dim);margin:2px 0 16px;font-size:13px}
  .byg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:8px}
  .byg-tile{background:rgba(255,255,255,.05);border:1px solid var(--glass-line);border-radius:12px;padding:12px 10px;text-align:left}
  .byg-tile .k{display:block;font-family:var(--mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-dim)}
  .byg-tile b{display:block;font-size:24px;color:var(--ink);line-height:1.1;margin:4px 0 2px}
  .byg-tile span{font-size:11px;color:var(--ink-dim)}`;
  document.head.appendChild(s);
}
async function recapHTML(){
  try{ if(typeof window.TURD_RECAP==="function"){ const r=await window.TURD_RECAP(ctx); if(r) return typeof r==="string"?r:((r&&r.outerHTML)||""); } }catch(e){}
  const tiles=[...registered.values()].map(d=>{ try{ const s=d.summary&&d.summary(ctx); return s?`<div class="byg-tile"><span class="k">${esc(d.label||d.id)}</span><b>${esc(String(s.value))}</b><span>${esc(s.note||"")}</span></div>`:""; }catch(e){ return ""; } }).filter(Boolean).join("");
  return `<p class="byg-lead">Here's where today stands before you sign off.</p><div class="byg-grid">${tiles||'<p class="muted">Nothing to recap yet.</p>'}</div>`;
}
async function doLogout(){
  try{ const up=await getUplink(); if(up&&up.logout){ await up.logout(); } }catch(e){}   // end the server session too
  SESSION=null; location.reload();
}
/* console-style navigation: [ ] or PageUp/PageDown switch sections, arrows move along the rail,
   and a gamepad's D-pad / LB-RB does the same */
function step(d){ const ids=orderedIds(); if(!ids.length) return; const i=Math.max(0,ids.indexOf(current)); const id=ids[(i+d+ids.length)%ids.length];
  show(id); const b=$(`.navbtn[data-go="${id}"]`); if(b && document.activeElement?.classList.contains("navbtn")) b.focus(); }
addEventListener("keydown",e=>{
  if(!BOOTED || window.TURD_OVERLAY || $("#modal").classList.contains("show") || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.target.closest?.("input,textarea,select,[contenteditable],iframe")) return;
  const onRail=e.target.classList?.contains("navbtn");
  if(e.key==="]"||e.key==="PageDown"||(onRail&&(e.key==="ArrowDown"||e.key==="ArrowRight"))){ e.preventDefault(); step(1); }
  else if(e.key==="["||e.key==="PageUp"||(onRail&&(e.key==="ArrowUp"||e.key==="ArrowLeft"))){ e.preventDefault(); step(-1); }
});
let padRaf=0; const padPrev={};
function pollPad(){
  const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
  if(!pads.length){ padRaf=0; return; }
  pads.forEach(p=>{ const hit=n=>{ const on=!!p.buttons[n]?.pressed, was=padPrev[p.index+":"+n]; padPrev[p.index+":"+n]=on; return on&&!was; };
    if(BOOTED && !window.TURD_OVERLAY && !$("#modal").classList.contains("show")){ if(hit(13)||hit(5)) step(1); if(hit(12)||hit(4)) step(-1); }
    else { hit(13); hit(5); hit(12); hit(4); } });
  padRaf=requestAnimationFrame(pollPad);
}
addEventListener("gamepadconnected",()=>{ if(!padRaf) padRaf=requestAnimationFrame(pollPad); });
function forcePassChange(user){
  const card=$(".login-card");
  card.innerHTML=`<div class="login-logo" style="font-size:28px">SET PASSKEY</div><div class="login-sub">first uplink · rotate the default</div>
    <div class="f" style="text-align:left;margin-bottom:14px"><label>new passkey</label><input id="np" type="password" placeholder="choose a strong passkey"></div>
    <div class="f" style="text-align:left;margin-bottom:14px"><label>confirm</label><input id="np2" type="password"></div>
    <div class="login-msg" id="lmsg2"></div><button class="btn" style="width:100%" id="npBtn">LOCK IT IN</button>
    <button class="btn" style="width:100%;margin-top:8px;background:transparent" id="npSkip">keep default for now</button>`;
  $("#npBtn").onclick=async()=>{ const a=$("#np").value,b=$("#np2").value,m=$("#lmsg2");
    if(a.length<4){ m.className="login-msg err"; m.textContent="! min 4 characters"; return; }
    if(a!==b){ m.className="login-msg err"; m.textContent="! passkeys don't match"; return; }
    const up=await getUplink(); if(up&&up.setPass){ try{ await up.setPass(user,a); }catch(_){} }
    AUTH.setPass(user,a); // always mirror the new passkey locally → the owner keeps a working local recovery login
    SESSION={user,role:SESSION?.role||"admin",token:SESSION?.token}; toast("passkey rotated"); startApp(); };
  $("#npSkip").onclick=()=>{ const u=AUTH.users(); u[user].fresh=false; AUTH.saveUsers(u); SESSION={user,role:SESSION?.role||"admin",token:SESSION?.token}; startApp(); };
}
// optional chat-server client (./uplink.js). When present+configured, logins authenticate
// against the server (multi-device accounts); otherwise core uses the local AUTH store.
let UPLINK=null;
async function getUplink(){ if(UPLINK!==null) return UPLINK||null;
  try{ const m=await import("./uplink.js"); UPLINK=(m&&m.configured&&m.configured())?m:false; }catch(_){ UPLINK=false; } return UPLINK||null; }
$("#loginForm").addEventListener("submit",async e=>{ e.preventDefault();
  const user=($("#u").value||"").trim()||"admin",pw=$("#p").value,m=$("#lmsg");
  const up=await getUplink();
  let r=null, token;
  if(up){
    // Uplink configured → the server is authoritative. Fall back to local ONLY when it is
    // UNREACHABLE (up.login throws → owner recovery while offline), NEVER on a definite {ok:false}
    // reject — otherwise default admin/admin would bypass a reachable, rejecting server on any fresh device.
    try{ r=await up.login(user,pw); token=r&&r.token; }
    catch(_){ r=AUTH.attempt(user,pw); token=undefined; }
  } else {
    r=AUTH.attempt(user,pw); // no server linked → local store
  }
  if(r.ok){ m.className="login-msg ok"; m.textContent="> access granted"; SESSION={user,role:r.role,token};
    setTimeout(()=>{ if(r.fresh) forcePassChange(user); else startApp(); },450);
  }else{ m.className="login-msg err"; m.textContent="! access denied — attempt logged"; $("#p").value="";
    $(".login-card").animate([{transform:"translateX(-7px)"},{transform:"translateX(7px)"},{transform:"none"}],{duration:260}); }
});
$("#u").value="admin";
