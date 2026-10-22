# usage: tts.py out.wav "text" [voice] [rate] [pitch]
import ctypes, sys, wave, espeakng_loader as e
out, text = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "en-us"; rate = int(sys.argv[4]) if len(sys.argv) > 4 else 160; pitch = int(sys.argv[5]) if len(sys.argv) > 5 else 50
L = ctypes.CDLL(e.get_library_path())
sr = L.espeak_Initialize(2, 0, e.get_data_path().encode(), 0)
buf = []
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
def cb(w, n, ev):
    if n > 0: buf.append(ctypes.string_at(w, n * 2))
    return 0
c = CB(cb); L.espeak_SetSynthCallback(c)
L.espeak_SetVoiceByName(voice.encode())
L.espeak_SetParameter(1, rate, 0); L.espeak_SetParameter(3, pitch, 0)
t = text.encode()
L.espeak_Synth(t, len(t) + 1, 0, 1, 0, 0, None, None); L.espeak_Synchronize()
with wave.open(out, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(b"".join(buf))
print(out, sr, sum(len(b) for b in buf) // 2 / sr, "s")
