"""Fabrique un faux micro : silence, ~3 s de « parole » (harmoniques modulées au rythme des syllabes), silence.
Chromium le rejoue en boucle avec --use-file-for-fake-audio-capture."""
import math, struct, sys, wave

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fake-mic.wav"
sr = 48000
frames = []
def silence(sec):
    for i in range(int(sr * sec)):
        frames.append(int(30 * math.sin(i * 0.37)))          # bruit de fond très faible
def speech(sec):
    for i in range(int(sr * sec)):
        t = i / sr
        env = (0.5 + 0.5 * math.sin(2 * math.pi * 3.6 * t)) ** 1.5   # syllabes : des creux entre les mots
        f = 135 + 18 * math.sin(2 * math.pi * 0.7 * t)
        s = sum(math.sin(2 * math.pi * f * k * t) / k for k in range(1, 7))
        frames.append(int(9000 * env * s / 2.2))
silence(1.4); speech(3.4); silence(2.2)
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, v))) for v in frames))
print(out)
