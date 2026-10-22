// ===========================================================================
// COMMUNITY PAGE LAYOUT — the community calendar as the big centerpiece with
// chat docked beside it (stacked with a Calendar / Chat switch on phones).
//
// Used by the chat section (src/sections/chat.js):
//   import { mountCommunity } from "../community/page.js";
//   mount(panel, ctx){ this._off = mountCommunity(panel, ctx, { title:"Community", mountChat: el => renderChatInto(el, ctx) }); }
//   unmount(){ this._off && this._off(); }
// mountChat(el) may return a cleanup function.
// ===========================================================================
import { mountCalendar, upcoming, countdown, subscribe } from "./calendar.js";

const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function mountCommunity(panel, ctx={}, { title="Community", key="COM", mountChat, transport }={}){
  const pane = (()=>{ try{ return localStorage.getItem("turd_com_pane")||"cal"; }catch(e){ return "cal"; } })();
  const next = upcoming(1)[0];
  panel.classList.add("t-full","com-panel");
  panel.innerHTML = `
    <div class="phead t-phead com-head"><span class="k">${esc(key)}</span><h1>${esc(title)}</h1>
      <span class="sub" id="comSub">${next?`next: ${esc(next.title)} · ${esc(countdown(next.start))}`:"calendar + chat"}</span></div>
    <div class="com-switch" role="tablist">
      <button class="t-link" data-pane="cal" role="tab">Calendar</button>
      <button class="t-link" data-pane="chat" role="tab">Chat</button>
    </div>
    <div class="com-layout" data-pane="${pane}">
      <section class="com-cal" id="comCal" aria-label="Community calendar"></section>
      <section class="com-chat" id="comChat" aria-label="Chat"></section>
    </div>`;
  const layout=panel.querySelector(".com-layout");
  const setPane=p=>{ layout.dataset.pane=p; panel.querySelectorAll("[data-pane]").forEach(b=>b.tagName==="BUTTON"&&b.classList.toggle("on",b.dataset.pane===p)); try{ localStorage.setItem("turd_com_pane",p); }catch(e){} };
  panel.querySelectorAll(".com-switch [data-pane]").forEach(b=>b.onclick=()=>setPane(b.dataset.pane));
  setPane(pane);

  const offCal = mountCalendar(panel.querySelector("#comCal"), ctx, { transport });
  const sub = panel.querySelector("#comSub");
  const drawSub = ()=>{ const n=upcoming(1)[0]; sub.textContent = n ? `next: ${n.title} · ${countdown(n.start)}` : "calendar + chat"; };
  const offSub = subscribe(drawSub), subT = setInterval(drawSub, 60e3);
  let offChat = null;
  const chatEl = panel.querySelector("#comChat");
  if(typeof mountChat==="function"){ try{ offChat = mountChat(chatEl); }catch(e){ chatEl.innerHTML=`<p class="t-s">Chat failed to load: ${esc(e.message)}</p>`; } }
  else chatEl.innerHTML=`<div class="com-chat-empty"><b>Chat</b><p class="t-s">Chat connects here once the chat module is loaded.</p></div>`;

  // a calendar deep-link from Home should always land on the calendar pane
  try{ if(JSON.parse(localStorage.getItem("turd_cal_focus")||"null")) setPane("cal"); }catch(e){}

  return ()=>{ offSub(); clearInterval(subT); offCal&&offCal(); typeof offChat==="function"&&offChat(); };
}

export default { mountCommunity };
