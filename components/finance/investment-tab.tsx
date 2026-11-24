'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { must, useQuery } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ASSUMPTION_NUMBER_KEYS, INVESTMENT_FORMULA, SCENARIOS, assumptionsSchema, computeInvestment, emptyAssumptions, paybackLabel, parseAssumptions, sourcedValue, sumInCurrency, type AdmissionsDatum, type Assumptions, type InvestmentResult, type Scenario, type SourcedValue } from '@/lib/finance';
import { fmtDate, titleCase } from '@/lib/utils';
import { fieldErrors, money, type SchoolLite } from './shared';

type Row = { school_id: string; scenario: Scenario; assumptions: unknown };
type Schol = { id: string; name: string; amount: number | null; currency: string; status: string; school_id: string | null };
type Awarded = { scholarship_id: string; awarded_amount: number | null };
type Draft = Record<Exclude<keyof Assumptions, 'currency'>, string> & { currency: string };
const LABELS: Record<(typeof ASSUMPTION_NUMBER_KEYS)[number], string> = {
  tuition: 'Tuition (whole program)', living: 'Living expenses (whole program)', otherEducation: 'Other education expenses', opportunityCost: 'Opportunity cost (foregone salary)',
  scholarships: 'Scholarships', personalFunds: 'Personal funds available', expectedSalary: 'Expected post-MBA annual salary', preSalary: 'Pre-MBA annual salary',
  loanRate: 'Loan interest rate (% per year)', loanTermYears: 'Loan term (years)', taxRate: 'Tax rate on salary uplift (%)',
};
const toDraft = (a: Assumptions): Draft => ({ ...Object.fromEntries(ASSUMPTION_NUMBER_KEYS.map((k) => [k, a[k]?.toString() ?? ''])), currency: a.currency } as Draft);

export function InvestmentTab({ schools, base }: { schools: SchoolLite[]; base: string }) {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [scenario, setScenario] = useState<Scenario>('base');
  const proj = useQuery<Row[]>((sb) => sb.from('financial_projections').select('school_id,scenario,assumptions').eq('school_id', schoolId || '00000000-0000-0000-0000-000000000000'), [schoolId]);
  const adm = useQuery<AdmissionsDatum[]>((sb) => sb.from('school_admissions_data').select('field,value_num,currency,source_name,source_url,date_accessed,verification_status').eq('school_id', schoolId || '00000000-0000-0000-0000-000000000000'), [schoolId]);
  const sch = useQuery<Schol[]>((sb) => sb.from('scholarships').select('id,name,amount,currency,status,school_id').is('deleted_at', null).eq('school_id', schoolId || '00000000-0000-0000-0000-000000000000'), [schoolId]);
  const awd = useQuery<Awarded[]>((sb) => sb.from('scholarship_applications').select('scholarship_id,awarded_amount'), []);

  const sourced = useMemo(() => ({ tuition: sourcedValue(adm.data ?? [], 'tuition'), living: sourcedValue(adm.data ?? [], 'living'), salary: sourcedValue(adm.data ?? [], 'salary') }), [adm.data]);
  const saved = useMemo(() => new Map((proj.data ?? []).map((r) => [r.scenario, r])), [proj.data]);
  const [drafts, setDrafts] = useState<Record<Scenario, Draft> | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [picked, setPicked] = useState<Set<string>>(new Set());
  const loaded = !proj.loading && !adm.loading && !!schoolId;

  // Build drafts when school data arrives: saved assumptions win; otherwise prefill only from sourced rows.
  useEffect(() => {
    if (!loaded) return;
    const pre = emptyAssumptions(sourced.tuition?.currency ?? base);
    if (sourced.tuition) pre.tuition = sourced.tuition.value;
    if (sourced.living && (sourced.living.currency ?? pre.currency) === pre.currency) pre.living = sourced.living.value;
    if (sourced.salary && (sourced.salary.currency ?? pre.currency) === pre.currency) pre.expectedSalary = sourced.salary.value;
    setDrafts(Object.fromEntries(SCENARIOS.map((s) => [s, toDraft(saved.has(s) ? parseAssumptions(saved.get(s)!.assumptions, base) : pre)])) as Record<Scenario, Draft>);
    setErrs({}); setPicked(new Set());
  }, [loaded, schoolId, proj.data, adm.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => drafts ? Object.fromEntries(SCENARIOS.map((s) => { const p = assumptionsSchema.safeParse(drafts[s]); return [s, p.success ? (p.data as Assumptions) : null]; })) as Record<Scenario, Assumptions | null> : null, [drafts]);
  const results = useMemo(() => parsed ? (Object.fromEntries(SCENARIOS.map((s) => [s, parsed[s] ? computeInvestment(parsed[s]!) : null])) as Record<Scenario, InvestmentResult | null>) : null, [parsed]);
  const awardedMap = useMemo(() => new Map((awd.data ?? []).map((a) => [a.scholarship_id, a.awarded_amount])), [awd.data]);

  const d = drafts?.[scenario];
  const setField = (k: keyof Draft, v: string) => setDrafts((s) => s && ({ ...s, [scenario]: { ...s[scenario], [k]: k === 'currency' ? v.toUpperCase() : v } }));

  function fillScholarships() {
    if (!d) return;
    const items = (sch.data ?? []).filter((x) => picked.has(x.id)).map((x) => ({ amount: awardedMap.get(x.id) ?? x.amount, currency: x.currency }));
    const r = sumInCurrency(items, d.currency || base);
    setField('scholarships', items.length ? String(r.total) : '');
    if (Object.keys(r.excluded).length) toast(`Left out other currencies: ${Object.entries(r.excluded).map(([c, v]) => money(v, c)).join(', ')}`, 'err');
  }
  async function save() {
    if (!drafts || saving || !schoolId) return; setSaving(true);
    try {
      const rows = []; const all: Record<string, string> = {};
      for (const s of SCENARIOS) { const p = assumptionsSchema.safeParse(drafts[s]); if (!p.success) { const fe = fieldErrors(p.error); if (s === scenario) Object.assign(all, fe); else all._other = `${titleCase(s)} scenario has invalid inputs: ${Object.values(fe)[0]}`; } else rows.push({ school_id: schoolId, scenario: s, assumptions: p.data }); }
      setErrs(all);
      if (Object.keys(all).length) { toast(all._other ?? 'Fix the highlighted fields', 'err'); return; }
      await must(supabaseBrowser().from('financial_projections').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'school_id,scenario' }));
      toast('Scenarios saved'); await proj.reload();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }

  const chart = results ? SCENARIOS.filter((s) => results[s]?.totalInvestment != null).map((s) => ({ name: titleCase(s), 'Total investment': results[s]!.totalInvestment!, 'Borrowing': results[s]!.borrowing ?? 0, '10-year net benefit': results[s]!.tenYearNet ?? 0 })) : [];
  const chartCur = parsed?.base?.currency ?? d?.currency ?? base;
  const sameCurrency = parsed ? new Set(SCENARIOS.map((s) => parsed[s]?.currency)).size <= 1 : true;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm" role="note"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
        <p><strong>Estimates, not guarantees.</strong> These results come only from the numbers you enter. They are not predictions of salary, admission or financial outcomes, and they ignore taxes unless you add a tax rate.</p></div>
      <Field label="School" className="max-w-sm"><Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">Choose a school</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      {!schoolId ? <EmptyState title="Pick a school to model the MBA investment" hint="Inputs are saved per school and scenario. Nothing is pre-filled unless it comes from a sourced row on the School Portfolio." />
        : (proj.loading || adm.loading) ? <Loading />
        : proj.error || adm.error ? <ErrorBox message={(proj.error ?? adm.error)!} onRetry={() => { void proj.reload(); void adm.reload(); }} />
        : !d || !results || !parsed ? <Loading />
        : (<>
          <div role="tablist" aria-label="Scenario" className="flex gap-1">{SCENARIOS.map((s) => <button key={s} role="tab" aria-selected={scenario === s} onClick={() => { setScenario(s); setErrs({}); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${scenario === s ? 'bg-primary text-white' : 'bg-white border text-secondary hover:bg-bg'}`}>{titleCase(s)}{saved.has(s) ? '' : ' (unsaved)'}</button>)}</div>
          <Card>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Currency (3-letter code)" error={errs.currency}><Input value={d.currency} maxLength={3} onChange={(e) => setField('currency', e.target.value)} /></Field>
              {ASSUMPTION_NUMBER_KEYS.map((k) => {
                const src: SourcedValue | null = k === 'tuition' ? sourced.tuition : k === 'living' ? sourced.living : k === 'expectedSalary' ? sourced.salary : null;
                return (
                  <Field key={k} label={LABELS[k]} error={errs[k]} hint={k === 'opportunityCost' ? 'Your own estimate of pay you give up' : k === 'preSalary' || k === 'expectedSalary' ? 'Your own input' : undefined}>
                    <Input inputMode="decimal" value={d[k]} onChange={(e) => setField(k, e.target.value)} />
                    {src && <span className="mt-1 block text-xs text-secondary">Source: field "{src.field}", <a className="underline" href={src.sourceUrl} target="_blank" rel="noopener noreferrer">{src.sourceName}</a>, accessed {fmtDate(src.dateAccessed)}{src.currency ? `, ${src.currency}` : ''}. {src.verificationStatus !== 'verified' && <Badge tone="warning">{src.verificationStatus}</Badge>} Check whether it is per year or whole program.</span>}
                  </Field>);
              })}
            </div>
            {(sch.data?.length ?? 0) > 0 && (
              <div className="mt-4 rounded-md border bg-bg p-3"><p className="text-sm font-medium">Fill scholarships from your saved records for this school</p>
                <p className="text-xs text-secondary">Uses the awarded amount when you recorded one, otherwise the entered amount. Amounts in other currencies are skipped, never converted.</p>
                <ul className="mt-2 space-y-1">{sch.data!.map((x) => <li key={x.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.has(x.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} /> {x.name} <span className="text-secondary">({titleCase(x.status)}, {x.amount == null && awardedMap.get(x.id) == null ? 'no amount' : money(awardedMap.get(x.id) ?? x.amount, x.currency)})</span></label></li>)}</ul>
                <Button size="sm" variant="secondary" className="mt-2" onClick={fillScholarships} disabled={picked.size === 0}>Use selected total</Button></div>)}
            <div className="mt-4 flex items-center gap-2"><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save all scenarios'}</Button>{errs._other && <span className="text-sm text-danger" role="alert">{errs._other}</span>}</div>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium">Scenario comparison ({sameCurrency ? chartCur : 'currencies differ, read each column in its own currency'})</p>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-bg text-left text-xs text-secondary"><tr><th scope="col" className="px-3 py-2">Measure</th>{SCENARIOS.map((s) => <th key={s} scope="col" className="px-3 py-2">{titleCase(s)}</th>)}</tr></thead>
              <tbody className="divide-y">
                {([
                  ['Total investment', (r, c) => money(r.totalInvestment, c)], ['Expected borrowing', (r, c) => money(r.borrowing, c)], ['Loan interest', (r, c) => (r.loan ? money(r.loan.totalInterest, c) : r.borrowing ? 'Add rate and term' : money(0, c))],
                  ['Annual salary uplift', (r, c) => money(r.annualUplift, c)], ['Simple payback', (r) => paybackLabel(r.payback)], ['10-year net benefit', (r, c) => money(r.tenYearNet, c)],
                ] as [string, (r: InvestmentResult, c: string) => string][]).map(([label, fn]) => (
                  <tr key={label}><th scope="row" className="px-3 py-2 text-left font-medium">{label}</th>{SCENARIOS.map((s) => <td key={s} className="px-3 py-2 tabular-nums">{results[s] && parsed[s] ? (label === 'Total investment' && results[s]!.totalInvestment == null ? '-' : fn(results[s]!, parsed[s]!.currency)) : <span className="text-danger">Invalid inputs</span>}</td>)}</tr>))}
              </tbody></table></div>
            {Object.values(results).some((r) => r?.notes.length) && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-secondary">{SCENARIOS.flatMap((s) => (results[s]?.notes ?? []).map((n) => <li key={s + n}>{titleCase(s)}: {n}</li>))}</ul>}
          </Card>
          {chart.length > 0 && sameCurrency && (
            <Card><p className="mb-2 text-sm font-medium">Scenarios in {chartCur}</p>
              <div style={{ height: 280 }} role="img" aria-label="Bar chart comparing total investment, borrowing and 10-year net benefit across scenarios"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid vertical={false} stroke="var(--color-border)" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(Number(v), chartCur)} /><Legend />
                <Bar dataKey="Total investment" fill="var(--color-primary)" /><Bar dataKey="Borrowing" fill="var(--color-warning)" /><Bar dataKey="10-year net benefit" fill="var(--color-success)" /></BarChart></ResponsiveContainer></div></Card>)}
          <Card><p className="text-sm font-medium">How this is calculated</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-secondary">{INVESTMENT_FORMULA.map((l) => <li key={l}>{l}</li>)}</ul></Card>
        </>)}
    </div>
  );
}
