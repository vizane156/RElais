import { h, clear, nextId } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { toast } from './toast.js';

/** L'écran de réglages est GÉNÉRÉ depuis le schéma du serveur : aucun champ n'est écrit à la main. */
export function mountSettings(root, ctx) {
  let controls = {};
  let devices = { inputs: [], outputs: [] };

  const S = () => ctx.store.get().settings;
  const names = () => ({ a: ctx.langName('a'), b: ctx.langName('b') });

  async function loadDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind, word) => list.filter((d) => d.kind === kind).map((d, i) => ({ value: d.deviceId, label: d.label || `${word} ${i + 1}` }));
      devices = { inputs: pick('audioinput', t('set.listen.device')), outputs: pick('audiooutput', t('set.speak.device')) };
    } catch { /* permission refusée */ }
  }

  function optionsFor(f) {
    if (f.options) return f.options.map((o) => ({ value: o.value, label: o.label ?? t(o.label_key) }));
    const n = names();
    const me = S()['pair.me'] || 'b';
    switch (f.options_from) {
      case 'pair': return [{ value: 'a', label: n.a }, { value: 'b', label: n.b }];
      case 'who': return [{ value: 'auto', label: t('who.auto') }, { value: 'a', label: n.a }, { value: 'b', label: n.b }];
      case 'me_other': return [
        { value: 'me', label: t('settings.me_label', { name: n[me] }) },
        { value: 'other', label: t('settings.other_label', { name: n[me === 'a' ? 'b' : 'a'] }) }];
      case 'voices.a': case 'voices.b': {
        const vs = ctx.store.get().voices[f.options_from.slice(-1)] || [];
        return [{ value: '', label: t('opt.auto') }, ...vs.map((v) => ({ value: v.id, label: v.label }))];
      }
      case 'client.audioinputs': return [{ value: '', label: t('settings.default_device') }, ...devices.inputs];
      case 'client.audiooutputs': return [{ value: '', label: t('settings.default_device') }, ...devices.outputs];
      default: return [];
    }
  }

  function fmt(f, v) {
    if (f.format === 'percent') return `${Math.round(v * 100)} %`;
    if (f.format === 'rate') return `×${Number(v).toFixed(2)}`;
    return f.unit ? `${v} ${f.unit}` : String(v);
  }

  function control(f, labelId) {
    const key = f.key;
    if (f.type === 'toggle') {
      const b = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': labelId });
      b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); ctx.setSetting({ [key]: v }); });
      return { el: b, set: (v) => b.setAttribute('aria-checked', String(!!v)) };
    }
    if (f.type === 'select') {
      const sel = h('select', { 'aria-labelledby': labelId });
      for (const o of optionsFor(f)) sel.append(h('option', { value: String(o.value) }, o.label));
      const typed = (raw) => { const o = (f.options || []).find((x) => String(x.value) === raw); return o ? o.value : raw; };
      sel.addEventListener('change', () => ctx.setSetting({ [key]: typed(sel.value) }));
      return { el: sel, set: (v) => { if (document.activeElement !== sel) sel.value = String(v ?? ''); } };
    }
    if (f.type === 'range') {
      const val = h('span', { class: 'range-val' });
      const input = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, 'aria-labelledby': labelId });
      input.addEventListener('input', () => { val.textContent = fmt(f, +input.value); ctx.setLocal({ [key]: +input.value }); });
      input.addEventListener('change', () => ctx.setSetting({ [key]: +input.value }));
      return { el: [input, val], set: (v) => { if (document.activeElement !== input) input.value = v; val.textContent = fmt(f, v); } };
    }
    if (f.type === 'color') {
      const input = h('input', { type: 'color', 'aria-labelledby': labelId });
      input.addEventListener('input', () => ctx.setLocal({ [key]: input.value.toUpperCase() }));
      input.addEventListener('change', () => ctx.setSetting({ [key]: input.value.toUpperCase() }));
      const reset = h('button', { class: 'icon-btn sm', type: 'button', title: t('settings.reset_section'), 'aria-label': t('settings.reset_section'),
        onclick: () => ctx.setSetting({ [key]: f.default }) }, icon('reset', 'ic sm'));
      return { el: [input, reset], set: (v) => { input.value = String(v).toLowerCase(); } };
    }
    const input = h('input', { type: 'text', 'aria-labelledby': labelId });
    input.addEventListener('change', () => ctx.setSetting({ [key]: input.value }));
    return { el: input, set: (v) => { if (document.activeElement !== input) input.value = v ?? ''; } };
  }

  function field(f) {
    const labelId = nextId('lbl');
    const params = f.lang_label ? { lang: ctx.langName(f.lang_label) } : undefined;
    const c = control(f, labelId);
    controls[f.key] = c;
    return h('div', { class: 'field' },
      h('span', { class: 'field-label', id: labelId }, t(f.label, params)),
      f.hint ? h('span', { class: 'field-hint' }, t(f.hint)) : null,
      h('div', { class: 'field-control' }, c.el));
  }

  function profileBox() {
    const s = ctx.store.get();
    const sel = h('select', { 'aria-label': t('settings.profile') },
      h('option', { value: '' }, t('settings.profile.none')), ...s.profiles.map((n) => h('option', { value: n }, n)));
    const name = h('input', { type: 'text', placeholder: t('settings.profile.name'), 'aria-label': t('settings.profile.name'), maxlength: 40 });
    const apply = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!sel.value) return;
      try { await api.json('POST', `/api/profiles/${encodeURIComponent(sel.value)}/apply`); } catch { toast(t('err.save')); }
    } }, t('btn.apply'));
    const del = h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
      if (!sel.value) return;
      try { const r = await api.json('DELETE', `/api/profiles/${encodeURIComponent(sel.value)}`); ctx.store.set({ profiles: r.profiles }); } catch { toast(t('err.save')); }
    } }, t('btn.delete'));
    const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      try { const r = await api.json('PUT', `/api/profiles/${encodeURIComponent(n)}`); ctx.store.set({ profiles: r.profiles }); toast(t('settings.profile_saved'), 2500); name.value = ''; } catch { toast(t('err.save')); }
    } }, t('btn.save_as'));
    return h('section', { class: 'set-section', id: 'set-profile' },
      h('h3', {}, t('settings.profile')),
      h('p', { class: 'lede' }, t('settings.profile.hint')),
      h('div', { class: 'row' }, sel, apply, del),
      h('div', { class: 'row' }, name, save));
  }

  function transfer() {
    const file = h('input', { type: 'file', accept: 'application/json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('format');
        await api.json('PUT', '/api/settings', data.settings || data);
        toast(t('settings.imported'), 2500);
      } catch { toast(t('settings.import_bad')); }
    });
    const exp = h('button', { class: 'btn quiet', type: 'button', onclick: () => {
      const s = { ...S() }; delete s['caps.on']; delete s['listen.device']; delete s['speak.device'];
      const url = URL.createObjectURL(new Blob([JSON.stringify({ settings: s }, null, 2)], { type: 'application/json' }));
      const a = h('a', { href: url, download: 'relais-reglages.json' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } }, t('settings.export'));
    const imp = h('button', { class: 'btn quiet', type: 'button', onclick: () => file.click() }, t('settings.import'));
    return h('div', { class: 'row' }, exp, imp, file);
  }

  function build() {
    const schema = ctx.store.get().schema;
    clear(root);
    controls = {};
    if (!schema) return;
    root.append(profileBox());
    for (const sec of schema.sections) {
      const keys = sec.fields.map((f) => f.key);
      root.append(h('section', { class: 'set-section', id: `set-${sec.id}` },
        h('h3', {}, t(sec.label)),
        ...sec.fields.map(field),
        h('div', { class: 'row' }, h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
          try { await api.json('POST', '/api/settings/reset', { keys }); } catch { toast(t('err.save')); }
        } }, t('settings.reset_section')))));
    }
    root.append(h('section', { class: 'set-section' }, transfer()));
    sync();
  }

  function sync() {
    const s = S();
    for (const [k, c] of Object.entries(controls)) if (k in s) c.set(s[k]);
  }

  ctx.store.subscribe((st, patch, prev) => {
    const meChanged = patch.settings && prev.settings['pair.me'] !== st.settings['pair.me'];
    if (patch.schema || patch.lang || patch.voices || patch.pair || meChanged || patch.profiles) build();
    else if (patch.settings) sync();
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => { await loadDevices(); build(); });
  }

  return {
    async show() { await loadDevices(); build(); },
    render: build,
  };
}
