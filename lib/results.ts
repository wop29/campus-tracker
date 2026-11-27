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

/* ------------------------------------------------------------------ rounds and the next open deadline */
export type RoundDate = { round: string; deadline: string };
export type RoundStatus = RoundDate & { daysLeft: number; closed: boolean; next: boolean };
const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
// "Sep 9, 2026" | "9 Sep 2026" | "2026-09-09"
const DATE_IN_TEXT = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b|\\b(\\d{1,2})\\s+${MON}\\s+(\\d{4})\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'gi');
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => isoDay(`${y}-${pad(m)}-${pad(d)}`);
/** Words around a date that mean it is not an application deadline (results, interviews, the portal opening). */
const NOT_A_DEADLINE = /decision|notif|interview|enrol|release|result|\bopens?\b|invitation|announce|reply|deposit/i;
const FILLER_END = /(?:\b(?:submit(?:ted)?\s+(?:by|from)|apply\s+by|due(?:\s+(?:by|on))?|deadlines?(?:\s+(?:is|on))?|by|on|from|until|is|and|or)|[\s,;:()\-–])+$/i;
function cleanLabel(raw: string): string {
  let s = raw;
  const semi = s.lastIndexOf(';'); if (semi >= 0) s = s.slice(semi + 1);
  s = s.replace(FILLER_END, '');
  const colon = s.lastIndexOf(': '); if (colon >= 0) s = s.slice(colon + 2);
  const stop = s.lastIndexOf('. '); if (stop >= 0) s = s.slice(stop + 2);
  s = s.replace(/^[\s,;:()\-–]*(?:and|or|then)?\s*/i, '').replace(FILLER_END, '').trim();
  return s;
}
/**
 * Application deadlines read from the school's own words (program_requirements.data.deadlines.value), for example
 * "Round 1 Sep 9, 2026 (decision Dec 9, 2026); Round 2 Jan 6, 2027". Dates in brackets and dates about results,
 * interviews or the portal opening are skipped. A date without a clear name becomes "Deadline 1", "Deadline 2" and so on.
 */
export function roundsFromText(value: unknown): RoundDate[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const text = value.slice(0, 4000);
  const out: RoundDate[] = [];
  let prevEnd = 0, unnamed = 0;
  for (const m of text.matchAll(DATE_IN_TEXT)) {
    const start = m.index ?? 0;
    const before = text.slice(0, start);
    const depth = (before.match(/\(/g)?.length ?? 0) - (before.match(/\)/g)?.length ?? 0);
    const raw = text.slice(prevEnd, start);
    prevEnd = start + m[0].length;
    if (depth > 0) continue; // inside brackets: a result date or a time note
    let iso: string | null = null;
    if (m[1]) iso = toIso(+m[3], MONTH_NUM[m[1].slice(0, 3).toLowerCase()], +m[2]);
    else if (m[5]) iso = toIso(+m[6], MONTH_NUM[m[5].slice(0, 3).toLowerCase()], +m[4]);
    else if (m[7]) iso = toIso(+m[7], +m[8], +m[9]);
    if (!iso) continue;
    const tail = raw.slice(Math.max(raw.lastIndexOf(';'), raw.lastIndexOf(','), 0));
    if (NOT_A_DEADLINE.test(tail) || NOT_A_DEADLINE.test(cleanLabel(raw))) continue;
    let label = cleanLabel(raw);
    // a list intro ("MBA 2026-27 deadlines:", "HBS rounds:") is not the name of one round
    if (!/[a-z]/i.test(label) || label.length > 40 || /\b(rounds|deadlines|dates)\b|\b\d{4}-\d{2}\b/i.test(label)) label = '';
    if (!label) { unnamed += 1; label = `Deadline ${unnamed}`; }
    out.push({ round: label, deadline: iso });
  }
  if (unnamed === 1) for (const r of out) if (r.round === 'Deadline 1') r.round = 'Deadline';
  return dedupeRounds(out);
}
function dedupeRounds(rounds: RoundDate[]): RoundDate[] {
  const seen = new Set<string>();
  return rounds.filter((r) => { const k = `${r.round.toLowerCase()}|${r.deadline}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}
/**
 * The program's application rounds that have a real deadline date. The researched calendar (decision_dates rounds with
 * ISO deadlines) wins; when it has no dated rounds, the dates are read from the deadlines text.
 */
export function programRounds(decisionDates: unknown, deadlinesInfo: unknown): RoundDate[] {
  const dd = parseDecisionDates(decisionDates);
  const dated = (dd?.rounds ?? []).filter((r): r is DecisionRound & { deadline: string } => !!r.deadline).map((r) => ({ round: r.round, deadline: r.deadline }));
  if (dated.length) return dedupeRounds(dated);
  const text = deadlinesInfo && typeof deadlinesInfo === 'object' ? (deadlinesInfo as Record<string, unknown>).value : deadlinesInfo;
  return roundsFromText(text);
}
/** Each round with its days left. Past rounds are closed; the first round still open is marked as the next one. */
export function roundTimeline(rounds: RoundDate[], now: Date = new Date()): RoundStatus[] {
  let nextSet = false;
  return [...rounds].sort((a, b) => a.deadline.localeCompare(b.deadline)).map((r) => {
    const daysLeft = daysUntil(r.deadline, now);
    const closed = daysLeft < 0;
    const next = !closed && !nextSet;
    if (next) nextSet = true;
    return { ...r, daysLeft, closed, next };
  });
}
export const nextOpenRound = (t: RoundStatus[]): RoundStatus | null => t.find((r) => r.next) ?? null;
/** "Next open round: Round 2, 5 Jan 2027 (43 days)". Null when there are no dated rounds. */
export function nextRoundText(t: RoundStatus[]): string | null {
  if (!t.length) return null;
  const n = nextOpenRound(t);
  if (!n) return 'Every round for this cycle has closed.';
  const left = n.daysLeft === 0 ? 'today' : dayWord(n.daysLeft);
  return `Next open round: ${n.round}, ${fmtDay(n.deadline)} (${left})`;
}

/* ------------------------------------------------------------------ result date copy */
/** Research notes that must never reach a student ("not present in the retrievable page text" and the like). */
const SCRAPER_NOTE = /not\s+(published|listed|captured|present|stated|found)|retriev|fetched|page\s+(text|labels|body)|program page|links to|to be announced/i;
/**
 * What the school says about its result date, in its own words, when that is useful to a student.
 * Policy keywords ("fixed dates", "not published") and research notes are dropped.
 */
export function resultNote(r: Pick<ExpectedResult, 'round'>): string | null {
  const t = r.round?.decision_text?.trim();
  if (!t || SCRAPER_NOTE.test(t) || isoDay(t) || t.length < 4) return null;
  return t.replace(/[.\s]+$/, '');
}

/* ------------------------------------------------------------------ checklist counts and program checklists */
/** Required items still open, which is what "Finish the N items" counts. */
export const requiredLeft = (p: Pick<Progress<CheckReq>, 'mandatoryOpen'>) => p.mandatoryOpen.length;
export function finishText(p: Pick<Progress<CheckReq>, 'mandatoryOpen' | 'todo'>): string {
  const n = p.mandatoryOpen.length;
  if (n > 0) return `Finish the ${n} required item${n === 1 ? '' : 's'} above, then submit on the school site.`;
  return p.todo.length ? 'Every required item is done. Submit on the school site, then tell us here.' : 'Submit on the school site, then tell us here.';
}
/** The checklist item that asks the student to choose a round. */
export const ROUND_ITEM = 'Pick your round and deadline';
type SortableRow = { key?: string; name: string; mandatory: boolean; sort_order: number };
/** Puts "Pick your round and deadline" first and makes it required, then renumbers. Returns new objects. */
export function roundItemFirst<T extends SortableRow>(rows: T[]): T[] {
  const isRound = (r: T) => r.key === 'deadline' || r.name === ROUND_ITEM;
  const ordered = [...rows.filter(isRound).map((r) => ({ ...r, mandatory: true })), ...rows.filter((r) => !isRound(r))];
  return ordered.map((r, i) => ({ ...r, sort_order: i + 1 }));
}
/** How many items the checklist page will show for these rows (the submit step is not shown). Used in toasts. */
export const visibleItemCount = (rows: { name: string }[]) => rows.filter((r) => r.name !== SUBMIT_ITEM).length;

/** Loose name key so "Recommendation 1" and "Recommendations" or "Academic transcripts" spelled the same way match. */
export function reqNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/\d+$/, '').replace(/s$/, '');
}
export type ExistingReq = { id: string; name: string; status: string; is_default: boolean; essay_id?: string | null; recommendation_id?: string | null };
export type ChecklistPlan<T> = { insert: T[]; deleteIds: string[]; keep: { id: string; sort_order: number }[] };
/**
 * How to switch an older application from the general checklist to the school's own one, without losing work.
 * Kept: anything done or in progress, anything linked to an essay or recommender, and anything the student added.
 * Removed: untouched items from the general template. A school item is not added again when a kept item has the same name.
 */
export function planChecklistUpdate<T extends { name: string; sort_order: number }>(existing: ExistingReq[], incoming: T[]): ChecklistPlan<T> {
  const worked = (r: ExistingReq) => r.status !== 'not_started' || !!r.essay_id || !!r.recommendation_id || !r.is_default;
  const kept = existing.filter(worked);
  const deleteIds = existing.filter((r) => !worked(r)).map((r) => r.id);
  const keptByKey = new Map<string, ExistingReq[]>();
  for (const r of kept) { const k = reqNameKey(r.name); keptByKey.set(k, [...(keptByKey.get(k) ?? []), r]); }
  const insert: T[] = [];
  const keep: { id: string; sort_order: number }[] = [];
  const placed = new Set<string>();
  for (const row of incoming) {
    const hits = keptByKey.get(reqNameKey(row.name));
    if (hits?.length) { for (const h of hits) if (!placed.has(h.id)) { placed.add(h.id); keep.push({ id: h.id, sort_order: row.sort_order }); } }
    else insert.push(row);
  }
  // kept items with no school match go after the school's list, in their old order
  let next = incoming.length + 1;
  for (const r of kept) if (!placed.has(r.id)) keep.push({ id: r.id, sort_order: next++ });
  return { insert, deleteIds, keep };
}

/** Normalised program name for matching an older application to a researched program. */
const progKey = (s: string) => s.toLowerCase().replace(/\bfull[\s-]?time\b|\bdaytime\b|\btwo[\s-]?year\b|\bprogram(me)?\b|\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
/**
 * The researched program that best matches an application's program name: an exact match, else the same name once
 * words like "Full-time" or "Daytime" are ignored, else null (the student picks).
 */
export function bestProgramMatch<P extends { id: string; program_name: string }>(appProgram: string, programs: P[]): P | null {
  const exact = programs.find((p) => p.program_name.trim().toLowerCase() === appProgram.trim().toLowerCase());
  if (exact) return exact;
  const k = progKey(appProgram);
  const loose = programs.filter((p) => progKey(p.program_name) === k);
  return loose.length === 1 ? loose[0] : null;
}

/** A researched program's round data, used for applications that are not linked to a program yet. */
export type RoundSource = { id: string; school_name: string; program_name: string; degree_type: string | null; format: string | null; decision_dates: unknown; deadlines_info?: unknown };

/** Programs that are a school's regular full-time MBA, not a joint degree, a one-year variant, a deferred track or a part-time format. */
const NOT_FLAGSHIP = /\b(joint|dual|jd|md|mpp|mpa|mpa-id|ms|ma|msx|dmd|sm|j-term|january|deferred|scholars|accelerated|early|executive|emba|part-time|evening|weekend|online|lgo|1\+1|2\+2)\b|\//i;
/**
 * For an application that is not linked to a researched program: the program to read round dates from. The best name match,
 * else the school's only regular full-time MBA, else null. We never guess between several.
 */
export function programForRounds<P extends { id: string; program_name: string; degree_type?: string | null; format?: string | null }>(appProgram: string | null | undefined, programs: P[]): P | null {
  const named = bestProgramMatch(appProgram ?? '', programs);
  if (named) return named;
  const flagship = programs.filter((p) => (p.degree_type ?? 'mba') === 'mba' && p.format === 'full-time' && !NOT_FLAGSHIP.test(p.program_name));
  return flagship.length === 1 ? flagship[0] : null;
}

/** Round data for an application with no program link: the best match among its school's researched programs, else null. */
export function unlinkedRoundInfo(
  row: { program: string | null; program_requirement_id?: string | null; school?: { name: string; short_name: string | null } | null },
  sources: RoundSource[],
): { decision_dates: unknown; program_url: string | null; deadlines_info?: unknown } | null {
  if (row.program_requirement_id) return null;
  const names = [row.school?.name, row.school?.short_name].filter((n): n is string => !!n);
  const mine = sources.filter((x) => names.includes(x.school_name));
  const hit = mine.length ? programForRounds(row.program, mine) : null;
  return hit ? { decision_dates: hit.decision_dates, program_url: null, deadlines_info: hit.deadlines_info } : null;
}
