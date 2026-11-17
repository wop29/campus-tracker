'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@/components/ui';
import { CURRENCIES, PortalUrlSchema, TIMEZONES, wallToIso, type FieldErrors } from '@/lib/applications';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/utils';
import { changeStage, patchDecision, syncDeadline, useAction, type TabProps } from './data';

export function PostSubmissionTab({ b, reload, goTab }: TabProps & { goTab: (t: string) => void }) {
  const { app, decision } = b;
  const [portal, setPortal] = useState(app.portal_url ?? '');
  const [extra, setExtra] = useState(app.additional_requirements ?? '');
  const [errs, setErrs] = useState<FieldErrors>({});
  const [iv, setIv] = useState({ date: '', time: '10:00', tz: 'America/New_York', interviewer: '', format: '' });
  const [sch, setSch] = useState({ decision: decision?.scholarship_decision ?? '', amount: decision?.scholarship_amount == null ? '' : String(decision.scholarship_amount), currency: decision?.scholarship_currency ?? 'USD' });
  const [deposit, setDeposit] = useState(decision?.deposit_deadline ?? '');
  const [depTz, setDepTz] = useState('America/New_York');
  const { busy, run } = useAction();
  const sb = supabaseBrowser();

  if (!app.submission_confirmed_at) return <EmptyState title="Available after submission" hint="Record the submission first. Then you can track the portal, interviews, scholarship and deposit here." action={<Button onClick={() => goTab('submission')}>Open Final review</Button>} />;

  async function savePortal() {
    const p = PortalUrlSchema.safeParse(portal);
    if (!p.success) { setErrs({ portal: p.error.issues[0].message }); return; }
    setErrs({});
    if (await run(async () => { await must(sb.from('applications').update({ portal_url: p.data || null, additional_requirements: extra.trim() || null }).eq('id', app.id)); }, 'Saved')) reload();
  }
  async function addInterview() {
    if (iv.date && !iv.time) { setErrs({ iv: 'Enter a time' }); return; }
    setErrs({});
    const ok = await run(async () => {
      const dated = !!iv.date;
      await must(sb.from('interview_sessions').insert({ application_id: app.id, school_id: app.school_id, kind: 'real', scheduled_at: dated ? wallToIso(iv.date, iv.time, iv.tz) : null, interviewer: iv.interviewer.trim() || null, format: iv.format.trim() || null, status: 'scheduled' }));
      if (app.stage === 'submitted' || app.stage === 'interview_invited') await changeStage(app.id, dated ? 'interview_scheduled' : 'interview_invited');
      else await patchDecision(app.id, { decision: 'interview_invited' });
    }, iv.date ? 'Interview recorded and stage updated' : 'Interview invitation recorded');
    if (ok) { setIv({ ...iv, date: '', interviewer: '', format: '' }); reload(); }
  }
  async function completeInterview(id: string) {
    if (await run(async () => {
      await must(sb.from('interview_sessions').update({ status: 'completed' }).eq('id', id));
      if (app.stage === 'interview_scheduled' || app.stage === 'interview_invited') await changeStage(app.id, 'interview_completed');
    }, 'Interview marked completed')) reload();
  }
  async function saveScholarship() {
    const amount = sch.amount.trim() === '' ? null : Number(sch.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) { setErrs({ amount: 'Enter an amount of 0 or more' }); return; }
    setErrs({});
    if (await run(() => patchDecision(app.id, { scholarship_decision: sch.decision || null, scholarship_amount: amount, scholarship_currency: sch.currency }), 'Scholarship decision saved')) reload();
  }
  async function saveDeposit() {
    if (await run(async () => { await patchDecision(app.id, { deposit_deadline: deposit || null }); await syncDeadline(app.id, 'deposit', 'Enrollment deposit', deposit, '23:59', depTz); }, deposit ? 'Deposit deadline saved' : 'Deposit deadline cleared')) reload();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Portal and additional requirements</h2>
        <Field label="Applicant portal link" error={errs.portal}><Input value={portal} onChange={(e) => setPortal(e.target.value)} placeholder="https://" /></Field>
        {app.portal_url && <a className="text-xs text-accent underline" href={app.portal_url} target="_blank" rel="noreferrer">Open portal</a>}
        <Field label="Additional requirements requested by the school"><Textarea value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        <Button onClick={() => void savePortal()} disabled={busy}>Save</Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Interview</h2>
        {b.interviews.length > 0 && <ul className="space-y-1 text-sm">{b.interviews.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg px-2 py-1.5"><span>{i.scheduled_at ? fmtDateTime(i.scheduled_at) : 'Invited, date not set'}{i.interviewer ? ` · ${i.interviewer}` : ''}{i.format ? ` · ${i.format}` : ''} <Badge tone={i.status === 'completed' ? 'success' : 'accent'}>{titleCase(i.status)}</Badge></span>
            {i.status === 'scheduled' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void completeInterview(i.id)}>Mark completed</Button>}</li>))}</ul>}
        <p className="text-xs text-secondary">Record an invitation. With a date it becomes a scheduled interview; without one it is recorded as invited. The session also appears in Interview Preparation.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" error={errs.iv}><Input type="date" value={iv.date} onChange={(e) => setIv({ ...iv, date: e.target.value })} /></Field>
          <Field label="Time"><Input type="time" value={iv.time} onChange={(e) => setIv({ ...iv, time: e.target.value })} /></Field>
          <Field label="Timezone" className="col-span-2"><Select value={iv.tz} onChange={(e) => setIv({ ...iv, tz: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Interviewer"><Input value={iv.interviewer} onChange={(e) => setIv({ ...iv, interviewer: e.target.value })} /></Field>
          <Field label="Format"><Input value={iv.format} onChange={(e) => setIv({ ...iv, format: e.target.value })} placeholder="Video, in person" /></Field>
        </div>
        <Button onClick={() => void addInterview()} disabled={busy}>Record interview invitation</Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Scholarship decision</h2>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Decision"><Select value={sch.decision} onChange={(e) => setSch({ ...sch, decision: e.target.value as typeof sch.decision })}><option value="">Not recorded</option><option value="pending">Pending</option><option value="awarded">Awarded</option><option value="none">None offered</option></Select></Field>
          <Field label="Amount" error={errs.amount}><Input inputMode="decimal" value={sch.amount} onChange={(e) => setSch({ ...sch, amount: e.target.value })} /></Field>
          <Field label="Currency"><Select value={sch.currency} onChange={(e) => setSch({ ...sch, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <Button onClick={() => void saveScholarship()} disabled={busy}>Save scholarship decision</Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Enrollment deposit deadline</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" hint="Clear the date to remove the deadline."><Input type="date" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
          <Field label="Timezone (due 23:59)"><Select value={depTz} onChange={(e) => setDepTz(e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        </div>
        {decision?.deposit_deadline && <p className="text-xs text-secondary">Saved: {fmtDate(decision.deposit_deadline)}. It is also listed in Deadlines as a deposit deadline.</p>}
        <Button onClick={() => void saveDeposit()} disabled={busy}>Save deposit deadline</Button>
      </Card>
    </div>
  );
}
