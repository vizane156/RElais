"""`relais doctor` : vérifie l'installation et mesure la latence réelle sur CETTE machine."""

from __future__ import annotations

import importlib.util
import os
import sys
import time

from .core.app import RelaisApp
from .paths import Paths


def _have(mod: str) -> bool:
    return importlib.util.find_spec(mod) is not None


def run(paths: Paths) -> int:
    print(f"Python {sys.version.split()[0]} — {os.cpu_count()} cœurs — données : {paths.home}\n")
    print("Paquets")
    problems = 0
    for label, mod, extra in [
        ("serveur Starlette", "starlette", "server"), ("uvicorn", "uvicorn", "server"),
        ("CTranslate2", "ctranslate2", "mt"), ("SentencePiece", "sentencepiece", "mt"),
        ("faster-whisper", "faster_whisper", "stt"), ("Piper", "piper", "tts"),
        ("Kokoro (optionnel)", "kokoro_onnx", "kokoro"),
    ]:
        ok = _have(mod)
        opt = "optionnel" in label or extra == "server"
        mark = "✓" if ok else ("·" if opt else "✗")
        print(f"  {mark} {label:<22}" + ("" if ok else f'  pip install "relais[{extra}]"'))
        problems += 0 if (ok or opt) else 1

    app = RelaisApp(home=paths.home, engines="real")
    st = app.factory.model_status()
    print("\nModèles")
    for kind in ("mt", "stt", "tts"):
        for m in st[kind]:
            tag = "✓" if m["installed"] else "·"
            print(f"  {tag} {kind:<4} {m['id']:<22} ~{m['mb']} Mo")
    if not any(m["installed"] for m in st["mt"]):
        print("\n→ Aucun modèle : lance  relais pull")

    print("\nEssais de latence")
    for cap, label in (("translate", "traduction"), ("listen", "reconnaissance"), ("speak", "voix")):
        try:
            t0 = time.perf_counter()
            eng = app.factory.make(cap)
            load = time.perf_counter() - t0
        except Exception as exc:  # noqa: BLE001
            text = getattr(exc, "text", str(exc))
            print(f"  ✗ {label:<15} {text}")
            problems += 1
            continue
        try:
            if cap == "translate":
                eng.translate("Hello, how are you today?", "en", "fr")  # chauffe
                t0 = time.perf_counter()
                out = eng.translate("The meeting starts at nine tomorrow morning.", "en", "fr")
                print(f"  ✓ {label:<15} chargé en {load:.1f} s — phrase en {(time.perf_counter()-t0)*1000:.0f} ms : {out}")
            elif cap == "listen":
                t0 = time.perf_counter()
                eng.transcribe(b"\x00\x00" * 16000, "en", True)
                print(f"  ✓ {label:<15} chargé en {load:.1f} s — 1 s de silence en {(time.perf_counter()-t0)*1000:.0f} ms")
            else:
                voices = eng.voices("fr")
                t0 = time.perf_counter()
                pcm, sr = eng.synth("Bonjour, ceci est un essai.", "fr", voices[0].id if voices else "", 1.0)
                dt = time.perf_counter() - t0
                print(f"  ✓ {label:<15} chargé en {load:.1f} s — {len(pcm)/2/sr:.1f} s d'audio en {dt*1000:.0f} ms")
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {label:<15} {type(exc).__name__}: {exc}")
            problems += 1
        finally:
            try:
                eng.close()
            except Exception:  # noqa: BLE001
                pass
    print("\nTout est prêt." if problems == 0 else f"\n{problems} point(s) à corriger.")
    return 0 if problems == 0 else 1
