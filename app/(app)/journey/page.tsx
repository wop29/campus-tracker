'use client';
import Link from 'next/link';
import { ArrowRight, Flame, PartyPopper, Zap } from 'lucide-react';
import { Card, ErrorBox, Loading } from '@/components/ui';
import { Mascot } from '@/components/mascot';
import { Confetti } from '@/components/confetti';
import { useGamification } from '@/components/gamification/use-gamification';
import { JourneyPath } from '@/components/gamification/journey-path';
import { QuestsCard } from '@/components/gamification/quests-card';
import { BadgeShelf } from '@/components/gamification/badge-shelf';
import { WeeklySummaryCard } from '@/components/gamification/weekly-summary';
import { DailyGoalControl } from '@/components/gamification/daily-goal';
import { ProgressRing } from '@/components/gamification/progress-ring';
import { nextStep, type Journey } from '@/lib/journey';

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-3 text-base font-extrabold">{children}</h2>;

/** A short, warm line that fits where the user is on the path. */
function encouragement(j: Journey): string {
  if (!j.currentLessonId) return 'You finished the whole path. That is a big deal. Be proud of yourself!';
  if (j.doneCount === 0 && j.skipped > 0) return 'We skipped the early setup for you. Jump straight in from here.';
  if (j.doneCount === 0) return 'Every big journey starts with one small step. This one takes a few minutes.';
  if (j.overallPct >= 75) return 'Almost there. The finish line is in sight!';
  if (j.overallPct >= 40) return 'You are making real progress. Keep the rhythm going.';
  return 'Nice start. One small step at a time is all it takes.';
}

export default function JourneyPage() {
  // The journey (and its single next step) is computed once in useGamification from the onboarding answers,
  // so this page, the Overview and the Overview strip always show the same step.
  const g = useGamification(true);
  const journey = g.journey;
  if (g.loading && g.events.length === 0 && !g.error) return <Loading label="Loading your journey..." />;
  if (g.error) return <ErrorBox message={g.error} onRetry={() => void g.reload()} />;
  const current = nextStep(journey);
  // Mochi: party for fresh wins, a thinking face when the streak needs a step, a quiet read otherwise.
  const headerPose = g.celebration ? 'party' : g.streak.atRisk ? 'thinking' : !journey.currentLessonId ? 'cheer' : 'reading';
  const pathPose = g.celebration ? 'cheer' : g.streak.atRisk ? 'thinking' : 'checklist';
  return (
    <div>
      <Confetti fire={g.fire} intense={g.celebration?.intensity === 'big'} />
      <header className="mb-6 rounded-3xl border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Mascot pose={headerPose} size={88} priority />
          <div className="min-w-[200px] flex-1">
            <h1 className="text-2xl font-extrabold">Your journey</h1>
            <p className="text-sm text-secondary">
              {g.streak.atRisk ? 'Your streak is waiting. One real step today keeps it going.' : encouragement(journey)}
            </p>
            <div className="mt-2"><DailyGoalControl value={g.settings.dailyGoalXp} onSave={g.setDailyGoal} /></div>
          </div>
          <ul className="flex flex-wrap gap-3" aria-label="Your stats">
            <li className="flex min-w-[110px] items-center gap-2 rounded-2xl border-b-4 border-fun-yellow-dark bg-fun-yellow px-3 py-2 text-on-fun"><Zap size={20} aria-hidden /><span><span className="block text-xl font-extrabold leading-none tabular-nums">{g.xp}</span><span className="text-xs font-bold">XP total</span></span></li>
            <li className="flex min-w-[110px] items-center gap-2 rounded-2xl border-b-4 border-fun-orange-dark bg-fun-orange px-3 py-2 text-on-fun"><Flame size={20} aria-hidden /><span><span className="block text-xl font-extrabold leading-none tabular-nums">{g.streak.current}</span><span className="text-xs font-bold">day streak{g.streak.longest > g.streak.current ? ` (best ${g.streak.longest})` : ''}</span></span></li>
            <li className="flex items-center gap-2 rounded-2xl border-b-4 border-fun-purple-dark bg-fun-purple px-3 py-2 text-on-fun">
              <ProgressRing pct={g.level.pct} size={44} stroke={6} color="purple" label={`Progress to level ${g.level.level + 1}`} className="rounded-full bg-white/80"><span className="text-xs font-extrabold">{g.level.level}</span></ProgressRing>
              <span><span className="block text-sm font-extrabold">Level {g.level.level}</span><span className="text-xs font-bold">{g.level.remaining} XP to level {g.level.level + 1}</span></span>
            </li>
          </ul>
        </div>
        {g.streak.atRisk && <p className="mt-3 rounded-xl bg-fun-orange/20 px-3 py-2 text-xs font-bold" role="status">Streak at risk: you were active yesterday but not yet today.</p>}
        {g.celebration && g.celebration.gainedXp > 0 && (
          <p className="mt-3 rounded-xl bg-fun-green/20 px-3 py-2 text-sm font-bold" role="status">
            +{g.celebration.gainedXp} XP since your last visit.{g.celebration.levelUp ? ` You reached level ${g.celebration.newLevel}.` : ''}{g.celebration.newBadges.length ? ` ${g.celebration.newBadges.length} new badge${g.celebration.newBadges.length > 1 ? 's' : ''} unlocked.` : ''}
          </p>
        )}
      </header>

      <section aria-label="Do this next" className="mb-6">
        {current ? (
          <Link href={current.href} className="group block rounded-3xl border-2 border-b-[6px] border-fun-green-dark bg-fun-green p-5 text-on-fun transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-6">
            <p className="text-xs font-extrabold uppercase tracking-wide opacity-80">Do this next · Step {current.step} of {current.total}{current.unitTitle ? ` · ${current.unitTitle}` : ''}</p>
            <p className="mt-1 text-2xl font-extrabold sm:text-3xl">{current.title}</p>
            <p className="mt-1 text-sm font-bold opacity-90">{current.hint}</p>
            {current.target > 1 && <p className="mt-1 text-xs font-bold">{current.current} of {current.target} so far</p>}
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-2xl border-2 border-b-4 border-fun-yellow-dark bg-fun-yellow px-4 py-2 text-sm font-extrabold transition group-hover:-translate-y-0.5">{current.current > 0 ? 'Keep going' : 'Start'}<ArrowRight size={16} aria-hidden /></span>
          </Link>
        ) : (
          <div className="rounded-3xl border-2 border-b-[6px] border-fun-purple-dark bg-fun-purple p-5 text-on-fun sm:p-6" role="status">
            <p className="flex items-center gap-2 text-2xl font-extrabold"><PartyPopper size={24} aria-hidden />Path complete!</p>
            <p className="mt-1 text-sm font-bold">All {journey.total} steps are done. Keep an eye on your applications and deadlines from here.</p>
          </div>
        )}
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Path progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={journey.overallPct}>
          <div className="h-full rounded-full bg-fun-green transition-all" style={{ width: `${journey.overallPct}%` }} />
        </div>
        <p className="mt-1 text-xs font-bold text-secondary">{journey.doneCount} of {journey.total} steps done ({journey.overallPct}%){journey.skipped ? `. ${journey.skipped} early step${journey.skipped > 1 ? 's' : ''} skipped, optional.` : ''}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Your path">
          <H>Your path</H>
          <p className="mb-4 text-xs text-secondary">Nothing is locked. Tap a part to see its steps, and work in any order you like.</p>
          <JourneyPath key={`${journey.profile.track}-${journey.profile.stage}-${journey.currentUnitId}`} journey={journey} pose={pathPose} />
        </section>
        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <Card className="rounded-2xl"><QuestsCard board={g.quests} /></Card>
          <Card className="rounded-2xl"><H>Weekly summary</H><WeeklySummaryCard w={g.weekly} /></Card>
        </aside>
      </div>

      <section className="mt-8" aria-label="Badges"><H>Badges</H><BadgeShelf badges={g.badges} nextUp={g.nextUp} /></section>
    </div>
  );
}
