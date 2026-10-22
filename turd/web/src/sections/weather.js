// ===========================================================================
// WEATHER — full-screen sky window, 24h curve, 7-day range bars, detail
// gauges, NWS alerts, air quality, live radar. Auto-refreshes every 10 min.
// ===========================================================================
import { edgeFades, kit, $, $$, head, tilt, countUp, ago } from "./util.js";
import { wxIcon } from "./icons.js";
import { sky } from "./sky.js";
import * as WX from "./wxdata.js";

let K, panel, stopSky=()=>{}, stopTilt=()=>{}, timer=0, last=null;

const dirName = d=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d/22.5)%16];
const uvLevel = u=> u<3?["Low","#3ddc4a"]:u<6?["Moderate","#ffd23f"]:u<8?["High","#ff9a1f"]:u<11?["Very high","#ff4d4d"]:["Extreme","#c86bff"];
const aqiLevel = a=> a<=50?["Good","#3ddc4a"]:a<=100?["Moderate","#ffd23f"]:a<=150?["Unhealthy (sensitive)","#ff9a1f"]:a<=200?["Unhealthy","#ff4d4d"]:a<=300?["Very unhealthy","#c86bff"]:["Hazardous","#9b1c3c"];
const hhmm = t=> new Date(t).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});

/* ------------------------------------------------------------ hourly curve */
function hourly(d, U){
  const now=Date.now(), pts=[];
  for(let i=0;i<d.hourly.time.length && pts.length<24;i++){
    const t=d.hourly.time[i]*1000; if(t<now-3600e3) continue;
    pts.push({t, v:d.hourly.temperature_2m[i], p:d.hourly.precipitation_probability[i]||0, c:d.hourly.weather_code[i], day:d.hourly.is_day[i]});
  }
  if(pts.length<2) return "";
  const Wd=960, H=290, top=60, bot=226, min=Math.min(...pts.map(p=>p.v)), max=Math.max(...pts.map(p=>p.v)), span=Math.max(1,max-min);
  const X=i=>20+i*(Wd-40)/(pts.length-1), Y=v=>bot-(v-min)/span*(bot-top);
  // Catmull-Rom → bezier for a smooth line
  let path=`M${X(0)},${Y(pts[0].v)}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(0,i-1)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(pts.length-1,i+2)];
    const c1x=X(i)+(X(i+1)-X(Math.max(0,i-1)))/6, c1y=Y(p1.v)+(Y(p2.v)-Y(p0.v))/6;
    const c2x=X(i+1)-(X(Math.min(pts.length-1,i+2))-X(i))/6, c2y=Y(p2.v)-(Y(p3.v)-Y(p1.v))/6;
    path+=` C${c1x},${c1y} ${c2x},${c2y} ${X(i+1)},${Y(p2.v)}`;
  }
  const area=path+` L${X(pts.length-1)},${bot+8} L${X(0)},${bot+8} Z`;
  const labels=pts.map((p,i)=> i%3? "" : `
    <text x="${X(i)}" y="${Y(p.v)-14}" class="wx-cv">${Math.round(p.v)}°</text>
    <g transform="translate(${X(i)-11} ${bot+14})">${wxIcon(WX.wmo(p.c)[1], !!p.day, 22).replace("<svg ","<svg x='0' y='0' ")}</g>
    <text x="${X(i)}" y="${H-4}" class="wx-ct">${i===0?"Now":WX.fmtHour(p.t)}</text>`).join("");
  const bars=pts.map((p,i)=> p.p<5? "" : `<rect x="${X(i)-5}" y="${bot+8-p.p*.32}" width="10" height="${p.p*.32}" rx="3" class="wx-pb"><title>${p.p}% precip</title></rect>`).join("");
  return `<svg class="wx-curve" viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="wxA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${bars}<path d="${area}" fill="url(#wxA)"/><path d="${path}" class="wx-line"/>
    <circle cx="${X(0)}" cy="${Y(pts[0].v)}" r="6" class="wx-now-dot"/>${labels}</svg>
    <div class="t-legend"><span><i class="sw line"></i>temperature ${U}</span><span><i class="sw bar"></i>chance of precipitation</span></div>`;
}

/* ------------------------------------------------------------ 7-day range bars */
function daily(d, U){
  const n=d.daily.time.length, lo=Math.min(...d.daily.temperature_2m_min), hi=Math.max(...d.daily.temperature_2m_max), span=Math.max(1,hi-lo);
  let rows="";
  for(let i=0;i<n;i++){
    const mn=d.daily.temperature_2m_min[i], mx=d.daily.temperature_2m_max[i], [label,kind]=WX.wmo(d.daily.weather_code[i]);
    const name=i===0?"Today":new Date(d.daily.time[i]*1000).toLocaleDateString([], {weekday:"short"});
    const pp=d.daily.precipitation_probability_max[i]||0;
    rows+=`<div class="wx-day" title="${label}">
      <span class="d">${name}</span>${wxIcon(kind,true,30)}
      <span class="pp ${pp>=40?"on":""}">${pp>=20?pp+"%":""}</span>
      <span class="lo">${Math.round(mn)}°</span>
      <span class="rng"><i style="left:${(mn-lo)/span*100}%;right:${100-(mx-lo)/span*100}%"></i>${i===0?`<b style="left:${(d.current.temperature_2m-lo)/span*100}%"></b>`:""}</span>
      <span class="hi">${Math.round(mx)}°</span></div>`;
  }
  return rows;
}

/* ------------------------------------------------------------ gauges */
function gauges(w){
  const d=w.data, c=d.current, imp=w.units==="F";
  const [uvT,uvC]=uvLevel(c.uv_index ?? d.daily.uv_index_max[0]);
  const uv=c.uv_index ?? d.daily.uv_index_max[0];
  const rise=d.daily.sunrise[0]*1000, set=d.daily.sunset[0]*1000, now=Date.now();
  const sunK=Math.min(1,Math.max(0,(now-rise)/(set-rise)));
  const sx=10+sunK*180, sy=96-Math.sin(sunK*Math.PI)*80;
  const vis = c.visibility!=null ? (imp? (c.visibility/1609.34).toFixed(c.visibility>16000?0:1)+" mi" : (c.visibility/1000).toFixed(1)+" km") : "—";
  const press = imp ? (c.pressure_msl*0.02953).toFixed(2)+" inHg" : Math.round(c.pressure_msl)+" hPa";
  const aqi=w.aqi?.us_aqi; const [aqT,aqC]=aqi!=null?aqiLevel(aqi):["No data","var(--ink-dim)"];
  const tile=(k,v,sub,extra="",cls="")=>`<div class="t-tile t-tilt ${cls}"><div class="t-k">${k}</div><div class="t-v">${v}</div><div class="t-s">${sub}</div>${extra}</div>`;
  return [
    tile("Feels like", Math.round(c.apparent_temperature)+"°", Math.abs(c.apparent_temperature-c.temperature_2m)<2?"Same as actual":c.apparent_temperature<c.temperature_2m?"Wind is cooling it down":"Humidity makes it feel warmer"),
    tile("Humidity", c.relative_humidity_2m+"%", `Dew point ${Math.round(c.dew_point_2m)}°`, `<div class="t-meter"><i style="width:${c.relative_humidity_2m}%"></i></div>`),
    tile("Wind", `${Math.round(c.wind_speed_10m)} <small>${imp?"mph":"km/h"}</small>`, `${dirName(c.wind_direction_10m)} · gusts ${Math.round(c.wind_gusts_10m)}`,
      `<svg class="wx-compass" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34"/><text x="40" y="14">N</text>
       <g style="transform:rotate(${c.wind_direction_10m+180}deg);transform-origin:40px 40px"><path d="M40 12 L47 44 L40 38 L33 44 Z"/></g></svg>`),
    tile("UV index", Math.round(uv??0), uvT, `<div class="t-meter uv"><i style="width:${Math.min(100,(uv||0)/11*100)}%;background:${uvC}"></i></div>`),
    tile("Air quality", aqi!=null?aqi:"—", aqT+(w.aqi?.pm2_5!=null?` · PM2.5 ${Math.round(w.aqi.pm2_5)}`:""), `<div class="t-meter"><i style="width:${Math.min(100,(aqi||0)/3)}%;background:${aqC}"></i></div>`),
    tile("Pressure", press, c.pressure_msl>1018?"High, settled":c.pressure_msl<1008?"Low, unsettled":"Normal"),
    tile("Visibility", vis, c.cloud_cover+"% cloud cover"),
    tile("Sun", hhmm(now<rise?rise:set), now<rise?"Sunrise":now<set?"Sunset":"Sun has set",
      `<svg class="wx-sunarc" viewBox="0 0 200 104"><path d="M10 96 Q100 -64 190 96" class="arc"/><line x1="0" y1="96" x2="200" y2="96" class="hz"/>
       ${now>rise&&now<set?`<circle cx="${sx}" cy="${sy}" r="7" class="sun"/>`:""}</svg><div class="t-s">${hhmm(rise)} → ${hhmm(set)}</div>`),
  ].join("");
}

function alertsHtml(alerts){
  if(!alerts.length) return `<div class="wx-ok">No active weather alerts for this spot.</div>`;
  return alerts.map((a,i)=>`<details class="wx-alert sev-${(a.severity||"").toLowerCase()}" ${i===0?"open":""}>
    <summary><b>${K.esc(a.event)}</b><span>${a.ends?"until "+new Date(a.ends).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"}):""}</span></summary>
    <p>${K.esc(a.headline||"")}</p><p class="muted">${K.esc(a.desc)}</p>${a.instruction?`<p class="ins">${K.esc(a.instruction)}</p>`:""}</details>`).join("");
}

/* ------------------------------------------------------------ render */
function render(w){
  last=w;
  const d=w.data, c=d.current, [label,kind]=WX.wmo(c.weather_code), U=w.units==="F"?"°F":"°C";
  const isDay=!!c.is_day;
  K.setLoc(w.loc.name);
  panel.innerHTML = head("Weather","WX",`<span class="wx-tools">
      <button class="t-link" id="wxLoc" title="Change location">${w.loc.mode==="gps"?"◉ ":""}${K.esc(w.loc.name)} ▾</button>
      <button class="t-link ${w.units==="F"?"on":""}" data-u="F">°F</button><button class="t-link ${w.units==="C"?"on":""}" data-u="C">°C</button>
      <button class="t-link" id="wxRef" title="Refresh">⟳</button></span>`) + `
    <div class="wx-hero t-curve">
      <canvas class="wx-sky"></canvas>
      <div class="wx-hero-in">
        <div class="wx-now-ico">${wxIcon(kind,isDay,120)}</div>
        <div class="wx-now-txt">
          <div class="wx-temp"><span id="wxT">0</span><sup>${U}</sup></div>
          <div class="wx-label">${label}</div>
          <div class="wx-hl">H ${Math.round(d.daily.temperature_2m_max[0])}° &nbsp; L ${Math.round(d.daily.temperature_2m_min[0])}° &nbsp;·&nbsp; feels ${Math.round(c.apparent_temperature)}°</div>
        </div>
        <div class="wx-alerts">${alertsHtml(w.alerts||[])}</div>
      </div>
      <div class="wx-stamp">${w.stale?"⚠ offline · showing data from ":"updated "}${ago(w.t)}</div>
    </div>
    <div class="t-row wx-mid">
      <div class="t-card t-l"><div class="t-cap">Next 24 hours</div>${hourly(d,U)}</div>
      <div class="t-card t-r"><div class="t-cap">7-day outlook</div><div class="wx-days">${daily(d,U)}</div></div>
    </div>
    <div class="t-tiles">${gauges(w)}</div>
    <div class="t-card wx-radar"><div class="t-cap">Live radar <button class="t-link" id="wxRadar">load radar ▸</button></div><div class="wx-radar-box" id="wxRadarBox"></div></div>
    <div id="wxPop" class="t-pop" hidden></div>`;

  countUp($("#wxT",panel), Math.round(c.temperature_2m), {dur:1100});
  stopSky(); stopSky = sky($(".wx-sky",panel), {kind, isDay, wind:c.wind_speed_10m});
  stopTilt(); stopTilt = tilt(panel);
  wire();
}

function wire(){
  $$("[data-u]",panel).forEach(b=>b.onclick=()=>{ WX.setUnits(b.dataset.u); refresh(true); });
  $("#wxRef",panel).onclick=()=>refresh(true);
  $("#wxLoc",panel).onclick=e=>{ e.stopPropagation(); openPicker(); };
  $("#wxRadar",panel).onclick=()=>{
    const L=last.loc;
    $("#wxRadarBox",panel).innerHTML=`<iframe loading="lazy" title="Live weather radar" referrerpolicy="no-referrer"
      src="https://www.rainviewer.com/map.html?loc=${L.lat},${L.lon},7&oFa=0&oC=1&oU=0&oCS=1&oF=0&oAP=1&c=3&o=83&lm=1&layer=radar&sm=1&sn=1"></iframe>`;
    $("#wxRadar",panel).remove();
  };
}

function openPicker(){
  const pop=$("#wxPop",panel); pop.hidden=false;
  const saved=WX.places();
  pop.innerHTML=`<div class="t-cap">Location</div>
    <input id="wxQ" placeholder="Search a city or ZIP…" autocomplete="off">
    <div id="wxRes"></div>
    <button class="t-opt" id="wxGps">◉ Use my current location</button>
    ${saved.length?`<div class="t-cap" style="margin-top:10px">Saved</div>`+saved.map((p,i)=>`<div class="t-opt-row"><button class="t-opt" data-sv="${i}">${K.esc(p.name)}</button><button class="t-x" data-rm="${i}" title="Remove">✕</button></div>`).join(""):""}`;
  const q=$("#wxQ",pop); q.focus();
  let deb;
  q.oninput=()=>{ clearTimeout(deb); deb=setTimeout(async()=>{
    if(q.value.trim().length<2){ $("#wxRes",pop).innerHTML=""; return; }
    try{ const r=await WX.search(q.value.trim(),K.http);
      $("#wxRes",pop).innerHTML=r.length?r.map((p,i)=>`<button class="t-opt" data-r="${i}">${K.esc(p.name)}</button>`).join(""):`<div class="muted t-s">No matches</div>`;
      $$("[data-r]",pop).forEach(b=>b.onclick=()=>{ const p=r[+b.dataset.r]; WX.setLoc(p);
        WX.setPlaces([p,...WX.places().filter(x=>x.name!==p.name)]); close(); refresh(true); });
    }catch(e){ $("#wxRes",pop).innerHTML=`<div class="muted t-s">Search is offline</div>`; }
  },280); };
  $("#wxGps",pop).onclick=async()=>{ WX.setLoc(null); close(); panel.querySelector(".wx-label")&&(panel.querySelector(".wx-label").textContent="locating…");
    const l=await WX.resolveLoc(K.http,{fresh:true}); WX.setLoc(l.mode==="default"?null:l); refresh(true); };
  $$("[data-sv]",pop).forEach(b=>b.onclick=()=>{ WX.setLoc(saved[+b.dataset.sv]); close(); refresh(true); });
  $$("[data-rm]",pop).forEach(b=>b.onclick=e=>{ e.stopPropagation(); WX.setPlaces(saved.filter((_,i)=>i!==+b.dataset.rm)); openPicker(); });
  const close=()=>{ pop.hidden=true; document.removeEventListener("pointerdown",out); };
  const out=e=>{ if(!pop.contains(e.target)) close(); };
  setTimeout(()=>document.addEventListener("pointerdown",out),0);
}

async function refresh(force=false){
  try{
    const w=await WX.load(K.http,{force});
    if(panel) render(w);
  }catch(e){
    if(!panel) return;
    panel.innerHTML=head("Weather","WX","uplink lost")+`<div class="t-empty"><div class="t-empty-ico">${wxIcon("cloud",true,90)}</div>
      <h3>Can't reach the weather uplink</h3><p class="muted">Check your connection. T.U.R.D. will show the last forecast it saw once it has one cached.</p>
      <button class="t-btn" id="wxRetry">Try again</button></div>`;
    $("#wxRetry",panel).onclick=()=>refresh(true);
  }
}

let stopFades=()=>{};
export default {
  id:"weather", icon:"☁", label:"Weather",
  theme:{ accent:"#22c8ff", accent2:"#0a7fd6", rgb:"34,200,255", bg:"#03121c", bg2:"#072336" },
  mount(el, ctx){
    K=kit(ctx); panel=el; el.classList.add("t-full","t-sec-wx"); stopFades(); stopFades=edgeFades(el);
    const c=WX.cached();
    if(c) render({...c, stale:Date.now()-c.t>30*60e3});
    else el.innerHTML=head("Weather","WX","acquiring telemetry…")+`<div class="t-loading"><i></i><i></i><i></i><span>Reading the sky…</span></div>`;
    refresh(false);
    clearInterval(timer); timer=setInterval(()=>refresh(true), 10*60e3);
  },
  unmount(){ if(panel) panel.querySelectorAll("iframe").forEach(f=>{ f.src="about:blank"; f.remove(); }); stopFades(); stopFades=()=>{}; stopSky(); stopTilt(); clearInterval(timer); stopSky=()=>{}; panel=null; },
  async summary(ctx){ const k=kit(ctx); try{ return WX.brief(await WX.load(k.http)); }catch(e){ return WX.brief(WX.cached()); } },
};
