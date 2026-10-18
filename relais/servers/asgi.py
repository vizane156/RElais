"""Adaptateur Starlette (ASGI) : le serveur recommandé pour l'usage quotidien.

Aucune logique ici : on relie le réseau à `Api` (HTTP) et à `Session` (WebSocket).
Installation : pip install "relais[server]"
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.responses import Response as StarletteResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from ..core.http_api import Api
from ..core.session import Session


def create_asgi_app(app) -> Starlette:
    api = Api(app)

    @asynccontextmanager
    async def lifespan(_):
        await app.start()
        try:
            yield
        finally:
            await app.stop()

    async def http(request):
        body = await request.body()
        resp = await api.handle(request.method, request.url.path, dict(request.query_params),
                                dict(request.headers), body)
        return StarletteResponse(resp.body, status_code=resp.status, headers=resp.headers)

    async def ws_endpoint(ws: WebSocket):
        host, origin = ws.headers.get("host"), ws.headers.get("origin")
        if not app.security.host_ok(host) or not app.security.origin_ok(origin, host):
            await ws.close(code=1008)
            return
        await ws.accept()

        async def send(msg):
            if isinstance(msg, (bytes, bytearray)):
                await ws.send_bytes(bytes(msg))
            else:
                await ws.send_text(json.dumps(msg, ensure_ascii=False))

        session = Session(app, send)
        await session.start()
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    await session.on_binary(message["bytes"])
                elif message.get("text") is not None:
                    await session.on_text(message["text"])
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await session.close()

    return Starlette(
        routes=[
            WebSocketRoute("/ws", ws_endpoint),
            Route("/{path:path}", http, methods=["GET", "HEAD", "PUT", "POST", "PATCH", "DELETE"]),
        ],
        lifespan=lifespan,
    )
