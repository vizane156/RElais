"""La paire de langues.

Deux « côtés » : a et b. Tout le système raisonne en côtés, jamais en « anglais »
ou « français » en dur : changer de paire, plus tard, revient à changer ce fichier
et à fournir les modèles correspondants.
"""

from __future__ import annotations

PAIR = ("en", "fr")
NAMES = {"en": "English", "fr": "Français"}
WHISPER = {"en": "en", "fr": "fr"}
KOKORO = {"en": "en-us", "fr": "fr-fr"}


def side_lang(side: str) -> str:
    return PAIR[0] if side == "a" else PAIR[1]


def lang_side(lang: str | None) -> str | None:
    if lang == PAIR[0]:
        return "a"
    if lang == PAIR[1]:
        return "b"
    return None


def other_side(side: str) -> str:
    return "b" if side == "a" else "a"


def other_lang(lang: str) -> str:
    return PAIR[1] if lang == PAIR[0] else PAIR[0]
