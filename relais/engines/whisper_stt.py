"""Reconnaissance vocale réelle : faster-whisper (Whisper via CTranslate2), int8."""

from __future__ import annotations

from pathlib import Path

from .base import EngineUnavailable, RecResult


class WhisperRecognizer:
    kind = "faster-whisper"

    def __init__(self, models_dir: Path, size: str, languages: tuple[str, ...], threads: int = 0):
        try:
            import numpy as np  # noqa: F401
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise EngineUnavailable(
                "Reconnaissance vocale : dépendances manquantes. Installe-les avec : pip install \"relais[stt]\"",
                key="err.dep", extra="stt",
            ) from exc
        path = Path(models_dir) / "stt" / f"whisper-{size}"
        if not (path / "model.bin").exists():
            raise EngineUnavailable(
                f"Modèle de reconnaissance « {size} » absent. Installe-le avec : relais pull stt --stt {size}",
                key="err.model_stt", size=size,
            )
        device, compute = "cpu", "int8"
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device, compute = "cuda", "int8_float16"
        except Exception:  # noqa: BLE001
            pass
        self.languages = tuple(languages)
        self.model = WhisperModel(str(path), device=device, compute_type=compute, cpu_threads=threads)

    @staticmethod
    def _audio(pcm16: bytes):
        import numpy as np
        n = len(pcm16) // 2 * 2
        return np.frombuffer(pcm16[:n], dtype="<i2").astype(np.float32) / 32768.0

    def detect(self, pcm16: bytes) -> tuple[str, float]:
        """Langue la plus probable, restreinte à la paire configurée."""
        audio = self._audio(pcm16)
        try:
            res = self.model.detect_language(audio)
            lang, prob = res[0], float(res[1])
            probs = res[2] if len(res) > 2 else None
            if probs:
                cand = [(p, l) for l, p in probs if l in self.languages]
                if cand:
                    p, l = max(cand)
                    return l, float(p)
            if lang in self.languages:
                return lang, prob
        except Exception:  # noqa: BLE001
            pass
        return self.languages[0], 0.0

    def transcribe(self, pcm16: bytes, language: str | None, final: bool, hint: int = 0) -> RecResult:
        audio = self._audio(pcm16)
        prob = 1.0
        if language is None:
            language, prob = self.detect(pcm16)
        segments, _info = self.model.transcribe(
            audio, language=language, beam_size=2 if final else 1, best_of=1, temperature=0.0,
            vad_filter=False, without_timestamps=True, condition_on_previous_text=False,
            no_speech_threshold=0.6, compression_ratio_threshold=2.4, log_prob_threshold=-1.0,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return RecResult(text, language, prob)

    def close(self) -> None:
        self.model = None
