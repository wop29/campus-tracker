'use client';
import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { STAGE_LABEL, TIER_LABEL, type Stage } from '@/lib/constants';
import { searchAll, type SearchApp, type SearchEssay, type SearchSchool } from '@/lib/search';
import { titleCase } from '@/lib/utils';

type Data = { schools: SearchSchool[]; applications: SearchApp[]; essays: SearchEssay[] };

function Results() {
  const q = (useSearchParams().get('q') ?? '').trim();
  const { data, error, loading, reload } = useQuery<Data>(async (sb) => {
    const [s, a, e] = await Promise.all([
      sb.from('schools').select('id,name,short_name,country,location,tier,in_portfolio,notes').is('deleted_at', null),
      sb.from('applications').select('id,school_id,program,intake,round,stage,notes').is('deleted_at', null),
      sb.from('essays').select('id,title,status,school_id,application_id').is('deleted_at', null),
    ]);
    const err = s.error ?? a.error ?? e.error;
    return { data: err ? null : { schools: s.data ?? [], applications: a.data ?? [], essays: e.data ?? [] }, error: err };
  }, []);
  const res = useMemo(() => (data ? searchAll(q, data) : null), [data, q]);
  if (!q) return <EmptyState title="Type something to search" hint="Use the search box in the header to find schools, applications and essay titles." />;
  if (loading) return <Loading label="Searching..." />;
  if (error || !res) return <ErrorBox message={error ?? 'Search failed'} onRetry={() => void reload()} />;
  const total = res.schools.length + res.applications.length + res.essays.length;
  if (!total) return <EmptyState title={`No results for "${q}"`} hint="Try fewer words or a different spelling. Searches cover school names, countries, applications and essay titles." />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-secondary" role="status">{total} result{total === 1 ? '' : 's'} for "{q}"</p>
      {res.schools.length > 0 && (
        <section aria-label="Schools"><h2 className="mb-2 text-sm font-semibold">Schools ({res.schools.length})</h2>
          <ul className="space-y-2">{res.schools.map((s) => (
            <li key={s.id}><Link href="/schools"><Card className="flex flex-wrap items-center justify-between gap-2 p-3 hover:border-accent">
              <div><p className="text-sm font-medium">{s.name}</p><p className="text-xs text-secondary">{[s.location, s.country].filter(Boolean).join(', ') || 'No location recorded'}</p></div>
              <div className="flex gap-1.5">{s.tier && <Badge>{TIER_LABEL[s.tier] ?? s.tier}</Badge>}{s.in_portfolio && <Badge tone="accent">In portfolio</Badge>}</div>
            </Card></Link></li>))}</ul></section>
      )}
      {res.applications.length > 0 && (
        <section aria-label="Applications"><h2 className="mb-2 text-sm font-semibold">Applications ({res.applications.length})</h2>
          <ul className="space-y-2">{res.applications.map((a) => (
            <li key={a.id}><Link href={`/applications?a=${a.id}`}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 hover:border-accent">
              <div><p className="text-sm font-medium">{a.schoolName}</p><p className="text-xs text-secondary">{[a.program, a.intake, a.round].filter(Boolean).join(' · ')}</p></div>
              <Badge>{STAGE_LABEL[a.stage as Stage] ?? titleCase(a.stage)}</Badge>
            </Card></Link></li>))}</ul></section>
      )}
      {res.essays.length > 0 && (
        <section aria-label="Essays"><h2 className="mb-2 text-sm font-semibold">Essays ({res.essays.length})</h2>
          <ul className="space-y-2">{res.essays.map((e) => (
            <li key={e.id}><Link href="/essays"><Card className="flex flex-wrap items-center justify-between gap-2 p-3 hover:border-accent">
              <div><p className="text-sm font-medium">{e.title}</p><p className="text-xs text-secondary">{e.schoolName ?? 'No school linked'}</p></div>
              <Badge>{titleCase(e.status)}</Badge>
            </Card></Link></li>))}</ul></section>
      )}
    </div>
  );
}

export default function SearchPage() {
  return <div><PageHeader title="Search" subtitle="Schools, applications and essay titles." /><Suspense fallback={<Loading />}><Results /></Suspense></div>;
}
