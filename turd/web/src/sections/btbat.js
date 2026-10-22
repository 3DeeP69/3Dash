// ===========================================================================
// GADGET BATTERIES card for Home — controllers, earbuds, headsets that are
// already paired/connected and report a battery level. NON-INVASIVE by design:
//   · only exists when the native app offers window.TURD_NATIVE.bt.batteries()
//     (read-only, no scan, no permission prompt — installers thread)
//   · renders nothing at all unless ≥1 device reports a numeric level
//   · hidden in Customize too while empty (no placeholder, no "connect" prompt)
// Polls every 3 min while Home is on screen, and when the app comes back.
// ===========================================================================
import { registerCard, getCard } from "./homecards.js";

const bridge = ()=> (typeof window!=="undefined" && typeof window.TURD_NATIVE?.bt?.batteries==="function") ? window.TURD_NATIVE.bt : null;
const GLYPH = { controller:"🎮", earbuds:"🎧", headset:"🎧", other:"◉" };
const lvl = v=> v<=10?"hot":v<=25?"warm":"";
const ring = p=>`<svg viewBox="0 0 36 36" class="pc-ring ${lvl(p)}"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${Math.max(0,Math.min(100,p))*.942} 94.2"/></svg>`;

async function read(){
  const b=bridge(); if(!b) return [];
  try{
    const r=await Promise.race([b.batteries(), new Promise(res=>setTimeout(()=>res([]),4000))]);
    return (Array.isArray(r)?r:[]).filter(d=>d && Number.isFinite(+d.level)).slice(0,8)
      .map(d=>({ name:String(d.name||"Device").slice(0,40), kind:GLYPH[d.kind]?d.kind:"other", level:Math.round(Math.max(0,Math.min(100,+d.level))), charging:!!d.charging }));
  }catch(e){ return []; }
}

function html(list, esc){
  if(!list.length) return "";
  return `<div class="pc-strip bt-strip"><span class="pc-k">⌁ Gadgets</span>${list.map(d=>
    `<span class="pc-m" title="${esc(d.name)}${d.charging?" · charging":""}">${ring(d.level)}<b class="${d.charging?"":lvl(d.level)}">${d.level}%${d.charging?`<small> ⚡</small>`:""}</b><em>${GLYPH[d.kind]} ${esc(d.name)}</em></span>`).join("")}</div>`;
}

export function registerBatteries(){
  if(getCard("btbat") || !bridge()) return;
  registerCard({ id:"btbat", label:"Gadget batteries", icon:"⌁", kind:"strip", order:27, quiet:true,
    mount(body, K){
      let t=0, dead=false;
      const paint=async()=>{ if(dead || document.hidden) return; const l=await read(); if(!dead) body.innerHTML=html(l, K.esc); };
      const vis=()=>{ if(!document.hidden) paint(); };
      paint(); t=setInterval(paint, 3*60e3); document.addEventListener("visibilitychange",vis);
      return { refresh(){}, destroy(){ dead=true; clearInterval(t); document.removeEventListener("visibilitychange",vis); } };
    } });
}
registerBatteries();
