// Daily email reminders: pure logic only (no database, no network, no secrets), so it runs in tests, on the server
// (app/api/cron/daily-reminders) and in the browser (the Settings preview).
//
// Three jobs:
//  1. readReminderPrefs: who wants an email, at what local hour, in which time zone (from settings.onboarding).
//  2. isReminderDue: is this user due now (not emailed yet on their local date, and optionally past their hour).
//  3. buildReminderSnapshot + composeReminderEmail: turn the user's real data into ONE short, friendly email.
import { generateRecommendations, type NbaInput, type Recommendation } from './nba.ts';
import { governingDeadline, isActiveApp } from './overview-logic.ts';
import { parseOnboarding, DEFAULT_REMINDER_HOUR, DEFAULT_TIMEZONE, type Onboarding } from './onboarding.ts';

// ---------------------------------------------------------------------------------------------------------------
// Preferences
export type ReminderPrefs = { enabled: boolean; onboarded: boolean; hourLocal: number; timezone: string; intake: string | null; track: Onboarding['track'] };

/**
 * Reads settings.onboarding defensively. Missing values default to email ON at 19:00 Asia/Jakarta, but nobody is
 * emailed until onboarding.done is exactly true (a half-finished signup never gets mail).
 */
export function readReminderPrefs(settings: unknown): ReminderPrefs {
  const o = parseOnboarding(settings);
  return {
    enabled: o.done === true && o.reminders.email === true,
    onboarded: o.done === true,
    hourLocal: o.reminders.hourLocal ?? DEFAULT_REMINDER_HOUR,
    timezone: o.timezone || DEFAULT_TIMEZONE,
    intake: o.intake ?? null,
    track: o.track,
  };
}

/** Returns the settings object with onboarding.reminders patched, keeping every other key. */
export function withReminderPatch(settings: Record<string, unknown> | null | undefined, patch: { email?: boolean; hourLocal?: number }): Record<string, unknown> {
  const s = settings ?? {};
  const ob = s.onboarding && typeof s.onboarding === 'object' && !Array.isArray(s.onboarding) ? (s.onboarding as Record<string, unknown>) : {};
  const rem = ob.reminders && typeof ob.reminders === 'object' && !Array.isArray(ob.reminders) ? (ob.reminders as Record<string, unknown>) : {};
  return { ...s, onboarding: { ...ob, reminders: { ...rem, ...patch } } };
}

// ---------------------------------------------------------------------------------------------------------------
// Time zones
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_TIMEZONE; }
}
/** Local calendar date (YYYY-MM-DD) and hour (0 to 23) of `now` in the given IANA time zone. */
export function localParts(now: Date, tz: string): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

// ---------------------------------------------------------------------------------------------------------------
// Due logic
export type DueReason = 'due' | 'off' | 'not_onboarded' | 'already_sent' | 'too_early';
export type DueResult = { due: boolean; reason: DueReason; localDate: string; localHour: number };

/**
 * Decides whether a reminder should go out now.
 *  - respectHour false (default, for a once-a-day scheduler such as Vercel Hobby cron): due if reminders are on and
 *    nothing was sent yet on the user's local date.
 *  - respectHour true (for an hourly scheduler): additionally the local hour must be at or past hourLocal.
 * `sentDates` are reminder_log.sent_on values (local dates) for this user.
 */
export function isReminderDue(prefs: ReminderPrefs, now: Date, sentDates: Iterable<string>, opts: { respectHour?: boolean } = {}): DueResult {
  const { date, hour } = localParts(now, prefs.timezone);
  const base = { localDate: date, localHour: hour };
  if (!prefs.onboarded) return { ...base, due: false, reason: 'not_onboarded' };
  if (!prefs.enabled) return { ...base, due: false, reason: 'off' };
  if (new Set(sentDates).has(date)) return { ...base, due: false, reason: 'already_sent' };
  if (opts.respectHour && hour < prefs.hourLocal) return { ...base, due: false, reason: 'too_early' };
  return { ...base, due: true, reason: 'due' };
}

// ---------------------------------------------------------------------------------------------------------------
// Snapshot: the few facts one email needs
export type ReminderAction = { title: string; href: string; minutes: number | null; why: string | null };
export type ReminderDeadline = { label: string; dueAt: string; daysLeft: number };
export type ReminderSnapshot = {
  name: string | null;
  intake: string | null;
  action: ReminderAction;
  deadlines: ReminderDeadline[];
  openTasks: number;
  streak: number;
  activeToday: boolean;
};
export type SnapshotInput = Omit<NbaInput, 'now'> & { name?: string | null; intake?: string | null; streak?: number; activeToday?: boolean };

/** App page for a Next Best Action, based on the rule that produced it. */
export function hrefForRecommendation(r: Pick<Recommendation, 'source' | 'application_id'>): string {
  const rule = r.source.replace(/^rules:\s*/, '');
  const app = r.application_id ? `/applications/${r.application_id}` : '/applications';
  if (rule.startsWith('recommender') || rule === 'no_recommender') return '/recommendations';
  if (rule.startsWith('essay')) return '/essays';
  if (rule.startsWith('profile')) return '/profile';
  if (rule.startsWith('interview')) return '/interview';
  if (rule === 'mandatory_open' || rule === 'fee_unpaid' || rule === 'overdue_task') return app;
  return '/';
}

/** Full days from now until `dueAt` (less than 24 hours = 0). Negative when overdue. */
export const daysLeft = (dueAt: string, now: Date) => Math.floor((new Date(dueAt).getTime() - now.getTime()) / 86_400_000) || 0;

export function buildReminderSnapshot(input: SnapshotInput, now: Date): ReminderSnapshot {
  const school = new Map(input.schools.map((s) => [s.id, s.short_name || s.name]));
  const recs = generateRecommendations({ ...input, now });
  const top = recs[0];
  let action: ReminderAction;
  if (top) action = { title: top.title, href: hrefForRecommendation(top), minutes: top.effort_minutes ?? null, why: top.expected_benefit || null };
  else if (!input.schools.some((s) => s.in_portfolio) && !input.applications.length) action = { title: 'Add 3 schools to your list', href: '/schools', minutes: 10, why: 'A short list turns a big goal into clear next steps.' };
  else if (!input.applications.length) action = { title: 'Create your first application', href: '/applications', minutes: 5, why: 'You get a checklist of everything that school needs.' };
  else action = { title: "Do today's lesson on your Journey", href: '/journey', minutes: 5, why: 'Small steps every day add up fast.' };

  const deadlines: ReminderDeadline[] = [];
  for (const app of input.applications.filter(isActiveApp)) {
    const d = governingDeadline(input.deadlines, app.id, now);
    if (!d || new Date(d.due_at).getTime() < now.getTime()) continue;
    deadlines.push({ label: `${school.get(app.school_id) ?? 'School'} ${d.name}`.trim(), dueAt: d.due_at, daysLeft: daysLeft(d.due_at, now) });
  }
  deadlines.sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const intake = input.intake ?? input.applications.filter(isActiveApp).map((a) => a.intake).filter(Boolean).sort()[0] ?? null;
  return {
    name: input.name?.trim() || null, intake, action, deadlines: deadlines.slice(0, 2),
    openTasks: input.tasks.filter((t) => t.status !== 'done').length,
    streak: Math.max(0, Math.floor(input.streak ?? 0)), activeToday: Boolean(input.activeToday),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Email copy
export type ReminderEmail = { subject: string; preheader: string; text: string; html: string };
export type ComposeOptions = { appUrl: string; unsubscribeUrl: string; seed?: string };

/** Small stable hash so the subject varies day to day but is the same for the same (user, date). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const dueInText = (d: number) => (d <= 0 ? 'due within 24 hours' : d === 1 ? '1 day left' : `${d} days left`);
const minutesText = (m: number | null) => (m == null ? null : m < 60 ? `about ${m} minutes` : `about ${Math.round(m / 30) / 2} hours`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function pickSubject(s: ReminderSnapshot, seed = ''): string {
  const soon = s.deadlines.find((d) => d.daysLeft <= 7);
  if (s.streak > 0 && !s.activeToday) return `Keep your ${s.streak} day streak going today`;
  if (soon) return soon.daysLeft <= 1 ? `${soon.label}: ${dueInText(soon.daysLeft)}` : `${soon.label} is in ${soon.daysLeft} days. One small step today?`;
  const plan = s.intake ? `your ${s.intake} plan` : 'your application plan';
  const options = [
    `2 minutes today keeps ${plan} on track`,
    `Your next step is ready: ${s.action.title}`,
    `One small step for ${plan} today`,
    `Ready when you are: today's step for ${plan}`,
    `Future you says thanks for 5 minutes today`,
  ];
  return options[hashSeed(seed) % options.length];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

/** Builds the one daily email. Plain English, short, one clear button. */
export function composeReminderEmail(s: ReminderSnapshot, o: ComposeOptions): ReminderEmail {
  const subject = pickSubject(s, o.seed);
  const actionUrl = join(o.appUrl, s.action.href);
  const settingsUrl = join(o.appUrl, '/settings');
  const hi = s.name ? `Hi ${s.name},` : 'Hi there,';
  const time = minutesText(s.action.minutes);
  const intro = s.activeToday ? 'Nice work today. If you have a few more minutes, here is the next best thing to do:' : 'Here is the one thing that moves you forward most today:';
  const streakLine = s.streak > 0 ? (s.activeToday ? `You are on a ${s.streak} day streak. Lovely.` : `You are on a ${s.streak} day streak. One small step today keeps it alive.`) : null;
  const dl = s.deadlines.map((d) => `${d.label}: ${dueInText(d.daysLeft)}`);
  const preheader = time ? `${s.action.title} (${time})` : s.action.title;

  const text = [
    hi, '', intro, '',
    `> ${s.action.title}${time ? ` (${time})` : ''}`,
    ...(s.action.why ? [`  ${s.action.why}`] : []),
    `  Start here: ${actionUrl}`,
    ...(dl.length ? ['', 'Coming up:', ...dl.map((x) => `- ${x}`)] : []),
    ...(s.openTasks > 0 ? ['', `You also have ${plural(s.openTasks, 'open task')} waiting.`] : []),
    ...(streakLine ? ['', streakLine] : []),
    '', 'You have got this.', '',
    '--',
    `Change the time or turn these off: ${settingsUrl}`,
    `Unsubscribe in one click: ${o.unsubscribeUrl}`,
  ].join('\n');

  const p = 'margin:0 0 14px;font-size:16px;line-height:1.5;color:#3c3c3c;';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<div style="max-width:480px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border:2px solid #e5e5e5;border-radius:16px;padding:24px 20px;">
<p style="${p}">${esc(hi)}</p>
<p style="${p}">${esc(intro)}</p>
<div style="border:2px solid #e5e5e5;border-bottom-width:4px;border-radius:14px;padding:16px;margin:0 0 16px;">
<p style="margin:0 0 6px;font-size:18px;font-weight:700;line-height:1.35;color:#3c3c3c;">${esc(s.action.title)}</p>
${time ? `<p style="margin:0 0 6px;font-size:14px;color:#777777;">${esc(time)}</p>` : ''}
${s.action.why ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#777777;">${esc(s.action.why)}</p>` : ''}
<a href="${esc(actionUrl)}" style="display:inline-block;background:#58cc02;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 22px;border-radius:12px;border-bottom:4px solid #58a700;">Start now</a>
</div>
${dl.length ? `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#3c3c3c;">Coming up</p><ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#3c3c3c;">${s.deadlines.map((d) => `<li>${esc(d.label)}: <strong>${esc(dueInText(d.daysLeft))}</strong></li>`).join('')}</ul>` : ''}
${s.openTasks > 0 ? `<p style="${p}">You also have ${esc(plural(s.openTasks, 'open task'))} waiting.</p>` : ''}
${streakLine ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#ff9600;font-weight:700;">&#128293; ${esc(streakLine)}</p>` : ''}
<p style="margin:0;font-size:16px;color:#3c3c3c;">You have got this.</p>
</div>
<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#999999;text-align:center;">
You get this because daily reminders are on. <a href="${esc(settingsUrl)}" style="color:#999999;">Change the time</a> or <a href="${esc(o.unsubscribeUrl)}" style="color:#999999;">unsubscribe in one click</a>.
</p>
</div></body></html>`;
  return { subject, preheader, text, html };
}
