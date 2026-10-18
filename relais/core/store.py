"""Stockage disque : enregistrements, historique de conversation, glossaire."""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from pathlib import Path

from .audio import wav_info
from .glossary import Glossary, Rule
from .settings import _atomic_write

_ID_RE = re.compile(r"^[0-9A-Za-z\-]{6,64}$")


class RecordingStore:
    """Bibliothèque audio : voix enregistrées/téléversées, phrases gardées.

    Sur le disque, UNIQUEMENT des noms générés (jamais de texte venant de l'utilisateur
    dans un chemin) : <id>.wav + <id>.json.
    """

    MAX_BYTES = 150 * 1024 * 1024
    KINDS = ("voice", "clip")

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def add_wav(self, data: bytes, name: str = "", kind: str = "voice", lang: str = "",
                source: str = "record") -> dict:
        if len(data) > self.MAX_BYTES:
            raise ValueError("fichier trop volumineux")
        info = wav_info(data)
        kind = kind if kind in self.KINDS else "voice"
        rid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
        name = (name or "").strip()[:80] or time.strftime("Enregistrement %d/%m %H:%M")
        meta = {
            "id": rid, "name": name, "kind": kind, "lang": lang if lang in ("en", "fr", "") else "",
            "source": source, "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "duration": info["duration"], "sample_rate": info["sample_rate"],
            "channels": info["channels"], "bytes": len(data),
        }
        with self._lock:
            (self.root / f"{rid}.wav").write_bytes(data)
            _atomic_write(self.root / f"{rid}.json", json.dumps(meta, ensure_ascii=False))
        return meta

    def list(self) -> list[dict]:
        out = []
        for p in self.root.glob("*.json"):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        out.sort(key=lambda m: m.get("created", ""), reverse=True)
        return out

    def meta(self, rid: str) -> dict | None:
        if not _ID_RE.match(rid or ""):
            return None
        try:
            return json.loads((self.root / f"{rid}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def path(self, rid: str) -> Path | None:
        if not _ID_RE.match(rid or ""):
            return None
        p = self.root / f"{rid}.wav"
        return p if p.is_file() else None

    def update(self, rid: str, patch: dict) -> dict | None:
        meta = self.meta(rid)
        if meta is None:
            return None
        if isinstance(patch.get("name"), str):
            meta["name"] = patch["name"].strip()[:80] or meta["name"]
        if patch.get("kind") in self.KINDS:
            meta["kind"] = patch["kind"]
        if patch.get("lang") in ("en", "fr", ""):
            meta["lang"] = patch["lang"]
        with self._lock:
            _atomic_write(self.root / f"{rid}.json", json.dumps(meta, ensure_ascii=False))
        return meta

    def delete(self, rid: str) -> bool:
        if not _ID_RE.match(rid or ""):
            return False
        ok = False
        with self._lock:
            for ext in (".wav", ".json"):
                try:
                    (self.root / f"{rid}{ext}").unlink()
                    ok = True
                except OSError:
                    pass
        return ok


class HistoryStore:
    """Journal de conversation, une ligne JSON par phrase finalisée."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def append(self, entry: dict) -> None:
        line = json.dumps(entry, ensure_ascii=False)
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    def tail(self, n: int = 200) -> list[dict]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                lines = fh.readlines()[-max(1, n):]
        except OSError:
            return []
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except ValueError:
                continue
        return out

    def clear(self) -> None:
        with self._lock:
            try:
                self.path.unlink()
            except OSError:
                pass

    def export_txt(self, names: dict[str, str]) -> str:
        lines = []
        for e in self.tail(100000):
            ts = time.strftime("%H:%M", time.localtime(e.get("ts", 0)))
            src = names.get(e.get("lang", ""), e.get("lang", ""))
            lines.append(f"[{ts}] {src} : {e.get('text', '')}")
            if e.get("translation"):
                dst = names.get(e.get("to", ""), e.get("to", ""))
                lines.append(f"       {dst} : {e['translation']}")
            lines.append("")
        return "\n".join(lines)


class GlossaryStore:
    MAX_RULES = 500

    def __init__(self, path: Path):
        self.path = Path(path)
        self._rules: list[dict] = []
        self._compiled: Glossary | None = None
        self._lock = threading.Lock()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self._rules = self._clean(data.get("rules", []))
        except (OSError, ValueError, AttributeError):
            pass

    @staticmethod
    def _clean(rules) -> list[dict]:
        out = []
        for r in rules if isinstance(rules, list) else []:
            if not isinstance(r, dict):
                continue
            src, term = r.get("src"), str(r.get("term", "")).strip()
            target, mode = str(r.get("target", "")).strip(), r.get("mode", "keep")
            if src not in ("en", "fr") or not term or len(term) > 80 or len(target) > 120:
                continue
            if mode not in ("keep", "replace"):
                mode = "keep"
            if mode == "replace" and not target:
                mode = "keep"
            out.append({"src": src, "term": term, "target": target, "mode": mode})
        return out[: GlossaryStore.MAX_RULES]

    def get(self) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._rules]

    def set(self, rules) -> list[dict]:
        with self._lock:
            self._rules = self._clean(rules)
            self._compiled = None
            _atomic_write(self.path, json.dumps({"rules": self._rules}, ensure_ascii=False, indent=2))
            return [dict(r) for r in self._rules]

    def compiled(self) -> Glossary:
        with self._lock:
            if self._compiled is None:
                self._compiled = Glossary([Rule(**r) for r in self._rules])
            return self._compiled
