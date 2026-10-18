# Relais

Traducteur vocal bilingue **anglais ↔ français**, local, instantané.

Quelqu'un parle une langue : Relais l'écrit, le traduit et le dit à voix haute dans l'autre langue, dans les deux sens, en direct. On peut aussi **taper** et être traduit, ou taper et **être dit à voix haute au fil de la frappe**. Chaque fonction s'allume et s'éteint à tout moment, et tout se règle sans écrire une ligne de code.

Tout tourne sur ta machine : aucun compte, aucune API, aucune donnée qui sort.

> **État : phase 1.** Le socle complet est là et testé de bout en bout avec des moteurs simulés. Les vrais moteurs (traduction, reconnaissance, voix) sont branchés derrière les mêmes interfaces mais **n'ont pas pu être exécutés dans l'environnement où ce projet a été écrit** (pas de réseau, donc pas de modèles). Voir [« Ce qui est vérifié »](#ce-qui-est-vérifié) et [ROADMAP.md](ROADMAP.md).

---

## Essayer en 30 secondes (aucune installation)

```bash
python -m relais demo --open
```

Python 3.10+ suffit. Ça démarre l'interface avec des **moteurs simulés** (badge « Démo ») : ni vraie traduction ni vraie reconnaissance, mais toute la chaîne fonctionne, voix comprise. Allume Écoute, Traduction et Voix, autorise le micro, parle ; ou tape en bas.

## Installer pour de vrai

```bash
pip install -e ".[all]"          # serveur + traduction + reconnaissance + voix
pip install -e ".[convert]"      # uniquement pour la 1re conversion des modèles de traduction
relais pull                      # télécharge les modèles (~500 Mo) et les polices
relais doctor                    # vérifie tout et MESURE la latence sur ta machine
relais serve --open
```

`relais pull` accepte `mt`, `stt`, `tts`, `fonts`, `all`. Le modèle de reconnaissance se choisit avec `--stt tiny|base|small`, le moteur de voix avec `--tts piper|kokoro`. Une fois les modèles installés, tout fonctionne hors ligne.

Sans les polices (`relais pull fonts`) l'interface retombe sur des polices système proches : elle reste utilisable, mais moins soignée.

## Utilisation

| Touche du pupitre | Ce qu'elle fait |
|---|---|
| **Écoute** | Le micro détecte chaque phrase, la transcrit (texte provisoire en direct, puis définitif). |
| **Traduction** | Traduit dans l'autre langue, dans les deux sens. Aperçu pendant la frappe. |
| **Voix** | Lit les traductions à voix haute. Le micro se met en pause pendant la voix pour ne pas se réécouter. |
| **Parler en tapant** | Ce que tu tapes est dit à voix haute au fil de la frappe (par mots, groupes de mots ou phrases). |
| **Enregistrement** | Garde dans la bibliothèque l'audio de tes phrases captées. |
| **Voix clonée** | *Phase 3* : annoncée, volontairement non simulée. |

**Qui parle ?** « Auto » devine la langue de chaque phrase parmi les deux ; forcer une langue est plus fiable dans le bruit.

**Parler en tapant.** Choisis *Je tape en* et *Voix en* sous la conversation. Même langue : la voix dit ce que tu tapes. Langue différente : elle dit la traduction. Dire chaque mot isolément donne une voix hachée ; le rythme « par groupes de mots » (défaut) attend une ponctuation, une courte pause de frappe ou 9 mots. Entrée dit tout le reste.

**Bibliothèque vocale.** Enregistre ta voix (réécoute avant de garder), ou téléverse n'importe quel fichier audio : le navigateur le convertit lui-même en WAV, sans ffmpeg. Ces échantillons serviront au clonage de voix (phase 3).

## Personnaliser sans coder

- **Réglages.** L'écran est *généré* depuis `relais/data/schema.json`. Ajouter un réglage = ajouter un objet dans ce fichier (type, bornes, défaut, clé de texte) ; aucun code d'interface à écrire. Validation côté serveur : une valeur invalide est refusée, jamais appliquée.
- **Profils.** Instantanés nommés de tous les réglages (« Réunion », « Appel », « Voyage »…). Export / import en JSON.
- **Glossaire.** Termes à garder tels quels (« Relais », un nom de produit) ou à toujours traduire d'une façon précise. Technique : jetons opaques avant traduction, restitués après ; si le modèle abîme un jeton, le segment est retraduit sans protection plutôt que livré cassé.
- **Apparence.** Thème clair/sombre/auto, couleur de chaque langue, police et taille du texte, densité, animations (aucune / discrètes / complètes, et respect de « réduire les animations » du système), disposition face à face ou empilée.
- **Interface bilingue.** Français et anglais. Les textes sont dans `relais/web/i18n/` ; `python scripts/build_i18n.py` les génère depuis un seul tableau pour que les deux langues aient toujours les mêmes clés (un test le vérifie). Ajouter une langue d'interface = ajouter une colonne.
- **Deux langues, partout.** Le code raisonne en « côtés » a et b (`relais/core/langs.py`), jamais en « anglais » ou « français » en dur.

## Architecture

```
navigateur ──WebSocket──▶ Session ──▶ Registry (fonctions on/off, chargement des modèles)
   │  micro → détection de parole       │      ├─ Écoute     : faster-whisper (Whisper, int8)
   │  → PCM 16 kHz                      │      ├─ Traduction : CTranslate2 + opus-mt (int8) + cache + glossaire
   ◀── lecture sans trou ◀── PCM ───────┘      └─ Voix       : Piper  (ou Kokoro)
   └──HTTP──▶ Api : réglages · profils · glossaire · enregistrements · historique
```

- `relais/core/` : tout le cœur, **sans dépendance** (bibliothèque standard). Les moteurs réels sont les seules choses qui importent numpy & co, et seulement à l'activation.
- `relais/engines/` : trois contrats (`Translator`, `Recognizer`, `Synthesizer`), des moteurs réels, des moteurs simulés. Changer de moteur = écrire une classe.
- `relais/servers/` : deux adaptateurs minces. **Starlette/uvicorn** (recommandé) et un serveur **stdlib** sans dépendance (démo, tests, repli). Toute la logique est dans `Api` et `Session`, donc testée une seule fois.
- `relais/web/` : interface sans build (modules ES natifs, aucun framework, aucune dépendance). Ouvrir un fichier suffit à le modifier.

Les fonctions se chargent en arrière-plan (voyant qui clignote) et se **déchargent** à l'extinction pour libérer la mémoire (réglable). Un thread dédié par type de travail : reconnaissance et voix se chevauchent, mais jamais deux inférences du même type à la fois.

### Protocole WebSocket

JSON en texte. Client → serveur : `hello`, `cap {id,on}`, `set {patch}`, `tr {id,text,from,final,log,speak}`, `say {id,text,from,say}`, `speak {id,text,lang}`, `speak.cancel`, `ut.start/end/cancel`, `ping`. Serveur → client : `state`, `cap`, `settings`, `voices`, `stt`, `tr`, `said`, `speak.start/end/cancelled`, `rec`, `error` (avec clé de traduction). Audio : client → serveur `0x01` + PCM16 mono 16 kHz ; serveur → client `0x02`, id u32, seq u32, fréquence u32, drapeaux u8, puis PCM16. Détail dans l'en-tête de `relais/core/session.py`.

## Sécurité

Le serveur écoute sur `127.0.0.1` uniquement. Une WebSocket n'est pas soumise à la règle de même origine : sans garde-fou, n'importe quel site ouvert dans ton navigateur pourrait lire l'historique de tes conversations. Relais vérifie donc les en-têtes **Origin** (même origine exigée) et **Host** (contre le « DNS rebinding »), et sert l'interface avec une politique de sécurité de contenu stricte (aucun script ni style en ligne). Tout est couvert par des tests.

`--lan` ouvre le serveur au réseau local, mais le navigateur n'autorise **le micro que sur `localhost` ou en HTTPS** : depuis un autre appareil, il faudra du HTTPS (prévu en phase 2).

## Tests

```bash
python -m unittest discover -s tests -v         # 56 tests : cœur, session, HTTP, vrai serveur WebSocket
node --test tests/js/pure.test.mjs              # 22 tests : détection de parole, rééchantillonnage, frappe, WAV
bash tests/e2e/run.sh                             # 40 vérifications dans Chromium avec un faux micro
```

## Ce qui est vérifié

**Vérifié par exécution** : le protocole complet (fonctions, phrase captée → texte provisoire → texte final → traduction → voix → historique, saisie, parler en tapant, annulation), l'API HTTP (réglages, profils, glossaire, enregistrements avec requêtes `Range`, historique), la sécurité (traversée de chemin, Origin, Host), le serveur WebSocket (poignée de main, trames masquées, trames > 64 Ko), l'interface dans un vrai Chromium (micro simulé, lecture audio, réglages, thème, langue, bibliothèque, mobile), le comportement quand dépendances et modèles manquent. Ces tests ont trouvé et fait corriger de vrais bugs pendant l'écriture (sérialisation du serveur léger, fonctions sans moteur jamais considérées actives, fuite audio à la fermeture du micro, collision de styles).

**Écrit d'après la documentation, jamais exécuté** :
- les quatre moteurs réels (`ct2_mt.py`, `whisper_stt.py`, `piper_tts.py`, `kokoro_tts.py`) et `relais pull` : les API ont été vérifiées dans leur documentation, mais aucun modèle n'a pu être chargé. **Lance `relais doctor` en premier** : il charge chaque moteur, mesure la latence réelle et dit exactement ce qui manque.
- l'adaptateur Starlette (`servers/asgi.py`, ~60 lignes de liaison) ;
- les URL des polices et du modèle Kokoro (celles de Piper et des polices ont été confirmées par recherche, Kokoro non) ;
- le rendu avec les vraies polices (Literata, Atkinson Hyperlegible Next) : les captures ont été faites avec des polices de repli.

**Latence.** Aucune promesse chiffrée : elle dépend de ta machine. `relais doctor` mesure la traduction d'une phrase, la reconnaissance et le premier son de la voix sur la tienne.

## Licences

Voir [LICENSES.md](LICENSES.md). Point important : **Piper (paquet `piper-tts`) est sous GPL-3.0** et Kokoro tire une dépendance GPL-3.0. Sans conséquence pour un usage personnel ; à examiner avant de distribuer un logiciel qui les embarque.
