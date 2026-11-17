import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STROKE: Record<string, string> = { green: 'stroke-fun-green', blue: 'stroke-fun-blue', orange: 'stroke-fun-orange', pink: 'stroke-fun-pink', yellow: 'stroke-fun-yellow', purple: 'stroke-fun-purple' };
export type RingColor = keyof typeof STROKE;

/** SVG progress ring with an accessible progressbar role. The number in the middle repeats the value so it is never color-only. */
export function ProgressRing({ pct, size = 64, stroke = 8, color = 'green', label, children, className }: { pct: number; size?: number; stroke?: number; color?: RingColor; label: string; children?: ReactNode; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className={cn(STROKE[color], 'motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700')} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children ?? <span className="text-sm font-extrabold">{v}%</span>}</div>
    </div>
  );
}
