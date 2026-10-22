// ===========================================================================
// ASSISTANT — "Jarvis, if Steve Jobs had shipped it." One living light, one
// line to type in, answers that stream in like speech. Deliberately breaks
// from the other sections: no card, no grid, full-bleed deep space.
//
// Brain: the uplink server's assistant (server/assistant.js) — Claude Opus 5.5
// with an automatic chain Sonnet 5.5 → Haiku 5.5 → second provider → local
// model, resuming mid-answer when a link dies. If the server can't be reached
// at all, the on-device brain (assistant/local.js) answers, and those turns
// sync to the server conversation once it's back.
// Keys never touch the browser; the admin pastes them in the settings sheet.
// ===========================================================================
import { kit, LS, $, $$, greeting, lowFx } from "./util.js";
import { md, plain } from "./assistant/md.js";
import { snapshot, act, onReminder } from "./assistant/context.js";
import * as link from "./assistant/link.js";
import * as local from "./assistant/local.js";
import { createOrb } from "./assistant/orb.js";

const THEME = { accent:"#9fb4ff", accent2:"#5b45ff", rgb:"159,180,255" };

function ensureCss(){
  if(document.getElementById("turd-as-css")) return;
  const l=document.createElement("link"); l.id="turd-as-css"; l.rel="stylesheet";
  l.href=new URL("./assistant/assistant.css", import.meta.url).href; document.head.appendChild(l);
}
ensureCss();

const I = {
  list:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M4 12h11M4 17h7"/></svg>`,
  plus:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  gear:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  up:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>`,
  stop:`<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2.2" fill="#070a18"/></svg>`,
  mic:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`,
};

/* ------------------------------------------------------------ state */
let K, root, orb, stream, scroller, bar, ta, sendBtn, statusEl, dotEl;
let msgs=[], conv=LS.get("turd_as_conv",""), status=null, base="", busy=false, ctl=null, turnId=null, offs=[];
let voiceOn=LS.get("turd_as_voice",false), effort=LS.get("turd_as_effort",null);
let historyIdx=-1, mounted=false, ready=false, speakNext=false;
// questions from "Hey T.U.R.D." (any section): queued until this tab is mounted, answered aloud
const voiceQ=[];
addEventListener("turd:ask", e=>{ const d=e.detail||{}; if(!d.text) return; voiceQ.push(d); if(mounted && ready) drainVoice(); });
function drainVoice(){ if(busy || !voiceQ.length || !mounted) return; const d=voiceQ.shift(); if(d.speak) speakNext=true; ask(d.text); }
const deviceLog = ()=> LS.get("turd_as_local",[]);
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const user = ()=> K?.session?.user || "";

// reminders fire anywhere in the app; speak them if voice is on
onReminder(r=>{ if(LS.get("turd_as_voice",false)) speak("Reminder: "+r.text); });

/* ------------------------------------------------------------ brain state */
function serverReady(){ return !!(status && status.ok && status.tiers?.some(t=>t.ready)); }
function headline(){
  if(busy && busy.tier) return { text:busy.tier, warn:false };
  if(!base) return { text:"On-device", warn:false };
  if(!status) return { text:"Connecting…", warn:false };
  if(status.offline) return { text:"On-device · server unreachable", warn:true };
  if(status.status===401) return { text:"On-device · sign in to the server", warn:true };
  if(status.status===403) return { text:"On-device · assistant is admin-only", warn:true };
  const ready=status.tiers?.find(t=>t.ready);
  if(ready) return { text:ready.label, warn:false };
  if(!status.tiers?.length) return { text:status.isAdmin?"On-device · start Ollama on the server PC":"On-device", warn:true };
  return { text:"On-device · "+(status.tiers?.[0]?.why||"models unavailable"), warn:true };
}
function paintStatus(){
  if(!statusEl) return;
  const h=headline(), span=statusEl.querySelector("span");
  if(span.textContent!==h.text){ span.textContent=h.text; span.classList.remove("as-swap"); void span.offsetWidth; span.classList.add("as-swap"); }
  dotEl.classList.toggle("warn",h.warn); dotEl.classList.toggle("busy",!!busy);
}
async function refreshStatus(){
  base=await link.base();
  status = base ? await link.get(K,"/api/assistant/status") : null;
  if(status && status.ok && !effort) effort=status.effort;
  paintStatus();
}

/* ------------------------------------------------------------ layout + orb */
function placeOrb(instant){
  if(!root || !orb) return;
  const empty=root.classList.contains("is-empty");
  const a=root.querySelector(empty?".as-anchor-big":".as-anchor-small"); if(!a) return;
  const R=root.getBoundingClientRect(), r=a.getBoundingClientRect();
  const c=root.querySelector(".as-orb");
  // the orb's light spills past its anchor: draw it 1.6x larger, centered
  const s=Math.max(r.width,r.height)*1.6;
  c.classList.toggle("no-anim",!!instant);
  c.style.left=(r.left-R.left+r.width/2-s/2)+"px"; c.style.top=(r.top-R.top+r.height/2-s/2)+"px";
  c.style.width=s+"px"; c.style.height=s+"px";
  orb?.redraw();
}
function setEmpty(on){ root.classList.toggle("is-empty",on); requestAnimationFrame(()=>placeOrb(false)); }

/* ------------------------------------------------------------ rendering */
function suggestions(){
  const out=["What do I need to know today?"];
  try{ const w=JSON.parse(localStorage.getItem("turd_wx_cache")||"null"); if(w) out.push("Will I need an umbrella tonight?"); }catch(e){}
  try{ const l=LS.get("turd_log",[]); if(l.some(e=>e.cat==="task"&&!e.done)) out.push("What's still on my list?"); else out.push("Task: back up the camera feeds"); }catch(e){}
  out.push("Remind me in 20 minutes to stretch");
  return out.slice(0,4);
}
function heroHTML(){
  const h=headline(); const needBrain = base && status?.ok && status.isAdmin && !status.tiers?.some(t=>t.ready);
  return `<div class="as-anchor-big"></div>
    <h2>${greeting()}${user()?`, <b>${esc(user())}</b>`:""}.</h2>
    <p>${needBrain?`I'm on my on-device brain. Start Ollama on the server PC to wake me up fully. <button data-a="extras">Set it up in Extras</button>`
       : !base?`Ask anything. I can see your dashboard, and I'll keep working even offline.`
       : h.warn?`Ask anything. Running on ${esc(h.text.replace(/^On-device · /,"my on-device brain · "))}.`
       : `Ask anything. I can see your dashboard and act on it.`}</p>
    <div class="as-sugg">${suggestions().map(s=>`<button data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
}
function msgEl(m, i){
  if(m.role==="user") return `<div class="as-u" data-i="${i}">${esc(m.text)}</div>`;
  const sw=(m.switches||[]).map(s=>`<span class="as-sw">${esc(s)}</span>`).join("");
  return `<div class="as-a" data-i="${i}">
    <div class="as-think ${m.think&&!m.text?"":"gone"}">${esc(m.think||"")}</div>
    <div class="as-a-body">${md(m.text)}</div>
    ${m.acts?.length?`<div class="as-acts">${m.acts.map(a=>`<div class="as-act ${a.ok===false?"err":""}">${esc(a.label)}</div>`).join("")}</div>`:""}
    ${m.notes?.length?m.notes.map(n=>`<div class="as-note">${esc(n)}</div>`).join(""):""}
    <div class="as-meta">${m.tier?`<span>${esc(m.tier)}</span>`:""}${sw}${m.stop==="stopped"?"<span>stopped</span>":""}
      ${m.text?`<button data-a="copy" data-i="${i}">Copy</button>${"speechSynthesis" in window?`<button data-a="speak" data-i="${i}">Speak</button>`:""}`:""}</div>
  </div>`;
}
function renderAll(){
  if(!stream) return;
  stream.innerHTML=msgs.map(msgEl).join("");
  root.querySelector(".as-hero").innerHTML=heroHTML();
  setEmpty(!msgs.length);
  scrollEnd(true);
}
function refreshMsg(i){
  const el=stream.querySelector(`[data-i="${i}"]`); if(!el) return renderAll();
  const tmp=document.createElement("div"); tmp.innerHTML=msgEl(msgs[i],i); const n=tmp.firstElementChild;
  n.style.animation="none"; el.replaceWith(n); scrollEnd();
}
let stick=true;
function scrollEnd(force){ if(!scroller) return; if(force||stick) scroller.scrollTop=scroller.scrollHeight; }

// Smooth typing: network chunks arrive in bursts; reveal at an even, adaptive pace.
const typer = { m:null, i:-1, target:"", shown:0, raf:0 };
function typeTo(i, text){
  typer.i=i; typer.m=msgs[i]; typer.target=text;
  if(!typer.raf) typer.raf=requestAnimationFrame(typeStep);
}
function typeStep(){
  typer.raf=0; const m=typer.m; if(!m || !stream) return;
  const back=typer.target.length-typer.shown;
  if(back>0){
    const n = lowFx() ? back : Math.max(1, Math.ceil(back/7));
    typer.shown+=n; m.text=typer.target.slice(0,typer.shown);
    const el=stream.querySelector(`[data-i="${typer.i}"] .as-a-body`);
    if(el){
      let html=md(m.text); const at=html.lastIndexOf("</");
      if(busy) html = at>0 ? html.slice(0,at)+'<span class="as-caret"></span>'+html.slice(at) : html+'<span class="as-caret"></span>';
      el.innerHTML=html;
      const th=el.parentElement.querySelector(".as-think"); if(th && !th.classList.contains("gone")) th.classList.add("gone");
    }
    scrollEnd();
  }
  if(typer.shown<typer.target.length) typer.raf=requestAnimationFrame(typeStep);
}
const typeFlush = ()=>{ if(typer.m){ typer.shown=typer.target.length; typer.m.text=typer.target; } cancelAnimationFrame(typer.raf); typer.raf=0; };

/* ------------------------------------------------------------ voice */
function pickVoice(){
  const vs=speechSynthesis.getVoices(); if(!vs.length) return null;
  const pref=[/Google UK English Male/i,/Microsoft (Guy|Ryan|Andrew|Brian).*Online/i,/Daniel/i,/Google US English/i,/en-GB/i,/en-US/i];
  for(const p of pref){ const v=vs.find(v=>p.test(v.name)||p.test(v.lang)); if(v) return v; }
  return vs.find(v=>/^en/i.test(v.lang))||vs[0];
}
function speak(text){
  if(window.TURD_SPEAK){ window.TURD_SPEAK.speak(plain(text), { onstart:()=>orb?.set("speak"), onboundary:()=>orb?.pulse(.5), onend:()=>{ if(!busy) orb?.set("idle"); } }); return; }   // shared voice (voice/speak.js)
  if(!("speechSynthesis" in window)) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(plain(text).slice(0,1500)); const v=pickVoice(); if(v) u.voice=v; u.rate=1.04; u.pitch=.96;
    u.onboundary=()=>orb&&orb?.pulse(.5); u.onstart=()=>orb&&orb?.set("speak"); u.onend=()=>orb&&!busy&&orb?.set("idle"); speechSynthesis.speak(u); }catch(e){}
}
let rec=null;
function micToggle(btn){
  const V=window.TURD_VOICE;
  if(V && V.state!=="error"){                       // offline engine (works in the Windows and Android apps too)
    if(btn.classList.contains("on")) return;
    const before=ta.value; btn.classList.add("on"); orb?.set("listen");
    V.capture({ onPartial:t=>{ ta.value=(before?before+" ":"")+t; grow(); orb?.pulse(.3); } }).then(t=>{
      btn.classList.remove("on"); orb?.set(busy?"think":"idle");
      if(t){ ta.value=(before?before+" ":"")+t; grow(); submit(); } });
    return;
  }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
  if(rec){ rec.stop(); return; }
  rec=new SR(); rec.lang=navigator.language||"en-US"; rec.interimResults=true; rec.continuous=false;
  const before=ta.value; let finalText="";
  rec.onresult=e=>{ let interim=""; for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) finalText+=r[0].transcript; else interim+=r[0].transcript; }
    ta.value=(before?before+" ":"")+finalText+interim; grow(); orb?.pulse(.3); };
  rec.onend=()=>{ btn.classList.remove("on"); rec=null; orb?.set(busy?"think":"idle"); if(finalText.trim()) submit(); };
  rec.onerror=()=>{ btn.classList.remove("on"); rec=null; };
  btn.classList.add("on"); orb?.set("listen"); rec.start();
}

/* ------------------------------------------------------------ input */
function grow(){ ta.style.height="auto"; ta.style.height=Math.min(168,ta.scrollHeight)+"px"; sendBtn.disabled=!busy && !ta.value.trim(); }
function setBusy(b){
  busy=b; root.classList.toggle("busy",!!b);
  sendBtn.classList.toggle("stop",!!b); sendBtn.innerHTML=b?I.stop:I.up; sendBtn.setAttribute("aria-label",b?"Stop":"Send");
  sendBtn.disabled=!b && !ta.value.trim(); orb?.set(b?"think":"idle"); paintStatus();
}
function submit(){ const t=ta.value.trim(); if(!t||busy) return; ta.value=""; grow(); ask(t); }

/* ------------------------------------------------------------ the turn */
async function ask(text){
  stick=true; historyIdx=-1;
  msgs.push({role:"user", text, t:Date.now()});
  const ai={role:"assistant", text:"", think:"", acts:[], switches:[], notes:[], tier:"", t:Date.now()};
  msgs.push(ai); const idx=msgs.length-1;
  typer.m=ai; typer.i=idx; typer.target=""; typer.shown=0;
  renderAll(); setBusy({tier:""});
  ctl=new AbortController();
  const context=await snapshot(K).catch(()=>"");
  let done=false;
  // always try the server first when one is linked: a cached "offline" may be stale
  if(base && !(status && (status.status===401||status.status===403))) done=await viaServer(ai, idx, {text, context});
  if(!done && !ctl.signal.aborted) await viaDevice(ai, idx, text, context);
  finish(ai, idx);
}

async function viaServer(ai, idx, first){
  let body={ conv, text:first.text, context:first.context, effort, offline:LS.get("turd_as_offline",[]) };
  for(let round=0; round<6; round++){
    const results=[]; let doneData=null, failed=null, sepDone=false;
    const r=await link.turn(K, body, async(type, d)=>{
      switch(type){
        case "turn": turnId=d.turn; if(d.conv && d.conv!==conv){ conv=d.conv; LS.set("turd_as_conv",conv); } LS.set("turd_as_offline",[]); break;
        case "tier":
          if(d.from && d.from!==d.label){ ai.switches.push(`${d.from} → ${d.label}`); bar.classList.remove("shimmer"); void bar.offsetWidth; bar.classList.add("shimmer"); }
          ai.tier=d.label; busy.tier=d.label; paintStatus(); if(!ai.text) refreshMsg(idx); break;
        case "think": if(!typer.target){ ai.think=(ai.think+d.t).replace(/\s+/g," ").slice(-160); const th=stream.querySelector(`[data-i="${idx}"] .as-think`); if(th){ th.textContent=ai.think; th.classList.remove("gone"); } } break;
        case "search": if(!typer.target){ ai.think="Searching the web…"; const th=stream.querySelector(`[data-i="${idx}"] .as-think`); if(th){ th.textContent=ai.think; th.classList.remove("gone"); } } break;
        case "text": if(round>0 && !sepDone){ sepDone=true; if(typer.target && !/\s$/.test(typer.target)) typer.target+="\n\n"; } typeTo(idx, typer.target+d.t); orb?.set("speak"); orb?.pulse(.35); break;
        case "notice": ai.notes.push(d.text); break;
        case "action": { const res=await act(d.name, d.input, K); results.push({ id:d.id, content:res.content, is_error:!!res.is_error, label:res.label });
          if(res.label){ ai.acts.push({label:res.label, ok:!res.is_error}); typeFlush(); refreshMsg(idx); } break; }
        case "link": ai.notes=ai.notes.filter(n=>!/connection/i.test(n)); if(d.state==="reconnecting"){ busy.tier="Reconnecting…"; paintStatus(); } else { busy.tier=ai.tier; paintStatus(); } break;
        case "fail": failed=d; break;
        case "done": doneData=d; break;
      }
    }, ctl.signal);
    if(r.ended==="aborted") return true;
    if(r.ended==="http"){
      if(r.status===401||r.status===403){ status={...(status||{}), status:r.status, ok:false}; paintStatus(); }
      if(r.status===409){ ai.notes.push("Still finishing the previous answer — try again in a moment."); return true; }
      return false;
    }
    if(r.ended==="offline"||r.ended==="lost"){ status={ok:false, offline:true}; paintStatus(); setTimeout(()=>{ if(mounted) refreshStatus(); }, 8000); return false; }
    if(failed){ if(ai.text) ai.notes.push("The connection to every model dropped — finishing on-device."); return false; }
    if(doneData){
      if(doneData.stop==="stopped") ai.stop="stopped";
      if(doneData.awaiting?.length && results.length){ body={ conv, toolResults:results }; continue; }   // let it see what the actions did
      if(status && doneData.today!=null && status.usage) status.usage.today=doneData.today;
      return true;
    }
    return false;
  }
  return true;
}

async function viaDevice(ai, idx, text, context){
  const resume=ai.text;
  if(!busy) return;
  busy.tier="On-device"; paintStatus();
  try{
    const res=await local.answer(text, { context, user:user(), ctx:K, history:msgs.slice(0,-2), resume }, {
      text:t=>{ typeTo(idx, typer.target+t); orb?.pulse(.3); },
      action:async(name,input)=>{ const r=await act(name,input,K); if(r.label){ ai.acts.push({label:r.label, ok:!r.is_error}); } return r; },
    }, ctl.signal);
    if(resume && ai.tier && ai.tier!==res.label) ai.switches.push(`${ai.tier} → ${res.label}`);
    ai.tier=res.label;
  }catch(e){ typeTo(idx, typer.target+(typer.target?"\n\n":"")+"Something went wrong on-device. Try again in a moment."); }
  // remember for the server so the conversation stays whole when it's back
  if(base){ typeFlush(); const q=LS.get("turd_as_offline",[]); q.push({q:text, a:ai.text}); LS.set("turd_as_offline",q.slice(-12)); }
}

function finish(ai, idx){
  typeFlush();
  if(ctl?.signal.aborted && ai.stop!=="stopped") ai.stop="stopped";
  if(!ai.text && !ai.acts.length) ai.text=ai.stop==="stopped"?"":"…";
  setBusy(false); ctl=null; turnId=null;
  refreshMsg(idx);
  if(!base || ai.tier?.startsWith("On-device")){ LS.set("turd_as_local", msgs.slice(-60).map(({role,text,tier,acts,t})=>({role,text,tier,acts,t}))); }
  if((voiceOn||speakNext) && ai.text && ai.stop!=="stopped") speak(ai.text);
  speakNext=false;
  paintStatus(); if(base) refreshStatus();
  if(voiceQ.length) setTimeout(drainVoice, 50);
}

async function stop(){
  if(!busy) return;
  const id=turnId; ctl?.abort();
  if(id) link.post(K,"/api/assistant/stop",{turn:id});
  try{ speechSynthesis.cancel(); }catch(e){}
}

/* ------------------------------------------------------------ conversations */
async function loadConv(id){
  if(base && serverReady() || (base && status?.ok)){
    if(id){ const r=await link.get(K,"/api/assistant/conv?id="+encodeURIComponent(id));
      if(r.ok){ conv=id; LS.set("turd_as_conv",id); msgs=r.view.map(v=>({...v, switches:[], notes:[], acts:v.acts||[]})); renderAll(); return; } }
    conv=""; LS.set("turd_as_conv",""); msgs=[]; renderAll(); return;
  }
  msgs=deviceLog(); renderAll();
}
function newConv(){ if(busy) stop(); conv=""; LS.set("turd_as_conv",""); msgs=[]; if(!base) LS.set("turd_as_local",[]); closeAll(); renderAll(); ta.focus(); }

async function openDrawer(){
  root.classList.add("drawer-open"); root.classList.remove("sheet-open");
  const box=root.querySelector(".as-dlist");
  if(!base || !status?.ok){ box.innerHTML=`<div class="as-dempty">${base?"The server isn't reachable right now. ":""}Conversations are kept on the server once one is linked. On-device chats live on this device only.</div>`; return; }
  box.innerHTML=`<div class="as-dempty">Loading…</div>`;
  const r=await link.get(K,"/api/assistant/convs");
  const list=r.ok?r.convs:[];
  const ago=t=>{ const s=(Date.now()-t)/1000; return s<3600?Math.max(1,Math.round(s/60))+"m":s<86400?Math.round(s/3600)+"h":Math.round(s/86400)+"d"; };
  box.innerHTML = list.length ? list.map(c=>`<div class="as-ditem ${c.id===conv?"on":""}" data-c="${esc(c.id)}"><span class="t">${esc(c.title)}</span><span class="w">${ago(c.updated)}</span><button class="x" data-del="${esc(c.id)}" aria-label="Delete">×</button></div>`).join("")
    : `<div class="as-dempty">No conversations yet.</div>`;
}
function closeAll(){ root.classList.remove("drawer-open","sheet-open"); }

/* ------------------------------------------------------------ settings sheet */
function sheetHTML(){
  const s=status||{}, admin=s.isAdmin, ok=s.ok;
  const seg=(name,cur,opts)=>`<div class="as-seg" data-seg="${name}">${opts.map(([v,l])=>`<button data-v="${v}" class="${cur===v?"on":""}">${l}</button>`).join("")}</div>`;
  const sw=(name,on)=>`<button class="as-switch ${on?"on":""}" data-sw="${name}" role="switch" aria-checked="${!!on}"></button>`;
  const tiers=(ok?s.tiers:[]).map((t,i)=>`<div class="as-tier ${t.ready?"ok":""}"><span class="n">${i+1}</span><i></i>${esc(t.label)}<span class="why">${esc(t.ready?"ready":t.why)}</span></div>`).join("")
    + `<div class="as-tier ok"><span class="n">${(ok?s.tiers.length:0)+1}</span><i></i>On-device<span class="why">always ready</span></div>`;
  return `<div class="as-grab"></div>
  <div class="as-grp"><h3>Brain</h3>
    <div class="as-tiers">${tiers}</div>
    <div class="as-msg">${!base?"No server linked: the assistant runs on this device. Link one below for the full brain.":ok?(s.hasKey?`Today: $${(s.usage?.today||0).toFixed(2)}${s.usage?.cap?` of $${s.usage.cap} budget`:""} · `:"Free · ")+`${s.usage?.turns||0} answers today`:status?.offline?"Server unreachable right now.":""}</div>
  </div>
  <div class="as-grp"><h3>You</h3>
    <div class="as-row"><label>Depth<small>Quick is snappy; Deep thinks longer on hard questions.</small></label>${seg("effort",effort||s.effort||"quick",[["quick","Quick"],["balanced","Balanced"],["deep","Deep"]])}</div>
    <div class="as-row"><label>Speak answers<small>Reads replies aloud with the device's voice.</small></label>${sw("voice",voiceOn)}</div>
  </div>
  ${!base?`<div class="as-grp"><h3>Server</h3>
    <div class="as-row"><label>Uplink address<small>Your T.U.R.D. server, e.g. https://turd.example.com</small></label><input type="url" id="asUp" placeholder="https://…"><button class="as-save" data-save="uplink">Link</button></div></div>`:""}
  ${admin?`  <div class="as-grp"><h3>Local brain <small style="text-transform:none;letter-spacing:0;font-weight:400">free, private</small></h3>
    <div class="as-row"><label>Ollama on the server's PC<small>${s.local?.found?`Running · ${esc(s.local.model)}`:`Not found. One-tap install in <button class="as-link" data-a="extras">Extras → Local AI</button>, or run: ollama pull llama3.2`}</small></label>${sw("local",s.local?.enabled!==false)}</div>
    ${(s.local?.models||[]).length>1?`<div class="as-row"><label>Model<small>Bigger is smarter but slower.</small></label><select id="asLocalModel">${s.local.models.map(m=>`<option value="${esc(m)}" ${m===s.local.model?"selected":""}>${esc(m)}</option>`).join("")}</select></div>`:""}
    <div class="as-row"><label>Address</label><input type="url" id="asLocalUrl" value="${esc(s.local?.url||"http://127.0.0.1:11434")}"></div>
  </div>
  <div class="as-grp"><h3>Claude <small style="text-transform:none;letter-spacing:0;font-weight:400">optional, paid</small></h3>
    <div class="as-row"><label>API key<small>${s.key?`Saved on the server (${esc(s.key)}). Never sent to devices.`:"From console.anthropic.com → API keys. Stored only on your server."}</small></label><input type="password" id="asKey" placeholder="${s.key?"replace key…":"sk-ant-…"}" autocomplete="off"></div>
    <div class="as-row"><label>Primary model</label><select id="asPrimary">${[["claude-opus-5-5","Opus 5.5 · smartest"],["claude-sonnet-5-5","Sonnet 5.5 · faster, cheaper"],["claude-haiku-5-5","Haiku 5.5 · fastest"]].map(([v,l])=>`<option value="${v}" ${s.primary===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="as-row"><label>Web search<small>Lets it look up live facts ($0.01 per search).</small></label>${sw("web",s.webSearch)}</div>
    <div class="as-row"><label>Daily budget<small>Claude pauses for the day past this; on-device keeps going.</small></label><input type="number" id="asCap" min="0" step="0.5" value="${s.usage?.cap??5}" style="flex:0 0 90px"></div>
    <div class="as-row"><label>Other operators can use it<small>They share your key and budget.</small></label>${sw("users",s.allowUsers)}</div>
  </div>
  <div class="as-grp"><h3>Backup provider <small style="text-transform:none;letter-spacing:0;font-weight:400">optional</small></h3>
    <div class="as-row"><label>OpenAI-compatible URL<small>OpenAI, Groq, OpenRouter, Gemini, LM Studio…</small></label><input type="url" id="asAltBase" value="${esc(s.alt?.base||"")}" placeholder="https://api.openai.com/v1"></div>
    <div class="as-row"><label>Model</label><input type="text" id="asAltModel" value="${esc(s.alt?.model||"")}" placeholder="model id"></div>
    <div class="as-row"><label>Key<small>${s.alt?.key?esc(s.alt.key):"not set"}</small></label><input type="password" id="asAltKey" placeholder="${s.alt?.key?"replace…":"key"}" autocomplete="off"></div>
  </div>
  <div class="as-row" style="justify-content:flex-end;border:0"><span class="as-msg" id="asSaveMsg" style="margin:0 auto 0 0"></span><button class="as-save" data-save="admin">Save</button></div>`
  : ok?`<div class="as-msg">Only the admin can change the model, keys and budget.</div>`:""}`;
}
async function openSheet(){
  root.classList.add("sheet-open"); root.classList.remove("drawer-open");
  const sh=root.querySelector(".as-sheet"); sh.innerHTML=sheetHTML();
  refreshStatus().then(()=>{ if(root.classList.contains("sheet-open") && !sh.contains(document.activeElement)) sh.innerHTML=sheetHTML(); });
}
async function saveAdmin(btn){
  const sh=root.querySelector(".as-sheet"), v=id=>sh.querySelector(id)?.value, msg=sh.querySelector("#asSaveMsg");
  const swOn=n=>sh.querySelector(`[data-sw="${n}"]`)?.classList.contains("on");
  const body={ primary:v("#asPrimary"), webSearch:swOn("web"), allowUsers:swOn("users"), dailyCapUSD:+v("#asCap"),
    alt:{ base:v("#asAltBase")||"", model:v("#asAltModel")||"" }, local:{ url:v("#asLocalUrl")||"", enabled:swOn("local"), ...(v("#asLocalModel")?{model:v("#asLocalModel")}:{}) } };
  const key=v("#asKey"); if(key) body.anthropicKey=key;
  const ak=v("#asAltKey"); if(ak) body.alt.key=ak;
  btn.disabled=true; msg.className="as-msg"; msg.textContent=key?"Checking key with Anthropic…":"Saving…";
  const r=await link.post(K,"/api/assistant/config",body); btn.disabled=false;
  if(!r.ok){ msg.className="as-msg err"; msg.textContent=r.error||(r.offline?"Server unreachable":"Couldn't save"); return; }
  status=r; paintStatus(); sh.innerHTML=sheetHTML();
  const m2=sh.querySelector("#asSaveMsg"); m2.className="as-msg ok"; m2.textContent=key?(r.verified===false?"Saved (couldn't verify right now)":"Key verified ✓ Claude is online"):"Saved";
  if(!msgs.length) renderAll();
}

/* ------------------------------------------------------------ mount */
function build(){
  root.innerHTML=`<div class="as-root is-empty">
    <div class="as-top">
      <button class="as-ico" data-a="history" aria-label="Conversations" title="Conversations">${I.list}</button>
      <button class="as-status" data-a="settings" title="Brain status"><i class="as-dot"></i><span>…</span></button>
      <span class="as-sp"></span>
      <button class="as-ico" data-a="new" aria-label="New conversation" title="New conversation (Ctrl+K)">${I.plus}</button>
      <button class="as-ico" data-a="settings" aria-label="Settings" title="Settings">${I.gear}</button>
    </div>
    <div class="as-scroll"><div class="as-stream" aria-live="polite"></div></div>
    <div class="as-hero"></div>
    <canvas class="as-orb no-anim" aria-hidden="true"></canvas>
    <div class="as-dock">
      <form class="as-bar" autocomplete="off">
        <div class="as-anchor-small"></div>
        <textarea rows="1" placeholder="Ask anything" aria-label="Message the assistant" enterkeyhint="send"></textarea>
        ${(window.TURD_VOICE||window.SpeechRecognition||window.webkitSpeechRecognition)?`<button type="button" class="as-btn as-mic" data-a="mic" aria-label="Speak">${I.mic}</button>`:""}
        <button type="submit" class="as-btn as-send" aria-label="Send" disabled>${I.up}</button>
      </form>
      <div class="as-hint"><kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> new line · <kbd>/</kbd> to focus · <kbd>Esc</kbd> to stop</div>
    </div>
    <div class="as-scrim"></div>
    <aside class="as-drawer"><h3>Conversations</h3><div class="as-dlist"></div>
      <button class="as-save" data-a="new" style="margin:10px">New conversation</button></aside>
    <div class="as-sheet" role="dialog" aria-label="Assistant settings"></div>
  </div>`;
  root=root.firstElementChild;
  stream=$(".as-stream",root); scroller=$(".as-scroll",root); bar=$(".as-bar",root); ta=$("textarea",root); sendBtn=$(".as-send",root);
  statusEl=$(".as-status",root); dotEl=$(".as-dot",root);
  orb=createOrb($(".as-orb",root),{lowFx:lowFx()}); orb.colors(THEME.accent, THEME.accent2);

  scroller.addEventListener("scroll",()=>{ stick = scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight < 60; },{passive:true});
  ta.addEventListener("input",()=>{ grow(); if(!busy) orb?.set(ta.value?"listen":"idle"); });
  ta.addEventListener("keydown",e=>{
    if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); submit(); }
    else if(e.key==="ArrowUp" && !ta.value){ const us=msgs.filter(m=>m.role==="user"); if(us.length){ historyIdx=Math.min(us.length-1,historyIdx+1); ta.value=us[us.length-1-historyIdx].text; grow(); e.preventDefault(); } }
  });
  bar.addEventListener("submit",e=>{ e.preventDefault(); busy?stop():submit(); });
  root.addEventListener("click",async e=>{
    const s=e.target.closest("[data-s]"); if(s){ ask(s.dataset.s); return; }
    const c=e.target.closest("[data-c]"), del=e.target.closest("[data-del]");
    if(del){ e.stopPropagation(); await link.post(K,"/api/assistant/delete",{id:del.dataset.del}); if(del.dataset.del===conv) newConv(); openDrawer(); return; }
    if(c){ closeAll(); loadConv(c.dataset.c); return; }
    const seg=e.target.closest("[data-seg] button"); if(seg){ const g=seg.parentElement; $$("button",g).forEach(b=>b.classList.toggle("on",b===seg));
      if(g.dataset.seg==="effort"){ effort=seg.dataset.v; LS.set("turd_as_effort",effort); } return; }
    const swb=e.target.closest("[data-sw]"); if(swb){ swb.classList.toggle("on"); swb.setAttribute("aria-checked",swb.classList.contains("on"));
      if(swb.dataset.sw==="voice"){ voiceOn=swb.classList.contains("on"); LS.set("turd_as_voice",voiceOn); if(voiceOn) speak("Voice on."); } return; }
    const sv=e.target.closest("[data-save]");
    if(sv){ if(sv.dataset.save==="admin") saveAdmin(sv);
      else { const u=$("#asUp",root)?.value.trim(); if(u){ await link.setEndpoint(u); await refreshStatus(); K.toast(status?.ok?"server linked":"saved — server not reachable yet"); openSheet(); renderAll(); } } return; }
    if(e.target.closest(".as-scrim")){ closeAll(); return; }
    const a=e.target.closest("[data-a]"); if(!a) return;
    switch(a.dataset.a){
      case "history": root.classList.contains("drawer-open")?closeAll():openDrawer(); break;
      case "settings": root.classList.contains("sheet-open")?closeAll():openSheet(); break;
      case "new": newConv(); break;
      case "extras": closeAll(); K.show?.("extras"); break;
      case "mic": micToggle(a); break;
      case "copy": { const m=msgs[+a.dataset.i]; try{ await navigator.clipboard.writeText(m.text); a.textContent="Copied"; setTimeout(()=>a.textContent="Copy",1400); }catch(err){} break; }
      case "speak": speak(msgs[+a.dataset.i].text); break;
    }
  });
  const onKey=e=>{
    if(!mounted) return;
    const inField=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||"");
    if(e.key==="/" && !inField){ e.preventDefault(); ta.focus(); }
    else if(e.key==="Escape"){ if(root.matches(".drawer-open,.sheet-open")) closeAll(); else if(busy) stop(); }
    else if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); newConv(); }
  };
  addEventListener("keydown",onKey,true); offs.push(()=>removeEventListener("keydown",onKey,true));
  const ro=new ResizeObserver(()=>placeOrb(true)); ro.observe(root); offs.push(()=>ro.disconnect());
}

export default {
  id:"assistant", icon:"✦", label:"Assistant", theme:THEME,
  async mount(el, ctx){
    K=kit(ctx); K.sections=ctx.sections||(()=>[]); K.session=ctx.session;
    mounted=true; el.classList.add("as-full"); root=el;
    build(); paintStatus(); renderAll(); placeOrb(true);
    setTimeout(()=>{ if(mounted && matchMedia("(pointer:fine)").matches) ta.focus(); }, 450);
    await refreshStatus();
    if(!mounted) return;
    await loadConv(conv);
    if(!mounted) return;
    ready=true; drainVoice();
  },
  unmount(){
    mounted=false; ready=false; if(busy && ctl){ /* the server keeps answering; it'll be in history */ }
    offs.forEach(f=>f()); offs=[]; orb?.destroy(); orb=null; if(rec){ try{ rec.stop(); }catch(e){} }
    try{ window.TURD_SPEAK && !window.TURD_BRIEF?.playing ? window.TURD_SPEAK.stop() : speechSynthesis.cancel(); }catch(e){}
    stream=null;
  },
  summary(){
    const st=status; return { title:"Assistant", value: !st?"On-device":(st.tiers?.find(t=>t.ready)?.label||"On-device"), note:"Ask anything" };
  },
};
