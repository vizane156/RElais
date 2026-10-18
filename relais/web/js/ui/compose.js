import { $ } from '../dom.js';
import { t } from '../i18n.js';
import { TypeSpeaker } from '../speakchunk.js';

const other = (s) => (s === 'a' ? 'b' : 'a');

/** Zone de saisie : aperçu de traduction en direct, parole au fil de la frappe, envoi. */
export function initCompose(ctx) {
  const form = $('#compose'), input = $('#input'), send = $('#send'), preview = $('#preview');
  const typeChip = $('#typeLang'), sayChip = $('#sayLang'), saidEl = $('#said'), stop = $('#stopVoice');
  let previewTimer = null, saidTimer = null, previewSeq = 0, sentSeq = 0;

  const S = () => ctx.store.get().settings;
  const capOn = (id) => { const c = ctx.store.get().caps[id]; return !!(c && c.enabled && c.state === 'ready'); };
  const resolve = (v) => (v === 'me' ? (S()['pair.me'] || 'b') : other(S()['pair.me'] || 'b'));
  const typeSide = () => resolve(S()['type.lang'] || 'me');
  const saySide = () => resolve(S()['type.say'] || 'other');

  const speaker = new TypeSpeaker({
    onChunk: (text) => {
      ctx.player.ensure();
      ctx.link.send({ t: 'say', id: ++ctx.seq, text, from: typeSide(), say: saySide() });
    },
  });

  function configureSpeaker() {
    const s = S();
    speaker.configure({ rhythm: s['type.rhythm'], pauseMs: s['type.pause_ms'], minWords: s['type.min_words'] });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 144)}px`;
  }

  function renderChips() {
    for (const [chip, side] of [[typeChip, typeSide()], [sayChip, saySide()]]) {
      chip.dataset.side = side;
      chip.querySelector('.chip-text').textContent = ctx.langName(side);
    }
    preview.dataset.side = other(typeSide());
  }

  function clearPreview() { preview.textContent = ''; }

  function schedulePreview() {
    clearTimeout(previewTimer);
    const text = input.value;
    if (!text.trim()) { clearPreview(); return; }
    if (!capOn('translate') || S()['translate.live'] === false) { clearPreview(); return; }
    previewTimer = setTimeout(() => {
      sentSeq = ++ctx.seq;
      previewSeq = sentSeq;
      ctx.link.send({ t: 'tr', id: sentSeq, text, from: typeSide(), final: false });
    }, 110);
  }

  function showPreview(msg) {
    if (msg.id !== previewSeq || !input.value.trim()) return;
    preview.replaceChildren();
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t('compose.preview', { lang: ctx.langName(other(typeSide())) });
    preview.append(label, document.createTextNode(msg.text));
  }

  function showSaid(text) {
    saidEl.textContent = `${t('compose.said')} : ${text}`;
    clearTimeout(saidTimer);
    saidTimer = setTimeout(() => { saidEl.textContent = ''; }, 5000);
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    const id = ++ctx.seq;
    const ts = capOn('typespeak'), speakOn = capOn('speak'), trOn = capOn('translate');
    const tSide = typeSide(), sSide = saySide(), same = tSide === sSide;
    ctx.player.ensure();
    if (ts) speaker.flush();
    ctx.folio.update({ key: `t${id}`, side: tSide, text, state: trOn ? 'pending' : 'final', ts: Date.now() });
    if (trOn) {
      ctx.link.send({ t: 'tr', id, text, from: tSide, final: true, log: true,
                      speak: speakOn && !ts && !same && S()['speak.translations'] !== false });
    }
    if (speakOn && !ts && same) ctx.link.send({ t: 'speak', id, text, lang: ctx.sideLang(tSide) });
    speaker.reset();
    input.value = '';
    clearTimeout(previewTimer);
    previewSeq = 0;
    clearPreview();
    autosize();
    send.disabled = true;
  }

  input.addEventListener('input', () => {
    autosize();
    send.disabled = !input.value.trim();
    schedulePreview();
    if (capOn('typespeak')) speaker.update(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') ctx.stopVoice();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  typeChip.addEventListener('click', () => ctx.setSetting({ 'type.lang': S()['type.lang'] === 'me' ? 'other' : 'me' }));
  sayChip.addEventListener('click', () => ctx.setSetting({ 'type.say': S()['type.say'] === 'other' ? 'me' : 'other' }));
  stop.addEventListener('click', () => ctx.stopVoice());

  ctx.store.subscribe((s, patch) => {
    if (patch.settings || patch.pair || patch.lang) { configureSpeaker(); renderChips(); }
    if (patch.speaking !== undefined || patch.jobs !== undefined) stop.hidden = !(s.speaking || s.jobs > 0);
    if (patch.caps && !capOn('typespeak')) speaker.reset();
  });
  configureSpeaker();
  renderChips();
  autosize();
  return { showPreview, showSaid, focus: () => input.focus() };
}
