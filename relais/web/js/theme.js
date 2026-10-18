// Applique les réglages d'apparence : attributs sur <html> et variables CSS. Aucune feuille
// de style n'est modifiée : tout passe par des jetons, donc tout est réversible.
const DEFAULTS = { '--a': '#2C3FD4', '--b': '#E4580A' };

function color(root, name, value) {
  if (!value || value.toUpperCase() === DEFAULTS[name]) root.style.removeProperty(name);
  else root.style.setProperty(name, value);
}

export function applyUi(s) {
  const r = document.documentElement;
  r.dataset.theme = s['ui.theme'] || 'auto';
  r.dataset.layout = s['ui.layout'] || 'auto';
  r.dataset.density = s['ui.density'] || 'comfortable';
  r.dataset.motion = s['ui.motion'] || 'full';
  r.dataset.fontText = s['ui.font_text'] || 'literata';
  r.dataset.showBoth = String(s['ui.show_original'] !== false);
  r.style.setProperty('--scale', String(s['ui.text_scale'] ?? 1));
  color(r, '--a', s['ui.color_a']);
  color(r, '--b', s['ui.color_b']);
  const lat = document.getElementById('latBox');
  if (lat) lat.hidden = s['ui.show_latency'] === false;
}
