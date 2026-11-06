/**
 * Lecture sans trou : chaque morceau PCM reçu est programmé juste après le précédent sur
 * l'horloge audio. Événements : start (la voix démarre), idle (plus rien à jouer).
 */
export class Player extends EventTarget {
  ctx: AudioContext | null = null;
  gain: GainNode | null = null;
  next: number = 0;
  sources: Set<AudioBufferSourceNode> = new Set();
  volume: number = 0.9;
  sinkId: string = '';
  active: boolean = false;
  played: number = 0;

  ensure(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      if (this.sinkId) this.setSink(this.sinkId);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get speaking(): boolean {
    return this.sources.size > 0;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  async setSink(id: string) {
    this.sinkId = id || '';
    if (this.ctx && typeof (this.ctx as unknown as { setSinkId: (s: string) => Promise<void> }).setSinkId === 'function') {
      try {
        await (this.ctx as unknown as { setSinkId: (s: string) => Promise<void> }).setSinkId(this.sinkId);
      } catch {
        /* périphérique absent : on garde la sortie par défaut */
      }
    }
  }

  enqueue(int16: Int16Array, sampleRate: number) {
    if (!int16.length) return;
    const ctx = this.ensure();
    const buf = ctx.createBuffer(1, int16.length, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
    const fade = Math.min(Math.round(sampleRate * 0.004), (int16.length / 2) | 0);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      ch[i] *= g;
      ch[int16.length - 1 - i] *= g;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (this.gain) src.connect(this.gain);
    const at = Math.max(ctx.currentTime + 0.03, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.sources.add(src);
    this.played += 1;
    if (!this.active) {
      this.active = true;
      this.dispatchEvent(new Event('start'));
    }
    src.onended = () => {
      this.sources.delete(src);
      this.maybeIdle();
    };
  }

  maybeIdle() {
    if (this.active && this.sources.size === 0) {
      this.active = false;
      this.next = 0;
      this.dispatchEvent(new Event('idle'));
    }
  }

  cancel() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    this.sources.clear();
    this.next = 0;
    this.maybeIdle();
  }
}
