// ===========================================================================
// FOLD STATUS strip for Home (Device-sync thread). Shows your phone on the PC:
// battery, charging, free storage, temperature and last seen.
//
// Two sources, best first:
//   1. GET /api/devstatus (server/devstatus.js, native apps thread): the Android
//      app's native readings, also reported every ~30 min while the app is closed.
//   2. Device sync rows (../sync.js, localStorage turd_devices): every signed-in
//      device reports itself while open — works in a plain browser too.
// Same look as the PC strip (pcstat.js / .pc-strip).
// ===========================================================================
import { ago } from "./util.js";

let up = null;
const loadUplink = ()=> up ??= import("../uplink.js").then(m=>m.default||m).catch(()=>null);
let srvRows = null;          // last good /api/devstatus answer (null = not available)

export async function fetchDevices(){
  const u=await loadUplink(); const ep=u&&u.endpoint&&u.endpoint(), tok=u&&u.token&&u.token();
  if(!ep||!tok) return srvRows;
  const http=(window.TURD_HTTP)||fetch, ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),5000);
  try{
    const r=await http(ep+"/api/devstatus",{headers:{authorization:"Bearer "+tok},cache:"no-store",signal:ctl.signal});
    if(!r.ok){ if(r.status===404) srvRows=null; return srvRows; }
    const j=await r.json(); if(j&&j.ok){ const skew=(j.now||Date.now())-Date.now();
      srvRows=(j.devices||[]).map(d=>({ name:d.name||d.model||"Phone", platform:"android", online:!d.stale && d.ageSec<10*60, seen:d.lastSeen-skew,
        battery:d.battery, charging:d.charging, full:d.full, tempC:d.tempC, free:d.storageFreeGB!=null?d.storageFreeGB*1e9:null,
        total:d.storageTotalGB!=null?d.storageTotalGB*1e9:null, freeSrc:"device", src:"native" })); }
  }catch(e){}
  finally{ clearTimeout(to); }
  return srvRows;
}

const syncRows = ()=>{ try{ return (window.TURD_SYNC && window.TURD_SYNC.devices()) || []; }catch(e){ return []; } };
const gb = n=> n==null ? "—" : n>=1e9 ? (n/1e9).toFixed(n>=1e11?0:1)+" GB" : Math.round(n/1e6)+" MB";
const ring=(pct,cls)=>{ const p=Math.max(0,Math.min(100,pct||0)); return `<svg viewBox="0 0 36 36" class="pc-ring ${cls}"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${p*.942} 94.2"/></svg>`; };

/* phones only (the PC has its own strip). Native rows win; a fresher sync row (the phone
   is open right now) updates the live fields of the newest native row. */
function phones(){
  const nat=(srvRows||[]), syn=syncRows().filter(d=>!d.me && d.platform==="android");
  if(!nat.length) return syn;
  const s=syn[0], n0=nat[0];
  if(s && (s.seen||0) > (n0.seen||0)+60e3)
    return [{ ...n0, online:s.online, seen:s.seen, app:s.app, battery:s.battery??n0.battery, charging:s.charging??n0.charging,
      free:s.freeSrc==="device"?s.free:n0.free }, ...nat.slice(1)];
  return nat.map((d,i)=> i===0 && s ? { ...d, app:s.app } : d);
}

export function devStripHTML(esc){
  return phones().map(d=>{
    const b=d.battery, low=b!=null && b<=20 && !d.charging, warn=b!=null && b<=40 && !d.charging;
    const hot=d.tempC!=null && d.tempC>=42, warm=d.tempC!=null && d.tempC>=38;
    return `<div class="pc-strip${d.online?"":" dim"}">
      <span class="pc-k"><i class="hm-dot ${d.online?"up":"down"}"></i>${esc(d.name||"Phone")}<small>${d.online?"online now":"last seen "+ago(d.seen)}</small></span>
      <span class="pc-m">${b==null?"":ring(b, low?"hot":warn?"warm":"")}<b class="${low?"hot":warn?"warm":""}">${b==null?"—":Math.round(b)+"%"}</b><em>${d.full?"full":d.charging?"⚡ charging":"battery"}</em></span>
      <span class="pc-m"><b class="${d.free!=null&&d.free<5e9?"hot":d.free!=null&&d.free<15e9?"warm":""}">${gb(d.free)}</b><em>${d.freeSrc==="device"?"free storage":"free for app"}</em></span>
      ${d.tempC!=null?`<span class="pc-m"><b class="${hot?"hot":warm?"warm":""}">${Math.round(d.tempC)}°C</b><em>battery temp</em></span>`:""}
      ${d.app?`<span class="pc-m"><b>v${esc(String(d.app).replace(/^v/,""))}</b><em>T.U.R.D.</em></span>`:""}
    </div>`;
  }).join("");
}
