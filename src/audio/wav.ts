// WAV 16 bits : encodage (pour la bibliothèque) et décodage de fichiers audio quelconques
// par le navigateur lui-même, donc sans ffmpeg côté serveur.

export function encodeWav(int16: Int16Array, sampleRate: number): Uint8Array {
  const data = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, 1, true); // 1 channel (mono)
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * numChannels * bytesPerSample)
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

export function concatInt16(chunks: Int16Array[]): Int16Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) {
      out[i] += ch[i] / channels.length;
    }
  }
  return out;
}

export function f32ToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/** Fichier audio quelconque -> WAV mono 16 bits. Lève une erreur si illisible. */
export async function fileToWav(file: File): Promise<{ bytes: Uint8Array; duration: number; sampleRate: number }> {
  const bytes = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const buf = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      channels.push(buf.getChannelData(c));
    }
    const pcm = f32ToInt16(mixToMono(channels));
    return { bytes: encodeWav(pcm, buf.sampleRate), duration: buf.duration, sampleRate: buf.sampleRate };
  } finally {
    ctx.close();
  }
}
