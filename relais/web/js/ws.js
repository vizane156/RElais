// Lien WebSocket avec reconnexion automatique. JSON en texte, audio en binaire.
export class Link extends EventTarget {
  constructor(path = '/ws') {
    super();
    this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
    this.ws = null;
    this.retry = 400;
    this.closed = false;
  }

  connect() {
    this.closed = false;
    this.dispatchEvent(new CustomEvent('connecting'));
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { this.retry = 400; this.dispatchEvent(new Event('open')); };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this.dispatchEvent(new CustomEvent('json', { detail: msg }));
      } else {
        this.dispatchEvent(new CustomEvent('binary', { detail: e.data }));
      }
    };
    ws.onclose = () => {
      this.dispatchEvent(new Event('close'));
      if (!this.closed) { setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 1.7, 8000); }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* déjà fermé */ } };
  }

  get open() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(obj) {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  /** PCM 16 bits mono 16 kHz : un octet de type (1) puis les échantillons. */
  sendAudio(int16) {
    if (!this.open) return false;
    const buf = new Uint8Array(1 + int16.byteLength);
    buf[0] = 1;
    buf.set(new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength), 1);
    this.ws.send(buf);
    return true;
  }

  close() { this.closed = true; if (this.ws) this.ws.close(); }
}

/** Trame audio du serveur : 0x02, id u32, seq u32, fréquence u32, drapeaux u8, puis PCM16. */
export function parseAudioFrame(buffer) {
  const v = new DataView(buffer);
  if (buffer.byteLength < 14 || v.getUint8(0) !== 2) return null;
  const n = (buffer.byteLength - 14) >> 1;
  return {
    id: v.getUint32(1, true), seq: v.getUint32(5, true), sampleRate: v.getUint32(9, true),
    last: (v.getUint8(13) & 1) === 1, pcm: new Int16Array(buffer, 14, n),
  };
}
