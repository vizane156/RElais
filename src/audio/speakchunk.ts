// « Parler en tapant » : découpe ce qui se tape en morceaux dignes d'être dits.
// Trois rythmes :
//   word      un mot dès qu'il est terminé (réactif, mais saccadé)
//   group     à la ponctuation, ou après une pause de frappe, ou à `maxWords` mots (naturel)
//   sentence  à chaque fin de phrase (le plus fluide, le plus tardif)
// `flush()` (touche Entrée) dit tout ce qui reste, y compris le dernier mot inachevé.

const CLAUSE_END = /[,;:.!?…]+["'»)\]]*\s/g;
const SENTENCE_END = /[.!?…]+["'»)\]]*\s/g;

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function lastMatchEnd(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let end = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) end = m.index + m[0].length;
  return end;
}

function endOfNthWord(s: string, n: number): number {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let i = 0;
  let end = 0;
  while ((m = re.exec(s)) !== null && ++i <= n) end = m.index + m[0].length;
  return end;
}

export interface TypeSpeakerOptions {
  rhythm?: 'word' | 'group' | 'sentence';
  pauseMs?: number;
  minWords?: number;
  maxWords?: number;
  onChunk: (text: string) => void;
  setTimer?: (f: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export class TypeSpeaker {
  rhythm: 'word' | 'group' | 'sentence' = 'group';
  pauseMs: number = 380;
  minWords: number = 3;
  maxWords: number = 9;
  onChunk: (text: string) => void;
  setTimer: (f: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (t: ReturnType<typeof setTimeout>) => void;

  text: string = '';
  spoken: string = '';
  timer: ReturnType<typeof setTimeout> | null = null;

  constructor({
    rhythm = 'group',
    pauseMs = 380,
    minWords = 3,
    maxWords = 9,
    onChunk,
    setTimer = (f, ms) => setTimeout(f, ms),
    clearTimer = (t) => clearTimeout(t),
  }: TypeSpeakerOptions) {
    this.rhythm = rhythm;
    this.pauseMs = pauseMs;
    this.minWords = minWords;
    this.maxWords = maxWords;
    this.onChunk = onChunk;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  configure(o: Partial<TypeSpeakerOptions>) {
    if (o.rhythm) this.rhythm = o.rhythm;
    if (o.pauseMs != null) this.pauseMs = o.pauseMs;
    if (o.minWords != null) this.minWords = o.minWords;
    if (o.maxWords != null) this.maxWords = o.maxWords;
  }

  reset() {
    this.cancelTimer();
    this.text = '';
    this.spoken = '';
  }

  cancelTimer() {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  update(text: string) {
    this.text = text;
    if (!text.startsWith(this.spoken)) {
      this.spoken = this.spoken.slice(0, commonPrefixLength(this.spoken, text));
    }
    this.cancelTimer();
    this.evaluate();
    if (this.pending().trim()) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.onPause();
      }, this.pauseMs);
    }
  }

  pending(): string {
    return this.text.slice(this.spoken.length);
  }

  emit(upTo: number) {
    const raw = this.pending().slice(0, upTo);
    const chunk = raw.trim();
    this.spoken += raw;
    if (chunk) this.onChunk(chunk);
  }

  completed(): string {
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

  flush() {
    this.cancelTimer();
    this.emit(this.pending().length);
  }
}
