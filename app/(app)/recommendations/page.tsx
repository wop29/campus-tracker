'use client';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { RecommendationRow, RecommenderRow } from '@/lib/recommendations';
import { useSchoolsApps } from '@/components/essays/data';
import { RecommendersPanel } from '@/components/recs/RecommendersPanel';
import { TrackingPanel } from '@/components/recs/TrackingPanel';
import { loadOnboarding } from '@/components/onboarding/data';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Track } from '@/lib/onboarding';

const TABS = [{ id: 'tracking', label: 'Tracking by school' }, { id: 'people', label: 'Your recommenders' }] as const;
export default function Page() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('tracking');
  const [track, setTrack] = useState<Track | undefined>(undefined);
  // The track only changes wording, so a failed load keeps the general wording.
  useEffect(() => { let live = true; loadOnboarding(supabaseBrowser()).then((o) => { if (live) setTrack(o.track); }).catch(() => {}); return () => { live = false; }; }, []);
  const { apps, error: appsErr, loading: appsLoading, reload: reloadApps } = useSchoolsApps();
  const people = useQuery<RecommenderRow[]>((sb) => sb.from('recommenders').select('*').is('deleted_at', null).order('name'), []);
  const recs = useQuery<RecommendationRow[]>((sb) => sb.from('recommendations').select('*').order('created_at'), []);
  const reload = () => { void people.reload(); void recs.reload(); reloadApps(); };
  const loading = (people.loading || recs.loading || appsLoading) && !people.data;
  return (
    <div>
      <PageHeader title="Recommenders" subtitle={track === 'undergrad' ? 'Keep track of each teacher or counselor, university by university. A letter sent to one university is never counted for another.' : 'Track each recommender school by school. A letter submitted for one school is never counted for another.'} />
      <div role="tablist" aria-label="Recommenders" className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === t.id ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      {loading ? <Loading /> : people.error || recs.error || appsErr ? <ErrorBox message={(people.error || recs.error || appsErr)!} onRetry={reload} /> : tab === 'people'
        ? <RecommendersPanel track={track} recommenders={people.data ?? []} onChanged={reload} />
        : <TrackingPanel track={track} recommenders={people.data ?? []} recs={recs.data ?? []} apps={apps.filter((a) => a.stage !== 'withdrawn')} onChanged={reload} />}
    </div>
  );
}
