'use client';
import { Check } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Arrow keys move focus (and selection, for radios) between the options of a group, like native radio buttons. */
export function onGroupKeyDown(e: KeyboardEvent<HTMLElement>, selectOnMove: boolean) {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-option]:not(:disabled)'));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0 || !items.length) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
  if (selectOnMove) items[next].click();
}

type Props = { selected: boolean; onSelect: () => void; title: string; subtitle?: string; icon?: ReactNode; multi?: boolean; tabbable?: boolean; size?: 'lg' | 'chip'; className?: string };

/** Big friendly tap target. Radio semantics by default, checkbox semantics with `multi`. */
export function OptionCard({ selected, onSelect, title, subtitle, icon, multi, tabbable = true, size = 'lg', className }: Props) {
  if (size === 'chip') {
    return (
      <button type="button" data-option role={multi ? 'checkbox' : 'radio'} aria-checked={selected} tabIndex={tabbable ? 0 : -1} onClick={onSelect}
        className={cn('btn-3d inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-b-4 px-4 py-2 text-sm font-extrabold transition active:translate-y-[2px] active:border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          selected ? 'border-fun-blue-dark bg-fun-blue text-on-fun' : 'border-border bg-surface text-ink hover:bg-bg', className)}>
        {selected && <Check size={14} strokeWidth={3} aria-hidden />}{title}
      </button>
    );
  }
  return (
    <button type="button" data-option role={multi ? 'checkbox' : 'radio'} aria-checked={selected} tabIndex={tabbable ? 0 : -1} onClick={onSelect}
      className={cn('btn-3d flex w-full items-center gap-3 rounded-2xl border-2 border-b-4 p-4 text-left transition active:translate-y-[2px] active:border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        selected ? 'border-fun-green-dark bg-fun-green/15' : 'border-border bg-surface hover:bg-bg', className)}>
      {icon && <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl', selected ? 'bg-fun-green text-on-fun' : 'bg-bg')} aria-hidden>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-extrabold text-ink">{title}</span>
        {subtitle && <span className="block text-sm text-secondary">{subtitle}</span>}
      </span>
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center border-2', multi ? 'rounded-lg' : 'rounded-full', selected ? 'border-fun-green-dark bg-fun-green text-on-fun' : 'border-line bg-surface')} aria-hidden>
        {selected && <Check size={16} strokeWidth={3} />}
      </span>
    </button>
  );
}
