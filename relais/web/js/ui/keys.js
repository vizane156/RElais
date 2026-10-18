import { h, $ } from '../dom.js';
import { icon } from '../icons.js';
import { t, hasKey } from '../i18n.js';
import { toast } from './toast.js';

const DEFS = [
  { id: 'listen', icon: 'mic', section: 'listen' },
  { id: 'translate', icon: 'dialogue', section: 'translate' },
  { id: 'speak', icon: 'speaker', section: 'speak' },
  { id: 'typespeak', icon: 'type', section: 'typespeak' },
  { id: 'record', icon: 'record', section: 'record' },
  { id: 'clone', icon: 'clone', planned: true },
];

/** Message d'état d'un moteur, dans la langue de l'interface (clé i18n, sinon texte du serveur). */
export function detailText(detail) {
  if (!detail) return '';
  if (detail.key && hasKey(detail.key)) return t(detail.key, detail.params);
  return detail.text || '';
}

export function initKeys(ctx) {
  const root = $('#keys');
  const els = {};

  for (const d of DEFS) {
    const lamp = h('span', { class: 'lamp', 'aria-hidden': 'true' });
    const label = h('span', { class: 'key-label' });
    const state = h('span', { class: 'key-state', id: `key-${d.id}-state` });
    const btn = h('button', { class: 'key-btn', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-describedby': state.id },
      lamp, icon(d.icon), label, state);
    const gear = d.planned ? null : h('button', { class: 'icon-btn sm key-gear', type: 'button' }, icon('settings', 'ic sm'));
    const li = h('li', { class: 'key', dataset: { cap: d.id, state: 'off' } }, btn, gear);
    if (d.planned) { li.dataset.planned = ''; btn.setAttribute('aria-disabled', 'true'); }
    els[d.id] = { d, li, btn, lamp, label, state, gear };

    btn.addEventListener('click', async () => {
      if (d.planned) { toast(t('cap.clone.planned')); return; }
      const cap = ctx.store.get().caps[d.id];
      const on = !(cap && cap.enabled);
      ctx.player.ensure();                      // un geste de l'utilisateur : le navigateur autorise le son ensuite
      if (on && d.id === 'listen') {
        const ok = await ctx.startListening();  // micro d'abord : la permission se demande pendant le clic
        if (!ok) return;
      }
      if (!on && (d.id === 'speak' || d.id === 'typespeak')) ctx.stopVoice();
      if (cap && (cap.state === 'unavailable' || cap.state === 'error') && cap.detail) toast(detailText(cap.detail));
      ctx.link.send({ t: 'cap', id: d.id, on });
    });
    if (gear) gear.addEventListener('click', () => ctx.sheet.open('settings', { section: d.section }));
  }

  for (const d of DEFS) root.append(els[d.id].li);

  function render() {
    const caps = ctx.store.get().caps;
    for (const d of DEFS) {
      const e = els[d.id];
      const name = t(`cap.${d.id}`);
      e.label.textContent = name;
      e.btn.title = t(`cap.${d.id}.tip`);
      if (e.gear) { e.gear.setAttribute('aria-label', t('key.settings', { name })); e.gear.title = t('key.settings', { name }); }
      if (d.planned) { e.state.textContent = t('state.soon'); e.lamp.classList.remove('on'); continue; }
      const cap = caps[d.id] || { enabled: false, state: 'off' };
      const live = cap.enabled && cap.state === 'ready';
      e.li.dataset.state = cap.enabled || cap.state === 'unavailable' || cap.state === 'error' ? cap.state : 'off';
      e.btn.setAttribute('aria-checked', String(!!cap.enabled));
      e.lamp.classList.toggle('on', live);
      if (cap.state === 'unavailable' || cap.state === 'error') e.state.textContent = detailText(cap.detail) || t(`state.${cap.state}`);
      else if (cap.enabled) e.state.textContent = t(cap.state === 'loading' ? 'state.loading' : 'state.ready');
      else e.state.textContent = t('state.off');
    }
  }

  ctx.store.subscribe((s, patch) => { if (patch.caps || patch.lang) render(); });
  render();
  return { render };
}
