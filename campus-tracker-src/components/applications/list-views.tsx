'use client';
import Link from 'next/link';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmButton, EmptyState, Input, ProgressBar, RiskBadge, Select } from '@/components/ui';
import { timeRemaining } from '@/lib/logic/risk';
import { fmtDateTime } from '@/lib/utils';
import { PIPELINE, STAGES, STAGE_LABEL, TIER_LABEL, TIERS, type Stage } from '@/lib/constants';
import { QUICK_FILTERS, QUICK_LABEL, SORTS, type Enriched, type ListFilters, type SortKey } from '@/lib/applications';

const stageTone = (s: Stage) => (s === 'admitted' ? 'success' : s === 'rejected' || s === 'withdrawn' ? 'danger' : s === 'waitlisted' ? 'warning' : s === 'researching' || s === 'shortlisted' ? 'neutral' : 'accent') as 'success';
export const schoolLabel = (r: Enriched) => r.school?.short_name || r.school?.name || 'Unknown school';

export function FilterBar({ rows, f, setF, sort, setSort, dir, setDir }: {
  rows: Enriched[]; f: ListFilters; setF: (f: ListFilters) => void; sort: SortKey; setSort: (s: SortKey) => void; dir: 'asc' | 'desc'; setDir: (d: 'asc' | 'desc') => void;
}) {
  const set = (k: keyof ListFilters, v: string) => setF({ ...f, [k]: v });
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const schools = [...new Map(rows.map((r) => [r.school_id, r.school?.name ?? 'Unknown'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((q) => (
          <button key={q} onClick={() => set('quick', q)} aria-pressed={f.quick === q}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${f.quick === q ? 'border-primary bg-primary text-white' : 'bg-white text-secondary hover:bg-bg'}`}>{QUICK_LABEL[q]}</button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Input placeholder="Search school, program, notes" aria-label="Search" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <Select aria-label="School" value={f.school} onChange={(e) => set('school', e.target.value)}><option value="">All schools</option>{schools.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select aria-label="Country" value={f.country} onChange={(e) => set('country', e.target.value)}><option value="">All countries</option>{uniq(rows.map((r) => r.school?.country)).map((c) => <option key={c}>{c}</option>)}</Select>
        <Select aria-label="Tier" value={f.tier} onChange={(e) => set('tier', e.target.value)}><option value="">All tiers</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select>
        <Select aria-label="Round" value={f.round} onChange={(e) => set('round', e.target.value)}><option value="">All rounds</option>{uniq(rows.map((r) => r.round)).map((c) => <option key={c}>{c}</option>)}</Select>
        <Select aria-label="Stage" value={f.stage} onChange={(e) => set('stage', e.target.value)}><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
        <Select aria-label="Deadline" value={f.deadline} onChange={(e) => set('deadline', e.target.value)}>
          <option value="">Any deadline</option><option value="overdue">Overdue</option><option value="7">Within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option><option value="none">No deadline set</option>
        </Select>
        <Select aria-label="Priority" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="">Any priority</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Priority {n}</option>)}</Select>
        <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{SORTS.map((s) => <option key={s} value={s}>Sort: {s}</option>)}</Select>
        <Button variant="secondary" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">{dir === 'asc' ? 'Ascending' : 'Descending'}</Button>
      </div>
    </div>
  );
}

function DeadlineCell({ r }: { r: Enriched }) {
  if (!r.nearest) return <span className="text-xs text-secondary">No deadline</span>;
  return (
    <div className="text-xs">
      <div>{fmtDateTime(r.nearest.due_at)}</div>
      <div className="text-secondary">{timeRemaining(r.nearest.due_at)}</div>
      {r.risk && <div className="mt-0.5" title={r.risk.reason}><RiskBadge risk={r.risk.risk} /></div>}
    </div>
  );
}

export function PipelineView({ rows }: { rows: Enriched[] }) {
  if (!rows.length) return <EmptyState title="No applications match" hint="Clear a filter or create an application." />;
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {PIPELINE.map((col) => {
        const items = rows.filter((r) => col.stages.includes(r.stage));
        return (
          <section key={col.key} className="w-64 shrink-0" aria-label={col.label}>
            <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-secondary">{col.label}<span className="rounded-full bg-white px-2 py-0.5 border">{items.length}</span></h2>
            <div className="space-y-2">
              {items.map((r) => (
                <Link key={r.id} href={`/applications/${r.id}`} className="block rounded-lg border bg-white p-3 shadow-sm hover:border-accent">
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{schoolLabel(r)}</span>{col.stages.length > 1 || col.key === 'decision' ? <Badge tone={stageTone(r.stage)}>{STAGE_LABEL[r.stage]}</Badge> : null}</div>
                  <p className="text-xs text-secondary">{r.program} · {r.intake}{r.round ? ` · ${r.round}` : ''}</p>
                  <div className="mt-2 flex items-center gap-2"><div className="flex-1"><ProgressBar value={r.readinessPct} tone={r.readinessPct >= 80 ? 'success' : 'accent'} /></div><span className="text-xs tabular-nums">{r.readinessPct}%</span></div>
                  <div className="mt-2"><DeadlineCell r={r} /></div>
                </Link>
              ))}
              {!items.length && <p className="rounded-lg border border-dashed p-3 text-center text-xs text-secondary">None</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TableView({ rows, onEdit, onDelete }: { rows: Enriched[]; onEdit: (r: Enriched) => void; onDelete: (r: Enriched) => void }) {
  if (!rows.length) return <EmptyState title="No applications match" hint="Clear a filter or create an application." />;
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b bg-bg text-xs text-secondary"><tr>{['School', 'Program / round', 'Stage', 'Readiness', 'Nearest deadline', 'Priority', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 align-top">
              <td className="px-3 py-2"><Link className="font-medium hover:underline" href={`/applications/${r.id}`}>{r.school?.name ?? 'Unknown school'}</Link><div className="text-xs text-secondary">{[r.school?.country, r.school?.tier ? TIER_LABEL[r.school.tier] : null].filter(Boolean).join(' · ')}</div></td>
              <td className="px-3 py-2 text-xs">{r.program}<div className="text-secondary">{r.intake}{r.round ? ` · ${r.round}` : ''}</div></td>
              <td className="px-3 py-2"><Badge tone={stageTone(r.stage)}>{STAGE_LABEL[r.stage]}</Badge></td>
              <td className="px-3 py-2"><div className="w-28"><ProgressBar value={r.readinessPct} /></div><span className="text-xs tabular-nums">{r.readinessPct}%</span>{r.mandatoryOpen > 0 && <span className="ml-1 text-xs text-secondary">({r.mandatoryOpen} mandatory open)</span>}</td>
              <td className="px-3 py-2"><DeadlineCell r={r} /></td>
              <td className="px-3 py-2 tabular-nums">{r.priority}</td>
              <td className="px-3 py-2"><div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onEdit(r)} aria-label={`Edit ${schoolLabel(r)}`}><Pencil size={14} /></Button>
                <ConfirmButton size="sm" variant="ghost" message={`Delete the ${schoolLabel(r)} application? Essays are kept. This hides the application and its requirements.`} onConfirm={() => onDelete(r)} aria-label={`Delete ${schoolLabel(r)}`}><Trash2 size={14} /></ConfirmButton>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
