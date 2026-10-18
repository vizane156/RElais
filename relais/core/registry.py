"""Registre des fonctionnalités (« capacités »).

Chaque fonctionnalité s'active et se désactive à tout moment. Activer charge le moteur
en arrière-plan (état « loading »), désactiver peut le décharger pour libérer la mémoire.
Les dépendances s'activent toutes seules : « Parler en tapant » allume « Voix ».
"""

from __future__ import annotations

import asyncio
import gc
import logging

from ..engines.base import EngineUnavailable

log = logging.getLogger("relais.registry")

# `requires` : dépendances dures. `engine` : a-t-elle son propre moteur à charger ?
CAP_DEFS = [
    {"id": "listen", "requires": [], "engine": True},
    {"id": "translate", "requires": [], "engine": True},
    {"id": "speak", "requires": [], "engine": True},
    {"id": "typespeak", "requires": ["speak"], "engine": False},
    {"id": "record", "requires": [], "engine": False},
    {"id": "clone", "requires": ["speak"], "engine": False, "planned": True},
]


class Cap:
    def __init__(self, d: dict):
        self.id: str = d["id"]
        self.requires: list[str] = d["requires"]
        self.has_engine: bool = d["engine"]
        self.planned: bool = d.get("planned", False)
        self.enabled = False
        self.state = "unavailable" if self.planned else "off"
        self.detail: dict | None = {"key": "cap.clone.planned", "text": "Prévu en phase 3."} if self.planned else None
        self.engine = None


class Registry:
    def __init__(self, app):
        self.app = app
        self.caps: dict[str, Cap] = {d["id"]: Cap(d) for d in CAP_DEFS}
        self._tasks: dict[str, asyncio.Task] = {}

    # ---- lecture -----------------------------------------------------------
    def get(self, cap_id: str) -> Cap:
        return self.caps[cap_id]

    def engine(self, cap_id: str):
        """Le moteur, seulement s'il est allumé ET prêt. Sinon None."""
        c = self.caps[cap_id]
        return c.engine if (c.enabled and c.state == "ready") else None

    def is_on(self, cap_id: str) -> bool:
        """Allumée ET prête, y compris pour les fonctions sans moteur propre (état dérivé)."""
        c = self.caps[cap_id]
        return c.enabled and self.public(c)["state"] == "ready"

    def public(self, c: Cap) -> dict:
        state, detail = c.state, c.detail
        if c.enabled and not c.has_engine and not c.planned:
            # états dérivés : « Parler en tapant » suit l'état de « Voix »
            if c.requires:
                dep = self.caps[c.requires[0]]
                state, detail = dep.state, dep.detail
            else:
                state, detail = "ready", None
        elif not c.enabled and not c.planned:
            state = "off"
        return {"id": c.id, "enabled": c.enabled, "state": state, "detail": detail}

    def snapshot(self) -> list[dict]:
        return [self.public(c) for c in self.caps.values()]

    # ---- écriture ----------------------------------------------------------
    async def _emit(self, c: Cap) -> None:
        await self.app.hub.broadcast({"t": "cap", **self.public(c)})
        for other in self.caps.values():  # les états dérivés suivent
            if not other.has_engine and c.id in other.requires and other.enabled:
                await self.app.hub.broadcast({"t": "cap", **self.public(other)})

    def _persist(self) -> None:
        on = [c.id for c in self.caps.values() if c.enabled and not c.planned]
        self.app.settings.patch({"caps.on": on})

    async def set_enabled(self, cap_id: str, on: bool) -> None:
        c = self.caps.get(cap_id)
        if c is None or c.planned:
            return
        if on:
            for dep in c.requires:
                await self.set_enabled(dep, True)
            c.enabled = True
            self._persist()
            if c.has_engine:
                await self._ensure_loaded(c)
            await self._emit(c)
        else:
            c.enabled = False
            for other in self.caps.values():
                if cap_id in other.requires and other.enabled:
                    await self.set_enabled(other.id, False)
            if c.has_engine:
                await self._cancel_load(c)
                if self.app.settings.get("perf.unload_when_off", True):
                    self._unload(c)
                c.state = "ready" if c.engine is not None else "off"
                c.detail = None
            self._persist()
            await self._emit(c)

    async def _ensure_loaded(self, c: Cap) -> None:
        if c.engine is not None:
            c.state, c.detail = "ready", None
            return
        t = self._tasks.get(c.id)
        if t and not t.done():
            return
        c.state, c.detail = "loading", None
        self._tasks[c.id] = asyncio.create_task(self._load(c))

    async def _load(self, c: Cap) -> None:
        loop = asyncio.get_running_loop()
        await self._emit(c)
        try:
            eng = await loop.run_in_executor(self.app.pools["load"], self.app.factory.make, c.id)
            if not c.enabled:  # éteinte pendant le chargement
                try:
                    eng.close()
                except Exception:  # noqa: BLE001
                    pass
                c.state, c.detail = "off", None
            else:
                c.engine, c.state, c.detail = eng, "ready", None
        except EngineUnavailable as exc:
            c.state = "unavailable"
            c.detail = {"key": exc.key, "params": exc.params, "text": exc.text}
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("chargement de %s échoué", c.id)
            c.state = "error"
            c.detail = {"key": "err.load", "text": f"{type(exc).__name__}: {exc}"[:300]}
        await self._emit(c)

    async def _cancel_load(self, c: Cap) -> None:
        t = self._tasks.get(c.id)
        if t and not t.done():
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    def _unload(self, c: Cap) -> None:
        if c.engine is not None:
            try:
                c.engine.close()
            except Exception:  # noqa: BLE001
                pass
            c.engine = None
            gc.collect()

    async def reload(self, cap_id: str) -> None:
        c = self.caps.get(cap_id)
        if c is None or not c.has_engine:
            return
        await self._cancel_load(c)
        self._unload(c)
        if c.enabled:
            await self._ensure_loaded(c)
            await self._emit(c)

    async def restore(self) -> None:
        """Au démarrage : rallume ce qui était allumé à la dernière session."""
        for cap_id in self.app.settings.get("caps.on", []):
            await self.set_enabled(cap_id, True)

    async def wait_ready(self, cap_id: str, timeout: float = 10.0) -> bool:
        t = self._tasks.get(cap_id)
        if t:
            try:
                await asyncio.wait_for(asyncio.shield(t), timeout)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        return self.is_on(cap_id)

    async def shutdown(self) -> None:
        for c in self.caps.values():
            await self._cancel_load(c)
            self._unload(c)
