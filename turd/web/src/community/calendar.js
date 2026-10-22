// ===========================================================================
// COMMUNITY CALENDAR — a shared calendar every logged-in operator can see and
// add to. Lives as the centerpiece of the Community (chat) page; Home shows the
// next few events through renderUpcomingStrip().
//
// Owned by the "Community calendar" thread. Public API:
//   mountCalendar(el, ctx, {transport?})  -> cleanup()
//   upcoming(n=5)                          -> [{id,title,start,end,allDay,cat,color,where,going,by}]  (sync, cached)
//   renderUpcomingStrip(el, ctx, {n})      -> cleanup()   (Home)
//   summary()                              -> {title,value,note}  (Home tiles)
//   localTransport() / remoteTransport({base,token,socket})
//
// A transport is { kind, list(), put(ev), del(id), rsvp(id,state), onChange(cb)->off }.
// Offline it is localStorage + BroadcastChannel (multi-tab demo). When the chat
// uplink exposes calendarTransport(), every device shares one calendar.
// ===========================================================================

const CACHE = "turd_cal_cache", SEEDED = "turd_cal_seeded", VIEWK = "turd_cal_view", FOCUS = "turd_cal_focus";
const DAY = 864e5;

/* ------------------------------------------------------------ tiny kit */
const LSx = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} },
};
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const uid = ()=> (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const pad = n=>String(n).padStart(2,"0");
const sod = t=>{ const d=new Date(t); d.setHours(0,0,0,0); return d.getTime(); };     // start of local day
const addDays = (t,n)=>{ const d=new Date(t); d.setDate(d.getDate()+n); return d.getTime(); };
const ymd = t=>{ const d=new Date(t); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const hm  = t=>{ const d=new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const parseLocal = (date,time="00:00")=>{ const [y,m,d]=date.split("-").map(Number), [h,mi]=time.split(":").map(Number); return new Date(y,m-1,d,h||0,mi||0).getTime(); };
const fmtTime = t=> new Date(t).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
const fmtDay  = (t,o={weekday:"short", month:"short", day:"numeric"})=> new Date(t).toLocaleDateString([], o);
const reduced = ()=> matchMedia("(prefers-reduced-motion: reduce)").matches;

export const CATS = {
  meetup:  { label:"Meetup",      color:"#2f8cff" },
  game:    { label:"Game night",  color:"#3ddc4a" },
  stream:  { label:"Stream",      color:"#b04cff" },
  movie:   { label:"Watch party", color:"#ff5ca8" },
  trip:    { label:"Trip",        color:"#22c8ff" },
  bday:    { label:"Birthday",    color:"#ffcf5c" },
  work:    { label:"Build / ops", color:"#ff9a1f" },
  other:   { label:"Other",       color:"#9fb3d9" },
};
const REPEATS = { none:"Does not repeat", weekly:"Every week", biweekly:"Every 2 weeks", monthly:"Every month", yearly:"Every year" };
const catOf = ev=> CATS[ev.cat] || CATS.other;

/* ------------------------------------------------------------ styles (self-loading) */
function ensureCss(){
  if(document.getElementById("turd-community-css")) return;
  const l=document.createElement("link"); l.id="turd-community-css"; l.rel="stylesheet";
  l.href=new URL("./community.css", import.meta.url).href; document.head.appendChild(l);
}

/* ------------------------------------------------------------ sanitize (shared with server rules) */
export function clean(ev, user){
  const s=(v,n)=>String(v??"").slice(0,n);
  const start=Number(ev.start), end=Math.max(Number(ev.end)||0, start+(ev.allDay?DAY:15*60e3));
  if(!isFinite(start)) throw new Error("bad start");
  return {
    id: s(ev.id||uid(),64), title: s(ev.title,120).trim()||"Untitled", start, end: Math.min(end, start+62*DAY),
    allDay: !!ev.allDay, cat: CATS[ev.cat]?ev.cat:"other", where: s(ev.where,160), notes: s(ev.notes,2000),
    repeat: REPEATS[ev.repeat]?ev.repeat:"none", until: ev.until?Number(ev.until)||null:null,
    by: s(ev.by||user||"operator",40), created: Number(ev.created)||Date.now(), updated: Date.now(),
    rsvp: (ev.rsvp && typeof ev.rsvp==="object") ? Object.fromEntries(Object.entries(ev.rsvp).slice(0,500).filter(([,v])=>v==="going"||v==="maybe").map(([k,v])=>[s(k,40),v])) : {},
    demo: !!ev.demo,
  };
}

/* ------------------------------------------------------------ transports */
export function localTransport(){
  const KEY="turd_cal_events";
  const subs=new Set();
  const bc = ("BroadcastChannel" in self) ? new BroadcastChannel("turd_cal") : null;
  const read = ()=> LSx.get(KEY, []);
  const write = (list, msg)=>{ LSx.set(KEY, list); bc && bc.postMessage(msg); };
  const fire = msg=> subs.forEach(cb=>{ try{ cb(msg); }catch(e){} });
  if(bc) bc.onmessage = e=> fire({...e.data, remote:true});
  if(!LSx.get(SEEDED,false) && !read().length){ LSx.set(KEY, demoEvents()); LSx.set(SEEDED,true); }
  return {
    kind:"local",
    async list(){ return read(); },
    async put(ev){ const l=read(), i=l.findIndex(x=>x.id===ev.id); i<0?l.push(ev):(l[i]=ev); write(l,{op:"put",event:ev}); fire({op:"put",event:ev}); return ev; },
    async del(id){ write(read().filter(x=>x.id!==id),{op:"del",id}); fire({op:"del",id}); },
    async rsvp(id,user,state){ const l=read(), ev=l.find(x=>x.id===id); if(!ev) return;
      ev.rsvp=ev.rsvp||{}; if(state) ev.rsvp[user]=state; else delete ev.rsvp[user];
      write(l,{op:"put",event:ev}); fire({op:"put",event:ev}); return ev; },
    onChange(cb){ subs.add(cb); return ()=>subs.delete(cb); },
  };
}

// Server transport — REST on the chat server + live pushes over its WebSocket
// ({type:"cal", op:"put"|"del", event|id}). Falls back to 30s polling with no socket.
export function remoteTransport({base="", token, socket}={}){
  const H = ()=>({ "content-type":"application/json", ...(token?{authorization:"Bearer "+token}:{}) });
  const j = async r=>{ if(!r.ok) throw new Error((await r.text().catch(()=>""))||("HTTP "+r.status)); return r.status===204?null:r.json(); };
  const subs=new Set(); let poll=0;
  const fire = msg=> subs.forEach(cb=>{ try{ cb(msg); }catch(e){} });
  const onMsg = m=>{ try{ const d=typeof m.data==="string"?JSON.parse(m.data):m.data; if(d&&d.type==="cal") fire({op:d.op,event:d.event,id:d.id,remote:true}); }catch(e){} };
  return {
    kind:"server",
    async list(){ return (await j(await fetch(base+"/api/events",{headers:H()}))).events||[]; },
    async put(ev){ return (await j(await fetch(base+"/api/events",{method:"POST",headers:H(),body:JSON.stringify(ev)}))).event; },
    async del(id){ await j(await fetch(base+"/api/events/"+encodeURIComponent(id),{method:"DELETE",headers:H()})); },
    async rsvp(id,_u,state){ return (await j(await fetch(base+"/api/events/"+encodeURIComponent(id)+"/rsvp",{method:"POST",headers:H(),body:JSON.stringify({state})}))).event; },
    onChange(cb){
      subs.add(cb);
      if(subs.size===1){ if(socket) socket.addEventListener("message",onMsg); else poll=setInterval(()=>fire({op:"sync",remote:true}),30e3); }
      return ()=>{ subs.delete(cb); if(!subs.size){ socket&&socket.removeEventListener("message",onMsg); clearInterval(poll); } };
    },
  };
}

// Picks the server transport when the chat uplink is configured; otherwise local.
async function pickTransport(){
  try{
    const m = await import("../uplink.js");
    if(m && m.configured && m.configured()){
      if(typeof m.calendarTransport==="function"){ const t=await m.calendarTransport(remoteTransport); if(t) return t; }
    }
  }catch(e){}
  return localTransport();
}

/* ------------------------------------------------------------ store (one per app) */
const store = {
  events: LSx.get(CACHE, []), transport:null, ready:null, subs:new Set(), off:null,
  init(transport){
    if(transport && transport!==this.transport){ this.ready=null; this.off&&this.off(); }
    if(this.ready) return this.ready;
    this.ready=(async()=>{
      this.transport = transport || await pickTransport();
      await this.sync();
      this.off = this.transport.onChange(async msg=>{
        if(msg.op==="put" && msg.event) this._merge(msg.event);
        else if(msg.op==="del") this.events=this.events.filter(e=>e.id!==msg.id);
        else await this.sync(true);
        this._save(); this._emit(msg);
      });
    })();
    return this.ready;
  },
  async sync(quiet){ try{ this.events=(await this.transport.list()).filter(Boolean); this._save(); if(!quiet) this._emit({op:"sync"}); }catch(e){ console.warn("[cal] sync",e); } },
  _merge(ev){ const i=this.events.findIndex(x=>x.id===ev.id); i<0?this.events.push(ev):(this.events[i]=ev); },
  _save(){ LSx.set(CACHE, this.events); },
  _emit(msg){ this.subs.forEach(cb=>{ try{ cb(msg); }catch(e){} }); },
  on(cb){ this.subs.add(cb); return ()=>this.subs.delete(cb); },
  async put(ev){ const saved=await this.transport.put(ev); this._merge(saved||ev); this._save(); this._emit({op:"put",event:saved||ev}); return saved||ev; },
  async del(id){ await this.transport.del(id); this.events=this.events.filter(e=>e.id!==id); this._save(); this._emit({op:"del",id}); },
  async rsvp(id,user,state){ const ev=await this.transport.rsvp(id,user,state); if(ev){ this._merge(ev); this._save(); this._emit({op:"put",event:ev}); } },
};

/* ------------------------------------------------------------ recurrence */
function stepper(ev, k){
  const d=new Date(ev.start);
  if(ev.repeat==="weekly")   return new Date(d.getFullYear(), d.getMonth(), d.getDate()+7*k, d.getHours(), d.getMinutes());
  if(ev.repeat==="biweekly") return new Date(d.getFullYear(), d.getMonth(), d.getDate()+14*k, d.getHours(), d.getMinutes());
  if(ev.repeat==="monthly"){ const n=new Date(d.getFullYear(), d.getMonth()+k, d.getDate(), d.getHours(), d.getMinutes()); return n.getDate()===d.getDate()?n:null; }
  if(ev.repeat==="yearly"){ const n=new Date(d.getFullYear()+k, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()); return n.getMonth()===d.getMonth()?n:null; }
  return null;
}
// All occurrences of all events overlapping [from,to)
export function expand(events, from, to){
  const out=[];
  for(const ev of events){
    const dur=Math.max(0, ev.end-ev.start);
    if(!ev.repeat || ev.repeat==="none"){ if(ev.start<to && ev.end>from) out.push({ev, s:ev.start, e:ev.end, k:0}); continue; }
    for(let k=0;k<1200;k++){
      const n=stepper(ev,k); if(n===null) continue;
      const s=n.getTime(); if(s>=to || (ev.until && s>ev.until)) break;
      if(s+dur>from) out.push({ev, s, e:s+dur, k});
    }
  }
  return out.sort((a,b)=> a.s-b.s || (b.e-b.s)-(a.e-a.s) || a.ev.title.localeCompare(b.ev.title));
}

/* ------------------------------------------------------------ public helpers (Home) */
export function upcoming(n=5, events=store.events){
  const now=Date.now();
  return expand(events, now, now+120*DAY).filter(o=>o.e>now).slice(0,n).map(o=>({
    id:o.ev.id, title:o.ev.title, start:o.s, end:o.e, allDay:o.ev.allDay, cat:o.ev.cat, color:catOf(o.ev).color,
    where:o.ev.where, by:o.ev.by, going:Object.values(o.ev.rsvp||{}).filter(v=>v==="going").length, live:o.s<=now,
  }));
}
export function countdown(t){
  const s=Math.round((t-Date.now())/1000);
  if(s<=0) return "happening now";
  if(s<3600) return `in ${Math.max(1,Math.round(s/60))} min`;
  if(s<86400){ const m=Math.round(s/60); return `in ${Math.floor(m/60)}h ${m%60}m`; }
  const d=Math.round(s/86400); return d===1?"tomorrow":`in ${d} days`;
}
const whenText = o=> o.allDay ? (o.end-o.start>DAY ? `${fmtDay(o.start)} – ${fmtDay(o.end-1)}` : "All day")
  : `${fmtTime(o.start)} – ${fmtTime(o.end)}`;

// programmatic create/update (Assistant tab, etc.) — refreshes every open calendar
export async function addEvent(ev, user){ await store.init(); return store.put(clean({rsvp:user?{[user]:"going"}:{}, ...ev, by:ev.by||user}, user)); }
export async function removeEvent(id){ await store.init(); return store.del(id); }

// live updates for hosts (page header, Home): cb({op}) -> off()
export const subscribe = cb=>{ store.init(); return store.on(cb); };

export function summary(){
  const u=upcoming(1)[0];
  return u ? { title:"Next event", value:u.title, note:`${fmtDay(u.start)} · ${countdown(u.start)}` }
           : { title:"Community", value:"No events", note:"Add one on the Community page" };
}

/* ------------------------------------------------------------ ICS export */
function icsStamp(t, allDay){ const d=new Date(t); return allDay
  ? `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`
  : d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,""); }
const icsText = s=>String(s||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/([,;])/g,"\\$1");
function toIcs(events){
  const rr={weekly:"FREQ=WEEKLY",biweekly:"FREQ=WEEKLY;INTERVAL=2",monthly:"FREQ=MONTHLY",yearly:"FREQ=YEARLY"};
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//TURD//Community Calendar//EN","CALSCALE:GREGORIAN","X-WR-CALNAME:T.U.R.D. Community"];
  for(const ev of events){
    lines.push("BEGIN:VEVENT",`UID:${ev.id}@turd`,`DTSTAMP:${icsStamp(Date.now())}`,
      ev.allDay?`DTSTART;VALUE=DATE:${icsStamp(ev.start,true)}`:`DTSTART:${icsStamp(ev.start)}`,
      ev.allDay?`DTEND;VALUE=DATE:${icsStamp(ev.end,true)}`:`DTEND:${icsStamp(ev.end)}`,
      `SUMMARY:${icsText(ev.title)}`);
    if(ev.where) lines.push(`LOCATION:${icsText(ev.where)}`);
    if(ev.notes) lines.push(`DESCRIPTION:${icsText(ev.notes)}`);
    if(rr[ev.repeat]) lines.push(`RRULE:${rr[ev.repeat]}${ev.until?";UNTIL="+icsStamp(ev.until):""}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR"); return lines.join("\r\n");
}
function download(name, text){
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type:"text/calendar"}));
  a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}

/* ------------------------------------------------------------ demo seed (offline only) */
function demoEvents(){
  const now=new Date(), t0=sod(now), at=(dd,h,m=0)=>{ const d=new Date(t0); d.setDate(d.getDate()+dd); d.setHours(h,m,0,0); return d.getTime(); };
  const fri=(5-now.getDay()+7)%7||7, sat=(6-now.getDay()+7)%7||7;
  const E=(o)=>clean({...o, demo:true});
  return [
    E({title:"Game night: co-op raid", start:at(fri,20), end:at(fri,23,30), cat:"game", where:"Voice channel · #lobby", notes:"Bring snacks. Mic check at 7:50.", by:"admin", repeat:"weekly", rsvp:{admin:"going"}}),
    E({title:"Camera wall build day", start:at(sat,10), end:at(sat,15), cat:"work", where:"Garage", notes:"Mounting the Oxford feeds + new SD cards.", by:"admin"}),
    E({title:"Community stream", start:at(3,19), end:at(3,21), cat:"stream", where:"twitch.tv", by:"admin", repeat:"biweekly"}),
    E({title:"Movie watch party", start:at(9,21), end:at(9,23), cat:"movie", where:"Entertainment tab", by:"admin"}),
    E({title:"Road trip: Smokies", start:sod(at(16,0)), end:sod(at(19,0)), allDay:true, cat:"trip", where:"Gatlinburg, TN", by:"admin"}),
    E({title:"Monthly server patch window", start:at(12,1), end:at(12,2), cat:"work", where:"T.U.R.D. uplink", by:"admin", repeat:"monthly"}),
  ];
}

/* ===========================================================================
   UI
   =========================================================================== */
export function mountCalendar(host, ctx={}, opts={}){
  ensureCss();
  const user = ()=> (ctx.session && ctx.session.user) || "operator";
  const isAdmin = ()=> ctx.session && ctx.session.role==="admin";
  const toast = ctx.toast || (m=>console.log("[cal]",m));
  const st = { view: LSx.get(VIEWK, innerWidth<760?"agenda":"month"), cursor: sod(Date.now()), sel: sod(Date.now()), open:null, editing:null };
  let alive=true, ro=null, tick=0;

  host.classList.add("cal-host");
  host.innerHTML = `
    <div class="cal-next" id="calNext"></div>
    <div class="cal-bar">
      <div class="cal-nav">
        <button class="cal-arrow" data-act="prev" aria-label="Previous">‹</button>
        <h2 class="cal-title" id="calTitle"></h2>
        <button class="cal-arrow" data-act="next" aria-label="Next">›</button>
        <button class="t-link" data-act="today">Today</button>
      </div>
      <div class="cal-views">${["month","week","agenda"].map(v=>`<button class="t-link" data-view="${v}">${v}</button>`).join("")}</div>
      <div class="cal-tools"><button class="t-btn sm" data-act="new">＋ New event</button></div>
    </div>
    <div class="cal-body" id="calBody"></div>
    <div class="cal-legend">${Object.values(CATS).map(c=>`<span><i style="background:${c.color}"></i>${c.label}</span>`).join("")}
      <span class="cal-foot"><span class="cal-sync" id="calSync"></span><button class="t-link" data-act="ics" title="Download the whole calendar for Google / Outlook / Apple Calendar">Export</button></span></div>
    <aside class="cal-drawer" id="calDrawer" aria-hidden="true"></aside>`;

  const body=$("#calBody",host), drawer=$("#calDrawer",host);

  /* ---- toolbar ---- */
  host.addEventListener("click", e=>{
    const b=e.target.closest("[data-act],[data-view]"); if(!b || !host.contains(b) || drawer.contains(b)) return;
    if(b.dataset.view){ closeDrawer(); st.view=b.dataset.view; LSx.set(VIEWK,st.view); return render(); }
    const a=b.dataset.act;
    if(a!=="new" && a!=="ics") closeDrawer();
    if(a==="prev"||a==="next") move(a==="prev"?-1:1);
    else if(a==="today"){ st.cursor=st.sel=sod(Date.now()); render(); }
    else if(a==="new") openEditor(null, st.sel);
    else if(a==="ics"){ download("turd-community.ics", toIcs(store.events)); toast("calendar exported (.ics)"); }
  });
  function move(dir){
    const d=new Date(st.cursor);
    if(st.view==="month"){ d.setDate(1); d.setMonth(d.getMonth()+dir); }
    else if(st.view==="week") d.setDate(d.getDate()+7*dir);
    else d.setDate(d.getDate()+30*dir);
    st.cursor=d.getTime(); render(dir);
  }

  /* ---- keyboard: ←/→, T, N, Esc (only while visible and not typing) ---- */
  const onKey = e=>{
    if(!host.isConnected || !host.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
    if(e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) return;
    if(e.key==="Escape" && drawer.classList.contains("on")){ closeDrawer(); return; }
    if(drawer.classList.contains("on")) return;
    if(e.key==="ArrowLeft") move(-1); else if(e.key==="ArrowRight") move(1);
    else if(e.key==="t"||e.key==="T"){ st.cursor=st.sel=sod(Date.now()); render(); }
    else if(e.key==="n"||e.key==="N"){ e.preventDefault(); openEditor(null, st.sel); }
  };
  addEventListener("keydown", onKey);

  /* ---- swipe months on touch ---- */
  let sx=null;
  body.addEventListener("touchstart",e=>{ sx=e.touches[0].clientX; },{passive:true});
  body.addEventListener("touchend",e=>{ if(sx==null) return; const dx=e.changedTouches[0].clientX-sx; sx=null; if(Math.abs(dx)>70) move(dx>0?-1:1); },{passive:true});

  /* ---- render ---- */
  function render(dir=0){
    if(!alive) return;
    $$(".cal-views .t-link",host).forEach(b=>b.classList.toggle("on", b.dataset.view===st.view));
    const c=new Date(st.cursor);
    $("#calTitle",host).innerHTML = st.view==="month"
      ? `${c.toLocaleDateString([], {month:"long"})} <span>${c.getFullYear()}</span>`
      : st.view==="week" ? (()=>{ const s=weekStart(st.cursor); return `${fmtDay(s,{month:"short",day:"numeric"})} – ${fmtDay(addDays(s,6),{month:"short",day:"numeric"})} <span>${new Date(s).getFullYear()}</span>`; })()
      : `Agenda <span>from ${fmtDay(st.cursor,{month:"short",day:"numeric"})}</span>`;
    body.dataset.mode=st.view;
    body.innerHTML = st.view==="month" ? monthHtml() : st.view==="week" ? weekHtml() : agendaHtml();
    if(dir && !reduced()) body.animate([{opacity:0, transform:`translateX(${dir*28}px)`},{opacity:1, transform:"none"}],{duration:280, easing:"cubic-bezier(.2,.8,.2,1)"});
    if(st.view==="week"){ const sc=$(".cw-scroll",body); if(sc) sc.scrollTop = 7.5*HOUR_PX; }
    renderNext(); renderSync();
  }
  function renderSync(){
    const t=store.transport, el=$("#calSync",host); if(!el) return;
    el.className="cal-sync "+(t&&t.kind==="server"?"live":"local");
    el.textContent = t&&t.kind==="server" ? "● live" : "● demo";
    el.title = t&&t.kind==="server" ? "Synced with everyone through the T.U.R.D. server" : "Local demo — events sync between tabs on this device until the server is deployed";
  }

  /* next-up hero band */
  function renderNext(){
    const el=$("#calNext",host), list=upcoming(3);
    if(!list.length){ el.innerHTML=`<div class="cn-empty"><b>Nothing scheduled.</b> Be the one who plans something. <button class="t-link" data-act="new">Add an event ▸</button></div>`; return; }
    const [a,...rest]=list;
    el.innerHTML = `<button class="cn-main" data-open="${esc(a.id)}" data-s="${a.start}" style="--cc:${a.color}">
        <div class="cn-date"><b>${new Date(a.start).getDate()}</b><span>${fmtDay(a.start,{month:"short"})}</span></div>
        <div class="cn-info"><div class="cn-k">${a.live?"Happening now":"Next up"} · ${esc(countdown(a.start))}</div>
          <div class="cn-t">${esc(a.title)}</div>
          <div class="cn-s">${esc(fmtDay(a.start,{weekday:"long"}))} · ${esc(whenText(a))}${a.where?` · ${esc(a.where)}`:""}${a.going?` · <b>${a.going} going</b>`:""}</div></div>
      </button>
      ${rest.map(o=>`<button class="cn-mini" data-open="${esc(o.id)}" data-s="${o.start}" style="--cc:${o.color}"><span>${esc(fmtDay(o.start))}${o.allDay?"":" · "+esc(fmtTime(o.start))}</span><b>${esc(o.title)}</b></button>`).join("")}`;
  }

  /* ---- month ---- */
  function monthStart(t){ const d=new Date(t); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); }
  function weekStart(t){ const d=new Date(sod(t)); d.setDate(d.getDate()-d.getDay()); return d.getTime(); }
  function monthHtml(){
    const m0=monthStart(st.cursor), month=new Date(m0).getMonth(), g0=weekStart(m0);
    const weeks = Math.ceil((sod(addDays(monthStart(addDays(m0,32)),0))-g0)/DAY/7);
    const today=sod(Date.now()), H=body.clientHeight||560, rowH=Math.max(84,(H-34)/weeks);
    const maxLanes=Math.max(1,Math.floor((rowH-34)/22));
    let html=`<div class="cm-dow">${[0,1,2,3,4,5,6].map(i=>`<span>${fmtDay(addDays(g0,i),{weekday:innerWidth<760?"narrow":"short"})}</span>`).join("")}</div><div class="cm-grid" style="--weeks:${weeks}">`;
    for(let w=0; w<weeks; w++){
      const ws=addDays(g0,7*w), we=addDays(ws,7);
      const occ=expand(store.events, ws, we);
      const lanes=[], placed=[], hidden=new Array(7).fill(0);
      for(const o of occ){
        const a=Math.max(0, Math.round((sod(Math.max(o.s,ws))-ws)/DAY));
        const overnight=!o.ev.allDay && o.e-o.s<DAY;                       // 11pm–1am stays a one-day chip
        const b=overnight ? a : Math.min(6, Math.round((sod(Math.min(o.e-1,we-1))-ws)/DAY));
        if(overnight && o.s<ws) continue;                                    // shown on its start day only
        let lane=0; while(lanes[lane] && lanes[lane].some(([x,y])=>!(b<x||a>y))) lane++;
        if(lane>=maxLanes){ for(let i=a;i<=b;i++) hidden[i]++; continue; }
        (lanes[lane]=lanes[lane]||[]).push([a,b]); placed.push({o,a,b,lane, cutL:o.s<ws, cutR:o.e>we});
      }
      html+=`<div class="cm-week"><div class="cm-bg">`;
      for(let i=0;i<7;i++){
        const d=addDays(ws,i), dd=new Date(d);
        html+=`<div class="cm-day${dd.getMonth()!==month?" out":""}${d===today?" today":""}${d===st.sel?" sel":""}" data-day="${d}">
          <span class="cm-num">${dd.getDate()===1?fmtDay(d,{month:"short"})+" ":""}${dd.getDate()}</span>
          ${hidden[i]?`<button class="cm-more" data-more="${d}" title="Show all">+${hidden[i]}</button>`:""}<i class="cm-add" title="Add event">＋</i></div>`;
      }
      html+=`</div><div class="cm-fg">`;
      for(const p of placed){
        const o=p.o, c=catOf(o.ev).color, multi=o.ev.allDay||p.b>p.a;
        html+=`<button class="cm-ev${multi?" bar":""}${p.cutL?" cutl":""}${p.cutR?" cutr":""}${o.e<Date.now()?" past":""}" style="--cc:${c};grid-column:${p.a+1}/${p.b+2};grid-row:${p.lane+2}" data-open="${esc(o.ev.id)}" data-s="${o.s}" title="${esc(o.ev.title)}">
          ${multi?"":`<i></i><time>${esc(fmtTime(o.s).replace(":00","").replace(" ",""))}</time>`}<b>${esc(o.ev.title)}</b>${o.ev.repeat!=="none"?`<em>↻</em>`:""}</button>`;
      }
      html+=`</div></div>`;
    }
    return html+`</div>`;
  }

  /* ---- week (time grid) ---- */
  const HOUR_PX=46;
  function weekHtml(){
    const ws=weekStart(st.cursor), we=addDays(ws,7), today=sod(Date.now()), now=Date.now();
    const occ=expand(store.events, ws, we), allDay=occ.filter(o=>o.ev.allDay||o.e-o.s>=DAY), timed=occ.filter(o=>!(o.ev.allDay||o.e-o.s>=DAY));
    let h=`<div class="cw"><div class="cw-head"><span></span>${[0,1,2,3,4,5,6].map(i=>{ const d=addDays(ws,i); return `<button class="cw-dh${d===today?" today":""}${d===st.sel?" sel":""}" data-day="${d}"><span>${fmtDay(d,{weekday:"short"})}</span><b>${new Date(d).getDate()}</b></button>`; }).join("")}</div>
      <div class="cw-all"><span>all day</span><div class="cw-allrow">${allDay.map(o=>{ const a=Math.max(0,Math.round((sod(Math.max(o.s,ws))-ws)/DAY)), b=Math.min(6,Math.round((sod(Math.min(o.e-1,we-1))-ws)/DAY));
        return `<button class="cm-ev bar" style="--cc:${catOf(o.ev).color};grid-column:${a+1}/${b+2}" data-open="${esc(o.ev.id)}" data-s="${o.s}"><b>${esc(o.ev.title)}</b></button>`; }).join("")}</div></div>
      <div class="cw-scroll"><div class="cw-grid" style="height:${24*HOUR_PX}px"><div class="cw-hours">${Array.from({length:24},(_,i)=>`<span style="top:${i*HOUR_PX}px">${i?new Date(2000,0,1,i).toLocaleTimeString([], {hour:"numeric"}):""}</span>`).join("")}</div>`;
    for(let i=0;i<7;i++){
      const d0=addDays(ws,i), d1=addDays(d0,1);
      const items=timed.filter(o=>o.s<d1 && o.e>d0).map(o=>({o, top:Math.max(0,(o.s-d0)/36e5), bot:Math.min(24,(o.e-d0)/36e5)}));
      // overlap columns
      const cols=[]; items.forEach(it=>{ let c=0; while(cols[c] && cols[c]>it.top+1e-6) c++; cols[c]=it.bot; it.col=c; });
      items.forEach(it=>{ it.n=Math.max(1,...items.filter(x=>x.top<it.bot&&x.bot>it.top).map(x=>x.col+1)); });
      h+=`<div class="cw-col${d0===today?" today":""}" data-day="${d0}">${items.map(it=>`<button class="cw-ev" style="--cc:${catOf(it.o.ev).color};top:${it.top*HOUR_PX}px;height:${Math.max(22,(it.bot-it.top)*HOUR_PX-3)}px;left:calc(${it.col/it.n*100}% + 3px);width:calc(${100/it.n}% - 6px)" data-open="${esc(it.o.ev.id)}" data-s="${it.o.s}"><b>${esc(it.o.ev.title)}</b><span>${esc(fmtTime(it.o.s))}${it.o.ev.where?" · "+esc(it.o.ev.where):""}</span></button>`).join("")}
        ${d0===today?`<i class="cw-now" style="top:${(now-d0)/36e5*HOUR_PX}px"></i>`:""}</div>`;
    }
    return h+`</div></div></div>`;
  }

  /* ---- agenda ---- */
  function agendaHtml(){
    const from=sod(st.cursor), occ=expand(store.events, from, addDays(from,60));
    if(!occ.length) return `<div class="ca-empty"><b>Nothing in the next 60 days.</b><span>Tap ＋ New event to put something on everyone's calendar.</span></div>`;
    const days=new Map(); occ.forEach(o=>{ const k=sod(Math.max(o.s,from)); (days.get(k)||days.set(k,[]).get(k)).push(o); });
    const today=sod(Date.now());
    return `<div class="ca">${[...days].map(([d,list])=>`<div class="ca-day${d===today?" today":""}">
      <div class="ca-date"><b>${new Date(d).getDate()}</b><span>${esc(fmtDay(d,{weekday:"short"}))}</span><em>${esc(fmtDay(d,{month:"short"}))}</em></div>
      <div class="ca-list">${list.map(o=>{ const going=Object.values(o.ev.rsvp||{}).filter(v=>v==="going").length, mine=(o.ev.rsvp||{})[user()];
        return `<button class="ca-ev${o.e<Date.now()?" past":""}" style="--cc:${catOf(o.ev).color}" data-open="${esc(o.ev.id)}" data-s="${o.s}">
          <time>${esc(o.ev.allDay?"All day":fmtTime(o.s))}</time><div><b>${esc(o.ev.title)}</b><span>${esc(catOf(o.ev).label)}${o.ev.where?" · "+esc(o.ev.where):""} · by ${esc(o.ev.by)}</span></div>
          <em>${mine==="going"?"You're in ✓":going?going+" going":""}</em></button>`; }).join("")}</div></div>`).join("")}</div>`;
  }

  /* ---- interactions in the body ---- */
  body.addEventListener("click", e=>{
    const ev=e.target.closest("[data-open]");
    if(!ev && drawer.classList.contains("on")){ closeDrawer(); return; }   // click-away closes the drawer first
    if(ev){ openDetail(ev.dataset.open, +ev.dataset.s); return; }
    const more=e.target.closest("[data-more]"); if(more){ st.cursor=st.sel=+more.dataset.more; st.view="agenda"; render(); return; }
    const col=e.target.closest(".cw-col"); if(col){ const r=col.getBoundingClientRect(); const hrs=Math.floor(((e.clientY-r.top)/HOUR_PX)*2)/2; openEditor(null, +col.dataset.day, hrs); return; }
    const day=e.target.closest("[data-day]"); if(day){
      const d=+day.dataset.day;
      if(e.target.closest(".cm-add") || (st.sel===d && st.view==="month")) openEditor(null,d);
      else { st.sel=d; if(st.view==="week"){ st.cursor=d; } render(); }
    }
  });
  $("#calNext",host).addEventListener("click", e=>{ const b=e.target.closest("[data-open]"); if(b) openDetail(b.dataset.open, +b.dataset.s); });

  /* ---- drawer: detail ---- */
  function closeDrawer(){ drawer.classList.remove("on"); drawer.setAttribute("aria-hidden","true"); st.open=st.editing=null; }
  function openDrawer(html){ host.style.setProperty("--drawer-top", body.offsetTop+"px"); drawer.innerHTML=`<button class="cd-x" data-x aria-label="Close">✕</button>`+html; drawer.classList.add("on"); drawer.setAttribute("aria-hidden","false"); $("[data-x]",drawer).onclick=closeDrawer; }
  function openDetail(id, s){
    const ev=store.events.find(x=>x.id===id); if(!ev){ toast("that event was removed"); return; }
    st.open={id,s}; st.editing=null;
    const occS=isFinite(s)?s:ev.start, occE=occS+(ev.end-ev.start), c=catOf(ev);
    const r=ev.rsvp||{}, going=Object.keys(r).filter(k=>r[k]==="going"), maybe=Object.keys(r).filter(k=>r[k]==="maybe"), mine=r[user()];
    const can=ev.by===user()||isAdmin();
    openDrawer(`<div class="cd" style="--cc:${c.color}">
      <div class="cd-cat"><i></i>${esc(c.label)}${ev.repeat!=="none"?` · ${esc(REPEATS[ev.repeat])}`:""}</div>
      <h3>${esc(ev.title)}</h3>
      <div class="cd-when"><b>${esc(fmtDay(occS,{weekday:"long", month:"long", day:"numeric"}))}</b><span>${esc(whenText({start:occS,end:occE,allDay:ev.allDay}))} · ${esc(countdown(occS))}</span></div>
      ${ev.where?`<div class="cd-row"><span>Where</span><p>${esc(ev.where)}</p></div>`:""}
      ${ev.notes?`<div class="cd-row"><span>Details</span><p class="cd-notes">${esc(ev.notes)}</p></div>`:""}
      <div class="cd-row"><span>Posted by</span><p>${esc(ev.by)}${ev.demo?` <small class="muted">(demo)</small>`:""}</p></div>
      <div class="cd-rsvp"><div class="t-cap">Who's in · ${going.length} going${maybe.length?` · ${maybe.length} maybe`:""}</div>
        <div class="cd-people">${going.map(u=>`<span class="cd-av" title="${esc(u)} · going">${esc(u.slice(0,2).toUpperCase())}</span>`).join("")}${maybe.map(u=>`<span class="cd-av maybe" title="${esc(u)} · maybe">${esc(u.slice(0,2).toUpperCase())}</span>`).join("")}${!going.length&&!maybe.length?`<p class="t-s">Nobody yet. Be first.</p>`:""}</div>
        <div class="cd-rbtns"><button class="t-btn sm${mine==="going"?" on":""}" data-r="going">${mine==="going"?"✓ I'm in":"I'm in"}</button>
          <button class="t-link${mine==="maybe"?" on":""}" data-r="maybe">Maybe</button>${mine?`<button class="t-link" data-r="">Can't make it</button>`:""}</div></div>
      <div class="cd-foot"><button class="t-link" data-a="ics">Add to my calendar</button>
        ${can?`<button class="t-link" data-a="edit">Edit</button><button class="t-link cd-del" data-a="del">Delete</button>`:""}</div></div>`);
    $$("[data-r]",drawer).forEach(b=>b.onclick=async()=>{ const v=b.dataset.r||null; try{ await store.rsvp(id,user(),v===mine?null:v); toast(v==="going"?"you're in ✓":v==="maybe"?"marked maybe":"RSVP removed"); }catch(e){ toast("couldn't RSVP: "+e.message); } });
    $$("[data-a]",drawer).forEach(b=>b.onclick=async()=>{
      const a=b.dataset.a;
      if(a==="ics"){ download(ev.title.replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").toLowerCase()+".ics", toIcs([ev])); toast("saved .ics, open it to add"); }
      if(a==="edit") openEditor(ev);
      if(a==="del"){
        if(b.dataset.confirm!=="1"){ b.dataset.confirm="1"; b.textContent=ev.repeat!=="none"?"Delete whole series?":"Really delete?"; setTimeout(()=>{ if(b.isConnected){ b.dataset.confirm=""; b.textContent="Delete"; } },3500); return; }
        try{ await store.del(id); closeDrawer(); toast("event deleted"); }catch(e){ toast("couldn't delete: "+e.message); }
      }
    });
  }

  /* ---- drawer: editor ---- */
  function openEditor(ev, day, hour){
    const isNew=!ev, d0=day||sod(Date.now());
    const nowH=new Date().getHours()+1;
    const startT = ev ? ev.start : (hour!=null ? d0+hour*36e5 : d0+Math.min(Math.max(nowH, 9), 21)*36e5);
    const e = ev || { title:"", start:startT, end:startT+2*36e5, allDay:false, cat:"meetup", where:"", notes:"", repeat:"none" };
    st.editing=e.id||"new";
    const endDay = e.allDay ? e.end-DAY : e.end;
    openDrawer(`<form class="ce" autocomplete="off" novalidate>
      <div class="t-cap">${isNew?"New community event":"Edit event"}</div>
      <input class="ce-title" name="title" maxlength="120" placeholder="What's happening?" value="${esc(e.title)}" required>
      <div class="ce-cats">${Object.entries(CATS).map(([k,c])=>`<label class="ce-cat" style="--cc:${c.color}"><input type="radio" name="cat" value="${k}" ${e.cat===k?"checked":""}><i></i>${c.label}</label>`).join("")}</div>
      <label class="ce-check"><input type="checkbox" name="allDay" ${e.allDay?"checked":""}><span>All day</span></label>
      <div class="ce-2"><div><label>Starts</label><input type="date" name="sd" value="${ymd(e.start)}" required></div><div class="ce-time"><label>&nbsp;</label><input type="time" name="st" value="${hm(e.start)}"></div></div>
      <div class="ce-2"><div><label>Ends</label><input type="date" name="ed" value="${ymd(endDay)}" required></div><div class="ce-time"><label>&nbsp;</label><input type="time" name="et" value="${hm(e.end)}"></div></div>
      <div><label>Where</label><input name="where" maxlength="160" placeholder="Voice channel, address, link…" value="${esc(e.where)}"></div>
      <div><label>Repeats</label><select name="repeat">${Object.entries(REPEATS).map(([k,v])=>`<option value="${k}" ${e.repeat===k?"selected":""}>${v}</option>`).join("")}</select></div>
      <div><label>Details</label><textarea name="notes" rows="3" maxlength="2000" placeholder="Anything people should know">${esc(e.notes)}</textarea></div>
      <div class="ce-msg" id="ceMsg"></div>
      <div class="ce-foot"><button type="button" class="t-link" data-cancel>Cancel</button><button class="t-btn" type="submit">${isNew?"Post to calendar":"Save changes"}</button></div>
      <p class="t-s ce-note">Everyone signed in to T.U.R.D. can see community events.</p></form>`);
    const f=$("form",drawer), allDay=f.elements.allDay;
    const markCat=()=>$$(".ce-cat",f).forEach(l=>l.classList.toggle("on",l.querySelector("input").checked));
    $$(".ce-cat input",f).forEach(i=>i.onchange=markCat); markCat();
    const sync=()=>f.classList.toggle("allday", allDay.checked); allDay.onchange=sync; sync();
    f.elements.sd.onchange=()=>{ if(f.elements.ed.value<f.elements.sd.value) f.elements.ed.value=f.elements.sd.value; };
    f.elements.st.onchange=()=>{ if(f.elements.ed.value===f.elements.sd.value && f.elements.et.value<=f.elements.st.value){ const t=parseLocal(f.elements.sd.value,f.elements.st.value)+2*36e5; f.elements.et.value=hm(t); f.elements.ed.value=ymd(t); } };
    $("[data-cancel]",f).onclick=()=> ev ? openDetail(ev.id) : closeDrawer();
    setTimeout(()=>f.elements.title.focus(),60);
    f.onsubmit=async x=>{
      x.preventDefault(); const F=f.elements, msg=$("#ceMsg",f);
      const title=F.title.value.trim(); if(!title){ msg.textContent="Give it a name."; F.title.focus(); return; }
      let start, end;
      if(F.allDay.checked){ start=parseLocal(F.sd.value); end=addDays(parseLocal(F.ed.value),1); }
      else { start=parseLocal(F.sd.value,F.st.value||"00:00"); end=parseLocal(F.ed.value,F.et.value||F.st.value); }
      if(!isFinite(start)||!isFinite(end)){ msg.textContent="Check the dates."; return; }
      if(end<=start){ msg.textContent="It has to end after it starts."; return; }
      if(end-start>62*DAY){ msg.textContent="Keep events under two months long."; return; }
      const next=clean({...(ev||{}), title, start, end, allDay:F.allDay.checked, cat:F.cat.value, where:F.where.value, notes:F.notes.value, repeat:F.repeat.value, by:ev?ev.by:user(), rsvp:ev?ev.rsvp:{[user()]:"going"}, demo:false}, user());
      const btn=$("button[type=submit]",f); btn.disabled=true; btn.textContent="Posting…";
      try{ let saved=await store.put(next);
        if(isNew && !(saved.rsvp||{})[user()]){ try{ await store.rsvp(saved.id,user(),"going"); saved=store.events.find(x=>x.id===saved.id)||saved; }catch(_){} } // servers that drop client RSVPs on create
        toast(isNew?"posted to the community calendar":"event updated");
        st.cursor=st.sel=sod(saved.start); render(); openDetail(saved.id, saved.start); burst(saved);
      }catch(err){ msg.textContent="Couldn't save: "+err.message; btn.disabled=false; btn.textContent=isNew?"Post to calendar":"Save changes"; }
    };
  }

  /* little glow pulse on the event that just landed */
  function burst(ev){
    if(reduced()) return;
    requestAnimationFrame(()=>$$(`[data-open="${CSS.escape(ev.id)}"]`,body).forEach(el=>el.animate([{boxShadow:`0 0 0 0 ${catOf(ev).color}`},{boxShadow:`0 0 0 10px transparent`}],{duration:900,iterations:2})));
  }

  /* ---- live updates ---- */
  const offStore = store.on(msg=>{
    if(!alive) return;
    if(st.editing===null) render(); else renderNext();
    if(st.open && st.editing===null){ if(store.events.some(e=>e.id===st.open.id)) openDetail(st.open.id, st.open.s); else { closeDrawer(); toast("that event was removed"); } }
    if(msg && msg.remote && msg.op==="put" && msg.event && msg.event.by!==user() && msg.event.created>Date.now()-15e3) toast(`${msg.event.by} added “${msg.event.title}”`);
  });

  let lastW=0, lastH=0;
  ro=new ResizeObserver(([e])=>{ const {width,height}=e.contentRect; if(Math.abs(width-lastW)>40||Math.abs(height-lastH)>40){ lastW=width; lastH=height; if(st.view==="month") render(); } });
  ro.observe(body);
  tick=setInterval(()=>{ renderNext(); if(st.view==="week"){ const n=$(".cw-now",body); if(n){ n.style.top=(Date.now()-sod(Date.now()))/36e5*HOUR_PX+"px"; } } }, 30e3);

  render();
  store.init(opts.transport).then(()=>{
    if(!alive) return; render();
    // deep-link from Home's upcoming strip
    const f=LSx.get(FOCUS,null); if(f && Date.now()-f.at<15e3){ LSx.set(FOCUS,null); st.cursor=st.sel=sod(f.s); render(); openDetail(f.id, f.s); }
  });

  return ()=>{ alive=false; offStore(); removeEventListener("keydown",onKey); ro&&ro.disconnect(); clearInterval(tick); };
}

/* ===========================================================================
   Home: "Upcoming community events" strip
   =========================================================================== */
export function renderUpcomingStrip(el, ctx={}, {n=4, hostSection="chat"}={}){
  ensureCss();
  if(el._calOff) el._calOff();                       // Home re-calls this on every redraw
  let off=()=>{}, t=0, seen=false;
  const stop=()=>{ off(); clearInterval(t); el._calOff=null; };
  const draw=()=>{
    if(!el.isConnected){ if(seen) stop(); return; }   // Home replaced its DOM → drop our listeners
    seen=true;
    const list=upcoming(n);
    el.classList.add("cal-strip");
    el.innerHTML = `<div class="cs-head"><span class="t-k">Community calendar</span><button class="t-link" data-go>Open calendar ▸</button></div>
      <div class="cs-row">${list.length?list.map((o,i)=>`<button class="cs-ev${i===0?" first":""}" style="--cc:${o.color}" data-id="${esc(o.id)}" data-s="${o.start}">
        <div class="cs-date"><b>${new Date(o.start).getDate()}</b><span>${esc(fmtDay(o.start,{month:"short"}))}</span></div>
        <div class="cs-info"><em>${esc(o.live?"happening now":countdown(o.start))}</em><b>${esc(o.title)}</b>
        <span>${esc(fmtDay(o.start,{weekday:"short"}))} · ${esc(o.allDay?"all day":fmtTime(o.start))}${o.going?` · ${o.going} going`:""}</span></div></button>`).join("")
        : `<p class="t-s cs-empty">No community events yet. <button class="t-link" data-go>Plan one ▸</button></p>`}</div>`;
    $$("[data-go]",el).forEach(b=>b.onclick=()=>ctx.show && ctx.show(hostSection));
    $$(".cs-ev",el).forEach(b=>b.onclick=()=>{ LSx.set(FOCUS,{id:b.dataset.id, s:+b.dataset.s, at:Date.now()}); ctx.show && ctx.show(hostSection); });
  };
  draw();
  off=store.on(draw); store.init().then(draw);
  t=setInterval(draw, 60e3);
  el._calOff=stop;
  return stop;
}

export default { mountCalendar, renderUpcomingStrip, upcoming, subscribe, addEvent, removeEvent, summary, countdown, CATS, localTransport, remoteTransport, expand, clean };
