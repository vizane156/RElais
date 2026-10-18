"""Traduction réelle : CTranslate2 + modèles Marian opus-mt (EN->FR, FR->EN), int8.

Tokenisation avec SentencePiece directement (pas de `transformers` à l'exécution :
l'import coûte ~20 ms au lieu de ~2 s).
"""

from __future__ import annotations

import os
from pathlib import Path

from .base import EngineUnavailable


class Ct2Translator:
    kind = "ct2"

    def __init__(self, models_dir: Path, pairs: list[tuple[str, str]], threads: int = 0,
                 compute_type: str = "int8"):
        try:
            import ctranslate2
            import sentencepiece as spm
        except ImportError as exc:
            raise EngineUnavailable(
                "Traduction : dépendances manquantes. Installe-les avec : pip install \"relais[mt]\"",
                key="err.dep", extra="mt",
            ) from exc

        self._models: dict[tuple[str, str], tuple] = {}
        for src, tgt in pairs:
            d = Path(models_dir) / "mt" / f"opus-mt-{src}-{tgt}-int8"
            if not (d / "model.bin").exists():
                raise EngineUnavailable(
                    f"Modèle de traduction {src}->{tgt} absent. Installe-le avec : relais pull mt",
                    key="err.model_mt",
                )
            tr = ctranslate2.Translator(
                str(d), device="cpu", compute_type=compute_type,
                inter_threads=1, intra_threads=threads or (os.cpu_count() or 4),
            )
            self._models[(src, tgt)] = (
                tr,
                spm.SentencePieceProcessor(model_file=str(d / "source.spm")),
                spm.SentencePieceProcessor(model_file=str(d / "target.spm")),
            )
        # Première inférence : allocations et noyaux. On la paie avant l'utilisateur.
        for (src, tgt) in list(self._models):
            self.translate_batch(["Hello."] if src == "en" else ["Bonjour."], src, tgt, 1)

    def translate_batch(self, texts: list[str], src: str, tgt: str, beam: int = 1) -> list[str]:
        tr, sp_src, sp_tgt = self._models[(src, tgt)]
        toks = [sp_src.encode(t, out_type=str) + ["</s>"] for t in texts]
        res = tr.translate_batch(toks, beam_size=beam, max_batch_size=64, max_decoding_length=384)
        return [sp_tgt.decode(r.hypotheses[0]) for r in res]

    def close(self) -> None:
        self._models.clear()
