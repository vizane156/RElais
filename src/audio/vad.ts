// Détecteur de parole à énergie, avec plancher de bruit adaptatif et hystérésis.
// Pas de modèle, pas de dépendance : une phrase commence quand l'énergie dépasse
// nettement le bruit ambiant et se termine après `silenceMs` de calme.

export interface VadOptions {
  silenceMs?: number;
  sensitivity?: number;
  frameMs?: number;
  minSpeechMs?: number;
  maxMs?: number;
}

export class Vad {
  frameMs: number;
  dipFrames: number;
  minSpeechMs: number;
  maxMs: number;
  silenceMs: number = 700;
  sensitivity: number = 0.5;

  noise: number = 0.003;
  speaking: boolean = false;
  run: number = 0;       // durée consécutive au-dessus du seuil (ms)
  quiet: number = 0;     // durée consécutive sous le seuil bas (ms)
  length: number = 0;    // durée de la phrase en cours (ms)
  recent: number[] = []; // dernières trames pendant la parole

  constructor({
    silenceMs = 700,
    sensitivity = 0.5,
    frameMs = 20,
    minSpeechMs = 80,
    maxMs = 28000
  }: VadOptions = {}) {
    this.frameMs = frameMs;
    this.dipFrames = Math.round(1500 / frameMs);
    this.minSpeechMs = minSpeechMs;
    this.maxMs = maxMs;
    this.configure({ silenceMs, sensitivity });
    this.reset();
  }

  configure({ silenceMs, sensitivity }: { silenceMs?: number; sensitivity?: number }) {
    if (silenceMs != null) this.silenceMs = silenceMs;
    if (sensitivity != null) this.sensitivity = Math.min(1, Math.max(0, sensitivity));
  }

  reset() {
    this.noise = 0.003;
    this.speaking = false;
    this.run = 0;
    this.quiet = 0;
    this.length = 0;
    this.recent = [];
  }

  get onThreshold(): number {
    const factor = 6 - 4 * this.sensitivity;
    return Math.max(0.010, this.noise * factor);
  }

  /** Une trame d'énergie RMS [0..1]. Renvoie 'start' | 'end' | null. */
  push(rmsValue: number): 'start' | 'end' | null {
    const on = this.onThreshold;
    const off = on * 0.6;
    if (!this.speaking) {
      this.noise = rmsValue < this.noise
        ? this.noise * 0.9 + rmsValue * 0.1
        : this.noise * 0.995 + rmsValue * 0.005;
      this.noise = Math.min(Math.max(this.noise, 0.0008), 0.05);
      this.run = rmsValue > on ? this.run + this.frameMs : 0;
      if (this.run >= this.minSpeechMs) {
        this.speaking = true;
        this.recent = [];
        this.quiet = 0;
        this.length = this.run;
        return 'start';
      }
      return null;
    }
    this.length += this.frameMs;
    this.quiet = rmsValue < off ? this.quiet + this.frameMs : 0;
    this.recent.push(rmsValue);
    if (this.recent.length > this.dipFrames) this.recent.shift();
    if (this.length > 3000 && this.recent.length >= this.dipFrames) {
      const floor = Math.min(...this.recent);
      if (floor > off) this.noise = Math.min(Math.max(this.noise, floor * 0.8), 0.2);
    }
    if (this.quiet >= this.silenceMs || this.length >= this.maxMs) {
      this.speaking = false;
      this.run = 0;
      return 'end';
    }
    return null;
  }
}
