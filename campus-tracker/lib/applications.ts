// Pure logic for the Applications module. No React, no Supabase: everything here is unit tested in tests/applications.test.ts.
import { z } from 'zod';
import { CLOSED, IN_PROGRESS, STAGES, SUBMITTED_OR_LATER, type Stage } from './constants.ts';
import { DEFAULT_WEIGHTS, readiness, type Req, type ReqCategory, type Weights } from './logic/readiness.ts';
import { deadlineRisk, type Risk } from './logic/risk.ts';
import { countWords } from './logic/text.ts';

/* ------------------------------------------------------------------ types */
export type School = { id: string; name: string; short_name: string | null; country: string | null; tier: string | null; location?: string | null };
export const DEADLINE_KINDS = ['submission', 'essay', 'recommendation', 'interview', 'scholarship', 'deposit', 'other'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export type Deadline = { id: string; application_id: string; name: string; due_at: string; timezone: string; kind: DeadlineKind; is_primary: boolean };
export type Requirement = Req & {
  id: string; application_id: string; due_date: string | null; priority: number; document_id: string | null; essay_id: string | null; recommendation_id: string | null;
  assigned_to: string | null; notes: string | null; completed_at: string | null; sort_order: number; is_default: boolean;
};
export type Decision = {
  id: string; application_id: string; decision: DecisionStatus; decision_date: string | null; scholarship_amount: number | null; scholarship_currency: string | null;
  scholarship_decision: 'pending' | 'awarded' | 'none' | null; deposit_deadline: string | null; waitlist_response_deadline: string | null; waitlist_notes: string | null;
  waitlist_contact: string | null; waitlist_materials: string | null; matrix_scores: unknown; notes: string | null;
};
export type Application = {
  id: string; school_id: string; program: string; intake: string; round: string | null; priority: number; application_fee: number | null; fee_currency: string;
  stage: Stage; notes: string | null; submission_confirmed_at: string | null; submitted_at: string | null; confirmation_number: string | null; confirmation_document_id: string | null;
  portal_url: string | null; final_resume_version_id: string | null; submission_checklist: Record<string, boolean> | null; final_essay_versions: Record<string, number> | null;
  submission_notes: string | null; additional_requirements: string | null; updated_at: string; created_at: string;
};
export type AppListRow = Application & { school: School | null; deadlines: Deadline[]; application_requirements: Requirement[]; decision: { decision: DecisionStatus } | null };
export type Task = {
  id: string; application_id: string | null; requirement_id: string | null; title: string; description: string | null; status: 'todo' | 'in_progress' | 'done';
  due_date: string | null; estimated_minutes: number | null; priority: number; completed_at: string | null; source: string; created_at: string;
};
export const DECISION_STATUSES = ['awaiting', 'interview_invited', 'waitlisted', 'admitted', 'rejected', 'withdrawn'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const DECISION_LABEL: Record<DecisionStatus, string> = { awaiting: 'Awaiting decision', interview_invited: 'Interview invited', waitlisted: 'Waitlisted', admitted: 'Admitted', rejected: 'Rejected', withdrawn: 'Withdrawn' };

/* ------------------------------------------------------------------ errors and validation */
/** Turns a database/trigger error into text for the user. Trigger messages are kept verbatim. */
export function friendlyDbError(message: string): string {
  if (/applications_unique_round|duplicate key/i.test(message) && /application/i.test(message)) return 'You already have an application for this school, program, intake and round. Change the round or program, or open the existing application.';
  if (/row-level security/i.test(message)) return 'You do not have permission to change this record.';
  return message;
}
export type FieldErrors = Record<string, string>;
export function zodFieldErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? '_'); if (!out[k]) out[k] = i.message; }
  return out;
}
const optText = z.string().trim().max(5000).optional().transform((v) => (v ? v : null));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Use a valid time');
export const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const tzSchema = z.string().refine(validTimezone, 'Unknown timezone');
const moneyField = z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: 'custom', message: 'Enter a number of 0 or more' }); return z.NEVER; }
  return n;
});
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'HKD', 'CHF', 'CNY', 'IDR', 'INR', 'JPY'];
export const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Zurich', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

export const CREATE_STAGES: Stage[] = ['researching', 'shortlisted', 'preparing'];
export const ApplicationSchema = z.object({
  school_id: z.string().min(1, 'Choose a school'),
  program: z.string().trim().min(1, 'Program is required').max(120),
  intake: z.string().trim().min(1, 'Intake is required').max(60),
  round: z.string().trim().max(60).optional().transform((v) => (v ? v : null)),
  priority: z.coerce.number().int().min(1).max(5),
  application_fee: moneyField,
  fee_currency: z.string().min(3).max(3),
  notes: optText,
});
export const NewApplicationSchema = ApplicationSchema.extend({
  stage: z.enum(CREATE_STAGES),
  deadline_date: dateStr.or(z.literal('')).optional(),
  deadline_time: timeStr.optional(),
  deadline_tz: tzSchema.optional(),
}).superRefine((v, ctx) => {
  if (v.deadline_date && !v.deadline_time) ctx.addIssue({ code: 'custom', path: ['deadline_time'], message: 'Enter a time' });
});
export const DeadlineSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120), date: dateStr, time: timeStr, timezone: tzSchema,
  kind: z.enum(DEADLINE_KINDS), is_primary: z.boolean(),
});
export const REQ_CATEGORIES: ReqCategory[] = ['essays', 'recommendations', 'academics', 'tests', 'resume', 'form', 'other'];
export const RequirementSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  category: z.enum(REQ_CATEGORIES as [ReqCategory, ...ReqCategory[]]),
  status: z.enum(['not_started', 'in_progress', 'complete', 'waived']),
  due_date: dateStr.or(z.literal('')).optional().transform((v) => (v ? v : null)),
  priority: z.coerce.number().int().min(1).max(5),
  mandatory: z.boolean(),
  document_id: z.string().optional().transform((v) => (v ? v : null)),
  essay_id: z.string().optional().transform((v) => (v ? v : null)),
  recommendation_id: z.string().optional().transform((v) => (v ? v : null)),
  assigned_to: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  notes: optText,
});
export const TaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: optText,
  application_id: z.string().optional().transform((v) => (v ? v : null)),
  due_date: dateStr.or(z.literal('')).optional().transform((v) => (v ? v : null)),
  estimated_minutes: z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 100000) { ctx.addIssue({ code: 'custom', message: 'Enter whole minutes above 0' }); return z.NEVER; }
    return n;
  }),
  priority: z.coerce.number().int().min(1).max(5),
});
export const SubmissionSchema = z.object({
  submitted_at: dateStr,
  confirmation_number: z.string().trim().min(1, 'Enter the confirmation number from the school portal').max(200),
  confirmation_document_id: z.string().optional().transform((v) => (v ? v : null)),
  final_resume_version_id: z.string().optional().transform((v) => (v ? v : null)),
  application_fee: moneyField,
  submission_notes: optText,
});
export const PortalUrlSchema = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a full link starting with http:// or https://');

/* ------------------------------------------------------------------ time zones */
export function tzOffsetMinutes(utc: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(utc)) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - Math.floor(utc.getTime() / 1000) * 1000) / 60000;
}
/** Wall-clock date + time in a timezone to a UTC ISO string. */
export function wallToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  t = guess - tzOffsetMinutes(new Date(t), tz) * 60000;
  return new Date(t).toISOString();
}
/** UTC ISO string to the wall-clock date and time in a timezone. */
export function isoToWall(iso: string, tz: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(iso))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const todayStr = (now: Date = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/* ------------------------------------------------------------------ deadlines, readiness, risk */
/** Nearest upcoming deadline; if everything is past, the most recent one. Null when there are none. */
export function nearestDeadline(ds: Deadline[], now: Date = new Date()): Deadline | null {
  if (!ds.length) return null;
  const t = now.getTime();
  const upcoming = ds.filter((d) => new Date(d.due_at).getTime() >= t).sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at));
  if (upcoming.length) return upcoming[0];
  return [...ds].sort((a, b) => +new Date(b.due_at) - +new Date(a.due_at))[0];
}
export function resolveWeights(settings: unknown): Weights {
  const raw = (settings as { readiness_weights?: Record<string, unknown> } | null)?.readiness_weights;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEIGHTS };
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of REQ_CATEGORIES) { const v = Number(raw[k]); if (Number.isFinite(v) && v >= 0) out[k] = v; }
  return Object.values(out).reduce((a, b) => a + b, 0) > 0 ? out : { ...DEFAULT_WEIGHTS };
}
export function validateWeights(w: Record<string, number>): string | null {
  for (const k of REQ_CATEGORIES) if (!Number.isFinite(w[k]) || w[k] < 0 || w[k] > 1000) return 'Each weight must be a number between 0 and 1000';
  return REQ_CATEGORIES.reduce((a, k) => a + w[k], 0) > 0 ? null : 'At least one weight must be above 0';
}
export const isClosedOrSubmitted = (stage: Stage) => !IN_PROGRESS.includes(stage);

export type Enriched = AppListRow & {
  readinessPct: number; mandatoryOpen: number; nearest: Deadline | null; risk: { risk: Risk; reason: string } | null;
};
export function enrich(row: AppListRow, weights: Weights = DEFAULT_WEIGHTS, now: Date = new Date()): Enriched {
  const r = readiness(row.application_requirements, weights);
  const nearest = nearestDeadline(row.deadlines, now);
  const mandatoryOpen = readyBlockers(row.application_requirements).length; // 'Submission confirmation' is completed by submitting, so it is not outstanding work
  const risk = nearest ? deadlineRisk({ dueAt: nearest.due_at, mandatoryOpen, submitted: isClosedOrSubmitted(row.stage), now }) : null;
  return { ...row, readinessPct: r.percent, mandatoryOpen, nearest, risk };
}

/* ------------------------------------------------------------------ list filters and sorting */
export const QUICK_FILTERS = ['all', 'in_progress', 'submitted', 'interview', 'admitted', 'deadlines'] as const;
export type Quick = (typeof QUICK_FILTERS)[number];
export const QUICK_LABEL: Record<Quick, string> = { all: 'All', in_progress: 'In progress', submitted: 'Submitted', interview: 'Interview', admitted: 'Admitted', deadlines: 'With deadlines' };
export const parseQuick = (v: string | null | undefined): Quick => (QUICK_FILTERS as readonly string[]).includes(v ?? '') ? (v as Quick) : 'all';
export const VIEWS = ['pipeline', 'table', 'tasks', 'decisions'] as const;
export type View = (typeof VIEWS)[number];
export const parseView = (v: string | null | undefined): View => (VIEWS as readonly string[]).includes(v ?? '') ? (v as View) : 'pipeline';
const INTERVIEW_STAGES: Stage[] = ['interview_invited', 'interview_scheduled', 'interview_completed'];
export function quickMatch(q: Quick, row: { stage: Stage; deadlines: unknown[] }): boolean {
  switch (q) {
    case 'in_progress': return IN_PROGRESS.includes(row.stage);
    case 'submitted': return SUBMITTED_OR_LATER.includes(row.stage);
    case 'interview': return INTERVIEW_STAGES.includes(row.stage);
    case 'admitted': return row.stage === 'admitted';
    case 'deadlines': return IN_PROGRESS.includes(row.stage) && row.deadlines.length > 0;
    default: return true;
  }
}
export type ListFilters = { q: string; school: string; country: string; tier: string; round: string; stage: string; deadline: '' | 'overdue' | '7' | '14' | '30' | 'none'; priority: string; quick: Quick };
export const EMPTY_FILTERS: ListFilters = { q: '', school: '', country: '', tier: '', round: '', stage: '', deadline: '', priority: '', quick: 'all' };
export function filterApps(rows: Enriched[], f: ListFilters, now: Date = new Date()): Enriched[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (!quickMatch(f.quick, r)) return false;
    if (f.school && r.school_id !== f.school) return false;
    if (f.country && r.school?.country !== f.country) return false;
    if (f.tier && r.school?.tier !== f.tier) return false;
    if (f.round && (r.round ?? '') !== f.round) return false;
    if (f.stage && r.stage !== f.stage) return false;
    if (f.priority && String(r.priority) !== f.priority) return false;
    if (q && ![r.school?.name, r.school?.short_name, r.program, r.intake, r.round, r.notes].some((s) => s?.toLowerCase().includes(q))) return false;
    if (f.deadline) {
      if (f.deadline === 'none') return !r.nearest;
      if (!r.nearest) return false;
      const days = (new Date(r.nearest.due_at).getTime() - now.getTime()) / 86_400_000;
      if (f.deadline === 'overdue') return days < 0;
      return days >= 0 && days <= Number(f.deadline);
    }
    return true;
  });
}
export const SORTS = ['deadline', 'readiness', 'school', 'priority', 'stage', 'updated'] as const;
export type SortKey = (typeof SORTS)[number];
export function sortApps(rows: Enriched[], key: SortKey, dir: 'asc' | 'desc' = 'asc'): Enriched[] {
  const m = dir === 'asc' ? 1 : -1;
  const cmp = (a: Enriched, b: Enriched): number => {
    switch (key) {
      case 'deadline': {
        const x = a.nearest ? +new Date(a.nearest.due_at) : null, y = b.nearest ? +new Date(b.nearest.due_at) : null;
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; // missing deadlines always last
        return (x - y) * m;
      }
      case 'readiness': return (a.readinessPct - b.readinessPct) * m;
      case 'school': return (a.school?.name ?? '').localeCompare(b.school?.name ?? '') * m;
      case 'priority': return (a.priority - b.priority) * m;
      case 'stage': return (STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)) * m;
      default: return (+new Date(a.updated_at) - +new Date(b.updated_at)) * m;
    }
  };
  return [...rows].sort(cmp);
}

/* ------------------------------------------------------------------ stage rules */
export const READY_EXEMPT = 'Submission confirmation';
export function readyBlockers(reqs: Req[]): Req[] {
  return reqs.filter((r) => r.mandatory && r.status !== 'complete' && r.status !== 'waived' && r.name !== READY_EXEMPT);
}
/** Stage changes the UI refuses before touching the database. Returns a message or null. DB triggers remain the final guard. */
export function stageBlock(target: Stage, ctx: { confirmed: boolean }): string | null {
  if (target === 'submitted') return 'Use the Final review tab to submit: it records the confirmation.';
  const needsSubmission: Stage[] = ['interview_invited', 'interview_scheduled', 'interview_completed', 'waitlisted', 'admitted', 'rejected'];
  if (needsSubmission.includes(target) && !ctx.confirmed) return 'Submit the application first (Final review tab) before recording this stage.';
  if (ctx.confirmed && IN_PROGRESS.includes(target)) return 'This application has already been submitted, so it cannot move back to a pre-submission stage. Use Withdrawn if you are no longer pursuing it.';
  return null;
}
/** Which application stage matches a decision. Keeps stage and admissions_decisions consistent. Null means leave the stage alone. */
export function stageForDecision(decision: DecisionStatus, current: Stage): Stage | null {
  switch (decision) {
    case 'waitlisted': case 'admitted': case 'rejected': case 'withdrawn': return decision;
    case 'interview_invited': return current === 'submitted' || CLOSED.includes(current) || current === 'waitlisted' ? 'interview_invited' : null;
    case 'awaiting': return CLOSED.includes(current) || current === 'waitlisted' ? 'submitted' : null;
  }
}
/** Decision that matches a stage, used when the stage is changed directly. Null means no decision implied. */
export function decisionForStage(stage: Stage): DecisionStatus | null {
  switch (stage) {
    case 'submitted': return 'awaiting';
    case 'interview_invited': case 'interview_scheduled': case 'interview_completed': return 'interview_invited';
    case 'waitlisted': case 'admitted': case 'rejected': case 'withdrawn': return stage;
    default: return null;
  }
}

/* ------------------------------------------------------------------ final checklist */
export type CheckState = 'pass' | 'fail' | 'unknown';
export type ChecklistItem = { id: string; label: string; auto: CheckState; detail: string; manual: boolean; canOverride: boolean; satisfied: boolean };
export type EssayLite = { id?: string; title: string; draft: string; word_limit: number | null };
export function essayWordStates(essays: EssayLite[]) {
  return essays.map((e) => { const words = countWords(e.draft); return { ...e, words, over: e.word_limit != null && words > e.word_limit, empty: words === 0 }; });
}
export function buildChecklist(i: {
  confirmations: Record<string, boolean> | null; essays: EssayLite[]; requirements: (Req & { document_id?: string | null })[]; hasTestScores: boolean; recommendations: { status: string }[]; feePaidExpense: boolean;
}): ChecklistItem[] {
  const conf = i.confirmations ?? {};
  type R = Req & { document_id?: string | null };
  const req = (pred: (r: R) => boolean) => i.requirements.filter(pred);
  const doneReq = (r: R) => r.status === 'complete' || r.status === 'waived';
  const items: Omit<ChecklistItem, 'manual' | 'satisfied'>[] = [];
  items.push({ id: 'school_program', label: 'Correct school, program and round', auto: 'unknown', detail: 'Check these against the school portal. This cannot be verified from your data.', canOverride: true });
  const es = essayWordStates(i.essays);
  if (!es.length) items.push({ id: 'essays', label: 'Essays within word limits', auto: 'unknown', detail: 'No essays are linked to this application yet.', canOverride: true });
  else {
    const over = es.filter((e) => e.over), empty = es.filter((e) => e.empty);
    if (over.length) items.push({ id: 'essays', label: 'Essays within word limits', auto: 'fail', detail: `Over the limit: ${over.map((e) => `${e.title} (${e.words}/${e.word_limit})`).join(', ')}. Edit the essay to fix this.`, canOverride: false });
    else if (empty.length) items.push({ id: 'essays', label: 'Essays within word limits', auto: 'fail', detail: `Empty draft: ${empty.map((e) => e.title).join(', ')}.`, canOverride: true });
    else items.push({ id: 'essays', label: 'Essays within word limits', auto: 'pass', detail: es.map((e) => `${e.title}: ${e.words}${e.word_limit ? `/${e.word_limit}` : ' words, no limit set'}`).join('; '), canOverride: true });
  }
  const resume = req((r) => r.category === 'resume');
  items.push({ id: 'resume', label: 'Resume attached', ...(resume.length ? (resume.some((r) => r.document_id || r.status === 'complete') ? { auto: 'pass' as const, detail: 'The resume requirement has a document or is complete.' } : { auto: 'fail' as const, detail: 'Attach a document to the Resume requirement or mark it complete.' }) : { auto: 'unknown' as const, detail: 'No resume requirement found.' }), canOverride: true });
  const tr = req((r) => r.name === 'Academic transcripts');
  items.push({ id: 'transcripts', label: 'Transcripts attached', ...(tr.length ? (tr.some((r) => r.document_id || doneReq(r)) ? { auto: 'pass' as const, detail: 'The transcripts requirement has a document or is complete.' } : { auto: 'fail' as const, detail: 'Attach a document to the transcripts requirement or mark it complete.' }) : { auto: 'unknown' as const, detail: 'No transcripts requirement found.' }), canOverride: true });
  const testReq = req((r) => r.name === 'GMAT/GRE').some(doneReq);
  items.push({ id: 'test_scores', label: 'Test scores entered', auto: i.hasTestScores || testReq ? 'pass' : 'fail', detail: i.hasTestScores ? 'At least one test score is saved in your profile.' : testReq ? 'The GMAT/GRE requirement is complete.' : 'No test score saved in your profile.', canOverride: true });
  const recs = i.recommendations;
  if (!recs.length) items.push({ id: 'recommendations', label: 'Recommendations submitted', auto: 'unknown', detail: 'No recommendations are tracked for this application.', canOverride: true });
  else { const n = recs.filter((r) => r.status === 'submitted').length; items.push({ id: 'recommendations', label: 'Recommendations submitted', auto: n === recs.length ? 'pass' : 'fail', detail: `${n} of ${recs.length} submitted.`, canOverride: true }); }
  const form = req((r) => r.name === 'Application form');
  items.push({ id: 'form', label: 'Application form completed', ...(form.length ? (form.some(doneReq) ? { auto: 'pass' as const, detail: 'The Application form requirement is complete.' } : { auto: 'fail' as const, detail: 'The Application form requirement is not complete.' }) : { auto: 'unknown' as const, detail: 'No application form requirement found.' }), canOverride: true });
  const fee = req((r) => r.name === 'Application fee').some(doneReq);
  items.push({ id: 'fee', label: 'Application fee paid', auto: i.feePaidExpense || fee ? 'pass' : 'fail', detail: i.feePaidExpense ? 'A paid application fee expense is recorded.' : fee ? 'The Application fee requirement is complete.' : 'No paid fee expense and the requirement is not complete.', canOverride: true });
  return items.map((it) => { const manual = !!conf[it.id]; return { ...it, manual, satisfied: it.auto === 'pass' || (manual && it.canOverride) }; });
}
export const checklistComplete = (items: ChecklistItem[]) => items.length > 0 && items.every((i) => i.satisfied);

/* ------------------------------------------------------------------ offer comparison */
export const CRITERIA = [
  { key: 'reputation', label: 'School reputation' }, { key: 'career', label: 'Career opportunities' }, { key: 'aid', label: 'Financial aid' },
  { key: 'cost', label: 'Total cost (higher rating = better value)' }, { key: 'salary', label: 'Expected salary' }, { key: 'fit', label: 'Career fit' },
  { key: 'location', label: 'Location' }, { key: 'duration', label: 'Duration' }, { key: 'preference', label: 'Personal preference' },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]['key'];
export type MatrixScores = { weights: Partial<Record<CriterionKey, number>>; ratings: Partial<Record<CriterionKey, number>>; inputs: { total_cost: number | null; expected_salary: number | null; currency: string | null } };
export function parseMatrix(raw: unknown): MatrixScores {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const weights: MatrixScores['weights'] = {}, ratings: MatrixScores['ratings'] = {};
  for (const c of CRITERIA) {
    const w = Number(o.weights?.[c.key]); if (o.weights?.[c.key] != null && Number.isFinite(w) && w >= 0 && w <= 100) weights[c.key] = w;
    const r = Number(o.ratings?.[c.key]); if (o.ratings?.[c.key] != null && Number.isInteger(r) && r >= 1 && r <= 5) ratings[c.key] = r;
  }
  const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
  return { weights, ratings, inputs: { total_cost: n(o.inputs?.total_cost), expected_salary: n(o.inputs?.expected_salary), currency: typeof o.inputs?.currency === 'string' ? o.inputs.currency : null } };
}
/** Weight used for a criterion: the saved one, else 1 (equal weighting). */
export const weightOf = (w: MatrixScores['weights'], k: CriterionKey) => w[k] ?? 1;
/**
 * Weighted average of 1-5 ratings. Only rated criteria with weight above 0 count, and weights are renormalised over them,
 * so a missing rating never silently counts as a zero. Returns null score when nothing is rated.
 */
export function weightedTotal(ratings: MatrixScores['ratings'], weights: MatrixScores['weights']): { score: number | null; rated: number; of: number } {
  let num = 0, den = 0, rated = 0;
  for (const c of CRITERIA) {
    const r = ratings[c.key]; if (r == null) continue;
    rated++;
    const w = weightOf(weights, c.key); if (w <= 0) continue;
    num += w * r; den += w;
  }
  return { score: den === 0 ? null : Math.round((num / den) * 100) / 100, rated, of: CRITERIA.length };
}
export function rankOffers<T extends { score: number | null }>(offers: T[]): (T & { rank: number | null })[] {
  const sorted = [...offers].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return sorted.map((o) => ({ ...o, rank: o.score == null ? null : 1 + sorted.filter((x) => x.score != null && x.score > o.score!).length }));
}
export type Sourced = { value: number; currency: string | null; source: string };
type DataRow = { field: string; value_num: number | null; currency: string | null; source_name: string };
/** Looks for a researched data point by field name (case-insensitive substring). Only rows with a numeric value count. */
export function pickSourced(rows: DataRow[], kind: 'tuition' | 'living' | 'salary'): Sourced | null {
  const keys = { tuition: ['tuition'], living: ['living'], salary: ['salary'] }[kind];
  const hit = rows.filter((r) => r.value_num != null && keys.some((k) => r.field.toLowerCase().includes(k)))
    .sort((a, b) => Number(b.field.toLowerCase() === keys[0]) - Number(a.field.toLowerCase() === keys[0]))[0];
  return hit ? { value: Number(hit.value_num), currency: hit.currency, source: hit.source_name } : null;
}
/** Total cost from sourced tuition + living expenses. Never guesses: needs both in the same currency, else reports what is known. */
export function sourcedTotalCost(tuition: Sourced | null, living: Sourced | null): { value: number | null; currency: string | null; note: string } {
  if (tuition && living) {
    if (tuition.currency === living.currency) return { value: tuition.value + living.value, currency: tuition.currency, note: `Tuition + living expenses as researched (${tuition.source}; ${living.source}). Check what period each covers.` };
    return { value: null, currency: null, note: 'Tuition and living expenses are in different currencies. Enter a total yourself.' };
  }
  if (tuition) return { value: tuition.value, currency: tuition.currency, note: `Tuition only (${tuition.source}); no living expenses researched.` };
  return { value: null, currency: null, note: 'No researched cost. Enter a total yourself.' };
}

/* ------------------------------------------------------------------ tasks */
export type TaskFilter = { status: 'all' | 'open' | 'todo' | 'in_progress' | 'done' | 'overdue'; applicationId: string };
export const isOverdue = (t: { status: string; due_date: string | null }, now: Date = new Date()) => t.status !== 'done' && !!t.due_date && t.due_date < todayStr(now);
export function filterTasks(tasks: Task[], f: TaskFilter, now: Date = new Date()): Task[] {
  return tasks.filter((t) => {
    if (f.applicationId && (f.applicationId === 'none' ? t.application_id != null : t.application_id !== f.applicationId)) return false;
    switch (f.status) {
      case 'open': return t.status !== 'done';
      case 'overdue': return isOverdue(t, now);
      case 'all': return true;
      default: return t.status === f.status;
    }
  }).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.priority - b.priority);
}
export const taskCompletedAt = (status: Task['status'], prev: string | null) => (status === 'done' ? prev ?? new Date().toISOString() : null);

/* ------------------------------------------------------------------ waitlist letter prompt */
/** Builds the AI prompt from ONLY what the user entered in the waitlist workspace. */
export function buildLetterPrompt(i: { school: string; program: string; achievements: string[]; interest: string; materials: string }): { system: string; prompt: string } {
  const list = i.achievements.map((a) => a.trim()).filter(Boolean);
  const prompt = [
    `School: ${i.school}`, `Program: ${i.program}`,
    `Why the applicant remains interested (written by the applicant): ${i.interest.trim() || '(not provided)'}`,
    `New achievements and updates since applying (listed by the applicant):`, ...(list.length ? list.map((a) => `- ${a}`) : ['(none provided)']),
    `Updated materials the applicant is sending: ${i.materials.trim() || '(none provided)'}`,
    '', 'Write a concise letter of continued interest (under 350 words) in the first person using only the facts above.',
  ].join('\n');
  return { system: 'You help a waitlisted MBA applicant draft a letter of continued interest. Use only the facts supplied. Do not add achievements, numbers, names or claims. Where something is missing, leave a bracketed placeholder for the applicant to fill in.', prompt };
}
export const LETTER_TITLE = 'Letter of continued interest';
