// ===========================================================================
// LOGBOOK — mission journal: typed entries (note/task/mission/idea/alert),
// #tags, pins, task check-off, search, day-grouped timeline, 15-week
// activity heatmap, streaks, weather stamp, undo, JSON export/import.
// Storage: turd_log — keeps the shell's original {t, txt} shape compatible.
// ===========================================================================
import { edgeFades, kit, $, $$, head, tilt, ago, dayKey, countUp } from "./util.js";
import { cached as wxCached, brief as wxBrief } from "./wxdata.js";

let K, panel, stopTilt=()=>{}, filter={cat:"all", q:"", tag:null}, undo=null, editing=null;

export const CATS = {
  note:   {label:"Note",    glyph:"✎", color:"#ff9a1f"},
  task:   {label:"Task",    glyph:"☐", color:"#2f8cff"},
  mission:{label:"Mission", glyph:"◆", color:"#3ddc4a"},
  idea:   {label:"Idea",    glyph:"✦", color:"#c86bff"},
  alert:  {label:"Alert",   glyph:"▲", color:"#ff4d5e"},
};

/* ------------------------------------------------------------ data */
export function entries(LSx){
  const L=LSx||K.LS;
  let l=L.get("turd_log",[]), dirty=false;
  l=l.map((e,i)=>{ if(e.id) return e; dirty=true;   // migrate shell-era {t, txt}
    return {id:"e"+e.t.toString(36)+i, t:e.t, txt:e.txt||"", cat:"note", tags:tagsOf(e.txt||""), pinned:false, done:false}; });
  if(dirty) L.set("turd_log",l);
  return l;
}
const save = l=> K.LS.set("turd_log", l);
const tagsOf = s=> [...new Set((String(s).match(/#[\p{L}\p{N}_-]{1,30}/gu)||[]).map(t=>t.slice(1).toLowerCase()))];

export function stats(l){
  const today=dayKey(Date.now()), days=new Set(l.map(e=>dayKey(e.t)));
  let streak=0; const d=new Date(); if(!days.has(today)) d.setDate(d.getDate()-1);
  while(days.has(dayKey(d.getTime()))){ streak++; d.setDate(d.getDate()-1); }
  return { total:l.length, today:l.filter(e=>dayKey(e.t)===today).length, streak,
    open:l.filter(e=>e.cat==="task"&&!e.done).length, pinned:l.filter(e=>e.pinned), last:l.slice().sort((a,b)=>b.t-a.t)[0]||null };
}

/* ------------------------------------------------------------ markup */
function fmt(txt){
  // escape first, then light formatting: **bold**, `code`, #tags, links
  return K.esc(txt)
    .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]{1,30})/gu,'$1<button class="lg-tag" data-tag="$2">#$2</button>');
}

function heatmap(l){
  const counts={}; l.forEach(e=>{ const k=dayKey(e.t); counts[k]=(counts[k]||0)+1; });
  const weeks=15, start=new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-start.getDay()-(weeks-1)*7);
  let cells="";
  for(let w=0;w<weeks;w++) for(let d=0;d<7;d++){
    const day=new Date(start); day.setDate(start.getDate()+w*7+d);
    if(day>new Date()) { cells+=`<i class="f"></i>`; continue; }
    const n=counts[dayKey(day.getTime())]||0, lv=n===0?0:n<2?1:n<4?2:n<7?3:4;
    cells+=`<i class="l${lv}" title="${day.toLocaleDateString()} · ${n} entr${n===1?"y":"ies"}"></i>`;
  }
  return `<div class="lg-heat" style="grid-template-columns:repeat(${weeks},1fr)">${cells}</div>`;
}

function item(e){
  const c=CATS[e.cat]||CATS.note;
  if(editing===e.id) return `<div class="lg-item editing" data-id="${e.id}" style="--cc:${c.color}">
      <textarea class="lg-edit" rows="3">${K.esc(e.txt)}</textarea>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px"><button class="t-link" data-act="cancel">Cancel</button><button class="t-btn sm" data-act="saveEdit">Save</button></div></div>`;
  return `<div class="lg-item ${e.done?"done":""} ${e.pinned?"pinned":""}" data-id="${e.id}" style="--cc:${c.color}">
    <div class="lg-node">${e.cat==="task"?`<button class="lg-check ${e.done?"on":""}" data-act="done" title="Mark done">${e.done?"✓":""}</button>`:`<span>${c.glyph}</span>`}</div>
    <div class="lg-main">
      <div class="lg-meta"><span class="lg-cat">${c.label}</span><span>${new Date(e.t).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span>
        ${e.wx?`<span class="lg-wx">${K.esc(e.wx)}</span>`:""}${e.pinned?`<span class="lg-pin-l">pinned</span>`:""}</div>
      <div class="lg-txt">${fmt(e.txt)}</div>
    </div>
    <div class="lg-acts"><button data-act="pin" title="${e.pinned?"Unpin":"Pin"}">${e.pinned?"◉":"○"}</button><button data-act="edit" title="Edit">✎</button><button data-act="del" title="Delete">✕</button></div>
  </div>`;
}

function timeline(l){
  let list=l.slice().sort((a,b)=>b.t-a.t);
  if(filter.cat!=="all") list=list.filter(e=>filter.cat==="open"?(e.cat==="task"&&!e.done):e.cat===filter.cat);
  if(filter.tag) list=list.filter(e=>(e.tags||[]).includes(filter.tag));
  if(filter.q){ const q=filter.q.toLowerCase(); list=list.filter(e=>e.txt.toLowerCase().includes(q)); }
  if(!list.length) return `<div class="t-empty sm"><h3>${l.length?"Nothing matches":"Your logbook is empty"}</h3><p class="muted">${l.length?"Try a different filter or search.":"Write your first entry above. Tag it with #words, flip it to a Task, pin what matters."}</p></div>`;
  const pins=list.filter(e=>e.pinned), rest=list.filter(e=>!e.pinned);
  let html=pins.length?`<div class="lg-day"><div class="lg-dh">Pinned</div>${pins.map(item).join("")}</div>`:"";
  let cur=null, buf="";
  const today=dayKey(Date.now()), yest=dayKey(Date.now()-864e5);
  rest.forEach(e=>{ const k=dayKey(e.t);
    if(k!==cur){ if(cur) buf+=`</div>`; cur=k;
      const lbl=k===today?"Today":k===yest?"Yesterday":new Date(e.t).toLocaleDateString([], {weekday:"long",month:"short",day:"numeric"});
      buf+=`<div class="lg-day"><div class="lg-dh">${lbl}</div>`; }
    buf+=item(e); });
  if(cur) buf+=`</div>`;
  return html+buf;
}

/* ------------------------------------------------------------ render */
function render(keepComposer){
  const l=entries(), s=stats(l);
  const draft=keepComposer?$("#lgIn",panel)?.value:K.LS.get("turd_log_draft","");
  const cat=keepComposer?($(".lg-type.on",panel)?.dataset.c||"note"):"note";
  const tags=[...new Set(l.flatMap(e=>e.tags||[]))].slice(0,14);
  panel.innerHTML = head("Logbook","LOG",`<span class="wx-tools"><button class="t-link" id="lgExp">⇩ Export</button><label class="t-link" style="margin:0">⇧ Import<input type="file" id="lgImp" accept="application/json" hidden></label></span>`)+`
    <div class="lg-wrap">
      <div class="lg-side t-l">
        <div class="lg-stats">
          <div class="t-tile t-tilt"><div class="t-k">Entries</div><div class="t-v" id="lgS1">0</div></div>
          <div class="t-tile t-tilt"><div class="t-k">Today</div><div class="t-v" id="lgS2">0</div></div>
          <div class="t-tile t-tilt"><div class="t-k">Streak</div><div class="t-v"><span id="lgS3">0</span><small> days</small></div></div>
          <div class="t-tile t-tilt"><div class="t-k">Open tasks</div><div class="t-v" id="lgS4">0</div></div>
        </div>
        <div class="t-card"><div class="t-cap">Activity · last 15 weeks</div>${heatmap(l)}</div>
        ${tags.length?`<div class="t-card"><div class="t-cap">Tags</div><div class="lg-tags">${tags.map(t=>`<button class="lg-tag ${filter.tag===t?"on":""}" data-tag="${K.esc(t)}">#${K.esc(t)}</button>`).join("")}</div></div>`:""}
      </div>
      <div class="lg-col">
        <div class="lg-composer t-curve">
          <div class="lg-types">${Object.entries(CATS).map(([k,c])=>`<button class="lg-type ${k===cat?"on":""}" data-c="${k}" style="--cc:${c.color}">${c.glyph} ${c.label}</button>`).join("")}</div>
          <textarea id="lgIn" rows="3" placeholder="What's happening? Use #tags, **bold**, links. Ctrl+Enter to record.">${K.esc(draft||"")}</textarea>
          <div class="lg-cbar"><label class="lg-wxopt"><input type="checkbox" id="lgWx" ${K.LS.get("turd_log_wx",true)?"checked":""}> stamp current weather</label>
            <button class="t-btn" id="lgAdd">Record entry</button></div>
        </div>
        <div class="lg-filter">
          <div class="lg-tabs">${[["all","All"],["open","Open tasks"],...Object.entries(CATS).map(([k,c])=>[k,c.label])].map(([k,n])=>`<button class="${filter.cat===k?"on":""}" data-f="${k}">${n}</button>`).join("")}</div>
          <input id="lgQ" placeholder="Search…" value="${K.esc(filter.q)}">
        </div>
        ${filter.tag?`<div class="lg-active-tag">Showing #${K.esc(filter.tag)} <button class="t-link" id="lgClrTag">clear</button></div>`:""}
        <div class="lg-list" id="lgList">${timeline(l)}</div>
      </div>
    </div>`;
  countUp($("#lgS1",panel),s.total); countUp($("#lgS2",panel),s.today); countUp($("#lgS3",panel),s.streak); countUp($("#lgS4",panel),s.open);
  wire();
  stopTilt(); stopTilt=tilt(panel,".t-tile",10);
}

function add(){
  const ta=$("#lgIn",panel), txt=ta.value.trim(); if(!txt){ ta.focus(); return; }
  const cat=$(".lg-type.on",panel)?.dataset.c||"note";
  let wx=null;
  if($("#lgWx",panel).checked){ const b=wxBrief(wxCached()); if(b && Date.now()-b.t<3*3600e3) wx=`${b.temp}${b.U.slice(0,2)} ${b.label.toLowerCase()} · ${b.loc}`; }
  const l=entries(); l.push({id:"e"+Date.now().toString(36), t:Date.now(), txt, cat, tags:tagsOf(txt), pinned:false, done:false, wx});
  save(l); K.LS.set("turd_log_draft",""); ta.value="";
  render(true); $("#lgIn",panel).value="";
  $(".lg-item",panel)?.classList.add("fresh");
  K.toast(`${CATS[cat].label.toLowerCase()} recorded`);
}

function act(id, a){
  const l=entries(), i=l.findIndex(e=>e.id===id); if(i<0) return;
  if(a==="del"){ undo={e:l[i], at:i}; l.splice(i,1); save(l); render(true); showUndo(); return; }
  if(a==="pin") l[i].pinned=!l[i].pinned;
  if(a==="done"){ l[i].done=!l[i].done; l[i].doneAt=l[i].done?Date.now():null; if(l[i].done) K.toast("task complete ✓"); }
  if(a==="edit"){ editing=id; render(true); const t=$(".lg-edit",panel); t.focus(); t.setSelectionRange(t.value.length,t.value.length); return; }
  if(a==="cancel"){ editing=null; render(true); return; }
  if(a==="saveEdit"){ const v=$(".lg-edit",panel).value.trim(); if(v){ l[i].txt=v; l[i].tags=tagsOf(v); l[i].edited=Date.now(); } editing=null; }
  save(l); render(true);
}

function showUndo(){
  let bar=$(".lg-undo",panel); if(bar) bar.remove();
  bar=document.createElement("div"); bar.className="lg-undo"; bar.innerHTML=`Entry deleted <button class="t-link">Undo</button>`;
  panel.appendChild(bar);
  bar.querySelector("button").onclick=()=>{ if(!undo) return; const l=entries(); l.splice(undo.at,0,undo.e); save(l); undo=null; render(true); };
  setTimeout(()=>{ bar.classList.add("out"); setTimeout(()=>bar.remove(),400); },6000);
}

function wire(){
  const ta=$("#lgIn",panel);
  ta.onkeydown=e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); add(); } };
  ta.oninput=()=>K.LS.set("turd_log_draft",ta.value);
  $("#lgAdd",panel).onclick=add;
  $("#lgWx",panel).onchange=e=>K.LS.set("turd_log_wx",e.target.checked);
  $$(".lg-type",panel).forEach(b=>b.onclick=()=>{ $$(".lg-type",panel).forEach(x=>x.classList.toggle("on",x===b)); ta.focus(); });
  $$("[data-f]",panel).forEach(b=>b.onclick=()=>{ filter.cat=b.dataset.f; render(true); });
  const q=$("#lgQ",panel); let deb;
  q.oninput=()=>{ clearTimeout(deb); deb=setTimeout(()=>{ filter.q=q.value; $("#lgList",panel).innerHTML=timeline(entries()); },160); };
  panel.onclick=e=>{
    const tg=e.target.closest("[data-tag]"); if(tg){ filter.tag=filter.tag===tg.dataset.tag?null:tg.dataset.tag; render(true); return; }
    const b=e.target.closest("[data-act]"); if(b){ act(b.closest(".lg-item").dataset.id, b.dataset.act); }
  };
  const ct=$("#lgClrTag",panel); if(ct) ct.onclick=()=>{ filter.tag=null; render(true); };
  $("#lgExp",panel).onclick=()=>{
    const blob=new Blob([JSON.stringify({app:"T.U.R.D.",kind:"logbook",exported:new Date().toISOString(),entries:entries()},null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`turd-logbook-${dayKey(Date.now())}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  };
  $("#lgImp",panel).onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    try{ const d=JSON.parse(await f.text()); const inc=(Array.isArray(d)?d:d.entries||[]).filter(x=>x&&x.t&&typeof x.txt==="string");
      const l=entries(), ids=new Set(l.map(x=>x.id)); let n=0;
      inc.forEach(x=>{ const id=x.id||("e"+x.t.toString(36)); if(!ids.has(id)){ l.push({cat:"note",tags:tagsOf(x.txt),pinned:false,done:false,...x,id}); n++; } });
      save(l); render(true); K.toast(`imported ${n} entr${n===1?"y":"ies"}`);
    }catch(err){ K.toast("that file isn't a T.U.R.D. logbook export"); }
  };
}

/* quick-add used by Home */
export function quickAdd(ctx, txt, cat="note"){
  const k=kit(ctx); const l=entries(k.LS);
  l.push({id:"e"+Date.now().toString(36), t:Date.now(), txt, cat, tags:tagsOf(txt), pinned:false, done:false});
  k.LS.set("turd_log",l);
}

let stopFades=()=>{};
export default {
  id:"logbook", icon:"✎", label:"Logbook",
  theme:{ accent:"#ff9a1f", accent2:"#ff5a00", rgb:"255,154,31", bg:"#170b02", bg2:"#2a1406" },
  mount(el, ctx){ K=kit(ctx); panel=el; stopFades(); stopFades=edgeFades(el); el.classList.add("t-full","t-sec-lg"); editing=null; render(false); },
  unmount(){ stopFades(); stopFades=()=>{}; stopTilt(); if(panel) panel.onclick=null; panel=null; },
  summary(ctx){ const k=kit(ctx); const l=entries(k.LS); return { ...stats(l),
    tasks:l.filter(e=>e.cat==="task"&&!e.done).sort((a,b)=>b.t-a.t).slice(0,4),
    recent:l.filter(e=>!e.pinned&&e.cat!=="task").sort((a,b)=>b.t-a.t).slice(0,3) }; },
};
