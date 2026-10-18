"""Audio sans numpy : WAV, énergie, durée. (Les moteurs réels, eux, utilisent numpy.)"""

from __future__ import annotations

import array
import io
import sys
import wave

SR_STT = 16000


def rms_pcm16(pcm: bytes, stride: int = 4) -> float:
    """Énergie RMS normalisée [0..1] d'un tampon PCM16 little-endian (sous-échantillonné)."""
    n = len(pcm) // 2
    if n == 0:
        return 0.0
    a = array.array("h")
    a.frombytes(pcm[: n * 2])
    if sys.byteorder == "big":
        a.byteswap()
    sub = a[::stride] if n > 4000 else a
    acc = 0
    for v in sub:
        acc += v * v
    return (acc / len(sub)) ** 0.5 / 32768.0


def wav_bytes(pcm16: bytes, sample_rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm16)
    return buf.getvalue()


def wav_info(data: bytes, max_seconds: float = 3600.0) -> dict:
    """Valide un WAV PCM 16 bits et renvoie ses caractéristiques. ValueError sinon."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"WAV illisible : {exc}") from exc
    if width != 2:
        raise ValueError("WAV 16 bits requis")
    if ch not in (1, 2):
        raise ValueError("mono ou stéréo requis")
    if not (8000 <= rate <= 192000):
        raise ValueError("fréquence d'échantillonnage hors limites")
    if frames <= 0:
        raise ValueError("WAV vide")
    duration = frames / rate
    if duration > max_seconds:
        raise ValueError("enregistrement trop long")
    return {"channels": ch, "sample_rate": rate, "frames": frames, "duration": round(duration, 3)}
