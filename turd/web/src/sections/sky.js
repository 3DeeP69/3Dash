// ===========================================================================
// Live "sky window" — a 2D canvas behind the weather hero that renders the
// actual conditions: sun glow, star field + moon, drifting clouds, rain,
// snow, fog banks, lightning. Pauses when hidden; one static frame on LOW.
// ===========================================================================
import { lowFx, quality } from "./util.js";

export function sky(canvas, {kind="clear", isDay=true, wind=5}={}){
  const g=canvas.getContext("2d");
  const dpr=Math.min(devicePixelRatio||1, quality()==="HIGH" && !matchMedia("(hover: none)").matches ? 1.5 : 1);
  let W=0,H=0, raf=0, alive=true, flash=0;
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const touch = matchMedia("(hover: none)").matches;   // phones: big DPR, small GPU budget
  const density = (quality()==="HIGH"?1:quality()==="MED"?.55:.3) * (touch?.6:1);

  const size=()=>{ const r=canvas.getBoundingClientRect(); W=Math.max(1,r.width); H=Math.max(1,r.height);
    canvas.width=W*dpr; canvas.height=H*dpr; g.setTransform(dpr,0,0,dpr,0,0); };
  size();
  const ro=new ResizeObserver(size); ro.observe(canvas);

  const wet = kind==="rain"||kind==="storm", snowy = kind==="snow";
  const cloudy = kind!=="clear";
  const stars = Array.from({length:Math.round(140*density)},()=>({x:Math.random(),y:Math.random()*.8,r:rnd(.3,1.4),p:rnd(0,6.28)}));
  const clouds = Array.from({length:cloudy?Math.round((kind==="partly"?4:9)*Math.max(.5,density)):0},()=>({x:rnd(-.2,1.1),y:rnd(.02,.55),s:rnd(.6,1.5),v:rnd(.00004,.00012)*(1+wind/15)}));
  const parts = Array.from({length: wet?Math.round(260*density):snowy?Math.round(180*density):0},()=>({x:Math.random(),y:Math.random(),v:rnd(.6,1.2),l:rnd(8,18),r:rnd(1,2.6),p:rnd(0,6.28)}));
  const slant = Math.min(.5, wind/40);

  const pal = isDay
    ? (kind==="clear"?["#0d3b78","#1f6fc4","#5fb3ff"]: wet||kind==="storm"?["#0b1622","#1b2a3d","#33475f"]:["#14304f","#2d5680","#6d93bd"])
    : (kind==="clear"?["#02040c","#070d24","#12204a"]:["#03060d","#0a1222","#17233a"]);

  function cloudBlob(x,y,s,a){
    g.save(); g.globalAlpha=a; g.translate(x,y); g.scale(s,s);
    const c=isDay?"rgba(235,242,255,.85)":"rgba(120,140,175,.55)";
    const grad=g.createRadialGradient(0,0,5,0,0,90); grad.addColorStop(0,c); grad.addColorStop(1,"rgba(0,0,0,0)");
    g.fillStyle=grad;
    [[-50,8,60],[0,-10,75],[55,6,58],[20,18,62]].forEach(([dx,dy,r])=>{ g.beginPath(); g.arc(dx,dy,r,0,6.28); g.fill(); });
    g.restore();
  }

  function frame(t){
    const bg=g.createLinearGradient(0,0,0,H); bg.addColorStop(0,pal[0]); bg.addColorStop(.6,pal[1]); bg.addColorStop(1,pal[2]);
    g.fillStyle=bg; g.fillRect(0,0,W,H);

    if(!isDay && (kind==="clear"||kind==="partly")){
      stars.forEach(s=>{ g.globalAlpha=.4+.6*Math.abs(Math.sin(t*.001+s.p)); g.fillStyle="#fff";
        g.beginPath(); g.arc(s.x*W,s.y*H,s.r,0,6.28); g.fill(); });
      g.globalAlpha=1;
      const mx=W*.78,my=H*.28, mg=g.createRadialGradient(mx,my,4,mx,my,90);
      mg.addColorStop(0,"rgba(220,230,255,.9)"); mg.addColorStop(.2,"rgba(200,215,255,.25)"); mg.addColorStop(1,"rgba(0,0,0,0)");
      g.fillStyle=mg; g.beginPath(); g.arc(mx,my,90,0,6.28); g.fill();
      g.fillStyle="#eef3ff"; g.beginPath(); g.arc(mx,my,16,0,6.28); g.fill();
    }
    if(isDay && (kind==="clear"||kind==="partly")){
      const sx=W*.8, sy=H*.3, pulse=1+Math.sin(t*.0012)*.05;
      const sg=g.createRadialGradient(sx,sy,10,sx,sy,260*pulse);
      sg.addColorStop(0,"rgba(255,235,170,.95)"); sg.addColorStop(.12,"rgba(255,210,120,.45)"); sg.addColorStop(1,"rgba(255,200,120,0)");
      g.fillStyle=sg; g.fillRect(0,0,W,H);
      g.save(); g.translate(sx,sy); g.rotate(t*.00008); g.globalAlpha=.08; g.fillStyle="#fff";
      for(let i=0;i<12;i++){ g.rotate(Math.PI/6); g.beginPath(); g.moveTo(0,0); g.lineTo(W,-30); g.lineTo(W,30); g.fill(); }
      g.restore();
    }
    clouds.forEach(c=>{ c.x+=c.v*16; if(c.x>1.3) c.x=-.3; cloudBlob(c.x*W,c.y*H,c.s*(W/1100+.4),kind==="partly"?.75:.9); });

    if(kind==="fog"){
      for(let i=0;i<5;i++){ const y=H*(.35+i*.14), off=Math.sin(t*.0003+i)*60;
        const fg=g.createLinearGradient(0,y-40,0,y+40); fg.addColorStop(0,"rgba(200,215,235,0)"); fg.addColorStop(.5,"rgba(200,215,235,.22)"); fg.addColorStop(1,"rgba(200,215,235,0)");
        g.fillStyle=fg; g.fillRect(off-80,y-40,W+160,80); }
    }
    if(wet){
      g.strokeStyle=isDay?"rgba(190,220,255,.55)":"rgba(150,190,255,.45)"; g.lineWidth=1.2; g.beginPath();
      parts.forEach(p=>{ p.y+=p.v*.018; p.x+=slant*.012; if(p.y>1){ p.y=-.05; p.x=Math.random(); } if(p.x>1) p.x-=1;
        const x=p.x*W,y=p.y*H; g.moveTo(x,y); g.lineTo(x-slant*p.l,y+p.l); });
      g.stroke();
    }
    if(snowy){
      g.fillStyle="rgba(255,255,255,.85)";
      parts.forEach(p=>{ p.y+=p.v*.0025; p.p+=.02; const x=(p.x+Math.sin(p.p)*.01+slant*p.y*.1)*W; if(p.y>1){p.y=-.03;p.x=Math.random();}
        g.beginPath(); g.arc(x,p.y*H,p.r,0,6.28); g.fill(); });
    }
    if(kind==="storm"){
      if(flash<=0 && Math.random()<.004) flash=1;
      if(flash>0){ g.fillStyle=`rgba(220,230,255,${flash*.55})`; g.fillRect(0,0,W,H); flash-=.06; }
    }
    // helmet-glass curvature: darken edges, bright horizon line
    const v=g.createRadialGradient(W/2,H*1.1,H*.2,W/2,H*.6,Math.max(W,H)*.9);
    v.addColorStop(0,"rgba(0,0,0,0)"); v.addColorStop(1,"rgba(0,0,0,.55)");
    g.fillStyle=v; g.fillRect(0,0,W,H);
  }

  // HIGH draws every frame; MED caps at 30fps; LOW / reduced motion draws one still frame.
  // Off-screen (scrolled away, tab hidden) costs nothing.
  const step = quality()==="HIGH" ? 0 : 1000/30;
  let last=0, seen=true;
  const io=new IntersectionObserver(es=>{ seen=es[0].isIntersecting; }); io.observe(canvas);
  const loop=t=>{ if(!alive) return; raf=requestAnimationFrame(loop);
    if(document.hidden || !seen || t-last<step) return; last=t; frame(t); };
  if(lowFx()) frame(0); else raf=requestAnimationFrame(loop);
  return ()=>{ alive=false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
}
