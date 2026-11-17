'use client';
import Link from 'next/link';
import { Button, Card, EmptyState, Field, Input, Select } from '@/components/ui';
import { TIERS, TIER_LABEL, STAGES, STAGE_LABEL } from '@/lib/constants';
import type { AppRow, OverviewData } from '@/lib/overview-data';
import { EMPTY_FILTERS, pipelineCounts, type Filters } from '@/lib/overview-logic';

export function FilterBar({ data, filters, onChange }: { data: OverviewData; filters: Filters; onChange: (f: Filters) => void }) {
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onChange({ ...filters, [k]: e.target.value });
  const used = new Set(data.applications.map((a) => a.school_id));
  const schools = data.schools.filter((s) => used.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  const countries = [...new Set(schools.map((s) => s.country).filter((x): x is string => Boolean(x)))].sort();
  const rounds = [...new Set(data.applications.map((a) => a.round).filter((x): x is string => Boolean(x)))].sort();
  const active = Object.values(filters).some(Boolean);
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" role="group" aria-label="Pipeline filters">
      <Field label="School"><Select value={filters.school} onChange={set('school')}><option value="">All</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.short_name || s.name}</option>)}</Select></Field>
      <Field label="Country"><Select value={filters.country} onChange={set('country')}><option value="">All</option>{countries.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Tier"><Select value={filters.tier} onChange={set('tier')}><option value="">All</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select></Field>
      <Field label="Round"><Select value={filters.round} onChange={set('round')}><option value="">All</option>{rounds.map((r) => <option key={r}>{r}</option>)}</Select></Field>
      <Field label="Status"><Select value={filters.status} onChange={set('status')}><option value="">All</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select></Field>
      <Field label="Deadline on or before"><Input type="date" value={filters.deadlineBefore} onChange={set('deadlineBefore')} /></Field>
      <Field label="Priority (1 = highest)"><Select value={filters.priority} onChange={set('priority')}><option value="">All</option>{[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}</Select></Field>
      <div className="flex items-end"><Button variant="secondary" size="sm" disabled={!active} onClick={() => onChange(EMPTY_FILTERS)}>Clear filters</Button></div>
    </div>
  );
}

export function Pipeline({ apps, data, filtered }: { apps: AppRow[]; data: OverviewData; filtered: boolean }) {
  const schools = new Map(data.schools.map((s) => [s.id, s]));
  if (!data.applications.length) return <EmptyState title="No applications yet" hint="Add a school to your portfolio and start an application to see your pipeline." action={<Link href="/schools" className="text-sm text-accent underline">Go to School Portfolio</Link>} />;
  const cols = pipelineCounts(apps);
  return (
    <>
      {filtered && <p className="mb-2 text-xs text-secondary" role="status">Showing {apps.length} of {data.applications.length} applications.</p>}
      <div className="grid gap-2 overflow-x-auto md:grid-cols-4 xl:grid-cols-7" aria-label="Application pipeline">
        {cols.map((c) => (
          <Card key={c.key} className="min-w-[8.5rem] p-3">
            <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-secondary">{c.label}</h3><span className="text-sm font-semibold">{c.apps.length}</span></div>
            <ul className="mt-2 space-y-1">
              {c.apps.length === 0 && <li className="text-xs text-secondary/70">None</li>}
              {c.apps.map((a) => (
                <li key={a.id} className="rounded border bg-white px-2 py-1 text-xs">
                  <span className="font-medium">{schools.get(a.school_id)?.short_name || schools.get(a.school_id)?.name || 'School'}</span>
                  <span className="block text-secondary">{[a.round, STAGE_LABEL[a.stage as keyof typeof STAGE_LABEL]].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
