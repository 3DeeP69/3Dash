# "Hey T.U.R.D." hands-free voice

Offline wake word + voice commands from any section. Owned by the assistant thread.

## How it works
- `wake.js` loads `web/vendor/vosk/vosk.js` (Vosk in WASM, runs in a worker) and the
  `en-us-small-0.15` model. The model is unpacked once into IndexedDB (~70 MB) and loads in ~4 s after that.
- Mic → AudioWorklet at 16 kHz → energy gate. Nothing is decoded in a quiet room.
  While people talk, only the first 3 s after each pause is decoded (a TV costs ~8% of a core instead of ~70%).
- Wake recognizer: grammar "hey turd" plus look-alike words, so "hey there", "they heard it", "hey bird" don't fire.
- After the wake word (chime + bubble), two recognizers listen until 1.2 s of quiet:
  a "go to <section>" grammar, and open vocabulary.
  - "go to / open / show (me) / take me to / switch to <section>" → `ctx.show(id)`
  - "cancel" / "never mind" → back to listening. "stop listening" / "go to sleep" → voice off
  - anything else → Assistant tab, dispatched as `turd:ask` {text, speak:true}, answered aloud
- Paused while the app is hidden and while it is speaking.

## UI
- Top bar: `● HEY T.U.R.D.` (dot pulses with mic level, white while awake). Tap: off → turns on; on → menu (Talk now / Turn off).
  Right-click = talk now. Esc cancels a command.
- Bottom bubble shows live captions and the result. First login shows a one-time "Turn on / Not now" card.
- localStorage: `turd_voice_on` (true/false/unset), `turd_voice_hinted`.

## API (window.TURD_VOICE)
`state` ("off" | "loading" | "listening" | "awake" | "error"), `enable()`, `disable()`,
`capture({onPartial}) → Promise<text>` (one utterance, no wake word: the Assistant mic button uses it), `on(fn) → off()`.
Set `window.TURD_VOICE_DEBUG = 1` to log `[voice] {text, nav, out}` for each command.

## Native apps
- Bundle `web/vendor/vosk/` (46 MB). Android needs RECORD_AUDIO (+ MODIFY_AUDIO_SETTINGS) and the WebView
  must grant `RESOURCE_AUDIO_CAPTURE`. Windows WebView2 must allow the microphone permission.
- If a CSP is set: `worker-src blob:`, `script-src 'self' 'wasm-unsafe-eval' blob:`.

## Tests (tools/voice-tests)
`tts.py` makes speech with espeak-ng (pip: espeakng-loader), `ui-wake.mjs` plays a WAV into Chromium's fake mic
and logs wakes/commands, `cpu.mjs` measures worker CPU. Results 2026-10-21: 7/7 wakes, 0 false wakes,
every "go to" correct, also with room noise and right after chatter.
