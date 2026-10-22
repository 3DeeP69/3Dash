// ===========================================================================
// HOME CARD REGISTRY + LAYOUT — every block on Home is a "card" the owner can
// show, hide and reorder (Customize mode in home.js). Other threads plug their
// own cards in here instead of editing home.js:
//
//   import { registerCard } from "./homecards.js";        // or window.TURD_HOME_CARDS.register(def)
//   registerCard({
//     id:"np", label:"Now Playing", icon:"♪",
//     kind:"strip",              // "strip" = full width row · "tile" = shares a row (max 3) with other tiles
//     weight:1,                  // tiles only: relative width within its row
//     order:40,                  // default position for people who never customized (lower = higher up)
//     admin:false,               // true = only offered to admin operators
//     hiddenByDefault:false,
//     mount(el, ctx){ ...; return { refresh(){}, destroy(){} }; }   // el is the card body; both hooks optional
//   });
//
// A card whose body is empty (or whose only child is [hidden]) collapses on its
// own, so "nothing to show right now" cards never leave a gap.
//
// Layout: per device by default (turd_home_layout_dev, never synced). With
// "Same layout on all my devices" on (turd_home_follow, per device) it reads and
// writes turd_home_layout, which Device sync carries to the other devices.
// ===========================================================================
import { LS } from "./util.js";

const defs = new Map(), subs = new Set();
export function registerCard(def){
  if(!def || !def.id || typeof def.mount!=="function") return;
  defs.set(def.id, { kind:"strip", weight:1, order:50, label:def.id, icon:"▣", ...def });
  subs.forEach(f=>{ try{ f(); }catch(e){} });
}
export const cardList = ()=> [...defs.values()].sort((a,b)=>a.order-b.order);
export const getCard = id=> defs.get(id);
export const onCards = f=>{ subs.add(f); return ()=>subs.delete(f); };

// global hook for scripts that can't import (and anything queued before this loaded)
if(typeof window!=="undefined"){
  const q = Array.isArray(window.TURD_HOME_CARDS_Q) ? window.TURD_HOME_CARDS_Q : [];
  window.TURD_HOME_CARDS = { register: registerCard, list: cardList };
  q.forEach(registerCard); window.TURD_HOME_CARDS_Q = { push: registerCard };
}

/* ------------------------------------------------------------ layout */
const FOLLOW="turd_home_follow", DEV="turd_home_layout_dev", SHARED="turd_home_layout";
export const follows = ()=> !!LS.get(FOLLOW,false);

function normalize(saved){
  const order = Array.isArray(saved?.order) ? saved.order.filter((x,i,a)=>typeof x==="string" && a.indexOf(x)===i) : [];
  const hidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden : cardList().filter(c=>c.hiddenByDefault).map(c=>c.id));
  // cards the saved layout has never seen go where their default order puts them
  const dflt = cardList().map(c=>c.id);
  dflt.forEach((id,i)=>{
    if(order.includes(id)) return;
    let at=0; for(let j=i-1;j>=0;j--){ const k=order.indexOf(dflt[j]); if(k>=0){ at=k+1; break; } }
    order.splice(at,0,id);
    if(!saved && getCard(id)?.hiddenByDefault) hidden.add(id);
  });
  return { order, hidden };   // order keeps ids of cards not loaded right now, so they keep their spot
}
export function getLayout(){
  const f=follows();
  return normalize(LS.get(f?SHARED:DEV,null) || (f?LS.get(DEV,null):null));
}
export function saveLayout(l){
  LS.set(follows()?SHARED:DEV, { order:l.order, hidden:[...l.hidden], t:Date.now() });
}
export function setFollow(on){
  const mine=getLayout();
  LS.set(FOLLOW, !!on);
  if(on){ if(!LS.get(SHARED,null)) saveLayout(mine); }   // first device to opt in shares its layout; later ones adopt it
  else saveLayout(mine);                                   // keep what's on screen as this device's own layout
}
export function resetLayout(){ const l=normalize(null); saveLayout(l); return l; }
