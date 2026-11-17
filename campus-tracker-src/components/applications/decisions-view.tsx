'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, Select } from '@/components/ui';
import { CRITERIA, CURRENCIES, parseMatrix, pickSourced, rankOffers, sourcedTotalCost, weightedTotal, weightOf, type CriterionKey, type MatrixScores } from '@/lib/applications';
import { fmtMoney } from '@/lib/utils';
import { useAction } from './data';

type Offer = {
  id: string; application_id: string; scholarship_amount: number | null; scholarship_currency: string | null; matrix_scores: unknown;
  application: { id: string; program: string; intake: string; round: string | null; school_id: string; school: { id: string; name: string; short_name: string | null } | { id: string; name: string; short_name: string | null }[] | null } | { id: string; program: string; intake: string; round: string | null; school_id: string; school: { id: string; name: string; short_name: string | null } | null }[] | null;
};
type DataRow = { school_id: string; field: string; value_num: number | null; currency: string | null; source_name: string };
type ProgRow = { school_id: string; name: string; duration_months: number | null };
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const numOrNull = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) || Number(s) < 0 ? null : Number(s));

export function DecisionsView() {
  const q = useQuery(async (sb) => {
    const offers = await sb.from('admissions_decisions').select('id,application_id,scholarship_amount,scholarship_currency,matrix_scores,application:applications!inner(id,program,intake,round,school_id,deleted_at,school:schools(id,name,short_name))').eq('decision', 'admitted').is('application.deleted_at', null);
    if (offers.error) return { data: null, error: offers.error };
    const list = (offers.data ?? []) as unknown as Offer[];
    const schoolIds = [...new Set(list.map((o) => first(o.application)?.school_id).filter((x): x is string => !!x))];
    if (!schoolIds.length) return { data: { offers: list, data: [] as DataRow[], progs: [] as ProgRow[] }, error: null };
    const [d, p] = await Promise.all([
      sb.from('school_admissions_data').select('school_id,field,value_num,currency,source_name').in('school_id', schoolIds),
      sb.from('school_programs').select('school_id,name,duration_months').in('school_id', schoolIds),
    ]);
    if (d.error) return { data: null, error: d.error };
    if (p.error) return { data: null, error: p.error };
    return { data: { offers: list, data: (d.data ?? []) as DataRow[], progs: (p.data ?? []) as ProgRow[] }, error: null };
  });
  const { busy, run } = useAction();
  const [weights, setWeights] = useState<MatrixScores['weights']>({});
  const [ratings, setRatings] = useState<Record<string, MatrixScores['ratings']>>({});
  const [inputs, setInputs] = useState<Record<string, { cost: string; salary: string; currency: string }>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const r: typeof ratings = {}, i: typeof inputs = {}; let w: MatrixScores['weights'] = {};
    for (const o of q.data.offers) {
      const m = parseMatrix(o.matrix_scores);
      r[o.application_id] = m.ratings;
      i[o.application_id] = { cost: m.inputs.total_cost == null ? '' : String(m.inputs.total_cost), salary: m.inputs.expected_salary == null ? '' : String(m.inputs.expected_salary), currency: m.inputs.currency ?? 'USD' };
      if (!Object.keys(w).length && Object.keys(m.weights).length) w = m.weights;
    }
    setRatings(r); setInputs(i); setWeights(w); setDirty(false);
  }, [q.data]);

  const rows = useMemo(() => {
    if (!q.data) return [];
    const base = q.data.offers.map((o) => {
      const app = first(o.application); const school = first(app?.school ?? null);
      const data = q.data!.data.filter((d) => d.school_id === app?.school_id);
      const tuition = pickSourced(data, 'tuition'), living = pickSourced(data, 'living'), salary = pickSourced(data, 'salary');
      const sc = sourcedTotalCost(tuition, living);
      const inp = inputs[o.application_id] ?? { cost: '', salary: '', currency: 'USD' };
      const prog = q.data!.progs.filter((p) => p.school_id === app?.school_id).find((p) => p.name.toLowerCase() === app?.program.toLowerCase()) ?? null;
      const entered = numOrNull(inp.cost), enteredSal = numOrNull(inp.salary);
      const { score, rated } = weightedTotal(ratings[o.application_id] ?? {}, weights);
      return { o, app, name: school?.name ?? 'Unknown school', score, rated, duration: prog?.duration_months ?? null,
        cost: entered != null ? { value: entered, currency: inp.currency, note: 'Entered by you' } : { value: sc.value, currency: sc.currency, note: sc.note },
        salary: enteredSal != null ? { value: enteredSal, currency: inp.currency, note: 'Entered by you' } : salary ? { value: salary.value, currency: salary.currency, note: `Researched: ${salary.source}` } : { value: null as number | null, currency: null as string | null, note: 'Not entered' } };
    });
    return rankOffers(base);
  }, [q.data, inputs, ratings, weights]);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!rows.length) return <EmptyState title="No admitted offers yet" hint="When an application's decision is set to Admitted, it appears here for side-by-side comparison. Record decisions on each application's Decision tab." />;

  const setRating = (appId: string, k: CriterionKey, v: string) => { setRatings((s) => ({ ...s, [appId]: { ...s[appId], [k]: v ? Number(v) : undefined } })); setDirty(true); };
  const setInput = (appId: string, k: 'cost' | 'salary' | 'currency', v: string) => { setInputs((s) => ({ ...s, [appId]: { ...s[appId], [k]: v } })); setDirty(true); };
  const wInvalid = CRITERIA.some((c) => weights[c.key] != null && (!(weights[c.key]! >= 0)));

  async function save() {
    const sb = supabaseBrowser();
    const w: MatrixScores['weights'] = {}; for (const c of CRITERIA) w[c.key] = weightOf(weights, c.key);
    const ok = await run(async () => {
      await Promise.all(rows.map(async (r) => {
        const id = r.o.application_id; const inp = inputs[id] ?? { cost: '', salary: '', currency: 'USD' };
        const rt: Record<string, number> = {}; for (const [k, v] of Object.entries(ratings[id] ?? {})) if (v) rt[k] = v;
        const matrix = { weights: w, ratings: rt, inputs: { total_cost: numOrNull(inp.cost), expected_salary: numOrNull(inp.salary), currency: inp.currency } };
        await must(sb.from('admissions_decisions').update({ matrix_scores: matrix }).eq('id', r.o.id));
      }));
    }, 'Decision matrix saved');
    if (ok) { setDirty(false); q.reload(); }
  }
  const money = (x: { value: number | null; currency: string | null }) => (x.value == null ? '-' : fmtMoney(x.value, x.currency ?? 'USD'));

  return (
    <div className="space-y-3">
      <Card className="text-sm text-secondary">
        Rate each offer from 1 (weak) to 5 (strong) on each criterion and set how much each criterion matters to you. Weights default to 1 for every criterion until you change them. Unrated criteria are left out of the total, not counted as zero.
        Dollar figures come from the decision record, your entries, or sourced school data, and are never estimated.
      </Card>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-bg text-xs">
            <tr><th scope="col" className="px-3 py-2 font-medium text-secondary">Criterion</th><th scope="col" className="w-24 px-3 py-2 font-medium text-secondary">Weight</th>
              {rows.map((r) => <th key={r.o.id} scope="col" className="px-3 py-2 font-semibold"><Link className="hover:underline" href={`/applications/${r.o.application_id}?tab=decision`}>{r.name}</Link><div className="font-normal text-secondary">{r.app?.program}</div></th>)}</tr>
          </thead>
          <tbody>
            <tr className="border-b bg-bg/50"><th scope="row" className="px-3 py-2 text-xs font-medium text-secondary" colSpan={2}>Facts (from your records)</th>{rows.map((r) => <td key={r.o.id} />)}</tr>
            <tr className="border-b"><th scope="row" className="px-3 py-2 text-xs font-medium" colSpan={2}>Scholarship awarded</th>{rows.map((r) => <td key={r.o.id} className="px-3 py-2">{r.o.scholarship_amount == null ? <span className="text-secondary">Not recorded</span> : fmtMoney(r.o.scholarship_amount, r.o.scholarship_currency ?? 'USD')}</td>)}</tr>
            <tr className="border-b"><th scope="row" className="px-3 py-2 text-xs font-medium" colSpan={2}>Duration</th>{rows.map((r) => <td key={r.o.id} className="px-3 py-2">{r.duration ? `${r.duration} months` : <span className="text-secondary">Not recorded</span>}</td>)}</tr>
            <tr className="border-b"><th scope="row" className="px-3 py-2 text-xs font-medium" colSpan={2}>Total cost</th>{rows.map((r) => (
              <td key={r.o.id} className="px-3 py-2"><div className="flex gap-1"><Input aria-label={`Total cost for ${r.name}`} inputMode="decimal" className="!py-1 text-xs" placeholder="Enter total" value={inputs[r.o.application_id]?.cost ?? ''} onChange={(e) => setInput(r.o.application_id, 'cost', e.target.value)} /></div><div className="mt-1 text-xs">{money(r.cost)}</div><div className="text-xs text-secondary">{r.cost.note}</div></td>))}</tr>
            <tr className="border-b"><th scope="row" className="px-3 py-2 text-xs font-medium" colSpan={2}>Expected salary</th>{rows.map((r) => (
              <td key={r.o.id} className="px-3 py-2"><Input aria-label={`Expected salary for ${r.name}`} inputMode="decimal" className="!py-1 text-xs" placeholder="Enter salary" value={inputs[r.o.application_id]?.salary ?? ''} onChange={(e) => setInput(r.o.application_id, 'salary', e.target.value)} /><div className="mt-1 text-xs">{money(r.salary)}</div><div className="text-xs text-secondary">{r.salary.note}</div></td>))}</tr>
            <tr className="border-b"><th scope="row" className="px-3 py-2 text-xs font-medium" colSpan={2}>Currency for entered amounts</th>{rows.map((r) => (
              <td key={r.o.id} className="px-3 py-2"><Select aria-label={`Currency for ${r.name}`} className="!py-1 text-xs" value={inputs[r.o.application_id]?.currency ?? 'USD'} onChange={(e) => setInput(r.o.application_id, 'currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></td>))}</tr>
            <tr className="border-b bg-bg/50"><th scope="row" className="px-3 py-2 text-xs font-medium text-secondary" colSpan={2}>Your ratings (1 to 5)</th>{rows.map((r) => <td key={r.o.id} />)}</tr>
            {CRITERIA.map((c) => (
              <tr key={c.key} className="border-b">
                <th scope="row" className="px-3 py-2 text-xs font-medium">{c.label}</th>
                <td className="px-3 py-2"><Input aria-label={`Weight for ${c.label}`} type="number" min={0} max={100} step="0.5" className="!py-1 text-xs" value={weights[c.key] ?? 1} onChange={(e) => { setWeights((s) => ({ ...s, [c.key]: e.target.value === '' ? 0 : Number(e.target.value) })); setDirty(true); }} /></td>
                {rows.map((r) => (
                  <td key={r.o.id} className="px-3 py-2"><Select aria-label={`${c.label} rating for ${r.name}`} className="!py-1 text-xs" value={ratings[r.o.application_id]?.[c.key] ?? ''} onChange={(e) => setRating(r.o.application_id, c.key, e.target.value)}>
                    <option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></td>
                ))}
              </tr>
            ))}
            <tr className="bg-bg font-semibold">
              <th scope="row" className="px-3 py-3" colSpan={2}>Weighted total (out of 5)</th>
              {rows.map((r) => <td key={r.o.id} className="px-3 py-3">{r.score == null ? <span className="font-normal text-secondary">Rate to compute</span> : <>{r.score.toFixed(2)} {r.rank === 1 && <Badge tone="success">Top</Badge>}</>}<div className="text-xs font-normal text-secondary">{r.rated} of {CRITERIA.length} rated{r.rank ? ` · rank ${r.rank}` : ''}</div></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || !dirty || wInvalid}>{busy ? 'Saving...' : 'Save matrix'}</Button>
        {dirty && <span className="text-xs text-secondary">Unsaved changes</span>}
        <span className="text-xs text-secondary">Offers with fewer ratings are not directly comparable: check the "rated" count.</span>
      </div>
    </div>
  );
}
