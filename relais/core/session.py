"""Une session = une connexion WebSocket. Elle parle le protocole de Relais.

Messages JSON (texte) client -> serveur :
  hello                                      demande l'état complet
  cap      {id, on}                          active / désactive une fonctionnalité
  set      {patch}                           modifie des réglages
  tr       {id, text, from, final, log, speak}   traduit du texte tapé (aperçu ou validation)
  say      {id, text, from, say}             « parler en tapant » : traduit si besoin puis prononce
  speak    {id, text, lang}                  prononce un texte tel quel
  speak.cancel                               coupe la parole en cours et en file
  ut.start {id, who} / ut.end {id} / ut.cancel {id}   phrase captée au micro
  ping

Binaire client -> serveur : 0x01 + PCM16 mono 16 kHz (audio de la phrase en cours).
Binaire serveur -> client : 0x02, id u32, seq u32, fréquence u32, drapeaux u8, puis PCM16.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import struct
import time
from dataclasses import dataclass, field

from .audio import SR_STT, rms_pcm16, wav_bytes
from .langs import lang_side, other_lang, other_side, side_lang
from .text import clean_transcript, is_hallucination, split_for_speech

log = logging.getLogger("relais.session")

AUDIO_HEADER = struct.Struct("<BIIIB")
MAX_UTT_BYTES = SR_STT * 2 * 90  # 90 s : garde-fou
MIN_UTT_S = 0.30
GATE_RMS = 0.0035  # en dessous : silence, on ne réveille pas le moteur
PARTIAL_EVERY_S = 0.55
PARTIAL_MIN_NEW_BYTES = int(SR_STT * 2 * 0.25)
PARTIAL_WINDOW_BYTES = SR_STT * 2 * 25


def pack_audio(job_id: int, seq: int, sample_rate: int, last: bool, pcm: bytes) -> bytes:
    return AUDIO_HEADER.pack(2, job_id & 0xFFFFFFFF, seq, sample_rate, 1 if last else 0) + pcm


@dataclass
class Utterance:
    id: int
    who: str
    forced: str | None
    buf: bytearray = field(default_factory=bytearray)
    ended: bool = False
    lang: str | None = None
    last_len: int = 0
    last_text: str = ""
    task: asyncio.Task | None = None

    def window(self) -> bytes:
        return bytes(self.buf[-PARTIAL_WINDOW_BYTES:])


@dataclass
class SpeechJob:
    id: int
    text: str
    lang: str
    cancelled: bool = False


class Session:
    def __init__(self, app, send):
        self.app = app
        self._send = send
        self.closed = False
        self.utt: Utterance | None = None
        self._speech_q: asyncio.Queue[SpeechJob] = asyncio.Queue()
        self._speech_task: asyncio.Task | None = None
        self._cur_job: SpeechJob | None = None
        self._tasks: set[asyncio.Task] = set()
        self._latest_preview = -1
        self._handlers = {
            "hello": self._h_hello, "cap": self._h_cap, "set": self._h_set, "tr": self._h_tr,
            "say": self._h_say, "speak": self._h_speak, "speak.cancel": self._h_speak_cancel,
            "ut.start": self._h_ut_start, "ut.end": self._h_ut_end, "ut.cancel": self._h_ut_cancel,
            "ping": self._h_ping,
        }

    # ------------------------------------------------------------------ cycle
    async def start(self) -> None:
        self.app.hub.add(self)
        self._speech_task = asyncio.create_task(self._speech_worker())

    async def close(self) -> None:
        self.closed = True
        self.app.hub.remove(self)
        if self.utt and self.utt.task:
            self.utt.task.cancel()
        for t in list(self._tasks) + ([self._speech_task] if self._speech_task else []):
            t.cancel()
        await asyncio.gather(*self._tasks, *( [self._speech_task] if self._speech_task else []),
                             return_exceptions=True)

    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def send(self, msg) -> None:
        if self.closed:
            return
        try:
            await self._send(msg)
        except Exception:  # noqa: BLE001  (connexion partie)
            self.closed = True

    async def error(self, code: str, mid=None, **params) -> None:
        await self.send({"t": "error", "code": code, "key": f"err.{code}", "params": params, "id": mid})

    def _run(self, pool: str, fn, *args):
        return asyncio.get_running_loop().run_in_executor(self.app.pools[pool], functools.partial(fn, *args))

    # ---------------------------------------------------------------- entrées
    async def on_text(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            return await self.error("bad_json")
        if not isinstance(msg, dict):
            return
        handler = self._handlers.get(msg.get("t"))
        if handler is None:
            return await self.error("unknown_message", t=str(msg.get("t"))[:40])
        try:
            await handler(msg)
        except Exception:  # noqa: BLE001
            log.exception("erreur dans %s", msg.get("t"))
            await self.error("internal", msg.get("id"))

    async def on_binary(self, data: bytes) -> None:
        u = self.utt
        if data and data[0] == 1 and u and not u.ended and len(u.buf) < MAX_UTT_BYTES:
            u.buf += data[1:]

    # ------------------------------------------------------------- gestionnaires
    async def _h_hello(self, msg) -> None:
        await self.send(self.app.snapshot())

    async def _h_ping(self, msg) -> None:
        await self.send({"t": "pong", "ts": msg.get("ts")})

    async def _h_cap(self, msg) -> None:
        cap_id, on = str(msg.get("id")), bool(msg.get("on"))
        if not on and cap_id in ("speak", "typespeak"):
            await self._h_speak_cancel({})  # le moteur va être déchargé : on coupe d'abord ce qui se dit
        await self.app.registry.set_enabled(cap_id, on)

    async def _h_set(self, msg) -> None:
        patch = msg.get("patch")
        if not isinstance(patch, dict):
            return
        changed, rejected = self.app.settings.patch(patch)
        await self.app.apply_settings_change(changed)
        if rejected:
            await self.error("rejected_settings", keys=rejected)

    def _tr_engine(self):
        return self.app.registry.engine("translate")

    async def _h_tr(self, msg) -> None:
        self._spawn(self._do_tr(msg))

    async def _do_tr(self, msg) -> None:
        mid = int(msg.get("id", 0))
        text = str(msg.get("text", ""))[:4000]
        side = msg.get("from") if msg.get("from") in ("a", "b") else "a"
        final = bool(msg.get("final"))
        if not final:
            self._latest_preview = max(self._latest_preview, mid)
        engine = self._tr_engine()
        if engine is None:
            return await self.error("cap_off", mid, cap="translate")
        src, tgt = side_lang(side), side_lang(other_side(side))
        t0 = time.perf_counter()
        out = await self._run("mt", engine.translate, text, src, tgt) if text.strip() else ""
        ms = round((time.perf_counter() - t0) * 1000, 1)
        if not final and mid < self._latest_preview:
            return  # une frappe plus récente a déjà été demandée : ce résultat est périmé
        await self.send({"t": "tr", "id": mid, "side": side, "from": src, "to": tgt, "source": text,
                         "text": out, "final": final, "kind": "typed", "ms": ms})
        if final and text.strip():
            if msg.get("log", True):
                self._log({"side": side, "lang": src, "text": text, "to": tgt, "translation": out, "kind": "typed"})
            if msg.get("speak") and self.app.registry.is_on("speak"):
                self._enqueue(mid, out, tgt)

    async def _h_say(self, msg) -> None:
        self._spawn(self._do_say(msg))

    async def _do_say(self, msg) -> None:
        mid = int(msg.get("id", 0))
        text = str(msg.get("text", "")).strip()[:1000]
        src_side = msg.get("from") if msg.get("from") in ("a", "b") else "a"
        say_side = msg.get("say") if msg.get("say") in ("a", "b") else other_side(src_side)
        if not text:
            return
        if not self.app.registry.is_on("speak"):
            return await self.error("cap_off", mid, cap="speak")
        spoken = text
        if src_side != say_side:
            engine = self._tr_engine()
            if engine is None:
                return await self.error("cap_off", mid, cap="translate")
            spoken = await self._run("mt", engine.translate, text, side_lang(src_side), side_lang(say_side))
        await self.send({"t": "said", "id": mid, "text": spoken, "lang": side_lang(say_side)})
        self._enqueue(mid, spoken, side_lang(say_side))

    async def _h_speak(self, msg) -> None:
        text = str(msg.get("text", "")).strip()[:2000]
        lang = msg.get("lang") if msg.get("lang") in ("en", "fr") else None
        if text and lang:
            if not self.app.registry.is_on("speak"):
                return await self.error("cap_off", msg.get("id"), cap="speak")
            self._enqueue(int(msg.get("id", 0)), text, lang)

    async def _h_speak_cancel(self, msg) -> None:
        if self._cur_job:
            self._cur_job.cancelled = True
        while not self._speech_q.empty():
            try:
                self._speech_q.get_nowait().cancelled = True
            except asyncio.QueueEmpty:
                break
        await self.send({"t": "speak.cancelled"})

    # ------------------------------------------------------------------- voix
    def _enqueue(self, mid: int, text: str, lang: str) -> None:
        if text.strip():
            self._speech_q.put_nowait(SpeechJob(mid, text, lang))

    async def _speech_worker(self) -> None:
        while True:
            job = await self._speech_q.get()
            if job.cancelled:
                continue
            self._cur_job = job
            try:
                await self._speak(job)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("synthèse échouée")
                await self.error("tts_failed", job.id)
            finally:
                self._cur_job = None

    async def _speak(self, job: SpeechJob) -> None:
        synth = self.app.registry.engine("speak")
        if synth is None:
            return await self.error("cap_off", job.id, cap="speak")
        s = self.app.settings
        side = lang_side(job.lang) or "a"
        voice = s.get(f"speak.voice_{side}", "") or ""
        rate = float(s.get("speak.rate", 1.0))
        chunks = split_for_speech(job.text)
        t0, first = time.perf_counter(), None
        await self.send({"t": "speak.start", "id": job.id, "lang": job.lang})
        for i, chunk in enumerate(chunks):
            if job.cancelled or self.closed:
                break
            pcm, sr = await self._run("tts", synth.synth, chunk, job.lang, voice, rate)
            if job.cancelled:
                break
            if first is None:
                first = round((time.perf_counter() - t0) * 1000, 1)
            await self.send(pack_audio(job.id, i, sr, i == len(chunks) - 1, pcm))
        await self.send({"t": "speak.end", "id": job.id, "ms_first": first,
                         "ms_total": round((time.perf_counter() - t0) * 1000, 1), "cancelled": job.cancelled})

    # ------------------------------------------------------------------- micro
    async def _h_ut_start(self, msg) -> None:
        if self.app.registry.engine("listen") is None:
            return await self.error("cap_off", msg.get("id"), cap="listen")
        if self.utt and not self.utt.ended:
            self._drop_utterance(self.utt)
        who = msg.get("who") if msg.get("who") in ("auto", "a", "b") else self.app.settings.get("listen.who", "auto")
        forced = side_lang(who) if who in ("a", "b") else None
        u = Utterance(id=int(msg.get("id", 0)), who=who, forced=forced, lang=forced)
        self.utt = u
        if self.app.settings.get("listen.partials", True):
            u.task = asyncio.create_task(self._partial_loop(u))

    async def _h_ut_end(self, msg) -> None:
        u = self.utt
        if u is None or u.id != int(msg.get("id", -1)):
            return
        u.ended = True
        self.utt = None
        self._spawn(self._finalize(u))

    async def _h_ut_cancel(self, msg) -> None:
        if self.utt is not None:
            self._drop_utterance(self.utt)

    def _drop_utterance(self, u: Utterance) -> None:
        u.ended = True
        if u.task:
            u.task.cancel()
        if self.utt is u:
            self.utt = None

    async def _partial_loop(self, u: Utterance) -> None:
        """Pendant que la personne parle : texte provisoire (et sa traduction) en direct."""
        s = self.app.settings
        while not u.ended and not self.closed:
            await asyncio.sleep(PARTIAL_EVERY_S)
            if u.ended or len(u.buf) - u.last_len < PARTIAL_MIN_NEW_BYTES:
                continue
            u.last_len = len(u.buf)
            rec = self.app.registry.engine("listen")
            pcm = u.window()
            if rec is None or rms_pcm16(pcm) < GATE_RMS:
                continue
            res = await self._run("stt", rec.transcribe, pcm, u.lang, False, u.id)
            if u.ended:
                return
            text = clean_transcript(res.text)
            if u.lang is None and res.prob >= 0.6:
                u.lang = res.language  # on verrouille la langue détectée pour cette phrase
            lang = u.lang or res.language
            if not text or is_hallucination(text) or text == u.last_text:
                continue
            u.last_text = text
            side = lang_side(lang) or "a"
            await self.send({"t": "stt", "id": u.id, "side": side, "lang": lang, "text": text, "final": False})
            engine = self._tr_engine()
            if engine is not None and s.get("translate.live", True):
                out = await self._run("mt", engine.translate, text, lang, other_lang(lang))
                if u.ended:
                    return
                await self.send({"t": "tr", "id": u.id, "side": side, "from": lang, "to": other_lang(lang),
                                 "source": text, "text": out, "final": False, "kind": "utterance"})

    async def _finalize(self, u: Utterance) -> None:
        if u.task:
            u.task.cancel()
            await asyncio.gather(u.task, return_exceptions=True)
        pcm = bytes(u.buf)
        dur = len(pcm) / 2 / SR_STT

        async def clear() -> None:
            await self.send({"t": "stt", "id": u.id, "final": True, "text": "", "side": None})

        rec = self.app.registry.engine("listen")
        if rec is None or dur < MIN_UTT_S or rms_pcm16(pcm) < GATE_RMS:
            return await clear()
        t0 = time.perf_counter()
        res = await self._run("stt", rec.transcribe, pcm, u.lang, True, u.id)
        stt_ms = round((time.perf_counter() - t0) * 1000, 1)
        text = clean_transcript(res.text)
        if not text or is_hallucination(text):
            return await clear()
        lang = u.lang or res.language
        side = lang_side(lang) or "a"
        tgt = other_lang(lang)
        await self.send({"t": "stt", "id": u.id, "side": side, "lang": lang, "text": text, "final": True,
                         "ms": stt_ms, "dur": round(dur, 2)})

        translation, mt_ms = None, None
        engine = self._tr_engine()
        if engine is not None:
            t1 = time.perf_counter()
            translation = await self._run("mt", engine.translate, text, lang, tgt)
            mt_ms = round((time.perf_counter() - t1) * 1000, 1)
            await self.send({"t": "tr", "id": u.id, "side": side, "from": lang, "to": tgt, "source": text,
                             "text": translation, "final": True, "kind": "utterance", "ms": mt_ms})
        self._log({"side": side, "lang": lang, "text": text, "to": tgt if translation else None,
                   "translation": translation, "kind": "utterance"})

        s = self.app.settings
        if self.app.registry.is_on("speak"):
            if s.get("speak.originals", False):
                self._enqueue(u.id, text, lang)
            if s.get("speak.translations", True) and translation:
                self._enqueue(u.id, translation, tgt)

        me_side = s.get("pair.me", "b")
        if s.get("record.keep_utterances", False) and side == me_side and self.app.registry.is_on("record"):
            try:
                meta = self.app.recordings.add_wav(wav_bytes(pcm, SR_STT), name=text[:60], kind="clip",
                                                   lang=lang, source="utterance")
                await self.app.hub.broadcast({"t": "rec", "action": "added", "item": meta})
            except ValueError:
                pass

    def _log(self, entry: dict) -> None:
        if self.app.settings.get("history.save", True):
            entry = {"id": f"{int(time.time() * 1000)}", "ts": time.time(), **entry}
            self.app.history.append(entry)
