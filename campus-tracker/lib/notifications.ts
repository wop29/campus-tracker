import type { SupabaseClient } from '@supabase/supabase-js';
import { daysUntil, deadlineRisk } from './logic/risk.ts';
import { countWords } from './logic/text.ts';
import { DEFAULT_REMINDER_DAYS, parseSettings } from './settings.ts';
import { loadOverviewData, type OverviewData } from './overview-data.ts';
import { DAY, governingDeadline, isActiveApp, isoDay, openMandatory } from './overview-logic.ts';

/** Browser event fired after notifications change so the header bell can refresh. */
export const NOTIFICATIONS_CHANGED = 'notifications:changed';
export const NOTIFICATION_CATEGORIES = ['deadline', 'task', 'recommendation', 'essay', 'risk', 'scholarship', 'interview', 'decision'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  deadline: 'Deadlines', task: 'Tasks', recommendation: 'Recommended actions', essay: 'Essays', risk: 'At-risk applications', scholarship: 'Scholarships', interview: 'Interviews', decision: 'Decisions',
};
export type NewNotification = { category: NotificationCategory; title: string; body: string; link: string; dedupe_key: string };
export type NotificationInput = Pick<OverviewData, 'schools' | 'applications' | 'deadlines' | 'requirements' | 'tasks' | 'essays' | 'scholarships' | 'interviews' | 'decisions'> & {
  highPriorityRecs: number; now: Date; reminderDays?: number[];
};

/** The reminder tier a deadline currently falls into: the smallest configured day count that is >= days left. Null if it is further away than every tier. */
export function reminderTier(daysLeft: number, tiers: number[]): number | null {
  if (daysLeft < 0) return null;
  const eligible = tiers.filter((t) => daysLeft <= t).sort((a, b) => a - b);
  return eligible.length ? eligible[0] : null;
}
const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Pure: which in-app notifications should exist right now. Dedupe keys make repeated runs idempotent (one per deadline per tier). */
export function buildNotifications(input: NotificationInput): NewNotification[] {
  const { now } = input;
  const tiers = input.reminderDays?.length ? input.reminderDays : DEFAULT_REMINDER_DAYS;
  const out: NewNotification[] = [];
  const schools = new Map(input.schools.map((s) => [s.id, s]));
  const apps = new Map(input.applications.map((a) => [a.id, a]));
  const sname = (schoolId: string | null | undefined) => (schoolId ? schools.get(schoolId)?.short_name || schools.get(schoolId)?.name : null) ?? 'A school';
  const week = Math.floor(now.getTime() / (7 * DAY));
  const today = isoDay(now);

  for (const d of input.deadlines) {
    const app = apps.get(d.application_id);
    if (!app || !isActiveApp(app)) continue;
    const left = daysUntil(d.due_at, now), who = sname(app.school_id);
    if (left < 0) {
      out.push({ category: 'deadline', title: `${who}: ${d.name} has passed`, body: 'This deadline is overdue and the application is not submitted. Check whether it is still open or update the date.', link: '/', dedupe_key: `deadline-overdue:${d.id}:${d.due_at}` });
      continue;
    }
    const tier = reminderTier(left, tiers);
    if (tier != null) out.push({ category: 'deadline', title: `${who}: ${d.name} due within ${dayWord(tier)}`, body: `Due ${new Date(d.due_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`, link: '/', dedupe_key: `deadline:${d.id}:${tier}d:${d.due_at}` });
  }
  const overdue = input.tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today && (!t.application_id || apps.has(t.application_id)));
  if (overdue.length) out.push({ category: 'task', title: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`, body: overdue.slice(0, 3).map((t) => t.title).join('; ') + (overdue.length > 3 ? '; ...' : ''), link: '/applications?view=tasks', dedupe_key: `overdue-tasks:${week}` });
  if (input.highPriorityRecs > 0) out.push({ category: 'recommendation', title: `${input.highPriorityRecs} high priority next action${input.highPriorityRecs === 1 ? '' : 's'} waiting`, body: 'Open the Overview to review them.', link: '/', dedupe_key: `recs-outstanding:${week}` });
  for (const e of input.essays) {
    if (['final_review', 'approved', 'submitted'].includes(e.status)) continue;
    const app = e.application_id ? apps.get(e.application_id) : undefined;
    const dates = [e.deadline, app && isActiveApp(app) ? governingDeadline(input.deadlines, app.id, now)?.due_at : null].filter((x): x is string => Boolean(x));
    if (!dates.length) continue;
    const left = Math.min(...dates.map((x) => daysUntil(x, now)));
    if (left > 14) continue;
    const words = countWords(e.draft);
    out.push({ category: 'essay', title: `Essay not finished: ${e.title}`, body: `${words ? `${words} words written` : 'No draft yet'}, status "${e.status.replace(/_/g, ' ')}", deadline ${left < 0 ? 'has passed' : `in ${dayWord(Math.ceil(left))}`}.`, link: '/essays', dedupe_key: `essay-incomplete:${e.id}` });
  }
  for (const app of input.applications.filter(isActiveApp)) {
    const d = governingDeadline(input.deadlines, app.id, now);
    if (!d) continue;
    const mo = openMandatory(input.requirements.filter((r) => r.application_id === app.id)).length;
    const r = deadlineRisk({ dueAt: d.due_at, mandatoryOpen: mo, now });
    if (r.risk === 'red' && daysUntil(d.due_at, now) <= 30) out.push({ category: 'risk', title: `${sname(app.school_id)} application is at risk`, body: r.reason, link: '/applications', dedupe_key: `at-risk:${app.id}:${d.id}:${d.due_at}` });
  }
  for (const s of input.scholarships) {
    if (!s.deadline || ['awarded', 'rejected', 'applied'].includes(s.status)) continue;
    const left = daysUntil(`${s.deadline}T23:59:59Z`, now), tier = reminderTier(left, tiers);
    if (tier != null) out.push({ category: 'scholarship', title: `Scholarship deadline: ${s.name}`, body: `Deadline ${s.deadline}, within ${dayWord(tier)}. Status: ${s.status.replace(/_/g, ' ')}.`, link: '/', dedupe_key: `scholarship:${s.id}:${tier}d:${s.deadline}` });
  }
  for (const i of input.interviews) {
    if (i.kind !== 'real' || i.status !== 'scheduled' || !i.scheduled_at) continue;
    const tier = reminderTier(daysUntil(i.scheduled_at, now), [7, 3, 1]);
    if (tier != null) out.push({ category: 'interview', title: `Interview within ${dayWord(tier)}${i.school_id ? `: ${sname(i.school_id)}` : ''}`, body: `Scheduled ${new Date(i.scheduled_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`, link: '/interview', dedupe_key: `interview:${i.id}:${tier}d:${i.scheduled_at}` });
  }
  for (const d of input.decisions) {
    const app = apps.get(d.application_id);
    if (!app) continue;
    if (d.decision !== 'awaiting' && now.getTime() - new Date(d.updated_at).getTime() <= 14 * DAY) {
      out.push({ category: 'decision', title: `${sname(app.school_id)}: decision recorded (${d.decision.replace(/_/g, ' ')})`, body: 'Review the decision details and next steps.', link: '/applications?view=decisions', dedupe_key: `decision:${d.id}:${d.decision}` });
    }
    for (const [label, date] of [['Deposit', d.deposit_deadline], ['Waitlist response', d.waitlist_response_deadline]] as const) {
      if (!date) continue;
      const tier = reminderTier(daysUntil(`${date}T23:59:59Z`, now), [7, 3, 1]);
      if (tier != null) out.push({ category: 'decision', title: `${sname(app.school_id)}: ${label.toLowerCase()} deadline within ${dayWord(tier)}`, body: `Due ${date}.`, link: '/applications?view=decisions', dedupe_key: `decision-deadline:${d.id}:${label}:${tier}d:${date}` });
    }
  }
  return out;
}

let inFlight: Promise<number> | null = null;
/** Creates any missing in-app notifications. Existing ones (including read ones) are left alone. Returns the number of candidates checked. Not an email or calendar integration. */
export function syncNotifications(sb: SupabaseClient, data?: OverviewData, now = new Date()): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const d = data ?? await loadOverviewData(sb);
    const { data: u } = await sb.auth.getUser();
    if (!u.user) throw new Error('Not signed in');
    const { data: recs, error: re } = await sb.from('ai_recommendations').select('priority,status,snoozed_until');
    if (re) throw new Error(re.message);
    const high = (recs ?? []).filter((r) => r.priority === 'high' && (r.status === 'new' || r.status === 'accepted')).length;
    const items = buildNotifications({ ...d, highPriorityRecs: high, now, reminderDays: parseSettings(d.settings).reminderDays });
    if (items.length) {
      const { error } = await sb.from('notifications').upsert(items.map((n) => ({ ...n, user_id: u.user!.id })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return items.length;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
