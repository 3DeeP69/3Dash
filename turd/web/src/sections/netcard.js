// ===========================================================================
// INTERNET HEALTH card for Home: a glance at the home connection, read from the
// T.U.R.D. server on the PC (Chat/server thread):
//   GET /net/status  -> { online, since, lastOutage?, speed?|lastSpeed?:{down,up,ping,t} }
//   GET /net/outages -> [{ start, end, durationSec }]
// (/api/net/* is tried too.) The full speed test and outage log live in Spy Tools.
// NON-INVASIVE like btbat.js: no uplink, no endpoint, or an error → the card
// renders nothing at all (and stays out of Customize while empty).
// Polls every 30 s while Home is on screen.
// ===========================================================================
import { registerCard } from "./homecards.js";
import { ago } from "./util.js";

let up=null;
const loadUplink = ()=> up ??= import("../uplink.js").then(m=>m.default||m).catch(()=>null);
let base=null;   // which prefix answered last time ("/net" or "/api/net")

async function get(ep, tok, path){
  const http=window.TURD_HTTP||fetch, ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),5000);
  try{
    const r=await http(ep+path,{headers:{authorization:"Bearer "+tok},cache:"no-store",signal:ctl.signal});
    if(!r.ok) return null;
    return await r.json();
  }catch(e){ return null; } finally{ clearTimeout(to); }
}
async function read(){
  const u=await loadUplink(); if(!u) return null;
  try{ if(u.ensureEndpoint) await u.ensureEndpoint(); }catch(e){}
  const ep=u.endpoint&&u.endpoint(), tok=u.token&&u.token(); if(!ep||!tok) return null;
  let st=null;
  for(const b of base?[base]:["/net","/api/net"]){ st=await get(ep,tok,b+"/status"); if(st && typeof st.online==="boolean"){ base=b; break; } st=null; }
  if(!st) return null;
  let outs=await get(ep,tok,base+"/outages"); outs=Array.isArray(outs)?outs:(Array.isArray(outs?.outages)?outs.outages:[]);
  return { st, outs };
}

const dur = s=>{ s=Math.max(0,Math.round(s||0)); if(s<60) return s+"s"; if(s<3600) return Math.floor(s/60)+"m "+String(s%60).padStart(2,"0")+"s"; const h=Math.floor(s/3600); return h<48? h+"h "+Math.floor(s%3600/60)+"m" : Math.floor(h/24)+"d "+(h%24)+"h"; };
const ms = t=> t==null?null: (t<1e12?t*1000:t);   // accept seconds or ms

function html(data, esc){
  if(!data) return "";
  const { st, outs }=data, on=st.online;
  const since=ms(st.since), sp=st.speed||st.lastSpeed||null;
  const last = st.lastOutage || outs.slice().sort((a,b)=>ms(b.start)-ms(a.start))[0] || null;
  const day=Date.now()-864e5, today=outs.filter(o=>ms(o.start)>day);
  const lastDur = last ? (last.durationSec ?? ((ms(last.end)||Date.now())-ms(last.start))/1000) : null;
  return `<div class="pc-strip net-strip ${on?"":"down"}">
    <span class="pc-k"><i class="hm-dot ${on?"up":"down"}"></i>Internet<small>${on?"online":"offline"}${since?` · ${on?"for":"since"} ${dur((Date.now()-since)/1000)}`:""}</small></span>
    ${sp&&sp.down!=null?`<span class="pc-m"><b>${Math.round(sp.down)}<small> ↓</small> ${sp.up!=null?`${Math.round(sp.up)}<small> ↑ Mbps</small>`:`<small>Mbps</small>`}</b><em>Speed${sp.t?` · ${esc(ago(ms(sp.t)))}`:""}</em></span>`:""}
    ${sp&&sp.ping!=null?`<span class="pc-m"><b class="${sp.ping>150?"hot":sp.ping>60?"warm":""}">${Math.round(sp.ping)}<small> ms</small></b><em>Ping</em></span>`:""}
    <span class="pc-m"><b class="${today.length>2?"warm":""}">${last?esc(dur(lastDur)):"none"}</b><em>${last?`Last outage · ${esc(ago(ms(last.start)))}`:"Outages logged"}</em></span>
    ${today.length?`<span class="pc-m"><b>${today.length}</b><em>${today.length===1?"Drop":"Drops"} · 24h</em></span>`:""}
  </div>`;
}

registerCard({ id:"net", label:"Internet health", icon:"◎", kind:"strip", order:22, quiet:true,
  mount(body, K){
    let t=0, dead=false, busy=false;
    const paint=async()=>{ if(dead||busy||document.hidden) return; busy=true;
      try{ const d=await read(); if(!dead){ const h=html(d, K.esc); if(body.innerHTML!==h) body.innerHTML=h; } } finally{ busy=false; } };
    const vis=()=>{ if(!document.hidden) paint(); };
    paint(); t=setInterval(paint, 30e3); document.addEventListener("visibilitychange",vis);
    return { refresh(){}, destroy(){ dead=true; clearInterval(t); document.removeEventListener("visibilitychange",vis); } };
  } });
