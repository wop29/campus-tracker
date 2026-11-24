'use client';
// Confirm step for "Start this application" on a program card: shows the intake and lets the student pick a round,
// and warns when they already have an application to this school ("Open existing" or "Create another").
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/components/toast';
import { friendlyDbError } from '@/lib/applications';
import { essayRows, type Program } from '@/lib/programs';
import { fmtDay, programRounds, roundTimeline } from '@/lib/results';
import { intakeFor, programChecklistCount, startProgramApplication } from './program-start';

type Existing = { id: string; program: string; round: string | null; intake: string };
const LATER = '__later__';

export function StartProgramDialog({ open, onClose, schoolId, schoolName, program, fallbackIntake }: {
  open: boolean; onClose: () => void; schoolId: string; schoolName: string; program: Program; fallbackIntake?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [decisionDates, setDecisionDates] = useState<unknown>(null);
  const [existing, setExisting] = useState<Existing[] | null>(null);
  const [another, setAnother] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnother(false); setExisting(null); setBusy(false);
    let live = true;
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from('program_requirements').select('decision_dates').eq('id', program.id).maybeSingle(),
      sb.from('applications').select('id,program,round,intake').eq('school_id', schoolId).is('deleted_at', null),
    ]).then(([dd, apps]) => {
      if (!live) return;
      setDecisionDates((dd.data as { decision_dates?: unknown } | null)?.decision_dates ?? null);
      setExisting((apps.data ?? []) as Existing[]);
    });
    return () => { live = false; };
  }, [open, program.id, schoolId]);

  const rounds = useMemo(() => roundTimeline(programRounds(decisionDates, program.deadlines)), [decisionDates, program.deadlines]);
  const openRounds = rounds.filter((r) => !r.closed);
  const keyOf = (r: { round: string; deadline: string }) => `${r.round}|${r.deadline}`;
  useEffect(() => { setChoice(openRounds[0] ? keyOf(openRounds[0]) : LATER); }, [openRounds.length, decisionDates]); // eslint-disable-line react-hooks/exhaustive-deps

  const intake = intakeFor(program, fallbackIntake);
  const items = programChecklistCount(program);
  const essays = essayRows(program).length;
  const dupes = existing ?? [];
  const showDupe = dupes.length > 0 && !another;

  async function create() {
    if (busy) return; setBusy(true);
    const picked = openRounds.find((r) => keyOf(r) === choice) ?? null;
    try {
      const id = await startProgramApplication(supabaseBrowser(), { schoolId, program, fallbackIntake, round: picked ? { name: picked.round, deadline: picked.deadline } : null });
      toast(`Application started with ${items} checklist item${items === 1 ? '' : 's'}${essays ? ` and ${essays} essay${essays === 1 ? '' : 's'}` : ''}${picked ? `. Your round is ${picked.round}.` : ''}`);
      onClose();
      router.push(`/applications?a=${id}`);
    } catch (e) { toast(friendlyDbError(e instanceof Error ? e.message : String(e)), 'err'); setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Start ${schoolName}, ${program.program_name}?`}>
      {existing === null ? <p className="text-[15px] text-secondary">Getting the details...</p> : showDupe ? (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-2xl border-2 border-fun-yellow-dark/50 bg-fun-yellow/20 p-3 text-[15px] text-ink">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
            <span>You already have {dupes.length === 1 ? 'an application' : `${dupes.length} applications`} to {schoolName}. Do you want to open it, or start another one?</span>
          </p>
          <ul className="space-y-2">
            {dupes.map((d) => (
              <li key={d.id}>
                <Link href={`/applications?a=${d.id}`} onClick={onClose} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border-2 border-line px-3 py-2 text-[15px] hover:bg-bg">
                  <span className="font-bold text-ink">{[d.program, d.intake, d.round].filter(Boolean).join(' · ')}</span>
                  <span className="text-sm font-extrabold text-primary">Open existing</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" className="min-h-11" onClick={onClose}>Cancel</Button>
            <Button className="min-h-11" onClick={() => setAnother(true)}>Create another</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="font-bold text-secondary">Intake</dt><dd className="text-ink">{intake}</dd>
            <dt className="font-bold text-secondary">Checklist</dt><dd className="text-ink">{items} items{essays ? `, ${essays} essay${essays === 1 ? '' : 's'} with prompts` : ''}</dd>
          </dl>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-bold text-ink">Which round will you apply in?</legend>
            {openRounds.map((r) => (
              <label key={keyOf(r)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line px-3 py-2 text-[15px] hover:bg-bg has-[:checked]:border-fun-green-dark has-[:checked]:bg-fun-green/15">
                <input type="radio" name="start-round" checked={choice === keyOf(r)} onChange={() => setChoice(keyOf(r))} className="h-4 w-4" />
                <span className="flex-1 font-bold text-ink">{r.round}{r.next ? ' (next open round)' : ''}</span>
                <span className="text-secondary">{fmtDay(r.deadline)} · {r.daysLeft === 0 ? 'today' : `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`}</span>
              </label>
            ))}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line px-3 py-2 text-[15px] hover:bg-bg has-[:checked]:border-fun-green-dark has-[:checked]:bg-fun-green/15">
              <input type="radio" name="start-round" checked={choice === LATER} onChange={() => setChoice(LATER)} className="h-4 w-4" />
              <span className="flex-1 font-bold text-ink">{openRounds.length ? 'I will decide later' : 'Pick it later from the checklist'}</span>
            </label>
            {rounds.some((r) => r.closed) && <p className="text-xs text-secondary">Rounds whose deadline has passed are not shown.</p>}
            {!rounds.length && <p className="text-xs text-secondary">We could not find round dates for this program. Check them on the school website.</p>}
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="min-h-11" disabled={busy}>{busy ? 'Starting...' : 'Start application'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
