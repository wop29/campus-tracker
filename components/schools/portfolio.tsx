'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, EmptyState, ErrorBox, Input, Loading, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useQuery, must } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TIERS, TIER_LABEL } from '@/lib/constants';
import { FIELD_CATALOGUE } from '@/lib/schools';
import { SCHOOL_COLS, TIER_NOTE, type SchoolRow } from './shared';
import { CatalogueNav } from './catalogue-nav';
import { SchoolFormModal } from './school-form';

type SortKey = 'name' | 'priority' | 'tier' | 'researched';
const TIER_ORDER: Record<string, number> = Object.fromEntries(TIERS.map((t, i) => [t, i]));

export function PortfolioList({ portfolioOnly }: { portfolioOnly: boolean }) {
  const toast = useToast();
  const schools = useQuery<SchoolRow[]>((sb) => sb.from('schools').select(SCHOOL_COLS).is('deleted_at', null).order('name'), []);
  const points = useQuery<{ school_id: string; field: string }[]>((sb) => sb.from('school_admissions_data').select('school_id, field'), []);
  const [q, setQ] = useState(''); const [country, setCountry] = useState(''); const [tier, setTier] = useState(''); const [pf, setPf] = useState(''); const [prio, setPrio] = useState(''); const [sort, setSort] = useState<SortKey>('name');
  const [adding, setAdding] = useState(false); const [busy, setBusy] = useState<Set<string>>(new Set());

  const counts = useMemo(() => { const m = new Map<string, number>(); (points.data ?? []).forEach((p) => m.set(p.school_id, (m.get(p.school_id) ?? 0) + 1)); return m; }, [points.data]);
  const countries = useMemo(() => [...new Set((schools.data ?? []).map((s) => s.country).filter(Boolean) as string[])].sort(), [schools.data]);
  const shown = useMemo(() => {
    let r = (schools.data ?? []).filter((s) => (!portfolioOnly || s.in_portfolio) && (!q || `${s.name} ${s.short_name ?? ''} ${s.location ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!country || s.country === country)
      && (!tier || (tier === 'none' ? !s.tier : s.tier === tier)) && (!pf || (pf === 'in' ? s.in_portfolio : !s.in_portfolio)) && (!prio || s.priority === Number(prio)));
    r = [...r].sort((a, b) => sort === 'priority' ? a.priority - b.priority || a.name.localeCompare(b.name) : sort === 'tier' ? (TIER_ORDER[a.tier ?? ''] ?? 99) - (TIER_ORDER[b.tier ?? ''] ?? 99) || a.name.localeCompare(b.name) : sort === 'researched' ? (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) : a.name.localeCompare(b.name));
    return r;
  }, [schools.data, portfolioOnly, q, country, tier, pf, prio, sort, counts]);

  async function patch(id: string, p: Partial<SchoolRow>) {
    if (busy.has(id)) return; setBusy((s) => new Set(s).add(id));
    try { await must(supabaseBrowser().from('schools').update(p).eq('id', id).select('id')); await schools.reload(); } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }
  async function remove(s: SchoolRow) {
    try { await must(supabaseBrowser().from('schools').update({ deleted_at: new Date().toISOString() }).eq('id', s.id).select('id')); toast(`${s.name} removed`); await schools.reload(); } catch (e) { toast((e as Error).message, 'err'); }
  }

  const total = schools.data?.length ?? 0;
  return (
    <div>
      <PageHeader title="My list" subtitle="The universities you picked. Mark your dream and target schools and set priorities." actions={<Button variant="secondary" onClick={() => setAdding(true)} className="min-h-11"><Plus size={14} aria-hidden /> Add your own</Button>} />
      <CatalogueNav active="mine" />
      {schools.loading && !schools.data ? <Loading /> : schools.error ? <ErrorBox message={schools.error} onRetry={() => void schools.reload()} /> : total === 0 ? (
        <EmptyState pose="search" title="Your list is empty" hint="Pick universities we have already researched, or add one you like yourself." action={<div className="flex flex-wrap justify-center gap-2"><Link href="/schools?view=find" className="btn-3d inline-flex min-h-11 items-center rounded-2xl border-2 border-b-4 border-fun-green-dark bg-fun-green px-4 text-sm font-bold text-on-fun">Find universities</Link><Button variant="secondary" onClick={() => setAdding(true)} className="min-h-11">Add a university yourself</Button></div>} />
      ) : (
        <>
          <Card className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Input aria-label="Search schools" placeholder="Search name or city" value={q} onChange={(e) => setQ(e.target.value)} className="lg:col-span-2" />
            <Select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{countries.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value)}><option value="">All tiers</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}<option value="none">Unclassified</option></Select>
            {!portfolioOnly && <Select aria-label="Portfolio" value={pf} onChange={(e) => setPf(e.target.value)}><option value="">In or out of portfolio</option><option value="in">In portfolio</option><option value="out">Not in portfolio</option></Select>}
            <Select aria-label="Priority" value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Any priority</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Priority {n}</option>)}</Select>
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="name">Sort: name</option><option value="priority">Sort: priority</option><option value="tier">Sort: tier</option><option value="researched">Sort: most researched</option></Select>
          </Card>
          <p className="mb-2 text-xs text-secondary">{TIER_NOTE} Priority 1 is highest. Showing {shown.length} of {portfolioOnly ? (schools.data ?? []).filter((s) => s.in_portfolio).length : total}.</p>
          {shown.length === 0 ? <EmptyState title={portfolioOnly && !(schools.data ?? []).some((s) => s.in_portfolio) ? 'No schools in your portfolio yet' : 'No schools match these filters'} hint={portfolioOnly ? 'Tick "In portfolio" on a school in My list to shortlist it.' : 'Clear a filter, or find more universities.'} action={<Link href={portfolioOnly ? '/schools?view=mine' : '/schools?view=find'} className="text-sm font-bold text-accent underline">{portfolioOnly ? 'Go to My list' : 'Find universities'}</Link>} /> : (
            <div className="overflow-x-auto rounded-lg border bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b bg-bg text-left text-xs text-secondary"><tr><th className="p-2">School</th><th className="p-2">Tier</th><th className="p-2">Priority</th><th className="p-2">In portfolio</th><th className="p-2">Researched</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y">
                  {shown.map((s) => (
                    <tr key={s.id} className={busy.has(s.id) ? 'opacity-60' : ''}>
                      <td className="p-2"><Link href={`/schools/${s.id}`} className="font-medium text-accent hover:underline">{s.name}</Link><div className="text-xs text-secondary">{[s.location, s.country].filter(Boolean).join(', ') || 'Location not set'}</div></td>
                      <td className="p-2"><Select aria-label={`Tier for ${s.name}`} value={s.tier ?? ''} disabled={busy.has(s.id)} onChange={(e) => void patch(s.id, { tier: e.target.value || null })} className="w-36"><option value="">Unclassified</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select></td>
                      <td className="p-2"><Select aria-label={`Priority for ${s.name}`} value={s.priority} disabled={busy.has(s.id)} onChange={(e) => void patch(s.id, { priority: Number(e.target.value) })} className="w-20">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></td>
                      <td className="p-2"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={s.in_portfolio} disabled={busy.has(s.id)} onChange={(e) => void patch(s.id, { in_portfolio: e.target.checked })} /><span className="sr-only">In portfolio</span></label></td>
                      <td className="p-2">{points.error ? <Badge>unknown</Badge> : counts.get(s.id) ? <Badge tone="accent">{counts.get(s.id)} of {FIELD_CATALOGUE.length} fields</Badge> : <span className="text-secondary">Not researched</span>}</td>
                      <td className="p-2 text-right"><ConfirmButton size="sm" variant="ghost" message={`Remove ${s.name} from your list? Its research data stays in the database but is hidden.`} onConfirm={() => remove(s)}>Remove</ConfirmButton></td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </>
      )}
      <SchoolFormModal open={adding} onClose={() => setAdding(false)} onSaved={() => { void schools.reload(); }} />
    </div>
  );
}
