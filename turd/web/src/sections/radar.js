// BT / Wi-Fi Radar — nearby-device discovery GUI for the operator's own surroundings.
// Web Bluetooth live scan where available; animated scope + demo sweep everywhere.
// In the Windows/Android apps, window.TURD_NATIVE.radar runs real Wi-Fi + Bluetooth LE
// scans (web/src/native.js). Self-registers via the section contract.
import { edgeFades } from "./util.js";

let DEVICES = [];
let stopFades=()=>{};

function paint(scope, list, ctx){
  scope.querySelectorAll(".blip").forEach(b=>b.remove());
  DEVICES.forEach((d,i)=>{
    const b=document.createElement("div"); b.className="blip"+(d.ble?" ble":"");
    const ang=((i*47)%360)*Math.PI/180, dist=10+(100-Math.min(100,(d.rssi?d.rssi+100:60)))*1.25;
    b.style.left=(50+Math.cos(ang)*dist/3)+"%"; b.style.top=(50+Math.sin(ang)*dist/3)+"%"; b.title=d.name;
    scope.appendChild(b);
  });
  list.innerHTML = DEVICES.length? DEVICES.map(d=>`
    <div class="dev"><div><div class="n">${ctx.esc(d.name)} ${d.ble?'<span class="tag">BLE</span>':''}${d.wifi?'<span class="tag wifi">WI-FI</span>':''}</div>
      <div class="s">${d.wifi?ctx.esc(`ch ${d.channel||"?"} · ${d.freq>=5900?"6":d.freq>=4900?"5":"2.4"} GHz · ${d.rssi} dBm${d.secure?"":" · open"}`)
        :d.id?ctx.esc(d.id+(d.vendor?" · "+d.vendor:"")+(d.rssi?" · "+d.rssi+" dBm":"")):"signal "+(d.rssi||"~")+" dBm"}</div></div>
      <div class="bar"><i style="width:${Math.min(100,Math.max(10,(d.rssi?d.rssi+100:50)))}%"></i></div></div>`).join("")
    : `<p class="t-s rdr-empty">No contacts yet. Run a scan to populate.</p>`;
}

const RADAR = {
  id:"radar", icon:"◎", label:"Radar",
  theme:{ accent:"#ff5ca8", accent2:"#b04cff", rgb:"255,92,168" },
  mount(el, ctx){
    const { head, toast } = ctx;
    el.classList.add("t-full","t-sec-rdr");
    stopFades(); stopFades=edgeFades(el);
    el.innerHTML=head("BT / Wi-Fi Radar","RDR","nearby device discovery")+`
      <div class="radar-wrap">
        <div class="t-card"><div class="t-cap">Scope</div><div class="scope" id="scope"><div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div class="ring r4"></div>
          <div class="cross"></div><div class="cross2"></div><div class="sweep"></div></div>
          <div class="row" style="justify-content:center;margin-top:16px;gap:10px;flex-wrap:wrap">
            ${window.TURD_NATIVE&&window.TURD_NATIVE.radar?'<button class="t-btn sm" id="natScan">◉ FULL SCAN</button>':''}
            <button class="t-btn sm" id="btScan">⌁ BLUETOOTH SCAN</button>
            <button class="t-link" id="simScan">◎ DEMO SWEEP</button></div>
          <p class="muted mono" style="font-size:10px;text-align:center;margin-top:10px">Discovers devices advertising near <b>you</b>. Nothing connects without your tap.</p>
        </div>
        <div class="t-card"><div class="t-cap">Contacts</div><div id="devList"></div></div>
      </div>`;
    const scope=el.querySelector("#scope"), list=el.querySelector("#devList");
    paint(scope,list,ctx);
    const N=window.TURD_NATIVE;
    const natBtn=el.querySelector("#natScan");
    // native: Wi-Fi networks + BLE advertisers together (asks for the permissions once)
    const nativeScan=async(which)=>{
      const btn=which==="ble"?el.querySelector("#btScan"):natBtn; if(btn) btn.disabled=true;
      scope.classList.add("scanning"); toast(which==="ble"?"sweeping Bluetooth…":"sweeping Wi-Fi + Bluetooth…");
      let permErr=""; try{ await N.radar.request(); }catch(e){ permErr=String(e&&e.message||e); console.warn("[radar] permission request failed:",e); }
      const [w,b]=await Promise.allSettled([which==="ble"?Promise.resolve([]):N.radar.wifi(), N.radar.ble({ms:6000})]);
      const list=[];
      if(w.status==="fulfilled") w.value.forEach(x=>list.push({name:x.ssid,wifi:true,rssi:x.rssi,channel:x.channel,freq:x.freq,secure:x.secure}));
      if(b.status==="fulfilled") b.value.forEach(x=>list.push({name:x.name,id:x.id,ble:true,rssi:x.rssi,vendor:x.vendor}));
      list.sort((a,c)=>(c.rssi||-100)-(a.rssi||-100));
      DEVICES=list; paint(scope,list_el,ctx); scope.classList.remove("scanning"); if(btn) btn.disabled=false;
      // surface the real native error text (not a vague "handler error") so failures are diagnosable
      const errW=w.status==="rejected"?String(w.reason&&w.reason.message||w.reason):"";
      const errB=b.status==="rejected"?String(b.reason&&b.reason.message||b.reason):"";
      if(errW) console.warn("[radar] Wi-Fi scan failed:",w.reason);
      if(errB) console.warn("[radar] BLE scan failed:",b.reason);
      const errs=[errW,errB,permErr].filter(Boolean);
      if(list.length) toast(list.length+" contacts in range"+(errs.length?" · "+errs[0]:""));
      else if(errs.length) toast("scan failed: "+errs.join(" / "));
      else toast("nothing in range");
    };
    const list_el=list;
    if(natBtn) natBtn.onclick=()=>nativeScan("all");
    el.querySelector("#btScan").onclick=async()=>{
      if(N&&N.radar){ nativeScan("ble"); return; }
      if(!navigator.bluetooth){ toast("Web Bluetooth not available here — use the native app build"); return; }
      try{ const dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[]});
        DEVICES.unshift({name:dev.name||"unnamed",id:dev.id,ble:true,rssi:-55}); paint(scope,list,ctx); toast("contact: "+(dev.name||"unnamed"));
      }catch(e){ toast("scan cancelled"); }
    };
    el.querySelector("#simScan").onclick=()=>{
      const names=["Pixel-7a","AirPods","Galaxy Buds","Unknown-BLE","TP-Link_5G","HP-Printer","Tile","Fitbit","ESP32","Roku"];
      DEVICES=[]; const n=4+Math.floor(Math.random()*5);
      for(let i=0;i<n;i++) DEVICES.push({name:names[Math.floor(Math.random()*names.length)],ble:Math.random()>.5,rssi:-40-Math.floor(Math.random()*55)});
      paint(scope,list,ctx); toast(n+" contacts in range");
    };
  },
  unmount(){ stopFades(); stopFades=()=>{}; },
  summary(){ return { title:"Radar", value:DEVICES.length, note:"contacts" }; },
};
export default RADAR;
export function mountRadar(el, ctx){ return RADAR.mount(el, ctx); }
export function unmountRadar(){ return RADAR.unmount && RADAR.unmount(); }

/* scope styles */
(function(){ if(document.getElementById("radar-css")) return;
  const s=document.createElement("style"); s.id="radar-css"; s.textContent=`
  .radar-wrap{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:22px;align-items:start;padding-inline:10px}
  @media(max-width:1100px){.radar-wrap{grid-template-columns:1fr}}
  .scope{position:relative;width:min(100%,400px);aspect-ratio:1;margin:6px auto 0;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.08),transparent 70%);border:1px solid var(--glass-line);box-shadow:inset 0 0 40px rgba(var(--accent-rgb),.12)}
  .scope .ring{position:absolute;border:1px solid rgba(var(--accent-rgb),.18);border-radius:50%;inset:0}
  .scope .ring.r2{inset:16.7%}.scope .ring.r3{inset:33.3%}.scope .ring.r4{inset:45%}
  .scope .cross,.scope .cross2{position:absolute;background:rgba(var(--accent-rgb),.18)}
  .scope .cross{left:50%;top:0;bottom:0;width:1px}.scope .cross2{top:50%;left:0;right:0;height:1px}
  .scope .sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(var(--accent-rgb),.5),transparent 32%);animation:spin 3.2s linear infinite;mask:radial-gradient(circle,transparent 0,#000 1px)}
  .blip{position:absolute;width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);transform:translate(-50%,-50%);transition:.4s;cursor:pointer}
  .blip.ble{background:var(--accent2);box-shadow:0 0 12px var(--accent2)}
  .blip::after{content:"";position:absolute;inset:-6px;border:1px solid currentColor;border-radius:50%;opacity:.5;animation:ping 1.8s infinite}
  @keyframes ping{to{transform:scale(2.2);opacity:0}}
  .dev{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 6px;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.07) 15%,rgba(255,255,255,.07) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .dev:last-child{background-image:none}
  .dev .n{font-size:15px;color:var(--ink)}.dev .tag{border:0;padding:0 0 0 6px;color:var(--accent2)}.dev .tag.wifi{color:var(--accent)}
  .scope.scanning .sweep{animation-duration:1.1s}
  .rdr-empty{padding:18px 6px}.dev .s{font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
  .bar{width:60px;height:6px;border-radius:6px;background:rgba(0,0,0,.4);overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}`;
  document.head.appendChild(s);
})();
