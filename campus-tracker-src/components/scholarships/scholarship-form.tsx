'use client';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { SCHOLARSHIP_CATEGORIES, SCHOLARSHIP_STATUSES, scholarshipSchema, type ScholarshipInput, type ScholarshipRow } from '@/lib/scholarships';
import { titleCase } from '@/lib/utils';
import { fieldErrors, type SchoolLite } from '@/components/finance/shared';

type F = Record<'name' | 'institution' | 'school_id' | 'amount' | 'currency' | 'category' | 'eligibility' | 'requirements' | 'deadline' | 'website_url' | 'source_verified_on' | 'status' | 'notes', string>;
const init = (s: ScholarshipRow | null): F => ({
  name: s?.name ?? '', institution: s?.institution ?? '', school_id: s?.school_id ?? '', amount: s?.amount?.toString() ?? '', currency: s?.currency ?? 'USD', category: s?.category ?? '',
  eligibility: s?.eligibility ?? '', requirements: s?.requirements ?? '', deadline: s?.deadline ?? '', website_url: s?.website_url ?? '', source_verified_on: s?.source_verified_on ?? '', status: s?.status ?? 'identified', notes: s?.notes ?? '',
});

export function ScholarshipForm({ open, initial, schools, onClose, onSubmit }: { open: boolean; initial: ScholarshipRow | null; schools: SchoolLite[]; onClose: () => void; onSubmit: (v: ScholarshipInput) => Promise<void> }) {
  if (!open) return null;
  return <Inner key={initial?.id ?? 'new'} {...{ initial, schools, onClose, onSubmit }} />;
}
function Inner({ initial, schools, onClose, onSubmit }: Omit<Parameters<typeof ScholarshipForm>[0], 'open'>) {
  const [f, setF] = useState<F>(() => init(initial)); const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [fail, setFail] = useState<string | null>(null);
  const set = (k: keyof F) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = scholarshipSchema.safeParse(f); if (!p.success) { setErrs(fieldErrors(p.error)); return; }
    setErrs({}); setBusy(true); setFail(null);
    try { await onSubmit(p.data); } catch (x) { setFail((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit scholarship' : 'Add scholarship'} wide>
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errs.name} className="sm:col-span-2"><Input value={f.name} onChange={set('name')} maxLength={200} /></Field>
        <Field label="Institution or provider" error={errs.institution}><Input value={f.institution} onChange={set('institution')} /></Field>
        <Field label="Linked school" error={errs.school_id}><Select value={f.school_id} onChange={set('school_id')}><option value="">None (external)</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Amount" error={errs.amount} hint="Leave blank if not published"><Input inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Currency (3-letter code)" error={errs.currency}><Input value={f.currency} maxLength={3} onChange={(e) => setF((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Category" error={errs.category}><Select value={f.category} onChange={set('category')}><option value="">Not set</option>{SCHOLARSHIP_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
        <Field label="Status" error={errs.status}><Select value={f.status} onChange={set('status')}>{SCHOLARSHIP_STATUSES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
        <Field label="Deadline" error={errs.deadline}><Input type="date" value={f.deadline} onChange={set('deadline')} /></Field>
        <Field label="Source verified on" error={errs.source_verified_on} hint="The date you last checked the official source"><Input type="date" value={f.source_verified_on} onChange={set('source_verified_on')} /></Field>
        <Field label="Website URL" error={errs.website_url} className="sm:col-span-2"><Input type="url" placeholder="https://" value={f.website_url} onChange={set('website_url')} /></Field>
        <Field label="Eligibility (as published, in your words)" error={errs.eligibility} className="sm:col-span-2" hint="Copy it from the official source. It is shown exactly as you type it."><Textarea value={f.eligibility} onChange={set('eligibility')} /></Field>
        <Field label="Application requirements" error={errs.requirements} className="sm:col-span-2"><Textarea value={f.requirements} onChange={set('requirements')} /></Field>
        <Field label="Notes" error={errs.notes} className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        {fail && <p className="text-sm text-danger sm:col-span-2" role="alert">{fail}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save scholarship'}</Button></div>
      </form>
    </Modal>
  );
}
