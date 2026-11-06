import React, { useEffect, useRef } from 'react';

const dbNorm = (level: number) =>
  Math.min(1, Math.max(0, (20 * Math.log10(Math.max(level, 1e-5)) + 62) / 52));

interface AudioMeterProps {
  level: number;
  mode: 'idle' | 'live' | 'speech' | 'muted';
}

export const AudioMeter: React.FC<AudioMeterProps> = ({ level, mode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    let raf = 0;
    const segments = 26;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      draw();
    };

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      g.clearRect(0, 0, W, H);
      const cs = getComputedStyle(canvas);
      const off = cs.getPropertyValue('--rule-2').trim() || '#a4aeb6';
      const ink = cs.getPropertyValue('--ink').trim() || '#11151a';
      const lamp = cs.getPropertyValue('--lamp').trim() || '#ffb000';

      const gap = Math.max(1, Math.round(2 * dpr));
      const sw = (W - gap * (segments - 1)) / segments;
      const lit = mode === 'idle' || mode === 'muted' ? 0 : Math.round(dbNorm(level) * segments);

      for (let i = 0; i < segments; i++) {
        const hgt = H * (0.3 + 0.7 * (i / (segments - 1)));
        g.fillStyle = i < lit ? (mode === 'speech' ? lamp : ink) : off;
        g.fillRect(i * (sw + gap), H - hgt, sw, hgt);
      }
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [level, mode]);

  return <canvas ref={canvasRef} role="img" />;
};
