// ===========================================================================
// PC STATUS strip for Home — reads GET /api/pcstats from the T.U.R.D. server
// running on the owner's PC (server/pcstats.js). Works on the PC itself and
// from the phone over the home network (same uplink + login as chat).
// Admin only. Polls every ~1.5 s while Home is on screen; costs nothing when hidden.
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
const ring=(pct,cls,k)=>{ const p=Math.max(0,Math.min(100,pct||0)); return `<svg viewBox="0 0 36 36" class="pc-ring ${cls}"${k?` data-r="${k}"`:""}><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${p*.942} 94.2"/></svg>`; };
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
  return `<div class="pc-strip" data-live="${esc(d.host)}">
    <span class="pc-k"><i class="hm-dot up pc-beat"></i>PC · ${esc(d.host)}<small>up <span data-t="up">${upTxt(d.uptime)}</span></small></span>
    <span class="pc-m">${ring(d.cpu.pct,lvl(d.cpu.pct,70,90),"cpu")}<b data-c="cpu"><span data-n="cpu">${d.cpu.pct??"—"}</span>%</b><em>CPU</em></span>
    <span class="pc-m">${ring(d.ram.pct,lvl(d.ram.pct,75,90),"ram")}<b data-c="ram"><span data-n="ram" data-d="1">${d.ram.usedGB}</span><small>/${d.ram.totalGB} GB</small></b><em>RAM</em></span>
    <span class="pc-m"><b class="${lvl(g?.tempC,75,85)}" data-c="gpu">${g?`<span data-n="gpu">${g.tempC}</span>°C`:"—"}</b><em title="${g?esc(g.name+" · "+g.src):"Install NVIDIA drivers (nvidia-smi) or run LibreHardwareMonitor with its web server on"}">GPU<span data-t="gpct">${g&&g.pct!=null?` · ${g.pct}%`:""}</span></em></span>
    <span class="pc-m"><b class="${dk&&dk.freeGB<15?"hot":dk&&dk.freeGB<40?"warm":""}">${dk?dk.freeGB+" GB":"—"}</b><em>free ${dk?esc(dk.drive.replace(/\\$/,"")):""}</em></span>
    <span class="pc-m"><b data-t="oll"><i class="hm-dot ${o.up?"up":"down"}"></i>${o.up?(o.models?.[0]?esc(o.models[0]):"ready"):"off"}</b><em>Ollama</em></span>
    <span class="pc-m"><b><i class="hm-dot up"></i><span data-t="chat">${d.chat?.online??0}</span> on</b><em>Chat server</em></span>
  </div>`;
}

/* Near-live painting: when the strip for the same PC is already on screen, update it in place
   (numbers count smoothly, rings glide via their CSS transition) instead of re-rendering, so
   a 1.5 s refresh never flickers. Anything structural (state, host, GPU/Ollama appearing) re-renders. */
const tw=new WeakMap();
function tween(el, to, dec){
  const from=parseFloat(el.textContent); if(!isFinite(from)||!isFinite(to)||from===to||matchMedia("(prefers-reduced-motion: reduce)").matches||document.body?.dataset.quality==="LOW"){ el.textContent=dec?to.toFixed(1):String(Math.round(to)); return; }
  cancelAnimationFrame(tw.get(el)); const t0=performance.now(), D=700;
  const f=now=>{ const k=Math.min(1,(now-t0)/D), e=1-Math.pow(1-k,3), v=from+(to-from)*e; el.textContent=dec?v.toFixed(1):String(Math.round(v)); if(k<1) tw.set(el,requestAnimationFrame(f)); };
  tw.set(el,requestAnimationFrame(f));
}
export function livePaint(el, res, esc){
  const cur=el.querySelector(".pc-strip[data-live]"), d=res?.d;
  const fresh=stripHTML(res, esc);
  if(!cur || res.state!=="ok" || cur.dataset.live!==String(d.host) || !!cur.querySelector('[data-n="gpu"]')!==!!d.gpu){ if(el.innerHTML!==fresh) el.innerHTML=fresh; return; }
  const tmp=document.createElement("div"); tmp.innerHTML=fresh; const nx=tmp.firstElementChild;
  const set=(sel,fn)=>{ const a=cur.querySelector(sel), b=nx.querySelector(sel); if(a&&b) fn(a,b); };
  ["cpu","ram","gpu"].forEach(k=>set(`[data-n="${k}"]`,(a,b)=>tween(a, parseFloat(b.textContent), !!a.dataset.d)));
  ["cpu","ram"].forEach(k=>set(`[data-r="${k}"]`,(a,b)=>{ a.setAttribute("class",b.getAttribute("class")); a.querySelector(".fg").style.strokeDasharray=b.querySelector(".fg").style.strokeDasharray; }));
  ["cpu","ram","gpu"].forEach(k=>set(`[data-c="${k}"]`,(a,b)=>{ a.className=b.className; }));
  ["up","gpct","oll","chat"].forEach(k=>set(`[data-t="${k}"]`,(a,b)=>{ if(a.innerHTML!==b.innerHTML) a.innerHTML=b.innerHTML; }));
  const beat=cur.querySelector(".pc-beat"); if(beat){ beat.classList.remove("on"); void beat.offsetWidth; beat.classList.add("on"); }
}
