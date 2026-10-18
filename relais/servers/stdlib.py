"""Serveur HTTP + WebSocket en bibliothèque standard, sans aucune dépendance.

Sert à trois choses : `relais demo` (essayer l'interface immédiatement, sans rien installer),
le banc d'essai de bout en bout, et un repli si Starlette n'est pas installé. Pour un
usage quotidien, préfère le serveur Starlette/uvicorn (`pip install "relais[server]"`).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import struct
from urllib.parse import parse_qsl, unquote, urlsplit

from ..core.http_api import Api, Response
from ..core.session import Session

log = logging.getLogger("relais.stdlib")

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 32 * 1024 * 1024
REASONS = {200: "OK", 201: "Created", 206: "Partial Content", 400: "Bad Request", 403: "Forbidden",
           404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large",
           416: "Range Not Satisfiable", 500: "Internal Server Error"}


class WSConn:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.r, self.w = reader, writer
        self._lock = asyncio.Lock()
        self.closed = False

    async def _write_frame(self, opcode: int, payload: bytes) -> None:
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head += struct.pack(">H", n)
        else:
            head.append(127)
            head += struct.pack(">Q", n)
        async with self._lock:
            self.w.write(bytes(head) + payload)
            await self.w.drain()

    async def send(self, data) -> None:
        if isinstance(data, str):
            await self._write_frame(1, data.encode("utf-8"))
        else:
            await self._write_frame(2, bytes(data))

    async def recv(self):
        """Renvoie (opcode, payload) pour un message texte/binaire complet, ou None si fermé."""
        buf, first_op = bytearray(), 0
        while True:
            b1, b2 = await self.r.readexactly(2)
            fin, op, masked, n = b1 & 0x80, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", await self.r.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", await self.r.readexactly(8))[0]
            if n > MAX_FRAME:
                await self._write_frame(8, struct.pack(">H", 1009))
                return None
            mask = await self.r.readexactly(4) if masked else None
            payload = await self.r.readexactly(n) if n else b""
            if mask and n:
                key = (mask * (n // 4 + 1))[:n]
                payload = (int.from_bytes(payload, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")
            if op == 8:
                try:
                    await self._write_frame(8, payload[:2])
                except Exception:  # noqa: BLE001
                    pass
                return None
            if op == 9:
                await self._write_frame(10, payload)
                continue
            if op == 10:
                continue
            if op in (1, 2):
                first_op = op
                buf = bytearray(payload)
            elif op == 0:
                buf += payload
            if fin:
                return first_op, bytes(buf)
            if len(buf) > MAX_FRAME:
                return None

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            try:
                self.w.close()
                await self.w.wait_closed()
            except Exception:  # noqa: BLE001
                pass


async def _read_request(reader: asyncio.StreamReader):
    raw = await reader.readuntil(b"\r\n\r\n")
    head = raw.decode("latin-1").split("\r\n")
    method, target, _ = head[0].split(" ", 2)
    headers = {}
    for line in head[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    body = b""
    n = int(headers.get("content-length", "0") or 0)
    if n > 0:
        if n > 160 * 1024 * 1024:
            return method, target, headers, None
        body = await reader.readexactly(n)
    return method, target, headers, body


async def _respond(writer: asyncio.StreamWriter, resp: Response, head_only: bool = False) -> None:
    headers = {**resp.headers, "Content-Length": str(len(resp.body)), "Connection": "close"}
    lines = [f"HTTP/1.1 {resp.status} {REASONS.get(resp.status, 'OK')}"]
    lines += [f"{k}: {v}" for k, v in headers.items()]
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + (b"" if head_only else resp.body))
    await writer.drain()


def make_handler(app):
    api = Api(app)

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            method, target, headers, body = await _read_request(reader)
            if body is None:
                return await _respond(writer, Response(413, {}, b""))
            parts = urlsplit(target)
            path = unquote(parts.path)
            if headers.get("upgrade", "").lower() == "websocket" and path == "/ws":
                return await _websocket(app, reader, writer, headers)
            query = dict(parse_qsl(parts.query))
            resp = await api.handle(method, path, query, headers, body)
            await _respond(writer, resp, head_only=(method.upper() == "HEAD"))
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.LimitOverrunError):
            pass
        except Exception:  # noqa: BLE001
            log.exception("requête échouée")
            try:
                await _respond(writer, Response(500, {"Content-Type": "text/plain"}, b"erreur interne"))
            except Exception:  # noqa: BLE001
                pass
        finally:
            try:
                writer.close()
            except Exception:  # noqa: BLE001
                pass

    return handle


async def _websocket(app, reader, writer, headers) -> None:
    host, origin = headers.get("host"), headers.get("origin")
    key = headers.get("sec-websocket-key")
    if not key or not app.security.host_ok(host) or not app.security.origin_ok(origin, host):
        return await _respond(writer, Response(403, {"Content-Type": "text/plain"}, b"interdit"))
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    await writer.drain()
    conn = WSConn(reader, writer)

    async def send(msg) -> None:
        if isinstance(msg, (bytes, bytearray)):
            await conn.send(bytes(msg))
        else:
            await conn.send(json.dumps(msg, ensure_ascii=False))

    session = Session(app, send)
    await session.start()
    try:
        while True:
            msg = await conn.recv()
            if msg is None:
                break
            op, payload = msg
            if op == 1:
                await session.on_text(payload.decode("utf-8", "replace"))
            else:
                await session.on_binary(payload)
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        await session.close()
        await conn.close()


async def serve(app, host: str, port: int, ready: asyncio.Event | None = None):
    await app.start()
    server = await asyncio.start_server(make_handler(app), host, port, limit=2**20)
    actual = server.sockets[0].getsockname()[1]
    if ready is not None:
        ready.port = actual  # type: ignore[attr-defined]
        ready.set()
    async with server:
        try:
            await server.serve_forever()
        finally:
            await app.stop()
