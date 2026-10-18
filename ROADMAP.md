# Feuille de route

## Phase 1 — Socle (livrée)

Traduction EN↔FR dans les deux sens, reconnaissance et synthèse vocales dans les deux langues, conversation en direct sur un seul appareil (micro partagé, langue détectée à chaque phrase), parler en tapant, fonctions activables à tout moment, personnalisation sans code (schéma, profils, glossaire, apparence), interface bilingue, bibliothèque vocale (enregistrer, téléverser), historique, mode démo, diagnostic de latence.

**Premier travail pour toi, sur ta machine :** `relais pull` puis `relais doctor`. C'est la seule façon de valider les vrais moteurs et de connaître la latence réelle. Les seuls points d'accroche sont les quatre fichiers de `relais/engines/` ; un problème d'API s'y corrige en quelques lignes.

## Phase 2 — Conversation à deux appareils, qualité du direct

- **Salons.** Chacun sur son appareil, dans sa langue : A parle anglais, B entend du français, et inversement. Le protocole est déjà organisé en côtés et en sessions ; il manque un salon qui relie deux sessions. **Prérequis : HTTPS** (le navigateur refuse le micro hors `localhost` en HTTP), par exemple avec un certificat local `mkcert`.
- **Sortie vers un appel.** Choisir un câble audio virtuel comme sortie (déjà réglable) pour que la voix de synthèse parte dans Meet, Zoom ou Teams.
- **Détection de parole plus fine.** Remplacer le détecteur à énergie par un modèle (Silero VAD) pour les environnements bruyants.
- **Reconnaissance en continu.** Aujourd'hui : un passage provisoire toutes les ~0,55 s sur la phrase en cours. À améliorer avec une stratégie de stabilisation des mots (accord entre passages successifs) pour réduire le scintillement.
- **Autres langues.** La paire est une donnée (`core/langs.py` + manifeste de modèles) ; l'ajout d'une troisième langue demande surtout des modèles et un sélecteur de paire.
- **Application de bureau.** L'interface est statique : l'envelopper dans Tauri est direct.

## Phase 3 — Voix clonée

**Objectif.** Enregistrer ou téléverser sa voix, puis parler avec une voix générée à partir d'elle : ce qu'on tape est dit à voix haute, mot après mot, avec le naturel d'une personne.

**Déjà en place.** Bibliothèque d'échantillons (enregistrement et téléversement, WAV 16 bits), langue étiquetée, option « garder mes phrases captées », interface `Synthesizer` à laquelle un moteur de clonage s'ajoute sans toucher au reste, et le chemin « parler en tapant » (découpage, annulation, lecture sans trou).

**À construire.**
1. Un moteur `Synthesizer` capable d'une voix de référence (`synth(text, lang, voice, rate)` reçoit déjà un identifiant de voix : il désignera un échantillon de la bibliothèque).
2. **Choix du moteur — décision à prendre avec les licences sous les yeux.** Candidats à évaluer : XTTS-v2 (clonage en quelques secondes d'audio, anglais et français ; licence non commerciale), F5-TTS, OpenVoice, Chatterbox. Chacun a ses conditions : à vérifier au moment du choix. Critères : latence au premier son, qualité en français, licence, poids sur CPU.
3. **Latence.** Un clonage de qualité est nettement plus lent que Piper. Pour « mot après mot », prévoir un premier morceau très court dit avec la voix rapide, puis la voix clonée sur la suite, ou exiger un GPU.
4. **Garde-fous.** Le clonage ne doit servir qu'à **sa propre voix** (ou celle d'une personne consentante) : phrase de consentement lue à l'enregistrement, échantillons stockés uniquement en local, jamais envoyés, et mention claire dans l'interface quand une voix de synthèse parle.

## Limites connues

- Le micro partagé entre deux personnes dépend de la détection de langue : fiable en calme, à forcer (« Qui parle ») dans le bruit.
- La traduction travaille phrase par phrase : pas de mémoire du contexte entre phrases.
- Le glossaire protège des termes avec des jetons ; un modèle qui les abîme déclenche une retraduction sans protection (la phrase n'applique alors pas le glossaire).
- La couleur de langue choisie s'applique telle quelle en thème clair comme sombre ; les défauts, eux, sont adaptés à chaque thème.
