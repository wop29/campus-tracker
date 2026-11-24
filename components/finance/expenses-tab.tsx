'use client';
import { useMemo, useState } from 'react';
import { Download, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { must } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { EXPENSE_CATEGORIES, PAYMENT_STATUSES, convertToBase, expensesToCsv, type ExpenseRow, type ExpenseInput } from '@/lib/finance';
import { fmtDate, titleCase } from '@/lib/utils';
import { ExpenseForm } from './expense-form';
import { appLabel, downloadText, money, schoolLabel, type AppLite, type SchoolLite } from './shared';

const tone = { planned: 'neutral', due: 'warning', paid: 'success', refunded: 'accent' } as const;

export function ExpensesTab({ expenses, schools, apps, base, reload }: { expenses: ExpenseRow[]; schools: SchoolLite[]; apps: AppLite[]; base: string; reload: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ school: '', category: '', status: '', q: '' });
  const [editing, setEditing] = useState<Partial<ExpenseRow> | null>(null); const [open, setOpen] = useState(false); const [busyId, setBusyId] = useState<string | null>(null);
  const schoolMap = useMemo(() => new Map(schools.map((s) => [s.id, s])), [schools]);
  const appMap = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const rows = useMemo(() => expenses.filter((e) => (!f.school || e.school_id === f.school) && (!f.category || e.category === f.category) && (!f.status || e.payment_status === f.status) && (!f.q || [e.description, e.notes, e.category].some((x) => x?.toLowerCase().includes(f.q.toLowerCase())))), [expenses, f]);

  async function save(v: ExpenseInput) {
    const sb = supabaseBrowser();
    if (editing?.id) await must(sb.from('expenses').update({ ...v, updated_at: new Date().toISOString() }).eq('id', editing.id));
    else await must(sb.from('expenses').insert(v));
    toast('Expense saved'); setOpen(false); setEditing(null); await reload();
  }
  async function remove(id: string) {
    if (busyId) return; setBusyId(id);
    try { await must(supabaseBrowser().from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id)); toast('Expense deleted'); await reload(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusyId(null); }
  }
  // Quick add from application_fee: only applications with a fee and no existing application_fee expense row.
  const quick = apps.filter((a) => !a.deleted_at && a.application_fee != null && a.application_fee > 0 && !expenses.some((e) => e.application_id === a.id && e.category === 'application_fee'));
  async function quickAdd(a: AppLite) {
    if (busyId) return; setBusyId(a.id);
    try {
      await must(supabaseBrowser().from('expenses').insert({ school_id: a.school_id, application_id: a.id, category: 'application_fee', description: `Application fee, ${appLabel(a, schoolMap)}`, estimated_cost: a.application_fee, currency: a.fee_currency, payment_status: 'planned' }));
      toast('Expense added from application fee'); await reload();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusyId(null); }
  }
  return (
    <div className="space-y-4">
      {quick.length > 0 && (
        <Card><p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Zap size={14} /> Quick-add from application fees</p>
          <ul className="divide-y">{quick.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"><span>{appLabel(a, schoolMap)}: {money(a.application_fee, a.fee_currency)}</span><Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => quickAdd(a)}>{busyId === a.id ? 'Adding...' : 'Add as planned expense'}</Button></li>))}</ul></Card>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label="Filter by school" className="w-44" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })}><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select aria-label="Filter by category" className="w-44" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
        <Select aria-label="Filter by status" className="w-36" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{PAYMENT_STATUSES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
        <Input aria-label="Search expenses" placeholder="Search" className="w-44" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={!rows.length} onClick={() => downloadText(`expenses-${new Date().toISOString().slice(0, 10)}.csv`, expensesToCsv(rows, (id) => (id ? schoolLabel(schoolMap.get(id)) : ''), (id) => (id ? appLabel(appMap.get(id), schoolMap) : '')))}><Download size={14} /> Export CSV</Button>
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={14} /> Add expense</Button>
        </div>
      </div>
      {expenses.length === 0 ? <EmptyState title="No expenses yet" hint="Add an application fee, test fee or other cost to start your budget." action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add expense</Button>} />
        : rows.length === 0 ? <EmptyState title="No expenses match these filters" />
        : (
          <div className="overflow-x-auto rounded-lg border bg-surface"><table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs text-secondary"><tr>{['School', 'Category', 'Description', 'Estimated', 'Actual', 'Paid on', 'Status', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y">{rows.map((e) => {
              const noRate = e.currency.toUpperCase() !== base && convertToBase(1, e.currency, base, e.fx_rate_to_base) == null;
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2">{e.school_id ? schoolLabel(schoolMap.get(e.school_id)) : '-'}</td>
                  <td className="px-3 py-2">{titleCase(e.category)}</td>
                  <td className="max-w-[16rem] truncate px-3 py-2" title={e.description ?? ''}>{e.description || '-'}</td>
                  <td className="px-3 py-2 tabular-nums">{money(e.estimated_cost, e.currency)}{noRate && <div><Badge tone="warning">No {e.currency} to {base} rate</Badge></div>}</td>
                  <td className="px-3 py-2 tabular-nums">{money(e.actual_cost, e.currency)}</td>
                  <td className="px-3 py-2">{fmtDate(e.payment_date)}</td>
                  <td className="px-3 py-2"><Badge tone={tone[e.payment_status as keyof typeof tone] ?? 'neutral'}>{titleCase(e.payment_status)}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" aria-label="Edit expense" onClick={() => { setEditing(e); setOpen(true); }}><Pencil size={14} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Delete expense" disabled={busyId === e.id} onClick={() => { if (window.confirm('Delete this expense?')) void remove(e.id); }}><Trash2 size={14} /></Button>
                  </td>
                </tr>);
            })}</tbody>
          </table></div>)}
      <ExpenseForm open={open} initial={editing} base={base} schools={schools} apps={apps} onClose={() => { setOpen(false); setEditing(null); }} onSubmit={save} />
    </div>
  );
}
