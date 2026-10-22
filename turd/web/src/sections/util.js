// ===========================================================================
// T.U.R.D. section kit — shared helpers for the at-a-glance sections.
// Every helper falls back gracefully if the shell's ctx doesn't provide it.
// ===========================================================================

export const LS = {
  get(k, d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
};
export const $  = (s,r=document)=>r.querySelector(s);
export const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
export const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function kit(ctx={}){
  return {
    LS: ctx.LS || LS,
    esc: ctx.esc || esc,
    toast: ctx.toast || (m=>console.log("[turd]",m)),
    show: ctx.show || (()=>{}),
    setLoc: ctx.setLoc || (t=>{ const el=document.getElementById("st-loc"); if(el) el.textContent=t; }),
    session: ctx.session || { user:"operator", role:"user" },
    // native builds can inject a CORS-free fetch (Capacitor / Tauri); web falls back to fetch
    http: ctx.http || ((url,opt)=>fetch(url,opt)),
  };
}

/* ------------------------------------------------------------ perf gates */
// Effective tier: the shell's live value (body[data-quality], includes its FPS governor),
// else the operator's saved pick, else the same first-run heuristic core uses.
const autoQ = ()=>{ const m=navigator.deviceMemory, c=navigator.hardwareConcurrency;
  if((m&&m<=2)||(c&&c<=2)) return "LOW";
  if(matchMedia("(hover: none)").matches || (c&&c<=4) || (m&&m<=4)) return "MED";
  return "HIGH"; };
export const quality = ()=> document.body?.dataset.quality || LS.get("turd_quality",null) || autoQ();
export const reducedMotion = ()=> matchMedia("(prefers-reduced-motion: reduce)").matches;
export const lowFx = ()=> quality()==="LOW" || reducedMotion();

/* ------------------------------------------------------------ 3D tilt
   Pointer-tracked perspective tilt + moving glare. Cheap: one rAF per move,
   transforms only, auto-disabled on LOW quality / reduced motion / touch. */
export function tilt(root, sel=".t-tilt", max=9){
  if(lowFx() || matchMedia("(hover: none)").matches) return ()=>{};
  const els=$$(sel,root), offs=[];
  els.forEach(el=>{
    if(!el.querySelector(":scope > .t-glare")){ const g=document.createElement("i"); g.className="t-glare"; el.appendChild(g); }
    let raf=0, px=0, py=0;
    const base = el.dataset.base || "";
    const move=e=>{
      if(e.pointerType==="touch") return;
      const r=el.getBoundingClientRect(); px=(e.clientX-r.left)/r.width-.5; py=(e.clientY-r.top)/r.height-.5;
      if(!raf) raf=requestAnimationFrame(()=>{ raf=0;
        el.style.transform=`${base} perspective(900px) rotateY(${px*max}deg) rotateX(${-py*max}deg) translateZ(14px)`;
        el.style.setProperty("--gx",(px+.5)*100+"%"); el.style.setProperty("--gy",(py+.5)*100+"%");
      });
    };
    const leave=()=>{ cancelAnimationFrame(raf); raf=0; el.style.transform=base; };
    el.addEventListener("pointermove",move); el.addEventListener("pointerleave",leave);
    if(base) el.style.transform=base;
    offs.push(()=>{ el.removeEventListener("pointermove",move); el.removeEventListener("pointerleave",leave); });
  });
  return ()=>offs.forEach(f=>f());
}

/* ------------------------------------------------------------ count-up numbers */
export function countUp(el, to, {dur=900, dec=0, suffix=""}={}){
  if(!el) return;
  if(lowFx() || !isFinite(to)){ el.textContent=(isFinite(to)?to.toFixed(dec):"—")+suffix; return; }
  const from=parseFloat(el.dataset.v||"0")||0, t0=performance.now();
  el.dataset.v=to;
  const step=now=>{ const k=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-k,3);
    el.textContent=(from+(to-from)*e).toFixed(dec)+suffix; if(k<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------ time helpers */
export const ago = t=>{
  const s=Math.round((Date.now()-t)/1000);
  if(s<45) return "just now"; if(s<3600) return Math.round(s/60)+"m ago";
  if(s<86400) return Math.round(s/3600)+"h ago"; return Math.round(s/86400)+"d ago";
};
export const dayKey = t=>{ const d=new Date(t); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
export const greeting = ()=>{ const h=new Date().getHours(); return h<5?"Late night":h<12?"Good morning":h<17?"Good afternoon":h<22?"Good evening":"Late night"; };

/* ------------------------------------------------------------ section header (matches shell .phead) */
export const head = (title,key,sub)=>
  `<div class="phead t-phead"><span class="k">${key}</span><h1>${title}</h1><span class="sub">${sub||""}</span></div>`;

/* ------------------------------------------------------------ scroll edge fades
   Overlays sit on the (non-scrolling) section above the panel's inner top and
   bottom edges and fade in only when there is more content that way. */
export function edgeFades(panel){
  const host=panel.parentElement; if(!host) return ()=>{};
  const top=document.createElement("div"), bot=document.createElement("div");
  top.className="t-fade top"; bot.className="t-fade bot"; host.append(top,bot);
  const place=()=>{
    // layout offsets (not getBoundingClientRect) so the section's enter transform can't skew placement
    const L=panel.offsetLeft, T=panel.offsetTop, W=panel.offsetWidth, H=panel.offsetHeight, rad=34;
    [top,bot].forEach(el=>{ el.style.left=(L+rad*.6)+"px"; el.style.width=(W-rad*1.2-10)+"px"; });
    top.style.top=(T+1)+"px"; bot.style.top=(T+H-1-bot.offsetHeight)+"px";
    top.classList.toggle("on", panel.scrollTop>8);
    bot.classList.toggle("on", panel.scrollTop+panel.clientHeight < panel.scrollHeight-8);
  };
  const ro=new ResizeObserver(place); ro.observe(panel);
  const mo=new MutationObserver(()=>requestAnimationFrame(place)); mo.observe(panel,{childList:true,subtree:false});
  panel.addEventListener("scroll",place,{passive:true}); addEventListener("resize",place);
  requestAnimationFrame(place); setTimeout(place,700);
  return ()=>{ ro.disconnect(); mo.disconnect(); panel.removeEventListener("scroll",place); removeEventListener("resize",place); top.remove(); bot.remove(); };
}
