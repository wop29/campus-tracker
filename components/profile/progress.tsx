'use client';
// "My progress": the Journey steps (same numbers as the Journey page, from computeJourney), plus deadlines coming up.
// It has no percentage of its own, so it can never disagree with Journey.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, CircleDashed } from 'lucide-react';
import { Card, ErrorBox, Loading } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchJourneyBundle } from '@/lib/gamification-data';
import { computeJourney, type Journey } from '@/lib/journey';
import { useOverviewData } from '@/components/overview/use-overview';
import { computeKpis, deadlineTimeline } from '@/lib/overview-logic';

export function ProgressPanel() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, now } = useOverviewData();
  useEffect(() => {
    const sb = supabaseBrowser();
    void fetchJourneyBundle(sb)
      .then((b) => setJourney(computeJourney(b.journey, b.profile)))
      .catch((e) => setErr((e as Error).message));
  }, []);
  const deadlines = useMemo(() => (data ? deadlineTimeline(data, data.applications, now).slice(0, 3) : []), [data, now]);
  const kpis = useMemo(() => (data ? computeKpis(data, 'USD', now) : null), [data, now]);

  if (err) return <ErrorBox message={err} />;
  if (!journey) return <Loading label="Loading your progress..." />;
  const lessons = journey.units.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u.title })));
  const done = lessons.filter((l) => l.state === 'done');
  const next = lessons.filter((l) => l.state === 'current' || l.state === 'upcoming').slice(0, 3);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-bold">Your Journey: {journey.overallPct}% done</p><Link href="/journey" className="inline-flex min-h-[44px] items-center text-xs font-bold text-accent underline">Same as your Journey. Open it</Link></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-fun-green" style={{ width: `${journey.overallPct}%` }} /></div>
        <p className="mt-2 text-xs text-secondary">{journey.doneCount} of {journey.total} Journey steps done{journey.skipped ? `, ${journey.skipped} early steps skipped (optional)` : ''}. Small steps add up.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-bold">Coming up next</h3>
          {next.length === 0 ? <p className="text-sm text-secondary">You have finished every step. Well done!</p> : (
            <ul className="space-y-2">{next.map((l, i) => (
              <li key={l.id}><Link href={l.href} className="flex items-start gap-2 text-sm hover:underline">
                {i === 0 ? <CircleDashed size={18} className="mt-0.5 shrink-0 text-fun-blue" /> : <Circle size={18} className="mt-0.5 shrink-0 text-secondary" />}
                <span><span className="font-semibold">{l.title}</span><span className="block text-xs text-secondary">{l.unit}</span></span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-bold">What you have done</h3>
          {done.length === 0 ? <p className="text-sm text-secondary">Nothing yet, and that is fine. Your first step takes about 2 minutes.</p> : (
            <ul className="space-y-2">{done.map((l) => (
              <li key={l.id} className="flex items-start gap-2 text-sm"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-fun-green" /><span>{l.title}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card>
        <h3 className="mb-2 text-sm font-bold">Deadlines coming up</h3>
        {deadlines.length === 0 ? <p className="text-sm text-secondary">No deadlines in the next 30 days.</p> : (
          <ul className="space-y-1 text-sm">{deadlines.map((d) => (
            <li key={d.deadline.id} className="flex justify-between gap-3"><span>{d.school?.name ?? 'School'}: {d.deadline.name}</span><span className={d.overdue ? 'font-semibold text-danger' : 'text-secondary'}>{new Date(d.deadline.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></li>
          ))}</ul>
        )}
        {kpis && <p className="mt-3 text-xs text-secondary">{kpis.targetSchools} schools on your list, {kpis.inProgress} applications in progress, {kpis.submitted} submitted.</p>}
      </Card>
    </div>
  );
}
