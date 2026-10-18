"""Moteurs SIMULÉS : ils font tourner toute la chaîne sans aucun modèle.

Ce n'est PAS de la vraie traduction ni de la vraie reconnaissance : c'est un banc d'essai
(mode `relais demo`) pour développer l'interface, tester le protocole et vérifier la
latence de bout en bout. L'interface affiche un badge « Démo » quand ils sont actifs.
"""

from __future__ import annotations

import array
import math
import re
import sys

from ..core.audio import rms_pcm16
from .base import RecResult, Voice

# --------------------------------------------------------------------------- #
# Traduction : petit lexique mot à mot, de quoi rendre la démo lisible.
# --------------------------------------------------------------------------- #
_EN_FR = {
    "hello": "bonjour", "hi": "salut", "goodbye": "au revoir", "thanks": "merci", "thank": "merci",
    "you": "vous", "very": "très", "much": "beaucoup", "for": "pour", "your": "votre", "my": "mon",
    "help": "aide", "today": "aujourd'hui", "tomorrow": "demain", "tonight": "ce soir",
    "morning": "matin", "evening": "soir", "meeting": "réunion", "starts": "commence",
    "start": "commencer", "at": "à", "nine": "neuf", "ten": "dix", "two": "deux", "three": "trois",
    "i": "je", "would": "voudrais", "like": "aimer", "to": "à", "book": "réserver", "a": "une",
    "the": "le", "table": "table", "can": "pouvez", "hear": "entendre", "me": "moi",
    "clearly": "clairement", "how": "comment", "are": "êtes", "is": "est", "what": "quoi",
    "where": "où", "when": "quand", "why": "pourquoi", "yes": "oui", "no": "non",
    "please": "s'il vous plaît", "sorry": "désolé", "good": "bon", "great": "super",
    "and": "et", "or": "ou", "with": "avec", "we": "nous", "they": "ils", "it": "cela",
    "this": "ceci", "that": "cela", "have": "avoir", "need": "besoin", "want": "veux",
    "time": "heure", "day": "jour", "name": "nom", "work": "travail", "home": "maison",
    "here": "ici", "there": "là", "now": "maintenant", "later": "plus tard", "again": "encore",
    "speak": "parler", "english": "anglais", "french": "français", "understand": "comprendre",
    "slowly": "lentement", "repeat": "répéter", "test": "essai", "sentence": "phrase",
    "voice": "voix", "typing": "frappe", "word": "mot", "words": "mots", "on": "sur", "in": "dans",
}
_FR_EN = {v: k for k, v in _EN_FR.items() if " " not in v}
_FR_EN.update({
    "bonjour": "hello", "salut": "hi", "merci": "thank you", "est-ce": "do", "que": "that",
    "m'entendez": "hear me", "bien": "well", "voudrais": "would like", "réserver": "book",
    "pour": "for", "deux": "two", "ce": "this", "soir": "tonight", "réunion": "meeting",
    "commence": "starts", "demain": "tomorrow", "matin": "morning", "à": "at", "neuf": "nine",
    "heures": "o'clock", "beaucoup": "very much", "votre": "your", "aide": "help",
    "aujourd'hui": "today", "je": "I", "vous": "you", "une": "a", "un": "a", "le": "the",
    "la": "the", "les": "the", "des": "some", "du": "of the", "de": "of", "et": "and",
    "sont": "are", "suis": "am", "comment": "how", "allez-vous": "are you", "ça": "it",
    "va": "goes", "oui": "yes", "non": "no", "table": "table", "parlez": "speak",
    "lentement": "slowly", "répétez": "repeat", "comprends": "understand",
})
_WORD = re.compile(r"[\w'’-]+|[^\w\s]", re.UNICODE)

# Les phrases que le faux micro « reconnaît » ont une vraie traduction, pour que la démo soit lisible.
_PHRASES = {
    ("en", "fr"): {
        "hello, can you hear me clearly?": "Bonjour, est-ce que vous m'entendez bien ?",
        "i would like to book a table for two tonight.": "Je voudrais réserver une table pour deux ce soir.",
        "the meeting starts at nine tomorrow morning.": "La réunion commence demain matin à neuf heures.",
        "thank you very much for your help today.": "Merci beaucoup pour votre aide aujourd'hui.",
    },
    ("fr", "en"): {
        "bonjour, est-ce que vous m'entendez bien ?": "Hello, can you hear me clearly?",
        "je voudrais réserver une table pour deux ce soir.": "I would like to book a table for two tonight.",
        "la réunion commence demain matin à neuf heures.": "The meeting starts at nine tomorrow morning.",
        "merci beaucoup pour votre aide aujourd'hui.": "Thank you very much for your help today.",
    },
}


class MockTranslator:
    kind = "mock"

    def translate_batch(self, texts: list[str], src: str, tgt: str, beam: int = 1) -> list[str]:
        table = _EN_FR if (src, tgt) == ("en", "fr") else _FR_EN
        phrases = _PHRASES.get((src, tgt), {})
        return [phrases.get(t.strip().lower().replace("’", "'")) or self._one(t, table) for t in texts]

    @staticmethod
    def _one(text: str, table: dict[str, str]) -> str:
        out: list[str] = []
        for tok in _WORD.findall(text.replace("’", "'")):
            if re.match(r"[\w]", tok):
                low = tok.lower()
                rep = table.get(low, tok)
                if tok[:1].isupper() and rep:
                    rep = rep[:1].upper() + rep[1:]
                out.append(rep)
            else:
                out.append(tok)
        s = " ".join(out)
        s = re.sub(r"\s+([,.;:!?…])", r"\1", s)
        return s

    def close(self) -> None:
        pass


# --------------------------------------------------------------------------- #
# Reconnaissance : révèle une phrase mot à mot selon la durée de parole.
# --------------------------------------------------------------------------- #
_SENTENCES = {
    "en": [
        "Hello, can you hear me clearly?",
        "I would like to book a table for two tonight.",
        "The meeting starts at nine tomorrow morning.",
        "Thank you very much for your help today.",
    ],
    "fr": [
        "Bonjour, est-ce que vous m'entendez bien ?",
        "Je voudrais réserver une table pour deux ce soir.",
        "La réunion commence demain matin à neuf heures.",
        "Merci beaucoup pour votre aide aujourd'hui.",
    ],
}


class MockRecognizer:
    kind = "mock"

    def detect(self, pcm16: bytes) -> tuple[str, float]:
        return "en", 0.9

    def transcribe(self, pcm16: bytes, language: str | None, final: bool, hint: int = 0) -> RecResult:
        if rms_pcm16(pcm16) < 0.004:  # silence : rien à reconnaître
            return RecResult("", language or "en", 0.0)
        lang = language or ("en" if hint % 2 else "fr")
        sentence = _SENTENCES[lang][(hint // 2 + (0 if lang == "en" else 1)) % len(_SENTENCES[lang])]
        words = sentence.split()
        if final:
            return RecResult(sentence, lang, 0.95)
        seconds = len(pcm16) / 2 / 16000
        n = max(1, min(len(words), int(seconds * 2.6)))
        return RecResult(" ".join(words[:n]), lang, 0.9)

    def close(self) -> None:
        pass


# --------------------------------------------------------------------------- #
# Synthèse : salves de sons modulés, une par mot. On l'entend, c'est tout.
# --------------------------------------------------------------------------- #
class MockSynthesizer:
    kind = "mock"
    SR = 22050

    def voices(self, lang: str) -> list[Voice]:
        return [Voice(f"mock-{lang}-1", lang, "Voix simulée 1"), Voice(f"mock-{lang}-2", lang, "Voix simulée 2")]

    def synth(self, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, int]:
        base = 118.0 if voice.endswith("1") else 188.0
        if lang == "fr":
            base *= 1.06
        out = array.array("h")
        rate = max(0.3, rate)
        for wi, word in enumerate(re.findall(r"\w+", text)):
            dur = (0.07 + 0.032 * len(word)) / rate
            n = int(self.SR * dur)
            f0 = base * (1 + 0.04 * (ord(word[0]) % 7)) * (1.08 if wi == 0 else 1.0)
            for i in range(n):
                t = i / self.SR
                env = math.sin(math.pi * i / n) ** 0.7
                f = f0 * (1 + 0.05 * math.sin(2 * math.pi * 5 * t))
                s = (math.sin(2 * math.pi * f * t) + 0.5 * math.sin(4 * math.pi * f * t)
                     + 0.25 * math.sin(6 * math.pi * f * t))
                out.append(int(5200 * env * s))
            out.extend([0] * int(self.SR * 0.045 / rate))
        if sys.byteorder == "big":
            out.byteswap()
        return out.tobytes(), self.SR

    def close(self) -> None:
        pass
