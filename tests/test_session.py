import asyncio
import base64
import json
import math
import os
import struct
import tempfile
import unittest

from relais.core.app import RelaisApp
from relais.core.audio import wav_bytes
from relais.core.http_api import Api
from relais.core.session import AUDIO_HEADER, Session
from relais.servers.stdlib import make_handler


def tone(seconds: float, amp: int = 6000, sr: int = 16000) -> bytes:
    n = int(seconds * sr)
    return b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * 220 * i / sr))) for i in range(n))


class Harness:
    def __init__(self, home):
        self.app = RelaisApp(home=home, engines="mock")
        self.out: list = []
        self.session = Session(self.app, self._collect)

    async def _collect(self, msg):
        self.out.append(msg)

    async def start(self):
        await self.session.start()

    async def stop(self):
        await self.session.close()
        await self.app.stop()

    def of(self, t):
        return [m for m in self.out if isinstance(m, dict) and m.get("t") == t]

    def audio(self):
        return [m for m in self.out if isinstance(m, (bytes, bytearray))]

    async def until(self, pred, timeout=4.0):
        end = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < end:
            if pred():
                return True
            await asyncio.sleep(0.02)
        return False

    async def say(self, **msg):
        await self.session.on_text(json.dumps(msg))

    async def enable(self, *caps):
        for c in caps:
            await self.say(t="cap", id=c, on=True)
        for c in caps:
            assert await self.app.registry.wait_ready(c, 5), c


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.h = Harness(self.tmp.name)
        await self.h.start()

    async def asyncTearDown(self):
        await self.h.stop()
        self.tmp.cleanup()

    async def test_hello_returns_full_state(self):
        await self.h.say(t="hello")
        st = self.h.of("state")[0]
        self.assertEqual(st["engines"], "mock")
        self.assertEqual({c["id"] for c in st["caps"]}, {"listen", "translate", "speak", "typespeak", "record", "clone"})
        self.assertEqual(st["pair"]["a"], "en")
        self.assertEqual(len(st["voices"]["a"]), 2)

    async def test_capabilities_toggle_and_dependencies(self):
        await self.h.say(t="cap", id="typespeak", on=True)
        await self.h.app.registry.wait_ready("speak", 5)
        caps = {c["id"]: c for c in self.h.app.registry.snapshot()}
        self.assertTrue(caps["speak"]["enabled"])  # dépendance allumée automatiquement
        self.assertEqual(caps["typespeak"]["state"], "ready")
        await self.h.say(t="cap", id="speak", on=False)
        caps = {c["id"]: c for c in self.h.app.registry.snapshot()}
        self.assertFalse(caps["typespeak"]["enabled"])  # et éteinte en cascade
        self.assertEqual(caps["speak"]["state"], "off")
        self.assertIsNone(self.h.app.registry.get("speak").engine)  # modèle déchargé
        states = [m["state"] for m in self.h.of("cap") if m["id"] == "speak"]
        self.assertIn("loading", states)
        self.assertIn("ready", states)

    async def test_clone_is_planned_not_fake(self):
        await self.h.say(t="cap", id="clone", on=True)
        clone = next(c for c in self.h.app.registry.snapshot() if c["id"] == "clone")
        self.assertFalse(clone["enabled"])
        self.assertEqual(clone["state"], "unavailable")

    async def test_enabled_caps_survive_restart(self):
        await self.h.enable("translate")
        await self.h.stop()
        app2 = RelaisApp(home=self.tmp.name, engines="mock")
        await app2.start()
        self.assertTrue(await app2.registry.wait_ready("translate", 5))
        await app2.stop()
        self.h = Harness(self.tmp.name)
        await self.h.start()

    async def test_typed_translation_both_directions(self):
        await self.h.say(t="tr", id=1, text="Thank you very much for your help today.", **{"from": "a"}, final=False)
        self.assertTrue(await self.h.until(lambda: self.h.of("error")))
        self.assertEqual(self.h.of("error")[0]["code"], "cap_off")  # traduction éteinte : refus propre
        await self.h.enable("translate")
        await self.h.say(t="tr", id=2, text="Thank you very much for your help today.", **{"from": "a"}, final=True)
        self.assertTrue(await self.h.until(lambda: self.h.of("tr")))
        r = self.h.of("tr")[-1]
        self.assertEqual((r["from"], r["to"], r["final"]), ("en", "fr", True))
        self.assertEqual(r["text"], "Merci beaucoup pour votre aide aujourd'hui.")
        await self.h.say(t="tr", id=3, text="Merci beaucoup pour votre aide aujourd'hui.", **{"from": "b"}, final=True)
        self.assertTrue(await self.h.until(lambda: len(self.h.of("tr")) >= 2))
        self.assertEqual(self.h.of("tr")[-1]["text"], "Thank you very much for your help today.")
        self.assertEqual(len(self.h.app.history.tail(10)), 2)

    async def test_stale_preview_is_dropped(self):
        await self.h.enable("translate")
        await self.h.say(t="tr", id=10, text="hello", **{"from": "a"}, final=False)
        await self.h.say(t="tr", id=11, text="hello there", **{"from": "a"}, final=False)
        await self.h.until(lambda: any(m["id"] == 11 for m in self.h.of("tr")))
        await asyncio.sleep(0.1)
        self.assertEqual([m["id"] for m in self.h.of("tr")], [11])

    async def test_full_utterance_pipeline(self):
        await self.h.enable("listen", "translate", "speak")
        await self.h.say(t="ut.start", id=7, who="b")  # langue forcée : français
        for _ in range(4):  # ~1,6 s de parole envoyée par morceaux, comme le navigateur
            await self.h.session.on_binary(b"\x01" + tone(0.4))
            await asyncio.sleep(0.45)
        self.assertTrue(self.h.of("stt"), "pas de texte provisoire")
        partial = self.h.of("stt")[0]
        self.assertFalse(partial["final"])
        self.assertEqual((partial["side"], partial["lang"]), ("b", "fr"))
        await self.h.say(t="ut.end", id=7)
        self.assertTrue(await self.h.until(lambda: self.h.of("speak.end")))
        final = [m for m in self.h.of("stt") if m["final"]][0]
        from relais.engines.mock import _PHRASES, _SENTENCES
        self.assertIn(final["text"], _SENTENCES["fr"])
        tr = [m for m in self.h.of("tr") if m["final"]][0]
        self.assertEqual((tr["from"], tr["to"]), ("fr", "en"))
        self.assertEqual(tr["text"], _PHRASES[("fr", "en")][final["text"].lower()])
        frames = self.h.audio()
        self.assertTrue(frames)
        kind, fid, seq, sr, flags = AUDIO_HEADER.unpack(frames[0][: AUDIO_HEADER.size])
        self.assertEqual((kind, fid, seq, sr), (2, 7, 0, 22050))
        self.assertEqual(AUDIO_HEADER.unpack(frames[-1][: AUDIO_HEADER.size])[4], 1)  # dernier morceau marqué
        self.assertGreater(len(frames[0]), AUDIO_HEADER.size + 1000)
        h = self.h.app.history.tail(5)[-1]
        self.assertEqual((h["lang"], h["to"]), ("fr", "en"))
        self.assertIsNotNone(self.h.of("speak.end")[0]["ms_first"])

    async def test_auto_language_alternates_with_mock(self):
        await self.h.enable("listen")
        langs = []
        for uid in (1, 2):
            await self.h.say(t="ut.start", id=uid, who="auto")
            await self.h.session.on_binary(b"\x01" + tone(1.0))
            await self.h.say(t="ut.end", id=uid)
            await self.h.until(lambda: len([m for m in self.h.of("stt") if m["final"]]) >= uid)
        langs = [m["lang"] for m in self.h.of("stt") if m["final"]]
        self.assertEqual(sorted(langs), ["en", "fr"])

    async def test_silence_and_noise_are_ignored(self):
        await self.h.enable("listen", "translate")
        await self.h.say(t="ut.start", id=1, who="a")
        await self.h.session.on_binary(b"\x01" + b"\x00\x00" * 16000)
        await self.h.say(t="ut.end", id=1)
        await self.h.until(lambda: self.h.of("stt"))
        m = self.h.of("stt")[-1]
        self.assertTrue(m["final"] and m["text"] == "")
        self.assertEqual(self.h.of("tr"), [])
        self.assertEqual(self.h.app.history.tail(5), [])

    async def test_too_short_is_ignored(self):
        await self.h.enable("listen")
        await self.h.say(t="ut.start", id=1, who="a")
        await self.h.session.on_binary(b"\x01" + tone(0.1))
        await self.h.say(t="ut.end", id=1)
        await self.h.until(lambda: self.h.of("stt"))
        self.assertEqual(self.h.of("stt")[-1]["text"], "")

    async def test_listen_off_refuses_cleanly(self):
        await self.h.say(t="ut.start", id=1)
        self.assertEqual(self.h.of("error")[0]["code"], "cap_off")
        await self.h.session.on_binary(b"\x01" + tone(0.5))  # ne doit pas planter
        await self.h.say(t="ut.end", id=1)

    async def test_type_speak_translates_and_speaks(self):
        await self.h.enable("speak", "translate")
        await self.h.say(t="say", id=5, text="Hello, can you hear me clearly?", **{"from": "a", "say": "b"})
        self.assertTrue(await self.h.until(lambda: self.h.of("speak.end")))
        said = self.h.of("said")[0]
        self.assertEqual((said["lang"], said["text"]), ("fr", "Bonjour, est-ce que vous m'entendez bien ?"))
        self.assertTrue(self.h.audio())

    async def test_type_speak_same_language_needs_no_translation(self):
        await self.h.enable("speak")  # traduction éteinte
        await self.h.say(t="say", id=6, text="Bonjour tout le monde", **{"from": "b", "say": "b"})
        self.assertTrue(await self.h.until(lambda: self.h.of("speak.end")))
        self.assertEqual(self.h.of("said")[0]["text"], "Bonjour tout le monde")

    async def test_cancel_stops_queue(self):
        await self.h.enable("speak")
        for i in range(5):
            await self.h.say(t="speak", id=i, text="Un deux trois quatre cinq six sept huit neuf dix.", lang="fr")
        await self.h.say(t="speak.cancel")
        await asyncio.sleep(0.5)
        self.assertTrue(self.h.of("speak.cancelled"))
        self.assertLess(len(self.h.of("speak.end")), 5)

    async def test_settings_patch_broadcast_and_rejection(self):
        await self.h.say(t="set", patch={"speak.rate": 1.25, "ui.lang": "zz"})
        self.assertEqual(self.h.app.settings.get("speak.rate"), 1.25)
        self.assertEqual(self.h.of("settings")[0]["changed"], ["speak.rate"])
        self.assertEqual(self.h.of("error")[0]["params"]["keys"], ["ui.lang"])

    async def test_changing_reload_setting_reloads_engine(self):
        await self.h.enable("listen")
        first = self.h.app.registry.get("listen").engine
        await self.h.say(t="set", patch={"listen.model": "small"})
        await self.h.app.registry.wait_ready("listen", 5)
        self.assertIsNot(self.h.app.registry.get("listen").engine, first)

    async def test_bad_input_never_crashes(self):
        for raw in ["not json", "[]", json.dumps({"t": "nope"}), json.dumps({"t": "tr"}),
                    json.dumps({"t": "say", "text": None}), json.dumps({"t": "set", "patch": 5}),
                    json.dumps({"t": "cap"}), json.dumps({"t": "speak", "text": "x", "lang": "zz"})]:
            await self.h.session.on_text(raw)
        await self.h.say(t="ping", ts=1)
        self.assertEqual(self.h.of("pong")[0]["ts"], 1)

    async def test_keep_utterances_saves_my_voice_only(self):
        await self.h.enable("listen", "record")
        await self.h.say(t="set", patch={"record.keep_utterances": True, "pair.me": "b"})
        for uid, who in ((1, "a"), (2, "b")):  # a = anglais (l'autre), b = français (moi)
            await self.h.say(t="ut.start", id=uid, who=who)
            await self.h.session.on_binary(b"\x01" + tone(1.0))
            await self.h.say(t="ut.end", id=uid)
            await self.h.until(lambda: len([m for m in self.h.of("stt") if m["final"]]) >= uid)
        await asyncio.sleep(0.2)
        clips = self.h.app.recordings.list()
        self.assertEqual(len(clips), 1)
        self.assertEqual((clips[0]["kind"], clips[0]["lang"]), ("clip", "fr"))


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = RelaisApp(home=self.tmp.name, engines="mock")
        self.api = Api(self.app)
        self.H = {"host": "localhost:8765"}

    async def asyncTearDown(self):
        await self.app.stop()
        self.tmp.cleanup()

    async def call(self, method, path, query=None, headers=None, body=b""):
        return await self.api.handle(method, path, query or {}, {**self.H, **(headers or {})}, body)

    async def test_settings_and_schema(self):
        r = await self.call("GET", "/api/schema")
        self.assertEqual(json.loads(r.body)["version"], 1)
        r = await self.call("PUT", "/api/settings", body=json.dumps({"ui.theme": "dark", "bad": 1}).encode())
        j = json.loads(r.body)
        self.assertEqual(j["values"]["ui.theme"], "dark")
        self.assertEqual(j["rejected"], ["bad"])
        r = await self.call("POST", "/api/settings/reset", body=b"{}")
        self.assertEqual(json.loads(r.body)["values"]["ui.theme"], "auto")
        self.assertEqual((await self.call("PUT", "/api/settings", body=b"nope")).status, 400)

    async def test_recordings_lifecycle_and_ranges(self):
        wav = wav_bytes(tone(1.0), 16000)
        r = await self.call("PUT", "/api/recordings", {"name": "Ma voix", "kind": "voice", "lang": "fr"}, body=wav)
        self.assertEqual(r.status, 201)
        rid = json.loads(r.body)["id"]
        self.assertEqual(len(json.loads((await self.call("GET", "/api/recordings")).body)["items"]), 1)
        full = await self.call("GET", f"/api/recordings/{rid}.wav")
        self.assertEqual((full.status, full.body), (200, wav))
        part = await self.call("GET", f"/api/recordings/{rid}.wav", headers={"range": "bytes=0-99"})
        self.assertEqual((part.status, len(part.body)), (206, 100))
        self.assertEqual(part.headers["Content-Range"], f"bytes 0-99/{len(wav)}")
        self.assertEqual((await self.call("GET", f"/api/recordings/{rid}.wav", headers={"range": "bytes=99999999-"})).status, 416)
        r = await self.call("PATCH", f"/api/recordings/{rid}", body=b'{"name": "Renommee"}')
        self.assertEqual(json.loads(r.body)["name"], "Renommee")
        self.assertEqual((await self.call("DELETE", f"/api/recordings/{rid}")).status, 200)
        self.assertEqual((await self.call("GET", f"/api/recordings/{rid}.wav")).status, 404)
        self.assertEqual((await self.call("PUT", "/api/recordings", body=b"garbage")).status, 400)

    async def test_path_traversal_blocked(self):
        for p in ["/../../etc/passwd", "/..%2f..%2fetc/passwd", "/css/../../../core/settings.py", "/%00",
                  "/fonts/../../settings.json", "/fonts/..%2f..%2fsettings.json"]:
            r = await self.call("GET", p)
            self.assertEqual(r.status, 404, p)
        # « /.. » est normalisé en « / » : on sert la page d'accueil, jamais un fichier hors du dossier web
        r = await self.call("GET", "/..")
        self.assertNotIn(b"def ", r.body)
        self.assertEqual((await self.call("GET", "/api/recordings/..%2f..%2fx.wav")).status, 404)

    async def test_host_and_origin_checks(self):
        r = await self.api.handle("GET", "/api/info", {}, {"host": "evil.example:8765"}, b"")
        self.assertEqual(r.status, 403)  # DNS rebinding
        r = await self.call("GET", "/api/history", headers={"origin": "http://evil.example"})
        self.assertEqual(r.status, 403)  # page tierce
        r = await self.call("GET", "/api/info", headers={"origin": "http://localhost:8765"})
        self.assertEqual(r.status, 200)

    async def test_profiles_and_glossary_and_history(self):
        await self.call("PUT", "/api/settings", body=b'{"ui.theme": "dark"}')
        await self.call("PUT", "/api/profiles/Appel", body=b"")
        await self.call("PUT", "/api/settings", body=b'{"ui.theme": "light"}')
        r = await self.call("POST", "/api/profiles/Appel/apply")
        self.assertEqual(json.loads(r.body)["values"]["ui.theme"], "dark")
        self.assertEqual((await self.call("PUT", "/api/profiles/a%2Fb", body=b"")).status, 400)
        r = await self.call("PUT", "/api/glossary", body=json.dumps({"rules": [{"src": "en", "term": "x"}]}).encode())
        self.assertEqual(len(json.loads(r.body)["rules"]), 1)
        self.app.history.append({"ts": 1, "lang": "en", "text": "Hi"})
        self.assertEqual(len(json.loads((await self.call("GET", "/api/history", {"limit": "5"})).body)["items"]), 1)
        txt = await self.call("GET", "/api/history/export.txt")
        self.assertIn("Hi", txt.body.decode())
        await self.call("DELETE", "/api/history")
        self.assertEqual(json.loads((await self.call("GET", "/api/history")).body)["items"], [])

    async def test_models_status_and_security_headers(self):
        self.assertEqual(json.loads((await self.call("GET", "/api/models")).body)["engines"], "mock")
        r = await self.call("GET", "/")
        if r.status == 200:  # présent une fois l'interface écrite
            self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
            self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")


# --------------------------------------------------------------------------- #
# Vrai serveur stdlib : poignée de main WebSocket, trames masquées, HTTP.
# --------------------------------------------------------------------------- #
async def ws_connect(port, origin=None):
    r, w = await asyncio.open_connection("127.0.0.1", port)
    key = base64.b64encode(os.urandom(16)).decode()
    lines = ["GET /ws HTTP/1.1", f"Host: localhost:{port}", "Upgrade: websocket", "Connection: Upgrade",
             f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13"]
    if origin:
        lines.append(f"Origin: {origin}")
    w.write(("\r\n".join(lines) + "\r\n\r\n").encode())
    head = (await r.readuntil(b"\r\n\r\n")).decode()
    return r, w, head, key


def client_frame(op: int, payload: bytes) -> bytes:
    mask = os.urandom(4)
    n = len(payload)
    head = bytearray([0x80 | op])
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    return bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


async def read_frame(r):
    b1, b2 = await r.readexactly(2)
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack(">H", await r.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", await r.readexactly(8))[0]
    return b1 & 0x0F, await r.readexactly(n)


class StdlibServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = RelaisApp(home=self.tmp.name, engines="mock")
        await self.app.start()
        self.server = await asyncio.start_server(make_handler(self.app), "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        await self.app.stop()
        self.tmp.cleanup()

    async def test_websocket_handshake_and_full_roundtrip(self):
        r, w, head, key = await ws_connect(self.port, origin=f"http://localhost:{self.port}")
        accept = base64.b64encode(__import__("hashlib").sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.assertIn("101 Switching Protocols", head)
        self.assertIn(accept, head)
        w.write(client_frame(1, json.dumps({"t": "hello"}).encode()))
        op, payload = await asyncio.wait_for(read_frame(r), 3)
        self.assertEqual(op, 1)
        self.assertEqual(json.loads(payload)["t"], "state")
        # active la voix, parle, et reçoit de l'AUDIO BINAIRE (même chemin que le navigateur)
        w.write(client_frame(1, json.dumps({"t": "cap", "id": "speak", "on": True}).encode()))
        for _ in range(200):
            op, payload = await asyncio.wait_for(read_frame(r), 3)
            if op == 1 and json.loads(payload).get("t") == "cap" and json.loads(payload)["state"] == "ready":
                break
        w.write(client_frame(1, json.dumps({"t": "speak", "id": 9, "text": "Bonjour tout le monde.", "lang": "fr"}).encode()))
        got_audio = False
        for _ in range(50):
            op, payload = await asyncio.wait_for(read_frame(r), 3)
            if op == 2:
                got_audio = AUDIO_HEADER.unpack(payload[: AUDIO_HEADER.size])[1] == 9
            if op == 1 and json.loads(payload).get("t") == "speak.end":
                break
        self.assertTrue(got_audio)
        # grosse trame binaire (> 64 Ko) : exerce le codage de longueur sur 8 octets
        w.write(client_frame(2, b"\x01" + b"\x00" * 70000))
        w.write(client_frame(1, json.dumps({"t": "ping", "ts": 3}).encode()))
        for _ in range(20):
            op, payload = await asyncio.wait_for(read_frame(r), 3)
            if op == 1 and json.loads(payload).get("t") == "pong":
                break
        else:
            self.fail("pas de pong")
        w.write(client_frame(8, struct.pack(">H", 1000)))
        w.close()

    async def test_websocket_foreign_origin_refused(self):
        r, w, head, _ = await ws_connect(self.port, origin="http://evil.example")
        self.assertIn("403", head.split("\r\n")[0])
        w.close()

    async def test_http_over_socket(self):
        r, w = await asyncio.open_connection("127.0.0.1", self.port)
        w.write(f"GET /api/info HTTP/1.1\r\nHost: localhost:{self.port}\r\n\r\n".encode())
        data = await r.read()
        self.assertTrue(data.startswith(b"HTTP/1.1 200"))
        self.assertIn(b'"engines": "mock"', data)
        w.close()


if __name__ == "__main__":
    unittest.main()


class RealEnginesMissingTests(unittest.IsolatedAsyncioTestCase):
    """Moteurs RÉELS sans dépendances ni modèles (cas d'une première installation) :
    chaque fonction doit passer à « indisponible » avec un message actionnable, jamais planter."""

    async def test_missing_everything_is_explained_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = RelaisApp(home=tmp, engines="real")
            h = Harness.__new__(Harness)
            h.app, h.out = app, []
            h.session = Session(app, h._collect)
            await h.session.start()
            for cap in ("translate", "listen", "speak"):
                await h.say(t="cap", id=cap, on=True)
            for cap in ("translate", "listen", "speak"):
                await app.registry.wait_ready(cap, 5)
            caps = {c["id"]: c for c in app.registry.snapshot()}
            for cap in ("translate", "listen", "speak"):
                self.assertEqual(caps[cap]["state"], "unavailable", cap)
                detail = caps[cap]["detail"]
                self.assertIn(detail["key"], ("err.dep", "err.model_mt", "err.model_stt", "err.model_tts"), cap)
                self.assertIn("relais", detail["text"])  # le texte de repli dit quoi lancer
            self.assertEqual(caps["typespeak"]["state"], "off")
            await h.say(t="ut.start", id=1)  # et une session reste utilisable
            self.assertEqual(h.of("error")[-1]["code"], "cap_off")
            await h.session.close()
            await app.stop()

    async def test_voices_listing_works_without_models(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = RelaisApp(home=tmp, engines="real")
            self.assertEqual(app.factory.voices_for_ui(), {"a": [], "b": []})
            st = app.factory.model_status()
            self.assertEqual(st["engines"], "real")
            self.assertFalse(any(m["installed"] for m in st["mt"] + st["stt"]))
            await app.stop()
