// Home Network Watch — lists devices on the operator's OWN Wi-Fi/LAN (IP, MAC, vendor, hostname),
// lets them name & trust devices, and flags any new unknown device. Defensive: the owner's own network.
// Native scan via window.TURD_NATIVE.netwatch (PC: ARP table + ping sweep / desktop server; Android: plugin).
//   N.netwatch.request()?  → asks for any needed permission
//   N.netwatch.scan()      → [{ip, mac, vendor, hostname}]   (vendor resolved from the bundled offline OUI list)
// In a plain browser (no native bridge) it runs a demo scan so the section is usable in the preview.
// Self-registers via the section contract.
import { edgeFades } from "./util.js";

let DEVICES = [];            // last scan result
let editMac = null;          // mac currently being renamed inline
let stopFades = ()=>{};

const KEY = "turd_netwatch"; // { known: { id: {name, trust, firstSeen, lastSeen} } }
const store = (LS)=> LS.get(KEY, { known:{} });
const saveStore = (LS,s)=> LS.set(KEY, s);
const ipNum = ip => (ip||"").split(".").reduce((a,o)=>a*256+(parseInt(o,10)||0),0);
// stable identity: prefer MAC, but Android 10+ hides MACs, so fall back to the IP there
const idOf = d => d.mac || ("ip:"+(d.ip||""));

function randMac(){ const h=()=>("0"+Math.floor(Math.random()*256).toString(16)).slice(-2).toUpperCase(); return [h(),h(),h(),h(),h(),h()].join(":"); }
function demoScan(){
  const base=[
    {ip:"192.168.1.1",  mac:"B0:4E:26:11:22:33", vendor:"TP-Link",      hostname:"router", gateway:true},
    {ip:"192.168.1.14", mac:"3C:5A:B4:9D:1E:70", vendor:"Google",       hostname:"nest-hub"},
    {ip:"192.168.1.22", mac:"A4:83:E7:55:0C:91", vendor:"Apple",        hostname:"iphone"},
    {ip:"192.168.1.31", mac:"DC:A6:32:88:4F:12", vendor:"Raspberry Pi", hostname:"pi-hole"},
    {ip:"192.168.1.40", mac:"48:2C:A0:6B:7E:5A", vendor:"Samsung",      hostname:"galaxy-fold4", self:true},
    {ip:"192.168.1.52", mac:"00:17:88:3D:AA:02", vendor:"Philips Hue",  hostname:"hue-bridge"},
  ];
  // occasionally surface an unknown newcomer so the alert path is visible in the demo
  if(Math.random()>0.5) base.push({ip:"192.168.1."+(80+Math.floor(Math.random()*90)), mac:randMac(), vendor:"Unknown", hostname:""});
  return base;
}

export default {
  id:"netwatch", icon:"⇄", label:"Network",
  theme:{ accent:"#3fd0ff", accent2:"#2f7bff", rgb:"63,208,255" },
  mount(el, ctx){
    const { LS, head, esc, toast } = ctx;
    el.classList.add("t-full","t-sec-net");
    stopFades(); stopFades=edgeFades(el);
    const N = window.TURD_NATIVE;
    let macsHidden=false;   // set from scanFull().macs===false (e.g. Android 10+ hides device MACs)

    const render=()=>{
      const s=store(LS);
      const rows=DEVICES.slice().sort((a,b)=> ipNum(a.ip)-ipNum(b.ip));
      // a device is "new unknown" only if it isn't known AND isn't this device/the gateway
      const unknownNew=rows.filter(d=>!s.known[idOf(d)] && !d.self && !d.gateway);
      el.innerHTML=head("Home Network Watch","NET","devices on your network")+`
        <div class="net-wrap">
          <div class="t-card net-main">
            <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div class="t-cap">Devices <span class="muted">(${rows.length})</span></div>
              <button class="t-btn sm" id="netScan">⟲ SCAN NETWORK</button>
            </div>
            ${unknownNew.length?`<div class="net-alert">⚠ ${unknownNew.length} new unknown device${unknownNew.length>1?"s":""} on your network — name &amp; trust the ones you recognise, investigate any you don't.</div>`:``}
            ${macsHidden?`<div class="net-note">This device hides other devices' hardware (MAC) addresses, so names are tracked by IP here and may shift if your router reassigns them.</div>`:``}
            <div id="netList" class="net-list"></div>
            <p class="muted mono" style="font-size:10px;margin-top:10px">Scans only your own network. Vendor is inferred from the hardware (MAC) address. Nothing leaves your device.</p>
          </div>
        </div>`;
      const list=el.querySelector("#netList");
      list.innerHTML = rows.length ? rows.map(d=>{
        const id=idOf(d), k=s.known[id]||null, name=(k&&k.name)?k.name:(d.hostname||""), trusted=!!(k&&k.trust), isNew=!k && !d.self && !d.gateway;
        const tags=(d.self?'<span class="nd-tag self">THIS DEVICE</span>':'')+(d.gateway?'<span class="nd-tag gw">GATEWAY</span>':'')+(isNew?'<span class="nd-tag new">NEW</span>':'')+(trusted?'<span class="nd-tag ok">TRUSTED</span>':'');
        const label = editMac===id
          ? `<input class="nd-edit" data-id="${esc(id)}" value="${esc((k&&k.name)||d.hostname||"")}" placeholder="name this device" maxlength="40">`
          : `<div class="nd-name">${esc(name||d.ip)}${tags}</div>`;
        const sub=[d.ip, d.mac, d.vendor, d.hostname].filter(Boolean).join(" · ") || "no address details";
        return `<div class="net-dev ${trusted?"trusted":""} ${isNew?"new":""}">
          <div class="nd-main">${label}
            <div class="nd-sub">${esc(sub)}${d.rttMs!=null?` · ${esc(String(d.rttMs))} ms`:""}</div></div>
          <div class="nd-act">
            <button class="t-link nd-name-btn" data-id="${esc(id)}">${editMac===id?"save":"name"}</button>
            <button class="t-link nd-trust-btn" data-id="${esc(id)}">${trusted?"untrust":"trust"}</button>
          </div></div>`;
      }).join("") : `<p class="t-s net-empty">No scan yet. Tap “Scan network”.</p>`;

      const upsert=(id,patch)=>{ const s=store(LS); s.known[id]=Object.assign({name:"",trust:false,firstSeen:Date.now()}, s.known[id]||{}, patch, {lastSeen:Date.now()}); saveStore(LS,s); };
      const commitName=(id)=>{ const inp=list.querySelector(`.nd-edit[data-id="${CSS.escape(id)}"]`); if(inp) upsert(id,{name:inp.value.trim()}); editMac=null; render(); };

      list.querySelectorAll(".nd-trust-btn").forEach(b=>b.onclick=()=>{ const id=b.dataset.id, s=store(LS); upsert(id,{trust:!(s.known[id]&&s.known[id].trust)}); render(); });
      list.querySelectorAll(".nd-name-btn").forEach(b=>b.onclick=()=>{ const id=b.dataset.id; if(editMac===id){ commitName(id); } else { editMac=id; render(); } });
      if(editMac){ const inp=list.querySelector(".nd-edit"); if(inp){ inp.focus(); inp.select();
        inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); commitName(editMac); } else if(e.key==="Escape"){ editMac=null; render(); } };
        inp.onblur=()=>{ if(editMac) commitName(editMac); };
      } }
      el.querySelector("#netScan").onclick=doScan;
    };

    const doScan=async()=>{
      const btn=el.querySelector("#netScan"); if(btn) btn.disabled=true; toast("scanning your network… (up to ~20s)");
      try{
        if(N && N.netwatch && N.netwatch.scan){
          if(N.netwatch.request){ try{ const p=await N.netwatch.request(); if(p && p.granted===false){ toast("scan needs permission"+(p.reason?": "+p.reason:"")); if(btn) btn.disabled=false; return; } }catch(_){} }
          if(N.netwatch.scanFull){ const r=await N.netwatch.scanFull(); DEVICES=(r&&r.devices)||r||[]; if(r&&typeof r.macs==="boolean") macsHidden=!r.macs; }
          else { DEVICES = await N.netwatch.scan() || []; }
        } else {
          await new Promise(r=>setTimeout(r,700));
          DEVICES = demoScan(); macsHidden=false;
        }
      }catch(e){ toast("scan failed: "+String(e&&e.message||e)); if(btn) btn.disabled=false; return; }
      const s=store(LS); let newCount=0;
      DEVICES.forEach(d=>{ const id=idOf(d); if(!s.known[id]){ if(!d.self && !d.gateway) newCount++; } else s.known[id].lastSeen=Date.now(); });
      saveStore(LS,s);
      if(btn) btn.disabled=false;
      toast(DEVICES.length+" device"+(DEVICES.length===1?"":"s")+" found"+(newCount?` · ${newCount} new`:""));
      render();
    };

    render();
  },
  unmount(){ stopFades(); stopFades=()=>{}; editMac=null; },
  summary(){ return { title:"Network", value:DEVICES.length||"—", note:"devices" }; },
};
/* styles */
(function(){ if(document.getElementById("netwatch-css")) return;
  const s=document.createElement("style"); s.id="netwatch-css"; s.textContent=`
  .net-wrap{padding-inline:10px}
  .net-main{max-width:980px}
  .net-alert{margin:12px 0;padding:10px 14px;border-radius:12px;background:rgba(255,180,60,.12);border:1px solid rgba(255,180,60,.5);color:#ffd98a;font-size:13px;line-height:1.5}
  .net-note{margin:10px 0 2px;padding:8px 12px;border-radius:10px;background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.3);color:var(--ink-dim);font-size:11px;line-height:1.5}
  .nd-tag.self{background:rgba(var(--accent-rgb),.22);color:var(--accent)}
  .nd-tag.gw{background:rgba(255,255,255,.12);color:var(--ink)}
  .net-list{margin-top:6px}
  .net-dev{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 8px;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.07) 15%,rgba(255,255,255,.07) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .net-dev:last-child{background-image:none}
  .net-dev.new{background-color:rgba(255,180,60,.06)}
  .nd-main{min-width:0;flex:1}
  .nd-name{font-size:15px;color:var(--ink);font-weight:600}
  .nd-edit{font-size:15px;max-width:260px;background:rgba(0,0,0,.3);border:1px solid var(--glass-line);border-radius:8px;padding:6px 10px;color:var(--ink)}
  .nd-sub{font-family:var(--mono);font-size:11px;color:var(--ink-dim);margin-top:3px;word-break:break-all}
  .nd-tag{font-family:var(--mono);font-size:9px;letter-spacing:1px;padding:1px 6px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .nd-tag.new{background:rgba(255,180,60,.2);color:#ffd98a}
  .nd-tag.ok{background:rgba(var(--accent-rgb),.2);color:var(--accent)}
  .nd-act{display:flex;gap:12px;flex:0 0 auto}
  .net-dev.trusted .nd-name{color:#fff}
  .net-empty{padding:18px 6px}
  @media(max-width:700px){ .net-dev{flex-direction:column;align-items:flex-start;gap:8px} .nd-act{align-self:flex-end} }`;
  document.head.appendChild(s);
})();
