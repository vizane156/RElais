"""API HTTP + fichiers statiques, indépendante du serveur réseau.

`Api.handle(method, path, query, headers, body)` -> Response. Les deux serveurs (Starlette
et stdlib) n'ont qu'à traduire leur requête dans cet appel : toute la logique est ici,
donc testée une seule fois.
"""

from __future__ import annotations

import json
import mimetypes
import posixpath
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote

from .. import __version__
from ..paths import WEB
from .langs import NAMES

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")

MAX_JSON = 2 * 1024 * 1024
MAX_UPLOAD = 150 * 1024 * 1024

CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
       "media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:; "
       "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
}


class Response(NamedTuple):
    status: int
    headers: dict
    body: bytes


def json_response(obj, status: int = 200) -> Response:
    return Response(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
                    json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def error(status: int, code: str, message: str = "") -> Response:
    return json_response({"error": code, "message": message}, status)


class Api:
    def __init__(self, app):
        self.app = app

    async def handle(self, method: str, path: str, query: dict, headers: dict, body: bytes) -> Response:
        headers = {k.lower(): v for k, v in headers.items()}
        host, origin = headers.get("host"), headers.get("origin")
        if not self.app.security.host_ok(host):
            return error(403, "bad_host", "Hôte non autorisé (voir --lan / --allow-host).")
        if not self.app.security.origin_ok(origin, host):
            return error(403, "bad_origin", "Origine non autorisée.")
        method = method.upper()
        if path.startswith("/api/"):
            try:
                return await self._api(method, path, query, headers, body)
            except ValueError as exc:
                return error(400, "bad_request", str(exc))
        return self._static(method, path)

    # ------------------------------------------------------------------ API
    @staticmethod
    def _json_body(body: bytes) -> dict:
        if len(body) > MAX_JSON:
            raise ValueError("corps trop volumineux")
        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError("JSON invalide") from exc
        if not isinstance(data, dict):
            raise ValueError("objet JSON attendu")
        return data

    async def _api(self, method, path, query, headers, body) -> Response:
        app = self.app
        parts = [unquote(p) for p in path[len("/api/"):].strip("/").split("/")]
        head, rest = parts[0], parts[1:]

        if head == "info" and method == "GET":
            return json_response({"version": __version__, "engines": app.engine_kind,
                                  "home": str(app.paths.home), "names": NAMES})
        if head == "state" and method == "GET":
            return json_response(app.snapshot())
        if head == "schema" and method == "GET":
            return json_response(app.schema.raw)

        if head == "settings":
            if method == "GET" and not rest:
                return json_response({"values": app.settings.snapshot()})
            if method == "PUT" and not rest:
                changed, rejected = app.settings.patch(self._json_body(body))
                await app.apply_settings_change(changed)
                return json_response({"values": app.settings.snapshot(), "rejected": rejected})
            if method == "POST" and rest == ["reset"]:
                keys = self._json_body(body).get("keys")
                changed = app.settings.reset(keys if isinstance(keys, list) else None)
                await app.apply_settings_change(changed)
                return json_response({"values": app.settings.snapshot()})

        if head == "profiles":
            if method == "GET" and not rest:
                return json_response({"profiles": app.profiles.list()})
            if method == "PUT" and len(rest) == 1:
                if not app.profiles.valid_name(rest[0]):
                    return error(400, "bad_name", "Nom de profil invalide")
                app.profiles.save(rest[0], app.settings.snapshot())
                return json_response({"profiles": app.profiles.list()})
            if method == "POST" and len(rest) == 2 and rest[1] == "apply":
                values = app.profiles.load(rest[0])
                if values is None:
                    return error(404, "not_found")
                changed, rejected = app.settings.patch(values)
                await app.apply_settings_change(changed)
                return json_response({"values": app.settings.snapshot(), "rejected": rejected})
            if method == "DELETE" and len(rest) == 1:
                app.profiles.delete(rest[0])
                return json_response({"profiles": app.profiles.list()})

        if head == "glossary":
            if method == "GET":
                return json_response({"rules": app.glossary.get()})
            if method == "PUT":
                rules = app.glossary.set(self._json_body(body).get("rules", []))
                return json_response({"rules": rules})

        if head == "history":
            if method == "GET" and rest == ["export.txt"]:
                txt = app.history.export_txt(NAMES)
                return Response(200, {"Content-Type": "text/plain; charset=utf-8",
                                      "Content-Disposition": 'attachment; filename="relais-conversation.txt"'},
                                txt.encode("utf-8"))
            if method == "GET" and not rest:
                try:
                    limit = min(2000, max(1, int(query.get("limit", 200))))
                except ValueError:
                    limit = 200
                return json_response({"items": app.history.tail(limit)})
            if method == "DELETE" and not rest:
                app.history.clear()
                return json_response({"ok": True})

        if head == "models" and method == "GET":
            return json_response(app.factory.model_status())

        if head == "recordings":
            return await self._recordings(method, rest, query, headers, body)

        return error(404, "not_found")

    async def _recordings(self, method, rest, query, headers, body) -> Response:
        store, hub = self.app.recordings, self.app.hub
        if method == "GET" and not rest:
            return json_response({"items": store.list()})
        if method == "PUT" and not rest:
            if len(body) > MAX_UPLOAD:
                return error(413, "too_large")
            meta = store.add_wav(body, name=query.get("name", ""), kind=query.get("kind", "voice"),
                                 lang=query.get("lang", ""), source=query.get("source", "record"))
            await hub.broadcast({"t": "rec", "action": "added", "item": meta})
            return json_response(meta, 201)
        if len(rest) == 1:
            rid, is_wav = (rest[0][:-4], True) if rest[0].endswith(".wav") else (rest[0], False)
            if method in ("GET", "HEAD") and is_wav:
                path = store.path(rid)
                if path is None:
                    return error(404, "not_found")
                return self._file(path, headers, "audio/wav", head=(method == "HEAD"))
            if method == "PATCH" and not is_wav:
                meta = store.update(rid, self._json_body(body))
                if meta is None:
                    return error(404, "not_found")
                await hub.broadcast({"t": "rec", "action": "updated", "item": meta})
                return json_response(meta)
            if method == "DELETE" and not is_wav:
                if not store.delete(rid):
                    return error(404, "not_found")
                await hub.broadcast({"t": "rec", "action": "deleted", "id": rid})
                return json_response({"ok": True})
        return error(404, "not_found")

    # ------------------------------------------------------------- fichiers
    @staticmethod
    def _file(path: Path, headers: dict, ctype: str, head: bool = False) -> Response:
        size = path.stat().st_size
        base = {"Content-Type": ctype, "Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
        rng = headers.get("range", "")
        if rng.startswith("bytes="):
            a, _, b = rng[6:].split(",")[0].strip().partition("-")
            try:
                if a == "":
                    start, end = max(0, size - int(b)), size - 1
                else:
                    start, end = int(a), (int(b) if b else size - 1)
            except ValueError:
                start, end = 0, size - 1
            end = min(end, size - 1)
            if start >= size or start > end:
                return Response(416, {**base, "Content-Range": f"bytes */{size}"}, b"")
            with open(path, "rb") as fh:
                fh.seek(start)
                data = fh.read(end - start + 1)
            return Response(206, {**base, "Content-Range": f"bytes {start}-{end}/{size}"}, b"" if head else data)
        return Response(200, base, b"" if head else path.read_bytes())

    def _static(self, method: str, path: str) -> Response:
        if method not in ("GET", "HEAD"):
            return error(405, "method_not_allowed")
        rel = posixpath.normpath(unquote(path)).lstrip("/")
        if rel in ("", "."):
            rel = "index.html"
        if "\x00" in rel or rel.startswith(".."):
            return error(404, "not_found")
        root, sub = WEB.resolve(), rel
        if rel.startswith("fonts/"):  # installées par « relais pull fonts », hors du paquet
            root, sub = self.app.paths.fonts.resolve(), rel[len("fonts/"):]
        target = (root / sub).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return error(404, "not_found")
        if not target.is_file():
            return error(404, "not_found")
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
            ctype += "; charset=utf-8" if "charset" not in ctype else ""
        data = b"" if method == "HEAD" else target.read_bytes()
        return Response(200, {"Content-Type": ctype, "Cache-Control": "no-cache", **SECURITY_HEADERS}, data)
