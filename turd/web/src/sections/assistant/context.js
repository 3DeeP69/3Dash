// ===========================================================================
// ASSISTANT · context + hands. Builds the compact dashboard snapshot the model
// reads ("what do I need to know") and carries out the actions it asks for:
// open a section, log/complete a task, add a calendar event, set a reminder.
// Everything here reads the app's own localStorage-backed modules; each source
// is optional, so a missing module just drops out of the snapshot.
// ===========================================================================
import { LS } from "../util.js";
import * as WX from "../wxdata.js";
import { entries as logEntries, stats as logStats, quickAdd } from "../logbook.js";

let cal = null;
const loadCal = ()=> cal ??= import("../../community/calendar.js").catch(()=>null);
loadCal();

const clip = (s,n)=>{ s=String(s||"").replace(/\s+/g," ").trim(); return s.length>n? s.slice(0,n-1)+"…" : s; };
const ago = t=>{ const s=(Date.now()-t)/1000; return s<90?"just now":s<5400?Math.round(s/60)+"m ago":s<129600?Math.round(s/3600)+"h ago":Math.round(s/86400)+"d ago"; };
const when = t=> new Date(t).toLocaleString([], {weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
const offset = ()=>{ const m=-new Date().getTimezoneOffset(), s=m>=0?"+":"-", a=Math.abs(m); return `${s}${String(Math.floor(a/60)).padStart(2,"0")}:${String(a%60).padStart(2,"0")}`; };

/* ------------------------------------------------------------ snapshot */
// Minute-resolution clock so an unchanged dashboard yields an identical
// snapshot within the minute (the server skips repeats to keep the cache warm).
export async function snapshot(ctx){
  const L=[];
  const d=new Date();
  L.push(`now: ${d.toLocaleDateString([], {weekday:"long", year:"numeric", month:"long", day:"numeric"})}, ${d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})} (${Intl.DateTimeFormat().resolvedOptions().timeZone||"local"}, UTC${offset()})`);
  const s=ctx?.session; if(s?.user) L.push(`operator: ${s.user}${s.role==="admin"?" (admin)":""}`);
  try{ const ids=(ctx?.sections?.()||[]).map(x=>x.id); if(ids.length) L.push(`sections: ${ids.join(", ")}`); }catch(e){}

  try{
    const w=WX.brief(WX.cached());
    if(w){
      const parts=[`${w.temp}${w.U} (feels ${w.feels}°), ${w.label.toLowerCase()}`, `high ${w.hi}° low ${w.lo}°`, `wind ${w.wind} ${w.windU}`,
        w.rain?`rain ${w.rain.p}% around ${new Date(w.rain.t).toLocaleTimeString([], {hour:"numeric"})}`:"no rain expected in 12h"];
      if(w.aqi!=null) parts.push(`AQI ${w.aqi}`); if(w.uv!=null) parts.push(`UV ${Math.round(w.uv)}`);
      L.push(`weather (${w.loc}, updated ${ago(w.t)}${w.stale?", stale":""}): ${parts.join("; ")}`);
      if(w.alerts?.length) L.push(`weather alerts: ${w.alerts.slice(0,3).map(a=>clip(a.event+(a.headline?" — "+a.headline:""),140)).join(" | ")}`);
      if(w.next?.length) L.push(`next hours: ${w.next.map(h=>`${new Date(h.t).toLocaleTimeString([], {hour:"numeric"})} ${h.v}°${h.p>=30?` ${h.p}%`:""}`).join(", ")}`);
    }
  }catch(e){}

  try{
    const l=logEntries(LS), st=logStats(l);
    const open=l.filter(e=>e.cat==="task"&&!e.done).sort((a,b)=>b.t-a.t);
    L.push(`open tasks (${open.length}): ${open.length?"":"none"}`);
    open.slice(0,8).forEach(e=>L.push(`  - ${clip(e.txt,110)} (${ago(e.t)})`));
    const pinned=l.filter(e=>e.pinned).slice(0,4);
    if(pinned.length){ L.push(`pinned notes:`); pinned.forEach(e=>L.push(`  - ${clip(e.txt,120)}`)); }
    const recent=l.filter(e=>!e.pinned&&e.cat!=="task").sort((a,b)=>b.t-a.t).slice(0,4);
    if(recent.length){ L.push(`recent log:`); recent.forEach(e=>L.push(`  - [${e.cat}] ${clip(e.txt,110)} (${ago(e.t)})`)); }
    if(st.streak>1) L.push(`logbook streak: ${st.streak} days`);
  }catch(e){}

  try{
    const m=await loadCal();
    const up=m?.upcoming ? m.upcoming(6) : [];
    if(up.length){ L.push(`upcoming events:`); up.forEach(o=>L.push(`  - ${clip(o.title,80)} — ${o.allDay?new Date(o.start).toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"})+" (all day)":when(o.start)}${o.live?" (happening now)":""}${o.where?` @ ${clip(o.where,50)}`:""}${o.going?`, ${o.going} going`:""}`)); }
    else if(m) L.push(`upcoming events: none`);
  }catch(e){}

  try{
    const st=LS.get("turd_prj_status",{}), names={"3dms":"3D MS","3dtn":"3D TN"};
    const rows=Object.entries(st).filter(([,v])=>v&&v.t).map(([k,v])=>`${names[k]||k} ${v.up?`online ${v.ms}ms`:"DOWN"}`);
    if(rows.length) L.push(`projects: ${rows.join("; ")}`);
  }catch(e){}

  const rem=reminders().filter(r=>r.at>Date.now()).slice(0,5);
  if(rem.length) L.push(`reminders set: ${rem.map(r=>`${clip(r.text,60)} at ${when(r.at)}`).join("; ")}`);
  return L.join("\n");
}

/* ------------------------------------------------------------ reminders (survive reloads) */
const RKEY="turd_as_reminders";
export const reminders = ()=> LS.get(RKEY,[]);
const timers=new Map();
let onFire = r=>{};
export function onReminder(fn){ onFire=fn; }
function arm(r){
  if(timers.has(r.id)) return;
  const ms=r.at-Date.now(); if(ms>2**31-1) return;            // > ~24 days: re-armed on a later load
  timers.set(r.id, setTimeout(()=>fire(r), Math.max(0,ms)));
}
function fire(r){
  timers.delete(r.id); LS.set(RKEY, reminders().filter(x=>x.id!==r.id));
  try{ window.TURD?.toast?.("⏰ "+r.text); }catch(e){}
  try{ if("Notification" in window && Notification.permission==="granted") new Notification("T.U.R.D. reminder",{body:r.text, silent:false}); }catch(e){}
  try{ onFire(r); }catch(e){}
}
export function armAll(){ reminders().forEach(arm); }
armAll();

/* ------------------------------------------------------------ actions */
const words = s=> String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const short = s=> clip(s,60);
const CATLABEL={note:"note",task:"task",mission:"mission",idea:"idea",alert:"alert"};

// Returns { content (for the model), label (receipt shown to the person), is_error }
export async function act(name, input, ctx){
  try{
    switch(name){
      case "open_section": {
        const id=String(input.section||"").toLowerCase().trim();
        const sec=(ctx.sections?.()||[]).find(x=>x.id===id || (x.label||"").toLowerCase()===id);
        if(!sec) return { is_error:true, content:`No section "${id}". Available: ${(ctx.sections?.()||[]).map(x=>x.id).join(", ")}`, label:`Couldn't find “${id}”` };
        setTimeout(()=>ctx.show(sec.id), 900);                      // let the confirmation land first
        return { content:`Opened ${sec.label||sec.id}.`, label:`Opening ${sec.label||sec.id}` };
      }
      case "add_log": {
        const cat=CATLABEL[input.category]?input.category:"note";
        quickAdd(ctx, String(input.text).slice(0,2000), cat);
        return { content:`Added ${cat}: ${input.text}`, label:`Added ${cat} “${short(input.text)}”` };
      }
      case "complete_task": {
        const l=LS.get("turd_log",[]), want=new Set(words(input.match));
        let best=null, score=0;
        for(const e of l){ if(e.cat!=="task"||e.done) continue; const w=words(e.txt); const sc=w.filter(x=>want.has(x)).length/Math.max(1,want.size); if(sc>score){ score=sc; best=e; } }
        if(!best || score<0.34) return { is_error:true, content:`No open task matches "${input.match}".`, label:`No open task matched “${short(input.match)}”` };
        best.done=true; LS.set("turd_log",l);
        return { content:`Marked done: ${best.txt}`, label:`Done: “${short(best.txt)}”` };
      }
      case "add_event": {
        const m=await loadCal(); if(!m?.addEvent) return { is_error:true, content:"Calendar isn't available in this build.", label:"Calendar unavailable" };
        const start=Date.parse(input.start); let end=input.end?Date.parse(input.end):NaN;
        if(!isFinite(end)||end<=start) end=start+(input.all_day?864e5:2*3600e3);
        const ev=await m.addEvent({ title:String(input.title).slice(0,120), start, end, allDay:!!input.all_day, cat:input.category||"other", where:input.where||"" }, ctx.session?.user);
        return { content:`Event added: ${ev?.title||input.title} at ${when(start)}`, label:`On the calendar: “${short(input.title)}” · ${when(start)}` };
      }
      case "set_reminder": {
        let at=input.at?Date.parse(input.at):NaN;
        if(!isFinite(at) && isFinite(input.in_minutes)) at=Date.now()+Math.max(0.1,+input.in_minutes)*60e3;
        if(!isFinite(at) || at<Date.now()-60e3) return { is_error:true, content:"That time is in the past or unreadable.", label:"Couldn't read that time" };
        const r={ id:"r"+Date.now().toString(36), at, text:String(input.text).slice(0,300) };
        LS.set(RKEY,[...reminders(), r]); arm(r);
        try{ if("Notification" in window && Notification.permission==="default") Notification.requestPermission(); }catch(e){}
        const rel=Math.round((at-Date.now())/60e3);
        return { content:`Reminder set for ${when(at)}.`, label:`Reminder · ${rel<60?`in ${Math.max(1,rel)} min`:when(at)} · “${short(r.text)}”` };
      }
    }
    return { is_error:true, content:`Unknown action ${name}`, label:"" };
  }catch(e){ return { is_error:true, content:"Action failed: "+(e.message||e), label:"Action failed" }; }
}
