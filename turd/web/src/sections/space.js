// ===========================================================================
// SPACE — the NASA / space deck. Seven sub-tabs, only the visible one is live:
//   TODAY     NASA picture of the day + at-a-glance tiles (ISS, moon, aurora, launch…)
//   ISS       live station tracker (on-device SGP4), ground track, passes over you, crew
//   SKY       tonight: sun + twilight, moon phase, planets, meteor showers (pure math, offline)
//   SUN       space weather: Kp + 3-day forecast, NOAA R/S/G scales, solar wind, flares,
//             and whether the aurora can reach your location
//   ASTEROIDS close approaches for the next 60 days (JPL), on a lunar-distance scale
//   MARS      latest raw photos from Perseverance / Curiosity
//   LAUNCHES  upcoming launches worldwide with a live T-minus countdown
// Free sources only (see ./space/data.js). Every feed caches its last good copy, so
// the tab works offline. Potato mode (QUALITY LOW): no auto-loaded images, slower
// tracker refresh, no shadows/animation. Location comes from the Weather section.
// ===========================================================================
import { edgeFades, kit, quality, ago } from "./util.js";
import * as WX from "./wxdata.js";
import * as A from "./space/astro.js";
import * as O from "./space/orbit.js";
import * as D from "./space/data.js";
import { landRings } from "./space/land.js";
import { registerCard } from "./homecards.js";

const TABS = [
  { id:"today",  icon:"◉", label:"Today" },
  { id:"iss",    icon:"✦", label:"ISS" },
  { id:"sky",    icon:"☾", label:"Sky" },
  { id:"sun",    icon:"☀", label:"Sun" },
  { id:"rocks",  icon:"☄", label:"Asteroids" },
  { id:"mars",   icon:"♂", label:"Mars" },
  { id:"launch", icon:"▲", label:"Launches" },
];
const LOW = ()=> quality()==="LOW";
const imperial = ()=> WX.units()!=="C";
const loc = ()=>{ const l=WX.getLoc()||WX.DEFAULT_LOC; return { lat:+l.lat, lon:+l.lon, name:l.name||"your location" }; };
const fT = t=> t? new Date(t).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}) : "—";
const fD = t=> new Date(t).toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"});
const dayName = t=>{ const a=new Date(), b=new Date(t); a.setHours(0,0,0,0); b.setHours(0,0,0,0); const d=Math.round((b-a)/86400e3);
  return d===0?"Today":d===1?"Tomorrow":d===-1?"Yesterday":d>1&&d<7?b.toLocaleDateString([], {weekday:"long"}):fD(t); };
const when = t=> `${dayName(t)} ${fT(t)}`;
const dur = ms=>{ const s=Math.max(0,Math.round(ms/1000)), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
  return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`; };
const tminus = ms=>{ const neg=ms<0, s=Math.abs(Math.round(ms/1000)), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60), x=s%60, p=n=>String(n).padStart(2,"0");
  return `T${neg?"+":"−"}${d?d+"d ":""}${p(h)}:${p(m)}:${p(x)}`; };
const dist = km=> imperial()? `${Math.round(km*0.621371).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`;
const speed = kms=> imperial()? `${Math.round(kms*2236.94).toLocaleString()} mph` : `${Math.round(kms*3600).toLocaleString()} km/h`;
const sizeLike = m=> m==null?"": m<5?"car-sized": m<15?"bus-sized": m<40?"house-sized": m<110?"football-field-sized": m<300?"stadium-sized": m<1000?"skyscraper-sized":"mountain-sized";

let K, panel, body, cleanup=()=>{}, stopFades=()=>{}, curTab=null, gen=0;
const openExt = url=>{ const N=window.TURD_NATIVE; if(N && N.openExternal) N.openExternal(url); else window.open(url,"_blank","noopener"); };
const stamp = r=> r ? `<span class="sp-stamp${r.stale?" stale":""}">${r.stale?(r.offline?"offline · ":"cached · "):""}${ago(r.t)}</span>` : "";
const E = s=> K.esc(s==null?"":String(s));

/* images: potato mode never auto-loads a picture — it shows a tap-to-load slot instead */
function pic(src, alt, cls="", big=false){
  if(!src) return "";
  if(LOW() || (big && navigator.connection && navigator.connection.saveData))
    return `<button class="sp-ph ${cls}" data-src="${E(src)}" data-alt="${E(alt)}" title="Load image">▣ <span>Tap to load image</span></button>`;
  return `<img class="${cls}" src="${E(src)}" alt="${E(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}
function wireMedia(root){
  root.addEventListener("click", e=>{
    const ph=e.target.closest(".sp-ph"); if(ph){ const i=document.createElement("img"); i.src=ph.dataset.src; i.alt=ph.dataset.alt||""; i.className=ph.className.replace("sp-ph","").trim(); i.decoding="async"; i.referrerPolicy="no-referrer"; ph.replaceWith(i); return; }
    const x=e.target.closest("[data-ext]"); if(x){ e.preventDefault(); openExt(x.dataset.ext); return; }
    const g=e.target.closest("[data-sp]"); if(g){ showTab(g.dataset.sp); }
  });
  root.addEventListener("error", e=>{ const i=e.target; if(i && i.tagName==="IMG" && !i.dataset.dead){ i.dataset.dead=1; const d=document.createElement("div"); d.className="sp-noimg "+(i.className||""); d.textContent="image unavailable offline"; i.replaceWith(d); } }, true);
}
const loading = (t="Contacting mission control…")=> `<div class="t-loading"><i></i><i></i><i></i><span>${t}</span></div>`;
const fail = (what, retry=true)=> `<div class="sp-fail"><b>Can't reach ${what}</b><span>No connection and nothing cached yet. It will fill in the next time you're online.</span>${retry?`<button class="t-btn sm" data-retry>Try again</button>`:""}</div>`;

/* ------------------------------------------------------------ moon glyph */
function moonSvg(ph, size=90){
  const k=ph.illum, wax=ph.waxing, rx=Math.abs(1-2*k)*50;
  const limb=wax?1:0, term=wax?(k<.5?0:1):(k<.5?1:0);
  return `<svg class="sp-moon" viewBox="-4 -4 108 108" width="${size}" height="${size}" aria-label="${E(ph.name)}">
    <circle cx="50" cy="50" r="50" fill="#141b2c"/><path d="M50,0 A50,50 0 0 ${limb} 50,100 A${rx.toFixed(2)},50 0 0 ${term} 50,0Z" fill="#e9ecf5"/>
    <circle cx="50" cy="50" r="50" fill="none" stroke="rgba(255,255,255,.18)"/></svg>`;
}

/* =========================================================== TODAY */
async function tabToday(el, my){
  const L=loc(), ph=A.moonPhase(), st=A.sunTimes(L.lat,L.lon);
  el.innerHTML=`<div class="sp-apod" id="spApod">${loading("Fetching NASA's picture of the day…")}</div>
    <div class="sp-tiles" id="spTiles"></div>`;
  const tiles=el.querySelector("#spTiles");
  const tile=(id,k,v,s,go)=>`<button class="sp-tile" data-sp="${go}" id="${id}"><span class="t-k">${k}</span><b>${v}</b><span class="t-s">${s}</span></button>`;
  const now=Date.now(), dark=st.astroDusk&&now<st.astroDusk?st.astroDusk:null;
  tiles.innerHTML=
    tile("spTIss","ISS","—","locating the station…","iss")+
    `<button class="sp-tile sp-tile-moon" data-sp="sky">${moonSvg(ph,54)}<span><span class="t-k">Moon</span><b>${Math.round(ph.illum*100)}%</b><span class="t-s">${E(ph.name)}</span></span></button>`+
    tile("spTKp","Aurora · Kp","—","reading NOAA…","sun")+
    tile("spTLaunch","Next launch","—","checking the manifest…","launch")+
    tile("spTCrew","People in space","—","","iss")+
    tile("spTRock","Closest asteroid","—","","rocks")+
    tile("spTSun", now<st.sunset?"Sunset":"Dark sky", fT(now<st.sunset?st.sunset:(dark||st.astroDusk)), now<st.sunset?`dark by ${fT(st.astroDusk)}`:"astronomical twilight ends", "sky")+
    tile("spTMars","Mars","Latest","rover raw images","mars");
  // APOD with day stepping
  let day=null;
  const drawApod=async()=>{
    const box=el.querySelector("#spApod"); if(!box) return;
    try{
      const r=await D.apod(K.http, day?{date:day}:{}); if(my!==gen) return; const a=r.d;
      const media = a.type==="image" ? pic(a.url, a.title, "sp-apod-img", true)
        : `<button class="sp-apod-vid" data-ext="${E(a.url)}">${a.thumb?pic(a.thumb,a.title,"sp-apod-img"):""}<span>▶ Watch today's video</span></button>`;
      box.innerHTML=`<div class="sp-apod-media">${media}</div>
        <div class="sp-apod-txt"><div class="sp-row"><span class="t-k">NASA · Astronomy Picture of the Day</span>${stamp(r)}</div>
          <h2>${E(a.title)}</h2><div class="sp-sub">${E(fD(Date.parse(a.date+"T12:00:00")))}${a.by?` · © ${E(a.by)}`:""}</div>
          <p class="sp-clamp">${E(a.text)}</p>
          <div class="sp-acts"><button class="t-link" id="apPrev">‹ Prev day</button>${day?`<button class="t-link" id="apNext">Next day ›</button><button class="t-link" id="apToday">Today</button>`:""}
            <button class="t-link" id="apMore">Read more</button>${a.hd?`<button class="t-link" data-ext="${E(a.hd)}">Full res ↗</button>`:""}<button class="t-link" id="apKey" title="Use your own free api.nasa.gov key">Key</button></div></div>`;
      const shift=n=>{ const d=new Date((day||a.date)+"T12:00:00"); d.setDate(d.getDate()+n); const s=d.toISOString().slice(0,10); day = s>=new Date().toISOString().slice(0,10)?null:s; drawApod(); };
      box.querySelector("#apPrev").onclick=()=>shift(-1);
      const nx=box.querySelector("#apNext"); if(nx) nx.onclick=()=>shift(1);
      const td=box.querySelector("#apToday"); if(td) td.onclick=()=>{ day=null; drawApod(); };
      box.querySelector("#apMore").onclick=e=>{ const p=box.querySelector(".sp-clamp"); p.classList.toggle("open"); e.target.textContent=p.classList.contains("open")?"Less":"Read more"; };
      box.querySelector("#apKey").onclick=()=>{ const k=prompt("Optional: paste your own free NASA API key from api.nasa.gov (blank = shared DEMO_KEY).", D.nasaKey()==="DEMO_KEY"?"":D.nasaKey()); if(k!==null){ D.setNasaKey(k); K.toast(k.trim()?"NASA key saved":"using DEMO_KEY"); } };
    }catch(e){ if(my!==gen) return; box.innerHTML=fail("NASA's picture of the day"); box.querySelector("[data-retry]").onclick=drawApod; }
  };
  drawApod();
  // tiles fill in independently; none blocks another
  const set=(id,v,s)=>{ const t=el.querySelector("#"+id); if(!t||my!==gen) return; t.querySelector("b").innerHTML=v; t.querySelector(".t-s").innerHTML=s; };
  (async()=>{ const tle=await O.getTle(K.http).catch(()=>null);
    if(!tle){ set("spTIss","—","tracker needs one online check"); return; }
    const p=await O.issNow(tle); if(p) set("spTIss", `${Math.abs(p.lat).toFixed(1)}°${p.lat>=0?"N":"S"} ${Math.abs(p.lon).toFixed(1)}°${p.lon>=0?"E":"W"}`, "computing your next pass…");
    const ps=await passCache(tle,L); const v=ps.find(x=>x.visible && x.los>Date.now());
    set("spTIss", p?`${Math.abs(p.lat).toFixed(0)}°${p.lat>=0?"N":"S"} ${Math.abs(p.lon).toFixed(0)}°${p.lon>=0?"E":"W"}`:"—", v?`visible ${when(v.aos)} · ${Math.round(v.maxEl)}° ${v.at}`:"no visible pass in 4 days"); })();
  D.swx(K.http).then(r=>{ const kp=r.d.kp.length?r.d.kp[r.d.kp.length-1].kp:null, o=A.auroraOdds(L.lat,L.lon,kp);
    set("spTKp", kp==null?"—":`<span style="color:${D.kpColor(kp)}">${kp.toFixed(1)}</span>`, o.level?E(o.verdict):`needs Kp ${o.needCamera.toFixed(0)}+ here`); }).catch(()=>set("spTKp","—","offline"));
  D.launches(K.http).then(r=>{ const n=r.d.find(x=>x.t>Date.now()-3600e3); if(!n) return set("spTLaunch","—","none listed");
    set("spTLaunch", `<span data-cd="${n.t}">${tminus(n.t-Date.now())}</span>`, E(n.rocket||n.name)); }).catch(()=>set("spTLaunch","—","offline"));
  D.crew(K.http).then(r=>set("spTCrew", r.d.n, `${r.d.people.filter(p=>/iss/i.test(p.craft)||p.iss).length||"?"} on the ISS`)).catch(()=>set("spTCrew","—","offline"));
  D.neo(K.http).then(r=>{ const w=r.d.filter(a=>a.t>Date.now()&&a.t<Date.now()+7*86400e3).sort((a,b)=>a.au-b.au)[0]||r.d.filter(a=>a.t>Date.now()).sort((a,b)=>a.au-b.au)[0];
    if(!w) return set("spTRock","—","none close");
    set("spTRock", `${(w.au*A.AU_KM/A.LD_KM).toFixed(1)} LD`, `${E(w.name)} · ${dayName(w.t)}`); }).catch(()=>set("spTRock","—","offline"));
  const iv=setInterval(()=>{ if(document.hidden) return; el.querySelectorAll("[data-cd]").forEach(s=>s.textContent=tminus(+s.dataset.cd-Date.now())); }, 1000);
  return ()=>clearInterval(iv);
}

/* =========================================================== ISS */
const PK="turd_sp_passes";
async function passCache(tle, L){
  const key=tle.l1+"|"+L.lat.toFixed(2)+","+L.lon.toFixed(2), c=K.LS.get(PK,null);
  if(c && c.key===key && Date.now()-c.t<6*3600e3) return c.p;
  const p=await O.passes(tle, L, LOW()?{days:3, step:40}:{days:5, step:30});
  K.LS.set(PK,{ key, t:Date.now(), p }); return p;
}
let LAND=null, BASE=null;
function drawBase(w,h){
  // static layer (ocean, graticule, land) rendered once per size, then blitted each tick
  const c=document.createElement("canvas"); c.width=w; c.height=h; const g=c.getContext("2d");
  const X=lon=>(lon+180)/360*w, Y=lat=>(90-lat)/180*h;
  g.fillStyle="#060b16"; g.fillRect(0,0,w,h);
  g.strokeStyle="rgba(140,170,255,.08)"; g.lineWidth=1;
  for(let lo=-150;lo<=150;lo+=30){ g.beginPath(); g.moveTo(X(lo),0); g.lineTo(X(lo),h); g.stroke(); }
  for(let la=-60;la<=60;la+=30){ g.beginPath(); g.moveTo(0,Y(la)); g.lineTo(w,Y(la)); g.stroke(); }
  g.strokeStyle="rgba(140,170,255,.16)"; g.beginPath(); g.moveTo(0,Y(0)); g.lineTo(w,Y(0)); g.stroke();
  LAND=LAND||landRings();
  g.fillStyle="#17233d"; g.strokeStyle="rgba(150,180,255,.35)"; g.lineWidth=.8;
  for(const r of LAND){ g.beginPath(); r.forEach(([lo,la],i)=> i?g.lineTo(X(lo),Y(la)):g.moveTo(X(lo),Y(la))); g.closePath(); g.fill(); g.stroke(); }
  return c;
}
function drawMap(cv, st){
  const w=cv.width, h=cv.height, g=cv.getContext("2d"), X=lon=>(lon+180)/360*w, Y=lat=>(90-lat)/180*h;
  if(!BASE || BASE.width!==w || BASE.height!==h) BASE=drawBase(w,h);
  g.drawImage(BASE,0,0);
  // night side: for each longitude, the terminator latitude; fill toward the dark pole
  const ss=A.subSolar(Date.now()), dec=ss.lat*Math.PI/180;
  g.fillStyle="rgba(0,0,8,.42)"; g.beginPath();
  const darkSouth = ss.lat>0; g.moveTo(0, darkSouth?h:0);
  for(let px=0; px<=w; px+=4){ const lon=px/w*360-180, H=(lon-ss.lon)*Math.PI/180;
    const lat=Math.atan(-Math.cos(H)/Math.tan(Math.abs(dec)<1e-3?1e-3:dec))*180/Math.PI; g.lineTo(px, Y(lat)); }
  g.lineTo(w, darkSouth?h:0); g.closePath(); g.fill();
  const acc=getComputedStyle(document.body).getPropertyValue("--accent").trim()||"#b388ff";
  // ground track: past (dim) and future (accent, dashed); break at the antimeridian
  const seg=(pts,style,dash)=>{ g.strokeStyle=style; g.lineWidth=Math.max(1.4,w/700); g.setLineDash(dash||[]); g.beginPath();
    pts.forEach((p,i)=>{ const x=X(p.lon), y=Y(p.lat); if(i && Math.abs(p.lon-pts[i-1].lon)>180) g.moveTo(x,y); else i?g.lineTo(x,y):g.moveTo(x,y); }); g.stroke(); g.setLineDash([]); };
  if(st.track){ seg(st.track.filter(p=>p.m<=0),"rgba(255,255,255,.28)"); seg(st.track.filter(p=>p.m>=0),acc,[6,5]); }
  // observer
  const L=st.L; g.fillStyle="#ffd23f"; g.beginPath(); g.arc(X(L.lon),Y(L.lat),Math.max(3,w/260),0,7); g.fill();
  if(st.p){
    // footprint: where the ISS is above your horizon (radius from altitude)
    const R=6371, ang=Math.acos(R/(R+st.p.alt)), la1=st.p.lat*Math.PI/180, lo1=st.p.lon*Math.PI/180;
    g.strokeStyle="rgba(255,255,255,.35)"; g.fillStyle="rgba(255,255,255,.05)"; g.lineWidth=1; g.beginPath();
    let prev=null;
    for(let b=0;b<=360;b+=6){ const br=b*Math.PI/180, la=Math.asin(Math.sin(la1)*Math.cos(ang)+Math.cos(la1)*Math.sin(ang)*Math.cos(br));
      const lo=lo1+Math.atan2(Math.sin(br)*Math.sin(ang)*Math.cos(la1),Math.cos(ang)-Math.sin(la1)*Math.sin(la));
      let d=((lo*180/Math.PI+540)%360)-180; const x=X(d), y=Y(la*180/Math.PI); if(prev!=null && Math.abs(d-prev)>180) g.moveTo(x,y); else b?g.lineTo(x,y):g.moveTo(x,y); prev=d; }
    g.stroke();
    const x=X(st.p.lon), y=Y(st.p.lat), r=Math.max(5,w/150);
    g.fillStyle=acc; g.shadowColor=acc; g.shadowBlur=LOW()?0:14; g.beginPath(); g.arc(x,y,r,0,7); g.fill(); g.shadowBlur=0;
    g.strokeStyle="#fff"; g.lineWidth=1.5; g.beginPath(); g.moveTo(x-r*2.2,y); g.lineTo(x+r*2.2,y); g.stroke();
  }
}
async function tabIss(el, my){
  const L=loc();
  el.innerHTML=`<div class="sp-grid2">
    <div class="sp-card sp-mapcard"><div class="sp-row"><span class="t-k">ISS live · ground track</span><span class="sp-stamp" id="issSrc"></span></div>
      <div class="sp-mapbox"><canvas id="issMap" aria-label="ISS ground track map"></canvas></div>
      <div class="sp-stats" id="issStats"><div><span>Latitude</span><b>—</b></div><div><span>Longitude</span><b>—</b></div><div><span>Altitude</span><b>—</b></div><div><span>Speed</span><b>—</b></div></div>
      <div class="sp-legend"><span><i style="background:var(--accent)"></i>station + next orbit</span><span><i style="background:#ffd23f"></i>you · ${E(L.name)}</span><span><i style="background:rgba(0,0,8,.8);border:1px solid #334"></i>night</span></div>
    </div>
    <div class="sp-card"><div class="sp-row"><span class="t-k">Passes over you</span><label class="sp-chk"><input type="checkbox" id="issVis" ${K.LS.get("turd_sp_visonly",true)?"checked":""}> visible only</label></div>
      <div id="issNext"></div><div id="issPasses">${loading("Predicting passes…")}</div>
      <p class="sp-note">A pass is <b>visible</b> when you're in darkness and the station is still in sunlight: a bright, steady star crossing the sky in a few minutes. Higher max elevation = better.</p></div>
  </div>
  <div class="sp-card"><div class="sp-row"><span class="t-k">People in space right now</span><span id="crewStamp"></span></div><div id="issCrew">${loading("Counting heads…")}</div>
    <div class="sp-acts"><button class="t-link" data-ext="https://www.youtube.com/results?search_query=ISS+live+earth+view">Live ISS camera ↗</button><button class="t-link" data-ext="https://spotthestation.nasa.gov/">NASA Spot the Station ↗</button></div></div>`;
  const cv=el.querySelector("#issMap"), st={ L, p:null, track:null };
  const size=()=>{ const w=Math.min(1400, cv.parentElement.clientWidth||600), dpr=LOW()?1:Math.min(2,devicePixelRatio||1); cv.width=Math.round(w*dpr); cv.height=Math.round(w*dpr/2); cv.style.height=(w/2)+"px"; };
  size(); const ro=new ResizeObserver(()=>{ size(); drawMap(cv,st); }); ro.observe(cv.parentElement);
  let tle=null, iv=0, tr=0, dead=false;
  const stats=()=>{ const p=st.p, b=[...el.querySelectorAll("#issStats b")]; if(!p||!b.length) return;
    b[0].textContent=`${Math.abs(p.lat).toFixed(2)}° ${p.lat>=0?"N":"S"}`; b[1].textContent=`${Math.abs(p.lon).toFixed(2)}° ${p.lon>=0?"E":"W"}`;
    b[2].textContent=imperial()?`${Math.round(p.alt*0.621371)} mi`:`${Math.round(p.alt)} km`; b[3].textContent=speed(p.speed); };
  const tick=async()=>{ if(dead||document.hidden||!tle) return; st.p=await O.issNow(tle); stats(); drawMap(cv,st); };
  const retrack=async()=>{ if(dead||!tle) return; st.track=await O.groundTrack(tle, Date.now(), 45, 95, LOW()?2:1); };
  drawMap(cv,st);
  tle=await O.getTle(K.http);
  if(my!==gen) return ()=>{};
  const src=el.querySelector("#issSrc");
  if(!tle){
    src.textContent="no orbit data yet";
    // one-shot live fix so the map isn't empty on first-ever offline-ish load
    try{ const j=await (await K.http("https://api.wheretheiss.at/v1/satellites/25544")).json(); st.p={ lat:j.latitude, lon:j.longitude, alt:j.altitude, speed:j.velocity/3600 }; stats(); drawMap(cv,st); }catch(e){}
    el.querySelector("#issPasses").innerHTML=fail("the orbit data mirrors");
    el.querySelector("[data-retry]").onclick=()=>showTab("iss");
  } else {
    const age=(Date.now()-tle.epoch)/86400e3;
    src.innerHTML=`on-device SGP4 · ${E(tle.src)} TLE ${age<1?"<1":age.toFixed(0)}d old${age>7?` <b class="sp-warn">stale</b>`:""}`;
    await retrack(); await tick();
    iv=setInterval(tick, LOW()?5000:1000); tr=setInterval(retrack, 60e3);
    const paintPasses=async()=>{
      const box=el.querySelector("#issPasses"), nx=el.querySelector("#issNext"); if(!box) return;
      const all=(await passCache(tle,L)).filter(p=>p.los>Date.now()), vo=el.querySelector("#issVis").checked, list=(vo?all.filter(p=>p.visible):all).slice(0,10);
      const nv=all.find(p=>p.visible);
      nx.innerHTML=nv?`<div class="sp-hero-pass"><span class="t-k">Next visible pass</span><b>${when(nv.aos)}</b><span>${Math.round(nv.maxEl)}° max · from ${nv.from} to ${nv.to} · ${Math.round(nv.dur/60)} min · <span data-cd="${nv.aos}">${tminus(nv.aos-Date.now())}</span></span></div>`:"";
      box.innerHTML=list.length?`<table class="sp-table"><thead><tr><th>When</th><th>Max</th><th>Path</th><th>Length</th><th></th></tr></thead><tbody>${list.map(p=>`<tr class="${p.visible?"vis":""}">
        <td>${E(when(p.aos))}</td><td>${Math.round(p.maxEl)}°</td><td>${p.from} → ${p.to}</td><td>${Math.round(p.dur/60)}m</td><td>${p.visible?`<span class="sp-star">★ visible</span>`:""}</td></tr>`).join("")}</tbody></table>`
        :`<p class="muted">${vo?"No visible passes in the next few days. The ISS is only visible around dawn/dusk in certain weeks. Untick \"visible only\" to see every pass.":"No passes found."}</p>`;
    };
    el.querySelector("#issVis").onchange=e=>{ K.LS.set("turd_sp_visonly",e.target.checked); paintPasses(); };
    paintPasses();
  }
  D.crew(K.http).then(r=>{ if(my!==gen) return; const box=el.querySelector("#issCrew"); el.querySelector("#crewStamp").innerHTML=stamp(r);
    const by={}; r.d.people.forEach(p=>{ const c=p.craft||"In orbit"; (by[c]=by[c]||[]).push(p); });
    box.innerHTML=`<div class="sp-crew-n"><b>${r.d.n}</b> humans off-planet${r.d.exp?` · ISS Expedition ${E(r.d.exp)}`:""}</div>`+
      Object.entries(by).map(([c,ps])=>`<div class="sp-crew-g"><span class="t-k">${E(c)}</span><div class="sp-crew">${ps.map(p=>`<span><b>${E(p.name)}</b><em>${E([p.role,p.agency].filter(Boolean).join(" · "))}${p.since?` · up ${dur(Date.now()-p.since)}`:""}</em></span>`).join("")}</div></div>`).join("");
  }).catch(()=>{ const b=el.querySelector("#issCrew"); if(b) b.innerHTML=fail("the crew roster",false); });
  const cd=setInterval(()=>{ if(!document.hidden) el.querySelectorAll("[data-cd]").forEach(s=>s.textContent=tminus(+s.dataset.cd-Date.now())); },1000);
  return ()=>{ dead=true; clearInterval(iv); clearInterval(tr); clearInterval(cd); ro.disconnect(); };
}

/* =========================================================== SKY */
function tabSky(el){
  const L=loc(), t=Date.now(), st=A.sunTimes(L.lat,L.lon,t), ph=A.moonPhase(t), mt=A.moonTimes(L.lat,L.lon,t), nxt=A.nextPhases(t), mp=A.moonPos(t,L.lat,L.lon);
  const pl=A.planetsTonight(L.lat,L.lon,t), sh=A.meteorShowers(t), night=A.nextNight(L.lat,L.lon,t);
  const kv=(k,v)=>`<div class="sp-kv"><span>${k}</span><b>${v}</b></div>`;
  el.innerHTML=`<div class="sp-loc">Sky over <b>${E(L.name)}</b> <span class="muted">· set the place in Weather</span></div>
  <div class="sp-grid3">
    <div class="sp-card"><span class="t-k">Sun</span>
      ${kv("Sunrise",fT(st.sunrise))}${kv("Sunset",fT(st.sunset))}${kv("Civil dusk",fT(st.dusk))}${kv("Truly dark",fT(st.astroDusk))}${kv("Dawn (astro)",fT(st.astroDawn))}${kv("Daylight",st.dayLen?dur(st.dayLen):"—")}</div>
    <div class="sp-card sp-mooncard"><span class="t-k">Moon</span>
      <div class="sp-moonrow">${moonSvg(ph,104)}<div><b class="sp-big">${Math.round(ph.illum*100)}%</b><div>${E(ph.name)}</div><div class="t-s">day ${ph.age.toFixed(1)} of 29.5 · ${dist(ph.km)}</div></div></div>
      ${kv("Moonrise",mt.rise?when(mt.rise):"—")}${kv("Moonset",mt.set?when(mt.set):"—")}${kv("Now",mp.alt>0?`${Math.round(mp.alt)}° up, ${A.compass(mp.az)}`:"below horizon")}
      ${nxt.slice(0,2).map(p=>kv(p.name, `${fD(p.t)} ${fT(p.t)}`)).join("")}</div>
    <div class="sp-card"><span class="t-k">Meteor showers</span>
      ${sh.map(s=>`<div class="sp-shower"><div><b>${E(s.name)}</b><span class="t-s">${E(s.note)}</span></div><div class="r"><b>${s.days<=0?"Tonight":s.days===1?"Tomorrow":fD(s.peak)}</b><span class="t-s">~${s.zhr}/hr · moon ${Math.round(s.moon*100)}%${s.moon>.6?" (washes out)":""}</span></div></div>`).join("")}</div>
  </div>
  <div class="sp-card"><div class="sp-row"><span class="t-k">Planets ${night&&night.now?"tonight (it's dark now)":"tonight"}</span><span class="t-s">${night?`dark ${fT(night.start)} – ${fT(night.end)}`:""}</span></div>
    <div class="sp-planets">${pl.map(p=>`<div class="sp-planet ${p.visible?"":"off"}"><i style="color:${p.col}">${p.glyph}</i><div><b>${p.name}</b>
      <span class="t-s">${p.visible?`up ${fT(p.up)} – ${fT(p.down)} · highest ${Math.round(p.best.alt)}° ${A.compass(p.best.az)} at ${fT(p.best.t)}`:"not visible tonight (too near the sun or below the horizon)"}</span>
      <span class="t-s dim">${p.visible?E(p.note):""}${p.now.alt>0?` · now ${Math.round(p.now.alt)}° ${A.compass(p.now.az)}`:""}</span></div></div>`).join("")}</div></div>`;
  const iv=setInterval(()=>{ if(!document.hidden && el.isConnected) tabSky(el); }, 10*60e3);
  return ()=>clearInterval(iv);
}

/* =========================================================== SUN / SPACE WEATHER */
async function tabSun(el, my){
  const L=loc();
  el.innerHTML=loading("Reading NOAA space weather…");
  let r; try{ r=await D.swx(K.http); }catch(e){ if(my!==gen) return; el.innerHTML=fail("NOAA's space weather center"); el.querySelector("[data-retry]").onclick=()=>showTab("sun"); return; }
  if(my!==gen) return;
  const d=r.d, last=d.kp[d.kp.length-1], kp=last?last.kp:null, o=A.auroraOdds(L.lat,L.lon,kp);
  const fc=d.fc.filter(x=>x.t>Date.now()-3*3600e3), fmax=fc.length?Math.max(...fc.map(x=>x.kp)):null, oF=A.auroraOdds(L.lat,L.lon,fmax);
  const sc=s=>{ if(!s) return ""; const one=(L2,x,name)=>{ const n=x&&x.Scale!=null?String(x.Scale).trim():"0"; return `<div class="sp-scale"><b style="color:${D.gColor(n)}">${L2}${n||"0"}</b><span>${name}</span><em>${E(x&&x.Text&&x.Text!=="none"?x.Text:"none")}</em></div>`; };
    return one("R",s.R,"Radio blackouts")+one("S",s.S,"Solar radiation")+one("G",s.G,"Geomagnetic storms"); };
  const bars=(rows,h=110)=>{ if(!rows.length) return `<p class="muted">No data.</p>`; const w=100/rows.length;
    return `<svg class="sp-kpbars" viewBox="0 0 100 ${h}" preserveAspectRatio="none">${[5,7].map(k=>`<line x1="0" x2="100" y1="${h-k/9*h}" y2="${h-k/9*h}" class="g"/>`).join("")}
      ${rows.map((x,i)=>`<rect x="${i*w+w*.12}" width="${w*.76}" y="${h-Math.max(.3,x.kp)/9*h}" height="${Math.max(.3,x.kp)/9*h}" fill="${D.kpColor(x.kp)}" opacity="${/pred/i.test(x.kind||"")?.75:1}"><title>${fD(x.t)} ${fT(x.t)} · Kp ${x.kp}</title></rect>`).join("")}</svg>`; };
  const dayTicks=rows=>{ const out=[]; rows.forEach((x,i)=>{ const dd=new Date(x.t); if(i===0||dd.getDate()!==new Date(rows[i-1].t).getDate()) out.push(`<span style="left:${i/rows.length*100}%">${dayName(x.t)}</span>`); }); return `<div class="sp-ticks">${out.join("")}</div>`; };
  el.innerHTML=`<div class="sp-grid2">
    <div class="sp-card sp-kpnow"><div class="sp-row"><span class="t-k">Geomagnetic activity · Kp now</span>${stamp(r)}</div>
      <div class="sp-kprow"><b class="sp-kp" style="color:${kp==null?"var(--ink)":D.kpColor(kp)}">${kp==null?"—":kp.toFixed(2).replace(/\.?0+$/,"")}</b>
        <div><div class="sp-kpg">${kp==null?"":D.kpG(kp)?`${D.kpG(kp)} storm`:kp>=4?"Active":"Quiet"}</div><div class="t-s">0 calm · 5 storm · 9 extreme</div></div></div>
      <div class="sp-aur lvl${o.level}"><b>Aurora from ${E(L.name)}: ${E(o.verdict)}</b>
        <span>You sit at ${o.gm.toFixed(0)}° geomagnetic latitude. Phone camera pointed north needs about <b>Kp ${o.needCamera.toFixed(0)}</b>, naked eye on the horizon about <b>Kp ${Math.ceil(o.needHorizon)}</b>.
        ${fmax!=null?` Forecast peak next 3 days: <b style="color:${D.kpColor(fmax)}">Kp ${fmax.toFixed(1)}</b>${oF.level?` · ${E(oF.verdict.toLowerCase())}`:""}.`:""}</span></div>
      <div class="sp-stats">
        <div><span>Solar wind</span><b>${d.wind?Math.round(d.wind)+" km/s":"—"}</b></div>
        <div><span>Bz</span><b style="color:${d.bz!=null&&d.bz<-5?"#ff9a1f":"inherit"}">${d.bz!=null?d.bz.toFixed(1)+" nT":"—"}</b></div>
        <div><span>Latest flare</span><b>${d.flare&&d.flare.cls?E(d.flare.cls):"—"}</b></div>
        <div><span>X-ray now</span><b>${d.flare&&d.flare.cur?E(d.flare.cur):"—"}</b></div></div>
      <p class="sp-note">Bz pointing south (negative) for hours is what opens the door for storms. Fast wind (600+ km/s) plus southward Bz = watch the sky.</p></div>
    <div class="sp-card sp-suncard"><span class="t-k">The Sun right now · NASA SDO</span>
      <div class="sp-sunimg">${pic("https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg","The Sun in extreme ultraviolet, NASA SDO","sp-sdo",true)}</div>
      <div class="sp-acts"><button class="t-link" data-ext="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast">Aurora forecast map ↗</button><button class="t-link" data-ext="https://www.swpc.noaa.gov/">NOAA SWPC ↗</button></div></div>
  </div>
  <div class="sp-card"><div class="sp-row"><span class="t-k">NOAA space weather scales</span><span class="t-s">today${d.scales.d1?" · tomorrow's odds below":""}</span></div>
    <div class="sp-scales">${sc(d.scales.now)}</div>
    ${d.scales.d1?`<div class="sp-odds">Tomorrow: minor radio blackout ${E(d.scales.d1.R?.MinorProb??"?")}% · major ${E(d.scales.d1.R?.MajorProb??"?")}% · radiation storm ${E(d.scales.d1.S?.Prob??"?")}% · geomagnetic ${E(d.scales.d1.G?.Scale??"0")==="0"?"none expected":"G"+E(d.scales.d1.G?.Scale)}</div>`:""}</div>
  <div class="sp-grid2">
    <div class="sp-card"><span class="t-k">Kp · last 3 days (observed)</span>${bars(d.kp)}${dayTicks(d.kp)}</div>
    <div class="sp-card"><span class="t-k">Kp · 3-day forecast</span>${bars(fc)}${dayTicks(fc)}</div>
  </div>`;
}

/* =========================================================== ASTEROIDS */
async function tabRocks(el, my){
  el.innerHTML=loading("Pulling close approaches from JPL…");
  let r; try{ r=await D.neo(K.http); }catch(e){ if(my!==gen) return; el.innerHTML=fail("JPL's asteroid database"); el.querySelector("[data-retry]").onclick=()=>showTab("rocks"); return; }
  if(my!==gen) return;
  const now=Date.now(), list=r.d.filter(a=>a.t>now-86400e3).sort((a,b)=>a.t-b.t), LD=a=>a.au*A.AU_KM/A.LD_KM;
  const close=[...list].sort((a,b)=>a.au-b.au)[0], week=list.filter(a=>a.t<now+7*86400e3);
  // log scale 0.1 LD … 20 LD
  const pos=ld=> Math.max(0,Math.min(100,(Math.log10(Math.max(.1,ld))+1)/(Math.log10(20)+1)*100));
  el.innerHTML=`<div class="sp-grid2">
    <div class="sp-card"><div class="sp-row"><span class="t-k">Closest flyby · next 60 days</span>${stamp(r)}</div>
      ${close?`<div class="sp-rock"><b class="sp-big">${LD(close).toFixed(2)} <small>LD</small></b><div><b>${E(close.name)}</b><div class="t-s">${E(when(close.t))} · ${dist(close.au*A.AU_KM)} · ${speed(close.v)}</div>
        <div class="t-s">${close.m?`~${Math.round(imperial()?close.m*3.281:close.m)} ${imperial()?"ft":"m"} across${close.est?" (estimated)":""} · ${sizeLike(close.m)}`:""}</div></div></div>`:`<p class="muted">Nothing passes inside 0.05 AU in the next 60 days.</p>`}
      <p class="sp-note">1 LD = the Moon's distance (${dist(A.LD_KM)}). ${list.length} known objects pass within ${(0.05*A.AU_KM/A.LD_KM).toFixed(0)} LD in the next 60 days, ${week.length} this week. None of these are on a collision course.</p></div>
    <div class="sp-card"><span class="t-k">How close · log scale</span>
      <div class="sp-scaleline"><i class="earth" style="left:0">●</i><i class="moon" style="left:${pos(1)}%">☾</i>
        ${list.slice(0,40).map(a=>`<i class="dot${a===close?" hot":""}" style="left:${pos(LD(a))}%;top:${10+((a.t/3.7e6)%1)*60}%" title="${E(a.name)} · ${LD(a).toFixed(1)} LD · ${E(fD(a.t))}"></i>`).join("")}
        <span style="left:0">Earth</span><span style="left:${pos(1)}%">Moon</span><span style="left:${pos(10)}%">10 LD</span></div></div>
  </div>
  <div class="sp-card"><span class="t-k">Upcoming close approaches</span>
    <table class="sp-table"><thead><tr><th>When</th><th>Object</th><th>Distance</th><th>Speed</th><th>Size</th></tr></thead><tbody>
    ${list.slice(0,30).map(a=>`<tr class="${LD(a)<1?"vis":""}"><td>${E(dayName(a.t))}</td><td>${E(a.name)}</td><td>${LD(a).toFixed(2)} LD</td><td>${a.v?a.v.toFixed(1)+" km/s":"—"}</td><td>${a.m?`${Math.round(imperial()?a.m*3.281:a.m)} ${imperial()?"ft":"m"}`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
}

/* =========================================================== MARS */
async function tabMars(el, my){
  const rover=K.LS.get("turd_sp_rover","perseverance");
  const head=`<div class="sp-row sp-roverbar"><div class="sp-sw">${D.roverList().map(r=>`<button class="t-link ${r.id===rover?"on":""}" data-rov="${r.id}">${r.label}</button>`).join("")}</div><span id="marsStamp"></span></div>`;
  const go=async(force)=>{
    el.innerHTML=head+loading("Downlinking from Mars…");
    el.querySelectorAll("[data-rov]").forEach(b=>b.onclick=()=>{ K.LS.set("turd_sp_rover",b.dataset.rov); tabMars(el,my); });
    if(LOW() && !force){ const box=document.createElement("div"); box.className="sp-fail"; box.innerHTML=`<b>Potato mode is on</b><span>Rover photos are skipped to keep things light.</span><button class="t-btn sm">Load photos</button>`;
      el.querySelector(".t-loading").replaceWith(box); box.querySelector("button").onclick=()=>go(true); return; }
    let r; try{ r=await D.mars(K.http, rover); }catch(e){ if(my!==gen) return; el.querySelector(".t-loading").outerHTML=fail("the rover image feed"); el.querySelector("[data-retry]").onclick=()=>go(true); return; }
    if(my!==gen) return;
    const ph=r.d, sol=ph.length?Math.max(...ph.map(p=>+p.sol||0)):null;
    el.querySelector("#marsStamp").innerHTML=stamp(r);
    el.querySelector(".t-loading").outerHTML=`<div class="sp-sub">${sol!=null?`Latest sol ${sol} · ${ph.length} raw frames`:"No frames"} · tap a photo for full size</div>
      <div class="sp-gallery">${ph.map((p,i)=>`<button class="sp-shot" data-i="${i}">${force&&LOW()?`<img src="${E(p.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:pic(p.src,p.cam,"")}<span>${E(p.cam)} · sol ${E(p.sol)}</span></button>`).join("")}</div>
      <div class="sp-lb" id="marsLb" hidden></div>`;
    const lb=el.querySelector("#marsLb");
    el.querySelectorAll(".sp-shot").forEach(b=>b.onclick=e=>{ if(e.target.closest(".sp-ph")) return; const p=ph[+b.dataset.i];
      lb.innerHTML=`<div class="sp-lb-in"><img src="${E(p.full)}" alt="${E(p.cam)}" decoding="async" referrerpolicy="no-referrer"><div class="sp-row"><span>${E(p.cam)} · sol ${E(p.sol)}${isFinite(p.t)?" · "+E(fD(p.t)):""}</span><button class="t-link" id="lbX">Close ✕</button></div></div>`;
      lb.hidden=false; lb.querySelector("#lbX").onclick=()=>{ lb.hidden=true; lb.innerHTML=""; }; lb.onclick=ev=>{ if(ev.target===lb){ lb.hidden=true; lb.innerHTML=""; } }; });
  };
  go(false);
}

/* =========================================================== LAUNCHES */
async function tabLaunch(el, my){
  el.innerHTML=loading("Checking the launch manifest…");
  let r; try{ r=await D.launches(K.http); }catch(e){ if(my!==gen) return; el.innerHTML=fail("the launch schedule"); el.querySelector("[data-retry]").onclick=()=>showTab("launch"); return ()=>{}; }
  if(my!==gen) return ()=>{};
  const list=r.d.filter(x=>x.t>Date.now()-2*3600e3), n=list[0];
  const stc=s=>/go/i.test(s)?"go":/tbd|tbc/i.test(s)?"tbd":/hold|fail/i.test(s)?"hold":"";
  el.innerHTML=(n?`<div class="sp-card sp-next">
      ${n.img?`<div class="sp-next-img">${pic(n.img,n.name,"",true)}</div>`:""}
      <div class="sp-next-txt"><div class="sp-row"><span class="t-k">Next launch</span>${stamp(r)}</div>
        <div class="sp-cd" data-cd="${n.t}">${tminus(n.t-Date.now())}</div>
        <h2>${E(n.mission||n.name)}</h2>
        <div class="sp-sub">${E(n.rocket)}${n.who?" · "+E(n.who):""}${n.orbit?" · "+E(n.orbit):""}</div>
        <div class="sp-sub">${E(when(n.t))}${n.prec&&!/sec|min/i.test(n.prec)?` (${E(n.prec)})`:""} · ${E(n.pad)}${n.where?", "+E(n.where):""}</div>
        ${n.status?`<div class="sp-st ${stc(n.status)}">${E(n.statusName||n.status)}</div>`:""}
        ${n.desc?`<p class="sp-clamp">${E(n.desc)}</p>`:""}
        <div class="sp-acts">${n.live?`<span class="sp-live">● LIVE</span>`:""}${n.link?`<button class="t-link" data-ext="${E(n.link)}">Details + webcast ↗</button>`:""}</div></div></div>`:`<p class="muted">No upcoming launches listed.</p>`)+
    `<div class="sp-card"><span class="t-k">Upcoming</span><div class="sp-launches">${list.slice(1,14).map(x=>`<div class="sp-launch">
        <div class="w"><b>${E(dayName(x.t))}</b><span>${E(fT(x.t))}</span></div>
        <div class="m"><b>${E(x.mission||x.name)}</b><span>${E(x.rocket)}${x.who?" · "+E(x.who):""} · ${E(x.where||x.pad)}</span></div>
        <div class="s"><span class="sp-st ${stc(x.status)}">${E(x.status||"")}</span><span class="sp-cdm" data-cd="${x.t}">${tminus(x.t-Date.now())}</span></div></div>`).join("")}</div></div>`;
  const iv=setInterval(()=>{ if(!document.hidden) el.querySelectorAll("[data-cd]").forEach(s=>s.textContent=tminus(+s.dataset.cd-Date.now())); },1000);
  return ()=>clearInterval(iv);
}

/* =========================================================== shell */
const RENDER={ today:tabToday, iss:tabIss, sky:tabSky, sun:tabSun, rocks:tabRocks, mars:tabMars, launch:tabLaunch };
function showTab(id){
  if(!panel || !RENDER[id]) return;
  try{ cleanup(); }catch(e){} cleanup=()=>{};
  curTab=id; K.LS.set("turd_sp_tab",id); const my=++gen;
  panel.querySelectorAll(".sp-tab").forEach(b=>{ const on=b.dataset.tab===id; b.classList.toggle("on",on); b.setAttribute("aria-selected",on); });
  body.innerHTML=""; const pane=document.createElement("div"); pane.className="sp-pane"; body.appendChild(pane);
  panel.scrollTop=0;
  let res; try{ res=RENDER[id](pane,my); }catch(e){ pane.innerHTML=fail("this panel ("+E(e.message)+")",false); }
  Promise.resolve(res).then(f=>{ if(typeof f==="function"){ if(my===gen) cleanup=f; else f(); } }).catch(e=>console.warn("[space]",e));
}

export default {
  id:"space", icon:"🚀", label:"Space",
  theme:{ accent:"#b388ff", accent2:"#4a2bd6", rgb:"179,136,255" },
  mount(el, ctx){
    K=kit(ctx); K.LS=ctx.LS||K.LS; panel=el;
    el.classList.add("t-full","t-sec-space"); stopFades(); stopFades=edgeFades(el);
    el.innerHTML=`<div class="sp-tabs" role="tablist" aria-label="Space">${TABS.map(t=>`<button class="sp-tab" data-tab="${t.id}" role="tab"><span class="i">${t.icon}</span>${t.label}</button>`).join("")}</div><div class="sp-body" id="spBody"></div>`;
    body=el.querySelector("#spBody"); wireMedia(body);
    body.addEventListener("click",e=>{ const r=e.target.closest("[data-retry]"); if(r && !r.onclick) showTab(curTab); });
    el.querySelectorAll(".sp-tab").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
    const saved=K.LS.get("turd_sp_tab","today");
    showTab(RENDER[saved]?saved:"today");
  },
  unmount(){ try{ cleanup(); }catch(e){} cleanup=()=>{}; gen++; stopFades(); stopFades=()=>{}; panel=null; body=null; },
  summary(ctx){
    const L=loc(), ph=A.moonPhase(), sw=D.peek("swx"), kp=sw&&sw.d&&sw.d.kp&&sw.d.kp.length?sw.d.kp[sw.d.kp.length-1].kp:null;
    const pc=(ctx&&ctx.LS||K&&K.LS)?.get?.(PK,null), nv=pc&&pc.p?pc.p.find(p=>p.visible&&p.aos>Date.now()):null;
    return { title:"Space", value: nv?fT(nv.aos):kp!=null?"Kp "+kp.toFixed(0):Math.round(ph.illum*100)+"%",
      note: nv?`ISS visible ${dayName(nv.aos).toLowerCase()} · ${Math.round(nv.maxEl)}°`:kp!=null?A.auroraOdds(L.lat,L.lon,kp).verdict:ph.name };
  },
};

/* ------------------------------------------------------------ Home card: one quiet line */
registerCard({ id:"space", label:"Space", icon:"🚀", kind:"strip", order:45,
  mount(b, ctx){
    let dead=false;
    const paint=async()=>{
      if(dead) return; const L=loc(), ph=A.moonPhase(), items=[];
      const tle=O.cachedTle(); const pc=(ctx.LS||D).get?ctx.LS.get(PK,null):null;
      const nv=pc&&pc.p?pc.p.find(p=>p.visible&&p.los>Date.now()):null;
      if(nv) items.push(`<span><em>ISS</em><b>${E2(when(nv.aos))}</b><i>${Math.round(nv.maxEl)}° ${nv.at}</i></span>`);
      else if(tle) items.push(`<span><em>ISS</em><b>tracking</b><i>no visible pass soon</i></span>`);
      items.push(`<span><em>Moon</em><b>${Math.round(ph.illum*100)}%</b><i>${ph.name}</i></span>`);
      const sw=D.peek("swx"), kp=sw&&sw.d&&sw.d.kp&&sw.d.kp.length?sw.d.kp[sw.d.kp.length-1].kp:null;
      if(kp!=null) items.push(`<span><em>Kp</em><b style="color:${D.kpColor(kp)}">${kp.toFixed(1)}</b><i>${A.auroraOdds(L.lat,L.lon,kp).level?"aurora possible":"aurora unlikely"}</i></span>`);
      const ln=D.peek("launch"), n=ln&&ln.d?ln.d.find(x=>x.t>Date.now()):null;
      if(n) items.push(`<span><em>Launch</em><b>${E2(dayName(n.t))}</b><i>${E2(n.rocket||n.name)}</i></span>`);
      b.innerHTML=`<div class="sp-strip" role="button" tabindex="0"><span class="k">🚀 Space</span>${items.join("")}<span class="go">Open ▸</span></div>`;
      const s=b.firstElementChild; s.onclick=()=>ctx.show&&ctx.show("space"); s.onkeydown=e=>{ if(e.key==="Enter") s.onclick(); };
    };
    const E2=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    paint();
    // warm the caches quietly (cheap; all TTL-gated) so the strip has something to say
    const http=ctx.http||((u,o)=>fetch(u,o));
    Promise.allSettled([D.swx(http), D.launches(http), O.getTle(http).then(async t=>{ if(t){ const L=loc(); const key=t.l1+"|"+L.lat.toFixed(2)+","+L.lon.toFixed(2), c=ctx.LS.get(PK,null);
      if(!(c&&c.key===key&&Date.now()-c.t<6*3600e3)){ const p=await O.passes(t,L,{days:3,step:40}); ctx.LS.set(PK,{key,t:Date.now(),p}); } } })]).then(()=>{ if(!dead) paint(); });
    const iv=setInterval(paint, 5*60e3);
    return { refresh:paint, destroy(){ dead=true; clearInterval(iv); } };
  } });

/* ------------------------------------------------------------ styles (own block; nothing shared is edited) */
(function(){
  if(typeof document==="undefined" || document.getElementById("space-css")) return;
  const s=document.createElement("style"); s.id="space-css"; s.textContent=`
  .sp-tabs{display:flex;gap:2px 20px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:0 10px;margin-bottom:2px;
    -webkit-mask-image:linear-gradient(90deg,#000 94%,transparent);mask-image:linear-gradient(90deg,#000 94%,transparent)}
  .sp-tabs::-webkit-scrollbar{display:none}
  .sp-tab{position:relative;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-family:var(--font);font-size:14px;letter-spacing:.5px;color:var(--ink-dim);cursor:pointer;background:none;border:0;padding:12px 4px;transition:color .18s}
  .sp-tab .i{font-size:15px;line-height:1;opacity:.7}
  .sp-tab:hover,.sp-tab.on{color:var(--ink)}
  .sp-tab.on .i{opacity:1}
  .sp-tab.on::after{content:"";position:absolute;left:4px;right:4px;bottom:4px;height:2px;border-radius:2px;background:var(--accent);box-shadow:0 0 10px var(--accent)}
  .sp-body{padding-top:12px}
  .sp-pane{display:flex;flex-direction:column;gap:16px;padding-inline:10px}
  .sp-card{position:relative;border-radius:var(--r-md,18px);padding:16px 18px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.012) 45%,rgba(var(--accent-rgb),.05));border:1px solid rgba(255,255,255,.08);min-width:0}
  .sp-grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}
  .sp-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .sp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .sp-stamp{font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--ink-dim)}
  .sp-stamp.stale{color:#ffb54d}
  .sp-warn{color:#ffb54d}
  .sp-sub{color:var(--ink-dim);font-size:13px;margin:2px 0}
  .sp-note{font-size:12px;color:var(--ink-dim);line-height:1.5;margin-top:10px}
  .sp-acts{display:flex;flex-wrap:wrap;gap:4px 6px;margin-top:10px;margin-left:-8px;align-items:center}
  .sp-big{font-size:40px;font-weight:600;line-height:1;color:#fff}
  .sp-big small{font-size:15px;color:var(--ink-dim);font-weight:400}
  .sp-kv{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
  .sp-kv:last-child{border-bottom:0}.sp-kv span{color:var(--ink-dim)}.sp-kv b{color:#fff;font-weight:600;text-align:right}
  .sp-clamp{font-size:14px;line-height:1.55;color:var(--ink);opacity:.9;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px}
  .sp-clamp.open{-webkit-line-clamp:unset;display:block}
  .sp-fail{display:flex;flex-direction:column;gap:8px;align-items:flex-start;padding:18px;border:1px dashed rgba(255,255,255,.14);border-radius:14px}
  .sp-fail b{color:var(--ink)}.sp-fail span{color:var(--ink-dim);font-size:13px}
  .sp-ph{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:140px;border:1px dashed rgba(255,255,255,.18);border-radius:12px;background:rgba(0,0,0,.25);color:var(--ink-dim);font-family:var(--mono);font-size:11px;letter-spacing:1px;cursor:pointer}
  .sp-noimg{display:grid;place-items:center;min-height:120px;border-radius:12px;background:rgba(0,0,0,.3);color:var(--ink-dim);font-family:var(--mono);font-size:11px}
  /* today */
  .sp-apod{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;align-items:start}
  .sp-apod-media img,.sp-apod-media .sp-ph,.sp-apod-media .sp-noimg{width:100%;max-height:min(58vh,560px);object-fit:cover;border-radius:16px;display:block;border:1px solid rgba(255,255,255,.08)}
  .sp-apod-vid{position:relative;display:block;width:100%;border:0;padding:0;background:#000;border-radius:16px;overflow:hidden;cursor:pointer;min-height:160px}
  .sp-apod-vid span{position:absolute;inset:auto 0 0 0;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font-family:var(--mono);font-size:12px;letter-spacing:1px}
  .sp-apod-txt h2{font-size:24px;line-height:1.2;margin:4px 0;color:#fff}
  .sp-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .sp-tile{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;cursor:pointer;color:inherit;font-family:var(--font);border-radius:14px;padding:13px 15px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);transition:border-color .2s,background .2s;min-width:0}
  .sp-tile:hover,.sp-tile:focus-visible{border-color:rgba(var(--accent-rgb),.55);background:rgba(var(--accent-rgb),.07);outline:none}
  .sp-tile b{font-size:22px;font-weight:600;color:#fff;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .sp-tile .t-s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .sp-tile .t-k{color:var(--accent)}
  .sp-tile-moon{flex-direction:row;align-items:center;gap:12px}.sp-tile-moon>span{display:flex;flex-direction:column;gap:3px;min-width:0}
  /* iss */
  .sp-mapbox{position:relative;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:#060b16}
  .sp-mapbox canvas{display:block;width:100%}
  .sp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}
  .sp-stats>div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .sp-stats span{font-family:var(--mono);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-dim)}
  .sp-stats b{font-size:17px;color:#fff;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
  .sp-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--ink-dim)}
  .sp-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .sp-chk{font-size:12px;color:var(--ink-dim);display:inline-flex;gap:6px;align-items:center;cursor:pointer}
  .sp-chk input{accent-color:var(--accent)}
  .sp-hero-pass{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:12px;background:rgba(var(--accent-rgb),.09);border:1px solid rgba(var(--accent-rgb),.35);margin-bottom:10px}
  .sp-hero-pass b{font-size:20px;color:#fff}.sp-hero-pass>span{font-size:13px;color:var(--ink-dim)}
  .sp-table{width:100%;border-collapse:collapse;font-size:13.5px}
  .sp-table th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim);padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:400}
  .sp-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,.05);font-variant-numeric:tabular-nums}
  .sp-table tr.vis td{color:#fff}
  .sp-star{color:#ffd23f;font-family:var(--mono);font-size:11px;white-space:nowrap}
  .sp-crew-n{font-size:15px;color:var(--ink-dim);margin-bottom:10px}.sp-crew-n b{font-size:30px;color:#fff;margin-right:6px}
  .sp-crew-g{margin-top:10px}
  .sp-crew{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 18px;margin-top:6px}
  .sp-crew span{display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .sp-crew b{color:#fff;font-weight:600}.sp-crew em{font-style:normal;font-size:12px;color:var(--ink-dim)}
  /* sky */
  .sp-loc{font-size:13px;color:var(--ink-dim)}.sp-loc b{color:var(--ink)}
  .sp-moonrow{display:flex;align-items:center;gap:16px;margin:8px 0 10px}
  .sp-moon{flex:0 0 auto;filter:drop-shadow(0 0 14px rgba(233,236,245,.25))}
  .sp-shower{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  .sp-shower:last-child{border-bottom:0}
  .sp-shower>div{display:flex;flex-direction:column;min-width:0}.sp-shower .r{text-align:right;align-items:flex-end}
  .sp-shower b{color:#fff;font-weight:600;font-size:14px}
  .sp-planets{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px 22px}
  .sp-planet{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .sp-planet i{font-style:normal;font-size:26px;width:30px;text-align:center;line-height:1.1}
  .sp-planet>div{display:flex;flex-direction:column;gap:2px}.sp-planet b{color:#fff;font-size:15px}
  .sp-planet.off{opacity:.45}.sp-planet .dim{opacity:.75}
  /* sun */
  .sp-kprow{display:flex;align-items:center;gap:18px;margin:4px 0 12px}
  .sp-kp{font-size:68px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
  .sp-kpg{font-size:18px;color:#fff;font-weight:600}
  .sp-aur{padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:4px}
  .sp-aur b{color:#fff}.sp-aur span{font-size:13px;color:var(--ink-dim);line-height:1.5}
  .sp-aur.lvl1{border-color:rgba(198,233,74,.5)}.sp-aur.lvl2{border-color:rgba(255,154,31,.6);background:rgba(255,154,31,.07)}.sp-aur.lvl3{border-color:rgba(61,220,132,.7);background:rgba(61,220,132,.08)}
  .sp-sunimg img,.sp-sunimg .sp-ph,.sp-sunimg .sp-noimg{width:100%;max-width:420px;aspect-ratio:1;object-fit:cover;border-radius:50%;display:block;margin:8px auto;box-shadow:0 0 60px rgba(255,170,60,.18)}
  .sp-sunimg .sp-ph,.sp-sunimg .sp-noimg{border-radius:16px;aspect-ratio:auto}
  .sp-scales{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .sp-scale{display:flex;flex-direction:column;gap:2px}.sp-scale b{font-size:30px;line-height:1}.sp-scale span{color:#fff;font-size:13px}.sp-scale em{font-style:normal;font-size:12px;color:var(--ink-dim);text-transform:capitalize}
  .sp-odds{margin-top:12px;font-size:12.5px;color:var(--ink-dim)}
  .sp-kpbars{width:100%;height:110px;display:block;margin-top:8px}
  .sp-kpbars .g{stroke:rgba(255,255,255,.12);stroke-width:.3;stroke-dasharray:1 1;vector-effect:non-scaling-stroke}
  .sp-ticks{position:relative;height:16px;font-family:var(--mono);font-size:10px;color:var(--ink-dim)}
  .sp-ticks span{position:absolute;top:2px;white-space:nowrap}
  /* asteroids */
  .sp-rock{display:flex;gap:18px;align-items:center;margin:6px 0}
  .sp-rock b{color:#fff}
  .sp-scaleline{position:relative;height:150px;margin:14px 6px 6px;border-bottom:1px solid rgba(255,255,255,.15)}
  .sp-scaleline i{position:absolute;font-style:normal;transform:translate(-50%,-50%)}
  .sp-scaleline .earth{top:50%;color:#4da3ff;font-size:22px;transform:translate(0,-50%)}
  .sp-scaleline .moon{top:50%;color:#e9ecf5;font-size:16px}
  .sp-scaleline .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);opacity:.8}
  .sp-scaleline .dot.hot{background:#ffd23f;width:10px;height:10px;box-shadow:0 0 10px #ffd23f}
  .sp-scaleline span{position:absolute;bottom:-18px;font-family:var(--mono);font-size:10px;color:var(--ink-dim);transform:translateX(-10%);white-space:nowrap}
  /* mars */
  .sp-roverbar .sp-sw{display:flex;gap:4px;margin-left:-8px}
  .sp-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-top:8px}
  .sp-shot{position:relative;border:0;padding:0;background:#0b0f18;border-radius:12px;overflow:hidden;cursor:pointer;aspect-ratio:4/3}
  .sp-shot img,.sp-shot .sp-ph,.sp-shot .sp-noimg{width:100%;height:100%;object-fit:cover;display:block;min-height:0;border-radius:0}
  .sp-shot>span{position:absolute;inset:auto 0 0 0;padding:6px 8px;font-family:var(--mono);font-size:10px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.85));text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp-lb{position:fixed;inset:0;z-index:40;background:rgba(2,4,9,.88);display:grid;place-items:center;padding:20px}
  .sp-lb[hidden]{display:none}
  .sp-lb-in{max-width:min(1200px,96vw);display:flex;flex-direction:column;gap:8px}
  .sp-lb-in img{max-width:100%;max-height:80vh;border-radius:12px;object-fit:contain;background:#000}
  .sp-lb-in .sp-row{color:var(--ink-dim);font-size:13px}
  /* launches */
  .sp-next{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.4fr);gap:20px;align-items:start}
  .sp-next:not(:has(.sp-next-img)){grid-template-columns:1fr}
  .sp-next-img img,.sp-next-img .sp-ph,.sp-next-img .sp-noimg{width:100%;max-height:360px;object-fit:cover;border-radius:14px;display:block}
  .sp-next h2{font-size:24px;color:#fff;margin:6px 0 2px;line-height:1.2}
  .sp-cd{font-family:var(--mono);font-size:clamp(30px,4.4vw,52px);color:#fff;letter-spacing:1px;font-variant-numeric:tabular-nums;text-shadow:0 0 24px rgba(var(--accent-rgb),.45)}
  .sp-st{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim);margin-top:6px}
  .sp-st.go{color:#3ddc84}.sp-st.tbd{color:#ffd23f}.sp-st.hold{color:#ff6b6b}
  .sp-live{font-family:var(--mono);font-size:12px;color:#ff4d5e;margin-left:8px}
  .sp-launches{display:flex;flex-direction:column}
  .sp-launch{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:14px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  .sp-launch:last-child{border-bottom:0}
  .sp-launch>div{display:flex;flex-direction:column;min-width:0}
  .sp-launch b{color:#fff;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp-launch span{font-size:12.5px;color:var(--ink-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp-launch .s{align-items:flex-end;text-align:right}
  .sp-cdm{font-family:var(--mono);font-variant-numeric:tabular-nums}
  /* home strip */
  .sp-strip{display:flex;align-items:center;gap:8px 26px;flex-wrap:wrap;padding:12px 18px;border-radius:16px;cursor:pointer;background:rgba(179,136,255,.06);border:1px solid rgba(179,136,255,.22)}
  .sp-strip:hover,.sp-strip:focus-visible{border-color:rgba(179,136,255,.6);outline:none}
  .sp-strip .k{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#b388ff}
  .sp-strip>span:not(.k):not(.go){display:flex;align-items:baseline;gap:7px;white-space:nowrap}
  .sp-strip em{font-style:normal;font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-dim)}
  .sp-strip b{color:#fff;font-weight:600}.sp-strip i{font-style:normal;font-size:12px;color:var(--ink-dim)}
  .sp-strip .go{margin-left:auto;font-family:var(--mono);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#b388ff}
  @media(max-width:1100px){.sp-grid3{grid-template-columns:1fr 1fr}.sp-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:900px){.sp-grid2,.sp-apod,.sp-next{grid-template-columns:1fr}}
  @media(max-width:700px){.sp-grid3{grid-template-columns:1fr}.sp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.sp-pane{padding-inline:2px}
    .sp-launch{grid-template-columns:76px minmax(0,1fr)}.sp-launch .s{grid-column:2;align-items:flex-start;text-align:left;flex-direction:row;gap:10px}
    .sp-scales{grid-template-columns:1fr}.sp-kp{font-size:54px}.sp-apod-txt h2,.sp-next h2{font-size:20px}
    .sp-table th:nth-child(4),.sp-table td:nth-child(4){display:none}.sp-strip .go{display:none}}
  /* potato: flat, no glow, no motion */
  body.q-low .sp-card{background:rgba(255,255,255,.035)}
  body.q-low .sp-tab.on::after,body.q-low .sp-cd{box-shadow:none;text-shadow:none}
  body.q-low .sp-moon,body.q-low .sp-sunimg img{filter:none;box-shadow:none}
  body.q-low .sp-pane *{transition:none!important;animation:none!important}`;
  document.head.appendChild(s);
})();
