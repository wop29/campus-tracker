'use client';
import { useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleHelp } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { IN_PROGRESS } from '@/lib/constants';
import { SubmissionSchema, buildChecklist, checklistComplete, essayWordStates, todayStr, zodFieldErrors, type FieldErrors } from '@/lib/applications';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/utils';
import { useAction, type TabProps } from './data';

export function SubmissionTab({ b, reload }: TabProps) {
  const { app } = b;
  const submitted = !!app.submission_confirmed_at;
  const [f, setF] = useState({
    submitted_at: app.submitted_at ?? todayStr(), confirmation_number: app.confirmation_number ?? '', confirmation_document_id: app.confirmation_document_id ?? '',
    final_resume_version_id: app.final_resume_version_id ?? '', application_fee: app.application_fee == null ? '' : String(app.application_fee), submission_notes: app.submission_notes ?? '',
  });
  const [errs, setErrs] = useState<FieldErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const { busy, run } = useAction();
  const sb = supabaseBrowser();

  const items = useMemo(() => buildChecklist({ confirmations: app.submission_checklist, essays: b.essays, requirements: b.reqs, hasTestScores: b.hasTestScores, recommendations: b.recs, feePaidExpense: b.feePaid }), [app.submission_checklist, b]);
  const complete = checklistComplete(items);
  const essays = essayWordStates(b.essays);
  const canSubmit = !submitted && IN_PROGRESS.includes(app.stage);

  async function toggle(id: string, v: boolean) {
    if (await run(async () => { await must(sb.from('applications').update({ submission_checklist: { ...(app.submission_checklist ?? {}), [id]: v } }).eq('id', app.id)); })) reload();
  }
  function validate() {
    const p = SubmissionSchema.safeParse(f);
    if (!p.success) { setErrs(zodFieldErrors(p.error)); return null; }
    setErrs({}); return p.data;
  }
  const essaySnapshot = () => Object.fromEntries(b.essays.filter((e) => e.latest_version != null).map((e) => [e.id, e.latest_version as number]));

  async function confirmSubmit() {
    const v = validate(); if (!v) { setConfirmOpen(false); return; }
    const ok = await run(async () => {
      await must(sb.from('applications').update({
        submission_confirmed_at: new Date().toISOString(), submitted_at: v.submitted_at, confirmation_number: v.confirmation_number, confirmation_document_id: v.confirmation_document_id,
        final_resume_version_id: v.final_resume_version_id, application_fee: v.application_fee, submission_notes: v.submission_notes, final_essay_versions: essaySnapshot(), stage: 'submitted',
      }).eq('id', app.id));
      await must(sb.from('application_requirements').update({ status: 'complete' }).eq('application_id', app.id).eq('name', 'Submission confirmation'));
      await must(sb.from('admissions_decisions').upsert({ application_id: app.id, decision: 'awaiting' }, { onConflict: 'application_id', ignoreDuplicates: true }));
    }, 'Application marked as submitted');
    setConfirmOpen(false); setAgree(false);
    if (ok) reload();
  }
  async function saveDetails() {
    const v = validate(); if (!v) return;
    if (await run(async () => {
      await must(sb.from('applications').update({ submitted_at: v.submitted_at, confirmation_number: v.confirmation_number, confirmation_document_id: v.confirmation_document_id, final_resume_version_id: v.final_resume_version_id, application_fee: v.application_fee, submission_notes: v.submission_notes }).eq('id', app.id));
    }, 'Submission details saved')) reload();
  }

  const icon = (s: string, ok: boolean) => ok ? <CheckCircle2 size={16} className="text-success" /> : s === 'fail' ? <CircleAlert size={16} className="text-danger" /> : <CircleHelp size={16} className="text-warning" />;
  const resumeOptions = b.docVersions.map((v) => ({ id: v.id, label: `${b.docs.find((d) => d.id === v.document_id)?.name ?? 'Resume'} v${v.version_number} (${v.file_name})` }));

  return (
    <div className="space-y-4">
      {submitted && <Card className="border-success/40 bg-success/5 text-sm">Submitted on {fmtDate(app.submitted_at)}; confirmed in this app at {fmtDateTime(app.submission_confirmed_at)}. You can still correct the details below.</Card>}
      <Card>
        <h2 className="mb-1 text-sm font-semibold">Final checklist</h2>
        <p className="mb-3 text-xs text-secondary">Each item is checked against your data. If something lives outside this app, confirm it yourself. Over-limit essays cannot be confirmed away.</p>
        <ul className="divide-y">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-start gap-3 py-2.5">
              <span className="mt-0.5">{icon(it.auto, it.satisfied)}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{it.label}</p><p className="text-xs text-secondary">{it.detail}</p></div>
              <Badge tone={it.auto === 'pass' ? 'success' : it.auto === 'fail' ? 'danger' : 'neutral'}>{it.auto === 'pass' ? 'Data check passed' : it.auto === 'fail' ? 'Data check failed' : 'Cannot be checked'}</Badge>
              {it.auto !== 'pass' && (
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={it.manual} disabled={busy || !it.canOverride || submitted} onChange={(e) => void toggle(it.id, e.target.checked)} /> I confirm this is complete</label>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Final essay versions</h2>
        {!essays.length ? <p className="text-sm text-secondary">No essays are linked to this application. Link essays from the Essays module.</p> : (
          <ul className="text-sm">{b.essays.map((e) => { const w = essays.find((x) => x.id === e.id)!; const snap = app.final_essay_versions?.[e.id]; return (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5 last:border-0"><span>{e.title}</span>
              <span className="text-xs text-secondary">{w.words}{e.word_limit ? `/${e.word_limit}` : ''} words · current version {e.latest_version ?? 'none'}{submitted && snap != null ? ` · submitted version ${snap}` : ''}{w.over && <Badge tone="danger" className="ml-2">Over limit</Badge>}</span></li>); })}</ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-semibold">Submission details</h2>
        <form className="grid gap-3 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); if (submitted) void saveDetails(); else if (validate()) setConfirmOpen(true); }}>
          <Field label="Submission date" error={errs.submitted_at}><Input type="date" value={f.submitted_at} onChange={(e) => setF({ ...f, submitted_at: e.target.value })} /></Field>
          <Field label="Confirmation number" error={errs.confirmation_number}><Input value={f.confirmation_number} onChange={(e) => setF({ ...f, confirmation_number: e.target.value })} /></Field>
          <Field label="Confirmation document" hint="Upload it in Essays & Documents first, then pick it here."><Select value={f.confirmation_document_id} onChange={(e) => setF({ ...f, confirmation_document_id: e.target.value })}><option value="">None</option>{b.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Final resume version" hint={resumeOptions.length ? undefined : 'No resume document versions found.'}><Select value={f.final_resume_version_id} onChange={(e) => setF({ ...f, final_resume_version_id: e.target.value })}><option value="">Not recorded</option>{resumeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label={`Application fee (${app.fee_currency})`} error={errs.application_fee}><Input inputMode="decimal" value={f.application_fee} onChange={(e) => setF({ ...f, application_fee: e.target.value })} /></Field>
          <Field label="Notes" error={errs.submission_notes} className="sm:col-span-2"><Textarea value={f.submission_notes} onChange={(e) => setF({ ...f, submission_notes: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            {submitted ? <Button type="submit" disabled={busy}>Save details</Button> : <Button type="submit" disabled={busy || !complete || !canSubmit}>Mark as submitted</Button>}
            {!submitted && !complete && <span className="text-xs text-secondary">Complete every checklist item first.</span>}
            {!submitted && complete && !canSubmit && <span className="text-xs text-secondary">This application is already closed.</span>}
          </div>
        </form>
      </Card>
      <Modal open={confirmOpen} onClose={() => { setConfirmOpen(false); setAgree(false); }} title="Confirm submission">
        <div className="space-y-3 text-sm">
          <p>You are about to record <b>{app.school?.name}</b> ({app.program}, {app.intake}{app.round ? `, ${app.round}` : ''}) as submitted. This moves the stage to Submitted.</p>
          <dl className="rounded-md bg-bg p-3 text-xs"><div>Date: {fmtDate(f.submitted_at)}</div><div>Confirmation number: {f.confirmation_number}</div><div>Fee: {f.application_fee ? fmtMoney(Number(f.application_fee), app.fee_currency) : 'not recorded'}</div></dl>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have submitted this application on the school&apos;s own portal and the details above are correct.</label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setConfirmOpen(false); setAgree(false); }}>Cancel</Button><Button disabled={!agree || busy} onClick={() => void confirmSubmit()}>{busy ? 'Saving...' : 'Confirm submission'}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
