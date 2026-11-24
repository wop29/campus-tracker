// Pure logic for the simplified Applications flow: Prepare -> Submitted -> Result.
// No React, no Supabase. Unit tested in tests/results.test.ts.
import type { Stage } from './constants.ts';

/* ------------------------------------------------------------------ three steps */
export const PHASES = ['prepare', 'submitted', 'result'] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Record<Phase, string> = { prepare: 'Prepare', submitted: 'Submitted', result: 'Result' };
/**
 * The step shown to the user for a database stage. The stage column keeps its full detail underneath:
 * Prepare = researching, shortlisted, preparing, ready. Submitted = submitted and the interview stages.
 * Result = waitlisted, admitted, rejected, withdrawn.
 */
export function phaseOf(stage: Stage | string): Phase {
  switch (stage) {
    case 'submitted': case 'interview_invited': case 'interview_scheduled': case 'interview_completed': return 'submitted';
    case 'waitlisted': case 'admitted': case 'rejected': case 'withdrawn': return 'result';
    default: return 'prepare';
  }
}
export const isInterviewStage = (stage: Stage | string) => stage === 'interview_invited' || stage === 'interview_scheduled' || stage === 'interview_completed';
export const RESULT_LABEL: Record<string, string> = { admitted: 'Admitted', waitlisted: 'Waitlisted', rejected: 'Not admitted', withdrawn: 'Withdrawn' };

/* ------------------------------------------------------------------ dates */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar date in YYYY-MM-DD form, else null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().slice(0, 10).match(ISO_DAY);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}
const localMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/**
 * Whole calendar days from today to the target, in the user's own time zone. 0 = today, negative = in the past.
 * A plain date (YYYY-MM-DD) is read as that calendar day; a timestamp is read as the local day it falls on.
 */
export function daysUntil(target: string, now: Date = new Date()): number {
  const m = target.match(ISO_DAY);
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : localMidnight(new Date(target));
  return Math.round((t - localMidnight(now)) / 86_400_000);
}
const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** "12 Dec 2026" for a plain date, without time zone drift. */
export function fmtDay(day: string | null | undefined): string {
  const m = day?.match(ISO_DAY);
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Text for the list card: "Due in 43 days", "Due today", "3 days overdue", "No deadline yet". */
export function dueLabel(dueAt: string | null | undefined, now: Date = new Date()): string {
  if (!dueAt) return 'No deadline yet';
  const n = daysUntil(dueAt, now);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return n > 0 ? `Due in ${dayWord(n)}` : `${dayWord(-n)} overdue`;
}
/** Text for the list card after submitting: "Result in 38 days", "Result due today", "Result any day now", "Waiting for result". */
export function resultLabel(date: string | null | undefined, now: Date = new Date()): string {
  if (!date) return 'Waiting for result';
  const n = daysUntil(date, now);
  if (n === 0) return 'Result due today';
  return n > 0 ? `Result in ${dayWord(n)}` : 'Result any day now';
}

/* ------------------------------------------------------------------ published decision dates */
export type DecisionRound = { round: string; deadline: string | null; decision_date: string | null; decision_text: string | null };
export type DecisionDates = { cycle: string | null; rounds: DecisionRound[]; policy: string | null; source_url: string | null };
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : null);
const httpUrl = (v: unknown): string | null => { const s = text(v); return s && /^https?:\/\/\S+$/i.test(s) ? s : null; };
/** Reads program_requirements.decision_dates defensively. Null when there is nothing usable in it. */
export function parseDecisionDates(v: unknown): DecisionDates | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const rounds: DecisionRound[] = [];
  if (Array.isArray(o.rounds)) {
    o.rounds.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      const x = r as Record<string, unknown>;
      const round: DecisionRound = { round: text(x.round) ?? `Round ${i + 1}`, deadline: isoDay(x.deadline), decision_date: isoDay(x.decision_date), decision_text: text(x.decision_text) };
      // a decision "date" that is not a real date is kept as text, so nothing the school said gets lost
      if (!round.decision_date && !round.decision_text) round.decision_text = text(x.decision_date);
      rounds.push(round);
    });
  }
  const out: DecisionDates = { cycle: text(o.cycle), rounds, policy: text(o.policy), source_url: httpUrl(o.source_url) };
  return rounds.length || out.policy ? out : null;
}
/**
 * The round an application belongs to. A round the user picked wins. Otherwise it is the round whose deadline is the
 * nearest one on or after the day they submitted. Null means we cannot tell, and the user should pick.
 */
export function pickRound(rounds: DecisionRound[], submittedOn: string | null | undefined, chosen?: string | null): DecisionRound | null {
  if (chosen) { const hit = rounds.find((r) => r.round === chosen); if (hit) return hit; }
  const day = isoDay(submittedOn);
  if (!day) return null;
  const later = rounds.filter((r) => r.deadline && r.deadline >= day).sort((a, b) => a.deadline!.localeCompare(b.deadline!));
  return later[0] ?? null;
}
export type ExpectedResult = {
  /** The date to count down to, or null when nobody has given one. */
  date: string | null;
  /** Who the date comes from: the school's published calendar or the applicant's own estimate. */
  from: 'school' | 'you' | null;
  daysLeft: number | null;
  round: DecisionRound | null;
  /** True when the program has rounds but we could not tell which one applies. */
  needsRoundChoice: boolean;
  /** What the school says in words (a round's decision_text, else the general policy). */
  note: string | null;
  sourceUrl: string | null;
};
/** Works out the result date for a submitted application. The school's published date wins over the applicant's own estimate. */
export function expectedResult(i: { dates: DecisionDates | null; submittedOn: string | null | undefined; chosenRound?: string | null; ownDate?: string | null; now?: Date }): ExpectedResult {
  const now = i.now ?? new Date();
  const rounds = i.dates?.rounds ?? [];
  const round = pickRound(rounds, i.submittedOn, i.chosenRound);
  const own = isoDay(i.ownDate);
  const date = round?.decision_date ?? own;
  return {
    date, from: round?.decision_date ? 'school' : own ? 'you' : null, daysLeft: date ? daysUntil(date, now) : null, round,
    needsRoundChoice: rounds.length > 0 && !round, note: round?.decision_text ?? i.dates?.policy ?? null, sourceUrl: i.dates?.source_url ?? null,
  };
}

/* ------------------------------------------------------------------ the checklist */
/** Ticked off by the submit step itself, so it is never shown as work to do. */
export const SUBMIT_ITEM = 'Submission confirmation';
export type CheckReq = {
  id: string; name: string; category: string; status: string; mandatory: boolean; notes?: string | null; essay_id?: string | null; recommendation_id?: string | null; sort_order?: number;
};
export const isDone = (r: { status: string }) => r.status === 'complete' || r.status === 'waived';
export type Progress<T> = { todo: T[]; done: T[]; total: number; percent: number; mandatoryOpen: T[] };
/** Splits the checklist into "still to do" and "done". Counts ignore the submit step item. */
export function checklistProgress<T extends CheckReq>(reqs: T[]): Progress<T> {
  const shown = reqs.filter((r) => r.name !== SUBMIT_ITEM);
  const done = shown.filter(isDone), todo = shown.filter((r) => !isDone(r));
  // mandatory items first, then the saved order
  todo.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return { todo, done, total: shown.length, percent: shown.length ? Math.round((done.length / shown.length) * 100) : 0, mandatoryOpen: todo.filter((r) => r.mandatory) };
}
export const readyText = (p: { done: unknown[]; total: number }) => `${p.done.length} of ${p.total} ready`;

export type EssayLite = { id: string; words: number; word_limit: number | null };
/** "Not started" or "In progress". An essay with words in its draft counts as in progress even if nobody changed the status. */
export function todoStatus(r: CheckReq, essay?: EssayLite | null): 'not_started' | 'in_progress' {
  return r.status === 'in_progress' || (essay && essay.words > 0) ? 'in_progress' : 'not_started';
}
/** One short line under the item name: the first sentence of the notes, without the source link. */
export function shortDetail(r: CheckReq, essay?: EssayLite | null): string {
  if (r.status === 'waived') return 'Not needed for this school.';
  if (essay && essay.words > 0) return `Draft saved, ${essay.words}${essay.word_limit ? ` of ${essay.word_limit}` : ''} words.`;
  if (essay) return essay.word_limit ? `Prompt and word limit already loaded. Up to ${essay.word_limit} words.` : 'Prompt already loaded.';
  const first = (r.notes ?? '').split('\n').map((l) => l.trim()).find((l) => l && !/^source:/i.test(l)) ?? '';
  if (!first) return '';
  return first.length > 140 ? `${first.slice(0, 137).replace(/[\s,.;:]+\S*$/, '')}...` : first;
}
export type ReqAction = { kind: 'link'; label: string; href: string } | { kind: 'done'; label: string };
/** The one button on a "still to do" row. */
export function reqAction(r: CheckReq, essay?: EssayLite | null): ReqAction {
  if (r.category === 'essays') {
    if (r.essay_id) return { kind: 'link', label: essay && essay.words > 0 ? 'Continue writing' : 'Start essay', href: `/essays/${r.essay_id}` };
    return { kind: 'link', label: 'Open essays', href: '/essays' };
  }
  if (r.category === 'recommendations') return { kind: 'link', label: r.recommendation_id ? 'See recommenders' : 'Add recommender', href: '/recommendations' };
  if (r.category === 'tests') return { kind: 'link', label: 'Add score', href: '/profile?tab=tests' };
  return { kind: 'done', label: /\bfee\b/i.test(r.name) ? 'Mark as paid' : 'Mark as done' };
}

/* ------------------------------------------------------------------ list order */
export type ListSortable = { stage: Stage | string; dueAt: string | null; resultDate: string | null };
/** Applications still being prepared first (nearest deadline on top), then those waiting for a result, then those with a result. */
export function sortForList<T extends ListSortable>(rows: T[]): T[] {
  const rank = (r: T) => PHASES.indexOf(phaseOf(r.stage));
  const key = (r: T) => (phaseOf(r.stage) === 'prepare' ? r.dueAt : phaseOf(r.stage) === 'submitted' ? r.resultDate : null);
  const time = (v: string | null) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => rank(a) - rank(b) || time(key(a)) - time(key(b)));
}
