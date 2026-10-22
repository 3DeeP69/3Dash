# Offline speech for "Hey T.U.R.D."

- `vosk.js`: vosk-browser 0.0.8 (WASM build of Vosk/Kaldi, worker inlined). Apache-2.0, https://github.com/ccoreilly/vosk-browser
- `en-us-small-0.15.tar.gz`: vosk-model-small-en-us-0.15 by Alpha Cephei, Apache-2.0, https://alphacephei.com/vosk/models

Used by `web/src/voice/wake.js`. Everything runs on the device; no audio leaves it.
The model is unpacked once into IndexedDB on first use (about 70 MB), then loads from there.
Ship this folder inside the Windows and Android apps so voice works with no internet.
