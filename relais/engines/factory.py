"""Fabrique de moteurs : choisit réel ou simulé, lit les réglages au moment du chargement."""

from __future__ import annotations

import json

from ..core.langs import PAIR
from ..core.translate import TranslationService
from ..paths import DATA_PKG
from .base import EngineUnavailable
from .mock import MockRecognizer, MockSynthesizer, MockTranslator


def load_manifest() -> dict:
    return json.loads((DATA_PKG / "models.json").read_text(encoding="utf-8"))


class EngineFactory:
    def __init__(self, kind: str, app):
        if kind not in ("real", "mock"):
            raise ValueError("engines doit valoir « real » ou « mock »")
        self.kind = kind
        self.app = app
        self.manifest = load_manifest()

    def make(self, cap_id: str):
        """Appelé dans un thread : le chargement d'un modèle peut prendre plusieurs secondes."""
        s = self.app.settings
        threads = int(s.get("perf.threads", 0))
        models = self.app.paths.models
        if cap_id == "translate":
            if self.kind == "mock":
                eng = MockTranslator()
            else:
                from .ct2_mt import Ct2Translator
                eng = Ct2Translator(models, [(PAIR[0], PAIR[1]), (PAIR[1], PAIR[0])], threads)
            return TranslationService(eng, self.app.glossary, s)
        if cap_id == "listen":
            if self.kind == "mock":
                return MockRecognizer()
            from .whisper_stt import WhisperRecognizer
            return WhisperRecognizer(models, s.get("listen.model", "base"), PAIR, threads)
        if cap_id == "speak":
            if self.kind == "mock":
                return MockSynthesizer()
            if s.get("speak.engine") == "kokoro":
                from .kokoro_tts import KokoroSynthesizer
                return KokoroSynthesizer(models, self.manifest)
            from .piper_tts import PiperSynthesizer
            return PiperSynthesizer(models, self.manifest)
        raise EngineUnavailable(f"pas de moteur pour « {cap_id} »")

    def voices_for_ui(self) -> dict[str, list[dict]]:
        """Voix proposées dans les réglages, même quand la fonction « Voix » est éteinte."""
        out = {"a": [], "b": []}
        for side, lang in (("a", PAIR[0]), ("b", PAIR[1])):
            if self.kind == "mock":
                out[side] = [{"id": v.id, "label": v.label} for v in MockSynthesizer().voices(lang)]
            elif self.app.settings.get("speak.engine") == "kokoro":
                out[side] = [{"id": v["id"], "label": v["label"]}
                             for v in self.manifest["tts"]["kokoro"]["voices"] if v["lang"] == lang]
            else:
                root = self.app.paths.models / "tts" / "piper"
                out[side] = [{"id": vid, "label": m["label"]}
                             for vid, m in self.manifest["tts"]["piper"]["voices"].items()
                             if m["lang"] == lang and (root / f"{vid}.onnx").exists()]
        return out

    def model_status(self) -> dict:
        m, root = self.manifest, self.app.paths.models
        mt = [{"id": k, "installed": (root / v["dir"] / "model.bin").exists(), "mb": v["approx_mb"]}
              for k, v in m["mt"].items()]
        stt = [{"id": k, "installed": (root / v["dir"] / "model.bin").exists(), "mb": v["approx_mb"]}
               for k, v in m["stt"].items()]
        tts = [{"id": k, "lang": v["lang"], "installed": (root / "tts" / "piper" / f"{k}.onnx").exists(),
                "mb": v["approx_mb"], "engine": "piper"} for k, v in m["tts"]["piper"]["voices"].items()]
        kk = m["tts"]["kokoro"]
        tts.append({"id": "kokoro", "lang": "en+fr", "engine": "kokoro", "mb": kk["approx_mb"],
                    "installed": all((root / "tts" / "kokoro" / f["name"]).exists() for f in kk["files"])})
        return {"engines": self.kind, "mt": mt, "stt": stt, "tts": tts}
