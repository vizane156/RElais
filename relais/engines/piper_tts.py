"""Synthèse vocale réelle : Piper (ONNX, très faible latence, voix EN et FR).

Attention licence : le paquet `piper-tts` actuel est sous GPL-3.0 (voir LICENSES.md).
"""

from __future__ import annotations

import threading
from pathlib import Path

from .base import EngineUnavailable, Voice


class PiperSynthesizer:
    kind = "piper"

    def __init__(self, models_dir: Path, manifest: dict):
        try:
            from piper import PiperVoice  # noqa: F401
        except ImportError as exc:
            raise EngineUnavailable(
                "Voix : Piper n'est pas installé. Installe-le avec : pip install \"relais[tts]\"",
                key="err.dep", extra="tts",
            ) from exc
        self.root = Path(models_dir) / "tts" / "piper"
        self.manifest = manifest["tts"]["piper"]["voices"]
        self._loaded: dict[str, object] = {}
        self._lock = threading.Lock()
        if not any(self._installed(v) for v in self.manifest):
            raise EngineUnavailable("Aucune voix Piper installée. Installe-en avec : relais pull tts",
                                    key="err.model_tts")

    def _installed(self, vid: str) -> bool:
        return (self.root / f"{vid}.onnx").exists() and (self.root / f"{vid}.onnx.json").exists()

    def voices(self, lang: str) -> list[Voice]:
        return [Voice(vid, m["lang"], m["label"]) for vid, m in self.manifest.items()
                if m["lang"] == lang and self._installed(vid)]

    def _voice(self, vid: str):
        from piper import PiperVoice
        with self._lock:
            if vid not in self._loaded:
                self._loaded[vid] = PiperVoice.load(str(self.root / f"{vid}.onnx"))
            return self._loaded[vid]

    def synth(self, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, int]:
        if not voice or not self._installed(voice):
            avail = self.voices(lang)
            if not avail:
                raise EngineUnavailable(f"Aucune voix installée pour « {lang} » : relais pull tts",
                                        key="err.model_tts")
            voice = avail[0].id
        v = self._voice(voice)
        kwargs = {}
        try:  # vitesse : length_scale > 1 ralentit
            from piper import SynthesisConfig
            kwargs["syn_config"] = SynthesisConfig(length_scale=1.0 / max(rate, 0.1))
        except Exception:  # noqa: BLE001  (anciennes versions de piper)
            pass
        pcm, sr = bytearray(), int(v.config.sample_rate)
        for chunk in v.synthesize(text, **kwargs):
            pcm += chunk.audio_int16_bytes
            sr = int(chunk.sample_rate)
        return bytes(pcm), sr

    def close(self) -> None:
        self._loaded.clear()
