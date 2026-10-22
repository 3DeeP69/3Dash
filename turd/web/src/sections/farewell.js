// ===========================================================================
// BEFORE YOU GO — full-screen sign-off recap shown when the operator logs out.
//
//   const go = await (await import("./sections/farewell.js")).beforeYouGo(ctx);
//   if (go) { /* sign out */ }
//
// Resolves true on "Log out" (Enter / ✕ / gamepad A) and false on "Stay"
// (Esc / ○ / gamepad B / tapping outside). Shows today's log, tasks finished,
// what's still open, events done today, tomorrow's weather + first event, a
// last-note box, and (admin) whether the PC is still running things.
// Self-contained: own overlay + CSS, reads local data only (plus one weather
// refresh if the cache is stale). Free, no new APIs.
// ===========================================================================
import { LS, esc, dayKey, lowFx } from "./util.js";
import { cached as wxCached, load as wxLoad, wmo } from "./wxdata.js";
import { wxIcon } from "./icons.js";
import { CATS, entries } from "./logbook.js";

const DAY = 864e5;
let openP = null;

const tagsOf = s=> [...new Set((String(s).match(/#[\p{L}\p{N}_-]{1,30}/gu)||[]).map(t=>t.slice(1).toLowerCase()))];
const plain = s=> String(s||"").replace(/\*\*(.+?)\*\*/g,"$1").replace(/`([^`]+)`/g,"$1").replace(/\s+/g," ").trim();
const tm = t=> new Date(t).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
const sod = (t=Date.now())=>{ const d=new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
const signoff = ()=>{ const h=new Date().getHours(); return h<5?"Get some sleep":h<12?"Have a good day":h<17?"Have a good afternoon":h<22?"Have a good night":"Get some sleep"; };

/* ------------------------------------------------------------ data */
let calMod;
const loadCal=()=> calMod ??= import("../community/calendar.js").catch(()=>null);
function calFrom(m){
  if(!m?.expand) return null;
  const evs=LS.get("turd_cal_cache",[]);
  const t0=sod(), t1=t0+DAY, t2=t1+DAY, now=Date.now();
  const occ=m.expand(evs, t0, t2);
  const today=occ.filter(o=>o.s<t1 && o.e>t0 && !(o.ev.allDay && o.s<t0));
  return {
    done: today.filter(o=>o.e<=now),
    later: today.filter(o=>o.e>now),
    tomorrow: occ.filter(o=>o.s>=t1 && o.s<t2),
    color: o=> (m.CATS?.[o.ev.cat]?.color)||"#8fb6ff",
  };
}
// let the calendar store sync once (local or server); an already-synced store just times out
const calSync = m=> !m?.subscribe ? Promise.resolve() : new Promise(r=>{ let off=()=>{}; const t=setTimeout(()=>{ off(); r(); },1500); off=m.subscribe(()=>{ clearTimeout(t); off(); r(); }); });

function wxFrom(w){
  const d=w?.data?.daily; if(!d || d.time.length<2) return null;
  const [label,kind]=wmo(d.weather_code[1]);
  return { label, kind, hi:Math.round(d.temperature_2m_max[1]), lo:Math.round(d.temperature_2m_min[1]),
    rain:d.precipitation_probability_max?.[1] ?? null, sunrise:d.sunrise?.[1] ? d.sunrise[1]*1000 : null,
    U:w.units==="F"?"°":"°C", loc:w.loc?.name||"", alerts:(w.alerts||[]).slice(0,2) };
}
const wxStale = w=> !w || Date.now()-w.t>3*3600e3;
const wxFresh = http=> Promise.race([wxLoad(http), new Promise((_,r)=>setTimeout(()=>r(new Error("slow")),3500))]).catch(()=>null);

function logbook(){
  const l=entries(LS), t0=sod();
  const today=l.filter(e=>e.t>=t0).sort((a,b)=>b.t-a.t);
  const doneToday=l.filter(e=>e.cat==="task" && e.done && (e.doneAt||0)>=t0);
  const open=l.filter(e=>e.cat==="task" && !e.done).sort((a,b)=>(b.pinned-a.pinned)||(b.t-a.t));
  const days=new Set(l.map(e=>dayKey(e.t))); let streak=0; const d=new Date(); if(!days.has(dayKey(Date.now()))) d.setDate(d.getDate()-1);
  while(days.has(dayKey(d.getTime()))){ streak++; d.setDate(d.getDate()-1); }
  return { today, doneToday, open, streak };
}

function pcLine(ctx){
  if(ctx?.session?.role!=="admin") return "";
  const p=LS.get("turd_pc_last",null); if(!p || Date.now()-p.t>3*60e3) return "";
  const bits=[];
  if(p.ollama?.up) bits.push(`Ollama is running${p.ollama.models?.[0]?` (${esc(p.ollama.models[0])} loaded)`:""}`);
  if(p.cpu?.pct!=null && p.cpu.pct>=50) bits.push(`CPU is at ${p.cpu.pct}%`);
  if(p.chat?.online>1) bits.push(`${p.chat.online} people are still in chat`);
  return `<div class="fw-pc"><i class="fw-dot"></i><span><b>${esc(p.host||"Your PC")}</b> is still on${bits.length?". "+bits.join(", ")+".":"."} It stays up for chat and the assistant.</span></div>`;
}

/* ------------------------------------------------------------ view */
function row(e){ const c=CATS[e.cat]||CATS.note;
  return `<li style="--cc:${c.color}"><span class="fw-g">${c.glyph}</span><span class="fw-t">${esc(plain(e.txt).slice(0,90))}</span><time>${tm(e.t)}</time></li>`; }
function evRow(o, color, past){
  return `<li class="${past?"past":""}" style="--cc:${color(o)}"><span class="fw-g">●</span><span class="fw-t">${esc(o.ev.title)}</span><time>${o.ev.allDay?"all day":tm(o.s)}</time></li>`; }

function html(ctx, L, C, W){
  const user=ctx?.session?.user || "operator";
  const h=new Date().getHours(), part=h<5?"Late night":h<12?"This morning":h<17?"This afternoon":h<22?"Tonight":"Late night";
  const n=L.today.length, dn=L.doneToday.length, ev=C?C.done.length:0;
  const headline = n||dn||ev
    ? `${n?`${n} ${n===1?"entry":"entries"} logged`:""}${n&&(dn||ev)?", ":""}${dn?`${dn} task${dn===1?"":"s"} finished`:""}${dn&&ev?", ":""}${ev?`${ev} event${ev===1?"":"s"} done`:""}.`
    : "A quiet one today. Nothing logged yet.";
  const tomEv=C?.tomorrow?.[0];
  const firstUp = tomEv ? `${esc(tomEv.ev.title)} ${tomEv.ev.allDay?"(all day)":"at "+tm(tomEv.s)}` : null;

  return `<div class="fw-visor" role="dialog" aria-modal="true" aria-labelledby="fwTitle">
  <div class="fw-head">
    <span class="fw-k">SIGN-OFF</span>
    <div><h1 id="fwTitle">Before you go</h1><p>${esc(part)}, ${esc(user)}. ${esc(headline)}</p></div>
    <span class="fw-clock">${new Date().toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"})} · ${tm(Date.now())}</span>
  </div>

  <div class="fw-grid">
    <section class="fw-col" style="--d:1">
      <h2>Today</h2>
      <div class="fw-stats">
        <div><b>${n}</b><em>logged</em></div>
        <div><b>${dn}</b><em>tasks done</em></div>
        <div><b>${L.streak}</b><em>day streak</em></div>
      </div>
      ${n?`<ul class="fw-list">${L.today.slice(0,4).map(row).join("")}</ul>${n>4?`<p class="fw-more">+${n-4} more in the Logbook</p>`:""}`:`<p class="fw-empty">Nothing in the Logbook today. Add a line below so tomorrow-you knows where you left off.</p>`}
      ${C&&(C.done.length||C.later.length)?`<h3>Calendar</h3><ul class="fw-list">${C.done.slice(0,3).map(o=>evRow(o,C.color,true)).join("")}${C.later.slice(0,2).map(o=>evRow(o,C.color,false)).join("")}</ul>`:""}
    </section>

    <section class="fw-col" style="--d:2">
      <h2>Still open <span>${L.open.length||""}</span></h2>
      ${L.open.length?`<ul class="fw-list fw-tasks">${L.open.slice(0,6).map(e=>`<li><button class="fw-check" data-id="${esc(e.id)}" aria-label="Mark done"></button><span class="fw-t">${esc(plain(e.txt).slice(0,90))}</span></li>`).join("")}</ul>
        ${L.open.length>6?`<p class="fw-more">+${L.open.length-6} more</p>`:""}`
        :`<p class="fw-empty fw-clear">✓ Nothing open. Clean slate for tomorrow.</p>`}
    </section>

    <section class="fw-col" style="--d:3">
      <h2>Tomorrow</h2>
      ${W?`<div class="fw-wx">${wxIcon(W.kind,true,72)}<div><b>${W.hi}${W.U}<small> / ${W.lo}${W.U}</small></b><span>${esc(W.label)}${W.rain!=null&&W.rain>=20?` · ${W.rain}% rain`:""}</span>${W.loc?`<em>${esc(W.loc)}</em>`:""}</div></div>
        ${W.rain!=null&&W.rain>=50?`<p class="fw-tip">☂ Rain is likely tomorrow. Grab an umbrella.</p>`:""}
        ${W.alerts.map(a=>`<p class="fw-alert">▲ ${esc(a.event)}</p>`).join("")}`
        :`<p class="fw-empty">No forecast cached yet. Open Weather once and it will show here.</p>`}
      <ul class="fw-facts">
        <li><em>First up</em><span>${firstUp||"Nothing on the calendar"}</span></li>
        ${W?.sunrise?`<li><em>Sunrise</em><span>${tm(W.sunrise)}</span></li>`:""}
        ${C&&C.tomorrow.length>1?`<li><em>Events</em><span>${C.tomorrow.length} on the calendar</span></li>`:""}
      </ul>
    </section>
  </div>

  ${pcLine(ctx)}

  <div class="fw-foot">
    <label class="fw-note"><span>One last note</span><input id="fwNote" maxlength="400" placeholder="Where you left off, what to do first tomorrow…" autocomplete="off"><kbd>↵</kbd></label>
    <div class="fw-btns">
      <button class="fw-btn stay" id="fwStay"><i class="ps o">○</i>Stay signed in</button>
      <button class="fw-btn go" id="fwGo"><i class="ps x">✕</i>⏻ Log out</button>
    </div>
  </div>
  <p class="fw-bye">${esc(signoff())}, ${esc(user)}.</p>
</div>`;
}

/* ------------------------------------------------------------ public */
export function beforeYouGo(ctx={}){
  if(openP) return openP;
  injectCSS();
  const root=document.createElement("div");
  root.className="fw-root"+(lowFx()?" fw-low":"");
  root.innerHTML=`<div class="fw-scan"></div>`;
  document.body.appendChild(root);
  window.TURD_OVERLAY=true;
  const prevFocus=document.activeElement;

  openP=new Promise(async resolve=>{
    let done=false;
    // paint at once from local data, then refresh calendar + weather in the background
    const cal=await loadCal();
    let C=calFrom(cal), w0=wxCached();
    root.insertAdjacentHTML("beforeend", html(ctx,logbook(),C,wxFrom(w0)));
    Promise.all([calSync(cal), wxStale(w0)?wxFresh(ctx.http||fetch):null]).then(([,w1])=>{
      if(done || !root.isConnected) return;
      const tmp=document.createElement("div"); tmp.innerHTML=html(ctx,logbook(),calFrom(cal),wxFrom(w1||w0));
      const g=root.querySelector(".fw-grid"), ng=tmp.querySelector(".fw-grid"), p=root.querySelector(".fw-head p"), np=tmp.querySelector(".fw-head p");
      if(g && ng && g.innerHTML!==ng.innerHTML && !g.contains(document.activeElement)){ g.innerHTML=ng.innerHTML; }
      if(p && np) p.textContent=np.textContent;
    });
    requestAnimationFrame(()=>root.classList.add("in"));
    const $=s=>root.querySelector(s);
    const note=$("#fwNote"), go=$("#fwGo");
    setTimeout(()=>go.focus({preventScroll:true}), lowFx()?0:420);

    const saveNote=()=>{ const v=note.value.trim(); if(!v) return false;
      const l=entries(LS); l.push({id:"e"+Date.now().toString(36), t:Date.now(), txt:v, cat:"note", tags:[...new Set(["signoff",...tagsOf(v)])], pinned:false, done:false});
      LS.set("turd_log",l); note.value=""; note.placeholder="Saved to the Logbook ✓"; return true; };
    const finish=leave=>{
      if(done) return; done=true;
      saveNote();
      removeEventListener("keydown",onKey,true); cancelAnimationFrame(pad);
      root.classList.add(leave?"out-go":"out-stay");
      setTimeout(()=>{ root.remove(); window.TURD_OVERLAY=false; openP=null; if(!leave) prevFocus?.focus?.({preventScroll:true}); resolve(leave); }, lowFx()?0:(leave?620:280));
    };

    root.addEventListener("click",e=>{
      if(e.target===root) return finish(false);
      const c=e.target.closest(".fw-check");
      if(c){ const l=entries(LS), it=l.find(x=>x.id===c.dataset.id);
        if(it){ it.done=true; it.doneAt=Date.now(); LS.set("turd_log",l); }
        c.closest("li").classList.add("done"); c.textContent="✓"; ctx.toast?.("task complete ✓"); }
    });
    $("#fwStay").onclick=()=>finish(false);
    go.onclick=()=>finish(true);

    // keys: captured so the shell's [ ] / PageUp / PageDown don't flip sections behind the screen
    const focusables=()=>[...root.querySelectorAll("button,input")].filter(b=>!b.closest("li.done"));
    function onKey(e){
      const inNote=e.target===note;
      if(e.key==="Escape"){ e.preventDefault(); e.stopImmediatePropagation(); return finish(false); }
      if(inNote && e.key==="Enter"){ e.preventDefault(); e.stopImmediatePropagation(); if(saveNote()) ctx.toast?.("noted in the Logbook ✎"); return; }
      if(e.key==="Tab"){ const f=focusables(); if(!f.length) return; const i=f.indexOf(document.activeElement);
        if(e.shiftKey && i<=0){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey && i===f.length-1){ e.preventDefault(); f[0].focus(); } }
      if(!inNote) e.stopImmediatePropagation();
      if(!inNote && ["[","]","PageUp","PageDown"].includes(e.key)) e.preventDefault();
    }
    addEventListener("keydown",onKey,true);

    // gamepad: A / Cross = log out, B / Circle = stay, D-pad moves focus
    const prev={}; let pad=0;
    const poll=()=>{
      const ps=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
      for(const p of ps){ const hit=n=>{ const on=!!p.buttons[n]?.pressed, k=p.index+":"+n, was=prev[k]; prev[k]=on; return on&&!was; };
        if(hit(0)){ const a=document.activeElement; if(a&&root.contains(a)&&a!==note) a.click(); else finish(true); }
        if(hit(1)) finish(false);
        const f=focusables(), i=f.indexOf(document.activeElement);
        if(hit(15)||hit(13)) f[(i+1)%f.length]?.focus(); if(hit(14)||hit(12)) f[(i-1+f.length)%f.length]?.focus(); }
      pad=requestAnimationFrame(poll);
    };
    // swallow buttons already held when the screen opened
    (navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[]).forEach(p=>p.buttons.forEach((b,n)=>prev[p.index+":"+n]=b.pressed));
    pad=requestAnimationFrame(poll);
  });
  return openP;
}
export default { beforeYouGo };

/* ------------------------------------------------------------ styles */
function injectCSS(){
  if(document.getElementById("fw-css")) return;
  const s=document.createElement("style"); s.id="fw-css";
  s.textContent=`
.fw-root{--fa:#7d8bff;--fa-rgb:125,139,255;--fw2:#ff9a5a;position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:max(24px,var(--sat,0px)) 24px max(24px,var(--sab,0px));
  background:radial-gradient(120% 90% at 50% 120%,rgba(255,120,60,.18),transparent 55%),radial-gradient(90% 70% at 50% 0%,rgba(var(--fa-rgb),.20),transparent 60%),rgba(2,4,12,.86);
  backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2);opacity:0;transition:opacity .35s ease;color:var(--ink,#dbe9ff);font-family:var(--font,system-ui);overflow:auto;perspective:1400px}
.fw-root.in{opacity:1}
.fw-scan{position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0 1px,transparent 1px 3px);mix-blend-mode:overlay}
.fw-visor{position:relative;width:min(1180px,100%);border-radius:46px/38px;padding:34px 40px 26px;
  background:linear-gradient(180deg,rgba(20,26,58,.72),rgba(8,10,26,.82));border:1.5px solid rgba(var(--fa-rgb),.55);
  box-shadow:0 0 0 1px rgba(255,255,255,.04) inset,0 30px 120px rgba(0,0,0,.6),0 0 60px rgba(var(--fa-rgb),.22),inset 0 0 80px rgba(var(--fa-rgb),.10);
  transform:translateY(40px) scale(.94) rotateX(10deg);opacity:0;transition:transform .6s cubic-bezier(.2,.9,.25,1.05),opacity .45s ease}
.fw-visor::before{content:"";position:absolute;inset:8px;border-radius:40px/32px;border:1px solid rgba(var(--fa-rgb),.16);pointer-events:none}
.fw-visor::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(70% 38% at 50% 0%,rgba(255,255,255,.07),transparent 70%),radial-gradient(40% 30% at 12% 8%,rgba(var(--fa-rgb),.10),transparent 70%)}
.fw-root.in .fw-visor{transform:none;opacity:1}
.fw-head{display:flex;align-items:flex-start;gap:18px;padding-bottom:18px;border-bottom:1px solid rgba(var(--fa-rgb),.25)}
.fw-k{font-family:var(--mono,monospace);font-size:11px;letter-spacing:2px;color:var(--fa);border:1px solid rgba(var(--fa-rgb),.4);padding:4px 9px;border-radius:6px;margin-top:8px;white-space:nowrap}
.fw-head h1{margin:0;font-size:clamp(28px,4vw,46px);font-weight:700;letter-spacing:5px;text-transform:uppercase;line-height:1.05;
  background:linear-gradient(90deg,#fff,#c9d0ff 55%,var(--fw2));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(var(--fa-rgb),.45))}
.fw-head p{margin:8px 0 0;font-size:18px;color:#c3cdf0;letter-spacing:.4px}
.fw-clock{margin-left:auto;font-family:var(--mono,monospace);font-size:12px;color:var(--ink-dim,#7d93b8);letter-spacing:1px;white-space:nowrap;margin-top:10px}
.fw-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:0;margin-top:20px}
.fw-col{padding:4px 26px;min-width:0;border-left:1px solid rgba(var(--fa-rgb),.16);opacity:0;transform:translateY(14px);transition:opacity .5s ease calc(.18s + var(--d)*.09s),transform .5s ease calc(.18s + var(--d)*.09s)}
.fw-col:first-child{border-left:0;padding-left:0}.fw-col:last-child{padding-right:0}
.fw-root.in .fw-col{opacity:1;transform:none}
.fw-col h2{margin:0 0 14px;font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--fa);display:flex;gap:10px;align-items:center}
.fw-col h2 span{color:var(--fw2)}
.fw-col h3{margin:18px 0 8px;font-family:var(--mono,monospace);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:var(--ink-dim,#7d93b8);font-weight:500}
.fw-stats{display:flex;gap:26px;margin-bottom:16px}
.fw-stats b{display:block;font-size:40px;line-height:1;font-weight:700;color:#fff;text-shadow:0 0 22px rgba(var(--fa-rgb),.6)}
.fw-stats em{font-style:normal;font-family:var(--mono,monospace);font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--ink-dim,#7d93b8)}
.fw-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.fw-list li{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:16px;min-width:0}
.fw-list li.past .fw-t{color:var(--ink-dim,#7d93b8);text-decoration:line-through;text-decoration-color:rgba(255,255,255,.25)}
.fw-g{color:var(--cc,var(--fa));width:16px;text-align:center;flex:none;font-size:13px}
.fw-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fw-list time{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-dim,#7d93b8);flex:none}
.fw-check{flex:none;width:20px;height:20px;border-radius:6px;border:1.5px solid rgba(var(--fa-rgb),.7);background:transparent;color:#0b0f22;cursor:pointer;font-size:13px;font-weight:800;line-height:1;padding:0;transition:.2s}
.fw-check:hover,.fw-check:focus-visible{background:rgba(var(--fa-rgb),.25);outline:none;box-shadow:0 0 0 3px rgba(var(--fa-rgb),.25)}
.fw-tasks li.done .fw-check{background:var(--ok,#49f6b0);border-color:var(--ok,#49f6b0)}
.fw-tasks li.done .fw-t{color:var(--ink-dim,#7d93b8);text-decoration:line-through}
.fw-tasks li{transition:opacity .4s}.fw-tasks li.done{opacity:.55}
.fw-more,.fw-empty{margin:8px 0 0;font-size:14px;color:var(--ink-dim,#7d93b8);line-height:1.5}
.fw-clear{color:var(--ok,#49f6b0);font-size:16px}
.fw-wx{display:flex;align-items:center;gap:14px}
.fw-wx svg{flex:none;filter:drop-shadow(0 0 14px rgba(var(--fa-rgb),.35))}
.fw-wx b{display:block;font-size:38px;line-height:1;font-weight:700;color:#fff}.fw-wx b small{font-size:20px;color:var(--ink-dim,#7d93b8);font-weight:500}
.fw-wx span{display:block;font-size:16px;margin-top:4px}.fw-wx em{display:block;font-style:normal;font-family:var(--mono,monospace);font-size:10px;letter-spacing:1.4px;color:var(--ink-dim,#7d93b8);margin-top:3px;text-transform:uppercase}
.fw-tip{margin:12px 0 0;font-size:14px;color:#9fd8ff}.fw-alert{margin:8px 0 0;font-size:14px;color:var(--bad,#ff5c7a)}
.fw-facts{list-style:none;margin:16px 0 0;padding:0}
.fw-facts li{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);font-size:15px}
.fw-facts em{font-style:normal;font-family:var(--mono,monospace);font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--ink-dim,#7d93b8);padding-top:3px;flex:none}
.fw-facts span{text-align:right;min-width:0}
.fw-pc{display:flex;gap:10px;align-items:center;margin-top:20px;padding:10px 0 0;border-top:1px solid rgba(var(--fa-rgb),.16);font-size:14px;color:#b9c4e6}
.fw-dot{width:8px;height:8px;border-radius:50%;background:var(--ok,#49f6b0);box-shadow:0 0 10px var(--ok,#49f6b0);flex:none}
.fw-foot{display:flex;gap:18px;align-items:center;margin-top:22px;padding-top:18px;border-top:1px solid rgba(var(--fa-rgb),.25)}
.fw-note{flex:1;display:flex;align-items:center;gap:12px;min-width:0;border-bottom:1px solid rgba(var(--fa-rgb),.35);padding:4px 0}
.fw-note span{font-family:var(--mono,monospace);font-size:10px;letter-spacing:1.8px;text-transform:uppercase;color:var(--fa);white-space:nowrap}
.fw-note input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--ink,#dbe9ff);font:inherit;font-size:16px;padding:6px 0}
.fw-note input::placeholder{color:#5d6a92}
.fw-note:focus-within{border-color:var(--fa);box-shadow:0 1px 0 var(--fa)}
.fw-note kbd{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-dim,#7d93b8);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:1px 6px}
.fw-btns{display:flex;gap:12px;flex:none}
.fw-btn{display:inline-flex;align-items:center;gap:10px;font-family:var(--mono,monospace);font-size:13px;letter-spacing:1.8px;text-transform:uppercase;cursor:pointer;
  color:var(--ink,#dbe9ff);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);padding:12px 20px;border-radius:14px;transition:transform .15s,background .2s,box-shadow .2s,border-color .2s}
.fw-btn:hover,.fw-btn:focus-visible{outline:none;transform:translateY(-1px);border-color:rgba(var(--fa-rgb),.7);box-shadow:0 0 0 3px rgba(var(--fa-rgb),.18)}
.fw-btn.go{color:#fff;background:linear-gradient(180deg,rgba(var(--fa-rgb),.55),rgba(60,70,200,.55));border-color:rgba(var(--fa-rgb),.9);box-shadow:0 0 26px rgba(var(--fa-rgb),.35)}
.fw-btn.go:hover,.fw-btn.go:focus-visible{box-shadow:0 0 0 3px rgba(var(--fa-rgb),.35),0 0 36px rgba(var(--fa-rgb),.55)}
.ps{font-style:normal;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:11px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18)}
.ps.x{color:#8fb6ff}.ps.o{color:#ff7a8a}
.fw-bye{position:absolute;left:0;right:0;bottom:-34px;text-align:center;margin:0;font-family:var(--mono,monospace);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,210,255,.45)}
/* leave: visor powers down like a CRT */
.fw-root.out-stay{opacity:0;transition:opacity .25s ease}.fw-root.out-stay .fw-visor{transform:translateY(20px) scale(.97);opacity:0;transition:.25s ease}
.fw-root.out-go .fw-visor{animation:fwOff .6s cubic-bezier(.6,0,.4,1) forwards}
.fw-root.out-go{animation:fwFade .6s ease forwards}
@keyframes fwOff{0%{transform:none;filter:none}45%{transform:scaleY(.012) scaleX(1);filter:brightness(2.4);opacity:1}80%{transform:scaleY(.008) scaleX(.04);filter:brightness(3);opacity:1}100%{transform:scale(0);opacity:0}}
@keyframes fwFade{0%,55%{background-color:rgba(2,4,12,.86)}100%{background-color:#000}}
.fw-low .fw-visor,.fw-low .fw-col{transition:none!important;transform:none!important}
.fw-low{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(2,4,12,.95)}
.fw-low .fw-scan{display:none}
@media (hover:none){.fw-root{backdrop-filter:none;-webkit-backdrop-filter:none;background:radial-gradient(120% 90% at 50% 120%,rgba(255,120,60,.16),transparent 55%),rgba(2,4,12,.94)}}
@media (max-width:980px){
  .fw-root{place-items:start center;padding:max(14px,var(--sat,0px)) 12px max(40px,var(--sab,0px))}
  .fw-visor{padding:24px 20px 20px;border-radius:30px/26px}.fw-visor::before{border-radius:24px/20px}
  .fw-head{flex-wrap:wrap;gap:10px}.fw-clock{margin:0;flex-basis:100%;order:3}.fw-head p{font-size:16px}
  .fw-grid{grid-template-columns:1fr}
  .fw-col{border-left:0;padding:16px 0;border-top:1px solid rgba(var(--fa-rgb),.16)}.fw-col:first-child{border-top:0}
  .fw-foot{flex-direction:column;align-items:stretch}.fw-btns{flex-direction:column-reverse}.fw-btn{justify-content:center;padding:14px}
  .fw-bye{position:static;margin-top:14px}
}
@media (max-height:760px) and (min-width:981px){.fw-root{place-items:start center}.fw-visor{padding:24px 32px 20px}.fw-head h1{font-size:34px}.fw-stats b{font-size:32px}.fw-bye{position:static;margin-top:12px}}
@media (prefers-reduced-motion:reduce){.fw-visor,.fw-col,.fw-root{transition:none!important;animation:none!important}}
`;
  document.head.appendChild(s);
}
