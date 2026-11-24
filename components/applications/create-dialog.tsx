'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { CURRENCIES, ApplicationSchema, NewApplicationSchema, TIMEZONES, wallToIso, zodFieldErrors, type Application, type FieldErrors, type School } from '@/lib/applications';
import { useAction } from './data';
import { applyProgramChecklist, intakeFor } from './program-start';
import { PROGRAM_COLS, parseFee, parsePrograms, type Program } from '@/lib/programs';

type Form = { school_id: string; program: string; intake: string; round: string; priority: string; application_fee: string; fee_currency: string; stage: string; notes: string; deadline_date: string; deadline_time: string; deadline_tz: string };
const blank = (school = ''): Form => ({ school_id: school, program: 'Full-time MBA', intake: 'Fall 2027', round: '', priority: '3', application_fee: '', fee_currency: 'USD', stage: 'researching', notes: '', deadline_date: '', deadline_time: '23:59', deadline_tz: 'America/New_York' });

export function ApplicationDialog({ open, onClose, schools, presetSchoolId, editing, onSaved }: {
  open: boolean; onClose: () => void; schools: School[]; presetSchoolId?: string | null; editing?: Application | null; onSaved: (id: string) => void;
}) {
  const [f, setF] = useState<Form>(blank());
  const [errs, setErrs] = useState<FieldErrors>({});
  const [programs, setPrograms] = useState<string[]>([]);
  const [researched, setResearched] = useState<Program[]>([]);
  const [programId, setProgramId] = useState('');
  const { busy, run } = useAction();
  const set = (k: keyof Form, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setErrs({}); setProgramId('');
    if (editing) setF({ ...blank(editing.school_id), program: editing.program, intake: editing.intake, round: editing.round ?? '', priority: String(editing.priority), application_fee: editing.application_fee == null ? '' : String(editing.application_fee), fee_currency: editing.fee_currency, notes: editing.notes ?? '' });
    else setF(blank(presetSchoolId && schools.some((s) => s.id === presetSchoolId) ? presetSchoolId : ''));
  }, [open, editing, presetSchoolId, schools]);

  useEffect(() => {
    if (!open || !f.school_id) { setPrograms([]); return; }
    let live = true;
    void supabaseBrowser().from('school_programs').select('name').eq('school_id', f.school_id).then(({ data }) => { if (live) setPrograms(((data ?? []) as { name: string }[]).map((p) => p.name)); });
    return () => { live = false; };
  }, [open, f.school_id]);

  // Researched programs for the chosen school (matched by school name), offered as an optional checklist source.
  useEffect(() => {
    setProgramId('');
    const school = schools.find((s) => s.id === f.school_id);
    if (!open || editing || !school) { setResearched([]); return; }
    let live = true;
    void supabaseBrowser().from('program_requirements').select(PROGRAM_COLS).in('school_name', [school.name, school.short_name].filter((n): n is string => !!n)).order('program_name')
      .then(({ data }) => { if (live) setResearched(parsePrograms(data)); });
    return () => { live = false; };
  }, [open, editing, f.school_id, schools]);

  function pickProgram(id: string) {
    setProgramId(id);
    const p = researched.find((x) => x.id === id);
    if (!p) return;
    const fee = parseFee(p.application_fee?.value, CURRENCIES);
    setF((s) => ({ ...s, program: p.program_name.slice(0, 120), intake: intakeFor(p, s.intake), ...(fee ? { application_fee: String(fee.amount), fee_currency: fee.currency } : {}) }));
  }

  async function save() {
    const sb = supabaseBrowser();
    if (editing) {
      const p = ApplicationSchema.safeParse(f);
      if (!p.success) { setErrs(zodFieldErrors(p.error)); return; }
      setErrs({});
      const ok = await run(async () => { await must(sb.from('applications').update(p.data).eq('id', editing.id)); }, 'Application updated');
      if (ok) { onSaved(editing.id); onClose(); }
      return;
    }
    const p = NewApplicationSchema.safeParse(f);
    if (!p.success) { setErrs(zodFieldErrors(p.error)); return; }
    setErrs({});
    let newId = '';
    const ok = await run(async () => {
      const { stage, deadline_date, deadline_time, deadline_tz, ...app } = p.data;
      const program = researched.find((x) => x.id === programId) ?? null;
      const created = await must(sb.from('applications').insert({ ...app, stage, ...(program ? { program_requirement_id: program.id } : {}) }).select('id').single()) as { id: string };
      newId = created.id;
      let essayIds: string[] = [];
      if (program) {
        try { essayIds = await applyProgramChecklist(sb, created.id, app.school_id, program); }
        catch (e) {
          await sb.from('applications').delete().eq('id', created.id);
          newId = '';
          throw new Error(`The program checklist could not be set up, so the application was not created. ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (deadline_date) {
        const { error } = await sb.from('deadlines').insert({ application_id: created.id, name: 'Submission deadline', kind: 'submission', is_primary: true, timezone: deadline_tz, due_at: wallToIso(deadline_date, deadline_time ?? '23:59', deadline_tz ?? 'America/New_York') });
        if (error) {
          // keep the pair consistent: remove the application (and any program essays) we just created
          if (essayIds.length) await sb.from('essays').delete().in('id', essayIds);
          await sb.from('applications').delete().eq('id', created.id);
          newId = '';
          throw new Error(`The deadline could not be saved, so the application was not created. ${error.message}`);
        }
      }
    }, 'Application created');
    if (ok && newId) { onSaved(newId); onClose(); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit application' : 'Add an application'} wide>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label="School" error={errs.school_id} className="sm:col-span-2">
          <Select value={f.school_id} onChange={(e) => set('school_id', e.target.value)} disabled={!!editing} aria-label="School">
            <option value="">Choose a school</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}{s.country ? ` (${s.country})` : ''}</option>)}
          </Select>
        </Field>
        {!editing && researched.length > 0 && (
          <Field label="Program checklist (optional)" hint="Pick a researched program to get its own checklist and essay prompts instead of the general one." className="sm:col-span-2">
            <Select value={programId} onChange={(e) => pickProgram(e.target.value)} aria-label="Program checklist">
              <option value="">General checklist</option>
              {researched.map((p) => <option key={p.id} value={p.id}>{p.program_name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Program" error={errs.program}><Input list="app-programs" value={f.program} onChange={(e) => set('program', e.target.value)} /><datalist id="app-programs">{programs.map((p) => <option key={p} value={p} />)}</datalist></Field>
        <Field label="Intake" error={errs.intake}><Input value={f.intake} onChange={(e) => set('intake', e.target.value)} /></Field>
        <Field label="Round" error={errs.round} hint="For example Round 1. Leave blank if the school has a single deadline."><Input value={f.round} onChange={(e) => set('round', e.target.value)} /></Field>
        <Field label="Priority (1 = highest)" error={errs.priority}><Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Field label="Application fee" error={errs.application_fee}><Input inputMode="decimal" value={f.application_fee} onChange={(e) => set('application_fee', e.target.value)} placeholder="Leave blank if unknown" /></Field>
        <Field label="Fee currency"><Select value={f.fee_currency} onChange={(e) => set('fee_currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        {!editing && (
          <>
            <Field label="Submission deadline date" error={errs.deadline_date} hint="Optional. Creates the primary deadline."><Input type="date" value={f.deadline_date} onChange={(e) => set('deadline_date', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Time" error={errs.deadline_time}><Input type="time" value={f.deadline_time} onChange={(e) => set('deadline_time', e.target.value)} /></Field>
              <Field label="Timezone" error={errs.deadline_tz}><Select value={f.deadline_tz} onChange={(e) => set('deadline_tz', e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
            </div>
          </>
        )}
        <Field label="Notes" error={errs.notes} className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Create application'}</Button>
        </div>
      </form>
    </Modal>
  );
}
