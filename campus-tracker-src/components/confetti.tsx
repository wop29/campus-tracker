'use client';
import { useEffect, useRef } from 'react';

type P = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string; life: number; round: boolean };
const TONES = ['green', 'blue', 'orange', 'pink', 'yellow', 'purple'];

/** Canvas confetti. Bursts whenever `fire` changes to a value above 0. Skipped when the user prefers reduced motion. */
export function Confetti({ fire, intense = false }: { fire: number; intense?: boolean }) {
  const raf = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!(fire > 0) || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    cleanup.current?.();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '100' });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth; const H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const colors = TONES.map((t) => cs.getPropertyValue(`--color-fun-${t}`).trim()).filter(Boolean);
    if (!ctx || !colors.length) { canvas.remove(); return; }
    ctx.scale(dpr, dpr);
    const count = intense ? 220 : 90;
    const maxLife = intense ? 190 : 120;
    const parts: P[] = Array.from({ length: count }, () => {
      const side = intense ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const angle = intense && side ? (side < 0 ? -0.35 : -Math.PI + 0.35) + (Math.random() - 0.5) * 0.6 : -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = (intense ? 13 : 10) + Math.random() * (intense ? 11 : 8);
      return {
        x: intense && side ? (side < 0 ? 0 : W) : W / 2, y: intense && side ? H * 0.75 : H * 0.4,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 6, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)], life: maxLife * (0.7 + Math.random() * 0.3), round: Math.random() < 0.25,
      };
    });
    let frame = 0;
    const stop = () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; canvas.remove(); cleanup.current = null; };
    cleanup.current = stop;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        if (frame > p.life) continue;
        alive++;
        p.vy += 0.38; p.vx *= 0.985; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - frame) / 30));
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive > 0) raf.current = requestAnimationFrame(tick); else stop();
    };
    raf.current = requestAnimationFrame(tick);
  }, [fire, intense]);
  useEffect(() => () => cleanup.current?.(), []);
  return null;
}
