// ===========================================================================
// SPOKEN BRIEFING · reads the Home briefing aloud. Muted by default.
//   - "Read at login" (localStorage turd_brief_auto, default false): after the boot
//     chime settles and Home has its numbers, T.U.R.D. greets you and reads it.
//   - A speaker button sits in Home's greeting header: tap to play / stop any time.
//   - "Hey T.U.R.D., read my briefing" plays it too (wake.js routes it here).
// The words match what Home shows: Home can expose window.TURD_HOME.briefing() →
// plain text (and .pcLine() for the PC card); otherwise the on-screen sentence is
// used, and before Home has loaded, the assistant's offline briefing.
//   window.TURD_BRIEF = { play, stop, playing, auto, setAuto }
// Started by voice/wake.js init(). Owned by the assistant thread.
// ===========================================================================
import { speak, stop as hush, on as onSpeak } from "./speak.js";

const KEY = "turd_brief_auto";
let K = null, playing = false, starting = false, inited = false;
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const auto = () => LS.get(KEY, false) === true;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Hey, night owl" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Hey, night owl";
}
// written text → something that sounds natural out loud
function forEar(t) {
  return String(t || "")
    .replace(/\*\*/g, "").replace(/[▲▼●◆✓]/g, "")
    .replace(/\((\d+)%\)/g, ", $1 percent chance,").replace(/(\d+)%/g, "$1 percent")
    .replace(/(-?\d+)\s*°\s*F?\b/g, "$1 degrees").replace(/°/g, " degrees")
    .replace(/\bms\b/g, "milliseconds").replace(/\s*·\s*/g, ", ")
    .replace(/\s+([.,])/g, "$1").replace(/,\s*\./g, ".").replace(/\s+/g, " ").trim();
}
const homeReady = () => {
  const el = document.querySelector(".hm-brief");
  return el && el.textContent.trim() && !/Bringing systems online/i.test(el.textContent) ? el : null;
};
export async function compose() {
  const user = K?.session?.user && K.session.user !== "operator" ? K.session.user : "";
  let body = "";
  try { body = window.TURD_HOME?.briefing?.() || ""; } catch (e) {}
  if (!body) body = homeReady()?.innerText || "";
  if (!body) {
    try { const m = await import("../sections/assistant/local.js"); body = (await m.briefing("")).replace(/^[^.]*\.\s*/, ""); } catch (e) {}
  }
  let pc = ""; try { pc = window.TURD_HOME?.pcLine?.() || ""; } catch (e) {}
  return forEar(`${greeting()}${user ? ", " + user : ""}. ${body || "All systems are nominal."} ${pc}`);
}

export async function play() {
  if (playing) { stop(); return; }
  playing = true; paint();
  try { window.TURD_SFX?.select?.(); } catch (e) {}
  const text = await compose();
  if (!playing) return;
  starting = true; const p = speak(text, { onend: () => { playing = false; paint(); } }); starting = false;   // speak() hushes other speech first
  await p;
  playing = false; paint();
}
export function stop() { playing = false; hush(); paint(); }
export function setAuto(v) { LS.set(KEY, !!v); paint(); }

/* ------------------------------------------------------------- after login */
async function atLogin() {
  if (!auto()) return;
  // let the boot chime finish (core's promise; fixed delay if it isn't there)
  const done = window.TURD_SFX?.bootDone;
  if (done && typeof done.then === "function") await Promise.race([done, sleep(3500)]).then(() => sleep(250)); else await sleep(1700);
  const ready = () => { try { if (window.TURD_HOME?.briefing?.()) return true; } catch (e) {} return !!homeReady(); };
  for (let i = 0; i < 30 && !ready(); i++) await sleep(200);   // up to 6 s for Home's numbers
  await sleep(300);
  if (playing || window.TURD_VOICE?.state === "awake" || document.hidden) return;
  play();
}

/* ------------------------------------------------------------- Home control */
const CSS = `
.brf{display:flex;align-items:center;gap:14px;margin-top:12px;font:11px/1 var(--mono,ui-monospace,monospace);letter-spacing:1.6px;text-transform:uppercase;color:var(--ink-dim,#9fb0d0)}
.brf button{background:none;border:0;padding:6px 2px;margin:-6px 0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:color .2s,text-shadow .2s}
.brf button:hover,.brf button:focus-visible{outline:none;color:var(--ink,#fff);text-shadow:0 0 12px rgba(var(--accent-rgb),.8)}
.brf .play svg{width:18px;height:18px;flex:0 0 18px;color:var(--accent)}
.brf .play .w{opacity:.35;transition:opacity .2s}
.brf.on .play{color:var(--ink,#fff)}
.brf.on .play .w1{animation:brfw 1s ease-in-out infinite}
.brf.on .play .w2{animation:brfw 1s ease-in-out .25s infinite}
@keyframes brfw{0%,100%{opacity:.25}50%{opacity:1}}
.brf .auto b{font-weight:600;color:var(--ink-faint,#6a7a9a)}
.brf .auto.yes b{color:var(--accent);text-shadow:0 0 10px rgba(var(--accent-rgb),.6)}
.brf .sep{opacity:.5}
@media(prefers-reduced-motion:reduce){ .brf .play .w{animation:none!important;opacity:1} }`;
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fill-opacity=".18"/><path class="w w1" d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path class="w w2" d="M18.3 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>`;

function inject() {
  if (document.querySelector("[data-brief-ctl]")) return;
  const host = document.querySelector(".hm-top > div:first-child"); if (!host) return;
  const el = document.createElement("div"); el.className = "brf"; el.dataset.briefCtl = "";
  el.innerHTML = `<button class="play" title="Read the briefing aloud">${ICON}<span class="lbl">Play briefing</span></button>
    <span class="sep">·</span><button class="auto" role="switch" title="Read the briefing when you log in"><span>Read at login</span> <b></b></button>`;
  el.querySelector(".play").onclick = e => { e.stopPropagation(); play(); };
  el.querySelector(".auto").onclick = e => { e.stopPropagation(); setAuto(!auto()); K?.toast?.(auto() ? "briefing will play at login" : "briefing muted at login"); };
  host.appendChild(el); paint();
}
function paint() {
  for (const el of document.querySelectorAll("[data-brief-ctl]")) {
    el.classList.toggle("on", playing);
    el.querySelector(".lbl").textContent = playing ? "Stop" : "Play briefing";
    const a = el.querySelector(".auto"); a.classList.toggle("yes", auto()); a.setAttribute("aria-checked", auto()); a.querySelector("b").textContent = auto() ? "On" : "Off";
  }
}

export function init(ctx) {
  if (inited) return; inited = true; K = ctx;
  const st = document.createElement("style"); st.id = "brief-css"; st.textContent = CSS; document.head.appendChild(st);
  window.TURD_BRIEF = { play, stop, get playing() { return playing; }, get auto() { return auto(); }, setAuto, compose };
  // Home re-renders its greeting card often; keep the control attached
  new MutationObserver(() => { if (!document.querySelector("[data-brief-ctl]") && document.querySelector(".hm-top")) inject(); })
    .observe(document.getElementById("stage") || document.body, { childList: true, subtree: true });
  inject();
  onSpeak(v => { if (!v && playing && !starting) { playing = false; paint(); } });
  addEventListener("keydown", e => { if (e.key === "Escape" && playing) stop(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) stop(); });
  atLogin();
}
