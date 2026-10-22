// ===========================================================================
// One voice for the whole app (briefing, assistant, voice commands), so nothing
// talks over anything else. Uses the native TTS when the app bridge offers one
// (window.TURD_NATIVE.tts.speak), otherwise the browser's speechSynthesis.
//   speak(text, {onstart, onend, onboundary}) → Promise (resolves when done or stopped)
//   stop()   speaking()   on(fn) → off()   fn(true|false) when speech starts/stops
// window.TURD_SPEAK mirrors this for modules that don't import it (wake.js gate).
// ===========================================================================
const subs = new Set();
let active = false, cur = null;
const set = v => { if (active === v) return; active = v; for (const f of subs) { try { f(v); } catch (e) {} } };

export function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices(); if (!vs.length) return null;
  const pref = [/Google UK English Male/i, /Microsoft (Guy|Ryan|Andrew|Brian).*Online/i, /Daniel/i, /Google US English/i, /en-GB/i, /en-US/i];
  for (const p of pref) { const v = vs.find(v => p.test(v.name) || p.test(v.lang)); if (v) return v; }
  return vs.find(v => /^en/i.test(v.lang)) || vs[0];
}
// voices load asynchronously on first use in Chrome/WebView2
const voicesReady = () => new Promise(res => {
  if (!("speechSynthesis" in window) || speechSynthesis.getVoices().length) return res();
  const t = setTimeout(res, 1200); speechSynthesis.addEventListener?.("voiceschanged", () => { clearTimeout(t); res(); }, { once: true });
});

export async function speak(text, hooks = {}) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1800); if (!text) return;
  stop();
  const N = window.TURD_NATIVE;
  if (N && N.tts && typeof N.tts.speak === "function") {
    const me = cur = {}; set(true); hooks.onstart?.();
    try { await N.tts.speak({ text, rate: 1.0 }); } catch (e) {}
    if (cur === me) { cur = null; set(false); } hooks.onend?.(); return;
  }
  if (!("speechSynthesis" in window)) return;
  await voicesReady();
  return new Promise(res => {
    try {
      const u = new SpeechSynthesisUtterance(text); const v = pickVoice(); if (v) u.voice = v; u.rate = 1.04; u.pitch = .96;
      const me = cur = u;
      const done = () => { if (cur === me) { cur = null; set(false); } hooks.onend?.(); res(); };
      u.onstart = () => { set(true); hooks.onstart?.(); };
      u.onboundary = e => hooks.onboundary?.(e);
      u.onend = done; u.onerror = done;
      set(true); speechSynthesis.speak(u);
      // Chrome stops long utterances after ~15 s unless nudged
      if (!/Android/i.test(navigator.userAgent)) {
        const keep = setInterval(() => { if (cur !== me) return clearInterval(keep); if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); speechSynthesis.resume(); } }, 10000);
      }
    } catch (e) { set(false); res(); }
  });
}
export function stop() {
  cur = null;
  try { window.TURD_NATIVE?.tts?.stop?.(); } catch (e) {}
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
  set(false);
}
export const speaking = () => active || (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking);
export const on = fn => { subs.add(fn); return () => subs.delete(fn); };

window.TURD_SPEAK = { speak, stop, get speaking() { return speaking(); }, on };
