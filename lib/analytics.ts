import { STAGE_LABEL, TIER_LABEL, type Stage } from './constants.ts';
import { daysUntil } from './logic/risk.ts';
import { countWords } from './logic/text.ts';
import type { Weights } from './logic/readiness.ts';
import type { OverviewData } from './overview-data.ts';
import { DAY, governingDeadline, isActiveApp, isSubmitted, isoDay, readinessByApp, spendingTotals } from './overview-logic.ts';

export type Count = { name: string; value: number };
const tally = (keys: string[]): Count[] => { const m = new Map<string, number>(); for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1); return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); };
/** A rate that is only meaningful with a denominator of at least 1. n is always returned so it can be shown. */
export type Rate = { numerator: number; n: number; pct: number | null };
export const rate = (numerator: number, n: number): Rate => ({ numerator, n, pct: n >= 1 ? Math.round((numerator / n) * 100) : null });
/** Below this many observations a rate is shown with a "small sample" warning. */
export const SMALL_SAMPLE = 5;

export type Analytics = {
  applicationCount: number;
  byTier: Count[]; byCountry: Count[]; byStatus: Count[]; readinessBuckets: Count[]; readinessN: number; deadlineBuckets: Count[]; deadlineN: number;
  tasksCompleted: number; tasksOverdue: number; tasksOpen: number; weeklyRate: Rate; weeklyTrend: Count[]; essayStatus: Count[]; essayComplete: Rate; essayWithinLimit: Rate;
  interviewRate: Rate; admitRate: Rate; rejectRate: Rate; waitlistRate: Rate; scholarshipSuccess: Rate;
  spend: { total: number; counted: number; unconverted: Record<string, number> }; costPerSubmitted: number | null; submittedCount: number; scholarshipAwarded: Record<string, number>; awardedCount: number;
};

export function computeAnalytics(d: OverviewData, weights: Weights, base: string, now: Date): Analytics {
  const schools = new Map(d.schools.map((s) => [s.id, s]));
  const apps = d.applications;
  const today = isoDay(now), t = now.getTime();
  const ready = readinessByApp(d.requirements, weights);
  const rv = apps.filter((a) => ready[a.id] != null).map((a) => ready[a.id]);
  const bucket = (p: number) => (p <= 25 ? '0-25%' : p <= 50 ? '26-50%' : p <= 75 ? '51-75%' : '76-100%');
  const order = ['0-25%', '26-50%', '51-75%', '76-100%'];
  const rb = tally(rv.map(bucket)); const readinessBuckets = order.map((name) => ({ name, value: rb.find((x) => x.name === name)?.value ?? 0 }));
  const dlOrder = ['Overdue', 'Next 7 days', '8-14 days', '15-30 days', '31-60 days', 'Over 60 days'];
  const dls = apps.filter(isActiveApp).map((a) => governingDeadline(d.deadlines, a.id, now)).filter((x) => x != null).map((x) => { const days = daysUntil(x!.due_at, now); return days < 0 ? dlOrder[0] : days <= 7 ? dlOrder[1] : days <= 14 ? dlOrder[2] : days <= 30 ? dlOrder[3] : days <= 60 ? dlOrder[4] : dlOrder[5]; });
  const db = tally(dls);

  const done = d.tasks.filter((x) => x.status === 'done');
  const dueLastWeek = d.tasks.filter((x) => x.due_date && x.due_date >= isoDay(new Date(t - 7 * DAY)) && x.due_date <= today);
  const weeklyTrend: Count[] = [];
  for (let w = 7; w >= 0; w--) {
    const from = t - (w + 1) * 7 * DAY, to = t - w * 7 * DAY;
    weeklyTrend.push({ name: w === 0 ? 'This week' : `${w}w ago`, value: d.tasks.filter((x) => x.completed_at && new Date(x.completed_at).getTime() > from && new Date(x.completed_at).getTime() <= to).length });
  }
  const essays = d.essays;
  const complete = essays.filter((e) => ['final_review', 'approved', 'submitted'].includes(e.status)).length;
  const limited = essays.filter((e) => e.word_limit && countWords(e.draft) > 0);

  const submitted = apps.filter(isSubmitted);
  const interviewed = submitted.filter((a) => a.stage.startsWith('interview_') || ['admitted', 'waitlisted'].includes(a.stage) && d.interviews.some((i) => i.application_id === a.id && i.kind === 'real'));
  const decided = apps.filter((a) => ['admitted', 'rejected', 'waitlisted'].includes(a.stage));
  const sOut = d.scholarships.filter((s) => s.status === 'awarded' || s.status === 'rejected');
  const spend = spendingTotals(d.expenses, base);
  const awarded = d.scholarships.filter((s) => s.status === 'awarded' && s.amount != null);
  const awardedBy: Record<string, number> = {};
  for (const s of awarded) awardedBy[s.currency] = (awardedBy[s.currency] ?? 0) + (s.amount as number);
  return {
    applicationCount: apps.length,
    byTier: tally(apps.map((a) => TIER_LABEL[schools.get(a.school_id)?.tier ?? ''] ?? 'No tier set')),
    byCountry: tally(apps.map((a) => schools.get(a.school_id)?.country || 'Unknown')),
    byStatus: tally(apps.map((a) => STAGE_LABEL[a.stage as Stage] ?? a.stage)),
    readinessBuckets, readinessN: rv.length, deadlineBuckets: dlOrder.map((name) => ({ name, value: db.find((x) => x.name === name)?.value ?? 0 })), deadlineN: dls.length,
    tasksCompleted: done.length, tasksOpen: d.tasks.length - done.length, tasksOverdue: d.tasks.filter((x) => x.status !== 'done' && x.due_date && x.due_date < today).length,
    weeklyRate: rate(dueLastWeek.filter((x) => x.status === 'done').length, dueLastWeek.length), weeklyTrend,
    essayStatus: tally(essays.map((e) => e.status.replace(/_/g, ' '))), essayComplete: rate(complete, essays.length), essayWithinLimit: rate(limited.filter((e) => countWords(e.draft) <= (e.word_limit as number)).length, limited.length),
    interviewRate: rate(interviewed.length, submitted.length),
    admitRate: rate(decided.filter((a) => a.stage === 'admitted').length, decided.length), rejectRate: rate(decided.filter((a) => a.stage === 'rejected').length, decided.length), waitlistRate: rate(decided.filter((a) => a.stage === 'waitlisted').length, decided.length),
    scholarshipSuccess: rate(sOut.filter((s) => s.status === 'awarded').length, sOut.length),
    spend, submittedCount: submitted.length, costPerSubmitted: submitted.length >= 1 && spend.counted > 0 ? spend.total / submitted.length : null,
    scholarshipAwarded: awardedBy, awardedCount: awarded.length,
  };
}
