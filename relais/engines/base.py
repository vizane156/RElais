"""Contrats des moteurs. Tout moteur (réel ou simulé) respecte ces trois interfaces ;
le reste du système ne sait pas lequel il utilise.

Le cœur n'importe jamais numpy : l'audio circule en `bytes` PCM 16 bits mono.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class EngineUnavailable(Exception):
    """Dépendance ou modèle manquant. `key` + `params` permettent à l'interface d'afficher
    le message dans la langue choisie ; `text` (français) sert de repli et pour la console."""

    def __init__(self, text: str, key: str | None = None, **params):
        super().__init__(text)
        self.text = text
        self.key = key
        self.params = params


@dataclass
class RecResult:
    text: str
    language: str
    prob: float = 1.0


@dataclass
class Voice:
    id: str
    lang: str
    label: str


class Translator(Protocol):
    def translate_batch(self, texts: list[str], src: str, tgt: str, beam: int = 1) -> list[str]: ...
    def close(self) -> None: ...


class Recognizer(Protocol):
    def transcribe(self, pcm16: bytes, language: str | None, final: bool, hint: int = 0) -> RecResult: ...
    def detect(self, pcm16: bytes) -> tuple[str, float]: ...
    def close(self) -> None: ...


class Synthesizer(Protocol):
    def voices(self, lang: str) -> list[Voice]: ...
    def synth(self, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, int]:
        """Renvoie (PCM16 mono, fréquence d'échantillonnage)."""
    def close(self) -> None: ...
