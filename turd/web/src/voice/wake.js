// ===========================================================================
// "HEY T.U.R.D." · hands-free voice from any section, fully offline.
//
// Engine: Vosk (Kaldi compiled to WASM, ../../vendor/vosk). Three recognizers share
// one model in a worker:
//   wake  tiny grammar ("hey turd" + look-alike words so near misses land elsewhere)
//   nav   grammar of "go to <section>" phrases (reliable navigation)
//   free  open vocabulary, for everything else (sent to the assistant)
// The mic is gated by a cheap energy detector, so the recognizer only runs while
// someone is actually talking. Paused while the app is hidden or speaking aloud.
//
// core.js calls init(ctx) after login. Other modules can use window.TURD_VOICE:
//   TURD_VOICE.state            "off" | "loading" | "listening" | "awake" | "error"
//   TURD_VOICE.capture({onPartial}) → Promise<string>   one utterance, no wake word
//   TURD_VOICE.on(fn) → off()   state changes
// Assistant hand-off: dispatches "turd:ask" {text, speak:true} on window.
// ===========================================================================
const VENDOR = new URL("../../vendor/vosk/", import.meta.url);
// The apps ship the model as .tgz (Android's build tools unpack and rename any asset ending in
// .gz), and native.js points TURD_VOSK_MODEL at it. The browser preview uses the .tar.gz.
const MODEL_URL = new URL((typeof window !== "undefined" && window.TURD_VOSK_MODEL) || "en-us-small-0.15.tar.gz", VENDOR).href;
const LIB_URL = new URL("vosk.js", VENDOR).href;
const RATE = 16000, CHUNK = 1600;               // 100 ms frames at 16 kHz
const WINDOW = 30;                               // frames decoded after each pause (3 s)

// look-alikes keep "hey there", "they heard", "hey bird" from matching the wake phrase
const WAKE_GRAMMAR = ["hey turd", "hey", "they", "heard", "heard it", "third", "the third", "bird", "word", "nerd", "dirt", "hurt", "herd",
  "her", "sir", "stir", "tour", "tired", "turn", "turned", "turn it", "turn it down", "turn on", "turn off", "turtle", "dude", "there", "a", "the",
  "okay", "it", "down", "do", "good", "hold", "day", "hate", "hay", "say", "way", "eight", "two", "to", "you", "are", "hello", "hi", "[unk]"];
const WAKE_RX = /\bhey turd\b/;

// spoken names for sections (ids that aren't registered are dropped at runtime)
const SPOKEN = {
  home: ["home", "dashboard", "main screen"], weather: ["weather", "forecast"], logbook: ["logbook", "log book", "log", "notes", "tasks"],
  chat: ["chat", "messages"], community: ["community", "calendar"], opsec: ["op sec", "security", "privacy"], radar: ["radar", "scanner", "wifi", "bluetooth"],
  entertainment: ["entertainment", "videos", "youtube", "movies", "music"], assistant: ["assistant"], extras: ["extras", "tools", "library", "offline library"],
  projects: ["projects", "my sites"],
};
const VERBS = ["go to", "open", "show", "show me", "take me to", "switch to", "pull up", "bring up"];

let K = null, S = "off", model = null, recs = null, ac = null, stream = null, node = null, src = null;
let gate = { floor: 0.004, open: false, hang: 0, quiet: 0, left: 0 }, ring = [], mode = "wake", cmd = null, busyFinal = false;
const subs = new Set(); let ui = null, inited = false;

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
function setState(s, note) { S = s; paint(note); for (const f of subs) { try { f(s); } catch (e) {} } }

/* ------------------------------------------------------------- engine */
function loadLib() {
  if (window.Vosk) return Promise.resolve(window.Vosk);
  return new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = LIB_URL; el.async = true;
    el.onload = () => window.Vosk ? res(window.Vosk) : rej(new Error("speech engine failed to load"));
    el.onerror = () => rej(new Error("speech engine missing from this build")); document.head.appendChild(el);
  });
}
function navPhrases() {
  const out = new Set(["[unk]", "cancel", "never mind", "stop listening", "go to sleep"]);
  for (const names of Object.values(liveSections())) for (const n of names) {
    out.add(n);
    for (const v of VERBS) { out.add(`${v} ${n}`); out.add(`${v} the ${n}`); out.add(`${v} my ${n}`); }
  }
  return [...out];
}
function liveSections() {
  const reg = (K?.sections?.() || []), out = {};
  for (const d of reg) {
    const names = new Set(SPOKEN[d.id] || []);
    const lbl = String(d.label || d.id).toLowerCase().replace(/[^a-z ]/g, "").trim(); if (lbl) names.add(lbl);
    if (names.size) out[d.id] = [...names];
  }
  return Object.keys(out).length ? out : SPOKEN;
}
function newRec(grammar) {
  const r = grammar ? new model.KaldiRecognizer(RATE, JSON.stringify(grammar)) : new model.KaldiRecognizer(RATE);
  r.setWords(true); return r;
}
async function loadModel() {
  setState("loading", "Loading voice…");
  const Vosk = await loadLib();
  model = await Vosk.createModel(MODEL_URL, -2);
  model.on("error", m => console.warn("[voice]", m?.error));
  recs = { wake: newRec(WAKE_GRAMMAR), nav: newRec(navPhrases()), free: newRec(null) };
  recs.wake.on("partialresult", m => { if (mode === "wake" && WAKE_RX.test(m?.result?.partial || "")) wake("voice"); });
  recs.wake.on("result", m => { if (mode === "wake" && WAKE_RX.test(m?.result?.text || "")) wake("voice"); });
  recs.free.on("partialresult", m => { if (mode === "cmd" && cmd) { const t = clean(m?.result?.partial || ""); if (t) { cmd.heard = true; cmd.partial = t; cmd.onPartial?.(t); bubble(t, "hear"); } } });
  // a mid-sentence pause can end a Vosk segment; keep collecting until our own quiet timer ends the command
  recs.free.on("result", m => { if (mode === "cmd" && cmd) { const t = clean(m?.result?.text || ""); if (t) { cmd.parts.push(t); cmd.heard = true; cmd.partial = ""; } if (cmd.fin) cmd.fin.free = true; } });
  recs.nav.on("result", m => { if (cmd) { const t = (m?.result?.text || "").trim(); if (t) cmd.nav = (cmd.nav + " " + t).trim(); if (cmd.fin) cmd.fin.nav = true; } });
}

/* ------------------------------------------------------------- audio */
const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(${CHUNK});this.n=0;}
process(i){const c=i[0]&&i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===${CHUNK}){this.port.postMessage(this.b);this.b=new Float32Array(${CHUNK});this.n=0;}}return true;}}
registerProcessor("turd-mic",P);`;

async function openMic() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  try { ac = new AudioContext({ sampleRate: RATE }); } catch (e) { ac = new AudioContext(); }
  src = ac.createMediaStreamSource(stream);
  const rate = ac.sampleRate;
  const onBuf = buf => frame(rate === RATE ? buf : resample(buf, rate));
  if (ac.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    node = new AudioWorkletNode(ac, "turd-mic"); node.port.onmessage = e => onBuf(e.data);
  } else {
    node = ac.createScriptProcessor(4096, 1, 1); let acc = [];
    node.onaudioprocess = e => { acc.push(new Float32Array(e.inputBuffer.getChannelData(0))); const n = acc.reduce((a, b) => a + b.length, 0);
      if (n >= CHUNK * (rate / RATE)) { const all = new Float32Array(n); let o = 0; for (const a of acc) { all.set(a, o); o += a.length; } acc = []; onBuf(all); } };
  }
  const mute = ac.createGain(); mute.gain.value = 0;            // keep the graph pulling without making sound
  src.connect(node); node.connect(mute); mute.connect(ac.destination);
}
function resample(buf, from) {
  const n = Math.round(buf.length * RATE / from), out = new Float32Array(n), r = from / RATE;
  for (let i = 0; i < n; i++) { const x = i * r, k = Math.floor(x), f = x - k; out[i] = (buf[k] || 0) * (1 - f) + (buf[k + 1] || 0) * f; }
  return out;
}
function closeMic() {
  try { node && node.disconnect(); src && src.disconnect(); } catch (e) {}
  try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { ac && ac.close(); } catch (e) {}
  node = src = stream = ac = null; ring = []; gate.open = false;
}

// energy gate: tracks the room's noise floor, opens on speech, holds 0.8 s after it stops
function frame(buf) {
  if (!recs) return;                                          // mic opens before the model finishes loading
  let e = 0; for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
  const rms = Math.sqrt(e / buf.length);
  ring.push(buf); if (ring.length > 6) ring.shift();          // 0.6 s pre-roll
  const speaking = typeof speechSynthesis !== "undefined" && speechSynthesis.speaking;
  if (mode === "wake" && (speaking || document.hidden)) { if (gate.open) closeGate(); return; }
  const loud = rms > Math.max(gate.floor * 3, 0.006);
  if (!loud) gate.floor = gate.floor * 0.995 + rms * 0.005; else if (rms < gate.floor) gate.floor = rms;
  if (mode === "cmd") { feed(recs.free, buf); feed(recs.nav, buf); cmdTick(loud); return; }
  // People pause before addressing it, so only the first 3 s after each pause are decoded.
  // Keeps a TV or a long conversation from pinning a CPU core.
  const pause = gate.quiet; gate.quiet = loud ? 0 : gate.quiet + 1;
  if (loud) {
    gate.hang = 8;
    if (!gate.open) { gate.open = true; gate.left = WINDOW; for (const b of ring) feed(recs.wake, b); return; }
    if (pause >= 2 && gate.left <= 0) { try { recs.wake.retrieveFinalResult(); } catch (e) {} gate.left = WINDOW; for (const b of ring.slice(-3)) feed(recs.wake, b); return; }
  }
  if (gate.open) {
    if (gate.left > 0) { feed(recs.wake, buf); if (--gate.left === 0) try { recs.wake.retrieveFinalResult(); } catch (e) {} }
    if (!loud && --gate.hang <= 0) closeGate();
  }
  ui?.lvl?.style.setProperty("--lv", Math.min(1, rms * 18).toFixed(2));
}
function closeGate() { gate.open = false; try { recs.wake.retrieveFinalResult(); } catch (e) {} }
function feed(r, buf) { try { r.acceptWaveformFloat(new Float32Array(buf), RATE); } catch (e) {} }

/* ------------------------------------------------------------- wake → command */
function wake(how) {
  if (mode === "cmd") return;
  mode = "cmd"; gate.open = false;
  try { recs.wake.retrieveFinalResult(); } catch (e) {}       // flush so the wake phrase can't fire twice
  cmd = { t0: Date.now(), quiet: 0, heard: false, parts: [], partial: "", nav: "", how, done: null };
  chime(true); setState("awake");
  bubble(how === "capture" ? "Listening…" : "Yes?", "ask");
  // the tail of the wake phrase may already hold the start of the command
  for (const b of ring.slice(-2)) { feed(recs.free, b); feed(recs.nav, b); }
}
function cmdTick(loud) {
  if (!cmd) return;
  if (loud) cmd.quiet = 0; else cmd.quiet++;
  const age = Date.now() - cmd.t0;
  if (!cmd.heard && age > 5000) return endCmd();              // nothing said
  if (cmd.heard && cmd.quiet >= 12) return endCmd();          // 1.2 s of quiet after speech
  if (age > 12000) return endCmd();                           // hard cap
}
function endCmd() {
  if (!cmd || busyFinal) return;
  busyFinal = true; const c = cmd;
  // the worker may still be decoding queued audio: wait for both final results (max 2 s)
  c.fin = { free: false, nav: false };
  const fin = new Promise(res => { let n = 0; const iv = setInterval(() => { if ((c.fin.free && c.fin.nav) || ++n > 40) { clearInterval(iv); res(); } }, 50); });
  try { recs.free.retrieveFinalResult(); recs.nav.retrieveFinalResult(); } catch (e) {}
  fin.then(() => {
    cmd = null; mode = "wake"; busyFinal = false; ring = [];
    const text = clean([...c.parts, c.partial].join(" "));
    const out = route(text, c.nav);
    if (window.TURD_VOICE_DEBUG) console.log("[voice]", JSON.stringify({ text, nav: c.nav, out }));
    if (c.done) c.done(text);
    else act(out, text);
    setState(S === "off" ? "off" : "listening");
  });
}
const clean = t => t.replace(/\[unk\]/g, " ").replace(/^\s*(hey\s+)?(turd|third|heard|word|hurt|bird|dirt)\b\s*/i, "").replace(/\s+/g, " ").trim();

function route(text, navText) {
  const t = text.toLowerCase();
  if (!t) return { kind: "none" };
  if (/^(cancel|never ?mind|nothing|forget it)\b/.test(t)) return { kind: "cancel" };
  if (/^(stop listening|go to sleep|turn off (voice|listening)|mute)\b/.test(t)) return { kind: "sleep" };
  const secs = liveSections();
  const hit = phrase => { for (const [id, names] of Object.entries(secs)) if (names.some(n => phrase === n)) return id; return null; };
  // the navigation grammar is the most reliable signal for "go to X"
  const nv = (navText || "").replace(/\[unk\]/g, " ").replace(/\s+/g, " ").trim();
  if (nv && !/^(cancel|never mind|stop listening|go to sleep)$/.test(nv)) {
    // "go to weather" often decodes as "to weather": a verb fragment plus a section name is enough
    const verbish = /^(go|to|open|show|take|switch|pull|bring)\b/.test(nv) || new RegExp(`^(?:please\\s+)?(?:${VERBS.join("|")})\\b`).test(t);
    const name = nv.replace(new RegExp(`^(?:${VERBS.join("|")}|to)\\s+`), "").replace(/^(the|my) /, "");
    const id = hit(name);
    if (id && (verbish || t.split(" ").length <= 2)) return { kind: "go", id };
  }
  const m = t.match(new RegExp(`^(?:please\\s+)?(?:${VERBS.join("|")})\\s+(?:the |my )?(.+?)(?:\\s+(?:page|tab|section))?$`));
  if (m) { const id = hit(m[1]) || fuzzy(m[1], secs); if (id) return { kind: "go", id }; }
  return { kind: "ask", text };
}
function fuzzy(w, secs) {
  let best = null, bd = 3;
  for (const [id, names] of Object.entries(secs)) for (const n of names) { const d = lev(w, n); if (d < bd && d <= Math.max(1, Math.floor(n.length / 4))) { bd = d; best = id; } }
  return best;
}
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function act(r, text) {
  if (r.kind === "none") { chime(false); bubble("Didn't catch that", "miss", 1600); return; }
  if (r.kind === "cancel") { chime(false); bubble("Okay", "miss", 900); return; }
  if (r.kind === "sleep") { bubble("Voice off", "miss", 1400); disable(); return; }
  if (r.kind === "go") {
    const def = (K?.sections?.() || []).find(d => d.id === r.id);
    bubble("→ " + (def?.label || r.id), "go", 1300); K?.show?.(r.id); return;
  }
  bubble(text, "ask", 1800);
  K?.show?.("assistant");
  setTimeout(() => window.dispatchEvent(new CustomEvent("turd:ask", { detail: { text, speak: true, via: "voice" } })), 60);
}

/* ------------------------------------------------------------- on / off */
export async function enable(persist = true) {
  if (S === "listening" || S === "awake" || S === "loading") return true;
  if (persist) LS.set("turd_voice_on", true);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no microphone access in this build");
    await openMic();                                     // ask for the mic first: instant feedback
    if (!model) await loadModel();
    mode = "wake"; setState("listening");
    if (persist && !LS.get("turd_voice_hinted", false)) { LS.set("turd_voice_hinted", true); bubble("Say “Hey T.U.R.D.”", "ask", 2600); }
    return true;
  } catch (e) {
    closeMic();
    const msg = /denied|NotAllowed|Permission/i.test(String(e?.name) + e?.message) ? "Microphone blocked. Allow it for T.U.R.D. in settings." : (e?.message || "voice unavailable");
    setState("error", msg); K?.toast?.(msg); return false;
  }
}
export function disable() {
  LS.set("turd_voice_on", false); cmd = null; mode = "wake"; closeMic(); setState("off");
}
// one utterance without the wake word (the assistant's mic button uses this)
export async function capture({ onPartial } = {}) {
  const wasOff = S === "off" || S === "error";
  if (S !== "listening" && !(await enable(false))) return "";
  const text = await new Promise(res => { wake("capture"); if (cmd) { cmd.done = res; cmd.onPartial = onPartial; } else res(""); });
  if (wasOff) { closeMic(); setState("off"); }               // one-off use doesn't switch on hands-free mode
  hideBubble();
  return text;
}

/* ------------------------------------------------------------- HUD */
const CSS = `
#st-voice{display:inline-flex;align-items:center;gap:8px;position:relative;pointer-events:auto}
#st-voice .vb{--lv:0;display:inline-flex;align-items:center;gap:7px}
#st-voice .vd{width:8px;height:8px;border-radius:50%;background:var(--ink-faint,#5a6a8a);box-shadow:0 0 0 0 rgba(var(--accent-rgb),.0);transition:background .3s,box-shadow .3s,transform .15s}
#st-voice.on .vd{background:rgb(var(--accent-rgb));box-shadow:0 0 calc(6px + var(--lv)*18px) rgba(var(--accent-rgb),.9);transform:scale(calc(1 + var(--lv)*.6));animation:vbreathe 2.8s ease-in-out infinite}
#st-voice.awake .vd{background:#fff;box-shadow:0 0 18px rgba(var(--accent-rgb),1),0 0 2px #fff;animation:vawake .7s ease-in-out infinite alternate}
#st-voice.loading .vd{background:transparent;border:1.5px solid rgba(var(--accent-rgb),.9);border-top-color:transparent;width:9px;height:9px;animation:vspin .8s linear infinite}
#st-voice.err .vd{background:#ff8a9c}
#st-voice.off .vl{text-decoration:line-through;text-decoration-color:rgba(255,255,255,.25)}
@keyframes vbreathe{50%{opacity:.55}} @keyframes vawake{to{transform:scale(1.5)}} @keyframes vspin{to{transform:rotate(360deg)}}
#st-voice .vm{position:absolute;top:calc(100% + 8px);right:0;min-width:230px;padding:14px;border-radius:14px;background:rgba(8,14,30,.94);
  border:1px solid rgba(var(--accent-rgb),.35);box-shadow:0 18px 50px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  text-transform:none;letter-spacing:.2px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink,#dfe8ff);display:none;z-index:40;pointer-events:auto}
#st-voice.menu .vm{display:block}
#st-voice .vm p{margin:0 0 10px;color:var(--ink-dim,#9fb0d0);font-size:12px}
#st-voice .vm b{color:var(--ink,#fff);font-weight:600}
#st-voice .vm .row{display:flex;gap:8px}
#st-voice .vm button{flex:1;padding:9px 10px;border-radius:10px;border:1px solid rgba(var(--accent-rgb),.35);background:rgba(var(--accent-rgb),.12);color:var(--ink,#fff);font:inherit;cursor:pointer}
#st-voice .vm button:hover{background:rgba(var(--accent-rgb),.25)}
#st-voice .vm button.q{background:transparent;border-color:rgba(255,255,255,.12);color:var(--ink-dim,#9fb0d0)}
#vbub{position:fixed;left:50%;bottom:calc(34px + env(safe-area-inset-bottom,0px));transform:translate(-50%,16px) scale(.96);z-index:60;opacity:0;pointer-events:none;
  display:flex;align-items:center;gap:12px;max-width:min(560px,calc(100vw - 32px));padding:12px 20px 12px 14px;border-radius:999px;
  background:rgba(8,14,30,.86);border:1px solid rgba(var(--accent-rgb),.45);box-shadow:0 0 40px rgba(var(--accent-rgb),.25),0 14px 40px rgba(0,0,0,.5);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#eef3ff;font:15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .25s,transform .3s cubic-bezier(.2,.9,.3,1.2)}
#vbub.show{opacity:1;transform:translate(-50%,0) scale(1)}
#vbub .o{flex:0 0 22px;height:22px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,rgb(var(--accent-rgb)) 45%,rgba(var(--accent-rgb),.2) 75%);box-shadow:0 0 18px rgba(var(--accent-rgb),.9)}
#vbub.ask .o,#vbub.hear .o{animation:vawake .6s ease-in-out infinite alternate}
#vbub.miss .o{filter:grayscale(.8);opacity:.6}
#vbub .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vbub.hear .t{color:#fff}
#vbub .x{pointer-events:auto;margin-left:6px;background:none;border:0;color:rgba(255,255,255,.55);font-size:18px;cursor:pointer;padding:0 0 0 6px;display:none}
#vbub.vcard{border-radius:18px;align-items:flex-start;padding:16px 18px}
#vbub.vcard.show{pointer-events:auto}
#vbub:not(.show){pointer-events:none!important}
#vbub.vcard .t{white-space:normal}
#vbub.vcard .row{display:flex;gap:8px;margin-top:10px}
#vbub.vcard button{padding:8px 14px;border-radius:10px;border:1px solid rgba(var(--accent-rgb),.4);background:rgba(var(--accent-rgb),.16);color:#fff;font:inherit;font-size:13px;cursor:pointer}
#vbub.vcard button.q{background:transparent;border-color:rgba(255,255,255,.14);color:#b9c6e6}
@media(max-width:760px){ #st-voice .vl{display:none} #st-voice .vb{padding:10px 8px;margin:-10px -4px} #vbub{bottom:calc(104px + env(safe-area-inset-bottom,0px))} #st-voice .vm{position:fixed;top:calc(64px + var(--sat,0px));right:16px;left:16px;min-width:0} }
body[data-section="assistant"] #vbub{bottom:calc(128px + env(safe-area-inset-bottom,0px))}
@media(max-width:760px){ body[data-section="assistant"] #vbub{bottom:calc(178px + env(safe-area-inset-bottom,0px))} }
@media(prefers-reduced-motion:reduce){ #st-voice .vd,#vbub .o{animation:none!important} }`;

function mountUI() {
  if (ui) return;
  const st = document.createElement("style"); st.id = "voice-css"; st.textContent = CSS; document.head.appendChild(st);
  const host = document.querySelector("#status .rstat"); if (!host) return;
  const el = document.createElement("span"); el.id = "st-voice";
  el.innerHTML = `<button class="st-btn vb" title="Hands-free voice: say “Hey T.U.R.D.”" aria-haspopup="true"><i class="vd"></i><span class="vl">Voice</span></button><div class="vm" role="menu"></div><span class="sep">·</span>`;
  const tools = host.querySelector("#st-tools"); tools ? tools.after(el) : host.prepend(el);
  const bub = document.createElement("div"); bub.id = "vbub"; bub.setAttribute("role", "status"); bub.setAttribute("aria-live", "polite");
  bub.innerHTML = `<i class="o"></i><span class="t"></span>`; document.body.appendChild(bub);
  ui = { el, btn: el.querySelector(".vb"), lvl: el.querySelector(".vb"), menu: el.querySelector(".vm"), label: el.querySelector(".vl"), bub, bt: bub.querySelector(".t"), timer: 0 };
  ui.btn.onclick = e => { e.stopPropagation(); if (S === "off" || S === "error") enable(); else toggleMenu(); };
  ui.btn.oncontextmenu = e => { e.preventDefault(); if (S === "listening") wake("capture"); };
  document.addEventListener("click", e => { if (!el.contains(e.target)) el.classList.remove("menu"); });
  addEventListener("keydown", e => { if (e.key === "Escape") { el.classList.remove("menu"); if (mode === "cmd" && cmd) { cmd.parts = []; cmd.partial = ""; cmd.heard = false; endCmd(); } } });
}
function toggleMenu() {
  const on = !ui.el.classList.contains("menu");
  ui.menu.innerHTML = `<p><b>Listening for “Hey T.U.R.D.”</b><br>Then say a section (“go to weather”) or ask anything. Audio never leaves this device.</p>
    <div class="row"><button data-v="talk">Talk now</button><button class="q" data-v="off">Turn off</button></div>`;
  ui.menu.querySelector('[data-v="talk"]').onclick = () => { ui.el.classList.remove("menu"); wake("capture"); };
  ui.menu.querySelector('[data-v="off"]').onclick = () => { ui.el.classList.remove("menu"); disable(); K?.toast?.("voice off"); };
  ui.el.classList.toggle("menu", on);
}
function paint(note) {
  if (!ui) return;
  ui.el.className = { off: "off", loading: "loading", listening: "on", awake: "on awake", error: "err off" }[S] || "";
  ui.label.textContent = { off: "Voice", loading: "Voice…", listening: "Hey T.U.R.D.", awake: "Listening", error: "Voice" }[S] || "Voice";
  ui.btn.title = S === "error" && note ? note : S === "off" ? "Turn on hands-free voice" : S === "listening" ? "Say “Hey T.U.R.D.” (right-click to talk now)" : "Voice";
  if (S === "loading" && note) bubble(note, "ask", 0);
  if (S === "listening" && ui.bub.classList.contains("ask") && ui.bt.textContent === "Loading voice…") hideBubble();
}
function bubble(text, kind, ms) {
  if (!ui) return;
  clearTimeout(ui.timer);
  ui.bub.className = "show " + kind; if (ui.bt.textContent !== text) ui.bt.textContent = text;
  if (ms) ui.timer = setTimeout(hideBubble, ms);
}
function hideBubble() { if (ui) ui.bub.classList.remove("show"); }
function offerOnce() {
  if (!ui || LS.get("turd_voice_on", null) !== null) return;
  ui.bub.className = "show vcard"; ui.bt.innerHTML = `<div><b>Hands-free voice is here.</b> Say “Hey T.U.R.D.” from any screen, then “go to weather” or ask anything. Runs offline on this device.
    <div class="row"><button data-v="on">Turn on</button><button class="q" data-v="no">Not now</button></div></div>`;
  ui.bt.querySelector('[data-v="on"]').onclick = () => { hideBubble(); enable(); };
  ui.bt.querySelector('[data-v="no"]').onclick = () => { hideBubble(); LS.set("turd_voice_on", false); K?.toast?.("voice is off · tap VOICE up top any time"); };
}

/* ------------------------------------------------------------- sounds */
let sfx = null;
function chime(up) {
  try {
    sfx = sfx || new AudioContext(); const t = sfx.currentTime;
    const tones = up ? [880, 1320] : [660, 440];
    tones.forEach((f, i) => { const o = sfx.createOscillator(), g = sfx.createGain(); o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * .09); g.gain.linearRampToValueAtTime(.08, t + i * .09 + .015); g.gain.exponentialRampToValueAtTime(.0001, t + i * .09 + .16);
      o.connect(g); g.connect(sfx.destination); o.start(t + i * .09); o.stop(t + i * .09 + .18); });
  } catch (e) {}
}

/* ------------------------------------------------------------- boot */
export function init(ctx) {
  if (inited) return; inited = true;
  K = ctx; mountUI(); setState("off");
  window.TURD_VOICE = { get state() { return S; }, enable, disable, capture, on(fn) { subs.add(fn); return () => subs.delete(fn); } };
  document.addEventListener("visibilitychange", () => { if (!ac) return; document.hidden ? ac.suspend().catch(() => {}) : ac.resume().catch(() => {}); });
  if (LS.get("turd_voice_on", null) === true) enable();
  else setTimeout(offerOnce, 2500);
}
export const state = () => S;
