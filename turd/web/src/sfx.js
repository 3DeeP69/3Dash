// Console sounds (Web Audio, synthesized — no files, no licensing). A PS3-style boot chime at
// login and soft, smooth cues for moving between sections, selecting, opening/closing panels and
// errors, each pitched slightly to the active section's theme colour. Self-contained: it wires
// itself by observing existing DOM signals, so core.js needs no edits beyond importing it.
//   window.TURD_SFX = { boot, nav, select, open, close, error, setVol, muted }
// Owned by the core thread.
let started=false, ctxRef=null, ac=null, master=null, armed=false;

const KEY="turd_sfx";
const VOLS=[0, 0.07, 0.15, 0.26];                 // OFF / LOW / MED / HIGH master levels (kept gentle)
const cfg = ()=> Object.assign({vol:2}, (ctxRef&&ctxRef.LS?ctxRef.LS.get(KEY,{}):{}));   // default MED; mute/volume via the SOUND chip
const setCfg = o=>{ try{ ctxRef.LS.set(KEY, Object.assign(cfg(),o)); }catch(e){} };

// bootDone: resolves when the boot chime finishes (or immediately when muted) so the login
// briefing can await it instead of guessing a delay. Always resolves — never left hanging.
let bootResolve=null; const bootReady=new Promise(r=>{ bootResolve=r; });
const finishBoot=()=>{ if(bootResolve){ const r=bootResolve; bootResolve=null; r(); } };

function ensure(){
  if(ac) return ac;
  try{ const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null;
    ac=new AC(); master=ac.createGain(); master.gain.value=VOLS[cfg().vol]||0; master.connect(ac.destination);
  }catch(e){ ac=null; }
  return ac;
}
function arm(){ if(armed) return; armed=true; try{ if(ensure() && ac.state==="suspended") ac.resume(); }catch(e){} }
function on(){ return !!ensure() && (VOLS[cfg().vol]||0)>0; }

// one soft voice: sine/triangle with a gentle attack/release envelope and optional glide
function voice(freq, {type="sine", t0=0, dur=0.16, peak=1, glide=null, delay=0}={}){
  if(!ac||!master) return;
  const g=ac.createGain(), o=ac.createOscillator();
  const start=ac.currentTime+delay+t0;
  o.type=type; o.frequency.setValueAtTime(freq, start);
  if(glide) o.frequency.exponentialRampToValueAtTime(Math.max(1,glide), start+dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001,peak), start+Math.min(0.03,dur*0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, start+dur);
  o.connect(g).connect(master); o.start(start); o.stop(start+dur+0.03);
}

// derive a small pitch factor (~0.9–1.25) from the active section accent colour so each theme sings differently
function themePitch(){
  try{ const rgb=getComputedStyle(document.body).getPropertyValue("--accent-rgb").split(",").map(n=>+n.trim());
    if(rgb.length<3||rgb.some(isNaN)) return 1;
    const [r,g,b]=rgb.map(v=>v/255), mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn; let h=0;
    if(d){ h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60; if(h<0) h+=360; }
    return 0.9 + (h/360)*0.35;
  }catch(e){ return 1; }
}

const S = {
  nav(){ if(!on()) return; const p=themePitch(); voice(560*p,{dur:0.13,peak:0.5}); voice(840*p,{type:"triangle",dur:0.1,peak:0.22,delay:0.04}); },
  select(){ if(!on()) return; const p=themePitch(); voice(660*p,{dur:0.09,peak:0.42}); },
  open(){ if(!on()) return; const p=themePitch(); voice(440*p,{dur:0.16,peak:0.4,glide:760*p}); },
  close(){ if(!on()) return; const p=themePitch(); voice(620*p,{dur:0.16,peak:0.38,glide:360*p}); },
  error(){ if(!on()) return; voice(200,{type:"triangle",dur:0.22,peak:0.5}); voice(150,{type:"triangle",dur:0.26,peak:0.4,delay:0.08}); },
  boot(){ const live=on(); if(live){ const p=themePitch(); // soft ascending chime + pad — original, not Sony's audio
      [0,0.12,0.24,0.40].forEach((d,i)=> voice([392,523,659,784][i]*p,{type:"sine",dur:0.7-i*0.06,peak:0.34,delay:d}));
      voice(196*p,{type:"triangle",dur:1.1,peak:0.14,delay:0.02}); }
    setTimeout(finishBoot, live?1200:0); },   // ~1.15s of chime; signal bootDone once it's clear
  get bootDone(){ return bootReady; },
  setVol(v){ setCfg({vol:v}); if(master&&ac) master.gain.setTargetAtTime(VOLS[v]||0, ac.currentTime, 0.02); },
  get muted(){ return (cfg().vol||0)===0; },
};

export function init(ctx){
  if(started) return; started=true; ctxRef=ctx; window.TURD_SFX=S;
  // a user gesture is required before audio may play; arm on the first one
  ["pointerdown","keydown","touchstart"].forEach(ev=>addEventListener(ev, arm, {once:false, passive:true}));
  buildChip(); wireObservers();
  setTimeout(finishBoot, 3000);   // fail-safe: resolve bootDone even if the boot chime never fires
}

function wireObservers(){
  // nav: the active section lives in body[data-section]; play when it changes
  let lastSec=document.body.dataset.section||"";
  new MutationObserver(()=>{ const s=document.body.dataset.section||""; if(s!==lastSec){ lastSec=s; S.nav(); } })
    .observe(document.body,{attributes:true,attributeFilter:["data-section"]});
  // boot chime: when the login deck hides (login → app)
  const login=document.getElementById("login");
  if(login) new MutationObserver(()=>{ if(login.classList.contains("hide")) S.boot(); })
    .observe(login,{attributes:true,attributeFilter:["class"]});
  // open/close: overlays toggling their .show class
  ["modal","byg","idle"].forEach(id=>{ const seen={v:false};
    const el=()=>document.getElementById(id);
    const obs=new MutationObserver(()=>{ const e=el(); if(!e) return; const sh=e.classList.contains("show"); if(sh===seen.v) return; seen.v=sh; sh?S.open():S.close(); });
    const attach=()=>{ const e=el(); if(e){ seen.v=e.classList.contains("show"); obs.observe(e,{attributes:true,attributeFilter:["class"]}); return true; } return false; };
    if(!attach()){ // #byg / #idle are created lazily — watch body for them to appear
      const bodyObs=new MutationObserver(()=>{ if(attach()) bodyObs.disconnect(); });
      bodyObs.observe(document.body,{childList:true});
    }
  });
  // error: the login message turning to an error state
  const lmsg=document.getElementById("lmsg");
  if(lmsg) new MutationObserver(()=>{ if(lmsg.classList.contains("err")) S.error(); })
    .observe(lmsg,{attributes:true,attributeFilter:["class"]});
  // select: clicks on actionable controls (navbtn excluded — the nav sound already covers section moves)
  document.addEventListener("click", e=>{
    const t=e.target&&e.target.closest&&e.target.closest("button,.t-link,.check,.navbtn");
    if(!t || t.classList.contains("navbtn")) return;
    if(t.id==="sndcfg"||t.id==="idlecfg"||t.id==="perf") return;   // the setting chips stay silent
    S.select();
  }, true);
}

function buildChip(){
  if(document.getElementById("sndcfg")) return;
  const c=document.createElement("button"); c.id="sndcfg"; c.title="Console sounds — tap to change volume or mute"; document.body.appendChild(c);
  const names=["OFF","LOW","MED","HIGH"];
  const label=()=>{ c.textContent="SOUND: "+names[cfg().vol||0]; };
  c.onclick=()=>{ arm(); const v=((cfg().vol||0)+1)%names.length; S.setVol(v); label(); if(v>0) S.select(); if(ctxRef&&ctxRef.toast) ctxRef.toast("sound: "+names[v].toLowerCase()); };
  label();
}
(function css(){ if(document.getElementById("sndcfg-css")) return;
  const s=document.createElement("style"); s.id="sndcfg-css"; s.textContent=`
  #sndcfg{position:fixed;left:20px;bottom:50px;z-index:9;background:none;border:0;cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:1.5px;color:var(--ink-dim);padding:6px 4px;transition:color .2s}
  #sndcfg:hover{color:var(--ink);text-shadow:0 0 12px rgba(var(--accent-rgb),.8)}
  @media(max-width:760px){ #sndcfg{bottom:calc(94px + var(--sat,0px))} }`;
  document.head.appendChild(s);
})();
