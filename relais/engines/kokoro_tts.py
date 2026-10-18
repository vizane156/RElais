"""Synthèse vocale réelle, alternative : Kokoro (82 M de paramètres, plus naturel, plus lent).

Attention licence : `kokoro-onnx` tire `phonemizer-fork` (GPL-3.0). Voir LICENSES.md.
"""

from __future__ import annotations

from pathlib import Path

from ..core.langs import KOKORO
from .base import EngineUnavailable, Voice


class KokoroSynthesizer:
    kind = "kokoro"

    def __init__(self, models_dir: Path, manifest: dict):
        try:
            import numpy as np  # noqa: F401
            from kokoro_onnx import Kokoro
        except ImportError as exc:
            raise EngineUnavailable(
                "Voix : Kokoro n'est pas installé. Installe-le avec : pip install \"relais[kokoro]\"",
                key="err.dep", extra="kokoro",
            ) from exc
        d = Path(models_dir) / "tts" / "kokoro"
        model, voices = d / "kokoro-v1.0.onnx", d / "voices-v1.0.bin"
        if not model.exists() or not voices.exists():
            raise EngineUnavailable("Modèle Kokoro absent. Installe-le avec : relais pull tts --tts kokoro",
                                    key="err.model_kokoro")
        self.k = Kokoro(str(model), str(voices))
        self.manifest = manifest["tts"]["kokoro"]["voices"]

    def voices(self, lang: str) -> list[Voice]:
        return [Voice(v["id"], v["lang"], v["label"]) for v in self.manifest if v["lang"] == lang]

    def synth(self, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, int]:
        import numpy as np
        avail = self.voices(lang)
        if not any(v.id == voice for v in avail):
            voice = avail[0].id
        samples, sr = self.k.create(text, voice=voice, speed=float(rate), lang=KOKORO[lang])
        pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        return pcm, int(sr)

    def close(self) -> None:
        self.k = None
