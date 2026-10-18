# Analyse approfondie du projet Relais

> Rapport généré après lecture exhaustive du code source.

---

## Résumé exécutif

**Relais** est un traducteur vocal bilingue anglais ↔ français, 100 % local, conçu pour fonctionner sans aucun compte ni API externe. L'utilisateur parle dans une langue, Relais transcrit, traduit et relit à voix haute dans l'autre langue — dans les deux sens, simultanément. Il peut aussi taper du texte pour le faire traduire et/ou lire phrase par phrase au fil de la frappe.

Le projet est en **phase 1 achevée** : l'architecture complète (protocole, session, pipeline audio, API HTTP, interface web) est opérationnelle et testée de bout en bout avec des moteurs simulés. Les quatre moteurs d'IA réels (traduction, reconnaissance vocale, synthèse Piper, synthèse Kokoro) sont écrits d'après les documentations officielles mais n'ont pas pu être exécutés dans l'environnement de développement faute de réseau pour télécharger les modèles.

**Points forts** : architecture sans dépendances dans le cœur, protocole WebSocket clairement documenté, interface sans framework ni build step, tests extrêmement complets, sécurité locale bien pensée, glossaire avec jetons opaques, schéma de réglages auto-générant l'interface.  
**Points de vigilance** : moteurs réels non exécutés, paire de langues câblée à EN/FR dans `langs.py`, latences inconnues sans machine de test, dépendances GPL potentiellement bloquantes pour une redistribution.

---

## 1. Architecture générale

### But du projet

Relais est un **interprète vocal de poche** pour deux personnes qui ne parlent pas la même langue. Tout tourne en local sur l'ordinateur de l'utilisateur. Aucune donnée ne sort.

### Structure macroscopique

```
relais/
├── __main__.py        CLI : serve | demo | pull | doctor
├── paths.py           Emplacements des fichiers (home, modèles, polices)
├── pull.py            Téléchargement des modèles
├── doctor.py          Diagnostic + mesure de latence
├── core/              Cœur sans dépendances (stdlib uniquement)
│   ├── app.py         Conteneur de l'application (RelaisApp, Hub, Security)
│   ├── session.py     Protocole WebSocket (Session)
│   ├── http_api.py    API HTTP + fichiers statiques (Api)
│   ├── registry.py    Registre des fonctionnalités (Registry, Cap)
│   ├── settings.py    Réglages : schéma, validation, profils (Schema, SettingsStore, ProfileStore)
│   ├── store.py       Stockage disque : enregistrements, historique, glossaire
│   ├── translate.py   Service de traduction : cache, glossaire, découpage (TranslationService)
│   ├── audio.py       Outils audio sans numpy (RMS, WAV)
│   ├── text.py        Découpage de texte, nettoyage transcriptions
│   ├── glossary.py    Jetons opaques pour le glossaire
│   └── langs.py       Paire de langues (PAIR, côtés a/b)
├── engines/           Moteurs interchangeables
│   ├── base.py        Contrats (Translator, Recognizer, Synthesizer)
│   ├── factory.py     Fabrique (choisit réel ou simulé)
│   ├── mock.py        Moteurs simulés (démo et tests)
│   ├── ct2_mt.py      Traduction : CTranslate2 + opus-mt
│   ├── whisper_stt.py Reconnaissance : faster-whisper
│   ├── piper_tts.py   Synthèse : Piper
│   └── kokoro_tts.py  Synthèse alternative : Kokoro
├── servers/           Adaptateurs réseau (fins)
│   ├── asgi.py        Starlette/uvicorn (recommandé)
│   └── stdlib.py      HTTP + WebSocket pur stdlib (démo, tests, repli)
├── web/               Interface web (modules ES natifs, sans framework)
│   ├── index.html
│   ├── js/            Modules JavaScript
│   │   ├── app.js     Chef d'orchestre front-end
│   │   ├── ws.js      Lien WebSocket + parser de trames audio
│   │   ├── api.js     Fetch wrapper
│   │   ├── store.js   Micro-store réactif
│   │   ├── speakchunk.js  Moteur « parler en tapant »
│   │   ├── audio/     Capture micro, VAD, rééchantillonnage, lecture, WAV
│   │   └── ui/        Composants UI (pupitre, conversation, réglages, etc.)
│   ├── css/           Feuilles de style modulaires
│   └── i18n/          Traductions fr.json + en.json
└── data/
    ├── models.json    Manifeste des modèles (URLs, tailles, licences)
    └── schema.json    Schéma des réglages (pilote l'interface)
```

**Flux d'une phrase captée au micro :**
```
Navigateur (micro)
  → Float32 20 ms (AudioWorklet)
  → Resampler → PCM 16 kHz Int16
  → VAD (détection d'énergie)
  → WebSocket binaire (0x01 + PCM)
  → Session._h_ut_start / on_binary / _h_ut_end
  → ThreadPoolExecutor "stt" → WhisperRecognizer.transcribe()
  → Session._finalize() → TranslationService.translate()
  → ThreadPoolExecutor "tts" → PiperSynthesizer.synth()
  → WebSocket binaire (0x02 + PCM 22 kHz)
  → Player.enqueue() → Web Audio API
```

---

## 2. Stack technique

### Backend (Python)

| Composant | Bibliothèque | Version min | Optionnel |
|---|---|---|---|
| Serveur web | Starlette + uvicorn | 0.37 / 0.29 | Oui (stdlib en repli) |
| Traduction | ctranslate2 + sentencepiece | 4.4 / 0.2 | Oui |
| Reconnaissance | faster-whisper | 1.1 | Oui |
| Synthèse (Piper) | piper-tts | 1.3 | Oui |
| Synthèse (Kokoro) | kokoro-onnx | 0.4 | Oui |
| Conversion modèles | transformers + torch | 4.40 | Oui (1 fois) |
| Tests Python | pytest | — | Dev |

Le cœur (`relais/core/`) est **entièrement sans dépendances** : uniquement la bibliothèque standard Python 3.10+. Les moteurs d'IA importent numpy et les bibliothèques ML **à l'activation**, pas au démarrage.

Source : `pyproject.toml` — `dependencies = []`, tout est en `[project.optional-dependencies]`.

### Frontend (JavaScript)

| Composant | Approche |
|---|---|
| Modules | ES modules natifs (aucun bundler) |
| Réactivité | Micro-store artisanal (`store.js`, ~15 lignes) |
| Framework UI | Aucun — DOM direct via `h()` (hyperscript) |
| Audio | Web Audio API (AudioContext, AudioWorkletNode) |
| Traductions | Fichiers JSON statiques + `i18n.js` |

Le `package.json` du dossier `web/` contient uniquement `{"type": "module"}` — il n'y a aucun outil de build, aucune dépendance npm.

---

## 3. Moteurs (`engines/`)

### `base.py` — Contrats

Trois protocoles Python (`typing.Protocol`) définissent l'interface de tout moteur :

```python
class Translator(Protocol):
    def translate_batch(self, texts: list[str], src: str, tgt: str, beam: int) -> list[str]: ...
    def close(self) -> None: ...

class Recognizer(Protocol):
    def transcribe(self, pcm16: bytes, language: str | None, final: bool, hint: int) -> RecResult: ...
    def detect(self, pcm16: bytes) -> tuple[str, float]: ...
    def close(self) -> None: ...

class Synthesizer(Protocol):
    def voices(self, lang: str) -> list[Voice]: ...
    def synth(self, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, int]: ...
    def close(self) -> None: ...
```

`EngineUnavailable` est l'exception standard : elle porte une `key` i18n et un texte de repli, pour que l'interface affiche le bon message dans la bonne langue.

### `factory.py` — Fabrique

`EngineFactory.make(cap_id)` est appelé dans un thread dédié (ThreadPoolExecutor "load"). Elle choisit réel ou simulé selon `kind`, lit les réglages courants, et retourne l'objet moteur. `voices_for_ui()` peut fonctionner même quand la fonction « Voix » est éteinte.

### `mock.py` — Moteurs simulés

- **MockTranslator** : lexique mot à mot EN/FR + FR/EN (~70 termes), et un tableau de 8 phrases avec leurs traductions exactes pour que la démo soit lisible.
- **MockRecognizer** : révèle une phrase mot par mot proportionnellement à la durée audio ; alterne les langues selon un compteur d'itération ; détecte le silence par RMS.
- **MockSynthesizer** : génère du son synthétique modulé (sinusoïdes harmoniques avec enveloppe) pour chaque mot — audible mais pas naturel. Taux d'échantillonnage 22 050 Hz.

### `ct2_mt.py` — Traduction CTranslate2

Charge deux modèles Marian (Helsinki-NLP/opus-mt-en-fr et fr-en) quantifiés en int8. Tokenisation avec SentencePiece directement (pas de `transformers` à l'exécution). Effectue une « phrase de chauffe » au chargement pour que la première vraie traduction ne soit pas pénalisée par les allocations JIT. Supporte CUDA auto-détecté.

### `whisper_stt.py` — Reconnaissance faster-whisper

Charge un modèle Whisper (tiny/base/small) via faster-whisper (CTranslate2 sous le capot). Deux modes : provisoire (beam=1) et final (beam=2). Détection de langue contrainte à la paire configurée. Paramètres Whisper conservateurs (`no_speech_threshold=0.6`, `vad_filter=False` — VAD fait côté navigateur).

### `piper_tts.py` — Synthèse Piper

Charge les voix ONNX à la demande et les garde en cache par identifiant. Supporte le `SynthesisConfig` avec `length_scale` pour la vitesse (avec repli gracieux sur les anciennes versions de Piper). Renvoie PCM16 + fréquence. **Licence : GPL-3.0** (voir LICENSES.md).

### `kokoro_tts.py` — Synthèse Kokoro

Alternative plus naturelle mais plus lente (82 M paramètres, ONNX). Utilise `kokoro-onnx`. Convertit float32→int16 avec numpy. **Licence : dépendance GPL-3.0 transitoire** (phonemizer-fork).

---

## 4. Core

### `app.py` — Conteneur principal

`RelaisApp` est le singleton de l'application. Il crée :
- `Paths` : emplacements disque
- `Schema` + `SettingsStore` + `ProfileStore` : réglages
- `GlossaryStore`, `RecordingStore`, `HistoryStore` : stockage
- `Security` : vérification Origin + Host
- `Hub` : diffusion aux sessions ouvertes (multi-onglets)
- 4 `ThreadPoolExecutor` : `stt`, `mt`, `tts`, `load` (1 thread chacun sauf `load` : 2)
- `EngineFactory` + `Registry`

`Hub.broadcast()` diffuse un message JSON à toutes les sessions connectées (multi-onglets/fenêtres).

`Security` protège contre le DNS rebinding (vérification `Host`) et les pages tierces (vérification `Origin`). Mode `--lan` autorise les IP privées et `.local`.

### `session.py` — Protocole WebSocket

Classe `Session` : une instance par connexion WebSocket. Gère :
- 11 types de messages JSON entrants (`hello`, `cap`, `set`, `tr`, `say`, `speak`, `speak.cancel`, `ut.start`, `ut.end`, `ut.cancel`, `ping`)
- Audio binaire entrant : `0x01 + PCM16 mono 16 kHz`
- Audio binaire sortant : header 14 octets (`0x02`, id u32, seq u32, sr u32, flags u8) + PCM16
- File de parole (`_speech_q`) avec un worker asyncio dédié
- Boucle de texte provisoire (`_partial_loop`) toutes les 0,55 s
- Finalisation asynchrone de chaque énoncé

Constantes importantes :
- `MAX_UTT_BYTES = SR_STT * 2 * 90` : garde-fou 90 s
- `MIN_UTT_S = 0.30` : ignore les sons < 300 ms
- `GATE_RMS = 0.0035` : seuil de silence
- `PARTIAL_EVERY_S = 0.55` : fréquence des passes provisoires

### `registry.py` — Registre des fonctionnalités

6 fonctionnalités (capacités) : `listen`, `translate`, `speak`, `typespeak`, `record`, `clone`.

États : `off`, `loading`, `ready`, `unavailable`, `error`, plus `unavailable` permanent pour `clone` (planned).

Cycle de vie : activation → `_ensure_loaded()` → task asyncio → `_load()` dans le thread pool → état `ready` ou `unavailable`. Désactivation → annule le chargement → `_unload()` + `gc.collect()` si `perf.unload_when_off`. Les dépendances (`typespeak` requiert `speak`) s'activent automatiquement et se désactivent en cascade.

### `settings.py` — Réglages

`Schema.load()` lit `data/schema.json`. La méthode `coerce(key, value)` valide et normalise chaque valeur sans jamais lever d'exception. Types supportés : `toggle`, `select`, `range`, `number`, `color`, `text`, `caps`.

`SettingsStore.patch()` est atomique (RLock) et écrit sur disque avec `_atomic_write()` (fichier temporaire + `os.replace`).

`ProfileStore` : instantanés nommés des réglages. Les clés `profile: false` (périphériques audio, caps.on) sont exclues des profils.

### `translate.py` — Service de traduction

`TranslationService` enveloppe un moteur brut avec :
- **Segmentation** : `text.segment()` découpe en phrases ≤ 320 caractères, préserve les sauts de ligne
- **Cache LRU** : 20 000 entrées, clé = `(src, tgt, beam, gver, segment)`
- **Glossaire** : `Glossary.protect()` remplace les termes par des jetons `GLS0`…`GLSn`, `restore()` les remet après traduction. Si un jeton est perdu, retraduction sans protection plutôt que livrer un texte cassé.
- **Qualité** : 1/2/4 faisceaux selon `translate.quality` (fast/balanced/best)

### `audio.py` — Utilitaires audio sans numpy

- `rms_pcm16()` : énergie RMS normalisée, sous-échantillonnée pour la performance
- `wav_bytes()` : encode PCM16 en WAV
- `wav_info()` : valide un WAV (16 bits, mono/stéréo, 8–192 kHz, durée max)

### `glossary.py` — Jetons opaques

`Glossary.protect()` : les règles sont triées par longueur décroissante (pour que "pull request" soit protégé avant "pull"), avec des bornes de mots (`\b`). Chaque correspondance devient `GLSn`.

`Glossary.restore()` : tolère les jetons légèrement abîmés par le modèle (`G LS 0`, `gls-0`…) grâce à `_TOKEN_RE`. Renvoie `None` si un jeton est manquant — fallback dans `TranslationService`.

### `http_api.py` — API HTTP

`Api.handle()` est le point d'entrée unique pour les deux serveurs. Routes :
- `GET /api/info`, `GET /api/state`, `GET /api/schema`
- `GET|PUT|POST /api/settings[/reset]`
- `GET|PUT|POST|DELETE /api/profiles/{name}[/apply]`
- `GET|PUT /api/glossary`
- `GET|DELETE /api/history`, `GET /api/history/export.txt`
- `GET /api/models`
- `GET|PUT|PATCH|DELETE /api/recordings[/{id}[.wav]]`
- Fichiers statiques : `web/` + `fonts/` (installées par `relais pull fonts`)

CSP stricte : `default-src 'self'; script-src 'self'; style-src 'self'…` — aucun inline autorisé. Protection traversée de chemin par `posixpath.normpath()` + `target.relative_to(root)`. Requêtes Range supportées (lecture audio progressive).

### `text.py` — Traitement du texte

- `segment()` : découpe sur les fins de phrase, préserve les sauts de ligne (marqueur `\x00NL\x00`)
- `split_for_speech()` : premier morceau ≤ 90 caractères (latence), suivants ≤ 150 caractères
- `is_hallucination()` : filtre les phrases que Whisper « invente » sur du silence
- `clean_transcript()` : normalise les espaces

### `langs.py` — Paire de langues

```python
PAIR = ("en", "fr")
```

Fonctions `side_lang(side)`, `lang_side(lang)`, `other_side(side)`, `other_lang(lang)`. Tout le code raisonne en côtés `a`/`b`, jamais en "english"/"french" en dur.

---

## 5. Frontend (`web/`)

### `index.html` — Structure HTML

Balisage sémantique : `<header>`, `<aside class="desk">` (pupitre), `<main>` (conversation + saisie), `<aside class="sheet">` (tiroir modal). Attributs `data-i18n` pour les traductions, `role`, `aria-*` pour l'accessibilité. Feuilles de style modulaires (tokens → base → layout → components → folio → motion). Un seul `<script type="module">` : `/js/app.js`.

### `app.js` — Chef d'orchestre

Séquence de démarrage (`boot()`) :
1. Charge la langue de l'interface
2. Crée le store réactif
3. Instancie `Link` (WebSocket), `Player` (audio), `Capture` (micro)
4. Monte les composants UI
5. Connecte les événements : micro → WebSocket, WebSocket → UI + Player
6. Démarre la connexion WebSocket

Gestion des messages serveur : `state` (initialisation complète), `stt` (transcription), `tr` (traduction), `speak.start/end/cancelled` (cycle de parole), `rec` (bibliothèque), `error` (toast), etc.

Garde anti-écho (`listen.echo_guard`) : coupe le micro pendant que le Player joue, avec 350 ms de marge.

### `ws.js` — Lien WebSocket

`Link extends EventTarget` : reconnexion automatique (backoff exponentiel de 400 ms à 8 s), messages JSON sur canal texte, audio binaire sur canal binaire.

`parseAudioFrame(buffer)` : parse le header 14 octets (`0x02`, id u32, seq u32, sr u32, flags u8) et renvoie un objet `{id, seq, sampleRate, last, pcm}`.

### `store.js` — Store réactif

~15 lignes. `createStore(initial)` retourne `{get, set, subscribe}`. `set(patch)` fusionne et notifie tous les abonnés avec `(state, patch, prev)`.

### `audio/capture.js` — Capture micro

`MicTap` : couche bas niveau — `getUserMedia` + `AudioContext` + `AudioWorkletNode`. Trames Float32 de 20 ms à la fréquence native de la carte son.

`Capture extends EventTarget` : pilote `MicTap` + `Vad` + `Resampler`. Événements : `level` (niveau pour le vumètre), `speechstart`, `frames` (Int16Array 16 kHz), `speechend`, `open`, `close`, `muted`. Garde un pré-roll de 300 ms (15 trames) pour ne pas couper la première syllabe.

### `audio/vad.js` — Détection de parole

Algorithme à énergie RMS avec :
- Plancher de bruit adaptatif (descend vite, monte lentement)
- Hystérésis (seuil haut pour démarrer, seuil bas = 60 % pour finir)
- `minSpeechMs = 80` ms : ignore les claquements brefs
- `maxMs = 28 000` ms : coupe les phrases trop longues
- Détection de bruit continu (ventilateur) : si `floor > off` depuis 1,5 s, relève le plancher

### `audio/player.js` — Lecture sans trou

`Player extends EventTarget` : `enqueue(int16, sampleRate)` programme chaque PCM sur l'horloge audio (`ctx.currentTime + 0.03` au minimum, puis `this.next = at + buf.duration`). Fondu 4 ms au début et à la fin de chaque morceau pour éviter les claquements. Méthode `cancel()` pour couper immédiatement. Supporte `setSinkId` pour choisir le périphérique de sortie.

### `speakchunk.js` — Parler en tapant

`TypeSpeaker` : découpe le texte au fil de la frappe selon 3 rythmes :
- `word` : un mot dès qu'il est terminé (espace suivant)
- `group` : à la ponctuation, ou après `pauseMs` de silence de frappe si ≥ `minWords` mots, ou à `maxWords` mots
- `sentence` : seulement aux fins de phrase

`commonPrefixLength(a, b)` : si l'utilisateur corrige le début, seule la partie modifiée est redite.

### `js/api.js` — Fetch

Wrapper fetch minimal : `get`, `json` (PUT/POST/PATCH avec corps JSON), `put` (blob audio), `del`. Lève une erreur typée avec `err.status` si réponse non-2xx.

### `ui/folio.js` — Conversation

Deux colonnes face à face (`said` = langue source, `heard` = traduction). Chaque énoncé est un `<article class="utt">`. États : `live` (lampe clignotante), `pending` (en attente de traduction), `final` (texte définitif). Animation "wipe" à l'apparition de la traduction. Boutons Rejouer + Copier sur les lignes finalisées. Auto-scroll intelligent (suit si l'utilisateur était en bas).

### `ui/settings.js` — Réglages auto-générés

L'écran est entièrement généré depuis le schéma JSON récupéré via `/api/schema`. Aucun champ n'est écrit à la main. Pour chaque champ du schéma : un contrôle adapté au type (`toggle → switch ARIA`, `range → input[type=range]`, `select → select`, `color → input[type=color]`). Les options dynamiques (voix disponibles, périphériques audio) sont injectées au moment de l'affichage.

### `ui/sheet.js` — Tiroir modal

5 onglets (`settings`, `library`, `history`, `glossary`, `system`) avec navigation clavier (flèches). Gestion `inert` pour l'accessibilité. Restaure le focus à la fermeture.

### `ui/keys.js` — Pupitre

6 touches (`listen`, `translate`, `speak`, `typespeak`, `record`, `clone`). Chaque touche est un `<button role="switch">` avec lampe d'état, label et état textuel. `clone` a `data-planned` et ne fait qu'afficher un toast. Le voyant engrenage ouvre l'onglet réglages à la bonne section.

---

## 6. Serveurs

### `asgi.py` — Starlette (recommandé)

~60 lignes. Crée une application Starlette avec :
- Route WebSocket `/ws` : vérifie Origin + Host, crée une `Session`, boucle sur `receive()`
- Route catch-all HTTP : délègue à `Api.handle()`
- Lifespan : `await app.start()` / `await app.stop()`

### `stdlib.py` — Serveur standard (sans dépendance)

~200 lignes. Implémente HTTP/1.1 et WebSocket RFC 6455 en pur asyncio :
- Lecture des requêtes HTTP ligne par ligne
- Poignée de main WebSocket (SHA-1 + base64 selon RFC 6455)
- Décodage complet des trames WebSocket (masquage, fragmentation, ping/pong, close)
- Trames jusqu'à 32 Mo
- Sert à la démo (`relais demo`), aux tests, et en repli si Starlette absent

---

## 7. Données

### `models.json` — Manifeste des modèles

Quatre sections :
- **`fonts`** : 5 fichiers woff2 (Atkinson Hyperlegible Next + Literata) depuis jsdelivr
- **`mt`** : 2 modèles opus-mt (en-fr, fr-en) depuis Helsinki-NLP sur HuggingFace, ~80 Mo chacun, CC-BY-4.0
- **`stt`** : 3 tailles Whisper (tiny 75 Mo, base 145 Mo, small 480 Mo), MIT
- **`tts.piper`** : 5 voix (3 EN, 2 FR) depuis rhasspy/piper-voices sur HuggingFace, ~63 Mo chacune
- **`tts.kokoro`** : 2 fichiers (kokoro-v1.0.onnx + voices-v1.0.bin), ~340 Mo total, 4 voix (3 EN, 1 FR)

### `schema.json` — Schéma des réglages

Version 1. 8 sections visibles + 2 champs cachés :

| Section | Champs clés |
|---|---|
| Interface | langue UI, thème, disposition, police, échelle, densité, animations, couleurs, affichage original, affichage latence |
| Langues | qui suis-je (côté a ou b) |
| Écoute | qui parle, modèle Whisper, partiels, silence, sensibilité, garde anti-écho, périphérique |
| Traduction | traduction en direct, qualité, glossaire |
| Voix | lire traductions, lire originaux, moteur, voix a/b, vitesse, volume, périphérique |
| Parler en tapant | langue source, langue voix, rythme, pause, mots minimum |
| Enregistrement | garder mes phrases |
| Performance | décharger les modèles, threads, historique |
| Cachés | côté gauche, caps actives |

La clé `"reload"` dans un champ indique quelle fonctionnalité redémarrer si ce réglage change (ex. `"reload": "listen"` sur `listen.model`).

---

## 8. Tests

### `test_core.py` — Tests unitaires du cœur

**TextTests** (5 tests) : `segment()` + `rejoin()` aller-retour, découpage long texte, `split_for_speech()` (premier morceau court, reconstruction complète), hallucinations.

**GlossaryTests** (5 tests) : protect/restore, jeton perdu → None, jeton abîmé toléré (`gls 0`), priorité au terme le plus long, mauvaise langue ignorée.

**SettingsTests** (8 tests) : défauts + clamping, refus des invalides, patch imbriqué + persistance, sélect entier + arrondi step, liste caps filtrée, fichier corrompu → défauts, cohérence schéma (coerce de chaque défaut), profils (sauvegarder/charger/supprimer, clés machine exclues, noms invalides).

**StoreTests** (4 tests) : cycle de vie RecordingStore (add/list/path/update/delete), rejets mauvais inputs (path traversal, WAV invalide), HistoryStore (append/tail/export/clear), GlossaryStore (validation, 3 règles sur 6 acceptées).

**TranslateServiceTests** (4 tests) : cache hits (0 appels supplémentaires), sauts de ligne + texte vide, glossaire appliqué + fallback si jeton perdu, glossaire désactivable.

**I18nTests** (1 test) : vérifie que `fr.json` et `en.json` ont exactement les mêmes clés, et que toutes les clés référencées dans `schema.json` existent dans `fr.json`.

### `test_session.py` — Tests d'intégration

**SessionTests** (15 tests, `IsolatedAsyncioTestCase`) :
- `hello` retourne l'état complet
- Toggle + dépendances (typespeak allume speak, speak éteint typespeak en cascade)
- `clone` reste `unavailable` même si activé
- Fonctionnalités persistées après redémarrage
- Traduction dans les deux sens, historique sauvegardé
- Aperçu périmé (id stale) supprimé
- Pipeline complet : micro → STT → MT → TTS → audio binaire → historique
- Langue auto alterne correctement avec le mock
- Silence et bruit ignorés
- Son trop court ignoré
- Écoute éteinte → refus propre
- Parler en tapant : traduit + prononce
- Même langue : pas de traduction
- Annulation de la file
- Broadcast settings + refus invalide
- Rechargement moteur quand `listen.model` change
- Mauvaises entrées ne plantent jamais
- `record.keep_utterances` sauvegarde seulement « ma » langue

**HttpTests** (6 tests) :
- Réglages et schéma (PUT avec clé invalide → rejected, reset)
- Cycle de vie enregistrements + requêtes Range (206, 416)
- Path traversal bloqué (8 variantes)
- Vérification Host + Origin (403 pour hôte étranger et origin tierce, 200 pour localhost correct)
- Profils, glossaire, historique, export.txt
- Statut modèles, en-têtes de sécurité CSP

**StdlibServerTests** (3 tests) :
- Poignée de main WebSocket complète + roundtrip audio + grande trame (>64 Ko)
- Origin étrangère → 403
- HTTP basique sur socket raw

**RealEnginesMissingTests** (2 tests) :
- Avec moteurs réels et zéro modèle : chaque cap → `unavailable` + message actionnable (`relais pull …`), session utilisable quand même
- `voices_for_ui()` retourne `{a: [], b: []}`, `model_status()` correct

### `tests/js/pure.test.mjs` — Tests JavaScript (Node)

22 tests avec `node:test` :
- **VAD** (7 tests) : silence ne déclenche rien, start/end corrects, pause courte ne coupe pas, claquement bref ignoré, sensibilité abaisse le seuil, bruit continu adapte le plancher, voix avec creux non perturbée, phrase trop longue coupée
- **Rééchantillonnage** (4 tests) : 48 kHz → 16 kHz (durée exacte ±2 échantillons), 44,1 kHz (rapport non entier, amplitude préservée), même fréquence = passage direct, int16 et rms
- **WAV** (1 test) : en-tête RIFF/WAVE valide, mono, 16 bits, concat, mixToMono
- **TypeSpeaker** (10 tests) : rythme `word`, `group` (ponctuation, pause, maxWords), `sentence`, flush, correction sans redire, reset, frappe lettre-par-lettre avec pauses, long texte collé

### `tests/e2e/` — Tests bout en bout (Playwright)

**`browser.cjs`** : 40 vérifications dans Chromium réel avec un faux micro (`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`). Couvre :
- Connexion WebSocket
- Badge démo, pupitre 6 touches, clone marqué « à venir »
- Activation écoute/traduction/voix, voyants
- Phrase provisoire + finale + traduction + audio joué
- Délais affichés
- Saisie : aperçu en direct, envoi, champ vidé
- Parler en tapant : morceaux prononcés pendant la frappe
- Réglages : sections générées, contrôles, thème sombre, taille du texte, couleur personnalisée, profil
- Langue de l'interface FR → EN → FR
- Bibliothèque : enregistrement + réécoute + sauvegarde + validation WAV serveur
- Glossaire appliqué à la prévisualisation
- Historique rempli
- Rechargement : conversation restaurée, fonctions rallumées
- Extinction : touche s'éteint
- Mobile : pas de scroll horizontal, disposition empilée
- Aucune erreur console / CSP

**`make_fake_mic.py`** : génère un WAV de 30 s avec 4 phrases simulées (ton sinusoïdal + silence entre chaque) pour alimenter le faux micro Chromium.

---

## 9. Points forts et faiblesses

### Points forts

**Architecture**
- Cœur sans dépendance : tout `relais/core/` n'utilise que la stdlib Python. On peut l'importer, le tester, l'analyser sans rien installer.
- Abstraction propre des moteurs : changer de modèle = écrire une classe. Le reste du système ne sait pas quel moteur tourne.
- Deux serveurs derrière la même interface `Api` / `Session` : la logique n'est testée qu'une fois.
- Chargement/déchargement dynamique des modèles avec libération mémoire (`gc.collect()`).

**Protocole**
- WebSocket documenté dans l'en-tête de `session.py` (exhaustif).
- Gestion correcte de la concurrence : un thread par type de travail, jamais deux inférences simultanées du même type.
- Annulation propre : `speak.cancel` vide la file et marque le job courant `cancelled` avant chaque morceau.

**Interface**
- Aucun framework, aucun bundler : modifier l'interface = modifier un fichier, rechargement navigateur.
- Store réactif minimal (~15 lignes) suffisant pour l'usage.
- Réglages auto-générés depuis le schéma : ajouter un réglage = un objet JSON.
- Interface bilingue (FR/EN) avec un test automatique garantissant la cohérence des clés.
- Accessibilité : `role="switch"`, `aria-checked`, `aria-live`, `inert` sur le contenu en arrière-plan, navigation clavier dans les onglets.

**Sécurité**
- Double vérification Origin + Host (protection DNS rebinding ET pages tierces).
- CSP stricte sans inline.
- Protection traversée de chemin sur les fichiers statiques ET les enregistrements audio.
- Noms de fichiers générés (jamais de texte utilisateur dans un chemin disque).
- Écriture atomique (fichier tmp + `os.replace`).

**Tests**
- Couverture exemplaire : 56 tests Python (unitaires + intégration + serveur réel), 22 tests JS (purs, sans browser), 40 vérifications E2E Chromium.
- Les tests ont trouvé et corrigé de vrais bugs pendant l'écriture (sérialisation stdlib, fuite audio, collision de styles).
- `IsolatedAsyncioTestCase` pour les tests session : chaque test a son propre event loop.

### Faiblesses et risques

**Moteurs réels non validés**
- `ct2_mt.py`, `whisper_stt.py`, `piper_tts.py`, `kokoro_tts.py` sont écrits d'après les documentations mais n'ont jamais tourné. Les API pourraient avoir évolué. C'est le risque principal pour un premier déploiement.
- Les URLs de téléchargement Kokoro ne sont pas confirmées (README le mentionne explicitement).
- `asgi.py` (~60 lignes) n'a pas été testé.

**Paire de langues câblée**
- `PAIR = ("en", "fr")` dans `langs.py` est la seule constante à changer pour une autre paire, mais les noms de modèles dans `models.json` contiennent `opus-mt-en-fr` et `opus-mt-fr-en` en dur. Ajouter une troisième langue demande des modèles supplémentaires et un sélecteur de paire dans l'interface.

**Performances inconnues**
- Aucun chiffre de latence validé — dépend totalement de la machine. `relais doctor` est le seul moyen de savoir.
- Le modèle Whisper `base` (145 Mo) sur CPU peut être lent. `tiny` est plus rapide mais moins précis.

**Licences**
- `piper-tts` est GPL-3.0. `kokoro-onnx` tire `phonemizer-fork` (GPL-3.0). Sans conséquence pour l'usage personnel, mais bloquant pour toute redistribution commerciale.
- Les modèles opus-mt sont CC-BY-4.0 et Whisper est MIT — sans problème.

**Serveur stdlib limité**
- Fonctionne bien pour la démo et les tests, mais n'est pas conçu pour la production : pas de keep-alive, pas de compression, pas de timeout agressif.

**Glossaire et retraduction**
- Le fallback sans protection garantit qu'un jeton perdu n'aboutit pas à du texte cassé, mais la règle de glossaire ne s'applique alors pas du tout. Cas rare en pratique.

**VAD côté navigateur seulement**
- La détection de parole est entièrement côté navigateur (énergie RMS). Le README mentionne Silero VAD comme amélioration future pour les environnements bruyants.

**Mémoire**
- `HistoryStore` lit toutes les lignes du fichier JSONL pour en afficher 200. Sur une longue utilisation (des milliers de phrases), `tail(n)` ouvre et lit l'intégralité du fichier à chaque appel.

---

## 10. Fonctionnalités clés

L'utilisateur peut :

1. **Conversation en direct (micro)** : allumer « Écoute », parler dans l'une ou l'autre langue. Relais transcrit (texte provisoire en direct, puis définitif), traduit, et lit à voix haute la traduction dans l'autre langue.

2. **Taper pour traduire** : écrire dans la zone de saisie. Aperçu de traduction en direct (110 ms de délai). Envoi par Entrée : ligne ajoutée à la conversation, traduite, éventuellement lue à voix haute.

3. **Parler en tapant** : allumer « Parler en tapant ». Ce qu'on tape est prononcé au fil de la frappe selon le rythme choisi (mot / groupe / phrase), traduit si la langue de voix diffère de la langue de frappe.

4. **Gérer les réglages** : modifier thème, police, animations, densité, couleurs des langues, sensibilité du micro, modèle Whisper, moteur TTS, voix, vitesse, volume, périphériques…

5. **Profils** : sauvegarder un instantané de tous les réglages sous un nom, l'appliquer d'un clic, l'exporter/importer en JSON.

6. **Glossaire** : définir des termes à garder intacts ou à toujours traduire d'une façon précise. Actif en temps réel sur la prévisualisation de saisie.

7. **Bibliothèque vocale** : enregistrer sa voix (avec réécoute avant de garder), téléverser un fichier audio (converti en WAV par le navigateur), réécouter, renommer, télécharger, supprimer. Prépare le clonage de voix (phase 3).

8. **Historique** : voir la conversation, l'exporter en .txt, la vider.

9. **Diagnostic** : `relais doctor` charge chaque moteur et mesure la latence réelle sur la machine.

10. **Mode démo** : `relais demo --open` — aucune installation, moteurs simulés, toute la chaîne fonctionne (badge « Démo »).

---

## 11. Recommandations

### Priorité haute (avant utilisation en production)

1. **Valider les moteurs réels** : `relais pull` puis `relais doctor` sur une vraie machine avec réseau. Corriger les éventuels décalages d'API dans les 4 fichiers `engines/*.py`. C'est la seule inconnue bloquante.

2. **Tester `asgi.py`** : démarrer avec `--server asgi` et exécuter la suite de tests. Le fichier est court (~60 lignes) et les problèmes éventuels sont limités.

3. **Vérifier les URLs Kokoro** : les deux URLs dans `models.json` → `tts.kokoro.files` n'ont pas été confirmées (README, section « Ce qui est vérifié »).

### Priorité moyenne (amélioration de la robustesse)

4. **`HistoryStore.tail()` pour les longues sessions** : remplacer la lecture complète par une lecture depuis la fin (ex. `seek` vers la fin du fichier JSONL + lecture partielle). Pour l'usage actuel (conversation de quelques heures), le problème n'est pas critique.

5. **Silero VAD** : améliorerait la détection en environnement bruyant (phase 2 selon ROADMAP). Peut être fait côté navigateur avec un modèle ONNX de ~2 Mo.

6. **Tests `asgi.py`** : ajouter un test équivalent à `StdlibServerTests` pour Starlette, même minimaliste.

### Priorité basse (polish)

7. **Couleurs thème clair/sombre** : le README mentionne que la couleur choisie s'applique telle quelle, sans adaptation au thème. Utiliser `color-mix()` ou des variantes CSS pour améliorer le contraste en thème sombre.

8. **Mémoire de contexte** : la traduction phrase par phrase sans contexte peut donner des incohérences sur des pronoms ou références. Passer un contexte optionnel (la phrase précédente) à `translate_batch` améliorerait la cohérence — sans changement d'interface.

9. **Type hints complets** : le code Python est bien typé mais pas systématiquement annoté partout. Ajouter `mypy` en CI permettrait de détecter les erreurs de type avant l'exécution.

---

## Annexe — Fichiers lus

Tous les fichiers listés dans l'arborescence ci-dessus ont été lus intégralement, à l'exception de :
- `relais/web/css/*.css` (fichiers de style, hors périmètre de l'analyse fonctionnelle)
- `relais/web/i18n/en.json` et `fr.json` (dictionnaires de traduction, structure vérifiée via les tests)
- `relais/web/js/audio/resample.js`, `capture.worklet.js`, `wav.js`, `dom.js`, `i18n.js`, `icons.js`, `theme.js`, `ui/glossary.js`, `ui/meter.js`, `ui/toast.js` (modules utilitaires, comportement inféré depuis les appelants et les tests)
- `tests/e2e/make_fake_mic.py` (script de génération du faux micro, comportement décrit dans `run.sh`)
- `scripts/build_i18n.py` (script de génération des fichiers i18n)
- `LICENSES.md` (liste des licences, points importants relevés dans le README)
