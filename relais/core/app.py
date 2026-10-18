"""Conteneur de l'application : réglages, stockage, registre, diffusion aux sessions.

Les deux serveurs (Starlette et stdlib) ne font que relier le réseau à cet objet.
"""

from __future__ import annotations

import ipaddress
import logging
from concurrent.futures import ThreadPoolExecutor

from .. import __version__
from ..engines.factory import EngineFactory
from ..paths import Paths
from .langs import NAMES, PAIR
from .registry import Registry
from .settings import ProfileStore, Schema, SettingsStore
from .store import GlossaryStore, HistoryStore, RecordingStore

log = logging.getLogger("relais")

LOCAL_NAMES = {"localhost", "127.0.0.1", "::1"}


class Hub:
    """Diffuse un message à toutes les sessions ouvertes (onglets, fenêtres)."""

    def __init__(self):
        self.sessions: set = set()

    def add(self, s) -> None:
        self.sessions.add(s)

    def remove(self, s) -> None:
        self.sessions.discard(s)

    async def broadcast(self, msg: dict) -> None:
        for s in list(self.sessions):
            await s.send(msg)


class Security:
    """Protège le serveur local contre les pages web tierces.

    Une WebSocket n'est pas soumise à la règle de même origine : sans ce contrôle, n'importe
    quel site ouvert dans ton navigateur pourrait se connecter à ws://localhost et lire
    l'historique de tes conversations. On vérifie donc l'en-tête Origin (même origine) et
    l'en-tête Host (contre le « DNS rebinding »).
    """

    def __init__(self, lan: bool = False, extra_hosts: tuple[str, ...] = ()):
        self.lan = lan
        self.extra = {h.lower() for h in extra_hosts}

    @staticmethod
    def hostname(hostport: str) -> str:
        h = (hostport or "").strip().lower()
        if h.startswith("["):
            return h[1 : h.find("]")] if "]" in h else h
        return h.rsplit(":", 1)[0] if h.count(":") == 1 else h

    def host_ok(self, host_header: str | None) -> bool:
        name = self.hostname(host_header or "")
        if name in LOCAL_NAMES or name in self.extra:
            return True
        if self.lan:
            if name.endswith(".local"):
                return True
            try:
                return ipaddress.ip_address(name).is_private
            except ValueError:
                return False
        return False

    def origin_ok(self, origin: str | None, host_header: str | None) -> bool:
        if not origin:  # client non-navigateur (curl, scripts) : pas un vecteur d'attaque web
            return True
        netloc = origin.split("://", 1)[-1].lower()
        return netloc == (host_header or "").strip().lower()


class RelaisApp:
    def __init__(self, home=None, engines: str = "real", lan: bool = False, extra_hosts=()):
        self.paths = Paths(home).ensure()
        self.engine_kind = engines
        self.schema = Schema.load()
        self.settings = SettingsStore(self.paths.settings, self.schema)
        self.profiles = ProfileStore(self.paths.profiles, self.schema)
        self.glossary = GlossaryStore(self.paths.glossary)
        self.recordings = RecordingStore(self.paths.recordings)
        self.history = HistoryStore(self.paths.history)
        self.security = Security(lan=lan, extra_hosts=tuple(extra_hosts))
        self.hub = Hub()
        # Un thread par type de travail : la reconnaissance et la synthèse se chevauchent,
        # mais jamais deux inférences du même type en même temps (ça ruinerait la latence).
        self.pools = {
            "stt": ThreadPoolExecutor(1, thread_name_prefix="stt"),
            "mt": ThreadPoolExecutor(1, thread_name_prefix="mt"),
            "tts": ThreadPoolExecutor(1, thread_name_prefix="tts"),
            "load": ThreadPoolExecutor(2, thread_name_prefix="load"),
        }
        self.factory = EngineFactory(engines, self)
        self.registry = Registry(self)

    # ---- cycle de vie -------------------------------------------------------
    async def start(self) -> None:
        await self.registry.restore()

    async def stop(self) -> None:
        await self.registry.shutdown()
        for p in self.pools.values():
            p.shutdown(wait=False, cancel_futures=True)

    # ---- état ---------------------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "t": "state",
            "v": 1,
            "version": __version__,
            "engines": self.engine_kind,
            "pair": {"a": PAIR[0], "b": PAIR[1], "names": NAMES},
            "settings": self.settings.snapshot(),
            "caps": self.registry.snapshot(),
            "voices": self.factory.voices_for_ui(),
            "profiles": self.profiles.list(),
        }

    async def apply_settings_change(self, changed: dict) -> None:
        if not changed:
            return
        await self.hub.broadcast({"t": "settings", "values": self.settings.snapshot(), "changed": sorted(changed)})
        targets = {t for k in changed if (t := self.schema.reload_target(k))}
        for t in sorted(targets):
            await self.registry.reload(t)
        if "speak.engine" in changed:
            await self.hub.broadcast({"t": "voices", "voices": self.factory.voices_for_ui()})
