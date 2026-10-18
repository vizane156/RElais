"""Service de traduction : découpage en phrases, cache, glossaire, retraduction de secours.

Un seul point d'entrée, `translate(text, src, tgt)`, appelé depuis un thread (jamais
depuis la boucle asyncio). Le moteur dessous (CTranslate2 ou simulé) est interchangeable.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

from .store import GlossaryStore
from .text import NL, rejoin, segment

BEAMS = {"fast": 1, "balanced": 2, "best": 4}


class TranslationService:
    def __init__(self, engine, glossary: GlossaryStore, settings, cache_size: int = 20000):
        self.engine = engine
        self.glossary = glossary
        self.settings = settings
        self._cache: OrderedDict[tuple, str] = OrderedDict()
        self._cache_size = cache_size
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def _get(self, key: tuple) -> str | None:
        with self._lock:
            v = self._cache.get(key)
            if v is not None:
                self._cache.move_to_end(key)
                self.hits += 1
            return v

    def _put(self, key: tuple, value: str) -> None:
        with self._lock:
            self._cache[key] = value
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)

    def translate(self, text: str, src: str, tgt: str) -> str:
        if not text.strip() or src == tgt:
            return text
        beam = BEAMS.get(self.settings.get("translate.quality", "fast"), 1)
        use_gloss = bool(self.settings.get("translate.glossary", True))
        gloss = self.glossary.compiled() if use_gloss else None
        gver = gloss.version if gloss else ""

        segs = segment(text)
        out: list[str | None] = [None] * len(segs)
        todo: list[int] = []
        for i, s in enumerate(segs):
            if s == NL or not s.strip():
                out[i] = s
                continue
            hit = self._get((src, tgt, beam, gver, s))
            if hit is not None:
                out[i] = hit
            else:
                todo.append(i)

        if todo:
            self.misses += len(todo)
            prepared = []
            for i in todo:
                if gloss and gloss.rules:
                    prepared.append(gloss.protect(segs[i], src, tgt))
                else:
                    prepared.append((segs[i], []))
            raw = self.engine.translate_batch([p for p, _ in prepared], src, tgt, beam)
            for i, (_, slots), r in zip(todo, prepared, raw):
                final = gloss.restore(r, slots) if (gloss and slots) else r
                if final is None:  # jeton perdu : on retraduit sans protection
                    final = self.engine.translate_batch([segs[i]], src, tgt, beam)[0]
                out[i] = final
                self._put((src, tgt, beam, gver, segs[i]), final)
        return rejoin([o or "" for o in out])

    def close(self) -> None:
        try:
            self.engine.close()
        except Exception:  # noqa: BLE001
            pass
