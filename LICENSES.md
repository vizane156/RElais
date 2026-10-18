# Licences

Ceci est un relevé pratique, **pas un avis juridique**. Vérifie la licence de chaque composant au moment de choisir ce que tu distribues.

## Le code de Relais

Aucune licence n'a été choisie : c'est ton projet, à toi de décider (MIT, Apache-2.0, GPL…). Si tu distribues un logiciel qui embarque Piper (ci-dessous), ce choix en dépend.

## Dépendances et modèles

| Composant | Licence | À savoir |
|---|---|---|
| CTranslate2, SentencePiece | MIT, Apache-2.0 | Sans contrainte particulière. |
| faster-whisper, modèles Whisper | MIT | Sans contrainte particulière. |
| Modèles de traduction opus-mt (Helsinki-NLP) | CC-BY-4.0 | Attribution requise si tu redistribues les modèles. |
| **Piper (`piper-tts`)** | **GPL-3.0** | Le dépôt actuel est sous GPL-3.0. Pas de problème pour un usage local ; distribuer une application qui l'embarque t'oblige à publier le code de l'ensemble sous GPL. |
| Voix Piper | variable | **Chaque voix a sa propre licence** (fiche du modèle sur Hugging Face). Vérifie avant tout usage commercial. |
| **Kokoro (`kokoro-onnx`)** | modèle Apache-2.0 | Le paquet tire `phonemizer-fork`, sous **GPL-3.0**. |
| Polices Literata, Atkinson Hyperlegible Next | SIL OFL 1.1 | Libres d'usage et de redistribution. |

## Choix de conception liés aux licences

Relais **n'importe jamais** Piper ni Kokoro tant que la fonction « Voix » n'est pas activée, et les moteurs sont isolés derrière une interface (`engines/base.py`) : remplacer Piper par un moteur sous licence plus permissive se fait en écrivant une classe, sans toucher au reste.
