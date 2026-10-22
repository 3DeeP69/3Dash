// ===========================================================================
// PC STATUS strip for Home — reads GET /api/pcstats from the T.U.R.D. server
// running on the owner's PC (server/pcstats.js). Works on the PC itself and
// from the phone over the home network (same uplink + login as chat).
// Admin only. Polls every 10s while visible; costs nothing when hidden.
// ===========================================================================
import { LS, ago } from "./util.js";

let up = null;   // ../uplink.js, optional
const loadUplink = ()=> up ??= import("../uplink.js").then(m=>m.default||m).catch(()=>null);

export async function fetchStats(){
  const u=await loadUplink(); if(!u) return {state:"nolink"};
  try{ if(u.ensureEndpoint) await u.ensureEndpoint(); }catch(e){}
  const ep=u.endpoint&&u.endpoint(), tok=u.token&&u.token();
  if(!ep||!tok) return {state:"nolink"};
  const http=(window.TURD_HTTP)||fetch;
  const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),5000);
  try{
    const r=await http(ep+"/api/pcstats",{headers:{authorization:"Bearer "+tok},cache:"no-store",signal:ctl.signal});
    if(r.status===404) return {state:"old"};            // server without the stats module yet
    if(r.status===401||r.status===403) return {state:"denied"};
    const j=await r.json(); if(!j.ok) return {state:"denied"};
    LS.set("turd_pc_last",j);
    return {state:"ok", d:j};
  }catch(e){ return {state:"offline", d:LS.get("turd_pc_last",null)}; }
  finally{ clearTimeout(to); }
}

const lvl=(v,a,b)=> v==null?"":v>=b?"hot":v>=a?"warm":"";
const ring=(pct,cls)=>{ const p=Math.max(0,Math.min(100,pct||0)); return `<svg viewBox="0 0 36 36" class="pc-ring ${cls}"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${p*.942} 94.2"/></svg>`; };
const upTxt=s=>{ const d=Math.floor(s/86400), h=Math.floor(s%86400/3600); return d?`${d}d ${h}h`:`${h}h ${Math.floor(s%3600/60)}m`; };

export function stripHTML(res, esc){
  if(!res || res.state==="nolink" || res.state==="denied") return "";
  if(res.state==="old") return `<div class="pc-strip dim"><span class="pc-k">PC</span><span class="t-s">Update the T.U.R.D. server on your PC to see live stats here.</span></div>`;
  const d=res.d;
  if(res.state==="offline"){
    return `<div class="pc-strip dim"><span class="pc-k"><i class="hm-dot down"></i>PC${d?` · ${esc(d.host)}`:""}</span>
      <span class="t-s">Offline or not reachable${d?` · last seen ${ago(d.t)}`:""}. Is the PC on and the T.U.R.D. app running?</span></div>`;
  }
  const g=d.gpu, dk=d.disk, o=d.ollama||{};
  return `<div class="pc-strip">
    <span class="pc-k"><i class="hm-dot up"></i>PC · ${esc(d.host)}<small>up ${upTxt(d.uptime)}</small></span>
    <span class="pc-m">${ring(d.cpu.pct,lvl(d.cpu.pct,70,90))}<b>${d.cpu.pct??"—"}%</b><em>CPU</em></span>
    <span class="pc-m">${ring(d.ram.pct,lvl(d.ram.pct,75,90))}<b>${d.ram.usedGB}<small>/${d.ram.totalGB} GB</small></b><em>RAM</em></span>
    <span class="pc-m"><b class="${lvl(g?.tempC,75,85)}">${g?g.tempC+"°C":"—"}</b><em title="${g?esc(g.name+" · "+g.src):"Install NVIDIA drivers (nvidia-smi) or run LibreHardwareMonitor with its web server on"}">GPU${g&&g.pct!=null?` · ${g.pct}%`:""}</em></span>
    <span class="pc-m"><b class="${dk&&dk.freeGB<15?"hot":dk&&dk.freeGB<40?"warm":""}">${dk?dk.freeGB+" GB":"—"}</b><em>free ${dk?esc(dk.drive.replace(/\\$/,"")):""}</em></span>
    <span class="pc-m"><b><i class="hm-dot ${o.up?"up":"down"}"></i>${o.up?(o.models?.[0]?esc(o.models[0]):"ready"):"off"}</b><em>Ollama</em></span>
    <span class="pc-m"><b><i class="hm-dot up"></i>${d.chat?.online??0} on</b><em>Chat server</em></span>
  </div>`;
}
