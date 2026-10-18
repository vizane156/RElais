import { h, clear, confirmButton } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast } from './toast.js';

export function mountHistory(root, ctx) {
  let items = [];

  async function refresh() {
    try { items = (await api.get('/api/history?limit=300')).items; } catch { items = []; }
    render();
  }

  function render() {
    clear(root);
    const clearBtn = h('button', { class: 'btn quiet', type: 'button' }, icon('trash', 'ic sm'), t('history.clear'));
    confirmButton(clearBtn, t('history.confirm_clear'), async () => {
      try { await api.del('/api/history'); ctx.folio.clear(); } catch { toast(t('err.save')); }
      refresh();
    });
    root.append(
      h('div', { class: 'row' },
        h('a', { class: 'btn quiet', href: '/api/history/export.txt', download: 'relais-conversation.txt' }, icon('download', 'ic sm'), t('history.export')),
        clearBtn),
      items.length
        ? h('div', {}, [...items].reverse().map((e) => h('div', { class: 'hist-item' },
          h('time', {}, new Date((e.ts || 0) * 1000).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })),
          h('p', { dataset: { side: e.side }, lang: e.lang }, e.text),
          e.translation ? h('p', { class: 'tr', dataset: { side: e.to === ctx.sideLang('a') ? 'a' : 'b' }, lang: e.to }, e.translation) : null)))
        : h('p', { class: 'empty-note' }, t('history.empty')));
  }

  return { show: refresh, render };
}
