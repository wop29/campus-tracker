'use client';
import { Flame } from 'lucide-react';
import { Mascot } from '@/components/mascot';
import { Confetti } from '@/components/confetti';
import type { GamificationState } from './use-gamification';
import { QuestsCard } from './quests-card';

/**
 * Compact "today" strip for the Overview page. All numbers are real; empty accounts see a friendly start prompt.
 * The page passes its own useGamification state so there is one fetch and one celebration. The next step itself is
 * shown in "Do these next" (one place only).
 */
export function OverviewStrip({ g }: { g: GamificationState }) {
  if (g.loading && g.events.length === 0 && !g.error) return <div className="mb-5 rounded-2xl border bg-surface p-4 text-sm text-secondary" role="status">Loading your progress...</div>;
  if (g.error) return <div className="mb-5 rounded-2xl border bg-surface p-3 text-xs text-secondary" role="status">Could not load your progress. <button type="button" className="font-bold text-accent-ink underline" onClick={() => void g.reload()}>Retry</button></div>;
  const empty = g.xp === 0;
  return (
    <section aria-label="Today's quests and streak" className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface p-4">
      <Confetti fire={g.fire} intense={g.celebration?.intensity === 'big'} />
      <Mascot pose={g.celebration ? 'cheer' : g.streak.atRisk ? 'thinking' : empty ? 'wave' : 'happy'} size={64} priority />
      <div className="min-w-[180px] flex-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-extrabold">
          <span className="inline-flex items-center gap-1"><Flame size={16} className={g.streak.current ? 'text-fun-orange-dark' : 'text-secondary'} aria-hidden />{g.streak.current} day streak</span>
          <span>Level {g.level.level}</span><span>{g.xp} XP</span>
        </p>
        <p className="mt-1 text-xs text-secondary">
          {empty ? 'Welcome. Your first real step earns your first XP.' : g.streak.atRisk ? 'Do one real thing today to keep your streak going.' : g.streak.todayCounts ? 'Nice work today.' : `${g.level.remaining} XP to level ${g.level.level + 1}.`}
        </p>
      </div>
      <div className="w-full min-w-[260px] flex-[2]"><QuestsCard board={g.quests} compact /></div>
    </section>
  );
}
