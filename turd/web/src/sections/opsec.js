// OPSEC / Privacy — defensive hardening checklist for the operator's OWN devices.
// Owned by the core/tools thread. Self-registers via the section contract.
import { edgeFades } from "./util.js";

const ITEMS = [
  ["Full-disk encryption on","BitLocker (Windows) / file-based encryption (Android) so a lost device can't be read."],
  ["Screen lock + biometric","Short auto-lock timeout with PIN/biometric fallback."],
  ["OS + app updates current","Patch promptly — most real compromises are known, already-fixed bugs."],
  ["App permission review","Revoke location/mic/camera from apps that don't need them."],
  ["DNS / tracker filtering","Encrypted DNS or a filtering resolver to cut tracking and malicious domains."],
  ["VPN on untrusted Wi-Fi","Tunnel traffic on public networks you don't control."],
  ["Unique passkeys + manager","No reuse; a password manager + hardware/passkey where possible."],
  ["2FA on key accounts","App-based or hardware 2FA, not SMS, on email + financial logins."],
  ["Radios off when idle","Bluetooth/Wi-Fi off when unused = fewer passive-tracking handles on you."],
  ["Encrypted backups","So recovery never means lowering your security."],
];
function score(LS){ const d=LS.get("turd_opsec",{}); return Math.round(ITEMS.filter((_,i)=>d[i]).length/ITEMS.length*100); }
let stopFades=()=>{};

export default {
  id:"opsec", icon:"⛨", label:"OPSEC",
  theme:{ accent:"#2fe0c0", accent2:"#0f9e86", rgb:"47,224,192" },
  mount(el, ctx){
    const { LS, head, esc } = ctx;
    el.classList.add("t-full","t-sec-ops");
    stopFades(); stopFades=edgeFades(el);
    const render=()=>{
      const done=LS.get("turd_opsec",{}), pct=score(LS), n=ITEMS.filter((_,i)=>done[i]).length;
      el.innerHTML=head("OPSEC / Privacy","OPS","defensive · your devices")+`
        <div class="ops-wrap">
          <div class="t-card ops-score"><div class="t-cap">Hardening score</div>
            <div class="ops-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" class="bg"/><circle cx="60" cy="60" r="50" class="fg" style="stroke-dasharray:${3.14*pct} 314;${pct?"":"opacity:0"}"/></svg>
              <div><b>${pct}%</b><span>${n} / ${ITEMS.length} done</span></div></div>
            <p class="t-s">Defensive privacy checklist for devices you own. Nothing here scans or touches anyone else.</p></div>
          <div class="t-card ops-list"><div class="t-cap">Checklist</div>`+ITEMS.map((o,i)=>`<button class="check ${done[i]?"on":""}" data-i="${i}" aria-pressed="${!!done[i]}"><span class="box">${done[i]?"✓":""}</span>
            <span class="txt"><b>${esc(o[0])}</b><span>${esc(o[1])}</span></span></button>`).join("")+`</div>
        </div>`;
      el.querySelectorAll(".check").forEach(b=>b.onclick=()=>{ const d=LS.get("turd_opsec",{}); const i=b.dataset.i; d[i]=!d[i]; LS.set("turd_opsec",d); render(); });
    };
    render();
  },
  unmount(){ stopFades(); stopFades=()=>{}; },
  summary(ctx){ return { title:"OPSEC", value:score(ctx.LS)+"%", note:"hardening" }; },
};
/* inline styles this module relies on (checklist rows) */
(function(){ if(document.getElementById("opsec-css")) return;
  const s=document.createElement("style"); s.id="opsec-css"; s.textContent=`
  .ops-wrap{display:grid;grid-template-columns:320px 1fr;gap:22px;align-items:start;padding-inline:10px}
  .ops-score{position:sticky;top:0}
  .ops-ring{position:relative;width:170px;height:170px;margin:10px auto 16px}
  .ops-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
  .ops-ring circle{fill:none;stroke-width:9}.ops-ring .bg{stroke:rgba(255,255,255,.08)}
  .ops-ring .fg{stroke:var(--accent);stroke-linecap:round;filter:drop-shadow(0 0 8px var(--accent));transition:stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)}
  .ops-ring>div{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
  .ops-ring b{font-size:40px;color:#fff;font-weight:600;line-height:1}
  .ops-ring span{font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-dim);margin-top:4px}
  .check{display:flex;align-items:flex-start;gap:14px;width:100%;text-align:left;background:none;border:0;cursor:pointer;color:inherit;font-family:var(--font);
    padding:12px 8px;border-radius:12px;transition:background .2s;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,.07) 15%,rgba(255,255,255,.07) 85%,transparent);background-size:100% 1px;background-repeat:no-repeat;background-position:bottom}
  .check:last-child{background-image:none}
  .check:hover{background-color:rgba(var(--accent-rgb),.06)}
  .check .box{flex:0 0 22px;height:22px;border:2px solid rgba(var(--accent-rgb),.55);border-radius:7px;display:grid;place-items:center;transition:.2s;margin-top:1px;color:#04121a;font-size:13px;font-weight:700}
  .check.on .box{background:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent)}
  .check .txt b{display:block;font-size:15px;color:var(--ink);font-weight:600}
  .check .txt>span{font-size:13px;color:var(--ink-dim);line-height:1.45}
  .check.on .txt b{color:#fff}
  @media(max-width:1100px){.ops-wrap{grid-template-columns:1fr}.ops-score{position:static}}`;
  document.head.appendChild(s);
})();
