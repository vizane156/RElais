import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast } from './toast.js';

/** Glossaire : termes gardés tels quels ou toujours traduits d'une façon précise. */
export function mountGlossary(root, ctx) {
  let rules = [];

  async function refresh() {
    try { rules = (await api.get('/api/glossary')).rules; } catch { rules = []; }
    render();
  }

  function row(r, i) {
    const lang = h('select', { 'aria-label': t('glossary.lang') }, ...['a', 'b'].map((s) => h('option', { value: ctx.sideLang(s), selected: ctx.sideLang(s) === r.src }, ctx.langName(s))));
    const term = h('input', { type: 'text', value: r.term, placeholder: t('glossary.term'), 'aria-label': t('glossary.term'), maxlength: 80 });
    const mode = h('select', { 'aria-label': t('glossary.mode') },
      h('option', { value: 'keep', selected: r.mode === 'keep' }, t('glossary.keep')),
      h('option', { value: 'replace', selected: r.mode === 'replace' }, t('glossary.replace')));
    const target = h('input', { type: 'text', value: r.target, placeholder: t('glossary.target'), 'aria-label': t('glossary.target'), maxlength: 120, disabled: r.mode === 'keep' });
    lang.addEventListener('change', () => { r.src = lang.value; });
    term.addEventListener('input', () => { r.term = term.value; });
    mode.addEventListener('change', () => { r.mode = mode.value; target.disabled = r.mode === 'keep'; });
    target.addEventListener('input', () => { r.target = target.value; });
    const del = h('button', { class: 'icon-btn sm', type: 'button', title: t('glossary.remove'), 'aria-label': t('glossary.remove'),
      onclick: () => { rules.splice(i, 1); render(); } }, icon('trash', 'ic sm'));
    return h('div', { class: 'gloss-row' }, lang, term, mode, target, del);
  }

  function render() {
    clear(root);
    root.append(
      h('p', { class: 'lede' }, t('glossary.intro')),
      rules.length ? h('div', {}, rules.map(row)) : h('p', { class: 'empty-note' }, t('glossary.empty')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { rules.push({ src: ctx.sideLang('a'), term: '', target: '', mode: 'keep' }); render(); } }, icon('plus', 'ic sm'), t('glossary.add')),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try { rules = (await api.json('PUT', '/api/glossary', { rules })).rules; toast(t('glossary.saved'), 2500); render(); } catch { toast(t('err.save')); }
        } }, icon('check', 'ic sm'), t('btn.save'))));
  }

  return { show: refresh, render };
}
