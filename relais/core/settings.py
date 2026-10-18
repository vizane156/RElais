"""Réglages : schéma, validation, persistance, profils.

Les réglages sont un dictionnaire PLAT à clés pointées (« speak.rate »). Le schéma
(data/schema.json) décrit chaque clé : type, bornes, valeur par défaut. C'est lui
qui pilote la validation ici ET la génération de l'écran de réglages côté web.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
import unicodedata
from pathlib import Path
from typing import Any

from ..paths import DATA_PKG

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
CAP_IDS = ("listen", "translate", "speak", "typespeak", "record", "clone")


class Schema:
    def __init__(self, raw: dict):
        self.raw = raw
        self.fields: dict[str, dict] = {}
        for sec in raw["sections"]:
            for f in sec["fields"]:
                self.fields[f["key"]] = f
        for f in raw.get("hidden", []):
            self.fields[f["key"]] = f

    @classmethod
    def load(cls, path: Path | None = None) -> "Schema":
        p = path or (DATA_PKG / "schema.json")
        return cls(json.loads(Path(p).read_text(encoding="utf-8")))

    def defaults(self) -> dict[str, Any]:
        return {k: (list(f["default"]) if isinstance(f["default"], list) else f["default"])
                for k, f in self.fields.items()}

    def coerce(self, key: str, value: Any) -> tuple[bool, Any]:
        """(ok, valeur nettoyée). Jamais d'exception : une valeur invalide est refusée."""
        f = self.fields.get(key)
        if f is None:
            return False, None
        t = f["type"]
        try:
            if t == "toggle":
                if isinstance(value, bool):
                    return True, value
                return False, None
            if t == "select":
                opts = f.get("options")
                if opts:
                    for o in opts:
                        if value == o["value"] and type(value) is type(o["value"]):
                            return True, o["value"]
                    for o in opts:  # tolère "2" pour 2
                        if str(value) == str(o["value"]) and not isinstance(value, bool):
                            return True, o["value"]
                    return False, None
                if isinstance(value, str) and len(value) <= 300:
                    return True, value
                return False, None
            if t in ("range", "number"):
                if isinstance(value, bool) or value is None:
                    return False, None
                x = float(value)
                if not math.isfinite(x):
                    return False, None
                lo = f.get("min", -math.inf)
                hi = f.get("max", math.inf)
                x = min(max(x, lo), hi)
                step = f.get("step")
                if step and math.isfinite(lo):
                    x = round(round((x - lo) / step) * step + lo, 6)
                    x = min(max(x, lo), hi)
                d = f["default"]
                if isinstance(d, int) and not isinstance(d, bool) and float(step or 1).is_integer():
                    x = int(round(x))
                return True, x
            if t == "color":
                if isinstance(value, str) and COLOR_RE.match(value):
                    return True, value.upper()
                return False, None
            if t == "text":
                if isinstance(value, str) and len(value) <= 200:
                    return True, value
                return False, None
            if t == "caps":
                if isinstance(value, list) and all(isinstance(v, str) for v in value):
                    seen: list[str] = []
                    for v in value:
                        if v in CAP_IDS and v not in seen:
                            seen.append(v)
                    return True, seen
                return False, None
        except (TypeError, ValueError, OverflowError):
            return False, None
        return False, None

    def reload_target(self, key: str) -> str | None:
        f = self.fields.get(key)
        return f.get("reload") if f else None

    def profile_keys(self) -> list[str]:
        return [k for k, f in self.fields.items() if f.get("profile", True)]


def flatten(patch: dict, prefix: str = "") -> dict[str, Any]:
    """Accepte {"ui": {"lang": "en"}} aussi bien que {"ui.lang": "en"}."""
    out: dict[str, Any] = {}
    for k, v in patch.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        else:
            out[key] = v
    return out


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class SettingsStore:
    def __init__(self, path: Path, schema: Schema):
        self.path = Path(path)
        self.schema = schema
        self._lock = threading.RLock()
        self.values: dict[str, Any] = schema.defaults()
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        for k, v in flatten(data).items():
            ok, val = self.schema.coerce(k, v)
            if ok:
                self.values[k] = val

    def save(self) -> None:
        with self._lock:
            _atomic_write(self.path, json.dumps(self.values, ensure_ascii=False, indent=2, sort_keys=True))

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self.values.get(key, default)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self.values))

    def patch(self, patch: dict) -> tuple[dict[str, Any], list[str]]:
        """Applique un patch ; renvoie (clés réellement modifiées, clés refusées)."""
        changed: dict[str, Any] = {}
        rejected: list[str] = []
        with self._lock:
            for k, v in flatten(patch).items():
                ok, val = self.schema.coerce(k, v)
                if not ok:
                    rejected.append(k)
                    continue
                if self.values.get(k) != val:
                    self.values[k] = val
                    changed[k] = val
            if changed:
                self.save()
        return changed, rejected

    def reset(self, keys: list[str] | None = None) -> dict[str, Any]:
        defaults = self.schema.defaults()
        with self._lock:
            ks = keys or list(defaults)
            changed = {k: defaults[k] for k in ks if k in defaults and self.values.get(k) != defaults[k]}
            self.values.update(changed)
            if changed:
                self.save()
        return changed


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return _SLUG_RE.sub("-", s).strip("-")[:40]


class ProfileStore:
    """Profils = instantanés nommés des réglages (« Réunion », « Appel », « Voyage »…)."""

    def __init__(self, root: Path, schema: Schema):
        self.root = Path(root)
        self.schema = schema

    @staticmethod
    def valid_name(name: str) -> bool:
        name = (name or "").strip()
        return (1 <= len(name) <= 40 and bool(slugify(name)) and "/" not in name
                and all(c.isprintable() for c in name))

    def _path(self, name: str) -> Path:
        return self.root / f"{slugify(name)}.json"

    def list(self) -> list[str]:
        out = []
        for p in sorted(self.root.glob("*.json")):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8"))["name"])
            except (OSError, ValueError, KeyError):
                continue
        return out

    def save(self, name: str, values: dict[str, Any]) -> None:
        if not self.valid_name(name):
            raise ValueError("nom de profil invalide")
        keep = set(self.schema.profile_keys())
        payload = {"name": name.strip(), "settings": {k: v for k, v in values.items() if k in keep}}
        _atomic_write(self._path(name), json.dumps(payload, ensure_ascii=False, indent=2))

    def load(self, name: str) -> dict[str, Any] | None:
        try:
            data = json.loads(self._path(name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        s = data.get("settings")
        return s if isinstance(s, dict) else None

    def delete(self, name: str) -> bool:
        try:
            self._path(name).unlink()
            return True
        except OSError:
            return False
