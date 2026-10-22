// ===========================================================================
// ASSISTANT · the orb. A soft, living light: idle it breathes, while you type
// it leans in, while it thinks it swirls, while it talks it pulses with the
// words. 2D canvas, additive blobs — cheap, and it sleeps when hidden.
// ===========================================================================
export function createOrb(canvas, {lowFx=false}={}){
  const g=canvas.getContext("2d");
  let state="idle", level=0, target=0, raf=0, t0=performance.now(), rgb=[159,180,255], rgb2=[110,90,255], rgb3=[111,227,255], alive=true;
  const blobs=Array.from({length:7},(_,i)=>({ a:i/7*Math.PI*2, r:.22+.12*Math.sin(i*1.7), s:.18+.09*((i*37)%5)/5, k:.6+((i*53)%7)/10, ph:i*1.3 }));
  const speed={ idle:.35, listen:.6, think:1.9, speak:1.0, error:.25 };
  let sp=.35;

  function size(){ const d=Math.min(2,devicePixelRatio||1), w=canvas.clientWidth||100, h=canvas.clientHeight||100; if(canvas.width!==Math.round(w*d)){ canvas.width=Math.round(w*d); canvas.height=Math.round(h*d); } return [canvas.width,canvas.height]; }
  function frame(now){
    if(!alive) return;
    const [W,H]=size(), t=(now-t0)/1000, cx=W/2, cy=H/2, R=Math.min(W,H)/2;
    sp+= (speed[state]-sp)*.04; level+=(target-level)*.18; target*=.92;
    g.clearRect(0,0,W,H);
    // halo
    const breathe = state==="idle" ? .5+.5*Math.sin(t*1.1) : state==="think" ? .7+.3*Math.sin(t*4) : .6+level*.6;
    let gr=g.createRadialGradient(cx,cy,R*.1,cx,cy,R);
    gr.addColorStop(0,`rgba(${rgb},${.20+.12*breathe})`); gr.addColorStop(.55,`rgba(${rgb2},${.08+.06*breathe})`); gr.addColorStop(1,"rgba(0,0,0,0)");
    g.fillStyle=gr; g.fillRect(0,0,W,H);
    // glass sphere: plasma blobs swirl inside a clipped body with a lit rim
    const SR=R*.5;
    g.save(); g.beginPath(); g.arc(cx,cy,SR,0,Math.PI*2); g.clip();
    let body=g.createRadialGradient(cx-SR*.3,cy-SR*.35,SR*.1,cx,cy,SR);
    body.addColorStop(0,`rgba(${rgb},.16)`); body.addColorStop(1,`rgba(${rgb2},.08)`);
    g.fillStyle=body; g.fillRect(cx-SR,cy-SR,SR*2,SR*2);
    g.globalCompositeOperation="lighter";
    const rot=t*sp;
    for(const b of blobs){
      const a=b.a+rot*b.k, wob=Math.sin(t*1.3*b.k+b.ph);
      const rr=SR*(b.r*2.3+.1*wob+(state==="speak"?level*.15:0)+(state==="think"?.08*Math.sin(t*3+b.ph):0));
      const x=cx+Math.cos(a)*rr*.75, y=cy+Math.sin(a*1.12)*rr*.65;
      const br=SR*(b.s*2.2+(state==="listen"?.08:0)+level*.14);
      const c=[rgb,rgb2,rgb3][Math.floor(b.ph/1.3)%3];
      const bg=g.createRadialGradient(x,y,0,x,y,br);
      bg.addColorStop(0,`rgba(${c},.62)`); bg.addColorStop(.55,`rgba(${c},.16)`); bg.addColorStop(1,`rgba(${c},0)`);
      g.fillStyle=bg; g.beginPath(); g.arc(x,y,br,0,Math.PI*2); g.fill();
    }
    // inner core
    const core=SR*(.16+.05*breathe+level*.14);
    gr=g.createRadialGradient(cx,cy,0,cx,cy,core*1.6);
    gr.addColorStop(0,"rgba(255,255,255,.7)"); gr.addColorStop(.4,`rgba(${rgb},.45)`); gr.addColorStop(1,`rgba(${rgb},0)`);
    g.fillStyle=gr; g.beginPath(); g.arc(cx,cy,core*1.6,0,Math.PI*2); g.fill();
    g.restore();
    // rim light + specular glint
    g.globalCompositeOperation="lighter";
    const rim=g.createLinearGradient(cx-SR,cy-SR,cx+SR,cy+SR);
    rim.addColorStop(0,`rgba(255,255,255,${.55+.2*breathe})`); rim.addColorStop(.5,`rgba(${rgb},.18)`); rim.addColorStop(1,`rgba(${rgb2},${.45+.2*breathe})`);
    g.strokeStyle=rim; g.lineWidth=Math.max(1,SR*.035); g.beginPath(); g.arc(cx,cy,SR*.985,0,Math.PI*2); g.stroke();
    const sp2=g.createRadialGradient(cx-SR*.38,cy-SR*.45,0,cx-SR*.38,cy-SR*.45,SR*.32);
    sp2.addColorStop(0,"rgba(255,255,255,.35)"); sp2.addColorStop(1,"rgba(255,255,255,0)");
    g.fillStyle=sp2; g.beginPath(); g.arc(cx-SR*.38,cy-SR*.45,SR*.32,0,Math.PI*2); g.fill();
    // thinking: thin orbit arcs around the sphere
    if(sp>.8){ g.strokeStyle=`rgba(255,255,255,${Math.min(.5,(sp-.8)*.5)})`; g.lineWidth=Math.max(1,R*.012);
      g.beginPath(); g.arc(cx,cy,SR*1.18,rot*2.2,rot*2.2+Math.PI*.7); g.stroke(); g.beginPath(); g.arc(cx,cy,SR*1.32,-rot*1.6,-rot*1.6+Math.PI*.45); g.stroke(); }
    g.globalCompositeOperation="source-over";
    raf = lowFx ? 0 : requestAnimationFrame(frame);
  }
  const vis=()=>{ if(document.hidden){ cancelAnimationFrame(raf); raf=0; } else if(!raf && alive && !lowFx) raf=requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange",vis);
  raf=requestAnimationFrame(frame);
  const hex=h=>{ const m=String(h).trim().match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i); return m?[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)]:null; };
  return {
    set(s){ state=s; if(lowFx) requestAnimationFrame(frame); },
    pulse(v=1){ target=Math.min(1,target+v); },
    colors(a,b){ rgb=hex(a)||rgb; rgb2=hex(b)||rgb2; },
    redraw(){ requestAnimationFrame(frame); },
    destroy(){ alive=false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange",vis); },
  };
}
