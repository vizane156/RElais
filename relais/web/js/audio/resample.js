// Rééchantillonnage vers 16 kHz : moyenne pondérée sur la fenêtre source de chaque
// échantillon de sortie (filtre passe-bas rudimentaire, suffisant pour la parole).

export class Resampler {
  constructor(srcRate, dstRate = 16000) {
    this.srcRate = srcRate;
    this.ratio = srcRate / dstRate;
    this.tail = new Float32Array(0);
    this.pos = 0;
  }

  process(input) {
    if (this.ratio === 1) return input;
    const buf = new Float32Array(this.tail.length + input.length);
    buf.set(this.tail, 0);
    buf.set(input, this.tail.length);
    const out = [];
    let pos = this.pos;
    while (pos + this.ratio <= buf.length) {
      const a = pos, b = pos + this.ratio;
      let acc = 0, wsum = 0;
      for (let k = Math.floor(a); k < Math.ceil(b); k++) {
        const w = Math.min(k + 1, b) - Math.max(k, a);
        acc += buf[k] * w;
        wsum += w;
      }
      out.push(acc / wsum);
      pos = b;
    }
    const drop = Math.floor(pos);
    this.tail = buf.slice(drop);
    this.pos = pos - drop;
    return Float32Array.from(out);
  }
}

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

export function rms(f32) {
  if (!f32.length) return 0;
  let acc = 0;
  for (let i = 0; i < f32.length; i++) acc += f32[i] * f32[i];
  return Math.sqrt(acc / f32.length);
}
