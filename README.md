# Relais

Traducteur vocal bilingue **anglais ↔ français**, local, instantané.

Quelqu'un parle une langue : Relais l'écrit, le traduit et le dit à voix haute dans l'autre langue, dans les deux sens, en direct. On peut aussi **taper** et être traduit, ou taper et **être dit à voix haute au fil de la frappe**. Chaque fonction s'allume et s'éteint à tout moment, et tout se règle sans écrire une ligne de code.

Cette application a été réécrite en **React + TypeScript + Vite**.

---

## Fonctionnalités

| Touche du pupitre | Ce qu'elle fait |
|---|---|
| **Écoute** | Le micro détecte chaque phrase et la transcrit (Web Speech API / détection VAD). |
| **Traduction** | Traduit dans l'autre langue, dans les deux sens, avec protection du glossaire. Aperçu pendant la frappe. |
| **Voix** | Lit les traductions à voix haute (Speech Synthesis avec voix françaises et anglaises naturelles). Le micro se met en pause pendant la voix (echo-guard). |
| **Parler en tapant** | Ce que tu tapes est dit à voix haute au fil de la frappe (par mots, groupes de mots ou phrases). |
| **Enregistrement** | Garde dans la bibliothèque l'audio de tes phrases captées. |
| **Voix clonée** | Annoncée pour la phase 3. |

- **Qui parle ?** « Auto » devine la langue de chaque phrase parmi les deux ; forcer une langue est plus fiable dans le bruit.
- **Parler en tapant.** Choisis *Je tape en* et *Voix en* sous la conversation. Même langue : la voix dit ce que tu tapes. Langue différente : elle dit la traduction.
- **Bibliothèque vocale.** Enregistre ta voix avec jauge de niveau et écoute préalable, ou téléverse n'importe quel fichier audio avec conversion WAV 16 kHz automatique dans le navigateur.
- **Glossaire.** Définis des termes à garder tels quels ou à traduire d'une façon spécifique (avec jetons de protection).
- **Profils et Réglages.** Interface de réglages entièrement pilotée par schéma (`schema.json`), profils sauvegardés, export/import JSON.
- **Historique.** Conservation des échanges, export `.txt` et réinitialisation.
- **Design et typographie soignés.** Couleurs ajustables par langue, modes clair/sombre, dispositions bilingues face à face ou empilées.

## Démarrage rapide

```bash
npm install
npm run dev
```

L'application démarre sur le port 3000 (`http://localhost:3000`).

## Build de production

```bash
npm run build
```
