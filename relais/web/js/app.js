// Chef d'orchestre : relie le micro, le réseau, la lecture audio et l'interface.
import { createStore } from './store.js';
import { Link, parseAudioFrame } from './ws.js';
import { loadLang, applyI18n, initialLang, currentLang, t, hasKey } from './i18n.js';
import { api } from './api.js';
import { applyUi } from './theme.js';
import { Capture } from './audio/capture.js';
import { Player } from './audio/player.js';
import { $, h, clear } from './dom.js';
import { toast } from './ui/toast.js';
import { Meter } from './ui/meter.js';
import { initKeys } from './ui/keys.js';
import { initFolio } from './ui/folio.js';
import { initCompose } from './ui/compose.js';
import { initSheet } from './ui/sheet.js';

const other = (s) => (s === 'a' ? 'b' : 'a');

async function boot() {
  await loadLang(initialLang());
  applyI18n();

  const store = createStore({
    conn: 'connecting', engines: 'real', schema: null, settings: {}, caps: {}, profiles: [],
    pair: { a: 'en', b: 'fr', names: { en: 'English', fr: 'Français' } },
    voices: { a: [], b: [] }, lat: {}, lang: currentLang(), speaking: false, jobs: 0, recVersion: 0,
  });
  const link = new Link();
  const player = new Player();
  const capture = new Capture();
  const S = () => store.get().settings;

  const ctx = {
    store, link, player, capture, api, t,
    seq: (Math.floor(Date.now() / 1000) % 100000) * 100,
    sideLang: (side) => store.get().pair[side],
    langName: (side) => { const p = store.get().pair; return p.names[p[side]] || p[side]; },
    setLocal: (patch) => store.set({ settings: { ...S(), ...patch } }),
    setSetting: (patch) => { store.set({ settings: { ...S(), ...patch } }); link.send({ t: 'set', patch }); },
    capOn: (id) => { const c = store.get().caps[id]; return !!(c && c.enabled && c.state === 'ready'); },
  };

  const meter = new Meter($('#meter'));
  ctx.sheet = initSheet(ctx);
  ctx.folio = initFolio(ctx);
  const compose = initCompose(ctx);
  initKeys(ctx);

  // ---- voix : lecture et coupure ------------------------------------------------------------
  ctx.stopVoice = () => { link.send({ t: 'speak.cancel' }); player.cancel(); store.set({ jobs: 0 }); updateMute(); };
  ctx.speakText = (text, lang) => {
    if (!text) return;
    if (!ctx.capOn('speak')) { toast(t('err.cap_off', { cap: t('cap.speak') })); return; }
    player.ensure();
    link.send({ t: 'speak', id: ++ctx.seq, text, lang });
  };

  let unmuteTimer = null;
  const busy = () => player.speaking || store.get().jobs > 0;
  function updateMute() {
    clearTimeout(unmuteTimer);
    if (!S()['listen.echo_guard']) { capture.setMuted(false); return; }
    if (busy()) capture.setMuted(true);
    else unmuteTimer = setTimeout(() => { if (!busy()) capture.setMuted(false); }, 350);
  }
  player.addEventListener('start', () => { store.set({ speaking: true }); updateMute(); });
  player.addEventListener('idle', () => { store.set({ speaking: false }); updateMute(); });
  document.addEventListener('pointerdown', () => player.ensure(), { once: true });

  // ---- écoute : micro -> phrases -> serveur --------------------------------------------------
  let uttId = 0, uttOpen = false;
  capture.addEventListener('speechstart', () => { uttId = ++ctx.seq; uttOpen = true; link.send({ t: 'ut.start', id: uttId, who: S()['listen.who'] }); });
  capture.addEventListener('frames', (e) => { if (uttOpen) link.sendAudio(e.detail); });
  capture.addEventListener('speechend', () => { if (uttOpen) { uttOpen = false; link.send({ t: 'ut.end', id: uttId }); } });

  let meterMode = '';
  function setMeterMode(mode) {
    if (mode === meterMode) return;
    meterMode = mode;
    $('#meterState').textContent = t({ idle: 'level.idle', live: 'level.live', speech: 'level.speech', muted: 'level.muted' }[mode]);
  }
  capture.addEventListener('level', (e) => {
    const { level, speaking, muted } = e.detail;
    const mode = muted ? 'muted' : speaking ? 'speech' : 'live';
    setMeterMode(mode);
    meter.set(muted ? 0 : level, mode);
  });
  capture.addEventListener('close', () => { setMeterMode('idle'); meter.set(0, 'idle'); });
  capture.addEventListener('muted', () => { if (!capture.running) return; });

  ctx.startListening = async () => {
    if (capture.running) return true;
    capture.configure({ silenceMs: S()['listen.silence_ms'], sensitivity: S()['listen.sensitivity'] });
    try {
      try { await capture.open(S()['listen.device'] || ''); }
      catch (e) { if (e && e.name === 'OverconstrainedError') await capture.open(''); else throw e; }
    } catch (e) {
      capture.close();
      toast(e && e.code === 'no_mic_api' ? t('err.no_mic_api') : e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? t('err.mic_denied') : t('err.mic'));
      return false;
    }
    if (capture.tap.suspended) {
      toast(t('err.resume'));
      document.addEventListener('pointerdown', () => capture.tap.resume().catch(() => {}), { once: true });
    }
    return true;
  };

  function syncListening() {
    const on = ctx.capOn('listen');
    if (on && !capture.running) ctx.startListening();
    if (!on && capture.running) capture.close();
  }

  // ---- affichage : paire de langues, « qui parle », délais, connexion -------------------------
  function renderPair() {
    const left = S()['pair.left'] || 'a';
    const tagL = $('#tagLeft'), tagR = $('#tagRight');
    tagL.dataset.side = left; tagL.textContent = ctx.langName(left);
    tagR.dataset.side = other(left); tagR.textContent = ctx.langName(other(left));
    $('#titleA').textContent = ctx.langName('a');
    $('#titleB').textContent = ctx.langName('b');
    $('#folioHead').dataset.left = left;
    $('#folio').dataset.left = left;
  }

  function renderWho() {
    const box = $('#who');
    const cur = S()['listen.who'] || 'auto';
    clear(box);
    for (const [val, label, side] of [['auto', t('who.auto'), null], ['a', ctx.langName('a'), 'a'], ['b', ctx.langName('b'), 'b']]) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === val), dataset: side ? { side } : {} },
        side ? h('span', { class: 'swatch', 'aria-hidden': 'true' }) : null, label);
      b.addEventListener('click', () => ctx.setSetting({ 'listen.who': val }));
      box.append(b);
    }
  }

  function renderLat() {
    const lat = store.get().lat;
    const row = (label, v) => h('div', {}, h('dt', {}, label), h('dd', {}, v == null ? '—' : `${Math.round(v)} ms`));
    const box = $('#lat');
    clear(box);
    box.append(row(t('lat.stt'), lat.stt), row(t('lat.mt'), lat.mt), row(t('lat.tts'), lat.tts));
  }
  const setLat = (patch) => store.set({ lat: { ...store.get().lat, ...patch } });

  function renderConn() {
    const c = store.get().conn;
    $('#conn').dataset.state = c;
    $('#connText').textContent = t(`conn.${c}`);
    $('#conn').title = c === 'closed' ? t('conn.hint') : t('conn.open');
  }

  $('#swap').addEventListener('click', () => ctx.setSetting({ 'pair.left': (S()['pair.left'] || 'a') === 'a' ? 'b' : 'a' }));

  // ---- réactions à l'état ----------------------------------------------------------------------
  let langSwitching = false;
  store.subscribe(async (s, patch, prev) => {
    if (patch.settings) {
      const st = s.settings;
      applyUi(st);
      renderPair(); renderWho();
      capture.configure({ silenceMs: st['listen.silence_ms'], sensitivity: st['listen.sensitivity'] });
      player.setVolume(st['speak.volume'] ?? 0.9);
      if (prev.settings['speak.device'] !== st['speak.device']) player.setSink(st['speak.device']);
      if (capture.running && prev.settings['listen.device'] !== undefined && prev.settings['listen.device'] !== st['listen.device']) {
        capture.close(); ctx.startListening();
      }
      if (!st['listen.echo_guard']) capture.setMuted(false);
      const want = st['ui.lang'];
      if (want && want !== currentLang() && !langSwitching) {
        langSwitching = true;
        try { await loadLang(want); applyI18n(); store.set({ lang: want }); } finally { langSwitching = false; }
      }
    }
    if (patch.caps) syncListening();
    if (patch.lang || patch.pair) { renderPair(); renderWho(); renderLat(); renderConn(); $('#demoBadge').title = t('demo.hint'); }
    if (patch.lat) renderLat();
    if (patch.conn) renderConn();
    if (patch.engines) $('#demoBadge').hidden = s.engines !== 'mock';
    if (patch.jobs !== undefined) updateMute();
  });

  // ---- messages du serveur ----------------------------------------------------------------------
  let historyLoaded = false;

  function onState(m) {
    const caps = {};
    for (const c of m.caps) caps[c.id] = c;
    store.set({ engines: m.engines, pair: m.pair, settings: m.settings, caps, voices: m.voices, profiles: m.profiles });
    if (!historyLoaded) {
      historyLoaded = true;
      api.get('/api/history?limit=200').then((r) => ctx.folio.load(r.items)).catch(() => {});
    }
    if (!store.get().schema) api.get('/api/schema').then((schema) => store.set({ schema })).catch(() => {});
    player.setSink(m.settings['speak.device']);
    syncListening();
  }

  function onStt(m) {
    const key = `u${m.id}`;
    if (m.final && !m.text) { ctx.folio.remove(key); return; }
    ctx.folio.update({ key, side: m.side, text: m.text, state: m.final ? (ctx.capOn('translate') ? 'pending' : 'final') : 'live', ts: Date.now() });
    if (m.final && m.ms != null) setLat({ stt: m.ms });
  }

  function onTr(m) {
    if (m.kind === 'utterance') {
      ctx.folio.update({ key: `u${m.id}`, side: m.side, text: m.source, translation: m.text, to: m.to, state: m.final ? 'final' : 'live' });
      if (m.final && m.ms != null) setLat({ mt: m.ms });
    } else if (m.final) {
      ctx.folio.update({ key: `t${m.id}`, side: m.side, text: m.source, translation: m.text, to: m.to, state: 'final' });
      if (m.ms != null) setLat({ mt: m.ms });
    } else {
      compose.showPreview(m);
    }
  }

  function onError(m) {
    const p = { ...(m.params || {}) };
    if (p.cap) p.cap = t(`cap.${p.cap}`);
    if (Array.isArray(p.keys)) p.keys = p.keys.join(', ');
    toast(hasKey(m.key) ? t(m.key, p) : `${m.code}`);
  }

  link.addEventListener('connecting', () => store.set({ conn: 'connecting' }));
  link.addEventListener('open', () => { store.set({ conn: 'open' }); link.send({ t: 'hello' }); });
  link.addEventListener('close', () => store.set({ conn: 'closed', jobs: 0 }));
  link.addEventListener('binary', (e) => {
    const f = parseAudioFrame(e.detail);
    if (f && ctx.capOn('speak')) player.enqueue(f.pcm, f.sampleRate);
  });
  link.addEventListener('json', (e) => {
    const m = e.detail;
    switch (m.t) {
      case 'state': onState(m); break;
      case 'settings': store.set({ settings: m.values }); break;
      case 'cap': store.set({ caps: { ...store.get().caps, [m.id]: { id: m.id, enabled: m.enabled, state: m.state, detail: m.detail } } }); break;
      case 'voices': store.set({ voices: m.voices }); break;
      case 'stt': onStt(m); break;
      case 'tr': onTr(m); break;
      case 'said': compose.showSaid(m.text); break;
      case 'speak.start': store.set({ jobs: store.get().jobs + 1 }); break;
      case 'speak.end': store.set({ jobs: Math.max(0, store.get().jobs - 1) }); if (m.ms_first != null) setLat({ tts: m.ms_first }); break;
      case 'speak.cancelled': player.cancel(); store.set({ jobs: 0 }); break;
      case 'rec': store.set({ recVersion: store.get().recVersion + 1 }); break;
      case 'error': onError(m); break;
      default: break;
    }
  });

  renderPair(); renderWho(); renderLat(); renderConn(); setMeterMode('idle'); meter.set(0, 'idle');
  link.connect();
  if (location.search.includes('debug')) window.__relais = ctx;
}

boot().catch((err) => {
  console.error(err);
  document.body.prepend(h('pre', { class: 'boot-error' }, `Relais : ${err && err.message ? err.message : err}`));
});
