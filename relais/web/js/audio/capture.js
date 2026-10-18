import { Vad } from './vad.js';
import { Resampler, floatToInt16, rms } from './resample.js';

/** Le micro, brut : des trames Float32 de 20 ms à la fréquence native de la carte son. */
export class MicTap {
  constructor() { this.ctx = null; this.stream = null; this.node = null; this.src = null; }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }
  get suspended() { return !!this.ctx && this.ctx.state === 'suspended'; }
  async resume() { if (this.ctx) await this.ctx.resume(); }

  async open(deviceId, onFrame) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('no_mic_api'), { code: 'no_mic_api' });
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      },
    });
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule('/js/audio/capture.worklet.js');
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    // `ctx` est capturé : une trame encore en vol après close() ne doit pas lire this.ctx (déjà nul)
    this.node.port.onmessage = (e) => { if (this.ctx === ctx) onFrame(e.data, ctx.sampleRate); };
    const silent = ctx.createGain();   // le nœud doit être relié à la sortie pour être exécuté
    silent.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(silent).connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  }

  close() {
    try { this.node && this.node.port.close(); } catch { /* ignore */ }
    if (this.node) this.node.disconnect();
    if (this.src) this.src.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = this.stream = this.node = this.src = null;
  }
}

/**
 * Écoute continue : micro -> détection de parole -> phrases.
 * Événements : level, speechstart, frames (Int16Array 16 kHz), speechend, muted, open, close.
 */
export class Capture extends EventTarget {
  constructor() {
    super();
    this.tap = new MicTap();
    this.vad = new Vad();
    this.resampler = null;
    this.preroll = [];
    this.prerollMax = 15;      // 300 ms gardées avant le début détecté : la 1re syllabe n'est pas coupée
    this.speaking = false;
    this.muted = false;
    this.running = false;
  }

  configure(o) { this.vad.configure(o); }

  async open(deviceId) {
    if (this.running) return;
    this.resampler = null;
    this.vad.reset();
    this.preroll = [];
    await this.tap.open(deviceId, (f, sr) => this.onFrame(f, sr));
    this.running = true;
    this.dispatchEvent(new Event('open'));
  }

  close() {
    if (this.speaking) { this.speaking = false; this.dispatchEvent(new Event('speechend')); }
    this.tap.close();
    this.running = false;
    this.preroll = [];
    this.dispatchEvent(new Event('close'));
  }

  setMuted(m) {
    if (m === this.muted) return;
    this.muted = m;
    if (m) {
      if (this.speaking) { this.speaking = false; this.dispatchEvent(new Event('speechend')); }
      this.vad.reset();
      this.preroll = [];
    }
    this.dispatchEvent(new CustomEvent('muted', { detail: m }));
  }

  onFrame(f32, sr) {
    const level = rms(f32);
    this.dispatchEvent(new CustomEvent('level', { detail: { level, speaking: this.speaking, muted: this.muted } }));
    if (this.muted) return;
    if (!this.resampler || this.resampler.srcRate !== sr) this.resampler = new Resampler(sr, 16000);
    const pcm = floatToInt16(this.resampler.process(f32));
    const ev = this.vad.push(level);
    if (ev === 'start') {
      this.speaking = true;
      this.dispatchEvent(new Event('speechstart'));
      for (const p of this.preroll) this.dispatchEvent(new CustomEvent('frames', { detail: p }));
      this.preroll = [];
    }
    if (this.speaking) {
      if (pcm.length) this.dispatchEvent(new CustomEvent('frames', { detail: pcm }));
      if (ev === 'end') { this.speaking = false; this.dispatchEvent(new Event('speechend')); }
    } else {
      this.preroll.push(pcm);
      if (this.preroll.length > this.prerollMax) this.preroll.shift();
    }
  }
}
