/**
 * Next Best Actions: a deterministic rules engine. No AI is involved; every item is derived from rows in the database.
 *
 * SCORING (0 to 100, higher = do sooner). The score is the sum of six parts, each stored in score_breakdown:
 *   deadline  0-40  proximity of the governing deadline: overdue 40, <=3d 38, <=7d 32, <=14d 24, <=21d 16, <=30d 10, <=60d 5, else/none 0
 *   mandatory 0-15  15 when the item is a mandatory requirement or blocks submission
 *   readiness 0-10  (100 - application readiness%) / 10, only when the application has requirements (unknown is not treated as zero)
 *   weakness  0-8   8 when the item closes a known gap (missing test score, missing recommender, missing impact, over word limit)
 *   impact    0-15  rule-specific weight (see RULE_IMPACT)
 *   effort    0-10  quick wins rank higher: 10 * (1 - min(effort_minutes, 120) / 120)
 * Priority: score >= 55 high, >= 30 medium, else low.
 * Effort minutes are planning estimates (constants below), not measured values, and are shown as estimates.
 */
import { COACH_AND_INTERVIEW_ENABLED } from './constants.ts';
import { countWords } from './logic/text.ts';
import { daysUntil, timeRemaining } from './logic/risk.ts';
import type { OverviewData } from './overview-data.ts';
import { governingDeadline, isActiveApp, isoDay, openMandatory, readinessByApp, reqDone } from './overview-logic.ts';
import type { Weights } from './logic/readiness.ts';

export type Priority = 'high' | 'medium' | 'low';
export type ScoreBreakdown = { deadline: number; mandatory: number; readiness: number; weakness: number; impact: number; effort: number };
export type Recommendation = {
  title: string; description: string; school_id: string | null; application_id: string | null; priority: Priority; reason: string;
  effort_minutes: number; due_date: string | null; expected_benefit: string; source: string; score: number; dedupe_key: string; score_breakdown: ScoreBreakdown;
};
export type NbaInput = Pick<OverviewData, 'schools' | 'applications' | 'deadlines' | 'requirements' | 'tasks' | 'recommendations' | 'recommenders' | 'essays' | 'expenses' | 'interviews' | 'testScores' | 'work' | 'assessments'> & { now: Date; weights?: Weights };

export const RULE_IMPACT = { recommender_pending: 15, no_recommender: 12, mandatory_open: 12, essay_not_started: 10, essay_over_limit: 8, essay_unreviewed: 6, profile_missing_test: 10, profile_missing_impact: 8, fee_unpaid: 8, interview_no_mock: 12, overdue_task: 10 } as const;
export const EFFORT_MIN = { recommender_follow_up: 15, add_recommender: 30, per_mandatory_item: 60, essay_start: 90, essay_trim: 30, essay_review: 20, test: 30, impact: 20, fee: 10, mock_interview: 45, task_default: 30 } as const;
export const HIGH_AT = 55, MEDIUM_AT = 30;

export function deadlinePoints(days: number | null): number {
  if (days == null) return 0;
  if (days < 0) return 40;
  if (days <= 3) return 38; if (days <= 7) return 32; if (days <= 14) return 24; if (days <= 21) return 16; if (days <= 30) return 10; if (days <= 60) return 5;
  return 0;
}
export function scoreItem(f: { daysLeft: number | null; mandatory: boolean; readinessPct: number | null; weakness: boolean; impact: number; effort: number }): { score: number; priority: Priority; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    deadline: deadlinePoints(f.daysLeft), mandatory: f.mandatory ? 15 : 0,
    readiness: f.readinessPct == null ? 0 : Math.round(Math.max(0, Math.min(100, 100 - f.readinessPct)) / 10),
    weakness: f.weakness ? 8 : 0, impact: Math.max(0, Math.min(15, f.impact)), effort: Math.round(10 * (1 - Math.min(f.effort, 120) / 120)),
  };
  const score = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { score, priority: score >= HIGH_AT ? 'high' : score >= MEDIUM_AT ? 'medium' : 'low', breakdown };
}

const humanStatus = (s: string) => s.replace(/_/g, ' ');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function generateRecommendations(input: NbaInput): Recommendation[] {
  const { now } = input;
  const today = isoDay(now);
  const out: Recommendation[] = [];
  const school = new Map(input.schools.map((s) => [s.id, s]));
  const schoolName = (id: string | null | undefined) => (id ? school.get(id)?.short_name || school.get(id)?.name : undefined) ?? 'this school';
  const activeApps = input.applications.filter(isActiveApp);
  const activeById = new Map(activeApps.map((a) => [a.id, a]));
  const ready = readinessByApp(input.requirements, input.weights);
  const dl = new Map(activeApps.map((a) => [a.id, governingDeadline(input.deadlines, a.id, now)]));
  const daysFor = (appId: string) => { const d = dl.get(appId); return d ? daysUntil(d.due_at, now) : null; };
  const dueDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

  const add = (rule: keyof typeof RULE_IMPACT, r: {
    key: string; title: string; description: string; appId?: string | null; schoolId?: string | null; reason: string; effort: number; due?: string | null;
    benefit: string; daysLeft: number | null; mandatory?: boolean; weakness?: boolean;
  }) => {
    const appId = r.appId ?? null;
    const s = scoreItem({ daysLeft: r.daysLeft, mandatory: Boolean(r.mandatory), readinessPct: appId ? ready[appId] ?? null : null, weakness: Boolean(r.weakness), impact: RULE_IMPACT[rule], effort: r.effort });
    out.push({
      title: r.title, description: r.description, school_id: r.schoolId ?? (appId ? activeById.get(appId)?.school_id ?? null : null), application_id: appId, priority: s.priority, reason: r.reason,
      effort_minutes: r.effort, due_date: r.due ?? null, expected_benefit: r.benefit, source: `rules: ${rule}`, score: s.score, dedupe_key: r.key, score_breakdown: s.breakdown,
    });
  };

  // Rule: recommender_pending. Recommendation not submitted and due within 21 days (or overdue).
  const recommenderName = new Map(input.recommenders.map((r) => [r.id, r.name]));
  for (const rec of input.recommendations) {
    const app = activeById.get(rec.application_id);
    if (!app || rec.submitted_at || rec.status === 'submitted') continue;
    const due = rec.deadline ?? dl.get(app.id)?.due_at ?? null;
    if (!due) continue;
    const days = daysUntil(due, now);
    if (days > 21) continue;
    const who = recommenderName.get(rec.recommender_id) ?? 'your recommender', sn = schoolName(app.school_id);
    add('recommender_pending', {
      key: `rec-pending:${rec.id}`, title: `Follow up with ${who} on the ${sn} recommendation`, appId: app.id, due: dueDate(due), daysLeft: days, mandatory: true,
      description: `The recommendation from ${who} for ${sn} is "${humanStatus(rec.status)}" and has not been submitted.`,
      reason: `Recommendation not submitted and due ${timeRemaining(due, now)} (rule: due within 21 days).`, effort: EFFORT_MIN.recommender_follow_up,
      benefit: 'Recommenders need lead time; a late letter can make the application incomplete.',
    });
  }
  // Rule: no_recommender. Application past research with no recommender assigned.
  for (const app of activeApps) {
    if (app.stage === 'researching' || input.recommendations.some((r) => r.application_id === app.id)) continue;
    const sn = schoolName(app.school_id);
    add('no_recommender', {
      key: `no-recommender:${app.id}`, title: `Assign recommenders for ${sn}`, appId: app.id, due: dueDate(dl.get(app.id)?.due_at), daysLeft: daysFor(app.id), mandatory: true, weakness: true,
      description: `No recommender is linked to your ${sn} application.`, reason: `Application is in stage "${humanStatus(app.stage)}" with zero recommenders assigned.`,
      effort: EFFORT_MIN.add_recommender, benefit: 'Gets recommenders briefed early and unblocks the recommendation requirements.',
    });
  }
  // Rule: mandatory_open. Open mandatory requirements on applications with a deadline within 30 days.
  for (const app of activeApps) {
    const d = dl.get(app.id); const days = daysFor(app.id);
    if (!d || days == null || days > 30) continue;
    const open = openMandatory(input.requirements.filter((r) => r.application_id === app.id));
    if (!open.length) continue;
    const sn = schoolName(app.school_id);
    add('mandatory_open', {
      key: `mandatory-open:${app.id}`, title: `Finish ${plural(open.length, 'mandatory item')} for ${sn}`, appId: app.id, due: dueDate(d.due_at), daysLeft: days, mandatory: true,
      description: `Open: ${open.slice(0, 5).map((r) => r.name).join(', ')}${open.length > 5 ? `, and ${open.length - 5} more` : ''}.`,
      reason: `${plural(open.length, 'mandatory requirement')} not complete and the deadline is ${timeRemaining(d.due_at, now)} (rule: deadline within 30 days).`,
      effort: open.length * EFFORT_MIN.per_mandatory_item, benefit: 'Mandatory items must be complete before the application can be marked Ready.',
    });
  }
  // Essay rules.
  const reviewed = new Set(input.assessments.filter((a) => a.kind === 'essay' && a.subject_id).map((a) => a.subject_id));
  for (const e of input.essays) {
    if (e.status === 'submitted') continue;
    const appId = e.application_id && activeById.has(e.application_id) ? e.application_id : null;
    const dates = [e.deadline, appId ? dl.get(appId)?.due_at : null].filter((x): x is string => Boolean(x));
    const earliest = dates.length ? dates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b)) : null;
    const days = earliest ? daysUntil(earliest, now) : null;
    const words = countWords(e.draft);
    const sn = schoolName(e.school_id ?? (appId ? activeById.get(appId)?.school_id : null));
    const base = { appId, schoolId: e.school_id, due: dueDate(earliest), daysLeft: days };
    if (e.status === 'not_started' && words === 0 && days != null && days <= 60) {
      add('essay_not_started', { ...base, key: `essay-start:${e.id}`, title: `Start the essay "${e.title}"`, mandatory: true,
        description: `No draft exists yet for ${sn}.`, reason: `Essay not started and the nearest deadline is ${timeRemaining(earliest!, now)} (rule: no draft with a deadline within 60 days).`,
        effort: EFFORT_MIN.essay_start, benefit: 'A first draft leaves time for revision and review before the deadline.' });
    }
    if (e.word_limit && words > e.word_limit) {
      add('essay_over_limit', { ...base, key: `essay-over:${e.id}`, title: `Cut "${e.title}" to ${e.word_limit} words`, weakness: true,
        description: `The draft has ${words} words, ${words - e.word_limit} over the ${e.word_limit} word limit.`, reason: `Word count ${words} exceeds the limit of ${e.word_limit}.`,
        effort: EFFORT_MIN.essay_trim, benefit: 'Over-limit essays may be rejected or truncated by the application portal.' });
    }
    if ((e.status === 'final_review' || e.status === 'approved') && !reviewed.has(e.id)) {
      add('essay_unreviewed', { ...base, key: `essay-review:${e.id}`, title: `Get a review of "${e.title}"`,
        description: `The essay is marked "${humanStatus(e.status)}" but has no saved AI review. A review needs AI to be configured; a human reader works too.`,
        reason: 'Essay is complete or in final review and there is no saved essay assessment.', effort: EFFORT_MIN.essay_review, benefit: 'A second pair of eyes before submission catches gaps you may no longer see.' });
    }
  }
  // Profile rules (not tied to one application). Urgency comes from the nearest active deadline.
  const nearest = activeApps.map((a) => daysFor(a.id)).filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null;
  if (!input.testScores.some((t) => t.test_type === 'GMAT' || t.test_type === 'GRE')) {
    add('profile_missing_test', { key: 'profile-test', title: 'Add your GMAT or GRE score to your profile', weakness: true, daysLeft: nearest, mandatory: false,
      description: 'No GMAT or GRE score is recorded. If you have not taken one yet, record the planned test date in your notes.',
      reason: 'Profile has no GMAT or GRE entry.', effort: EFFORT_MIN.test, benefit: 'School fit and readiness checks depend on a recorded test score.' });
  }
  if (!input.work.length) {
    add('profile_missing_impact', { key: 'profile-work', title: 'Add your work experience to your profile', weakness: true, daysLeft: nearest,
      description: 'No work experience is recorded.', reason: 'Profile has no work experience rows.', effort: EFFORT_MIN.impact * 2, benefit: 'Essays and interview stories draw on your recorded experience.' });
  }
  for (const w of input.work) {
    if ((w.measurable_impact ?? '').trim()) continue;
    add('profile_missing_impact', { key: `profile-impact:${w.id}`, title: `Add measurable impact for ${w.position} at ${w.company}`, weakness: true, daysLeft: nearest,
      description: 'The measurable impact field is empty for this role. Only add results you can support.', reason: 'Work experience has no measurable impact recorded.',
      effort: EFFORT_MIN.impact, benefit: 'Quantified results make essays and resume bullets more credible.' });
  }
  // Rule: fee_unpaid. Fee still open on an application with a deadline within 30 days.
  for (const app of activeApps) {
    const days = daysFor(app.id);
    if (days == null || days > 30) continue;
    const reqs = input.requirements.filter((r) => r.application_id === app.id && r.name === 'Application fee');
    const feeDue = (app.application_fee ?? 0) > 0 || reqs.some((r) => !reqDone(r));
    const paid = input.expenses.some((e) => e.application_id === app.id && e.category === 'application_fee' && e.payment_status === 'paid') || (reqs.length > 0 && reqs.every(reqDone));
    if (!feeDue || paid) continue;
    const sn = schoolName(app.school_id);
    add('fee_unpaid', { key: `fee-unpaid:${app.id}`, title: `Pay the application fee for ${sn}`, appId: app.id, due: dueDate(dl.get(app.id)?.due_at), daysLeft: days, mandatory: true,
      description: 'No paid application fee is recorded. Record the payment in Finance once you have paid it yourself.', reason: `Fee not marked paid and the deadline is ${timeRemaining(dl.get(app.id)!.due_at, now)}.`,
      effort: EFFORT_MIN.fee, benefit: 'Most portals will not accept a submission without the fee.' });
  }
  // Rule: interview_no_mock. Upcoming real interview and no completed mock session for that school/application.
  // Off while Interview Practice is hidden: there is nowhere to do a mock interview.
  for (const s of COACH_AND_INTERVIEW_ENABLED ? input.interviews : []) {
    if (s.kind !== 'real' || s.status !== 'scheduled' || !s.scheduled_at) continue;
    const days = daysUntil(s.scheduled_at, now);
    if (days < 0 || days > 30) continue;
    const mock = input.interviews.some((m) => m.kind === 'mock' && m.status === 'completed' && ((s.application_id && m.application_id === s.application_id) || (s.school_id && m.school_id === s.school_id)));
    if (mock) continue;
    const sn = schoolName(s.school_id ?? input.applications.find((a) => a.id === s.application_id)?.school_id);
    add('interview_no_mock', { key: `interview-mock:${s.id}`, title: `Do a mock interview before your ${sn} interview`, appId: s.application_id, schoolId: s.school_id, due: dueDate(s.scheduled_at), daysLeft: days, weakness: true,
      description: `Your interview is ${timeRemaining(s.scheduled_at, now)} and you have no completed mock session for it.`, reason: 'Real interview scheduled within 30 days with no completed mock session.',
      effort: EFFORT_MIN.mock_interview, benefit: 'Practice under realistic conditions exposes weak answers while there is still time to fix them.' });
  }
  // Rule: overdue_task.
  const appIds = new Set(input.applications.map((a) => a.id));
  for (const t of input.tasks) {
    if (t.status === 'done' || !t.due_date || t.due_date >= today || (t.application_id && !appIds.has(t.application_id))) continue;
    const days = daysUntil(`${t.due_date}T23:59:59Z`, now);
    add('overdue_task', { key: `task-overdue:${t.id}`, title: `Overdue: ${t.title}`, appId: t.application_id && activeById.has(t.application_id) ? t.application_id : null, due: t.due_date, daysLeft: Math.min(days, -0.01),
      schoolId: t.application_id ? input.applications.find((a) => a.id === t.application_id)?.school_id ?? null : null,
      description: `This task was due on ${t.due_date} and is still ${humanStatus(t.status)}.`, reason: `Task due date ${t.due_date} has passed.`,
      effort: t.estimated_minutes ?? EFFORT_MIN.task_default, benefit: 'Clears a slipped commitment before it blocks other work.' });
  }
  return out.sort((a, b) => b.score - a.score || a.dedupe_key.localeCompare(b.dedupe_key));
}

// ---------- Persistence planning (pure) ----------
export type ExistingRec = { id: string; dedupe_key: string; status: string; snoozed_until: string | null };
export type SyncPlan = {
  /** Brand new rows, inserted with status "new". */
  insert: Recommendation[];
  /** Existing new/accepted rows whose content is refreshed (status untouched). */
  refresh: Recommendation[];
  /** Snoozed rows whose snooze has ended: refreshed and set back to "new". */
  resurface: Recommendation[];
  /** Existing "new" or expired-"snoozed" rows whose condition no longer holds: removed (the user made no decision on them). */
  remove: string[];
  /** Existing "accepted" rows whose condition no longer holds: marked completed. */
  complete: string[];
};
/**
 * Decides what to write. Dismissed, completed and converted rows are never touched, so they cannot come back.
 * Snoozed rows stay hidden until snoozed_until has passed.
 */
export function planSync(generated: Recommendation[], existing: ExistingRec[], now: Date): SyncPlan {
  const byKey = new Map(existing.map((e) => [e.dedupe_key, e]));
  const genKeys = new Set(generated.map((g) => g.dedupe_key));
  const plan: SyncPlan = { insert: [], refresh: [], resurface: [], remove: [], complete: [] };
  for (const g of generated) {
    const e = byKey.get(g.dedupe_key);
    if (!e) plan.insert.push(g);
    else if (e.status === 'new' || e.status === 'accepted') plan.refresh.push(g);
    else if (e.status === 'snoozed' && (!e.snoozed_until || new Date(e.snoozed_until) <= now)) plan.resurface.push(g);
  }
  for (const e of existing) {
    if (genKeys.has(e.dedupe_key)) continue;
    if (e.status === 'new' || (e.status === 'snoozed' && (!e.snoozed_until || new Date(e.snoozed_until) <= now))) plan.remove.push(e.id);
    else if (e.status === 'accepted') plan.complete.push(e.id);
  }
  return plan;
}
export const SNOOZE_OPTIONS = [{ label: '1 day', days: 1 }, { label: '3 days', days: 3 }, { label: '1 week', days: 7 }] as const;
export const snoozeUntil = (days: number, now: Date) => new Date(now.getTime() + days * 86_400_000).toISOString();
/** Recommendations the user should see: new or accepted, plus snoozed ones whose time has passed. */
export const isVisibleRec = (r: { status: string; snoozed_until: string | null }, now: Date) =>
  r.status === 'new' || r.status === 'accepted' || (r.status === 'snoozed' && (!r.snoozed_until || new Date(r.snoozed_until) <= now));
