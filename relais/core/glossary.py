"""Glossaire : termes à garder tels quels ou à toujours traduire d'une façon précise.

Technique : avant la traduction, chaque terme est remplacé par un jeton opaque (GLS0,
GLS1…) que le modèle recopie ; après, on remet la forme voulue. Si un jeton a été
perdu ou abîmé par le modèle, `restore` renvoie None et l'appelant retraduit le
segment sans protection plutôt que de livrer un texte cassé.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

_TOKEN_RE = re.compile(r"(?<![A-Za-z])G\s?L\s?S\s?[-_]?\s?(\d+)(?!\d)", re.IGNORECASE)


@dataclass(frozen=True)
class Rule:
    src: str          # langue du terme (« en » ou « fr »)
    term: str
    target: str = ""  # vide = garder tel quel
    mode: str = "keep"  # « keep » | « replace »


class Glossary:
    def __init__(self, rules: list[Rule]):
        self.rules = [r for r in rules if r.term.strip()]
        self.version = hashlib.sha1(
            json.dumps([[r.src, r.term, r.target, r.mode] for r in self.rules]).encode()
        ).hexdigest()[:10]
        self._compiled: dict[str, list[tuple[re.Pattern, Rule]]] = {}

    def _for(self, src: str) -> list[tuple[re.Pattern, Rule]]:
        if src not in self._compiled:
            rules = sorted((r for r in self.rules if r.src == src), key=lambda r: -len(r.term))
            self._compiled[src] = [
                (re.compile(r"(?<!\w)" + re.escape(r.term.strip()) + r"(?!\w)", re.IGNORECASE), r)
                for r in rules
            ]
        return self._compiled[src]

    def protect(self, text: str, src: str, tgt: str) -> tuple[str, list[tuple[int, str]]]:
        slots: list[tuple[int, str]] = []
        for pat, rule in self._for(src):
            def sub(m: re.Match, rule: Rule = rule) -> str:
                idx = len(slots)
                keep = rule.mode == "keep" or not rule.target.strip()
                slots.append((idx, m.group(0) if keep else rule.target.strip()))
                return f"GLS{idx}"
            text = pat.sub(sub, text)
        return text, slots

    def restore(self, translated: str, slots: list[tuple[int, str]]) -> str | None:
        if not slots:
            return translated
        by_idx = dict(slots)
        seen: set[int] = set()

        def sub(m: re.Match) -> str:
            i = int(m.group(1))
            if i in by_idx:
                seen.add(i)
                return by_idx[i]
            return m.group(0)

        out = _TOKEN_RE.sub(sub, translated)
        return out if seen == set(by_idx) else None
