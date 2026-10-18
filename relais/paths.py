"""Emplacements des fichiers : code, interface web, données de l'utilisateur."""

from __future__ import annotations

import os
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent
DATA_PKG = PKG / "data"
WEB = PKG / "web"


def default_home() -> Path:
    env = os.environ.get("RELAIS_HOME")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "Relais"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Relais"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "relais"


class Paths:
    """Tout ce que Relais écrit sur le disque vit sous `home`."""

    def __init__(self, home: Path | str | None = None):
        self.home = Path(home).expanduser() if home else default_home()
        self.settings = self.home / "settings.json"
        self.profiles = self.home / "profiles"
        self.glossary = self.home / "glossary.json"
        self.history = self.home / "history.jsonl"
        self.recordings = self.home / "recordings"
        self.models = self.home / "models"
        self.fonts = self.home / "fonts"

    def ensure(self) -> "Paths":
        for p in (self.home, self.profiles, self.recordings, self.models, self.fonts):
            p.mkdir(parents=True, exist_ok=True)
        return self
