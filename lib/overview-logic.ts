import { IN_PROGRESS, SUBMITTED_OR_LATER } from './constants.ts';
import { deadlineRisk, daysUntil, type Risk } from './logic/risk.ts';
import { readiness, DEFAULT_WEIGHTS, type Weights, type ReqCategory } from './logic/readiness.ts';
import type { AppRow, DeadlineRow, ExpenseRow, OverviewData, ReqRow, SchoolRow } from './overview-data.ts';

export const DAY = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const reqDone = (r: { status: string }) => r.status === 'complete' || r.status === 'waived';
/** Open mandatory requirements. "Submission confirmation" is excluded because it can only be completed by submitting. */
export const openMandatory = (reqs: ReqRow[]) => reqs.filter((r) => r.mandatory && !reqDone(r) && r.name !== 'Submission confirmation');
/** An application that still needs work before submission: not submitted, not closed, no confirmed submission. */
export const isActiveApp = (a: Pick<AppRow, 'stage' | 'submission_confirmed_at'>) => (IN_PROGRESS as readonly string[]).includes(a.stage) && !a.submission_confirmed_at;
export const isSubmitted = (a: Pick<AppRow, 'stage' | 'submission_confirmed_at'>) => Boolean(a.submission_confirmed_at) || (SUBMITTED_OR_LATER as readonly string[]).includes(a.stage);

/** The deadline that governs an application: submission/primary deadlines first, earliest upcoming one, else the most recent overdue one. */
export function governingDeadline(deadlines: DeadlineRow[], applicationId: string, now: Date): DeadlineRow | null {
  const all = deadlines.filter((d) => d.application_id === applicationId);
  const main = all.filter((d) => d.kind === 'submission' || d.is_primary);
  const pool = main.length ? main : all;
  if (!pool.length) return null;
  const t = now.getTime();
  const sorted = [...pool].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  return sorted.find((d) => new Date(d.due_at).getTime() >= t) ?? sorted[sorted.length - 1];
}

export type MoneyTotals = { total: number; counted: number; unconverted: Record<string, number>; unconvertedCount: number };
/** Sums amounts into the base currency. Rows in another currency without an fx rate are reported separately, never guessed. */
export function sumMoney(items: { amount: number | null; currency: string; rate: number | null }[], base: string): MoneyTotals {
  const out: MoneyTotals = { total: 0, counted: 0, unconverted: {}, unconvertedCount: 0 };
  for (const i of items) {
    if (i.amount == null) continue;
    if (i.currency === base) { out.total += i.amount; out.counted++; }
    else if (i.rate != null && i.rate > 0) { out.total += i.amount * i.rate; out.counted++; }
    else { out.unconverted[i.currency] = (out.unconverted[i.currency] ?? 0) + i.amount; out.unconvertedCount++; }
  }
  return out;
}
export const budgetTotals = (ex: ExpenseRow[], base: string) => sumMoney(ex.map((e) => ({ amount: e.estimated_cost, currency: e.currency, rate: e.fx_rate_to_base })), base);
export const spendingTotals = (ex: ExpenseRow[], base: string) => sumMoney(ex.filter((e) => e.payment_status === 'paid').map((e) => ({ amount: e.actual_cost, currency: e.currency, rate: e.fx_rate_to_base })), base);

export type Kpis = {
  targetSchools: number; inProgress: number; submitted: number; interviews: number; admitted: number; outstandingTasks: number; overdueTasks: number;
  upcomingDeadlines: number; overdueDeadlines: number; budget: MoneyTotals; spending: MoneyTotals; scholarships: number; scholarshipsIdentified: number; scholarshipsApplied: number;
};
export function computeKpis(d: OverviewData, base: string, now: Date): Kpis {
  const today = isoDay(now);
  const open = d.applications.filter((a) => !isSubmitted(a) && !['withdrawn', 'rejected', 'admitted'].includes(a.stage));
  const openIds = new Set(open.map((a) => a.id));
  const dl = d.deadlines.filter((x) => openIds.has(x.application_id));
  const t = now.getTime();
  const tasksOpen = d.tasks.filter((x) => x.status !== 'done');
  const ident = d.scholarships.filter((s) => s.status === 'identified').length, applied = d.scholarships.filter((s) => s.status === 'applied').length;
  return {
    targetSchools: d.schools.filter((s) => s.in_portfolio).length,
    inProgress: d.applications.filter((a) => (IN_PROGRESS as readonly string[]).includes(a.stage)).length,
    submitted: d.applications.filter(isSubmitted).length,
    interviews: d.applications.filter((a) => a.stage.startsWith('interview_')).length,
    admitted: d.applications.filter((a) => a.stage === 'admitted').length,
    outstandingTasks: tasksOpen.length,
    overdueTasks: tasksOpen.filter((x) => x.due_date && x.due_date < today).length,
    upcomingDeadlines: dl.filter((x) => { const ms = new Date(x.due_at).getTime(); return ms >= t && ms <= t + 30 * DAY; }).length,
    overdueDeadlines: dl.filter((x) => new Date(x.due_at).getTime() < t).length,
    budget: budgetTotals(d.expenses, base), spending: spendingTotals(d.expenses, base),
    scholarships: ident + applied, scholarshipsIdentified: ident, scholarshipsApplied: applied,
  };
}

export type DeadlineRowView = {
  deadline: DeadlineRow; app: AppRow; school: SchoolRow | undefined; risk: Risk; reason: string; done: number; total: number; mandatoryOpen: number; overdue: boolean;
};
/** Deadlines due within `windowDays` (plus overdue ones) on applications that are not submitted, nearest first. */
export function deadlineTimeline(d: Pick<OverviewData, 'deadlines' | 'requirements' | 'schools'>, apps: AppRow[], now: Date, windowDays = 30): DeadlineRowView[] {
  const schools = new Map(d.schools.map((s) => [s.id, s]));
  const appById = new Map(apps.map((a) => [a.id, a]));
  const rows: DeadlineRowView[] = [];
  for (const dl of d.deadlines) {
    const app = appById.get(dl.application_id);
    if (!app || isSubmitted(app) || ['withdrawn', 'rejected', 'admitted'].includes(app.stage)) continue;
    const days = daysUntil(dl.due_at, now);
    if (days > windowDays) continue;
    const reqs = d.requirements.filter((r) => r.application_id === app.id);
    const mo = openMandatory(reqs).length;
    const { risk, reason } = deadlineRisk({ dueAt: dl.due_at, mandatoryOpen: mo, now });
    rows.push({ deadline: dl, app, school: schools.get(app.school_id), risk, reason, done: reqs.filter(reqDone).length, total: reqs.length, mandatoryOpen: mo, overdue: days < 0 });
  }
  return rows.sort((a, b) => new Date(a.deadline.due_at).getTime() - new Date(b.deadline.due_at).getTime());
}

/** Readiness percent per application using the user's weights. Applications without requirements are omitted (unknown, not zero). */
export function readinessByApp(reqs: ReqRow[], weights: Weights = DEFAULT_WEIGHTS): Record<string, number> {
  const by = new Map<string, ReqRow[]>();
  for (const r of reqs) by.set(r.application_id, [...(by.get(r.application_id) ?? []), r]);
  const out: Record<string, number> = {};
  for (const [id, rs] of by) out[id] = readiness(rs.map((r) => ({ name: r.name, category: r.category as ReqCategory, status: r.status, mandatory: r.mandatory })), weights).percent;
  return out;
}

/** Converts a wall-clock "YYYY-MM-DDTHH:mm" in an IANA timezone to a UTC ISO string. */
export function zonedToUtcIso(local: string, timeZone: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error('Invalid date and time');
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (ts: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}
/** Wall-clock "YYYY-MM-DDTHH:mm" of a UTC instant in an IANA timezone (for datetime-local inputs). */
export function utcToZonedLocal(iso: string, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function formatInZone(iso: string, timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); }
  catch { return new Date(iso).toLocaleString('en-US'); }
}
