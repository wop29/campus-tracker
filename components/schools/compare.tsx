'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { applicantMetrics, buildComparison, comparisonToCsv, MAX_COMPARE, MIN_COMPARE, type DataRow, type DeadlineInput } from '@/lib/schools';
import type { EducationRow, GoalsRow, TestRow } from '@/lib/profile';
import { currentUserId } from '@/components/profile/data';
import { SourceLink, type SchoolRow } from './shared';
import { CatalogueNav } from './catalogue-nav';

interface Saved { id: string; name: string; school_ids: string[]; created_at: string }
interface Extra { data: DataRow[]; programs: { school_id: string; duration_months: number | null; format: string | null }[]; deadlines: DeadlineInput[]; goals: GoalsRow | null; tests: TestRow[]; education: EducationRow[] }
type AppRow = { school_id: string; round: string | null; deadlines: { due_at: string; name: string }[] };

export function CompareView() {
  const toast = useToast();
  const schools = useQuery<SchoolRow[]>((sb) => sb.from('schools').select('id, name, short_name, country, location, website_url, admissions_url, tier, in_portfolio, priority, notes, ranking').is('deleted_at', null).order('name'), []);
  const saved = useQuery<Saved[]>((sb) => sb.from('saved_comparisons').select('id, name, school_ids, created_at').order('created_at', { ascending: false }), []);
  const [sel, setSel] = useState<string[]>([]); const [extra, setExtra] = useState<Extra | null>(null); const [loadErr, setLoadErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [name, setName] = useState(''); const [nameErr, setNameErr] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [onlyPf, setOnlyPf] = useState(false);

  const loadExtra = useCallback(async (ids: string[]) => {
    if (ids.length < MIN_COMPARE) { setExtra(null); return; }
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [data, programs, apps, goals, tests, education] = await Promise.all([
        must(sb.from('school_admissions_data').select('*').in('school_id', ids)) as Promise<DataRow[]>,
        must(sb.from('school_programs').select('school_id, duration_months, format').in('school_id', ids)) as Promise<Extra['programs']>,
        must(sb.from('applications').select('school_id, round, deadlines(due_at, name)').in('school_id', ids).is('deleted_at', null)) as Promise<AppRow[]>,
        must(sb.from('career_goals').select('*').maybeSingle()) as Promise<GoalsRow | null>,
        must(sb.from('test_scores').select('*').is('deleted_at', null)) as Promise<TestRow[]>,
        must(sb.from('education_records').select('*').is('deleted_at', null)) as Promise<EducationRow[]>,
      ]);
      const deadlines = apps.flatMap((a) => (a.deadlines ?? []).map((d) => ({ school_id: a.school_id, due_at: d.due_at, name: `${a.round ? `${a.round}, ` : ''}${d.name}` })));
      setExtra({ data, programs, deadlines, goals, tests, education }); setLoadErr(null);
    } catch (e) { setLoadErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadExtra(sel); }, [sel, loadExtra]);

  function toggle(id: string) {
    setSel((s) => { if (s.includes(id)) return s.filter((x) => x !== id); if (s.length >= MAX_COMPARE) { toast(`You can compare at most ${MAX_COMPARE} schools`, 'err'); return s; } return [...s, id]; });
  }
  const chosen = useMemo(() => sel.map((id) => schools.data?.find((s) => s.id === id)).filter(Boolean) as SchoolRow[], [sel, schools.data]);
  const rows = useMemo(() => {
    if (!extra || chosen.length < MIN_COMPARE) return null;
    return buildComparison({ schools: chosen.map((s) => ({ id: s.id, name: s.name, country: s.country, location: s.location, program: extra.programs.find((p) => p.school_id === s.id) ?? null })), data: extra.data, goals: extra.goals, deadlines: extra.deadlines, applicant: applicantMetrics(extra.tests, extra.education) });
  }, [extra, chosen]);

  async function save() {
    if (saving) return; const n = name.trim();
    if (!n) { setNameErr('Give the comparison a name'); return; } if (n.length > 120) { setNameErr('Max 120 characters'); return; }
    if (sel.length < MIN_COMPARE || sel.length > MAX_COMPARE) { setNameErr(`Pick ${MIN_COMPARE} to ${MAX_COMPARE} schools first`); return; }
    setNameErr(null); setSaving(true);
    try { const sb = supabaseBrowser(); await must(sb.from('saved_comparisons').insert({ user_id: await currentUserId(sb), name: n, school_ids: sel }).select('id')); toast('Comparison saved'); setName(''); await saved.reload(); } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  function load(c: Saved) {
    const live = c.school_ids.filter((id) => schools.data?.some((s) => s.id === id));
    if (live.length < c.school_ids.length) toast(`${c.school_ids.length - live.length} school(s) in this comparison were removed`, 'err');
    setSel(live.slice(0, MAX_COMPARE)); setName(c.name);
  }
  async function del(c: Saved) { try { await must(supabaseBrowser().from('saved_comparisons').delete().eq('id', c.id).select('id')); toast('Comparison deleted'); await saved.reload(); } catch (e) { toast((e as Error).message, 'err'); } }
  function exportCsv() {
    if (!rows) return; const blob = new Blob(['﻿' + comparisonToCsv(chosen, rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `school-comparison-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const list = (schools.data ?? []).filter((s) => !onlyPf || s.in_portfolio || sel.includes(s.id));
  return (
    <div>
      <PageHeader title="Compare universities" subtitle="Compare 2 to 5 schools on your list side by side. Only sourced data is shown." />
      <CatalogueNav active="compare" />
      {schools.loading && !schools.data ? <Loading /> : schools.error ? <ErrorBox message={schools.error} onRetry={() => void schools.reload()} /> : (schools.data ?? []).length === 0 ? <EmptyState title="No schools to compare" hint="Add universities to your list first." action={<Link href="/schools?view=find" className="text-sm font-bold text-accent underline">Find universities</Link>} /> : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-3">
            <Card className="space-y-2">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Pick schools</h2><Badge tone={sel.length >= MIN_COMPARE ? 'success' : 'neutral'}>{sel.length} of {MAX_COMPARE}</Badge></div>
              <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={onlyPf} onChange={(e) => setOnlyPf(e.target.checked)} /> Portfolio schools only</label>
              <ul className="max-h-80 space-y-1 overflow-auto">
                {list.map((s) => { const on = sel.includes(s.id); const full = !on && sel.length >= MAX_COMPARE; return (
                  <li key={s.id}><label className={cn('flex items-center gap-2 rounded px-1 py-1 text-sm', full ? 'opacity-50' : 'hover:bg-bg')}><input type="checkbox" checked={on} disabled={full} onChange={() => toggle(s.id)} />{s.name}</label></li>); })}
              </ul>
              {sel.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear selection</Button>}
            </Card>
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Saved comparisons</h2>
              {saved.error ? <p className="text-xs text-danger">{saved.error}</p> : (saved.data ?? []).length === 0 ? <p className="text-xs text-secondary">None saved yet.</p> : (
                <ul className="space-y-1">{saved.data!.map((c) => (<li key={c.id} className="flex items-center justify-between gap-2 text-sm"><button className="truncate text-left text-accent hover:underline" title={`Load (${c.school_ids.length} schools, saved ${fmtDate(c.created_at)})`} onClick={() => load(c)}>{c.name}</button><button aria-label={`Delete ${c.name}`} onClick={() => { if (window.confirm('Delete this saved comparison?')) void del(c); }} className="rounded p-1 text-secondary hover:bg-bg"><Trash2 size={14} /></button></li>))}</ul>)}
              <form className="space-y-2 border-t pt-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <Field label="Save current selection as" error={nameErr}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. East coast shortlist" maxLength={120} /></Field>
                <Button type="submit" size="sm" disabled={saving || sel.length < MIN_COMPARE}><Save size={14} /> {saving ? 'Saving...' : 'Save comparison'}</Button>
              </form>
            </Card>
          </div>
          <div className="min-w-0">
            {sel.length < MIN_COMPARE ? <EmptyState title="Pick at least 2 schools" hint={`Choose ${MIN_COMPARE} to ${MAX_COMPARE} schools on the left to build the table.`} /> : loadErr ? <ErrorBox message={loadErr} onRetry={() => void loadExtra(sel)} /> : loading && !rows ? <Loading /> : rows && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-secondary">Green cells are the more favourable value where a direction is clear (lower ranking number and tuition, higher employment rate and salary), and only when all values use the same currency. GMAT, GPA, class size and duration are not highlighted because better depends on fit. Compare GMAT figures only if they use the same GMAT version.</p><Button size="sm" variant="secondary" onClick={exportCsv}><Download size={14} /> Export CSV</Button></div>
                <div className="overflow-x-auto rounded-lg border bg-surface">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="border-b bg-bg text-left"><tr><th className="p-2 text-xs text-secondary">Metric</th>{chosen.map((s) => <th key={s.id} className="p-2"><Link className="text-accent hover:underline" href={`/schools/${s.id}`}>{s.name}</Link></th>)}</tr></thead>
                    <tbody className="divide-y">
                      {rows.map((r) => (
                        <tr key={r.key} className="align-top"><th scope="row" className="w-44 p-2 text-left text-xs font-medium text-secondary">{r.label}</th>
                          {r.cells.map((c, i) => (
                            <td key={i} className={cn('p-2', r.best[i] && 'bg-success/10 font-semibold')}>
                              {c.missing ? <span className="italic text-secondary">{c.text}</span> : <span>{c.text}</span>}
                              {r.best[i] && <span className="ml-1 text-xs text-success">best</span>}
                              {!c.missing && c.flags.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{c.flags.map((f) => <Badge key={f} tone={f === 'unverified' ? 'warning' : f.includes('outdated') ? 'danger' : 'neutral'}>{f}</Badge>)}</div>}
                              {c.url && !c.missing && <div className="mt-0.5 text-xs"><SourceLink name="source" url={c.url} /></div>}
                            </td>))}
                        </tr>))}
                    </tbody>
                  </table>
                </div>
              </div>)}
          </div>
        </div>)}
    </div>
  );
}
