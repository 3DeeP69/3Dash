import sys, json, subprocess
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1); m = Model("model")
G = json.loads(sys.argv[1])
for line in open("s/index.txt"):
    i, txt, v = line.strip().split("|")
    pcm = subprocess.run(["ffmpeg","-v","quiet","-i",f"s/{i}.wav","-ar","16000","-ac","1","-f","s16le","-"],capture_output=True).stdout
    pcm = b"\0"*16000 + pcm + b"\0"*16000
    r = KaldiRecognizer(m, 16000, json.dumps(G)); r.SetWords(True)
    for k in range(0, len(pcm), 3200): r.AcceptWaveform(pcm[k:k+3200])
    res = json.loads(r.FinalResult())
    print(f"{txt:40s} -> {res.get('text')!r:30s} {[(w['word'], round(w['conf'],2)) for w in res.get('result',[])]}")
