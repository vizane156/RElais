"""Téléchargement des modèles : `relais pull [default|all|mt|stt|tts]`."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from .engines.factory import load_manifest
from .paths import Paths


def _download(url: str, dest: Path, label: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "relais/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as fh:
            total = int(r.headers.get("Content-Length") or 0)
            got, last = 0, -1
            while True:
                buf = r.read(1 << 20)
                if not buf:
                    break
                fh.write(buf)
                got += len(buf)
                pct = int(got * 100 / total) if total else -1
                if pct != last and sys.stderr.isatty():
                    print(f"\r  {label} {pct if pct >= 0 else '?':>3}% ({got >> 20} Mo)", end="", file=sys.stderr)
                    last = pct
    except Exception:
        part.unlink(missing_ok=True)
        raise
    if sys.stderr.isatty():
        print(file=sys.stderr)
    os.replace(part, dest)


def _pull_mt(paths: Paths, manifest: dict) -> bool:
    ok = True
    for key, m in manifest["mt"].items():
        out = paths.models / m["dir"]
        if (out / "model.bin").exists():
            print(f"  traduction {key} : déjà installée")
            continue
        exe = shutil.which("ct2-transformers-converter")
        cmd = ([exe] if exe else [sys.executable, "-m", "ctranslate2.converters.transformers"]) + [
            "--model", m["source"], "--output_dir", str(out), "--quantization", "int8",
            "--copy_files", "source.spm", "target.spm", "--force"]
        print(f"  traduction {key} : conversion de {m['source']} en int8…")
        try:
            subprocess.run(cmd, check=True)
        except FileNotFoundError as exc:
            raise RuntimeError("CTranslate2 converter unavailable; install relais[mt,convert]") from exc
        except subprocess.CalledProcessError:
            print("  ✗ conversion impossible. Installe l'outil : pip install \"relais[mt,convert]\"", file=sys.stderr)
            ok = False
    return ok


def _pull_stt(paths: Paths, manifest: dict, size: str) -> bool:
    m = manifest["stt"][size]
    out = paths.models / m["dir"]
    if (out / "model.bin").exists():
        print(f"  reconnaissance {size} : déjà installée")
        return True
    try:
        from faster_whisper.utils import download_model
    except ImportError:
        print("  ✗ faster-whisper absent : pip install \"relais[stt]\"", file=sys.stderr)
        return False
    print(f"  reconnaissance {size} : téléchargement (~{m['approx_mb']} Mo)…")
    try:
        download_model(m["repo"], output_dir=str(out))
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ✗ échec : {exc}", file=sys.stderr)
        return False


def _pull_piper(paths: Paths, manifest: dict, everything: bool) -> bool:
    cfg = manifest["tts"]["piper"]
    ok = True
    for vid, v in cfg["voices"].items():
        if not (everything or v.get("default")):
            continue
        for ext in (".onnx", ".onnx.json"):
            dest = paths.models / "tts" / "piper" / f"{vid}{ext}"
            if dest.exists():
                continue
            try:
                _download(f"{cfg['base_url']}{v['path']}/{vid}{ext}", dest, f"{vid}{ext}")
            except Exception as exc:  # noqa: BLE001
                print(f"  ✗ {vid}{ext} : {exc}", file=sys.stderr)
                ok = False
        print(f"  voix {vid} : ok" if ok else f"  voix {vid} : incomplète")
    return ok


def _pull_kokoro(paths: Paths, manifest: dict) -> bool:
    ok = True
    for f in manifest["tts"]["kokoro"]["files"]:
        dest = paths.models / "tts" / "kokoro" / f["name"]
        if dest.exists():
            continue
        try:
            _download(f["url"], dest, f["name"])
            if dest.suffix == ".onnx" and (not dest.exists() or not dest.read_bytes() or dest.read_bytes()[0:1] != b"\\x08"):
                dest.unlink(missing_ok=True)
                raise RuntimeError(f"Downloaded file appears corrupt: {dest}")
        except RuntimeError:
            raise
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {f['name']} : {exc}", file=sys.stderr)
            ok = False
    return ok


def _pull_fonts(paths: Paths, manifest: dict) -> bool:
    ok = True
    for f in manifest["fonts"]:
        dest = paths.fonts / f["name"]
        if dest.exists():
            continue
        try:
            _download(f["url"], dest, f["name"])
            if dest.read_bytes()[:4] != b"wOF2":  # un fichier HTML d'erreur n'est pas une police
                dest.unlink()
                raise ValueError("ce n'est pas un fichier woff2")
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {f['name']} : {exc}", file=sys.stderr)
            ok = False
    print("  polices : ok" if ok else "  polices : incomplètes")
    return ok


def pull(paths: Paths, what: str = "default", stt: str = "base", tts: str = "piper") -> int:
    manifest = load_manifest()
    everything = what == "all"
    results = []
    if what in ("default", "all", "fonts"):
        results.append(_pull_fonts(paths, manifest))
    if what in ("default", "all", "mt"):
        results.append(_pull_mt(paths, manifest))
    if what in ("default", "all", "stt"):
        results.append(_pull_stt(paths, manifest, stt))
    if what in ("default", "all", "tts"):
        results.append(_pull_piper(paths, manifest, everything))
        if tts == "kokoro" or everything:
            results.append(_pull_kokoro(paths, manifest))
    print("Terminé." if all(results) else "Terminé avec des erreurs (voir ci-dessus).")
    return 0 if all(results) else 1
