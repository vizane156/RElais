import { h, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';

export function mountSystem(root, ctx) {
  let info = null, models = null;

  async function refresh() {
    try { [info, models] = await Promise.all([api.get('/api/info'), api.get('/api/models')]); } catch { info = models = null; }
    render();
  }

  const status = (m) => h('span', { class: m.installed ? 'ok' : 'ko' }, t(m.installed ? 'system.installed' : 'system.missing'));

  function render() {
    clear(root);
    if (!info) return;
    const group = (title, list) => [
      h('h3', {}, title),
      h('dl', { class: 'sys-list' }, list.map((m) => h('div', {}, h('dt', {}, `${m.id}${m.lang ? ` (${m.lang})` : ''}`), h('dd', {}, `~${m.mb} Mo · `, status(m))))),
    ];
    root.append(
      h('dl', { class: 'sys-list' },
        h('div', {}, h('dt', {}, t('system.version')), h('dd', {}, info.version)),
        h('div', {}, h('dt', {}, t('system.engines')), h('dd', {}, t(info.engines === 'mock' ? 'system.engines.mock' : 'system.engines.real'))),
        h('div', {}, h('dt', {}, t('system.data')), h('dd', {}, h('code', {}, info.home)))),
      ...group(t('system.mt'), models.mt), ...group(t('system.stt'), models.stt), ...group(t('system.tts'), models.tts),
      h('p', { class: 'lede' }, t('system.hint')));
  }

  return { show: refresh, render };
}
