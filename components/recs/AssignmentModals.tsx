'use client';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fieldErrors } from '@/lib/essays';
import { REC_STATUSES, REC_STATUS_LABEL, assignmentSchema, type RecStatus, type RecommendationRow, type RecommenderRow } from '@/lib/recommendations';
import { appLabel, errMsg, type AppLite } from '@/components/essays/data';
import { changeRecStatus, linkRequirement } from './actions';

const endOfDay = (d: string) => new Date(`${d}T23:59:00`).toISOString();

export function AssignModal({ recommenders, apps, recs, onClose, onDone }: { recommenders: RecommenderRow[]; apps: AppLite[]; recs: RecommendationRow[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ recommender_id: '', application_id: '', deadline: '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = assignmentSchema.safeParse(v); if (!p.success) { setErrors(fieldErrors(p.error)); return; }
    if (recs.some((r) => r.recommender_id === p.data.recommender_id && r.application_id === p.data.application_id)) { setErrors({ application_id: 'This recommender is already assigned to that application' }); return; }
    setErrors({}); setBusy(true);
    try {
      const sb = supabaseBrowser();
      const row = await must(sb.from('recommendations').insert({ recommender_id: p.data.recommender_id, application_id: p.data.application_id, deadline: p.data.deadline ? endOfDay(p.data.deadline) : null }).select('*').single()) as RecommendationRow;
      await linkRequirement(sb, row, [...recs, row]).catch(() => {});
      toast('Recommender assigned'); onDone();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Assign recommender to an application">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-xs text-secondary">Each school is tracked separately. A recommendation submitted for one school is never assumed for another.</p>
        <Field label="Recommender" error={errors.recommender_id}><Select value={v.recommender_id} onChange={(e) => setV({ ...v, recommender_id: e.target.value })}><option value="">Choose...</option>{recommenders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        <Field label="Application" error={errors.application_id}><Select value={v.application_id} onChange={(e) => setV({ ...v, application_id: e.target.value })}><option value="">Choose...</option>{apps.map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}</Select></Field>
        <Field label="Recommendation deadline" error={errors.deadline} hint="From the school's recommender instructions"><Input type="date" value={v.deadline} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Assign'}</Button></div>
      </form>
    </Modal>
  );
}

export function EditAssignmentModal({ rec, recs, onClose, onDone }: { rec: RecommendationRow; recs: RecommendationRow[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ status: rec.status as RecStatus, deadline: rec.deadline?.slice(0, 10) ?? '', last_contact_at: rec.last_contact_at ?? '', notes: rec.notes ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const date = /^\d{4}-\d{2}-\d{2}$/; const er: Record<string, string> = {};
    if (v.deadline && !date.test(v.deadline)) er.deadline = 'Use a valid date';
    if (v.last_contact_at && !date.test(v.last_contact_at)) er.last_contact_at = 'Use a valid date';
    if (v.notes.length > 5000) er.notes = 'Notes are too long';
    if (Object.keys(er).length) { setErrors(er); return; }
    setErrors({}); setBusy(true);
    try {
      const sb = supabaseBrowser();
      await must(sb.from('recommendations').update({ deadline: v.deadline ? endOfDay(v.deadline) : null, last_contact_at: v.last_contact_at || null, notes: v.notes.trim() || null }).eq('id', rec.id));
      const warn = await changeRecStatus(sb, rec, recs, v.status);
      toast(warn ?? 'Saved', warn ? 'err' : 'ok'); onDone();
    } catch (err) { toast(errMsg(err), 'err'); onDone(); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Edit recommendation tracking">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as RecStatus })}>{REC_STATUSES.map((s) => <option key={s} value={s}>{REC_STATUS_LABEL[s]}</option>)}</Select></Field>
        {v.status === 'submitted' && rec.status !== 'submitted' && <p className="rounded bg-bg p-2 text-xs text-secondary">Marking this submitted also marks the matching checklist item complete for this application only.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deadline" error={errors.deadline}><Input type="date" value={v.deadline} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></Field>
          <Field label="Last contact" error={errors.last_contact_at}><Input type="date" value={v.last_contact_at} onChange={(e) => setV({ ...v, last_contact_at: e.target.value })} /></Field>
        </div>
        <Field label="Notes" error={errors.notes}><Textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}
