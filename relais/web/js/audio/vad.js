// Détecteur de parole à énergie, avec plancher de bruit adaptatif et hystérésis.
// Pas de modèle, pas de dépendance : une phrase commence quand l'énergie dépasse
// nettement le bruit ambiant et se termine après `silenceMs` de calme.

export class Vad {
  constructor({ silenceMs = 700, sensitivity = 0.5, frameMs = 20, minSpeechMs = 80, maxMs = 28000 } = {}) {
    this.frameMs = frameMs;
    this.dipFrames = Math.round(1500 / frameMs);
    this.minSpeechMs = minSpeechMs;
    this.maxMs = maxMs;
    this.configure({ silenceMs, sensitivity });
    this.reset();
  }

  configure({ silenceMs, sensitivity }) {
    if (silenceMs != null) this.silenceMs = silenceMs;
    if (sensitivity != null) this.sensitivity = Math.min(1, Math.max(0, sensitivity));
  }

  reset() {
    this.noise = 0.003;
    this.speaking = false;
    this.run = 0;       // durée consécutive au-dessus du seuil (ms)
    this.quiet = 0;     // durée consécutive sous le seuil bas (ms)
    this.length = 0;    // durée de la phrase en cours (ms)
    this.recent = [];   // dernières trames pendant la parole : la voix a des creux, le bruit constant non
  }

  get onThreshold() {
    const factor = 6 - 4 * this.sensitivity;          // sensibilité 0.5 -> x4 le bruit
    return Math.max(0.010, this.noise * factor);
  }

  /** Une trame d'énergie RMS [0..1]. Renvoie 'start' | 'end' | null. */
  push(rms) {
    const on = this.onThreshold;
    const off = on * 0.6;
    if (!this.speaking) {
      // le plancher de bruit descend vite, monte lentement : une voix ne le « gonfle » pas
      this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.995 + rms * 0.005;
      this.noise = Math.min(Math.max(this.noise, 0.0008), 0.05);
      this.run = rms > on ? this.run + this.frameMs : 0;
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
    this.quiet = rms < off ? this.quiet + this.frameMs : 0;
    this.recent.push(rms);
    if (this.recent.length > this.dipFrames) this.recent.shift();
    if (this.length > 3000 && this.recent.length >= this.dipFrames) {
      // Ni creux ni silence depuis 1,5 s : ce n'est pas de la parole mais un bruit continu
      // (ventilateur, climatisation). On relève le plancher : la « phrase » se termine d'elle-même.
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
