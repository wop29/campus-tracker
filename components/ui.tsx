'use client';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Mascot, type MascotMood, type MascotPose } from '@/components/mascot';
import { ArtImg } from '@/components/art';
import { EMPTY_ART, type EmptyArt } from '@/lib/art';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Chunky "3D" button: the thick bottom border shrinks and the button drops 2px while pressed. */
export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'border-fun-green-dark bg-fun-green text-on-fun hover:brightness-105',
    secondary: 'border-border bg-surface text-ink hover:bg-bg',
    ghost: 'border-transparent bg-transparent text-secondary hover:bg-fun-blue/15 hover:text-ink',
    danger: 'border-[color-mix(in_srgb,var(--color-danger)_70%,black)] bg-danger text-white hover:brightness-110',
  }[variant];
  const press = variant === 'ghost' ? '' : 'btn-3d border-b-4 active:translate-y-[2px] active:border-b-2 disabled:active:translate-y-0 disabled:active:border-b-4';
  return <button className={cn('inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 font-bold transition disabled:cursor-not-allowed disabled:opacity-50', size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm', press, v, className)} {...p} />;
}
const field = 'w-full rounded-xl border-2 border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-secondary/70 transition focus:border-accent focus:ring-4 focus:ring-accent/25';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(field, 'min-h-[88px]', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(field, p.className)} />;
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-bold text-secondary">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-secondary">{hint}</span>}
      {error && <span className="block text-xs font-medium text-danger" role="alert">{error}</span>}
    </label>
  );
}
export const Card = ({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-2xl border-2 bg-surface p-4 shadow-[0_3px_0_var(--color-border)]', className)} {...p}>{children}</div>;

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  const t = {
    neutral: 'bg-bg text-secondary border-2',
    success: 'bg-success/15 text-success-ink',
    warning: 'bg-warning/15 text-warning-ink',
    danger: 'bg-danger/15 text-danger-ink',
    accent: 'bg-accent/15 text-accent-ink',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', t, className)}>{children}</span>;
}
/** Solid, playful pill. Always include text; the color is decoration, not the message. */
export type PillTone = 'green' | 'blue' | 'orange' | 'pink' | 'yellow' | 'purple' | 'neutral';
export function Pill({ tone = 'green', icon, children, className }: { tone?: PillTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  const t = {
    green: 'bg-fun-green border-fun-green-dark', blue: 'bg-fun-blue border-fun-blue-dark', orange: 'bg-fun-orange border-fun-orange-dark',
    pink: 'bg-fun-pink border-fun-pink-dark', yellow: 'bg-fun-yellow border-fun-yellow-dark', purple: 'bg-fun-purple border-fun-purple-dark', neutral: 'bg-bg border-border',
  }[tone];
  return <span className={cn('inline-flex items-center gap-1 rounded-full border-b-2 px-2.5 py-0.5 text-xs font-extrabold', tone === 'neutral' ? 'text-ink' : 'text-on-fun', t, className)}>{icon}{children}</span>;
}
export const RiskBadge = ({ risk }: { risk: 'green' | 'yellow' | 'red' }) => <Badge tone={{ green: 'success', yellow: 'warning', red: 'danger' }[risk] as 'success'}>{{ green: 'On track', yellow: 'Attention', red: 'At risk' }[risk]}</Badge>;
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-secondary">{subtitle}</p>}</div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}
/** Dashed empty box. `art` shows a full illustration, `pose` an illustrated Mochi, `mascot` the old SVG drawing. */
export const EmptyState = ({ title, hint, action, mascot, pose, art }: { title: string; hint?: string; action?: ReactNode; mascot?: boolean | MascotMood; pose?: MascotPose; art?: EmptyArt }) => (
  <div className="rounded-2xl border-2 border-dashed bg-surface p-8 text-center">
    {art ? <div className="mb-3 flex justify-center"><ArtImg src={EMPTY_ART[art].src} alt={EMPTY_ART[art].alt} size={140} priority /></div>
      : pose ? <div className="mb-2 flex justify-center"><Mascot pose={pose} size={104} priority /></div>
      : mascot && <div className="mb-2 flex justify-center"><Mascot mood={mascot === true ? 'happy' : mascot} size={88} /></div>}
    <p className="font-bold text-ink">{title}</p>{hint && <p className="mt-1 text-sm text-secondary">{hint}</p>}{action && <div className="mt-3">{action}</div>}
  </div>
);
export const Loading = ({ label = 'Loading...' }: { label?: string }) => <div className="p-6 text-sm text-secondary" role="status">{label}</div>;
export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="rounded-2xl border-2 border-danger/40 bg-danger/10 p-3 text-sm font-medium text-danger-ink" role="alert">{message}{onRetry && <button onClick={onRetry} className="ml-3 font-bold underline">Retry</button>}</div>
);
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('pop-in max-h-[90vh] w-full overflow-auto rounded-3xl border-2 bg-surface p-6 shadow-[0_6px_0_var(--color-border)]', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold text-ink">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-xl p-1.5 text-secondary hover:bg-bg hover:text-ink"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}
export const AiLabel = () => <Badge tone="accent">AI-generated, not verified</Badge>;

const BAR = {
  accent: 'bg-fun-blue', success: 'bg-fun-green', warning: 'bg-fun-orange', danger: 'bg-danger',
} as const;
export const ProgressBar = ({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'warning' | 'danger' }) => {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-border/70" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('progress-stripes h-full rounded-full transition-[width] duration-500', BAR[tone])} style={{ width: `${v}%` }} />
    </div>
  );
};

const RING = { accent: 'var(--color-fun-blue)', success: 'var(--color-fun-green)', warning: 'var(--color-fun-orange)', danger: 'var(--color-danger)', pink: 'var(--color-fun-pink)', purple: 'var(--color-fun-purple)', yellow: 'var(--color-fun-yellow)' } as const;
/** Circular progress. The center shows `children`, or the rounded percentage by default. */
export function ProgressRing({ value, size = 72, stroke = 9, tone = 'success', label, children, className }: {
  value: number; size?: number; stroke?: number; tone?: keyof typeof RING; label?: string; children?: ReactNode; className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING[tone]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-ink">{children ?? `${Math.round(v)}%`}</span>
    </div>
  );
}
/** Compact number tile for dashboards. */
export function StatTile({ label, value, hint, icon, tone = 'green', className }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: Exclude<PillTone, 'neutral'>; className?: string }) {
  const t = { green: 'bg-fun-green', blue: 'bg-fun-blue', orange: 'bg-fun-orange', pink: 'bg-fun-pink', yellow: 'bg-fun-yellow', purple: 'bg-fun-purple' }[tone];
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border-2 bg-surface p-3 shadow-[0_3px_0_var(--color-border)]', className)}>
      {icon && <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-on-fun', t)} aria-hidden>{icon}</span>}
      <div className="min-w-0"><p className="truncate text-xs font-bold text-secondary">{label}</p><p className="text-xl font-extrabold leading-tight text-ink">{value}</p>{hint && <p className="truncate text-xs text-secondary">{hint}</p>}</div>
    </div>
  );
}
export function ConfirmButton({ onConfirm, children, message = 'Are you sure?', ...p }: { onConfirm: () => void; message?: string } & ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return <Button {...p} onClick={() => { if (window.confirm(message)) onConfirm(); }}>{children}</Button>;
}
