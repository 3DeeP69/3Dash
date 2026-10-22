// ===========================================================================
// PADNAV: console-style controller navigation for the whole app (tidy-up thread).
//
//   D-pad / left stick   move focus to the nearest control in that direction
//                        (on the rail: ▲ ▼ switch sections, ▶ jumps into the section)
//   A (Cross)            press the focused control
//   B (Circle)           close the open pop-up, or step back out to the rail
//   LB / RB              previous / next section (the shell's step(), core.js)
//
// Stays out of the way while something else owns the pad: window.TURD_OVERLAY
// (Customize Home, Before-you-go) and window.TURD_IDLE (ambient screen wakes on
// any press). Mouse, touch or a typed key leaves pad mode, so the focus glow only
// shows while you're actually using a controller.
// ===========================================================================
window.TURD_PADNAV = true;

const FOCUSABLE = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),.navbtn';
const $ = (s, r = document) => r.querySelector(s);
let raf = 0, prev = {}, held = null, repeatAt = 0, padMode = false, last = null;

function visible(el) {
  if (el.disabled || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.opacity !== "0" && cs.pointerEvents !== "none";
}
function scopeRoots() {
  const login = $("#login:not(.hide)");
  if (login) return [login];
  const modal = $("#modal.show");
  if (modal) return [modal];
  const vm = $("#st-voice.menu .vm"); if (vm) return [vm];
  const sec = $(".section.show");
  return [sec, $("#rail"), $("#st-tools"), $("#st-voice")].filter(Boolean);
}
const candidates = () => scopeRoots().flatMap(r => [...r.querySelectorAll(FOCUSABLE)]).filter(visible);
const inSection = el => !!el?.closest?.(".section.show");
const onRail = el => !!el?.classList?.contains("navbtn");

function setPadMode(on) {
  if (padMode === on) return; padMode = on;
  document.body.classList.toggle("pad-mode", on);
  const hint = $("#padhint"); if (hint) hint.hidden = !on;
}
function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  last = { el, id: el.id, tag: el.tagName, text: el.textContent.trim().slice(0, 40), sec: el.closest(".section")?.id };
  el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/* a section that re-renders (Projects after a status check, say) swaps its buttons out from
   under the focus; pick the same control back up in the new markup instead of losing it */
function restore() {
  if (!padMode || !last || last.el.isConnected) return;
  const a = document.activeElement; if (a && a !== document.body) return;
  const sec = last.sec && document.getElementById(last.sec);
  const twin = (last.id && document.getElementById(last.id)) ||
    (sec && [...sec.querySelectorAll(last.tag)].find(e => e.textContent.trim().slice(0, 40) === last.text));
  if (twin && visible(twin)) focusEl(twin); else last = null;
}

/* nearest control in a direction: distance along the axis + 2x the sideways offset,
   so moving ▶ prefers what's level with you over something closer but far below */
function move(dx, dy) {
  const cur = document.activeElement, list = candidates();
  if (!cur || cur === document.body || !list.includes(cur)) {
    const first = list.find(inSection) || list.find(onRail) || list[0];
    return focusEl(first);
  }
  if (onRail(cur) && dy) {                                     // rail: ▲ ▼ = previous / next section
    const rail = list.filter(onRail), i = rail.indexOf(cur), nx = rail[i + dy];
    if (nx) { nx.click(); focusEl(nx); }
    return;
  }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  // from the rail, ▶ always lands inside the shown section; inside a section, ▲ ▼ stay in it
  // (running off the end scrolls the panel; ◀ or B is the way back to the rail)
  const pool = (onRail(cur) && dx > 0) || (inSection(cur) && dy) ? (list.some(inSection) ? list.filter(inSection) : list) : list;
  for (const el of pool) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = dx ? (bx - ax) * dx : (by - ay) * dy;
    // must actually lie in that direction (edges, not just centres, so wide rows still work)
    const ahead = dx ? (dx > 0 ? b.left >= a.right - 4 : b.right <= a.left + 4) : (dy > 0 ? b.top >= a.bottom - 4 : b.bottom <= a.top + 4);
    if (!ahead || along <= 0) continue;
    const side = dx ? Math.max(0, Math.abs(by - ay) - (a.height + b.height) / 4) : Math.max(0, Math.abs(bx - ax) - (a.width + b.width) / 4);
    const score = along + side * 2 + (inSection(cur) && !inSection(el) ? 120 : 0);   // leaving the section costs a little
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) focusEl(best);
  else if (!dx && inSection(cur)) {                            // ran off the top/bottom: scroll the panel instead
    const p = cur.closest(".panel"); if (p) p.scrollBy({ top: dy * innerHeight * 0.4, behavior: "smooth" });
  }
}

function press() {
  const el = document.activeElement;
  if (!el || el === document.body) return move(0, 0);
  if (el.matches("input[type=checkbox],input[type=radio],button,a,summary,.navbtn,[role=button],[role=tab],[role=switch]")) { el.click(); return; }
  if (el.matches("select")) { try { el.showPicker?.(); } catch (e) {} return; }
  if (el.matches("input,textarea")) { el.focus(); return; }                         // on-screen keyboard / typing
  el.click();
}
function back() {
  const modal = $("#modal.show");
  if (modal || $("#st-voice.menu")) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const close = modal && [...modal.querySelectorAll("button")].find(b => /^(close|done|cancel|×|✕)$/i.test(b.textContent.trim()));
    if (close && $("#modal.show")) close.click();
    return;
  }
  const el = document.activeElement;
  if (el && el.matches("input,textarea,select")) { el.blur(); return; }
  if (inSection(el) || !el || el === document.body) focusEl($(".navbtn.active"));
}

function poll() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (!pads.length) { raf = 0; return; }
  const idle = window.TURD_IDLE, busy = window.TURD_OVERLAY;
  let dir = null, any = false;
  for (const p of pads) {
    const b = n => !!p.buttons[n]?.pressed;
    const hit = n => { const k = p.index + ":" + n, on = b(n), was = prev[k]; prev[k] = on; return on && !was; };
    const ax = p.axes?.[0] || 0, ay = p.axes?.[1] || 0;
    const d = b(12) || ay < -0.6 ? [0, -1] : b(13) || ay > 0.6 ? [0, 1] : b(14) || ax < -0.6 ? [-1, 0] : b(15) || ax > 0.6 ? [1, 0] : null;
    if (d) dir = d;
    const A = hit(0), B = hit(1); [4, 5, 12, 13, 14, 15].forEach(hit);
    if (A || B || d) any = true;
    if (idle || busy) continue;
    if (A) press();
    if (B) back();
  }
  if (any && !idle) setPadMode(true);
  restore();
  if (!idle && !window.TURD_OVERLAY && dir) {                  // D-pad / stick with hold-to-repeat
    const now = performance.now(), key = dir.join();
    if (held !== key) { held = key; repeatAt = now + 380; move(dir[0], dir[1]); }
    else if (now >= repeatAt) { repeatAt = now + 110; move(dir[0], dir[1]); }
  } else if (!dir) held = null;
  raf = requestAnimationFrame(poll);
}
function start() { if (!raf && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) raf = requestAnimationFrame(poll); }

function injectUI() {
  if ($("#padnav-css")) return;
  const s = document.createElement("style"); s.id = "padnav-css";
  s.textContent = `
  body.pad-mode :focus{outline:2px solid rgba(var(--accent-rgb),.95)!important;outline-offset:3px;box-shadow:0 0 0 6px rgba(var(--accent-rgb),.18),0 0 26px rgba(var(--accent-rgb),.45)!important;transition:outline-offset .15s,box-shadow .2s}
  body.pad-mode .navbtn:focus{outline-offset:-3px}
  #padhint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9;display:flex;gap:18px;font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-dim);pointer-events:none;white-space:nowrap}
  #padhint[hidden]{display:none}
  #padhint b{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 4px;margin-right:6px;border-radius:9px;border:1px solid rgba(var(--accent-rgb),.55);color:var(--ink);font-weight:500;font-size:9px;letter-spacing:0}
  @media(max-width:760px){ #padhint{bottom:calc(104px + env(safe-area-inset-bottom,0px))} }`;
  document.head.appendChild(s);
  const h = document.createElement("div"); h.id = "padhint"; h.hidden = true; h.setAttribute("aria-hidden", "true");
  h.innerHTML = `<span><b>A</b>select</span><span><b>B</b>back</span><span><b>LB</b><b>RB</b>sections</span>`;
  document.body.appendChild(h);
}
const leave = () => setPadMode(false);
["pointerdown", "wheel", "touchstart"].forEach(ev => addEventListener(ev, leave, { passive: true, capture: true }));
addEventListener("keydown", e => { if (padMode && !e.isTrusted) return; if (padMode) leave(); }, true);
addEventListener("gamepadconnected", () => { injectUI(); start(); });
if (document.readyState === "loading") addEventListener("DOMContentLoaded", () => { injectUI(); start(); }); else { injectUI(); start(); }

export default { start };
