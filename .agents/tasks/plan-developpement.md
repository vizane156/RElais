# Plan de développement — Relais

> Rapport rédigé après lecture exhaustive du code source (engines/, core/, servers/, tests/, web/js/).

---

## Résumé exécutif

Trois axes de travail sont identifiés, par ordre de priorité opérationnelle :

1. **Tests d'intégration des moteurs réels** — risque le plus immédiat. Les 4 fichiers
   `ct2_mt.py`, `whisper_stt.py`, `piper_tts.py`, `kokoro_tts.py` n'ont jamais tourné en
   conditions réseau. Un bug d'API dans l'un d'eux bloque complètement la fonction
   correspondante. Complexité globale **M** (les fondations existent : `EngineUnavailable`,
   `RealEnginesMissingTests`, `Harness`, pool de threads).

2. **Gestion multi-utilisateurs** — l'architecture est plus proche qu'elle n'y paraît. Le
   `Hub` diffuse déjà à toutes les sessions, les `ThreadPoolExecutor` sont partagés, et les
   stores sont thread-safe. L'essentiel manquant est l'isolation des réglages et préférences
   par session, plus une couche d'identification légère. Complexité globale **L**.

3. **CI/CD** — aucun pipeline n'existe. GitHub Actions est recommandé (le repo est local mais
   la structure est standard). Les étapes lourdes (modèles IA ~1 Go) se gèrent avec le cache
   GitHub Actions et un flag de skip conditionnel déjà présent implicitement dans les tests
   (`RealEnginesMissingTests`). Complexité globale **M**.

---

## Axe 1 — Tests d'intégration des moteurs IA réels

### Contexte technique

Les 4 moteurs héritent tous de la même mécanique :
- Import dynamique avec `EngineUnavailable(key="err.dep")` si la librairie est absente.
- `EngineUnavailable(key="err.model_*")` si les fichiers modèle sont absents.
- Chargement via `EngineFactory.make(cap_id)` dans un thread `load`.
- Téléchargement des modèles via `relais pull` → `pull.py` → `_download()` / `faster_whisper.download_model()` / `ct2-transformers-converter`.

Le test `RealEnginesMissingTests` dans `test_session.py` vérifie déjà le chemin sans modèles.
Il manque les tests **avec** les vrais modèles téléchargés.

### Structure recommandée

Créer `tests/integration/` avec :
```
tests/integration/
├── conftest.py          # fixtures : skip si modèle absent, paths tmp, tolerances
├── test_ct2_mt.py       # Axe 1a
├── test_whisper_stt.py  # Axe 1b
├── test_piper_tts.py    # Axe 1c
├── test_kokoro_tts.py   # Axe 1d
└── test_pipeline.py     # Axe 1e : pipeline complet STT→MT→TTS
```

### Gestion du skip conditionnel

Utiliser `pytest.mark.skipif` basé sur la présence effective des modèles dans `~/.relais/models/` (via `Paths` de `relais/paths.py`). Exemple de fixture :

```python
# tests/integration/conftest.py
import pytest
from relais.paths import Paths
from pathlib import Path

MODELS = Paths().models  # ~/.relais/models ou dossier de test

def model_present(*parts) -> bool:
    return (MODELS / Path(*parts)).exists()

skip_mt    = pytest.mark.skipif(not model_present("mt/opus-mt-en-fr-int8/model.bin"),
                                reason="Modèle MT absent — lancer: relais pull mt")
skip_stt   = pytest.mark.skipif(not model_present("stt/whisper-base/model.bin"),
                                reason="Modèle STT absent — lancer: relais pull stt")
skip_piper = pytest.mark.skipif(not any(model_present("tts/piper", f"{v}.onnx")
                                        for v in ["en_US-lessac-medium", "fr_FR-siwis-medium"]),
                                reason="Voix Piper absentes — lancer: relais pull tts")
skip_kokoro = pytest.mark.skipif(not model_present("tts/kokoro/kokoro-v1.0.onnx"),
                                 reason="Modèle Kokoro absent — lancer: relais pull tts --tts kokoro")
```

### Tâches ordonnées

---

#### Tâche 1.0 — Créer `tests/integration/conftest.py`
**Complexité : S**

Ce qu'il faut faire :
- Définir les fixtures `models_dir` (répertoire réel ou `--models-dir` en argument pytest),
  les markers de skip conditionnel (`skip_mt`, `skip_stt`, `skip_piper`, `skip_kokoro`),
  et une fixture `pcm_tone(seconds)` produisant du PCM 16 kHz 16 bits (réutiliser la
  fonction `tone()` déjà dans `test_session.py`).
- Ajouter une option pytest `--models-dir` via `conftest.py` au niveau racine ou dans
  `pyproject.toml` (section `[tool.pytest.ini_options]`).

Fichiers concernés :
- `tests/integration/conftest.py` (créer)
- `pyproject.toml` (ajouter `[tool.pytest.ini_options]` avec `testpaths` et markers)

Dépendances : aucune.

Vérification : `pytest tests/integration/ --collect-only` — tous les tests apparaissent,
marqués `SKIPPED` si les modèles sont absents.

---

#### Tâche 1.1 — Tests d'intégration `Ct2Translator`
**Complexité : M**

Ce qu'il faut faire : tester `ct2_mt.py` avec les vrais modèles opus-mt en-fr et fr-en.

Points de risque identifiés dans `ct2_mt.py` :
- La phrase de chauffe (`translate_batch(["Hello."] if src == "en" else ["Bonjour."], ...)`)
  doit s'exécuter sans erreur et ne pas être comptabilisée dans la latence.
- Le tokeniseur SentencePiece charge `source.spm` + `target.spm` depuis le répertoire du
  modèle — vérifier que `_pull_mt` les copie bien (`--copy_files source.spm target.spm`
  dans la commande `ct2-transformers-converter` de `pull.py`).
- L'API `ctranslate2.Translator` : vérifier que `inter_threads` et `intra_threads` sont
  valides sur la version installée (≥ 4.4).

Cas de test à couvrir dans `tests/integration/test_ct2_mt.py` :
1. `@skip_mt` — Chargement réussi (pas d'exception, `model.bin` présent).
2. `@skip_mt` — Traduction EN→FR d'une phrase simple : sortie non vide, ne contient pas
   le texte source, contient au moins un mot français attendu.
3. `@skip_mt` — Traduction FR→EN : symétrie.
4. `@skip_mt` — Traduction par lot (`translate_batch` avec 3 phrases) : 3 sorties.
5. `@skip_mt` — Mesure de latence : warmup compris dans le `__init__`, première vraie
   traduction < 5 s sur CPU (seuil large pour CI).
6. Sans modèle (répertoire vide) : `EngineUnavailable` levée avec `key="err.model_mt"`.
7. Sans librairie (import manquant simulé avec `unittest.mock.patch`) : `EngineUnavailable`
   levée avec `key="err.dep"`.

Fichiers concernés :
- `tests/integration/test_ct2_mt.py` (créer)

Dépendances : Tâche 1.0 terminée.

Vérification : `pytest tests/integration/test_ct2_mt.py -v` — 5 tests PASSED si modèles
présents, 2 PASSED + 5 SKIPPED sinon.

---

#### Tâche 1.2 — Tests d'intégration `WhisperRecognizer`
**Complexité : M**

Ce qu'il faut faire : tester `whisper_stt.py` avec le vrai modèle Whisper.

Points de risque identifiés dans `whisper_stt.py` :
- `model.detect_language(audio)` retourne depuis faster-whisper ≥ 1.1 un tuple à 2 ou 3
  éléments selon la version — le code gère déjà ce cas (`if len(res) > 2`), mais le vérifier.
- `model.transcribe(audio, language=..., ...)` : vérifier que les paramètres `best_of=1`,
  `condition_on_previous_text=False` sont toujours valides sur faster-whisper ≥ 1.1.
- Le chemin `float32 / 32768.0` de `_audio()` : vérifier sur un signal court (0.3 s) qu'il
  ne produit pas de NaN (division par zéro si PCM vide).
- Détection de langue : le code contraint à `self.languages` — vérifier que la probabilité
  rapportée est cohérente (≥ 0 et ≤ 1).

Cas de test dans `tests/integration/test_whisper_stt.py` :
1. `@skip_stt` — Chargement réussi (instance créée sans exception).
2. `@skip_stt` — `transcribe(tone_en, "en", final=True)` → texte non vide (ne peut pas
   matcher exactement mais ne doit pas lever d'exception).
3. `@skip_stt` — `transcribe(silence, None, final=True)` → texte vide ou `is_hallucination`.
4. `@skip_stt` — `detect(tone_en)` → langue dans `PAIR`, prob ∈ [0, 1].
5. `@skip_stt` — PCM très court (100 ms) → ne plante pas.
6. `@skip_stt` — Passe provisoire `final=False` → renvoie `RecResult` avec `text`.
7. Sans modèle : `EngineUnavailable` avec `key="err.model_stt"`.
8. Sans librairie : `EngineUnavailable` avec `key="err.dep"`.

Note : pour produire un signal reconnaissable, utiliser le même WAV synthétique que
`make_fake_mic.py` (sinusoïde 440 Hz) ou enregistrer une phrase test en bytes constant.
Accepter toute sortie non vide pour le test de transcription.

Fichiers concernés :
- `tests/integration/test_whisper_stt.py` (créer)

Dépendances : Tâche 1.0 terminée.

Vérification : `pytest tests/integration/test_whisper_stt.py -v`

---

#### Tâche 1.3 — Tests d'intégration `PiperSynthesizer`
**Complexité : M**

Points de risque identifiés dans `piper_tts.py` :
- `SynthesisConfig` : l'import conditionnel (`try: from piper import SynthesisConfig`) gère
  les vieilles versions, mais il faut vérifier que `chunk.audio_int16_bytes` existe bien sur
  la version courante de `piper-tts ≥ 1.3`. L'attribut `sample_rate` sur `chunk` n'existe
  que depuis piper-tts 1.2+ — le code lit aussi `v.config.sample_rate` comme fallback, le
  vérifier.
- La boucle `for chunk in v.synthesize(text, **kwargs)` : vérifier qu'elle s'itère au moins
  une fois et que les chunks sont non vides.
- Le `_lock` threading : vérifier le comportement quand deux `synth()` sont appelés en
  parallèle sur la même instance (simulation avec `concurrent.futures.ThreadPoolExecutor`).

Cas de test dans `tests/integration/test_piper_tts.py` :
1. `@skip_piper` — Chargement réussi (au moins une voix EN ou FR installée).
2. `@skip_piper` — `voices("en")` → liste non vide avec `id`, `lang`, `label`.
3. `@skip_piper` — `synth("Hello.", "en", voix_en, 1.0)` → `(pcm_bytes, sr_int)` avec
   `len(pcm_bytes) > 0` et `sr_int > 0`.
4. `@skip_piper` — `synth("Bonjour.", "fr", voix_fr, 1.0)` → non vide.
5. `@skip_piper` — Rate 0.5 : durée audio ~2× plus longue qu'à rate 1.0.
6. `@skip_piper` — Voix inconnue → repli sur première voix disponible (pas d'exception).
7. `@skip_piper` — Appels parallèles (2 threads) → pas de corruption (PCM valides séparément).
8. Aucune voix installée → `EngineUnavailable` avec `key="err.model_tts"`.
9. Sans librairie → `EngineUnavailable` avec `key="err.dep"`.

Fichiers concernés :
- `tests/integration/test_piper_tts.py` (créer)

Dépendances : Tâche 1.0 terminée.

Vérification : `pytest tests/integration/test_piper_tts.py -v`

---

#### Tâche 1.4 — Tests d'intégration `KokoroSynthesizer`
**Complexité : M**

Points de risque identifiés dans `kokoro_tts.py` :
- `kokoro-onnx` version ≥ 0.4 : l'API `Kokoro(model, voices)` puis `k.create(text, voice=, speed=, lang=)` doit être vérifiée — l'argument `lang` utilise `KOKORO[lang]` (`"en-us"` / `"fr-fr"`) depuis `langs.py`.
- `samples, sr = self.k.create(...)` : `samples` est un `np.ndarray` float32. La conversion
  `np.clip * 32767.0).astype("<i2")` doit produire un tableau valide même si `samples` est vide.
- Les URLs de téléchargement dans `models.json` (GitHub Releases de `thewh1teagle/kokoro-onnx`)
  sont les moins confirmées du projet — tester explicitement que les fichiers `kokoro-v1.0.onnx`
  et `voices-v1.0.bin` sont bien téléchargeables et intègres avant d'instancier le moteur.

Cas de test dans `tests/integration/test_kokoro_tts.py` :
1. `@skip_kokoro` — Chargement (`Kokoro(model_path, voices_path)`) sans exception.
2. `@skip_kokoro` — `voices("en")` → 3 voix (af_heart, am_michael, bf_emma).
3. `@skip_kokoro` — `voices("fr")` → 1 voix (ff_siwis).
4. `@skip_kokoro` — `synth("Hello.", "en", "af_heart", 1.0)` → `(pcm_bytes, sr_int)` non vide.
5. `@skip_kokoro` — `synth("Bonjour.", "fr", "ff_siwis", 1.0)` → non vide.
6. `@skip_kokoro` — Voix inconnue → repli sur première voix disponible.
7. Fichiers modèle absents → `EngineUnavailable` avec `key="err.model_kokoro"`.
8. Sans librairie → `EngineUnavailable` avec `key="err.dep"`.

Note supplémentaire : documenter dans le test la URL Kokoro testée, pour faciliter le
diagnostic si les URLs changent de version.

Fichiers concernés :
- `tests/integration/test_kokoro_tts.py` (créer)

Dépendances : Tâche 1.0 terminée.

Vérification : `pytest tests/integration/test_kokoro_tts.py -v`

---

#### Tâche 1.5 — Test de pipeline complet avec vrais moteurs
**Complexité : M**

Ce qu'il faut faire : tester la chaîne STT → MT → TTS avec les vrais moteurs, en condition
proche de la production. Ce test réutilise `Harness` de `test_session.py` mais avec
`engines="real"` et la présence effective des modèles.

Cas de test dans `tests/integration/test_pipeline.py` :
1. `@skip_mt @skip_stt @skip_piper` — Pipeline micro→traduction→voix : un PCM de 2 s
   (sinusoïde + silence) → STT produit un texte non vide → MT traduit → TTS produit de
   l'audio. Mesurer et logger les latences STT/MT/TTS séparément (pas d'assertion de
   performance, juste journalisation pour `relais doctor`).
2. `@skip_mt` — Traduction EN→FR d'une phrase connue via l'API `TranslationService` :
   comparer avec la traduction attendue à ±1 mot (tolérance d'ordre de mots).
3. `@skip_asgi` (Starlette + uvicorn présents) — Démarrage du serveur ASGI, connexion
   WebSocket, roundtrip `hello` → `state`. Complète le test `asgi.py` qui n'est jamais
   testé actuellement.

Fichiers concernés :
- `tests/integration/test_pipeline.py` (créer)

Dépendances : Tâches 1.1 à 1.4 terminées (les moteurs individuels validés d'abord).

Vérification : `pytest tests/integration/test_pipeline.py -v`

---

#### Tâche 1.6 — Couverture des chemins d'erreur réseau dans `pull.py`
**Complexité : S**

Ce qu'il faut faire : ajouter des tests unitaires (sans réseau) sur `pull.py`.

Points non testés actuellement :
- `_download()` avec URL injoignable → exception capturée, pas de fichier `.part` résiduel.
- `_download()` avec réponse HTTP 404 → le fichier `.part` est créé puis supprimé par
  l'appelant lors de la levée d'exception.
- `_pull_mt()` sans `ct2-transformers-converter` dans le PATH → message d'erreur correct.
- `_pull_stt()` sans `faster_whisper` importable → message d'erreur correct.
- `_pull_kokoro()` avec URL retournant du HTML (erreur CDN) → `_download` écrit le HTML
  mais aucune vérification d'intégrité n'est faite (**bug potentiel** : contrairement à
  `_pull_fonts` qui vérifie le magic bytes `wOF2`, `_pull_kokoro` et `_pull_mt` ne
  vérifient pas l'intégrité du fichier téléchargé).

Action corrective à envisager dans `pull.py` :
- Ajouter une vérification du magic bytes des fichiers `.onnx` (signature ONNX : `\x08`,
  ou vérifier taille minimale) après téléchargement dans `_pull_kokoro` et `_pull_piper`.

Fichiers concernés :
- `tests/test_pull.py` (créer, tests unitaires avec `unittest.mock.patch`)
- `relais/pull.py` (vérifications d'intégrité optionnelles)

Dépendances : Tâche 1.0.

Vérification : `pytest tests/test_pull.py -v` — tous les tests PASSED sans réseau.

---

### Ordre d'exécution recommandé pour Axe 1

```
1.0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
```

`1.1` avant `1.2` car la traduction est plus rapide à valider (pas d'audio). `1.3` avant
`1.4` car Piper est la valeur par défaut. `1.5` nécessite les 4 moteurs validés. `1.6` est
indépendant et peut se faire en parallèle de `1.1`–`1.4`.

---

## Axe 2 — Gestion multi-utilisateurs

### Contexte technique

**État actuel :** l'architecture est déjà partiellement multi-sessions :
- `Hub.sessions: set` contient toutes les sessions WebSocket connectées.
- `Hub.broadcast()` diffuse à toutes.
- Les `ThreadPoolExecutor` (`stt`, `mt`, `tts`, 1 thread chacun) sont **partagés**.
- `SettingsStore`, `GlossaryStore`, `HistoryStore`, `RecordingStore` sont **globaux** avec
  des `threading.Lock` internes.

**Ce qui est uniquement session-unique :**
- Il n'y a qu'un seul `SettingsStore` → tous les utilisateurs partagent les mêmes réglages.
- `Registry` (et ses moteurs) est unique → une seule instance de Whisper en mémoire.
- Pas d'identification : n'importe quel onglet peut modifier les réglages de tout le monde.

**Modèle cible recommandé : salon (room)**

La Phase 2 du ROADMAP décrit les "salons" (chacun sur son appareil). L'approche
multi-utilisateurs s'y intègre naturellement : chaque salon a ses propres réglages, mais
les **modèles IA restent partagés** (trop lourds pour être dupliqués).

### Architecture recommandée

```
RelaisApp (singleton)
├── ThreadPoolExecutor stt/mt/tts/load  ← partagés
├── Registry + moteurs IA               ← partagés (lecture seule par session)
├── rooms: dict[str, Room]              ← nouveau
│   ├── Room("default")                 ← salle par défaut (session unique actuelle)
│   │   ├── SettingsStore               ← isolé par salle
│   │   ├── ProfileStore               ← isolé par salle
│   │   ├── GlossaryStore              ← isolé par salle
│   │   ├── HistoryStore               ← isolé par salle
│   │   └── Hub (sessions de la salle) ← isolé par salle
│   └── Room("ABC123")                 ← salle créée par une URL ?room=ABC123
└── RecordingStore                      ← global (bibliothèque partageable)
```

### Tâches ordonnées

---

#### Tâche 2.0 — Définir le modèle de session ID dans le protocole WebSocket
**Complexité : S**

Ce qu'il faut faire : choisir et documenter le mécanisme d'identification.

**Décision recommandée : identifiant de salle dans l'URL WebSocket.**

- URL actuelle : `ws://localhost:8765/ws`
- URL multi-utilisateurs : `ws://localhost:8765/ws?room=XXXXXX`
- Si `room` absent → salle `"default"` (rétrocompatibilité totale).
- Un `room` est un code alphanumérique de 6 caractères généré par le client ou choisi par
  l'utilisateur. Pas d'authentification forte à ce stade (usage réseau local).

Pas de modification de code à cette étape : c'est une décision de design à valider.

Fichiers concernés :
- `relais/core/session.py` (en-tête de documentation à mettre à jour)
- `relais/servers/asgi.py` (extraction du paramètre `room` à prévoir)

Dépendances : aucune.

---

#### Tâche 2.1 — Extraire `Room` de `RelaisApp`
**Complexité : L**

Ce qu'il faut faire : créer une classe `Room` qui encapsule les données per-session
(réglages, stockage, hub) et modifier `RelaisApp` pour gérer un dict de `Room`.

Fichiers à modifier :
- `relais/core/app.py` :
  - Créer classe `Room(room_id: str, paths: Paths, schema: Schema)` avec ses propres
    `SettingsStore`, `ProfileStore`, `GlossaryStore`, `HistoryStore`, `Hub`.
  - `RelaisApp` conserve `RecordingStore` global, pools, `factory`, `security`.
  - Ajouter `rooms: dict[str, Room]` et `get_or_create_room(room_id: str) -> Room`.
  - `RelaisApp.snapshot()` reste mais prend `room_id` en paramètre.
  - Les chemins disque : `~/.relais/rooms/<room_id>/settings.json`, `.../history.jsonl`, etc.

- `relais/core/session.py` :
  - `Session.__init__(app, send, room_id: str = "default")`.
  - Toutes les références à `self.app.settings`, `self.app.glossary`, `self.app.history`,
    `self.app.hub` → `self.room.settings`, `self.room.glossary`, etc.
  - `self.room = app.get_or_create_room(room_id)`.

- `relais/servers/asgi.py` :
  - Extraire `room_id = ws.query_params.get("room", "default")` avant de créer `Session`.
  - Passer `room_id` à `Session(app, send, room_id)`.

- `relais/servers/stdlib.py` :
  - Extraire `room_id` de la query string de l'URL WebSocket.
  - Passer à `Session`.

Dépendances : Tâche 2.0.

Vérification : `pytest tests/test_session.py tests/test_core.py -v` — tous les tests
PASSED (rétrocompatibilité totale avec room_id="default").

---

#### Tâche 2.2 — Adapter le protocole WebSocket côté client
**Complexité : S**

Ce qu'il faut faire : le client doit transmettre son `room_id` dans l'URL WebSocket.

Fichiers à modifier :
- `relais/web/js/ws.js` :
  - `constructor(path = '/ws', roomId = null)`.
  - Si `roomId`, l'URL devient `/ws?room=${roomId}`.
  - `roomId` est null par défaut (salle "default").

- `relais/web/js/app.js` :
  - Lire `roomId` depuis un paramètre URL (`?room=XXXX`) ou laisser null.
  - Passer à `new Link('/ws', roomId)`.

- `relais/web/index.html` :
  - Pas de modification : la salle par défaut est transparente.

Dépendances : Tâche 2.1.

Vérification : ouvrir deux onglets avec des `?room=` différents — chaque onglet a ses
propres réglages indépendants (vérifiable manuellement).

---

#### Tâche 2.3 — Partage des modèles IA entre salles
**Complexité : M**

Ce qu'il faut faire : s'assurer que les moteurs IA ne sont chargés qu'**une seule fois**
même si plusieurs salles les activent simultanément.

État actuel : `Registry` et `EngineFactory` sont dans `RelaisApp` (un seul). Si on ajoute
des `Room`, chacune ne doit **pas** avoir son propre `Registry`. Le `Registry` reste global.

Conséquence sur le design :
- `Registry.set_enabled(cap_id, on)` est appelé depuis les messages `cap` de chaque session.
  Actuellement, toutes les salles partageraient le même état on/off des caps.
- **Décision recommandée** : les caps restent globaux (un seul Whisper en mémoire, une seule
  décision d'activation). Chaque salle a ses propres *préférences de réglages* (voix, modèle
  choisi, etc.) mais l'activation physique est partagée.
- Implication : si la salle A active l'écoute et que la salle B ne l'a pas activée, la salle B
  peut quand même utiliser l'écoute via `registry.engine("listen")`. C'est le comportement
  multi-onglets actuel étendu.

Fichiers à modifier :
- `relais/core/session.py` :
  - Les messages `cap` {id, on} continuent d'aller dans `self.app.registry.set_enabled()`.
  - `self.room.settings.patch({"caps.on": ...})` pour persister l'état par salle.

- `relais/core/registry.py` :
  - `_persist()` : actuellement écrit dans `app.settings`. Passer à une callback injectable
    ou à `app.settings` en tant que "réglages partagés" distincts des réglages par salle.

Dépendances : Tâches 2.1.

Vérification : `pytest tests/test_session.py -v` + test manuel avec 2 connexions WebSocket.

---

#### Tâche 2.4 — Limites et quotas par session
**Complexité : M**

Ce qu'il faut faire : protéger le serveur contre l'abus quand plusieurs utilisateurs
utilisent les ressources partagées en même temps.

Limites à implémenter :

**2.4a — Limite du nombre de salles actives simultanées**
- `RelaisApp.MAX_ROOMS = 10` (configurable).
- `get_or_create_room()` lève `TooManyRooms` si la limite est atteinte.
- Retourner HTTP 503 côté `asgi.py` / `stdlib.py` si `TooManyRooms`.

**2.4b — Limite du nombre de sessions par salle**
- `Room.MAX_SESSIONS = 4` (deux personnes × quelques onglets).
- `Hub.add()` vérifie la limite.

**2.4c — Nettoyage des salles inactives**
- Une salle vide depuis `ROOM_TTL = 3600 s` est supprimée (GC asyncio dans `RelaisApp`).
- Les fichiers disque de la salle sont conservés (l'utilisateur revient avec le même room_id).

**2.4d — Rate limiting des inférences**
- Le pool `stt` à 1 thread sérialise déjà les inférences. Avec N salles, la latence par
  utilisateur augmente de N×. Documenter cette limite explicitement dans `README.md`.
- Option future : passer à un pool de 2 threads `stt` si une machine a suffisamment de RAM.

Fichiers concernés :
- `relais/core/app.py` (MAX_ROOMS, get_or_create_room, GC asyncio)
- `relais/servers/asgi.py` (gestion TooManyRooms → 503)
- `relais/servers/stdlib.py` (idem)
- `README.md` (documenter les limites de concurrence)

Dépendances : Tâche 2.1.

Vérification : `pytest tests/test_session.py tests/test_core.py -v` + test de charge
manuel avec `ab` ou `wrk`.

---

#### Tâche 2.5 — Tests multi-sessions
**Complexité : M**

Ce qu'il faut faire : écrire les tests d'intégration pour la multi-session.

Cas de test à ajouter dans `tests/test_session.py` ou un nouveau `tests/test_multiroom.py` :
1. Deux salles avec des réglages différents → les `patch` sont isolés.
2. Une salle active l'écoute → le moteur est partagé, l'autre salle peut l'utiliser.
3. Broadcast : un message envoyé par la salle A n'arrive pas dans la salle B.
4. Déconnexion de toutes les sessions d'une salle → salle nettoyée après TTL.
5. Dépassement de `MAX_ROOMS` → 503.

Fichiers concernés :
- `tests/test_multiroom.py` (créer)

Dépendances : Tâches 2.1 à 2.4.

Vérification : `pytest tests/test_multiroom.py -v` — tous les tests PASSED.

---

### Ordre d'exécution recommandé pour Axe 2

```
2.0 → 2.1 → 2.3 → 2.2 → 2.4 → 2.5
```

`2.1` est le gros morceau (refactoring de `RelaisApp` + `Session`). `2.3` clarifie comment
le `Registry` partagé interagit avec les salles, doit être conçu en même temps que `2.1`.
`2.2` (côté JS) dépend de `2.1`. `2.4` et `2.5` sont les filets de sécurité.

---

## Axe 3 — CI/CD

### Contexte technique

- Aucun fichier `.github/`, `.gitlab-ci.yml`, ou `Makefile` CI n'existe.
- Commandes de test connues : `pytest tests/` (Python), `node --test tests/js/` (JS),
  `node tests/e2e/browser.cjs` (E2E Playwright).
- Dépendances lourdes : modèles IA (~1,1 Go pour mt+stt+piper-default), jamais dans le repo.
- Le flag `--engines mock` permet de tout tester sans aucun modèle.
- **Système recommandé : GitHub Actions**, le repo étant local mais la structure est
  standard pour une migration future. Sinon, adapter les mêmes étapes pour GitLab CI.

### Stratégie pour les modèles IA

Les modèles ne doivent jamais être téléchargés à chaque run CI :
- Utiliser `actions/cache@v4` avec clé basée sur `relais/data/models.json` (hash du manifeste).
- Le cache est maintenu dans l'environnement GitHub Actions (jusqu'à 10 Go par repo).
- Les tests d'intégration (Axe 1) s'exécutent **seulement** si le cache est chaud
  (flag `--run-integration` ou variable d'environnement `RELAIS_INTEGRATION=1`).
- Ajouter un workflow séparé "integration-nightly" déclenché par `schedule: cron` qui
  reconstruit le cache et lance les tests d'intégration.

### Tâches ordonnées

---

#### Tâche 3.0 — Préparer le projet pour la CI
**Complexité : S**

Ce qu'il faut faire : s'assurer que les commandes de test sont reproductibles.

- Ajouter dans `pyproject.toml` :
  ```toml
  [tool.pytest.ini_options]
  testpaths = ["tests"]
  markers = [
    "integration: tests nécessitant les vrais modèles IA",
  ]
  addopts = "--ignore=tests/integration -q"
  ```
  Ainsi, `pytest` sans arguments lance uniquement les tests unitaires (pas d'intégration).
  Les tests d'intégration se lancent avec `pytest tests/integration/ -m integration`.

- Vérifier que `node --test tests/js/pure.test.mjs` fonctionne avec Node 20+ (actuellement
  testé manuellement via `run.sh`).

- Ajouter un `Makefile` minimal :
  ```makefile
  test-py:
      pytest tests/ -q
  test-js:
      node --test tests/js/pure.test.mjs
  test-e2e:
      bash tests/e2e/run.sh
  test-all: test-py test-js
  lint:
      python -m py_compile relais/**/*.py
  ```

Fichiers concernés :
- `pyproject.toml` (ajouter `[tool.pytest.ini_options]`)
- `Makefile` (créer)

Dépendances : aucune.

Vérification : `make test-py` + `make test-js` → exitcode 0.

---

#### Tâche 3.1 — Workflow CI principal : lint + tests unitaires
**Complexité : S**

Ce qu'il faut faire : créer le workflow GitHub Actions principal.

Fichier à créer : `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, "feat/**"]
  pull_request:
    branches: [main]

jobs:
  python:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Installer le projet
        run: pip install -e ".[dev]"
      - name: Lint (compilation)
        run: python -m py_compile $(find relais -name "*.py" | tr '\n' ' ')
      - name: Tests Python
        run: pytest tests/ -q --tb=short

  javascript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Tests JavaScript
        run: node --test tests/js/pure.test.mjs
```

Note sur la matrice Python : Python 3.10 (version minimale du projet selon `pyproject.toml`)
et 3.12 (dernière stable). Python 3.11 peut être ajouté si des régressions sont identifiées.

Fichiers concernés :
- `.github/workflows/ci.yml` (créer)

Dépendances : Tâche 3.0.

Vérification : pousser une branche → GitHub Actions passe au vert (0 dépendances IA
requises, tout tourne avec `engines="mock"`).

---

#### Tâche 3.2 — Workflow CI E2E : tests Playwright (optionnel)
**Complexité : M**

Ce qu'il faut faire : ajouter une étape E2E dans la CI, conditionnelle.

Les tests E2E dans `tests/e2e/browser.cjs` utilisent Playwright + Chromium + un faux micro.
Ils nécessitent un environnement Linux avec display (ou `--no-sandbox`).

```yaml
# Ajout dans ci.yml ou fichier séparé .github/workflows/e2e.yml
  e2e:
    runs-on: ubuntu-latest
    needs: [python, javascript]  # seulement si les autres passent
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: npm install -g playwright
      - run: npx playwright install chromium --with-deps
      - name: Générer le faux micro
        run: python tests/e2e/make_fake_mic.py /tmp/fake-mic.wav
      - name: Tests E2E
        run: PORT=8777 bash tests/e2e/run.sh
        timeout-minutes: 5
```

Points à adapter dans `run.sh` pour GitHub Actions :
- Remplacer `python3` par `python` (selon l'image).
- Ajouter `--no-sandbox` aux arguments Chromium (requis en environnement CI sans display).
  Passer via variable d'environnement ou argument à `browser.cjs`.
- Le script `run.sh` est Linux-only ; adapter pour Windows si nécessaire.

Fichiers concernés :
- `.github/workflows/e2e.yml` (créer, ou ajouter job dans `ci.yml`)
- `tests/e2e/run.sh` (ajouter support `--no-sandbox` / `CI=1`)
- `tests/e2e/browser.cjs` (injecter `--no-sandbox` si `process.env.CI`)

Dépendances : Tâche 3.1.

Vérification : workflow E2E passe au vert sur une PR test.

---

#### Tâche 3.3 — Workflow nightly : tests d'intégration avec cache modèles
**Complexité : M**

Ce qu'il faut faire : créer un workflow nocturne qui télécharge les modèles (avec cache),
puis exécute les tests d'intégration de l'Axe 1.

```yaml
# .github/workflows/integration.yml
name: Integration (nightly)
on:
  schedule:
    - cron: "0 3 * * *"  # 3h du matin UTC
  workflow_dispatch:       # déclenchement manuel possible

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Calculer la clé du cache modèles
        id: models_hash
        run: echo "hash=$(sha256sum relais/data/models.json | cut -d' ' -f1)" >> "$GITHUB_OUTPUT"
      - name: Cache modèles IA
        uses: actions/cache@v4
        with:
          path: ~/.relais/models
          key: relais-models-${{ steps.models_hash.outputs.hash }}
          restore-keys: relais-models-
      - name: Installer les dépendances
        run: pip install -e ".[all,dev]"
      - name: Télécharger les modèles (si cache absent)
        run: |
          python -m relais pull default --stt base || true
          # Kokoro est optionnel et lourd (340 Mo), skip en CI par défaut
      - name: Tests d'intégration
        run: pytest tests/integration/ -v --tb=short
        env:
          RELAIS_MODELS_DIR: ~/.relais/models
```

Note : `|| true` sur `relais pull` pour ne pas faire échouer la CI si un serveur upstream
est temporairement indisponible (HuggingFace, GitHub Releases).

Fichiers concernés :
- `.github/workflows/integration.yml` (créer)

Dépendances : Tâches 3.1 + 1.0–1.5 (les tests d'intégration doivent exister).

Vérification : déclenchement manuel → workflow passe avec modèles en cache.

---

#### Tâche 3.4 — Workflow build et packaging
**Complexité : S**

Ce qu'il faut faire : vérifier que le paquet `pip install` fonctionne depuis le repo.

```yaml
  build:
    runs-on: ubuntu-latest
    needs: [python]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install build
      - run: python -m build --wheel --outdir dist/
      - name: Vérifier l'installabilité
        run: pip install dist/*.whl && python -c "import relais; print(relais.__version__)"
      - uses: actions/upload-artifact@v4
        with:
          name: relais-wheel
          path: dist/*.whl
```

Note : le `pyproject.toml` utilise `setuptools` comme build backend avec `package-data`
incluant `web/`, `data/`. Vérifier que le wheel contient bien ces fichiers.

Fichiers concernés :
- `.github/workflows/ci.yml` (ajouter le job `build`)

Dépendances : Tâche 3.1.

Vérification : artefact wheel téléchargeable depuis l'interface GitHub Actions.

---

### Ordre d'exécution recommandé pour Axe 3

```
3.0 → 3.1 → 3.4 → 3.2 → 3.3
```

`3.0` (Makefile + pyproject) en premier pour que la CI ait des commandes stables. `3.1`
(tests unitaires) doit passer avant d'ajouter les autres. `3.4` (build) simple, peu de
risque. `3.2` (E2E) plus complexe à stabiliser en CI. `3.3` (intégration nightly) dépend
de l'Axe 1.

---

## Tableau récapitulatif

| Tâche | Description | Fichiers principaux | Complexité | Dépendances |
|-------|-------------|---------------------|------------|-------------|
| 1.0   | conftest.py intégration | `tests/integration/conftest.py`, `pyproject.toml` | S | — |
| 1.1   | Tests Ct2Translator | `tests/integration/test_ct2_mt.py` | M | 1.0 |
| 1.2   | Tests WhisperRecognizer | `tests/integration/test_whisper_stt.py` | M | 1.0 |
| 1.3   | Tests PiperSynthesizer | `tests/integration/test_piper_tts.py` | M | 1.0 |
| 1.4   | Tests KokoroSynthesizer | `tests/integration/test_kokoro_tts.py` | M | 1.0 |
| 1.5   | Pipeline complet réel | `tests/integration/test_pipeline.py` | M | 1.1–1.4 |
| 1.6   | Tests pull.py erreurs réseau | `tests/test_pull.py`, `relais/pull.py` | S | 1.0 |
| 2.0   | Design room_id dans URL WS | (doc) | S | — |
| 2.1   | Classe Room + refactoring app | `relais/core/app.py`, `session.py`, `asgi.py`, `stdlib.py` | L | 2.0 |
| 2.2   | ws.js adapté room_id | `relais/web/js/ws.js`, `app.js` | S | 2.1 |
| 2.3   | Registry partagé entre salles | `relais/core/registry.py`, `app.py` | M | 2.1 |
| 2.4   | Limites et quotas | `relais/core/app.py`, serveurs | M | 2.1 |
| 2.5   | Tests multi-sessions | `tests/test_multiroom.py` | M | 2.1–2.4 |
| 3.0   | pyproject.toml + Makefile | `pyproject.toml`, `Makefile` | S | — |
| 3.1   | Workflow CI principal | `.github/workflows/ci.yml` | S | 3.0 |
| 3.2   | Workflow E2E Playwright | `.github/workflows/e2e.yml`, `tests/e2e/run.sh` | M | 3.1 |
| 3.3   | Workflow nightly intégration | `.github/workflows/integration.yml` | M | 3.1, 1.0–1.5 |
| 3.4   | Workflow build wheel | `.github/workflows/ci.yml` | S | 3.1 |

---

## Points d'attention transversaux

### Licence GPL-3.0

`piper-tts` et `kokoro-onnx` (via `phonemizer-fork`) sont GPL-3.0. Les tests d'intégration
(Axe 1) qui importent ces librairies héritent de cette contrainte pour la distribution du
code de test. Les CI publiques (GitHub Actions sur repo public) sont concernées.
**Recommandation** : les tests d'intégration Piper/Kokoro restent en skip par défaut.

### Compatibilité Windows

Le projet vise l'usage local. `run.sh` et les scripts CI utilisent des commandes Bash.
Pour la CI Windows (si nécessaire), utiliser `actions/setup-python` sur `windows-latest`
et adapter les chemins.

### Absence de type checker / linter

Il n'y a pas de `mypy`, `ruff` ou `flake8` configuré. La CI en Axe 3 propose uniquement
`py_compile` (syntaxe) comme lint minimal. Ajouter `ruff` dans `[project.optional-dependencies]`
dev serait un complément simple : `ruff check relais/`.

### Documentation des modèles Kokoro

Les URLs GitHub Releases dans `models.json` pour Kokoro (`thewh1teagle/kokoro-onnx`) sont
les moins stables du projet. Prévoir un test dans `tests/integration/test_kokoro_tts.py`
qui vérifie la joignabilité des URLs avant de tenter le téléchargement.

---

*Fin du plan de développement.*
