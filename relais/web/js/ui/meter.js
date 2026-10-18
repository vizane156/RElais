// Jauge de niveau façon pupitre : une échelle de barres montantes qui s'allument.
const dbNorm = (level) => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(level, 1e-5)) + 62) / 52));

export class Meter {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.level = 0;
    this.mode = 'idle';
    this.raf = 0;
    this.segments = 26;
    this.dpr = 1;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.c.width = Math.max(1, Math.round(this.c.clientWidth * this.dpr));
    this.c.height = Math.max(1, Math.round(this.c.clientHeight * this.dpr));
    this.draw();
  }

  set(level, mode) {
    this.level = level;
    this.mode = mode;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const g = this.g, W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(this.c);
    const off = cs.getPropertyValue('--rule-2').trim() || '#a4aeb6';
    const ink = cs.getPropertyValue('--ink').trim() || '#11151a';
    const lamp = cs.getPropertyValue('--lamp').trim() || '#ffb000';
    const n = this.segments;
    const gap = Math.max(1, Math.round(2 * this.dpr));
    const sw = (W - gap * (n - 1)) / n;
    const lit = this.mode === 'idle' ? 0 : Math.round(dbNorm(this.level) * n);
    for (let i = 0; i < n; i++) {
      const hgt = H * (0.3 + 0.7 * (i / (n - 1)));
      g.fillStyle = i < lit ? (this.mode === 'speech' ? lamp : ink) : off;
      g.fillRect(i * (sw + gap), H - hgt, sw, hgt);
    }
  }
}
