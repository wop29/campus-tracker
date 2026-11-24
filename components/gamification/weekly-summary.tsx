'use client';
import type { WeeklySummary } from '@/lib/gamification';
import { cn } from '@/lib/utils';

/** Seven bars, one per day of this week. Heights are real XP; the number is printed too. */
export function WeeklySummaryCard({ w }: { w: WeeklySummary }) {
  const max = Math.max(10, ...w.days.map((d) => d.xp));
  return (
    <div>
      <p className="text-sm"><span className="text-2xl font-extrabold tabular-nums">{w.totalXp}</span> XP this week, active on {w.activeDays} of 7 days.</p>
      <ul className="mt-3 flex items-end gap-2" aria-label="XP per day this week">
        {w.days.map((d) => (
          <li key={d.date} className="flex flex-1 flex-col items-center gap-1" aria-label={`${d.label}: ${d.xp} XP`}>
            <span className="text-[11px] font-bold tabular-nums text-secondary">{d.xp || ''}</span>
            <span className="flex h-20 w-full items-end overflow-hidden rounded-lg bg-border/60">
              <span className={cn('w-full rounded-lg', d.isToday ? 'bg-fun-orange' : 'bg-fun-blue')} style={{ height: d.xp ? `${Math.max(8, Math.round((d.xp / max) * 100))}%` : '0%' }} />
            </span>
            <span className={cn('text-[11px]', d.isToday ? 'font-extrabold' : 'text-secondary')}>{d.label}</span>
          </li>
        ))}
      </ul>
      {w.top.length > 0 && <p className="mt-3 text-xs text-secondary">Top earners: {w.top.map((t) => `${t.label} (${t.xp} XP)`).join(', ')}.</p>}
    </div>
  );
}
