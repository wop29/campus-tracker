'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { syncRecommendations } from '@/lib/nba-store';
import { NOTIFICATIONS_CHANGED, syncNotifications } from '@/lib/notifications';
import { parseSettings } from '@/lib/settings';
import { EMPTY_FILTERS, computeKpis, deadlineTimeline, filterApps, type Filters } from '@/lib/overview-logic';
import type { StoredRecommendation } from '@/lib/overview-data';
import { useOverviewData } from '@/components/overview/use-overview';
import { KpiCards } from '@/components/overview/kpi-cards';
import { FilterBar, Pipeline } from '@/components/overview/pipeline';
import { DeadlineTimeline } from '@/components/overview/deadline-timeline';
import { NbaPanel } from '@/components/overview/nba-panel';
import { OverviewStrip } from '@/components/gamification/overview-strip';

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="mt-8"><h2 className="text-base font-semibold">{title}</h2>{hint && <p className="mb-3 text-xs text-secondary">{hint}</p>}<div className={hint ? '' : 'mt-3'}>{children}</div></section>
);

export default function OverviewPage() {
  const { data, error, loading, reload, now } = useOverviewData();
  const recsQ = useQuery<StoredRecommendation[]>((sb) => sb.from('ai_recommendations').select('*').order('score', { ascending: false }), []);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [syncError, setSyncError] = useState<string | null>(null);
  const synced = useRef(false);

  // Once per page load: refresh rule-based recommendations and in-app notifications from the loaded data.
  useEffect(() => {
    if (!data || synced.current) return;
    synced.current = true;
    const sb = supabaseBrowser();
    const settings = parseSettings(data.settings);
    void (async () => {
      try {
        await syncRecommendations(sb, { ...data, now: new Date(), weights: settings.weights });
        await recsQ.reload();
        await syncNotifications(sb, data);
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
        setSyncError(null);
      } catch (e) { setSyncError((e as Error).message); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const settings = useMemo(() => parseSettings(data?.settings), [data]);
  const filtered = useMemo(() => (data ? filterApps(data, filters, now) : []), [data, filters, now]);
  const timeline = useMemo(() => (data ? deadlineTimeline(data, filtered, now) : []), [data, filtered, now]);
  const kpis = useMemo(() => (data ? computeKpis(data, settings.baseCurrency, now) : null), [data, settings.baseCurrency, now]);
  const afterChange = async () => { await Promise.all([recsQ.reload(), reload()]); };

  if (loading) return <Loading label="Loading your dashboard..." />;
  if (error || !data || !kpis) return <ErrorBox message={error ?? 'Could not load data'} onRetry={() => void reload()} />;
  const filterActive = Object.values(filters).some(Boolean);
  return (
    <div>
      <PageHeader title="Overview" subtitle="Where you are and what to do next." />
      <OverviewStrip />
      <KpiCards k={kpis} base={settings.baseCurrency} />
      <Section title="Do these next">
        {recsQ.error ? <ErrorBox message={recsQ.error} onRetry={() => void recsQ.reload()} /> : (
          <NbaPanel recs={recsQ.data ?? []} schools={data.schools} now={now} onChanged={afterChange} error={syncError} />
        )}
      </Section>
      <Section title="Application pipeline">
        <FilterBar data={data} filters={filters} onChange={setFilters} />
        <Pipeline apps={filtered} data={data} filtered={filterActive} />
      </Section>
      <Section title="Deadlines in the next 30 days" hint={filterActive ? 'Filters above also apply here.' : 'Overdue deadlines on unsubmitted applications are included. Edit a date to update it.'}>
        <DeadlineTimeline rows={timeline} now={now} onChanged={() => void reload()} totalDeadlines={data.deadlines.length} />
      </Section>
    </div>
  );
}
