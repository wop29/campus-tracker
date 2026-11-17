'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { SchoolFormSchema } from '@/lib/schools';
import { currentUserId } from '@/components/profile/data';
import type { SchoolRow } from './shared';

interface Program { id: string; name: string; duration_months: number | null; format: string | null }
const blank = { name: '', country: '', location: '', website_url: '', admissions_url: '', program: '', duration_months: '', format: '', notes: '' };

/** Add a school, or edit general info (school row plus its first program row). */
export function SchoolFormModal({ open, onClose, school, program, onSaved }: { open: boolean; onClose: () => void; school?: SchoolRow | null; program?: Program | null; onSaved: (id: string) => void }) {
  const toast = useToast(); const [v, setV] = useState(blank); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setErrors({}); setV(school ? { name: school.name, country: school.country ?? '', location: school.location ?? '', website_url: school.website_url ?? '', admissions_url: school.admissions_url ?? '', program: program?.name ?? '', duration_months: program?.duration_months?.toString() ?? '', format: program?.format ?? '', notes: school.notes ?? '' } : blank); } }, [open, school, program]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    if (saving) return;
    const r = SchoolFormSchema.safeParse(v);
    if (!r.success) { const e: Record<string, string> = {}; for (const i of r.error.issues) e[String(i.path[0])] ??= i.message; setErrors(e); toast('Fix the highlighted fields', 'err'); return; }
    setErrors({}); setSaving(true);
    try {
      const sb = supabaseBrowser(); const d = r.data; const row = { name: d.name, country: d.country || null, location: d.location || null, website_url: d.website_url || null, admissions_url: d.admissions_url || null, notes: d.notes || null };
      let id = school?.id;
      if (school) await must(sb.from('schools').update(row).eq('id', school.id).select('id'));
      else { const created = await must(sb.from('schools').insert({ ...row, in_portfolio: false }).select('id').single()); id = (created as { id: string }).id; }
      const prog = { name: d.program || 'Full-time MBA', duration_months: d.duration_months ? Number(d.duration_months) : null, format: d.format || null };
      if (program) await must(sb.from('school_programs').update(prog).eq('id', program.id).select('id'));
      else if (d.program || d.duration_months || d.format) await must(sb.from('school_programs').insert({ user_id: await currentUserId(sb), school_id: id, ...prog }).select('id'));
      toast(school ? 'School updated' : 'School added'); onSaved(id!); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={() => !saving && onClose()} title={school ? 'Edit school' : 'Add school'} wide>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label="School name *" error={errors.name} className="sm:col-span-2"><Input value={v.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Country" error={errors.country}><Input value={v.country} onChange={set('country')} /></Field>
        <Field label="City / location" error={errors.location}><Input value={v.location} onChange={set('location')} /></Field>
        <Field label="Program" error={errors.program} hint="For example Full-time MBA"><Input value={v.program} onChange={set('program')} /></Field>
        <Field label="Duration (months)" error={errors.duration_months} hint="Entered by you. Add a sourced data point on the school page for verified figures."><Input type="number" min={1} max={120} value={v.duration_months} onChange={set('duration_months')} /></Field>
        <Field label="Format" error={errors.format} hint="Full-time, part-time, one-year..."><Input value={v.format} onChange={set('format')} /></Field>
        <span />
        <Field label="Website URL" error={errors.website_url}><Input type="url" placeholder="https://" value={v.website_url} onChange={set('website_url')} /></Field>
        <Field label="Admissions URL" error={errors.admissions_url}><Input type="url" placeholder="https://" value={v.admissions_url} onChange={set('admissions_url')} /></Field>
        <Field label="Notes" className="sm:col-span-2" error={errors.notes}><Textarea value={v.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}
