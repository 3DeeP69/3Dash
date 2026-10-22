import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]
c=P(root+'/src/core.js')
# 1) typing "audit" inside a text field no longer pops the log
c.rep('''addEventListener("keydown",e=>{ if(/^[a-z]$/i.test(e.key)){''','''addEventListener("keydown",e=>{ if(/^[a-z]$/i.test(e.key) && !e.target.closest?.("input,textarea,select,[contenteditable]")){''')
# 2) admin-only Access log link + Lock, 3) console-style section switching
c.rep('''  buildStage(); buildNav(); BOOTED=true;
  const first=orderedIds()[0];''','''  buildStage(); buildNav(); BOOTED=true; buildSessionTools();
  const first=orderedIds()[0];''')
c.rep('''function forcePassChange(user){''','''/* status-bar tools: Access log exists in the DOM only for admins; Lock is for everyone */
function buildSessionTools(){
  const bar=$("#status .rstat"); if(!bar || $("#st-tools")) return;
  const t=document.createElement("span"); t.id="st-tools";
  t.innerHTML=(SESSION&&SESSION.role==="admin"?`<button class="st-btn" id="stAudit" title="Admin-only access log">⛨ Access log</button>`:"")+
    `<button class="st-btn" id="stLock" title="Lock T.U.R.D. and return to the login deck">⏻ Lock</button>`;
  bar.prepend(t);
  const a=$("#stAudit"); if(a) a.onclick=openAudit;
  $("#stLock").onclick=()=>{ SESSION=null; location.reload(); };
}
/* console-style navigation: [ ] or PageUp/PageDown switch sections, arrows move along the rail,
   and a gamepad's D-pad / LB-RB does the same */
function step(d){ const ids=orderedIds(); if(!ids.length) return; const i=Math.max(0,ids.indexOf(current)); const id=ids[(i+d+ids.length)%ids.length];
  show(id); const b=$(`.navbtn[data-go="${id}"]`); if(b && document.activeElement?.classList.contains("navbtn")) b.focus(); }
addEventListener("keydown",e=>{
  if(!BOOTED || $("#modal").classList.contains("show") || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.target.closest?.("input,textarea,select,[contenteditable],iframe")) return;
  const onRail=e.target.classList?.contains("navbtn");
  if(e.key==="]"||e.key==="PageDown"||(onRail&&(e.key==="ArrowDown"||e.key==="ArrowRight"))){ e.preventDefault(); step(1); }
  else if(e.key==="["||e.key==="PageUp"||(onRail&&(e.key==="ArrowUp"||e.key==="ArrowLeft"))){ e.preventDefault(); step(-1); }
});
let padRaf=0; const padPrev={};
function pollPad(){
  const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];
  if(!pads.length){ padRaf=0; return; }
  pads.forEach(p=>{ const hit=n=>{ const on=!!p.buttons[n]?.pressed, was=padPrev[p.index+":"+n]; padPrev[p.index+":"+n]=on; return on&&!was; };
    if(BOOTED && !$("#modal").classList.contains("show")){ if(hit(13)||hit(5)) step(1); if(hit(12)||hit(4)) step(-1); }
    else { hit(13); hit(5); hit(12); hit(4); } });
  padRaf=requestAnimationFrame(pollPad);
}
addEventListener("gamepadconnected",()=>{ if(!padRaf) padRaf=requestAnimationFrame(pollPad); });
function forcePassChange(user){''')
c.save()
i=P(root+'/index.html')
i.rep('''</style>
<!-- section modules''','''/* the status bar sat under #stage (same z-index, earlier in the DOM), so the shown section's
   full-screen box swallowed taps on the wordmark; lift it (it stays pointer-events:none except its controls) */
#status{z-index:9}
/* status-bar session tools (Access log for admins, Lock for everyone): text-style, no pills */
#st-tools{display:inline-flex;gap:4px;margin-right:6px;pointer-events:auto}
.st-btn{background:none;border:0;color:var(--ink-dim);font:inherit;letter-spacing:inherit;text-transform:uppercase;cursor:pointer;padding:8px 6px;transition:color .2s,text-shadow .2s}
.st-btn:hover,.st-btn:focus-visible{outline:none;color:var(--ink);text-shadow:0 0 12px rgba(var(--accent-rgb),.8)}
#stAudit{color:#ff8a9c}#stAudit:hover{color:#fff;text-shadow:0 0 12px rgba(255,92,122,.8)}
@media(max-width:760px){ #st-tools{position:fixed;top:calc(36px + var(--sat,0px));left:16px;margin:0;font-size:9px} .st-btn{padding:6px 6px 6px 0} }
</style>
<!-- section modules''')
i.save()
