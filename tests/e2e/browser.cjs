// Test de bout en bout dans Chromium, contre `relais demo` (moteurs simulés) et un faux micro.
//   python -m relais demo --port 8777 --data /tmp/relais-e2e &
//   python tests/e2e/make_fake_mic.py /tmp/fake-mic.wav
//   NODE_PATH=$(npm root -g) node tests/e2e/browser.cjs [http://localhost:8777] [dossier-captures]
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8777';
const SHOTS = process.argv[3] || '/tmp/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=/tmp/fake-mic.wav', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['microphone'], locale: 'fr-FR' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(404|woff2)|\/fonts\//.test(m.text() + (m.location().url || ''))) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const shot = (n, opts = {}) => page.screenshot({ path: `${SHOTS}/${n}.png`, ...opts });
  const wait = (sel, ms = 8000) => page.waitForSelector(sel, { timeout: ms });

  await page.goto(`${BASE}/?debug`);
  await wait('#conn[data-state="open"]', 6000).then(() => check('connexion WebSocket établie', true), () => check('connexion WebSocket établie', false));
  check('badge démo visible (moteurs simulés)', await page.isVisible('#demoBadge'));
  check('six touches au pupitre', (await page.$$('#keys .key')).length === 6);
  check('« voix clonée » annoncée comme à venir, pas simulée', await page.$eval('.key[data-cap="clone"]', (e) => e.hasAttribute('data-planned')));
  check('page blanche : deux mots face à face', await page.isVisible('.empty-pair'));
  await shot('01-vide');

  // --- allumer les fonctions, comme un utilisateur
  await page.click('.key[data-cap="translate"] .key-btn');
  await wait('.key[data-cap="translate"][data-state="ready"]').then(() => check('Traduction : voyant allumé après chargement', true), () => check('Traduction : voyant allumé après chargement', false));
  await page.click('.key[data-cap="speak"] .key-btn');
  await wait('.key[data-cap="speak"][data-state="ready"]');
  await page.click('.key[data-cap="listen"] .key-btn');
  await wait('.key[data-cap="listen"][data-state="ready"]').then(() => check('Écoute : prête', true), () => check('Écoute : prête', false));
  check('micro réellement ouvert dans le navigateur', await page.evaluate(() => window.__relais.capture.running === true));
  check('lampe ambre allumée sur une touche active', await page.$eval('.key[data-cap="listen"] .lamp', (e) => e.classList.contains('on')));

  // --- le faux micro parle : phrase provisoire puis finale, traduite, et lue à voix haute
  await wait('.utt[data-state="live"]', 20000).then(() => check('texte provisoire apparaît pendant que ça parle', true), () => check('texte provisoire apparaît pendant que ça parle', false));
  await shot('02-direct');
  await wait('.utt[data-state="final"] .heard .line:not(:empty)', 20000).then(() => check('phrase finalisée avec sa traduction', true), () => check('phrase finalisée avec sa traduction', false));
  const row = await page.$eval('.utt[data-state="final"]', (e) => ({ said: e.querySelector('.said .line').textContent, heard: e.querySelector('.heard .line').textContent, saidLang: e.querySelector('.said').lang, heardLang: e.querySelector('.heard').lang }));
  check('original et traduction dans deux langues différentes', row.saidLang !== row.heardLang && row.said && row.heard, JSON.stringify(row));
  await page.waitForFunction(() => window.__relais.player.played > 0, null, { timeout: 8000 }).then(() => check('la traduction est jouée à voix haute (audio reçu et programmé)', true), () => check('la traduction est jouée à voix haute (audio reçu et programmé)', false));
  check('délais affichés', /ms/.test(await page.textContent('#lat')));
  await page.waitForTimeout(500);
  await shot('03-conversation');

  // --- saisie : aperçu en direct puis envoi
  await page.click('#input');
  await page.type('#input', 'Hello, can you hear me clearly?', { delay: 25 });
  await page.waitForFunction(() => document.querySelector('#preview').textContent.length > 5, null, { timeout: 4000 }).then(() => check('aperçu de la traduction au fil de la frappe', true), () => check('aperçu de la traduction au fil de la frappe', false));
  const rowsBefore = (await page.$$('.utt')).length;
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.utt').length > n, rowsBefore, { timeout: 3000 });
  await wait('.utt[data-key^="t"][data-state="final"]').then(() => check('texte tapé : ligne validée et traduite', true), () => check('texte tapé : ligne validée et traduite', false));
  check('champ vidé après envoi', (await page.inputValue('#input')) === '');

  // --- parler en tapant
  const played0 = await page.evaluate(() => window.__relais.player.played);
  await page.click('.key[data-cap="typespeak"] .key-btn');
  await wait('.key[data-cap="typespeak"][data-state="ready"]');
  await page.click('#input');
  await page.type('#input', 'Bonjour, je vois ce que vous dites ', { delay: 70 });
  await page.waitForTimeout(900);
  check('parler en tapant : la voix dit des morceaux pendant la frappe', (await page.evaluate(() => window.__relais.player.played)) > played0);
  check('parler en tapant : le texte prononcé est affiché', (await page.textContent('#said')).length > 4, await page.textContent('#said'));
  await page.keyboard.press('Enter');
  await shot('04-parler-en-tapant');

  // --- réglages générés depuis le schéma
  await page.click('[data-sheet="settings"]');
  await wait('#sheet[data-open="true"] .set-section');
  const sections = await page.$$eval('#panel-settings .set-section h3', (a) => a.map((x) => x.textContent));
  check('réglages générés : toutes les sections du schéma', sections.length >= 9, sections.join(' | '));
  check('une soixantaine de contrôles', (await page.$$('#panel-settings .field')).length >= 35, String((await page.$$('#panel-settings .field')).length));
  await shot('05-reglages');
  await page.selectOption('#panel-settings .field:has-text("Thème") select', 'dark');
  await page.waitForTimeout(250);
  check('thème sombre appliqué', (await page.$eval('html', (e) => e.dataset.theme)) === 'dark');
  await shot('06-sombre');
  await page.selectOption('#panel-settings .field:has-text("Thème") select', 'light');
  // taille du texte et couleur : personnalisation sans code
  await page.$eval('#panel-settings input[type="range"][max="1.7"]', (el) => { el.value = 1.4; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  check('taille du texte appliquée en direct', (await page.$eval('html', (e) => e.style.getPropertyValue('--scale'))) === '1.4');
  await page.$eval('#panel-settings input[type="color"]', (el) => { el.value = '#0a7d5a'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  check('couleur de langue personnalisée', (await page.$eval('html', (e) => e.style.getPropertyValue('--a'))).toLowerCase() === '#0a7d5a');
  // profil
  await page.fill('#set-profile input[type="text"]', 'Réunion');
  await page.click('#set-profile button:has-text("Enregistrer sous")');
  await page.waitForFunction(() => [...document.querySelectorAll('#set-profile option')].some((o) => o.textContent === 'Réunion'), null, { timeout: 3000 }).then(() => check('profil enregistré et listé', true), () => check('profil enregistré et listé', false));

  // --- langue de l'interface : français -> anglais
  await page.selectOption('#panel-settings .field:has-text("Langue de l\'interface") select', 'en');
  await page.waitForFunction(() => document.querySelector('.key[data-cap="listen"] .key-label').textContent === 'Listen', null, { timeout: 4000 }).then(() => check('interface bascule en anglais', true), () => check('interface bascule en anglais', false));
  check('html lang suit', (await page.$eval('html', (e) => e.lang)) === 'en');
  await shot('07-anglais');
  await page.selectOption('#panel-settings .field:has-text("Interface language") select', 'fr');
  await page.waitForFunction(() => document.querySelector('.key[data-cap="listen"] .key-label').textContent === 'Écoute');
  await page.click('#sheetClose');

  // --- bibliothèque vocale
  await page.click('[data-sheet="library"]');
  await wait('#panel-library .rec-btn');
  await page.click('#panel-library .rec-btn');
  await page.waitForTimeout(1600);
  check('enregistrement : minuterie qui avance', (await page.textContent('#panel-library .rec-timer')) !== '0:00');
  await page.click('#panel-library .rec-btn');
  await wait('#panel-library .rec-review audio').then(() => check('enregistrement : réécoute proposée', true), () => check('enregistrement : réécoute proposée', false));
  await page.fill('#panel-library .rec-review input[type="text"]', 'Ma voix test');
  await shot('08-bibliotheque');
  await page.click('#panel-library .rec-review button:has-text("Garder")');
  await wait('#panel-library .lib-item').then(() => check('enregistrement gardé dans la bibliothèque', true), () => check('enregistrement gardé dans la bibliothèque', false));
  check('nom conservé', (await page.textContent('#panel-library .lib-item .name')) === 'Ma voix test');
  const wavOk = await page.evaluate(async () => { const id = (await (await fetch('/api/recordings')).json()).items[0].id; const b = new Uint8Array(await (await fetch(`/api/recordings/${id}.wav`)).arrayBuffer()); return String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && b.length > 20000; });
  check('le WAV enregistré est valide côté serveur', wavOk);
  await page.click('#sheetClose');

  // --- glossaire
  await page.click('[data-sheet="glossary"]');
  await wait('#panel-glossary .btn:has-text("Ajouter")');
  await page.click('#panel-glossary .btn:has-text("Ajouter")');
  await page.fill('#panel-glossary .gloss-row input[type="text"]', 'table');
  await page.click('#panel-glossary .btn.primary');
  await page.waitForTimeout(400);
  await page.click('#sheetClose');
  await page.click('.key[data-cap="typespeak"] .key-btn');   // couper la parole pour ce test
  await page.fill('#input', '');
  await page.type('#input', 'I need a table now', { delay: 15 });
  await page.waitForFunction(() => /table/.test(document.querySelector('#preview').textContent), null, { timeout: 4000 }).then(() => check('glossaire appliqué à la traduction', true), () => check('glossaire appliqué à la traduction', false));
  await page.fill('#input', '');

  // --- historique et persistance après rechargement
  await page.click('[data-sheet="history"]');
  await wait('#panel-history .hist-item').then(() => check('historique rempli', true), () => check('historique rempli', false));
  await page.click('#sheetClose');
  await page.reload();
  await wait('#conn[data-state="open"]');
  await wait('.utt', 5000).then(() => check('conversation restaurée après rechargement', true), () => check('conversation restaurée après rechargement', false));
  await wait('.key[data-cap="translate"][data-state="ready"]', 5000).then(() => check('fonctions rallumées après rechargement', true), () => check('fonctions rallumées après rechargement', false));

  // --- extinction : décharge le moteur, la touche s'éteint
  await page.click('.key[data-cap="translate"] .key-btn');
  await wait('.key[data-cap="translate"][data-state="off"]').then(() => check('extinction : la touche s\'éteint', true), () => check('extinction : la touche s\'éteint', false));

  // --- mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobile : aucun défilement horizontal de la page', !overflow);
  check('mobile : disposition empilée (un seul titre de colonne masqué)', !(await page.isVisible('#folioHead')));
  await shot('09-mobile');
  await page.click('[data-sheet="settings"]');
  await page.waitForTimeout(500);
  await shot('10-mobile-reglages');

  check('aucune erreur console / CSP / page', problems.length === 0, problems.slice(0, 4).join(' ‖ '));
  await browser.close();
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
