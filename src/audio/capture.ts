import { Vad } from './vad';
import { Resampler, floatToInt16, rms } from './resample';

/** Le micro, brut : des trames Float32 de 20 ms à la fréquence native de la carte son. */
export class MicTap {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: ScriptProcessorNode | AudioWorkletNode | null = null;
  src: MediaStreamAudioSourceNode | null = null;

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 0;
  }

  get suspended(): boolean {
    return !!this.ctx && this.ctx.state === 'suspended';
  }

  async resume() {
    if (this.ctx) await this.ctx.resume();
  }

  async open(deviceId: string, onFrame: (frame: Float32Array, sr: number) => void) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('no_mic_api'), { code: 'no_mic_api' });
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.src = ctx.createMediaStreamSource(this.stream);

    // Using ScriptProcessorNode ensures 100% compatibility across browser iFrames without worklet module CORS/MIME hurdles
    const bufferSize = 1024;
    const scriptNode = ctx.createScriptProcessor(bufferSize, 1, 1);
    this.node = scriptNode;

    const frameSize = Math.round(ctx.sampleRate * 0.02); // 20ms frames
    let buffer = new Float32Array(frameSize);
    let bufIndex = 0;

    scriptNode.onaudioprocess = (e) => {
      if (this.ctx !== ctx) return;
      const input = e.inputBuffer.getChannelData(0);
      let i = 0;
      while (i < input.length) {
        const take = Math.min(input.length - i, frameSize - bufIndex);
        buffer.set(input.subarray(i, i + take), bufIndex);
        bufIndex += take;
        i += take;
        if (bufIndex === frameSize) {
          onFrame(buffer.slice(0), ctx.sampleRate);
          bufIndex = 0;
        }
      }
    };

    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.src.connect(scriptNode);
    scriptNode.connect(silent).connect(ctx.destination);

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
  }

  close() {
    if (this.node) {
      if ('port' in this.node && this.node.port) {
        try { (this.node as AudioWorkletNode).port.close(); } catch { /* ignore */ }
      }
      this.node.disconnect();
    }
    if (this.src) this.src.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.src = null;
  }
}

/**
 * Écoute continue : micro -> détection de parole -> phrases.
 * Événements : level, speechstart, frames (Int16Array 16 kHz), speechend, muted, open, close.
 */
export class Capture extends EventTarget {
  tap: MicTap = new MicTap();
  vad: Vad = new Vad();
  resampler: Resampler | null = null;
  preroll: Int16Array[] = [];
  prerollMax: number = 15; // 300 ms avant détection
  speaking: boolean = false;
  muted: boolean = false;
  running: boolean = false;

  configure(o: { silenceMs?: number; sensitivity?: number }) {
    this.vad.configure(o);
  }

  async open(deviceId: string) {
    if (this.running) return;
    this.resampler = null;
    this.vad.reset();
    this.preroll = [];
    await this.tap.open(deviceId, (f, sr) => this.onFrame(f, sr));
    this.running = true;
    this.dispatchEvent(new Event('open'));
  }

  close() {
    if (this.speaking) {
      this.speaking = false;
      this.dispatchEvent(new Event('speechend'));
    }
    this.tap.close();
    this.running = false;
    this.preroll = [];
    this.dispatchEvent(new Event('close'));
  }

  setMuted(m: boolean) {
    if (m === this.muted) return;
    this.muted = m;
    if (m) {
      if (this.speaking) {
        this.speaking = false;
        this.dispatchEvent(new Event('speechend'));
      }
      this.vad.reset();
      this.preroll = [];
    }
    this.dispatchEvent(new CustomEvent('muted', { detail: m }));
  }

  onFrame(f32: Float32Array, sr: number) {
    const level = rms(f32);
    this.dispatchEvent(new CustomEvent('level', { detail: { level, speaking: this.speaking, muted: this.muted } }));
    if (this.muted) return;
    if (!this.resampler || this.resampler.srcRate !== sr) {
      this.resampler = new Resampler(sr, 16000);
    }
    const pcm = floatToInt16(this.resampler.process(f32));
    const ev = this.vad.push(level);
    if (ev === 'start') {
      this.speaking = true;
      this.dispatchEvent(new Event('speechstart'));
      for (const p of this.preroll) {
        this.dispatchEvent(new CustomEvent('frames', { detail: p }));
      }
      this.preroll = [];
    }
    if (this.speaking) {
      if (pcm.length) {
        this.dispatchEvent(new CustomEvent('frames', { detail: pcm }));
      }
      if (ev === 'end') {
        this.speaking = false;
        this.dispatchEvent(new Event('speechend'));
      }
    } else {
      this.preroll.push(pcm);
      if (this.preroll.length > this.prerollMax) this.preroll.shift();
    }
  }
}
