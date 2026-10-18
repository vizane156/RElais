"""Ligne de commande : relais serve | demo | pull | doctor."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import logging
import sys
import webbrowser

from . import __version__
from .core.app import RelaisApp
from .paths import Paths


def _have(mod: str) -> bool:
    return importlib.util.find_spec(mod) is not None


def _serve(args, engines: str) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    host = "0.0.0.0" if args.lan else args.host
    app = RelaisApp(home=args.data, engines=engines, lan=args.lan, extra_hosts=args.allow_host or ())
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{args.port}"

    use_asgi = args.server == "asgi" or (args.server == "auto" and _have("starlette") and _have("uvicorn"))
    if args.server == "asgi" and not (_have("starlette") and _have("uvicorn")):
        print("Starlette/uvicorn absents. Installe-les : pip install \"relais[server]\"", file=sys.stderr)
        return 2

    print(f"Relais {__version__} — moteurs : {'SIMULÉS (démo)' if engines == 'mock' else 'réels'}"
          f" — serveur : {'starlette' if use_asgi else 'léger (stdlib)'}")
    print(f"Données : {app.paths.home}")
    print(f"→ {url}")
    if args.open:
        webbrowser.open(url)

    try:
        if use_asgi:
            import uvicorn
            from .servers.asgi import create_asgi_app
            uvicorn.run(create_asgi_app(app), host=host, port=args.port, log_level="warning", access_log=False)
        else:
            from .servers.stdlib import serve
            asyncio.run(serve(app, host, args.port))
    except KeyboardInterrupt:
        pass
    return 0


def _pull(args) -> int:
    from .pull import pull
    return pull(Paths(args.data).ensure(), what=args.what, stt=args.stt, tts=args.tts)


def _doctor(args) -> int:
    from .doctor import run
    return run(Paths(args.data).ensure())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="relais", description="Traducteur vocal bilingue local EN <-> FR")
    p.add_argument("--version", action="version", version=f"relais {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--data", help="dossier de données (défaut : dossier utilisateur)")

    def serving(sp):
        common(sp)
        sp.add_argument("--host", default="127.0.0.1")
        sp.add_argument("--port", type=int, default=8765)
        sp.add_argument("--lan", action="store_true",
                        help="écouter sur le réseau local (le micro exige HTTPS hors localhost)")
        sp.add_argument("--allow-host", action="append", help="nom d'hôte supplémentaire autorisé")
        sp.add_argument("--server", choices=("auto", "asgi", "stdlib"), default="auto")
        sp.add_argument("--open", action="store_true", help="ouvrir le navigateur")

    s = sub.add_parser("serve", help="démarrer Relais avec les vrais moteurs")
    serving(s)
    s.add_argument("--engines", choices=("real", "mock"), default="real")
    d = sub.add_parser("demo", help="démarrer avec des moteurs SIMULÉS (aucune installation nécessaire)")
    serving(d)
    pl = sub.add_parser("pull", help="télécharger les modèles")
    common(pl)
    pl.add_argument("what", nargs="?", default="default", choices=("default", "all", "fonts", "mt", "stt", "tts"))
    pl.add_argument("--stt", default="base", choices=("tiny", "base", "small"))
    pl.add_argument("--tts", default="piper", choices=("piper", "kokoro"))
    dc = sub.add_parser("doctor", help="diagnostiquer l'installation")
    common(dc)

    args = p.parse_args(argv)
    if args.cmd == "serve":
        return _serve(args, args.engines)
    if args.cmd == "demo":
        return _serve(args, "mock")
    if args.cmd == "pull":
        return _pull(args)
    return _doctor(args)


if __name__ == "__main__":
    raise SystemExit(main())
