// Idle ambient mode: after a few minutes without input, the HUD dims into a console-style
// screensaver (big clock, weather, next event) with burn-in-safe drift and a low frame rate.
// Any pointer / key / touch / controller input wakes it. Self-contained; core.js just imports
// this and throttles its render loop while window.TURD_IDLE is set. Owned by the core thread.
let started=false, ctxRef=null, idleT=null, shown=false, lastT=Date.now(), clockT=null, driftT=null, wakeLock=null, gpRaf=0;

const CFG_KEY="turd_idle";
const cfg = ()=> Object.assign({off:false, mins:4}, (ctxRef&&ctxRef.LS?ctxRef.LS.get(CFG_KEY,{}):{}));
const setCfg = o=>{ try{ ctxRef.LS.set(CFG_KEY, Object.assign(cfg(),o)); }catch(e){} };

export function init(ctx){
  if(started) return; started=true; ctxRef=ctx;
  injectCSS(); buildChip();
  ["pointermove","pointerdown","keydown","touchstart","wheel"].forEach(ev=>addEventListener(ev, bump, {passive:true}));
  pollPad(); schedule();
}
function bump(){ lastT=Date.now(); if(shown) wake(); }
function schedule(){ clearTimeout(idleT); if(cfg().off) return; idleT=setTimeout(tick, 20000); }   // re-check every 20s
function tick(){ const c=cfg(); if(!c.off && !shown && Date.now()-lastT >= c.mins*60000) enter(); schedule(); }

function pollPad(){ // any controller button press or stick movement counts as input
  try{ const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[]; let active=false;
    pads.forEach(p=>{ if(p.buttons.some(b=>b&&b.pressed)) active=true; if((p.axes||[]).some(a=>Math.abs(a)>0.5)) active=true; });
    if(active) bump();
  }catch(e){}
  gpRaf=requestAnimationFrame(pollPad);
}

async function enter(){
  if(shown) return; shown=true; window.TURD_IDLE=true;
  overlay().classList.add("show");
  paint(); clockT=setInterval(paint, 1000);
  drift(); driftT=setInterval(drift, 30000);
  requestWakeLock();
}
function wake(){
  if(!shown) return; shown=false; window.TURD_IDLE=false; lastT=Date.now();
  const ov=document.getElementById("idle"); if(ov) ov.classList.remove("show");
  clearInterval(clockT); clearInterval(driftT); releaseWakeLock(); schedule();
}

function overlay(){
  let ov=document.getElementById("idle"); if(ov) return ov;
  ov=document.createElement("div"); ov.id="idle";
  ov.innerHTML=`<div class="idle-stage"><div class="idle-clock" id="idle-clock">--:--</div>
    <div class="idle-date" id="idle-date"></div>
    <div class="idle-row"><span class="idle-wx" id="idle-wx"></span><span class="idle-ev" id="idle-ev"></span></div>
    <div class="idle-hint">move to wake</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("pointerdown", bump);   // tapping the screensaver wakes it
  return ov;
}
function drift(){ const st=document.querySelector("#idle .idle-stage"); if(!st) return;
  const x=(Math.random()*2-1)*3, y=(Math.random()*2-1)*3; st.style.transform=`translate(${x}vw, ${y}vh)`; }

async function paint(){
  const clk=document.getElementById("idle-clock"); if(!clk) return;
  const now=new Date();
  clk.textContent=now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  const dt=document.getElementById("idle-date"); if(dt) dt.textContent=now.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  // weather + next event, best-effort from the owning threads' modules (reused, never required)
  try{ const wx=await import("./sections/wxdata.js"); const b=wx.cached?wx.cached():null; const el=document.getElementById("idle-wx");
    if(el && b){ let s=""; if(wx.brief){ const r=wx.brief(b); s=typeof r==="string"?r:""; } if(!s && b.tempC!=null) s=Math.round(b.tempC)+"°"; el.textContent=s; } }catch(e){}
  try{ const cal=await import("./community/calendar.js"); if(cal.upcoming){ const up=await cal.upcoming(1); const el=document.getElementById("idle-ev");
    if(el && up && up.length){ const e=up[0], when=e.when||(e.start?new Date(e.start).toLocaleString([], {weekday:"short", hour:"2-digit", minute:"2-digit"}):""); el.textContent="Next: "+(e.title||e.name||"event")+(when?" · "+when:""); } } }catch(e){}
}

async function requestWakeLock(){
  try{
    const android = document.documentElement.dataset.native==="android" || /Android/i.test(navigator.userAgent||"");
    if(!android || !navigator.wakeLock) return;                 // only the Fold, and only...
    let charging=true; try{ if(navigator.getBattery){ const bat=await navigator.getBattery(); charging=!!bat.charging; } }catch(e){}
    if(!charging) return;                                       // ...while it's charging
    wakeLock=await navigator.wakeLock.request("screen");
  }catch(e){}
}
function releaseWakeLock(){ try{ if(wakeLock){ wakeLock.release(); wakeLock=null; } }catch(e){} }

function buildChip(){
  if(document.getElementById("idlecfg")) return;
  const c=document.createElement("button"); c.id="idlecfg"; c.title="Ambient (idle screensaver) timeout — tap to change or turn off"; document.body.appendChild(c);
  const steps=[{off:true},{off:false,mins:2},{off:false,mins:4},{off:false,mins:8}];
  const label=()=>{ const x=cfg(); c.textContent="AMBIENT: "+(x.off?"OFF":x.mins+"m"); };
  c.onclick=()=>{ const x=cfg(); let i=steps.findIndex(s=> s.off? x.off : (!x.off && s.mins===x.mins)); i=(i+1)%steps.length; setCfg(steps[i]); label(); schedule(); if(ctxRef&&ctxRef.toast) ctxRef.toast("ambient mode: "+(steps[i].off?"off":steps[i].mins+" min")); };
  label();
}
function injectCSS(){ if(document.getElementById("idle-css")) return;
  const s=document.createElement("style"); s.id="idle-css"; s.textContent=`
  #idle{position:fixed;inset:0;z-index:28;display:none;place-items:center;background:rgba(2,4,9,.86);opacity:0;transition:opacity 1.2s;cursor:none}
  #idle.show{display:grid;opacity:1}
  .idle-stage{text-align:center;transition:transform 8s ease-in-out;opacity:.82}
  .idle-clock{font-size:min(22vw,210px);font-weight:700;letter-spacing:4px;color:var(--accent);line-height:1;text-shadow:0 0 50px rgba(var(--accent-rgb),.5)}
  .idle-date{font-family:var(--mono);font-size:16px;letter-spacing:4px;text-transform:uppercase;color:var(--ink-dim);margin-top:10px}
  .idle-row{display:flex;gap:28px;justify-content:center;flex-wrap:wrap;margin-top:24px;font-family:var(--mono);font-size:15px;color:var(--ink)}
  .idle-hint{margin-top:34px;font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--ink-faint)}
  #idlecfg{position:fixed;left:20px;bottom:26px;z-index:9;background:none;border:0;cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:1.5px;color:var(--ink-dim);padding:6px 4px;transition:color .2s}
  #idlecfg:hover{color:var(--ink);text-shadow:0 0 12px rgba(var(--accent-rgb),.8)}
  @media(max-width:760px){ #idlecfg{bottom:calc(70px + var(--sat,0px))} }`;
  document.head.appendChild(s);
}
