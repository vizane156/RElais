import { h, $ } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from './toast.js';

const HELLO = { en: 'Hello.', fr: 'Bonjour.' };
const other = (s) => (s === 'a' ? 'b' : 'a');
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** La conversation : une ligne par phrase, deux colonnes qui se font face. */
export function initFolio(ctx) {
  const root = $('#folio');
  const rows = new Map();
  let empty = null;

  const me = () => ctx.store.get().settings['pair.me'] || 'b';
  const left = () => ctx.store.get().settings['pair.left'] || 'a';
  const translateOn = () => { const c = ctx.store.get().caps.translate; return !!(c && c.enabled && c.state === 'ready'); };

  function showEmpty() {
    if (empty || rows.size) return;
    const l = left(), r = other(l);
    const word = (side) => h('span', { dataset: { side }, lang: ctx.sideLang(side) }, HELLO[ctx.sideLang(side)] || '');
    empty = h('div', { class: 'folio-empty' },
      h('div', { class: 'empty-pair', 'aria-hidden': 'true' }, word(l), word(r)),
      h('div', { class: 'empty-text' }, h('div', {}, h('h2', {}, t('folio.empty.title')), h('p', {}, t('folio.empty.body')))));
    root.append(empty);
  }

  function hideEmpty() { if (empty) { empty.remove(); empty = null; } }

  function build(key) {
    const mk = (side) => h('div', { class: 'cell', dataset: { side } }, h('p', { class: 'line' }));
    const cells = { a: mk('a'), b: mk('b') };
    const stamp = h('div', { class: 'stamp' });
    const el = h('article', { class: 'utt enter', dataset: { key, state: 'live' } }, stamp, cells.a, cells.b);
    return { el, cells, stamp, tools: null, item: null, wiped: false };
  }

  function ensureTools(row, item) {
    if (row.tools) return;
    const replay = h('button', { class: 'icon-btn sm', type: 'button', title: t('folio.replay'), 'aria-label': t('folio.replay'),
      onclick: () => ctx.speakText(row.item.translation, row.item.to || ctx.sideLang(other(row.item.side))) }, icon('play', 'ic sm'));
    const copy = h('button', { class: 'icon-btn sm', type: 'button', title: t('folio.copy'), 'aria-label': t('folio.copy'),
      onclick: async () => { try { await navigator.clipboard.writeText(row.item.translation); toast(t('folio.copied'), 1800); } catch { /* presse-papiers refusé */ } } },
      icon('copy', 'ic sm'));
    row.tools = h('div', { class: 'tools' }, replay, copy);
    row.cells[other(item.side)].append(row.tools);
  }

  function paint(row) {
    const item = row.item;
    const said = item.side, heard = other(said), m = me();
    for (const side of ['a', 'b']) {
      const c = row.cells[side];
      c.classList.toggle('said', side === said);
      c.classList.toggle('heard', side === heard);
      c.classList.toggle('mine', side === m);
      c.classList.toggle('other-lang', side !== m);
      c.lang = ctx.sideLang(side);
      c.setAttribute('aria-label', ctx.langName(side));
    }
    row.cells[said].firstChild.textContent = item.text || '';
    const hl = row.cells[heard].firstChild;
    const has = item.translation != null && item.translation !== '';
    hl.textContent = has ? item.translation : '';
    hl.dataset.placeholder = !has ? (item.state === 'final' && !translateOn() ? t('folio.notranslate') : item.state === 'final' ? '' : t('folio.pending')) : '';
    row.el.dataset.state = item.state === 'live' ? 'live' : 'final';
    row.stamp.replaceChildren();
    if (item.state === 'live') row.stamp.append(h('span', { class: 'lamp on', 'aria-hidden': 'true' }));
    else row.stamp.textContent = clock(item.ts || Date.now());
    if (item.state === 'final' && has) {
      ensureTools(row, item);
      if (!row.wiped && !item.restored) {
        row.wiped = true;
        hl.classList.add('wipe');
        hl.addEventListener('animationend', () => hl.classList.remove('wipe'), { once: true });
      }
    }
  }

  /** item : { key, side, text, translation?, to?, state: 'live'|'pending'|'final', ts?, restored? } */
  function update(item) {
    const near = root.scrollHeight - root.scrollTop - root.clientHeight < 160;
    hideEmpty();
    let row = rows.get(item.key);
    const fresh = !row;
    if (!row) { row = build(item.key); rows.set(item.key, row); root.append(row.el); }
    row.item = { ...(row.item || {}), ...item };
    if (!row.item.ts) row.item.ts = Date.now();
    paint(row);
    if (fresh || near) root.scrollTop = root.scrollHeight;
  }

  function remove(key) {
    const row = rows.get(key);
    if (row) { row.el.remove(); rows.delete(key); }
    if (!rows.size) showEmpty();
  }

  function load(items) {
    for (const e of items) {
      if (!e.text) continue;
      update({ key: `h${e.id}`, side: e.side, text: e.text, translation: e.translation, to: e.to,
               state: 'final', ts: Math.round((e.ts || 0) * 1000), restored: true });
    }
    root.scrollTop = root.scrollHeight;
  }

  function clearAll() { rows.forEach((r) => r.el.remove()); rows.clear(); showEmpty(); }

  /** Après un changement de langue d'interface, de colonne ou de « ma langue ». */
  function refresh() {
    rows.forEach((r) => paint(r));
    if (empty) { empty.remove(); empty = null; showEmpty(); }
    $('#folio').dataset.left = left();
    $('#folioHead').dataset.left = left();
  }

  ctx.store.subscribe((s, patch) => { if (patch.lang || patch.pair || patch.settings || patch.caps) refresh(); });
  showEmpty();
  return { update, remove, load, clear: clearAll, refresh, has: (k) => rows.has(k) };
}
