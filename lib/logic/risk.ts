export type Risk = 'green' | 'yellow' | 'red';
/** Assumed effort to finish one outstanding mandatory requirement, in days. This is an assumption, shown to the user. */
export const DAYS_PER_MANDATORY_REQ = 0.5;

export function daysUntil(due: Date | string, now: Date = new Date()) {
  return (new Date(due).getTime() - now.getTime()) / 86_400_000;
}
export function timeRemaining(due: Date | string, now: Date = new Date()) {
  const ms = new Date(due).getTime() - now.getTime();
  const abs = Math.abs(ms), d = Math.floor(abs / 86_400_000), h = Math.floor((abs % 86_400_000) / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000);
  const txt = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `${txt} overdue` : `${txt} left`;
}
/**
 * Red: overdue, or not enough time left for the outstanding mandatory work, or <=3 days with any mandatory work open.
 * Yellow: mandatory work open and <=14 days, or less than double the time needed.
 * Green: otherwise.
 */
export function deadlineRisk(opts: { dueAt: Date | string; mandatoryOpen: number; submitted?: boolean; now?: Date }): { risk: Risk; reason: string } {
  const now = opts.now ?? new Date();
  if (opts.submitted) return { risk: 'green', reason: 'Already submitted' };
  const d = daysUntil(opts.dueAt, now), need = opts.mandatoryOpen * DAYS_PER_MANDATORY_REQ;
  if (d < 0) return { risk: 'red', reason: 'Deadline has passed' };
  if (opts.mandatoryOpen > 0 && (d < need || d <= 3)) return { risk: 'red', reason: `${opts.mandatoryOpen} mandatory item(s) open with ${Math.max(0, Math.floor(d))} day(s) left` };
  if (opts.mandatoryOpen > 0 && (d <= 14 || d < need * 2)) return { risk: 'yellow', reason: `${opts.mandatoryOpen} mandatory item(s) still open` };
  return { risk: 'green', reason: opts.mandatoryOpen ? 'Enough time for open items' : 'All mandatory items done' };
}
