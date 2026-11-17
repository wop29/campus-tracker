'use client';
import Link from 'next/link';
import { Flame, Map as MapIcon } from 'lucide-react';
import { Mascot } from '@/components/mascot';
import { Confetti } from '@/components/confetti';
import { useGamification } from './use-gamification';
import { QuestsCard } from './quests-card';

/** Compact "today" strip for the Overview page. All numbers are real; empty accounts see a friendly start prompt. */
export function OverviewStrip() {
  const g = useGamification(true);
  if (g.loading && g.events.length === 0 && !g.error) return <div className="mb-5 rounded-2xl border bg-surface p-4 text-sm text-secondary" role="status">Loading your progress...</div>;
  if (g.error) return <div className="mb-5 rounded-2xl border bg-surface p-3 text-xs text-secondary" role="status">Could not load your progress. <button type="button" className="font-bold text-accent-ink underline" onClick={() => void g.reload()}>Retry</button></div>;
  const next = g.journey.units.flatMap((u) => u.lessons).find((l) => l.state === 'current');
  const empty = g.xp === 0;
  return (
    <section aria-label="Today's quests and streak" className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface p-4">
      <Confetti fire={g.fire} intense={g.celebration?.intensity === 'big'} />
      <Mascot mood={g.celebration ? 'cheer' : g.streak.atRisk ? 'think' : 'happy'} size={64} />
      <div className="min-w-[180px] flex-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-extrabold">
          <span className="inline-flex items-center gap-1"><Flame size={16} className={g.streak.current ? 'text-fun-orange-dark' : 'text-secondary'} aria-hidden />{g.streak.current} day streak</span>
          <span>Level {g.level.level}</span><span>{g.xp} XP</span>
        </p>
        <p className="mt-1 text-xs text-secondary">
          {empty ? 'Welcome. Your first real step earns your first XP.' : g.streak.atRisk ? 'Do one real thing today to keep your streak going.' : g.streak.todayCounts ? 'Nice work today.' : `${g.level.remaining} XP to level ${g.level.level + 1}.`}
        </p>
        {next && <Link href={next.href} className="mt-2 inline-flex items-center gap-1.5 rounded-full border-b-4 border-fun-green-dark bg-fun-green px-3 py-1 text-xs font-extrabold text-on-fun"><MapIcon size={13} aria-hidden />{empty ? 'Start here' : 'Next'}: {next.title}</Link>}
      </div>
      <div className="w-full min-w-[260px] flex-[2]"><QuestsCard board={g.quests} compact /></div>
    </section>
  );
}
