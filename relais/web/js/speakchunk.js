// « Parler en tapant » : découpe ce qui se tape en morceaux dignes d'être dits.
//
// Dire chaque mot isolément donne une voix hachée, sans intonation. Trois rythmes :
//   word      un mot dès qu'il est terminé (réactif, mais saccadé)
//   group     à la ponctuation, ou après une pause de frappe, ou à `maxWords` mots (naturel)
//   sentence  à chaque fin de phrase (le plus fluide, le plus tardif)
// `flush()` (touche Entrée) dit tout ce qui reste, y compris le dernier mot inachevé.

const CLAUSE_END = /[,;:.!?…]+["'»)\]]*\s/g;
const SENTENCE_END = /[.!?…]+["'»)\]]*\s/g;

export function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function countWords(s) {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function lastMatchEnd(re, s) {
  re.lastIndex = 0;
  let end = 0, m;
  while ((m = re.exec(s)) !== null) end = m.index + m[0].length;
  return end;
}

/** Position juste après le n-ième mot de `s` (s doit finir sur un blanc après ce mot). */
function endOfNthWord(s, n) {
  const re = /\S+/g;
  let m, i = 0, end = 0;
  while ((m = re.exec(s)) !== null && ++i <= n) end = m.index + m[0].length;
  return end;
}

export class TypeSpeaker {
  constructor({ rhythm = 'group', pauseMs = 380, minWords = 3, maxWords = 9, onChunk,
                setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
    Object.assign(this, { rhythm, pauseMs, minWords, maxWords, onChunk, setTimer, clearTimer });
    this.text = '';
    this.spoken = '';   // préfixe exact de `text` déjà dit
    this.timer = null;
  }

  configure(o) { Object.assign(this, o); }

  reset() {
    this.cancelTimer();
    this.text = '';
    this.spoken = '';
  }

  cancelTimer() {
    if (this.timer != null) { this.clearTimer(this.timer); this.timer = null; }
  }

  update(text) {
    this.text = text;
    if (!text.startsWith(this.spoken)) {
      // le début a été modifié : on ne « dédit » rien, mais ce qui a changé sera redit
      this.spoken = this.spoken.slice(0, commonPrefixLength(this.spoken, text));
    }
    this.cancelTimer();
    this.evaluate();
    if (this.pending().trim()) this.timer = this.setTimer(() => { this.timer = null; this.onPause(); }, this.pauseMs);
  }

  pending() { return this.text.slice(this.spoken.length); }

  emit(upTo) {
    const raw = this.pending().slice(0, upTo);
    const chunk = raw.trim();
    this.spoken += raw;
    if (chunk) this.onChunk(chunk);
  }

  /** Le texte terminé (jusqu'au dernier blanc) parmi ce qui reste à dire. */
  completed() {
    const p = this.pending();
    const m = p.match(/^[\s\S]*\s/);
    return m ? m[0] : '';
  }

  evaluate() {
    for (let guard = 0; guard < 50; guard++) {
      const done = this.completed();
      if (!done.trim()) return;
      let cut = 0;
      if (this.rhythm === 'word') {
        cut = done.length;
      } else if (this.rhythm === 'sentence') {
        cut = lastMatchEnd(SENTENCE_END, done);
      } else {
        cut = lastMatchEnd(CLAUSE_END, done);
        if (!cut && countWords(done) >= this.maxWords) cut = endOfNthWord(done, this.maxWords);
        else if (cut && countWords(done.slice(0, cut)) > this.maxWords) cut = endOfNthWord(done, this.maxWords);
      }
      if (!cut) return;
      this.emit(cut);
    }
  }

  onPause() {
    if (this.rhythm !== 'group') return;
    const done = this.completed();
    if (countWords(done) >= this.minWords) this.emit(done.length);
  }

  /** Entrée / fin de saisie : tout dire, dernier mot compris. */
  flush() {
    this.cancelTimer();
    this.emit(this.pending().length);
  }
}
