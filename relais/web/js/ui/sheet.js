import { h, $, clear } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { mountSettings } from './settings.js';
import { mountLibrary } from './library.js';
import { mountHistory } from './history.js';
import { mountGlossary } from './glossary.js';
import { mountSystem } from './system.js';

const TABS = [
  { id: 'settings', icon: 'settings', key: 'top.settings', mount: mountSettings },
  { id: 'library', icon: 'wave', key: 'top.library', mount: mountLibrary },
  { id: 'history', icon: 'clock', key: 'top.history', mount: mountHistory },
  { id: 'glossary', icon: 'book', key: 'top.glossary', mount: mountGlossary },
  { id: 'system', icon: 'system', key: 'top.system', mount: mountSystem },
];

/** Le tiroir : réglages, bibliothèque vocale, historique, glossaire, système. */
export function initSheet(ctx) {
  const sheet = $('#sheet'), scrim = $('#scrim'), body = $('#sheetBody'), tabs = $('#tabs'), title = $('#sheetTitle');
  const panels = {};
  let current = null, opener = null;

  const tabBtns = {};
  for (const tab of TABS) {
    const btn = h('button', { type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}`, 'aria-selected': 'false', tabindex: '-1' },
      icon(tab.icon, 'ic sm'), h('span', { class: 'tab-label' }));
    btn.addEventListener('click', () => show(tab.id));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((x) => x.id === tab.id);
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (next == null) return;
      e.preventDefault();
      const target = TABS[(next + TABS.length) % TABS.length];
      show(target.id);
      tabBtns[target.id].focus();
    });
    tabBtns[tab.id] = btn;
    tabs.append(btn);
    const el = h('div', { class: 'panel', role: 'tabpanel', id: `panel-${tab.id}`, 'aria-labelledby': btn.id, hidden: true });
    body.append(el);
    panels[tab.id] = { tab, el, api: null };
  }

  function labels() {
    for (const tab of TABS) {
      tabBtns[tab.id].querySelector('.tab-label').textContent = t(tab.key);
      tabBtns[tab.id].title = t(tab.key);
      tabBtns[tab.id].setAttribute('aria-label', t(tab.key));
    }
    if (current) title.textContent = t(TABS.find((x) => x.id === current).key);
  }

  function show(id, opts = {}) {
    current = id;
    for (const tab of TABS) {
      const sel = tab.id === id;
      tabBtns[tab.id].setAttribute('aria-selected', String(sel));
      tabBtns[tab.id].tabIndex = sel ? 0 : -1;
      panels[tab.id].el.hidden = !sel;
    }
    const p = panels[id];
    if (!p.api) p.api = p.tab.mount(p.el, ctx);
    labels();
    if (p.api && p.api.show) p.api.show(opts);
    body.scrollTop = 0;
    if (opts.section) {
      const target = p.el.querySelector(`#set-${opts.section}`);
      if (target) target.scrollIntoView({ block: 'start' });
    }
  }

  function open(id = 'settings', opts = {}) {
    opener = document.activeElement;
    sheet.dataset.open = 'true';
    scrim.dataset.open = 'true';
    $('#app').inert = true;
    show(id, opts);
    $('#sheetClose').focus();
  }

  function close() {
    if (sheet.dataset.open !== 'true') return;
    sheet.dataset.open = 'false';
    scrim.dataset.open = 'false';
    $('#app').inert = false;
    if (opener && opener.focus) opener.focus();
  }

  $('#sheetClose').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.dataset.open === 'true') close(); });
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => open(b.dataset.sheet)));

  ctx.store.subscribe((s, patch) => { if (patch.lang) { labels(); for (const id in panels) if (panels[id].api && panels[id].api.render) panels[id].api.render(); } });
  labels();
  return { open, close, show };
}
