"""Texte : découpage en phrases, découpage pour la voix, nettoyage des transcriptions."""

from __future__ import annotations

import re
import unicodedata

SENT_RE = re.compile(r"(?<=[.!?…])[ \t]+")
CLAUSE_RE = re.compile(r"(?<=[,;:—–])\s+")
NL = "\x00NL\x00"  # marqueur de saut de ligne : jamais traduit, toujours restitué
MAX_SEG = 320


def segment(text: str) -> list[str]:
    """Texte -> segments courts (une phrase en général), sauts de ligne conservés."""
    segs: list[str] = []
    for i, line in enumerate(text.split("\n")):
        if i:
            segs.append(NL)
        if not line.strip():
            continue
        for s in SENT_RE.split(line):
            while len(s) > MAX_SEG:
                cut = s.rfind(" ", 0, MAX_SEG)
                if cut <= 0:
                    cut = MAX_SEG
                segs.append(s[:cut])
                s = s[cut:].lstrip()
            if s:
                segs.append(s)
    return segs


def rejoin(parts: list[str]) -> str:
    out: list[str] = []
    for p in parts:
        if p == NL:
            out.append("\n")
        else:
            if out and not out[-1].endswith("\n"):
                out.append(" ")
            out.append(p)
    return "".join(out)


def split_for_speech(text: str, max_chars: int = 150, first_max: int = 90) -> list[str]:
    """Morceaux à synthétiser. Le premier est court : c'est lui qui fixe le délai
    avant le premier son. Les suivants sont plus longs pour une prosodie naturelle."""
    chunks: list[str] = []
    for seg in segment(text):
        s = seg.strip()
        if seg == NL or not s:
            continue
        limit = first_max if not chunks else max_chars
        if len(s) <= limit:
            chunks.append(s)
            continue
        cur = ""
        for part in CLAUSE_RE.split(s):
            lim = first_max if not chunks else max_chars
            if cur and len(cur) + 1 + len(part) > lim:
                chunks.append(cur)
                cur = part
            else:
                cur = f"{cur} {part}".strip()
        if cur:
            chunks.append(cur)
    out: list[str] = []
    for c in chunks:  # dernier recours : une « phrase » géante sans ponctuation
        while len(c) > max_chars * 2:
            cut = c.rfind(" ", 0, max_chars * 2)
            cut = cut if cut > 0 else max_chars * 2
            out.append(c[:cut].strip())
            c = c[cut:].strip()
        if c:
            out.append(c)
    return out


# Phrases que Whisper « invente » sur du bruit ou du silence.
_HALLUCINATIONS = (
    "thanks for watching", "thank you for watching", "merci d'avoir regardé",
    "sous-titres réalisés par", "sous-titrage st", "amara.org", "subtitles by",
    "sous-titres par la communauté", "please subscribe", "n'oubliez pas de vous abonner",
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().replace("’", "'")
    return re.sub(r"\s+", " ", s).strip()


def clean_transcript(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def is_hallucination(text: str) -> bool:
    n = _norm(text)
    if not n or not re.search(r"\w", n):
        return True
    return any(h in n for h in _HALLUCINATIONS)
