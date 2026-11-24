'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { syncRecommendations } from '@/lib/nba-store';
import { secondarySuggestions } from '@/lib/nba';
import { nextStep } from '@/lib/journey';
import { parseOnboarding } from '@/lib/onboarding';
import { NOTIFICATIONS_CHANGED, syncNotifications } from '@/lib/notifications';
import { parseSettings } from '@/lib/settings';
import { computeKpis, deadlineTimeline } from '@/lib/overview-logic';
import type { StoredRecommendation } from '@/lib/overview-data';
import { useOverviewData } from '@/components/overview/use-overview';
import { KpiCards } from '@/components/overview/kpi-cards';
import { DeadlineTimeline } from '@/components/overview/deadline-timeline';
import { NbaPanel } from '@/components/overview/nba-panel';
import { NextStepCard } from '@/components/overview/next-step-card';
import { OverviewStrip } from '@/components/gamification/overview-strip';
import { useGamification } from '@/components/gamification/use-gamification';

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="mt-8"><h2 className="text-base font-semibold">{title}</h2>{hint && <p className="mb-3 text-xs text-secondary">{hint}</p>}<div className={hint ? '' : 'mt-3'}>{children}</div></section>
);

export default function OverviewPage() {
  const { data, error, loading, reload, now } = useOverviewData();
  const g = useGamification(true);
  const recsQ = useQuery<StoredRecommendation[]>((sb) => sb.from('ai_recommendations').select('*').order('score', { ascending: false }), []);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const synced = useRef(false);
  const ob = useMemo(() => parseOnboarding(data?.settings), [data]);

  // Once per page load: refresh rule-based recommendations and in-app notifications from the loaded data.
  useEffect(() => {
    if (!data || synced.current) return;
    synced.current = true;
    const sb = supabaseBrowser();
    const settings = parseSettings(data.settings);
    void (async () => {
      try {
        await syncRecommendations(sb, { ...data, now: new Date(), weights: settings.weights, profile: { track: ob.track, stage: ob.stage, program: ob.program } });
        await recsQ.reload();
        await syncNotifications(sb, data);
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
        setSyncError(null);
      } catch (e) { setSyncError((e as Error).message); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const settings = useMemo(() => parseSettings(data?.settings), [data]);
  const timeline = useMemo(() => (data ? deadlineTimeline(data, data.applications, now) : []), [data, now]);
  const kpis = useMemo(() => (data ? computeKpis(data, settings.baseCurrency, now) : null), [data, settings.baseCurrency, now]);
  // One "what's next": the journey step first, then at most two suggestions from the rules engine (no repeats of the step).
  const step = useMemo(() => nextStep(g.journey), [g.journey]);
  const suggestions = useMemo(() => secondarySuggestions(recsQ.data ?? [], { now, stepId: step?.id ?? null, track: ob.track, max: Infinity }), [recsQ.data, now, step, ob.track]);
  const afterChange = async () => { await Promise.all([recsQ.reload(), reload(), g.reload()]); };

  if (loading) return <Loading label="Loading your dashboard..." />;
  if (error || !data || !kpis) return <ErrorBox message={error ?? 'Could not load data'} onRetry={() => void reload()} />;
  const top = suggestions.slice(0, 2), rest = suggestions.slice(2);
  return (
    <div>
      <PageHeader title="Overview" subtitle="Where you are and what to do next." />
      <OverviewStrip g={g} />
      <KpiCards k={kpis} />
      <Section title="Do these next">
        {g.loading && !g.events.length ? <p className="text-sm text-secondary" role="status">Finding your next step...</p> : <NextStepCard step={step} total={g.journey.total} />}
        <div className="mt-4">
          {recsQ.error ? <ErrorBox message={recsQ.error} onRetry={() => void recsQ.reload()} /> : (
            <>
              {top.length > 0 && <h3 className="mb-2 text-sm font-semibold">{step ? 'Also worth doing' : 'Worth doing next'}</h3>}
              <NbaPanel recs={top} schools={data.schools} now={now} onChanged={afterChange} error={syncError} note={top.length > 0} emptyHint="Nothing else needs you right now. Nice." />
              {rest.length > 0 && (
                <div className="mt-3">
                  <button type="button" className="min-h-[44px] text-sm font-semibold text-accent underline" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
                    {showMore ? 'Hide other suggestions' : `Show ${rest.length} more suggestion${rest.length === 1 ? '' : 's'}`}
                  </button>
                  {showMore && <div className="mt-2"><NbaPanel recs={rest} schools={data.schools} now={now} onChanged={afterChange} note={false} /></div>}
                </div>
              )}
            </>
          )}
        </div>
      </Section>
      <Section title="Deadlines in the next 30 days" hint="Overdue deadlines on unsubmitted applications are included. Edit a date to update it.">
        <DeadlineTimeline rows={timeline} now={now} onChanged={() => void reload()} totalDeadlines={data.deadlines.length} />
      </Section>
    </div>
  );
}
