// ===========================================================================
// NOW PLAYING — what the PC is playing (Spotify, YouTube in a browser, any app
// that shows up in Windows' volume flyout), with play/pause, skip and previous,
// and a small HUD visualizer driven by the PC's real speaker levels.
// Data: server/media.js on the PC (Server-Sent Events). On the PC the app talks
// to it locally; on the Fold over the home network with the chat login.
//
//   const stop = mountNowPlaying(el, ctx, { variant:"dock" | "card" });
//
// Renders nothing (el gets [hidden]) when nothing is playing, so it never
// clutters a screen. Admin only, like the server side.
// ===========================================================================

let up = null;
const loadUplink = ()=> up ??= import("../../uplink.js").then(m=>m.default||m).catch(()=>null);
const http = (...a)=> (window.TURD_HTTP || fetch)(...a);

const ICON = {
  prev:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" fill="currentColor"/></svg>`,
  next:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z" fill="currentColor"/></svg>`,
  play:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" fill="currentColor"/></svg>`,
  pause:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>`,
};
const mmss = s=>{ s = Math.max(0, Math.floor(s||0)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = String(s%60).padStart(2,"0"); return h ? `${h}:${String(m).padStart(2,"0")}:${x}` : `${m}:${x}`; };

export function mountNowPlaying(el, K, opts={}){
  const variant = opts.variant || "dock";
  let ep = "", tok = "", es = null, info = null, alive = true, pollT = 0, tickT = 0, raf = 0, retry = 0, lastLevelAt = 0, busy = false;
  let target = [0,0,0];                       // latest [peak,l,r] from the PC
  const N = variant === "card" ? 36 : 24;     // bars
  const bars = new Float32Array(N), seed = Float32Array.from({ length:N }, (_, i)=> 0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1));
  el.hidden = true; el.classList.add("np", "np-" + variant);

  function render(){
    if(!alive) return;
    const show = info && info.supported !== false && info.status && info.status !== "none" && info.status !== "error" && (info.title || info.artist);
    el.hidden = !show;
    if(!show){ stopAnim(); return; }
    try{ K.LS.set("turd_np_last", { title:info.title, artist:info.artist, app:info.app, playing:info.playing, t:Date.now() }); }catch(e){}
    const artSrc = info.art ? `${ep}/api/media/art?rev=${info.art}&token=${encodeURIComponent(tok)}` : "";
    const remote = info.local === false;
    if(!el.querySelector(".np-in")){
      el.innerHTML = `<div class="np-in">
        <div class="np-art"><i class="np-art-gen">♪</i><img alt="" decoding="async"></div>
        <div class="np-txt"><span class="np-k"></span><b class="np-title"></b><span class="np-sub"></span></div>
        <canvas class="np-viz" aria-hidden="true"></canvas>
        <div class="np-ctl">
          <button class="np-b" data-a="prev" aria-label="Previous">${ICON.prev}</button>
          <button class="np-b np-main" data-a="toggle" aria-label="Play or pause"></button>
          <button class="np-b" data-a="next" aria-label="Next">${ICON.next}</button>
        </div>
        <div class="np-prog"><i></i></div><span class="np-time"></span>
      </div>`;
      const im = el.querySelector(".np-art img");
      im.onload = ()=> im.classList.add("ok"); im.onerror = ()=>{ im.classList.remove("ok"); im.removeAttribute("src"); };
      el.querySelector(".np-ctl").onclick = e=>{ const b = e.target.closest("[data-a]"); if(b) control(b.dataset.a); };
      sizeCanvas();
    }
    el.classList.toggle("on", !!info.playing);
    el.querySelector(".np-k").innerHTML = (info.playing ? "Now playing" : "Paused") + (remote ? `<span class="np-host"> on ${K.esc(info.host || "PC")}</span>` : "");
    el.querySelector(".np-title").textContent = info.title || info.artist;
    el.querySelector(".np-sub").textContent = [info.title ? info.artist : "", info.app].filter(Boolean).join(" · ");
    el.querySelector(".np-main").innerHTML = info.playing ? ICON.pause : ICON.play;
    const can = info.can || {};
    el.querySelector('[data-a="prev"]').disabled = can.prev === false;
    el.querySelector('[data-a="next"]').disabled = can.next === false;
    const im = el.querySelector(".np-art img");
    if(artSrc && im.dataset.src !== artSrc){ im.classList.remove("ok"); im.dataset.src = artSrc; im.src = artSrc; }
    if(!artSrc){ im.classList.remove("ok"); im.removeAttribute("src"); im.dataset.src = ""; }
    progress();
    clearInterval(tickT); if(info.playing && info.duration) tickT = setInterval(progress, 1000);
    startAnim();
  }
  function pos(){ if(!info) return 0; const p = info.position + (info.playing ? (Date.now() - (info.at || Date.now()))/1000 : 0); return info.duration ? Math.min(p, info.duration) : p; }
  function progress(){
    const bar = el.querySelector(".np-prog i"), t = el.querySelector(".np-time"); if(!bar) return;
    const d = info && info.duration;
    bar.style.width = d ? (pos()/d*100).toFixed(2) + "%" : "0%";
    bar.parentElement.hidden = !d;
    t.textContent = d && d < 6*3600 ? `${mmss(pos())} / ${mmss(d)}` : "";
  }

  /* ---------------- visualizer: real speaker level → bars; light (canvas, ≤30fps, stops when hidden or paused) */
  let cv = null, cx = null, W = 0, H = 0, lastDraw = 0;
  function sizeCanvas(){
    cv = el.querySelector(".np-viz"); if(!cv) return; cx = cv.getContext("2d");
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr)); cv.width = W; cv.height = H;
  }
  const ro = new ResizeObserver(()=> sizeCanvas()); ro.observe(el);
  function startAnim(){ if(!raf && alive) raf = requestAnimationFrame(frame); }
  function stopAnim(){ cancelAnimationFrame(raf); raf = 0; }
  function frame(t){
    raf = 0; if(!alive || el.hidden || !el.isConnected) return;   // parked off-screen: sleep until np:show
    const low = document.body.dataset.quality === "LOW";
    if(t - lastDraw < (low ? 60 : 33)){ raf = requestAnimationFrame(frame); return; }
    lastDraw = t;
    // no live levels (stream fell back to polling, or the PC can't meter): a calm synthetic pulse
    let [pk, l, r] = target;
    if(Date.now() - lastLevelAt > 1500){ const s = t/1000; pk = info && info.playing ? 0.42 + 0.22*Math.pow(Math.max(0, Math.sin(s*4.1)), 4) + 0.08*Math.sin(s*1.7) : 0; l = r = pk; }
    if(!(info && info.playing)) pk = l = r = 0;
    let moving = false;
    for(let i = 0; i < N; i++){
      const side = i < N/2 ? l : r, x = i / (N-1);
      // bass-heavy shape, a slow ripple, and the per-bar seed so it reads like a spectrum
      const shape = 0.35 + 0.65 * Math.pow(1 - Math.abs(x - 0.5) * 1.6, 1.4);
      const ripple = 0.75 + 0.25 * Math.sin(t/180 + i * 0.9) * Math.sin(t/430 + i * 0.37);
      const want = Math.min(1, Math.max(0, Math.pow(Math.max(0, side), 0.7) * 1.9 * shape * ripple * seed[i]));   // speaker peaks sit around 0.2-0.6, so lift them
      const v = bars[i]; bars[i] = want > v ? v + (want - v) * 0.6 : v * 0.86;   // fast attack, soft fall
      if(bars[i] > 0.004) moving = true;
    }
    draw();
    if(moving || (info && info.playing)) raf = requestAnimationFrame(frame);
  }
  function draw(){
    if(!cx) return;
    cx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(el), acc = cs.getPropertyValue("--accent").trim() || "#4fd8ff";
    const gap = Math.max(2, W / N * 0.35), bw = (W - gap * (N - 1)) / N, mid = H / 2;
    const g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.5, acc); g.addColorStop(1, "rgba(255,255,255,.95)");
    cx.fillStyle = g;
    for(let i = 0; i < N; i++){
      const h = Math.max(H * 0.04, bars[i] * H * 0.96), x = i * (bw + gap);
      cx.globalAlpha = 0.35 + 0.65 * Math.min(1, bars[i] * 1.6);
      roundRect(x, mid - h/2, bw, h, Math.min(bw/2, 3));
    }
    cx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r){ cx.beginPath(); cx.moveTo(x+r, y); cx.arcTo(x+w, y, x+w, y+h, r); cx.arcTo(x+w, y+h, x, y+h, r); cx.arcTo(x, y+h, x, y, r); cx.arcTo(x, y, x+w, y, r); cx.fill(); }
  const onVis = ()=>{ if(document.hidden) stopAnim(); else if(info) startAnim(); };
  document.addEventListener("visibilitychange", onVis);
  const onShow = ()=>{ sizeCanvas(); if(info) startAnim(); };
  el.addEventListener("np:show", onShow);

  /* ---------------- data */
  function connect(){
    if(!alive) return;
    if(typeof EventSource !== "function") return poll();
    try{ es = new EventSource(`${ep}/api/media/stream?token=${encodeURIComponent(tok)}`); }catch(e){ return poll(); }
    es.addEventListener("info", e=>{ retry = 0; try{ const j = JSON.parse(e.data); info = { ...(info||{}), ...j, host: info && info.host }; render(); }catch(_){} });
    es.addEventListener("level", e=>{ try{ target = JSON.parse(e.data); lastLevelAt = Date.now(); if(!raf) startAnim(); }catch(_){} });
    es.onerror = ()=>{
      // browsers retry SSE on their own; after a few misses fall back to plain polling
      if(++retry >= 4){ try{ es.close(); }catch(_){} es = null; poll(); }
    };
  }
  async function fetchInfo(){
    const r = await http(`${ep}/api/media`, { headers:{ authorization:"Bearer " + tok }, cache:"no-store" });
    if(r.status === 404){ info = null; return render(); }     // PC app older than this feature
    const j = await r.json(); if(!j.ok){ info = null; return render(); }
    info = j; render();
  }
  function poll(){
    clearInterval(pollT);
    pollT = setInterval(()=> fetchInfo().catch(()=>{}), 3000);
    // keep trying to get the live stream back every minute
    setTimeout(()=>{ if(alive && !es){ clearInterval(pollT); pollT = 0; retry = 0; connect(); } }, 60000);
  }
  async function control(a){
    if(busy || !info) return; busy = true;
    if(a === "toggle"){ info.position = pos(); info.at = Date.now(); info.playing = !info.playing; render(); }    // feels instant
    try{
      const r = await http(`${ep}/api/media/control`, { method:"POST", headers:{ authorization:"Bearer " + tok, "content-type":"application/json" }, body:JSON.stringify({ action:a }) });
      const j = await r.json().catch(()=>({}));
      if(j && j.title !== undefined){ info = { ...info, ...j }; render(); }
      if(!j.ok && K.toast) K.toast(j.error || "The PC didn't take that");
    }catch(e){ K.toast && K.toast("Couldn't reach your PC"); }
    busy = false;
  }

  (async ()=>{
    if(!(K.session && K.session.role === "admin")) return;
    const u = await loadUplink(); if(!u || !alive) return;
    try{ if(u.ensureEndpoint) await u.ensureEndpoint(); }catch(e){}
    ep = (u.endpoint && u.endpoint()) || ""; tok = (u.token && u.token()) || "";
    if(!ep || !tok || !alive) return;
    try{ await fetchInfo(); }catch(e){}
    if(info && info.supported === false) return;       // server isn't on the Windows PC: stay hidden
    connect();
  })();

  return ()=>{
    alive = false; stopAnim(); clearInterval(pollT); clearInterval(tickT); ro.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    if(es){ try{ es.close(); }catch(e){} es = null; }
  };
}

// Home-tile helper: last thing seen playing on the PC (null if stale)
export function lastPlaying(LS){
  const n = LS && LS.get("turd_np_last", null);
  return n && n.playing && Date.now() - n.t < 5 * 60e3 ? n : null;
}
