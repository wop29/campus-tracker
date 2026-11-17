'use client';
import Link from 'next/link';
import { CheckCircle2, Circle, Lightbulb } from 'lucide-react';
import type { Quest, QuestBoard } from '@/lib/gamification';
import { cn } from '@/lib/utils';

function QuestRow({ q }: { q: Quest }) {
  const pct = q.target ? Math.round((q.progress / q.target) * 100) : 0;
  return (
    <li>
      <Link href={q.href} className="group flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        {q.done ? <CheckCircle2 size={22} className="shrink-0 text-success" aria-hidden /> : <Circle size={22} className="shrink-0 text-secondary/60" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm font-bold', q.done && 'text-secondary line-through')}>{q.title}</span>
          <span className="block truncate text-xs text-secondary">{q.description}</span>
          <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={q.title} aria-valuenow={q.progress} aria-valuemin={0} aria-valuemax={q.target}>
            <span className={cn('block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', q.done ? 'bg-fun-green' : 'bg-fun-blue')} style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="shrink-0 text-xs font-extrabold tabular-nums">{q.progress}/{q.target}{q.unit === 'xp' ? ' XP' : ''}</span>
        {q.done && <span className="sr-only">Done</span>}
      </Link>
    </li>
  );
}

export function QuestsCard({ board, compact = false }: { board: QuestBoard; compact?: boolean }) {
  const daily = compact ? board.daily.slice(0, 3) : board.daily;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-extrabold">Today's quests</h3>
        <ul className="space-y-2">{daily.map((q) => <QuestRow key={q.id} q={q} />)}</ul>
      </div>
      {!compact && (
        <div>
          <h3 className="mb-2 text-sm font-extrabold">This week</h3>
          <ul className="space-y-2">{board.weekly.map((q) => <QuestRow key={q.id} q={q} />)}</ul>
        </div>
      )}
      {board.suggestions.length > 0 && (
        <ul className="space-y-2">
          {board.suggestions.slice(0, compact ? 1 : 3).map((s) => (
            <li key={s.id} className="flex items-start gap-2 rounded-xl border border-dashed bg-surface px-3 py-2 text-xs text-secondary">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
              <span className="flex-1">{s.text} <Link href={s.href} className="font-bold text-accent-ink underline">{s.cta}</Link></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
