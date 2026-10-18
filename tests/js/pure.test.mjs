import test from 'node:test';
import assert from 'node:assert/strict';
import { Vad } from '../../relais/web/js/audio/vad.js';
import { Resampler, floatToInt16, rms } from '../../relais/web/js/audio/resample.js';
import { encodeWav, concatInt16, mixToMono } from '../../relais/web/js/audio/wav.js';
import { TypeSpeaker, commonPrefixLength } from '../../relais/web/js/speakchunk.js';

// ---------------------------------------------------------------- VAD
const feed = (vad, level, ms) => {
  const ev = [];
  for (let t = 0; t < ms; t += 20) { const e = vad.push(level); if (e) ev.push(e); }
  return ev;
};

test('vad: silence ne déclenche rien, parole puis silence donne start puis end', () => {
  const v = new Vad({ silenceMs: 600 });
  assert.deepEqual(feed(v, 0.002, 2000), []);
  assert.deepEqual(feed(v, 0.08, 400), ['start']);
  assert.deepEqual(feed(v, 0.002, 400), []);          // pas encore 600 ms de calme
  assert.deepEqual(feed(v, 0.002, 400), ['end']);
});

test('vad: une pause plus courte que silenceMs ne coupe pas la phrase', () => {
  const v = new Vad({ silenceMs: 700 });
  feed(v, 0.08, 300);
  assert.deepEqual(feed(v, 0.002, 400), []);
  assert.deepEqual(feed(v, 0.08, 300), []);
  assert.equal(v.speaking, true);
});

test('vad: un claquement très bref est ignoré', () => {
  const v = new Vad({ minSpeechMs: 80 });
  assert.deepEqual(feed(v, 0.5, 40), []);
  assert.deepEqual(feed(v, 0.002, 200), []);
});

test('vad: la sensibilité abaisse le seuil', () => {
  const lo = new Vad({ sensitivity: 0 }), hi = new Vad({ sensitivity: 1 });
  assert.ok(hi.onThreshold <= lo.onThreshold);
});

test('vad: un bruit continu fort est pris pour du bruit, pas pour une phrase sans fin', () => {
  const v = new Vad();
  const ev = feed(v, 0.02, 9000);                     // ventilateur qui démarre et ne s'arrête plus
  assert.equal(v.speaking, false);
  assert.ok(ev.length <= 2, `trop d'événements : ${ev}`);
  assert.ok(v.onThreshold > 0.04, `seuil ${v.onThreshold}`);
  assert.deepEqual(feed(v, 0.3, 300), ['start']);     // et une vraie voix passe toujours
});

test('vad: la voix, avec ses creux entre les mots, n\'est jamais prise pour du bruit', () => {
  const v = new Vad({ silenceMs: 700 });
  let ends = 0;
  feed(v, 0.002, 400);
  for (let w = 0; w < 12; w++) {                      // 12 mots sur ~6 s, 120 ms de creux entre chaque
    if (feed(v, 0.12, 380).includes('end')) ends++;
    if (feed(v, 0.004, 120).includes('end')) ends++;
  }
  assert.equal(ends, 0);
  assert.equal(v.speaking, true);
});

test('vad: une phrase trop longue est coupée', () => {
  const v = new Vad({ maxMs: 1000 });
  const ev = feed(v, 0.1, 1400);
  assert.deepEqual(ev.slice(0, 2), ['start', 'end']);
});

// ---------------------------------------------------------------- rééchantillonnage
test('resample: 48 kHz -> 16 kHz garde la durée, par blocs comme dans le navigateur', () => {
  const r = new Resampler(48000, 16000);
  let total = 0;
  const f = (i) => Math.sin(2 * Math.PI * 440 * i / 48000);
  for (let b = 0; b < 50; b++) {                      // 50 blocs de 20 ms = 1 s
    const block = Float32Array.from({ length: 960 }, (_, i) => f(b * 960 + i));
    total += r.process(block).length;
  }
  assert.ok(Math.abs(total - 16000) <= 2, `obtenu ${total}`);
});

test('resample: 44,1 kHz (rapport non entier) garde la durée et l\'amplitude', () => {
  const r = new Resampler(44100, 16000);
  let n = 0, peak = 0;
  for (let b = 0; b < 50; b++) {
    const block = Float32Array.from({ length: 882 }, (_, i) => Math.sin(2 * Math.PI * 300 * (b * 882 + i) / 44100));
    const out = r.process(block);
    n += out.length;
    for (const s of out) peak = Math.max(peak, Math.abs(s));
  }
  assert.ok(Math.abs(n - 16000) <= 2, `obtenu ${n}`);
  assert.ok(peak > 0.95 && peak <= 1.0, `crête ${peak}`);
});

test('resample: même fréquence = passage direct', () => {
  const x = new Float32Array([0.1, 0.2]);
  assert.equal(new Resampler(16000, 16000).process(x), x);
});

test('int16 et rms', () => {
  const i = floatToInt16(Float32Array.from([0, 1, -1, 2, -2]));
  assert.deepEqual([...i], [0, 32767, -32768, 32767, -32768]);
  assert.ok(Math.abs(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6);
});

// ---------------------------------------------------------------- WAV
test('wav: en-tête valide', () => {
  const pcm = Int16Array.from([1, -1, 300, -300]);
  const w = encodeWav(pcm, 16000);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(w.length, 44 + 8);
  assert.equal(v.getInt16(46, true), -1);
  assert.equal(concatInt16([Int16Array.from([1]), Int16Array.from([2, 3])]).length, 3);
  assert.deepEqual([...mixToMono([Float32Array.from([1, 1]), Float32Array.from([0, 1])])], [0.5, 1]);
});

// ---------------------------------------------------------------- parler en tapant
const typeAll = (h, str) => { for (let i = 1; i <= str.length; i++) h.type(str.slice(0, i)); };

function harness(opts = {}) {
  const chunks = [];
  const timers = [];
  const s = new TypeSpeaker({
    onChunk: (c) => chunks.push(c),
    setTimer: (f, ms) => { const t = { f, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
    ...opts,
  });
  const type = (text) => s.update(text);
  const pause = () => { const t = timers.filter((x) => x.live).pop(); if (t) { t.live = false; t.f(); } };
  return { s, chunks, type, pause };
}

test('chunk/word: un mot dès qu\'il est terminé', () => {
  const { chunks, type } = harness({ rhythm: 'word' });
  type('Bon'); type('Bonjour'); assert.deepEqual(chunks, []);
  type('Bonjour '); assert.deepEqual(chunks, ['Bonjour']);
  type('Bonjour je '); assert.deepEqual(chunks, ['Bonjour', 'je']);
});

test('chunk/group: ponctuation = morceau ; pause = morceau si assez de mots', () => {
  const { chunks, type, pause } = harness({ rhythm: 'group', minWords: 3 });
  type('Bonjour, '); assert.deepEqual(chunks, ['Bonjour,']);
  type('Bonjour, je vois '); assert.deepEqual(chunks, ['Bonjour,']);
  pause(); assert.deepEqual(chunks, ['Bonjour,']);                 // 2 mots < minWords
  type('Bonjour, je vois ce que '); pause();
  assert.deepEqual(chunks, ['Bonjour,', 'je vois ce que']);
});

test('chunk/group: pas plus de maxWords mots sans respirer', () => {
  const { chunks, type } = harness({ rhythm: 'group', maxWords: 4 });
  type('un deux trois quatre cinq six ');
  assert.deepEqual(chunks, ['un deux trois quatre']);
});

test('chunk/sentence: seulement aux fins de phrase', () => {
  const { chunks, type, pause } = harness({ rhythm: 'sentence' });
  type('Il fait beau, vraiment très beau '); pause();
  assert.deepEqual(chunks, []);
  type('Il fait beau, vraiment très beau. Et toi ? ');
  assert.deepEqual(chunks, ['Il fait beau, vraiment très beau. Et toi ?']);
});

test('chunk: flush dit le dernier mot inachevé, une seule fois', () => {
  const { s, chunks, type } = harness({ rhythm: 'group' });
  type('Merci beaucoup'); s.flush();
  assert.deepEqual(chunks, ['Merci beaucoup']);
  s.flush();
  assert.deepEqual(chunks, ['Merci beaucoup']);
});

test('chunk: modifier le début ne redit pas ce qui est inchangé', () => {
  const h = harness({ rhythm: 'word' });
  typeAll(h, 'un deux trois ');
  assert.deepEqual(h.chunks, ['un', 'deux', 'trois']);
  h.type('un DEUX trois ');                                      // « deux » corrigé : redit à partir de là
  assert.deepEqual(h.chunks.slice(3), ['DEUX trois']);
});

test('chunk: effacer tout puis retaper ne redit pas l\'ancien', () => {
  const h = harness({ rhythm: 'word' });
  typeAll(h, 'salut ');
  h.s.reset(); h.type('');
  typeAll(h, 'ça va ');
  assert.deepEqual(h.chunks, ['salut', 'ça', 'va']);
});

test('chunk/group: frappe réaliste, lettre par lettre, avec pauses', () => {
  const h = harness({ rhythm: 'group', minWords: 3 });
  typeAll(h, 'Bonjour, je vois ');
  assert.deepEqual(h.chunks, ['Bonjour,']);
  h.pause();                                                     // 2 mots seulement : on attend
  typeAll2(h, 'Bonjour, je vois ', 'ce que vous dites ');
  h.pause();
  assert.deepEqual(h.chunks, ['Bonjour,', 'je vois ce que vous dites']);
  h.s.flush();
  assert.deepEqual(h.chunks.length, 2);
});

function typeAll2(h, base, more) { for (let i = 1; i <= more.length; i++) h.type(base + more.slice(0, i)); }

test('chunk: coller un long texte ne boucle pas et rien ne se perd', () => {
  const { s, chunks, type } = harness({ rhythm: 'group', maxWords: 5 });
  const text = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ') + ' ';
  type(text); s.flush();
  assert.equal(chunks.join(' '), text.trim());
});

test('commonPrefixLength', () => {
  assert.equal(commonPrefixLength('abcd', 'abxd'), 2);
  assert.equal(commonPrefixLength('', 'a'), 0);
});
