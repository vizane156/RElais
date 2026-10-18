import { h, clear, confirmButton } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast } from './toast.js';
import { Meter } from './meter.js';
import { MicTap } from '../audio/capture.js';
import { encodeWav, concatInt16, f32ToInt16, fileToWav } from '../audio/wav.js';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Bibliothèque vocale : enregistrer sa voix, téléverser un fichier, réécouter, nommer, supprimer. */
export function mountLibrary(root, ctx) {
  let items = [];
  const audio = new Audio();
  let playing = null;
  let rec = null;       // { tap, chunks, rate, started, timer }
  let review = null;    // { bytes, url, duration, rate }

  const lang = () => ctx.store.get().settings['pair.me'] || 'b';

  async function refresh() {
    try { items = (await api.get('/api/recordings')).items; } catch { items = []; }
    render();
  }

  async function startRec(ui) {
    const tap = new MicTap();
    const chunks = [];
    let rate = 48000;
    try {
      await tap.open(ctx.store.get().settings['listen.device'] || '', (f, sr) => {
        rate = sr;
        chunks.push(f32ToInt16(f));
        let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
        ui.meter.set(Math.sqrt(sum / f.length), 'live');
      });
    } catch (e) { tap.close(); toast(e && e.code === 'no_mic_api' ? t('err.no_mic_api') : (e && e.name === 'NotAllowedError' ? t('err.mic_denied') : t('err.mic'))); return; }
    rec = { tap, chunks, started: performance.now(), get rate() { return rate; } };
    rec.timer = setInterval(() => { ui.timer.textContent = fmtTime((performance.now() - rec.started) / 1000); }, 200);
    ui.btn.dataset.recording = 'true';
    ui.btn.replaceChildren(icon('stop'));
    ui.btn.setAttribute('aria-label', t('library.stop'));
  }

  function stopRec() {
    if (!rec) return null;
    clearInterval(rec.timer);
    rec.tap.close();
    const pcm = concatInt16(rec.chunks);
    const out = { bytes: encodeWav(pcm, rec.rate), duration: pcm.length / rec.rate, rate: rec.rate };
    rec = null;
    return out;
  }

  function recorder() {
    const timer = h('span', { class: 'rec-timer', 'aria-live': 'off' }, '0:00');
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const btn = h('button', { class: 'rec-btn', type: 'button', 'aria-label': t('library.record'), title: t('library.record') }, icon('record'));
    const box = h('div', { class: 'recorder' });
    const ui = { timer, btn, meter: null };

    function reviewBlock() {
      const name = h('input', { type: 'text', value: '', maxlength: 80, 'aria-label': t('library.name') });
      const sel = h('select', { 'aria-label': t('library.lang') }, ...['a', 'b'].map((s) => h('option', { value: ctx.sideLang(s), selected: s === lang() }, ctx.langName(s))));
      return h('div', { class: 'rec-review' },
        h('audio', { controls: true, src: review.url }),
        h('div', { class: 'row' }, name, sel),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: async () => {
            try {
              await api.put(`/api/recordings?name=${encodeURIComponent(name.value)}&kind=voice&lang=${sel.value}`, new Blob([review.bytes], { type: 'audio/wav' }));
              URL.revokeObjectURL(review.url); review = null; toast(t('library.saved'), 2500); await refresh();
            } catch { toast(t('err.save')); }
          } }, icon('check', 'ic sm'), t('library.keep')),
          h('button', { class: 'btn quiet', type: 'button', onclick: () => { URL.revokeObjectURL(review.url); review = null; render(); } }, t('library.discard'))));
    }

    btn.addEventListener('click', async () => {
      if (rec) {
        const out = stopRec();
        if (out && out.duration > 0.3) review = { ...out, url: URL.createObjectURL(new Blob([out.bytes], { type: 'audio/wav' })) };
        render();
        return;
      }
      if (review) { URL.revokeObjectURL(review.url); review = null; }
      await startRec(ui);
    });

    const main = h('div', { class: 'rec-main' }, btn, timer, h('div', { class: 'rec-meter' }, canvas));
    box.append(main);
    if (review) box.append(reviewBlock());
    queueMicrotask(() => { ui.meter = new Meter(canvas); ui.meter.set(0, 'idle'); });
    if (rec) { btn.dataset.recording = 'true'; btn.replaceChildren(icon('stop')); }
    return box;
  }

  function item(m) {
    const play = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('library.play'), title: t('library.play'),
      onclick: () => {
        if (playing === m.id && !audio.paused) { audio.pause(); return; }
        audio.src = `/api/recordings/${m.id}.wav`; playing = m.id; audio.play().catch(() => {}); render();
      } }, icon(playing === m.id && !audio.paused ? 'pause' : 'play'));
    const nameEl = h('div', { class: 'name' }, m.name);
    const rename = h('button', { class: 'icon-btn sm', type: 'button', title: t('library.rename'), 'aria-label': t('library.rename'), onclick: () => {
      const input = h('input', { type: 'text', value: m.name, maxlength: 80, 'aria-label': t('library.rename') });
      const done = async () => { const v = input.value.trim(); if (v && v !== m.name) { try { await api.json('PATCH', `/api/recordings/${m.id}`, { name: v }); } catch { toast(t('err.save')); } } refresh(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') render(); });
      input.addEventListener('blur', done);
      nameEl.replaceChildren(input); input.focus(); input.select();
    } }, icon('edit', 'ic sm'));
    const dl = h('a', { class: 'icon-btn sm', href: `/api/recordings/${m.id}.wav`, download: `${m.name}.wav`, title: t('library.download'), 'aria-label': t('library.download') }, icon('download', 'ic sm'));
    const del = h('button', { class: 'icon-btn sm', type: 'button', title: t('btn.delete'), 'aria-label': t('btn.delete') }, icon('trash', 'ic sm'));
    confirmButton(del, t('library.confirm_delete'), async () => { try { await api.del(`/api/recordings/${m.id}`); } catch { toast(t('err.save')); } refresh(); });
    const side = m.lang === ctx.sideLang('a') ? 'a' : m.lang === ctx.sideLang('b') ? 'b' : null;
    return h('li', { class: 'lib-item' }, play,
      h('div', {}, nameEl, h('div', { class: 'meta' },
        h('span', { class: 'tag' }, t(`library.kind.${m.kind}`)),
        side ? h('span', { class: 'tag', dataset: { side } }, ctx.langName(side)) : null,
        h('span', {}, t('library.duration', { s: m.duration.toFixed(1) })))),
      h('div', { class: 'actions' }, rename, dl, del));
  }

  function render() {
    clear(root);
    const file = h('input', { type: 'file', accept: 'audio/*', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try {
        const w = await fileToWav(f);
        await api.put(`/api/recordings?name=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}&kind=voice&lang=${ctx.sideLang(lang())}&source=upload`, new Blob([w.bytes], { type: 'audio/wav' }));
        toast(t('library.saved'), 2500); refresh();
      } catch (e) { toast(e && e.status ? t('err.save') : t('library.decode_fail')); }
    });
    audio.onended = audio.onpause = () => { if (root.isConnected && !rec) render(); };
    root.append(
      h('p', { class: 'lede' }, t('library.intro')),
      recorder(),
      h('p', { class: 'lede' }, t('library.tip')),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('upload', 'ic sm'), t('library.upload')), file),
      items.length ? h('ul', { class: 'lib-list' }, items.map(item)) : h('p', { class: 'empty-note' }, t('library.empty')));
  }

  ctx.store.subscribe((s, patch) => { if (patch.recVersion && root.isConnected && !rec) refresh(); });
  return { show: refresh, render };
}
