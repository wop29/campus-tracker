'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { CURRENCIES, FIELD_BY_KEY, FIELD_CATALOGUE, GROUP_LABEL, GROUP_ORDER, validateDataPoint, type DataPointInput, type DataRow } from '@/lib/schools';
import { currentUserId } from '@/components/profile/data';

const today = () => new Date().toISOString().slice(0, 10);
const blank = (field: string): DataPointInput => ({ field, value: '', currency: 'USD', source_name: '', source_url: '', date_accessed: today(), publication_year: '', verification_status: 'unverified' });

/** Guided form for one researched data point. Refuses to save without a source name and a valid URL. */
export function DataPointModal({ open, onClose, schoolId, field, existing, onSaved }: { open: boolean; onClose: () => void; schoolId: string; field: string; existing?: DataRow | null; onSaved: () => void }) {
  const toast = useToast(); const [v, setV] = useState<DataPointInput>(blank(field)); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return; setErrors({});
    setV(existing ? { field: existing.field, value: existing.value_num != null ? String(existing.value_num) : existing.value_text ?? '', currency: existing.currency ?? 'USD', source_name: existing.source_name, source_url: existing.source_url, date_accessed: existing.date_accessed, publication_year: existing.publication_year?.toString() ?? '', verification_status: existing.verification_status } : blank(field));
  }, [open, existing, field]);
  const def = FIELD_BY_KEY[v.field]; const set = (k: keyof DataPointInput) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    if (saving) return;
    const r = validateDataPoint(v); if (!r.ok) { setErrors(r.errors); toast('Fix the highlighted fields. Data needs a source to be saved.', 'err'); return; }
    setErrors({}); setSaving(true);
    try {
      const sb = supabaseBrowser();
      await must(sb.from('school_admissions_data').upsert({ user_id: await currentUserId(sb), school_id: schoolId, ...r.row }, { onConflict: 'school_id,field' }).select('id'));
      toast('Data point saved'); onSaved(); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={() => !saving && onClose()} title={existing ? `Edit ${def?.label ?? 'data point'}` : 'Add researched data point'} wide>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label="Field *" error={errors.field} className="sm:col-span-2">
          <Select value={v.field} onChange={set('field')} disabled={!!existing}>
            <option value="">Select a field...</option>
            {GROUP_ORDER.map((g) => <optgroup key={g} label={GROUP_LABEL[g]}>{FIELD_CATALOGUE.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>)}
          </Select>
        </Field>
        {def && <p className="text-xs text-secondary sm:col-span-2">{def.hint}{existing ? '' : ' Saving a field that already has a value replaces it.'}</p>}
        <Field label={`Value *${def?.unit ? ` (${def.unit})` : ''}`} error={errors.value} className={def?.kind === 'text' ? 'sm:col-span-2' : ''}>
          {def?.kind === 'text' ? <Textarea value={v.value} onChange={set('value')} /> : <Input inputMode="decimal" value={v.value} onChange={set('value')} placeholder={def?.min != null && def?.max != null ? `${def.min} to ${def.max}` : undefined} />}
        </Field>
        {def?.money && <Field label="Currency *" error={errors.currency}><Select value={v.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>}
        <fieldset className="grid gap-3 rounded-md border p-3 sm:col-span-2 sm:grid-cols-2"><legend className="px-1 text-xs font-medium text-secondary">Source (required)</legend>
          <Field label="Source name *" error={errors.source_name} hint="For example Class of 2027 profile, Employment report 2025"><Input value={v.source_name} onChange={set('source_name')} /></Field>
          <Field label="Source URL *" error={errors.source_url}><Input type="url" placeholder="https://" value={v.source_url} onChange={set('source_url')} /></Field>
          <Field label="Date accessed *" error={errors.date_accessed}><Input type="date" max={today()} value={v.date_accessed} onChange={set('date_accessed')} /></Field>
          <Field label="Publication year" error={errors.publication_year} hint="Data older than 2 years is flagged as possibly outdated"><Input inputMode="numeric" maxLength={4} value={v.publication_year} onChange={set('publication_year')} /></Field>
        </fieldset>
        <Field label="Verification status" error={errors.verification_status} hint="Mark verified only after you have checked the source yourself">
          <Select value={v.verification_status} onChange={set('verification_status')}><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="outdated">Outdated</option></Select>
        </Field>
        <div className="flex items-end justify-end gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save data point'}</Button></div>
      </form>
    </Modal>
  );
}
