'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, EmptyState, Select } from '@/components/ui';
import { breakdown, budgetSummary, countCostApplications, type ExpenseRow, type Totals } from '@/lib/finance';
import { titleCase } from '@/lib/utils';
import { money, moneyDec, schoolLabel, type AppLite, type SchoolLite } from './shared';

function Subtotals({ t, base }: { t: Totals; base: string }) {
  const other = Object.entries(t.byCurrency).filter(([c]) => c !== base);
  const miss = Object.entries(t.missingRate);
  if (!other.length) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-secondary">
      <p>By currency: {Object.entries(t.byCurrency).map(([c, v]) => money(v, c)).join(' + ')}</p>
      {miss.length > 0 && <p className="text-[#9a6a14]">Not in the total (no exchange rate): {miss.map(([c, v]) => money(v, c)).join(', ')}</p>}
    </div>
  );
}
function Kpi({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return <Card><p className="text-xs font-medium text-secondary">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>{hint && <p className="mt-0.5 text-xs text-secondary">{hint}</p>}{children}</Card>;
}

export function BudgetTab({ expenses, apps, schools, base }: { expenses: ExpenseRow[]; apps: AppLite[]; schools: SchoolLite[]; base: string }) {
  const [basis, setBasis] = useState<'spent' | 'planned'>('spent');
  const schoolMap = useMemo(() => new Map(schools.map((s) => [s.id, s])), [schools]);
  const n = countCostApplications(apps);
  const s = useMemo(() => budgetSummary(expenses, base, n), [expenses, base, n]);
  const byCat = useMemo(() => breakdown(expenses, base, 'category', basis), [expenses, base, basis]);
  const bySchool = useMemo(() => breakdown(expenses, base, 'school', basis, (id) => schoolLabel(schoolMap.get(id)) || 'Unknown school'), [expenses, base, basis, schoolMap]);
  if (expenses.filter((e) => !e.deleted_at).length === 0) return <EmptyState title="No budget data yet" hint="Add expenses on the Application expenses tab and your budget will be calculated here." />;
  const anyMissing = s.planned.missingRateCount + s.spent.missingRateCount > 0;
  const remainingOther = Object.entries(s.remainingByCurrency).filter(([c]) => c !== base);
  return (
    <div className="space-y-4">
      <p className="text-xs text-secondary">Totals are in {base}. Planned budget = estimated costs. Spending = actual costs of expenses marked Paid. Refunded rows are excluded.</p>
      {anyMissing && <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm" role="status">Some expenses are in a currency without a recorded exchange rate to {base}. They are left out of the {base} totals and shown as separate currency subtotals. Add a rate on the expense to include them.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Total budget (planned)" value={money(s.planned.base, base)} hint={s.rowsWithoutEstimate ? `${s.rowsWithoutEstimate} expense(s) have no estimate` : undefined}><Subtotals t={s.planned} base={base} /></Kpi>
        <Kpi label="Actual spending (paid)" value={money(s.spent.base, base)} hint={s.paidWithoutActual ? `${s.paidWithoutActual} paid expense(s) have no actual cost recorded` : undefined}><Subtotals t={s.spent} base={base} /></Kpi>
        <Kpi label="Remaining" value={money(s.remainingBase, base)} hint={s.remainingBase < 0 ? 'Spending is above the planned budget' : 'Planned minus spent'}>
          {remainingOther.length > 0 && <p className="mt-1 text-xs text-secondary">Native currency: {remainingOther.map(([c, v]) => money(v, c)).join(', ')}</p>}</Kpi>
        <Kpi label="Outstanding payments" value={money(s.outstanding.base, base)} hint={`Planned and due, at estimated cost. Of which due: ${money(s.due.base, base)}`}><Subtotals t={s.outstanding} base={base} /></Kpi>
        <Kpi label="Estimated future expenses" value={money(s.futurePlanned.base, base)} hint="Planned, not yet due"><Subtotals t={s.futurePlanned} base={base} /></Kpi>
        {s.costPerApplication != null && <Kpi label="Cost per application" value={moneyDec(s.costPerApplication, base)} hint={`Spent ${money(s.spent.base, base)} across ${s.applicationsCounted} application(s) past the research stage${s.costPerApplicationIncomplete ? '. Excludes spending without an exchange rate.' : ''}`} />}
      </div>
      <div className="flex items-center gap-2"><span className="text-sm text-secondary">Charts show</span>
        <Select aria-label="Chart basis" className="w-44" value={basis} onChange={(e) => setBasis(e.target.value as 'spent' | 'planned')}><option value="spent">Actual spending (paid)</option><option value="planned">Planned budget</option></Select>
        {(byCat.excluded > 0) && <Badge tone="warning">{byCat.excluded} row(s) hidden: no exchange rate</Badge>}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Chart title="By category" data={byCat.slices.map((x) => ({ name: titleCase(x.label), value: x.value }))} base={base} />
        <Chart title="By school" data={bySchool.slices.map((x) => ({ name: x.label, value: x.value }))} base={base} />
      </div>
    </div>
  );
}
function Chart({ title, data, base }: { title: string; data: { name: string; value: number }[]; base: string }) {
  if (!data.length) return null;
  return (
    <Card><p className="mb-2 text-sm font-medium">{title}</p>
      <div style={{ height: Math.max(180, data.length * 38 + 40) }} role="img" aria-label={`${title}: ${data.map((d) => `${d.name} ${d.value.toFixed(0)} ${base}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => money(Number(v), base)} /><Bar dataKey="value" fill="var(--color-accent)" radius={[0, 3, 3, 0]} />
        </BarChart></ResponsiveContainer></div></Card>
  );
}
