'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { RESULT_LABEL, dueLabel, readyText, resultLabel } from '@/lib/results';
import { ArtImg } from '@/components/art';
import { stampFor, stampSrc } from '@/lib/art';
import type { AppView } from './view-model';

/** Left pane: one card per application, nearest deadline first. */
export function ApplicationList({ views, selectedId, className }: { views: AppView[]; selectedId: string | null; className?: string }) {
  return (
    <nav aria-label="My applications" className={cn('w-full shrink-0 flex-col gap-3 lg:w-[300px]', className)}>
      <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wider text-secondary">My applications</h2>
      {views.map((v) => {
        const active = v.row.id === selectedId;
        const left = v.phase === 'prepare' ? readyText(v.progress) : v.phase === 'submitted' ? 'Submitted' : RESULT_LABEL[v.row.stage] ?? 'Result';
        const right = v.phase === 'prepare' ? dueLabel(v.due?.due_at) : v.phase === 'submitted' ? resultLabel(v.result.date) : '';
        // Once it is sent, the card gets a passport stamp for the school's country (decorative: the text already says Submitted).
        const stamp = v.phase === 'prepare' ? null : stampFor(v.row.school?.country);
        return (
          <Link key={v.row.id} href={`/applications?a=${v.row.id}`} scroll={false} aria-current={active ? 'page' : undefined}
            className={cn('relative flex flex-col gap-2 rounded-2xl border-2 bg-surface p-4 transition hover:bg-bg',
              active ? 'border-fun-green-dark shadow-[0_3px_0_var(--color-fun-green-dark)]' : 'shadow-[0_3px_0_var(--color-border)]')}>
            {stamp && <ArtImg src={stampSrc(stamp)} alt="" size={52} className="pointer-events-none absolute right-2 top-2 rotate-[-12deg] opacity-90" />}
            <span className={cn('text-[17px] font-black leading-tight text-ink', stamp && 'pr-12')}>{v.school}</span>
            <span className={cn('text-sm text-secondary', stamp && 'pr-12')}>{v.row.program}</span>
            <span className="block h-2 overflow-hidden rounded-full bg-border/70" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.phase === 'prepare' ? v.progress.percent : 100} aria-label="Checklist progress">
              <span className="block h-2 rounded-full bg-fun-green-dark" style={{ width: `${v.phase === 'prepare' ? v.progress.percent : 100}%` }} />
            </span>
            <span className="flex justify-between gap-2 text-[13px] font-bold text-secondary"><span>{left}</span><span>{right}</span></span>
          </Link>
        );
      })}
      <Link href="/schools" className="flex min-h-12 items-center justify-center rounded-2xl border-2 border-dashed border-line px-3 text-[15px] font-extrabold text-primary hover:bg-surface">+ Find a university</Link>
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] font-bold">
        <Link href="/applications?view=tasks" className="text-secondary underline hover:text-ink">My tasks</Link>
        <Link href="/profile" className="text-secondary underline hover:text-ink">Your story (answers to reuse)</Link>
        {views.some((v) => v.row.stage === 'admitted') && <Link href="/applications?view=decisions" className="text-secondary underline hover:text-ink">Compare offers</Link>}
      </p>
    </nav>
  );
}
