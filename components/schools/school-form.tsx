'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { SchoolFormSchema } from '@/lib/schools';
import { currentUserId } from '@/components/profile/data';
import { loadOnboarding } from '@/components/onboarding/data';
import { OTHER_COUNTRY, SCHOOL_COUNTRIES, countryChoice, countryValue, defaultCountryFor } from '@/lib/school-form';
import type { Track } from '@/lib/onboarding';
import type { SchoolRow } from './shared';

interface Program { id: string; name: string; duration_months: number | null; format: string | null }
const blank = { name: '', country: '', country_other: '', location: '', website_url: '', admissions_url: '', program: '', duration_months: '', format: '', notes: '' };

/**
 * After a new school is saved, the list reloads; this waits for the school's row to appear, scrolls to it and
 * highlights it for a few seconds. Gives up quietly if the row never shows (for example when a filter hides it).
 */
function highlightNewSchool(id: string) {
  if (typeof window === 'undefined') return;
  const started = Date.now();
  const timer = window.setInterval(() => {
    const link = document.querySelector<HTMLAnchorElement>(`a[href="/schools/${CSS.escape(id)}"]`);
    if (!link && Date.now() - started < 5000) return;
    window.clearInterval(timer);
    if (!link) return;
    const row = (link.closest('tr') ?? link) as HTMLElement;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    const prev = { bg: row.style.backgroundColor, shadow: row.style.boxShadow, tr: row.style.transition };
    row.style.transition = 'background-color 600ms ease, box-shadow 600ms ease';
    row.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 14%, transparent)';
    row.style.boxShadow = 'inset 4px 0 0 var(--color-accent)';
    link.focus({ preventScroll: true });
    window.setTimeout(() => { row.style.backgroundColor = prev.bg; row.style.boxShadow = prev.shadow; window.setTimeout(() => { row.style.transition = prev.tr; }, 700); }, 4000);
  }, 100);
}

/** Add a school, or edit general info (school row plus its first program row). */
export function SchoolFormModal({ open, onClose, school, program, onSaved }: { open: boolean; onClose: () => void; school?: SchoolRow | null; program?: Program | null; onSaved: (id: string) => void }) {
  const toast = useToast(); const [v, setV] = useState(blank); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const [ob, setOb] = useState<{ track: Track; country: string } | null>(null);
  // Wording and the starting country follow onboarding; if it cannot load, the form still works with general wording.
  useEffect(() => { if (!open || ob) return; let live = true; loadOnboarding(supabaseBrowser()).then((o) => { if (live) setOb({ track: o.track, country: defaultCountryFor(o.destinations) }); }).catch(() => {}); return () => { live = false; }; }, [open, ob]);
  useEffect(() => { if (open && !school && ob?.country) setV((cur) => (cur.country ? cur : { ...cur, country: ob.country })); }, [open, school, ob]);
  useEffect(() => { if (open) { setErrors({}); setV(school ? { name: school.name, country: countryChoice(school.country).choice, country_other: countryChoice(school.country).other, location: school.location ?? '', website_url: school.website_url ?? '', admissions_url: school.admissions_url ?? '', program: program?.name ?? '', duration_months: program?.duration_months?.toString() ?? '', format: program?.format ?? '', notes: school.notes ?? '' } : { ...blank, country: ob?.country ?? '' }); } }, [open, school, program]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    if (saving) return;
    if (v.country === OTHER_COUNTRY && !v.country_other.trim()) { setErrors({ country_other: 'Type the country name' }); toast('Fix the highlighted fields', 'err'); return; }
    const r = SchoolFormSchema.safeParse({ ...v, country: countryValue(v.country, v.country_other) });
    if (!r.success) { const e: Record<string, string> = {}; for (const i of r.error.issues) e[String(i.path[0]) === 'country' && v.country === OTHER_COUNTRY ? 'country_other' : String(i.path[0])] ??= i.message; setErrors(e); toast('Fix the highlighted fields', 'err'); return; }
    setErrors({}); setSaving(true);
    try {
      const sb = supabaseBrowser(); const d = r.data; const row = { name: d.name, country: d.country || null, location: d.location || null, website_url: d.website_url || null, admissions_url: d.admissions_url || null, notes: d.notes || null };
      let id = school?.id;
      if (school) await must(sb.from('schools').update(row).eq('id', school.id).select('id'));
      else { const created = await must(sb.from('schools').insert({ ...row, in_portfolio: true }).select('id').single()); id = (created as { id: string }).id; }
      const prog = { name: d.program || (ob?.track === 'undergrad' ? 'Undergraduate program' : 'Full-time MBA'), duration_months: d.duration_months ? Number(d.duration_months) : null, format: d.format || null };
      if (program) await must(sb.from('school_programs').update(prog).eq('id', program.id).select('id'));
      else if (d.program || d.duration_months || d.format) await must(sb.from('school_programs').insert({ user_id: await currentUserId(sb), school_id: id, ...prog }).select('id'));
      toast(school ? 'School updated' : `${d.name} is on your list now`); onSaved(id!); onClose();
      if (!school) highlightNewSchool(id!);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={() => !saving && onClose()} title={school ? 'Edit school' : 'Add school'} wide>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label="School name *" error={errors.name} className="sm:col-span-2"><Input value={v.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Country" error={errors.country}><Select value={v.country} onChange={set('country')}><option value="">Choose a country</option>{SCHOOL_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}<option value={OTHER_COUNTRY}>Other</option></Select></Field>
        {v.country === OTHER_COUNTRY && <Field label="Country name" error={errors.country_other}><Input value={v.country_other} onChange={set('country_other')} maxLength={100} autoFocus /></Field>}
        <Field label="City / location" error={errors.location}><Input value={v.location} onChange={set('location')} /></Field>
        <Field label="Program" error={errors.program} hint={ob?.track === 'undergrad' ? 'For example Bachelor of Computer Science' : 'For example Full-time MBA'}><Input value={v.program} onChange={set('program')} /></Field>
        <Field label="Duration (months)" error={errors.duration_months} hint="Entered by you. Add a sourced data point on the school page for verified figures."><Input type="number" min={1} max={120} value={v.duration_months} onChange={set('duration_months')} /></Field>
        <Field label="Format" error={errors.format} hint="Full-time, part-time, one-year..."><Input value={v.format} onChange={set('format')} /></Field>
        {v.country !== OTHER_COUNTRY && <span />}
        <Field label="Website URL" error={errors.website_url}><Input type="url" placeholder="https://" value={v.website_url} onChange={set('website_url')} /></Field>
        <Field label="Admissions URL" error={errors.admissions_url}><Input type="url" placeholder="https://" value={v.admissions_url} onChange={set('admissions_url')} /></Field>
        <Field label="Notes" className="sm:col-span-2" error={errors.notes}><Textarea value={v.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}
