// Deux langues partout, y compris dans l'interface. Le français est la base : une clé absente
// d'une autre langue retombe sur le français plutôt que d'afficher un identifiant.
let base = {};
let dict = {};
let code = 'fr';

async function fetchDict(c) {
  const r = await fetch(`/i18n/${c}.json`);
  if (!r.ok) throw new Error(`i18n ${c}`);
  return r.json();
}

export async function loadLang(c) {
  if (!Object.keys(base).length) base = await fetchDict('fr');
  dict = c === 'fr' ? base : { ...base, ...(await fetchDict(c)) };
  code = c;
  document.documentElement.lang = c;
  try { localStorage.setItem('relais.lang', c); } catch { /* stockage indisponible */ }
}

export function initialLang() {
  try {
    const saved = localStorage.getItem('relais.lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* ignore */ }
  return (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

export const currentLang = () => code;
export const hasKey = (k) => k in dict || k in base;

export function t(key, params) {
  let s = dict[key] ?? base[key];
  if (s == null) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPh)));
}
