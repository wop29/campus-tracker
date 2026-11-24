'use client';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { EXPENSE_CATEGORIES, PAYMENT_STATUSES, expenseSchema, type ExpenseRow } from '@/lib/finance';
import { titleCase } from '@/lib/utils';
import { fieldErrors, appLabel, schoolLabel, type AppLite, type SchoolLite } from './shared';

type Form = Record<'school_id' | 'application_id' | 'category' | 'description' | 'estimated_cost' | 'actual_cost' | 'currency' | 'fx_rate_to_base' | 'fx_rate_date' | 'payment_date' | 'payment_status' | 'notes', string>;
const toForm = (e: Partial<ExpenseRow> | null, base: string): Form => ({
  school_id: e?.school_id ?? '', application_id: e?.application_id ?? '', category: e?.category ?? 'application_fee', description: e?.description ?? '',
  estimated_cost: e?.estimated_cost?.toString() ?? '', actual_cost: e?.actual_cost?.toString() ?? '', currency: e?.currency ?? base,
  fx_rate_to_base: e?.fx_rate_to_base?.toString() ?? '', fx_rate_date: e?.fx_rate_date ?? '', payment_date: e?.payment_date ?? '', payment_status: e?.payment_status ?? 'planned', notes: e?.notes ?? '',
});

export function ExpenseForm({ open, initial, base, schools, apps, onClose, onSubmit }: {
  open: boolean; initial: Partial<ExpenseRow> | null; base: string; schools: SchoolLite[]; apps: AppLite[]; onClose: () => void; onSubmit: (v: ReturnType<typeof expenseSchema.parse>) => Promise<void>;
}) {
  if (!open) return null;
  return <Inner key={initial?.id ?? JSON.stringify(initial) ?? 'new'} {...{ initial, base, schools, apps, onClose, onSubmit }} />;
}
function Inner({ initial, base, schools, apps, onClose, onSubmit }: Omit<Parameters<typeof ExpenseForm>[0], 'open'>) {
  const [f, setF] = useState<Form>(() => toForm(initial, base)); const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [fail, setFail] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const schoolMap = new Map(schools.map((s) => [s.id, s]));
  const foreign = f.currency.trim().toUpperCase() !== base;
  const appOptions = apps.filter((a) => !a.deleted_at && (!f.school_id || a.school_id === f.school_id));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = expenseSchema.safeParse({ ...f, fx_rate_to_base: foreign ? f.fx_rate_to_base : '', fx_rate_date: foreign ? f.fx_rate_date : '' });
    if (!p.success) { setErrs(fieldErrors(p.error)); return; }
    setErrs({}); setBusy(true); setFail(null);
    try { await onSubmit(p.data); } catch (x) { setFail((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={initial?.id ? 'Edit expense' : 'Add expense'} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label="School" error={errs.school_id}><Select value={f.school_id} onChange={(e) => setF((s) => ({ ...s, school_id: e.target.value, application_id: '' }))}><option value="">None</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Application" error={errs.application_id}><Select value={f.application_id} onChange={set('application_id')}><option value="">None</option>{appOptions.map((a) => <option key={a.id} value={a.id}>{appLabel(a, schoolMap)}</option>)}</Select></Field>
        <Field label="Category" error={errs.category}><Select value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
        <Field label="Payment status" error={errs.payment_status}><Select value={f.payment_status} onChange={set('payment_status')}>{PAYMENT_STATUSES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
        <Field label="Description" error={errs.description} className="sm:col-span-2"><Input value={f.description} onChange={set('description')} maxLength={500} /></Field>
        <Field label="Estimated cost" error={errs.estimated_cost} hint="Counts toward your planned budget"><Input inputMode="decimal" value={f.estimated_cost} onChange={set('estimated_cost')} /></Field>
        <Field label="Actual cost" error={errs.actual_cost} hint="Counts as spending once status is Paid"><Input inputMode="decimal" value={f.actual_cost} onChange={set('actual_cost')} /></Field>
        <Field label="Currency (3-letter code)" error={errs.currency}><Input value={f.currency} maxLength={3} onChange={(e) => setF((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Payment date" error={errs.payment_date}><Input type="date" value={f.payment_date} onChange={set('payment_date')} /></Field>
        {foreign && (<>
          <Field label={`Exchange rate (1 ${f.currency || '???'} = ? ${base})`} error={errs.fx_rate_to_base} hint="Without a rate this row is excluded from base-currency totals"><Input inputMode="decimal" value={f.fx_rate_to_base} onChange={set('fx_rate_to_base')} /></Field>
          <Field label="Rate date" error={errs.fx_rate_date}><Input type="date" value={f.fx_rate_date} onChange={set('fx_rate_date')} /></Field>
        </>)}
        <Field label="Notes" error={errs.notes} className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        {fail && <p className="text-sm text-danger sm:col-span-2" role="alert">{fail}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save expense'}</Button></div>
      </form>
    </Modal>
  );
}
export { schoolLabel };
