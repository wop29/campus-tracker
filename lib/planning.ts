import { deadlinePoints } from './nba.ts';
import { daysUntil } from './logic/risk.ts';
import type { AppRow, DeadlineRow, SchoolRow, StoredRecommendation, TaskRow } from './overview-data.ts';
import { DAY, isActiveApp, isoDay } from './overview-logic.ts';

/** Minutes assumed for a task with no estimate. Items using it are flagged "assumed" in the plan. */
export const DEFAULT_TASK_MINUTES = 30;

export type PlanItem = { kind: 'task' | 'recommendation'; id: string; title: string; minutes: number; assumed: boolean; score: number; due: string | null };
export type DayPlan = { capacityMin: number; usedMin: number; planned: PlanItem[]; didNotFit: PlanItem[] };

/**
 * Task score = deadline proximity points (same table as recommendations) + (6 - priority) * 3, where priority 1 is highest.
 * Recommendations keep their rules-engine score. Items are placed by score, highest first; an item that does not fit the remaining
 * time is listed under "did not fit" and smaller items below it can still be placed.
 */
export function taskScore(t: Pick<TaskRow, 'due_date' | 'priority'>, now: Date): number {
  const days = t.due_date ? daysUntil(`${t.due_date}T23:59:59Z`, now) : null;
  return deadlinePoints(days) + (6 - Math.max(1, Math.min(5, t.priority))) * 3;
}
export function buildDayPlan(opts: { hours: number; tasks: TaskRow[]; recs: Pick<StoredRecommendation, 'id' | 'title' | 'score' | 'effort_minutes' | 'due_date' | 'status' | 'snoozed_until' | 'task_id'>[]; now: Date }): DayPlan {
  const { now } = opts;
  const capacityMin = Math.round(opts.hours * 60);
  const linked = new Set(opts.recs.map((r) => r.task_id).filter(Boolean));
  const items: PlanItem[] = [
    ...opts.tasks.filter((t) => t.status !== 'done' && !linked.has(t.id)).map((t): PlanItem => ({ kind: 'task', id: t.id, title: t.title, minutes: t.estimated_minutes ?? DEFAULT_TASK_MINUTES, assumed: t.estimated_minutes == null, score: taskScore(t, now), due: t.due_date })),
    ...opts.recs.filter((r) => r.status === 'new' || r.status === 'accepted' || (r.status === 'snoozed' && r.snoozed_until && new Date(r.snoozed_until) <= now))
      .map((r): PlanItem => ({ kind: 'recommendation', id: r.id, title: r.title, minutes: r.effort_minutes ?? DEFAULT_TASK_MINUTES, assumed: r.effort_minutes == null, score: Number(r.score), due: r.due_date })),
  ].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const planned: PlanItem[] = [], didNotFit: PlanItem[] = [];
  let used = 0;
  for (const it of items) {
    if (used + it.minutes <= capacityMin) { planned.push(it); used += it.minutes; } else didNotFit.push(it);
  }
  return { capacityMin, usedMin: used, planned, didNotFit };
}

export type WeeklyReview = {
  completedThisWeek: number; completedLastWeek: number; delta: number; progress: 'up' | 'down' | 'same' | 'no_data';
  incompleteTasks: number; overdueTasks: number; deadlinesNext7: { deadline: DeadlineRow; app: AppRow; school?: SchoolRow }[];
  needsAttention: { school: string; reasons: string[] }[]; priorities: { title: string; score: number }[];
};
export function buildWeeklyReview(opts: {
  tasks: TaskRow[]; applications: AppRow[]; deadlines: DeadlineRow[]; schools: SchoolRow[]; recs: Pick<StoredRecommendation, 'title' | 'score' | 'status'>[];
  atRiskAppIds: Set<string>; now: Date;
}): WeeklyReview {
  const t = opts.now.getTime(), today = isoDay(opts.now);
  const doneIn = (from: number, to: number) => opts.tasks.filter((x) => x.completed_at && new Date(x.completed_at).getTime() > from && new Date(x.completed_at).getTime() <= to).length;
  const thisW = doneIn(t - 7 * DAY, t), lastW = doneIn(t - 14 * DAY, t - 7 * DAY);
  const schools = new Map(opts.schools.map((s) => [s.id, s]));
  const apps = new Map(opts.applications.map((a) => [a.id, a]));
  const open = opts.tasks.filter((x) => x.status !== 'done');
  const reasons = new Map<string, string[]>();
  const note = (appId: string, r: string) => { const a = apps.get(appId); if (!a) return; const n = schools.get(a.school_id)?.name ?? 'Unknown school'; reasons.set(n, [...(reasons.get(n) ?? []), r]); };
  for (const id of opts.atRiskAppIds) note(id, 'Deadline at risk');
  for (const x of open) if (x.application_id && x.due_date && x.due_date < today) note(x.application_id, `Overdue task: ${x.title}`);
  return {
    completedThisWeek: thisW, completedLastWeek: lastW, delta: thisW - lastW,
    progress: thisW === 0 && lastW === 0 ? 'no_data' : thisW > lastW ? 'up' : thisW < lastW ? 'down' : 'same',
    incompleteTasks: open.length, overdueTasks: open.filter((x) => x.due_date && x.due_date < today).length,
    deadlinesNext7: opts.deadlines.filter((d) => { const a = apps.get(d.application_id); const days = daysUntil(d.due_at, opts.now); return a && isActiveApp(a) && days >= 0 && days <= 7; })
      .sort((a, b) => a.due_at.localeCompare(b.due_at)).map((d) => ({ deadline: d, app: apps.get(d.application_id)!, school: schools.get(apps.get(d.application_id)!.school_id) })),
    needsAttention: [...reasons].map(([school, r]) => ({ school, reasons: [...new Set(r)] })),
    priorities: opts.recs.filter((r) => r.status === 'new' || r.status === 'accepted').sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 3).map((r) => ({ title: r.title, score: Number(r.score) })),
  };
}
