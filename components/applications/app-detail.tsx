'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, ConfirmButton, Field, Input, Modal, Select } from '@/components/ui';
import { Confetti } from '@/components/confetti';
import { ArtImg } from '@/components/art';
import { Mascot, type MascotPose } from '@/components/mascot';
import { EMPTY_ART, reqIconFor, reqIconSrc } from '@/lib/art';
import { cn } from '@/lib/utils';
import { isoToWall, stageForDecision, todayStr, wallToIso, type DecisionStatus, type Requirement } from '@/lib/applications';
import {
  PHASES, PHASE_LABEL, RESULT_LABEL, SUBMIT_ITEM, daysUntil, fmtDay, isDone, isInterviewStage, readyText, reqAction, shortDetail, todoStatus, type Phase,
} from '@/lib/results';
import { useAction } from './data';
import type { AppView } from './view-model';

const panel = 'rounded-2xl border-2 bg-surface';
const outlineBtn = 'btn-3d inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-2xl border-2 border-b-4 border-fun-green-dark bg-surface px-4 text-sm font-extrabold text-primary transition hover:bg-bg active:translate-y-[2px] active:border-b-2 disabled:cursor-not-allowed disabled:opacity-50';
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ header pieces */
function Steps({ phase }: { phase: Phase }) {
  const at = PHASES.indexOf(phase);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Where this application is">
      {PHASES.map((p, i) => {
        // a recorded result means every step is behind you
        const done = i < at || (phase === 'result' && i === at);
        const current = i === at && !done;
        return (
          <li key={p} className="flex items-center gap-2" aria-current={i === at ? 'step' : undefined}>
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-sm font-black', done || current ? 'bg-fun-green-dark text-white' : 'bg-border/70 text-secondary')}>
              {done ? <Check size={15} strokeWidth={4} aria-label="Done" /> : i + 1}
            </span>
            <span className={cn('text-[15px]', done || current ? 'font-black text-ink' : 'font-bold text-secondary')}>{PHASE_LABEL[p]}</span>
            {i < PHASES.length - 1 && <span aria-hidden className={cn('h-[3px] w-6 rounded-sm sm:w-10', i < at ? 'bg-fun-green-dark' : 'bg-border')} />}
          </li>
        );
      })}
    </ol>
  );
}

function DeadlineBadge({ v, onEdit }: { v: AppView; onEdit: () => void }) {
  if (!v.due) return <button type="button" onClick={onEdit} className={outlineBtn}>Set your deadline</button>;
  const n = daysUntil(v.due.due_at);
  const late = n < 0;
  return (
    <button type="button" onClick={onEdit} title="Change the deadline" className={cn('rounded-2xl px-4 py-2.5 text-right transition hover:brightness-95', late ? 'bg-danger/10 text-danger-ink' : 'bg-fun-yellow/30 text-warning-ink')}>
      <span className="block text-[26px] font-black leading-tight">{n === 0 ? 'Today' : days(Math.abs(n))}</span>
      <span className="block text-[13px] font-bold">{n === 0 ? 'is the deadline' : late ? 'past the deadline' : 'until the deadline'}</span>
    </button>
  );
}

function DeadlineDialog({ v, open, onClose, onSaved }: { v: AppView; open: boolean; onClose: () => void; onSaved: () => void }) {
  const tz = v.due?.timezone ?? 'America/New_York';
  const [date, setDate] = useState('');
  const { busy, run } = useAction();
  useEffect(() => { if (open) setDate(v.due ? isoToWall(v.due.due_at, tz).date : ''); }, [open, v.due, tz]);
  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const sb = supabaseBrowser();
    const time = v.due ? isoToWall(v.due.due_at, tz).time : '23:59';
    const ok = await run(async () => {
      if (v.due) await must(sb.from('deadlines').update({ due_at: wallToIso(date, time, tz) }).eq('id', v.due.id));
      else await must(sb.from('deadlines').insert({ application_id: v.row.id, name: 'Submission deadline', kind: 'submission', is_primary: true, timezone: tz, due_at: wallToIso(date, time, tz) }));
    }, 'Deadline saved');
    if (ok) { onSaved(); onClose(); }
  }
  return (
    <Modal open={open} onClose={onClose} title="When is the deadline?">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        <Field label="Deadline date" hint="Copy the date from the school website."><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !date}>{busy ? 'Saving...' : 'Save deadline'}</Button></div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ checklist rows */
function Tick({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border-2 transition disabled:opacity-60', checked ? 'border-fun-green-dark bg-fun-green-dark text-white' : 'border-line bg-surface hover:border-fun-green-dark')}>
      {checked && <Check size={16} strokeWidth={4} aria-hidden />}
    </button>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cn(panel, 'overflow-hidden')}>
      <h3 className="border-b bg-bg px-4 py-3 text-[13px] font-black uppercase tracking-wider text-secondary">{title}</h3>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}
function Row({ r, v, busy, onToggle, readOnly }: { r: Requirement; v: AppView; busy: boolean; onToggle: (r: Requirement, done: boolean) => void; readOnly?: boolean }) {
  const essay = r.essay_id ? v.essays.get(r.essay_id) ?? null : null;
  const done = isDone(r);
  const detail = shortDetail(r, essay);
  const status = todoStatus(r, essay);
  const action = reqAction(r, essay);
  const icon = reqIconFor(r.name, r.category);
  return (
    <li className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
      {readOnly
        ? <span aria-hidden className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border-2', done ? 'border-fun-green-dark bg-fun-green-dark text-white' : 'border-line bg-surface')}>{done && <Check size={16} strokeWidth={4} />}</span>
        : <Tick checked={done} disabled={busy} label={`${r.name}: ${done ? 'done, untick to reopen' : 'tick when done'}`} onChange={(next) => onToggle(r, next)} />}
      {icon ? <ArtImg src={reqIconSrc(icon)} alt="" size={36} className={cn(done && 'opacity-60')} /> : <span aria-hidden className="w-9 shrink-0" />}
      <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-extrabold text-ink">{r.name}{!r.mandatory && <span className="rounded-full border-2 px-2 py-px text-[11px] font-extrabold uppercase tracking-wide text-secondary">Optional</span>}</span>
        {detail && <span className="text-sm text-secondary">{detail}</span>}
      </span>
      <Badge tone={done ? 'success' : status === 'in_progress' ? 'accent' : 'warning'} className="whitespace-nowrap px-2.5 py-1 font-extrabold">{done ? (r.status === 'waived' ? 'Not needed' : 'Done') : status === 'in_progress' ? 'In progress' : 'Not started'}</Badge>
      {!done && !readOnly && (action.kind === 'link'
        ? <Link href={action.href} className={outlineBtn}>{action.label}</Link>
        : <button type="button" disabled={busy} onClick={() => onToggle(r, true)} className={outlineBtn}>{action.label}</button>)}
    </li>
  );
}

/* ------------------------------------------------------------------ before submit */
function PrepareView({ v, reload, onSubmitted }: { v: AppView; reload: () => void; onSubmitted: () => void }) {
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const p = v.progress;
  const sb = supabaseBrowser();

  async function toggle(r: Requirement, done: boolean) {
    if (await run(async () => { await must(sb.from('application_requirements').update({ status: done ? 'complete' : 'not_started' }).eq('id', r.id)); })) reload();
  }
  async function submit() {
    const ok = await run(async () => {
      await must(sb.from('applications').update({ stage: 'submitted', submission_confirmed_at: new Date().toISOString(), submitted_at: todayStr() }).eq('id', v.row.id));
      await must(sb.from('application_requirements').update({ status: 'complete' }).eq('application_id', v.row.id).eq('name', SUBMIT_ITEM));
      await must(sb.from('admissions_decisions').upsert({ application_id: v.row.id, decision: 'awaiting' }, { onConflict: 'application_id', ignoreDuplicates: true }));
    }, 'Marked as submitted. Well done!');
    setConfirm(false);
    if (ok) { onSubmitted(); reload(); }
  }
  const left = p.todo.length;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-black text-ink">{left > 0 && <Mascot pose="checklist" size={44} decorative priority />}What you still need</h2>
        <span className="text-sm font-bold text-secondary">{readyText(p)}</span>
      </div>
      {left > 0
        ? <Group title={`Still to do · ${left}`}>{p.todo.map((r) => <Row key={r.id} r={r} v={v} busy={busy} onToggle={toggle} />)}</Group>
        : p.total
          ? <div className={cn(panel, 'flex flex-wrap items-center gap-4 border-fun-green-dark p-5')}>
              <ArtImg src={EMPTY_ART['all-done'].src} alt={EMPTY_ART['all-done'].alt} size={112} priority />
              <p className="min-w-[200px] flex-1 text-[15px] font-bold text-ink">Everything on your list is ticked off. Nice work! Mochi is taking a well earned break.</p>
            </div>
          : <div className={cn(panel, 'border-fun-green-dark p-5 text-[15px] font-bold text-ink')}>There is nothing on this checklist yet.</div>}
      {p.done.length > 0 && <Group title={`Done · ${p.done.length}`}>{p.done.map((r) => <Row key={r.id} r={r} v={v} busy={busy} onToggle={toggle} />)}</Group>}
      <div className={cn(panel, 'flex flex-wrap items-center justify-between gap-4 px-5 py-4')}>
        <p className="text-[15px] text-secondary">{left > 0 ? `Finish the ${left} item${left === 1 ? '' : 's'} above, then submit on the school site.` : 'Submit on the school site, then tell us here.'}</p>
        <Button className="min-h-12 px-6 text-base font-black" disabled={busy} onClick={() => (p.mandatoryOpen.length ? setConfirm(true) : void submit())}>I have submitted</Button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Some items are not ticked off yet">
        <p className="text-[15px] text-secondary">{p.mandatoryOpen.length === 1 ? 'This required item is still open:' : `These ${p.mandatoryOpen.length} required items are still open:`}</p>
        <ul className="my-3 list-disc space-y-1 pl-5 text-[15px] font-bold text-ink">{p.mandatoryOpen.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
        <p className="text-sm text-secondary">If you have already sent your application to the school, you can still mark it as submitted.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>Go back</Button>
          <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Saving...' : 'Submit anyway'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ after submit */
function Submitted({ v, reload }: { v: AppView; reload: () => void }) {
  const { busy, run } = useAction();
  const p = v.progress;
  const sb = supabaseBrowser();
  async function undo() {
    const ok = await run(async () => {
      await must(sb.from('applications').update({ stage: 'preparing', submission_confirmed_at: null, submitted_at: null }).eq('id', v.row.id));
      await must(sb.from('application_requirements').update({ status: 'not_started' }).eq('application_id', v.row.id).eq('name', SUBMIT_ITEM));
      await must(sb.from('admissions_decisions').delete().eq('application_id', v.row.id));
    }, 'Moved back to Prepare');
    if (ok) reload();
  }
  const all = [...p.done, ...p.todo];
  return (
    <details className={cn(panel, 'px-5 py-4')}>
      <summary className="cursor-pointer text-base font-extrabold text-ink">See what you submitted ({p.done.length} of {p.total} items)</summary>
      <ul className="mt-3 divide-y border-t">{all.map((r) => <Row key={r.id} r={r} v={v} busy readOnly onToggle={() => undefined} />)}</ul>
      {v.phase === 'submitted' && (
        <p className="mt-3 border-t pt-3 text-sm text-secondary">Marked this as submitted by mistake?{' '}
          <ConfirmButton variant="ghost" size="sm" disabled={busy} message="Move this application back to Prepare? Your checklist is kept." onConfirm={() => void undo()}>Move it back to Prepare</ConfirmButton>
        </p>
      )}
    </details>
  );
}

function ResultCountdown({ v, reload }: { v: AppView; reload: () => void }) {
  const { busy, run } = useAction();
  const r = v.result;
  const rounds = v.dates?.rounds ?? [];
  const [own, setOwn] = useState(v.row.expected_result_on ?? '');
  useEffect(() => { setOwn(v.row.expected_result_on ?? ''); }, [v.row.id, v.row.expected_result_on]);
  const sb = supabaseBrowser();
  const patch = async (values: Record<string, unknown>, msg: string) => { if (await run(async () => { await must(sb.from('applications').update(values).eq('id', v.row.id)); }, msg)) reload(); };
  const submittedOn = fmtDay(v.row.submitted_at);
  const roundPicker = rounds.length > 1 || r.needsRoundChoice ? (
    <label className="flex flex-wrap items-center gap-2 text-sm font-bold text-secondary">Which round did you apply in?
      <Select className="w-auto min-w-[10rem]" value={r.round?.round ?? ''} disabled={busy} onChange={(e) => void patch({ result_round: e.target.value || null }, 'Round saved')}>
        {!r.round && <option value="">Pick your round</option>}
        {rounds.map((x) => <option key={x.round} value={x.round}>{x.round}</option>)}
      </Select>
    </label>
  ) : null;
  const ownDate = (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void patch({ expected_result_on: own || null }, own ? 'Date saved' : 'Date cleared'); }}>
      <Field label={r.from === 'you' ? 'Change your expected date' : 'When do you expect to hear back?'}><Input type="date" value={own} onChange={(e) => setOwn(e.target.value)} className="w-auto" /></Field>
      <Button type="submit" variant="secondary" disabled={busy || own === (v.row.expected_result_on ?? '')}>Save date</Button>
    </form>
  );
  const invited = isInterviewStage(v.row.stage);
  const waitPose: MascotPose = invited ? 'interview' : 'reading';
  const source = r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline">Source</a>;

  if (!r.date) {
    return (
      <section className={cn(panel, 'flex flex-col gap-3 border-fun-green-dark p-6')}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[22px] font-black leading-tight text-ink">{r.needsRoundChoice ? 'Tell us your round to see the result date' : 'The school has not announced a result date'}</h2>
          <Mascot pose={waitPose} size={80} priority />
        </div>
        <p className="text-[15px] text-secondary">{submittedOn ? `You submitted on ${submittedOn}. ` : ''}Nothing more to do for now.</p>
        {r.note && <p className="text-[15px] text-ink">{r.note} {source}</p>}
        {roundPicker}
        {!r.needsRoundChoice && <><p className="text-sm text-secondary">If you have an idea of when you will hear back, add your own date and we will count down to it.</p>{ownDate}</>}
      </section>
    );
  }
  const n = r.daysLeft ?? 0;
  return (
    <section className={cn(panel, 'flex flex-wrap items-center gap-7 border-fun-green-dark p-7')}>
      <div className="flex h-[150px] w-[150px] shrink-0 flex-col items-center justify-center rounded-full border-[10px] border-fun-green-dark" role="img" aria-label={n > 0 ? `${days(n)} to go` : 'The result is due'}>
        <span className="text-[44px] font-black leading-none text-ink">{Math.max(0, n)}</span>
        <span className="text-sm font-extrabold text-secondary">{n === 1 ? 'day to go' : 'days to go'}</span>
      </div>
      <div className="flex min-w-[240px] flex-1 flex-col gap-2">
        <h2 className="text-[22px] font-black leading-tight text-ink">Result expected on {fmtDay(r.date)}</h2>
        <p className="text-[15px] text-secondary">
          {submittedOn ? `You submitted on ${submittedOn}. ` : ''}
          {n > 0 ? 'Nothing more to do for now. We will email you a reminder the day before results come out.' : n === 0 ? 'Today is the day. Check your email and the school portal.' : 'The date has passed. Check your email and the school portal, then tell us how it went.'}
        </p>
        {r.from === 'school'
          ? <p className="text-sm text-secondary">Date taken from the school&apos;s published decision calendar{r.round ? ` (${r.round.round})` : ''}. {source}</p>
          : <p className="text-sm text-secondary">This is your own estimate. The school has not announced a result date. {r.note} {source}</p>}
        {roundPicker}
        {r.from === 'you' && ownDate}
      </div>
      <Mascot pose={waitPose} size={96} priority className="hidden self-end sm:block" />
    </section>
  );
}

const OUTCOMES: { decision: DecisionStatus; label: string }[] = [
  { decision: 'admitted', label: 'Admitted' }, { decision: 'waitlisted', label: 'Waitlisted' }, { decision: 'rejected', label: 'Not admitted' }, { decision: 'interview_invited', label: 'Invited to interview' },
];
function useOutcome(v: AppView, reload: () => void, onAdmitted?: () => void) {
  const { busy, run } = useAction();
  async function record(decision: DecisionStatus, msg: string) {
    const sb = supabaseBrowser();
    const target = stageForDecision(decision, v.row.stage);
    const final = decision === 'admitted' || decision === 'waitlisted' || decision === 'rejected';
    const ok = await run(async () => {
      await must(sb.from('admissions_decisions').upsert({ application_id: v.row.id, decision, decision_date: final ? todayStr() : null }, { onConflict: 'application_id' }));
      if (target && target !== v.row.stage) await must(sb.from('applications').update({ stage: target }).eq('id', v.row.id));
    }, msg);
    if (ok) { if (decision === 'admitted') onAdmitted?.(); reload(); }
  }
  return { busy, record };
}
function OutcomeButtons({ v, reload, onAdmitted }: { v: AppView; reload: () => void; onAdmitted: () => void }) {
  const { busy, record } = useOutcome(v, reload, onAdmitted);
  const invited = isInterviewStage(v.row.stage);
  return (
    <section className={cn(panel, 'flex flex-col gap-3 p-5')}>
      <h2 className="text-lg font-black text-ink">When the result arrives</h2>
      <p className="text-[15px] text-secondary">Tell us how it went so your list stays up to date.</p>
      <div className="flex flex-wrap gap-2.5">
        {OUTCOMES.map((o) => {
          const pressed = o.decision === 'interview_invited' && invited;
          return (
            <button key={o.decision} type="button" disabled={busy || pressed} aria-pressed={o.decision === 'interview_invited' ? pressed : undefined}
              onClick={() => void record(o.decision, o.decision === 'interview_invited' ? 'Interview invite saved. Good luck!' : 'Result saved')}
              className={cn('btn-3d min-h-12 rounded-2xl border-2 border-b-4 px-5 text-[15px] font-extrabold transition active:translate-y-[2px] active:border-b-2 disabled:cursor-not-allowed',
                o.decision === 'admitted' ? 'border-fun-green-dark bg-fun-green/25 text-primary hover:bg-fun-green/40' : pressed ? 'border-fun-blue-dark bg-fun-blue/25 text-ink' : 'border-line bg-surface text-ink hover:bg-bg')}>
              {pressed ? 'Invited to interview ✓' : o.label}
            </button>
          );
        })}
      </div>
      {invited && <p className="text-sm font-bold text-accent-ink">You are invited to interview. Good luck! The countdown keeps running until the final result.</p>}
    </section>
  );
}

function ResultCard({ v, reload, onAdmitted }: { v: AppView; reload: () => void; onAdmitted: () => void }) {
  const { busy, record } = useOutcome(v, reload, onAdmitted);
  const s = v.row.stage;
  const copy = {
    admitted: { title: 'You got in. Congratulations!', body: 'All that work paid off. Take a moment to enjoy it.', tone: 'border-fun-green-dark bg-fun-green/15' },
    waitlisted: { title: 'You are on the waitlist', body: 'This is still open. Update it here when the school gets back to you.', tone: 'border-fun-yellow-dark bg-fun-yellow/20' },
    rejected: { title: 'Not admitted this time', body: 'That is tough news, and it says nothing about your worth. Your other applications are still moving.', tone: 'border-line bg-surface' },
    withdrawn: { title: 'You withdrew this application', body: 'It stays here for your records.', tone: 'border-line bg-surface' },
  }[s as 'admitted' | 'waitlisted' | 'rejected' | 'withdrawn'] ?? { title: 'Result recorded', body: '', tone: 'border-line bg-surface' };
  const pose = ({ admitted: 'admitted', waitlisted: 'waitlisted', rejected: 'not-admitted' } as Record<string, MascotPose>)[s];
  return (
    <section className={cn('flex flex-wrap items-center gap-5 rounded-2xl border-2 p-6', copy.tone)}>
      {pose && <Mascot pose={pose} size={120} priority />}
      <div className="flex min-w-[240px] flex-1 flex-col gap-3">
      <h2 className="text-[22px] font-black leading-tight text-ink">{copy.title}</h2>
      {copy.body && <p className="text-[15px] text-secondary">{copy.body}</p>}
      <div className="flex flex-wrap items-center gap-2.5">
        {s === 'waitlisted' && <>
          <button type="button" disabled={busy} onClick={() => void record('admitted', 'Result saved')} className={outlineBtn}>Admitted</button>
          <button type="button" disabled={busy} onClick={() => void record('rejected', 'Result saved')} className={outlineBtn}>Not admitted</button>
        </>}
        {s === 'admitted' && <Link href="/applications?view=decisions" className={outlineBtn}>Compare your offers</Link>}
        <ConfirmButton variant="ghost" size="sm" disabled={busy} message="Clear this result and go back to waiting?" onConfirm={() => void record('awaiting', 'Result cleared')}>Change the result</ConfirmButton>
      </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the pane */
export function ApplicationDetail({ v, reload, onEdit, onDelete }: { v: AppView; reload: () => void; onEdit: () => void; onDelete: () => void }) {
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [party, setParty] = useState(0);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const a = v.row;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
      <header className={cn(panel, 'flex flex-col gap-4 p-5')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-black leading-tight text-ink">{v.school}</h1>
            <p className="mt-1 text-base text-secondary">{[a.program, a.intake, a.round].filter(Boolean).join(' · ')}</p>
          </div>
          {v.phase === 'prepare' ? <DeadlineBadge v={v} onEdit={() => setDeadlineOpen(true)} />
            : <span className="rounded-full bg-fun-green/25 px-3.5 py-1.5 text-sm font-extrabold text-primary">{v.phase === 'submitted' ? 'Submitted' : RESULT_LABEL[a.stage] ?? 'Result'}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Steps phase={v.phase} />
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}><Pencil size={13} /> Edit</Button>
            <ConfirmButton variant="ghost" size="sm" message="Delete this application? Your essays are kept." onConfirm={onDelete}><Trash2 size={13} /> Delete</ConfirmButton>
          </div>
        </div>
      </header>
      {v.phase === 'prepare' && <PrepareView v={v} reload={reload} onSubmitted={() => { setJustSubmitted(true); setParty((n) => n + 1); }} />}
      {justSubmitted && v.phase !== 'prepare' && (
        <div className={cn(panel, 'pop-in flex flex-wrap items-center gap-4 border-fun-green-dark bg-fun-green/15 p-5')} role="status">
          <Mascot pose="party" size={96} priority />
          <div className="min-w-[200px] flex-1">
            <p className="text-[20px] font-black leading-tight text-ink">Submitted. You did it!</p>
            <p className="mt-1 text-[15px] text-secondary">Your application to {v.school} is in. Mochi is throwing you a little party.</p>
          </div>
        </div>
      )}
      {v.phase === 'submitted' && <><ResultCountdown v={v} reload={reload} /><OutcomeButtons v={v} reload={reload} onAdmitted={() => setParty((n) => n + 1)} /></>}
      {v.phase === 'result' && <ResultCard v={v} reload={reload} onAdmitted={() => setParty((n) => n + 1)} />}
      {v.phase !== 'prepare' && <Submitted v={v} reload={reload} />}
      <DeadlineDialog v={v} open={deadlineOpen} onClose={() => setDeadlineOpen(false)} onSaved={reload} />
      <Confetti fire={party} intense />
    </div>
  );
}
