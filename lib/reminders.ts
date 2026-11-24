// Email reminders for University Hunter: pure logic only (no database, no network, no secrets), so it runs in tests,
// on the server (app/api/cron/daily-reminders) and in the browser (the Settings preview).
//
// The idea: emails should feel fun, encouraging and calm. Never nagging. So there is no "one email every day".
// At most ONE email per user per local day, and only when one of these is true (highest priority first):
//   1. deadline_week  an application that is not submitted has its deadline exactly 7, 3 or 1 day(s) away
//   2. result_soon    a submitted application expects its result tomorrow or today
//   3. nudge          no progress for 2 full days: sent at day 2, 5 and 12 of silence, one final note at 3 weeks, then nothing
//   4. celebration    they hit a milestone yesterday (first item, half way, all ready, submitted)
//
// Jobs in this file:
//   readReminderPrefs / isReminderDue   who may get an email now (on, onboarded, nothing sent yet on their local date)
//   buildReminderFacts                  turn raw rows into small facts in the user's own time zone
//   decideReminder                      the pure decision: which kind (or none) and why
//   composeReminder                     the email itself, with copy picked deterministically from user id + date
import { governingDeadline, isActiveApp, isSubmitted, reqDone } from './overview-logic.ts';
import { parseOnboarding, DEFAULT_REMINDER_HOUR, DEFAULT_TIMEZONE, type Onboarding } from './onboarding.ts';

export const PRODUCT_NAME = 'University Hunter';

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
// Dates (all calendar math is on local YYYY-MM-DD strings, so time zones are handled once, in buildReminderFacts)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const dayNumber = (d: string) => Math.round(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000);
/** Whole calendar days from local date `from` to local date `to` (negative when `to` is earlier). */
export const dayDiff = (from: string, to: string) => dayNumber(to) - dayNumber(from);
export const addDays = (d: string, n: number) => new Date((dayNumber(d) + n) * 86_400_000).toISOString().slice(0, 10);
/** Local calendar date of an instant in a time zone, or null for a missing or invalid timestamp. */
export function localDateOf(ts: string | null | undefined, tz: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : localParts(d, tz).date;
}
/** "Monday, November 30" for a YYYY-MM-DD date. */
export const longDate = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));

// ---------------------------------------------------------------------------------------------------------------
// Expected result date
const normRound = (v: unknown) => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim().toLowerCase() : '';
  const n = s.match(/\d+/);
  return n ? n[0] : s;
};
const asDay = (v: unknown) => (typeof v === 'string' && ISO_DAY.test(v) ? v.slice(0, 10) : null);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * When a submitted application expects its result. Reads defensively because the columns may not exist yet:
 *  1. applications.expected_result_on (the student's own date) wins when present.
 *  2. Otherwise program_requirements.decision_dates: a list like [{ round: "Round 2", decision_date: "2027-03-25" }]
 *     (an object keyed by round also works). The entry whose round matches the application's round is used
 *     ("R2", "Round 2" and "2" all match); a list with a single entry is used whatever the round.
 * Returns YYYY-MM-DD or null.
 */
export function expectedResultOn(app: { round?: string | null; expected_result_on?: string | null }, decisionDates?: unknown): string | null {
  const own = asDay(app.expected_result_on);
  if (own) return own;
  let entries: { round: unknown; day: string | null }[] = [];
  // Stored shape from research: { cycle, rounds: [{ round, deadline, decision_date, decision_text }], policy, source_url }
  if (isObj(decisionDates) && Array.isArray(decisionDates.rounds)) decisionDates = decisionDates.rounds;
  const dayIn = (e: unknown) => (isObj(e) ? asDay(e.decision_date) ?? asDay(e.date) ?? asDay(e.result_date) : asDay(e));
  if (Array.isArray(decisionDates)) entries = decisionDates.map((e) => ({ round: isObj(e) ? e.round ?? e.name ?? e.label : null, day: dayIn(e) }));
  else if (isObj(decisionDates)) entries = Object.entries(decisionDates).map(([k, e]) => ({ round: isObj(e) ? e.round ?? k : k, day: dayIn(e) }));
  entries = entries.filter((e) => e.day);
  if (!entries.length) return null;
  const want = normRound(app.round);
  const hit = want ? entries.find((e) => normRound(e.round) === want) : undefined;
  return (hit ?? (entries.length === 1 ? entries[0] : undefined))?.day ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Facts: the few things the decision needs, already in the user's local dates
export type ReminderKind = 'deadline_week' | 'result_soon' | 'nudge' | 'celebration';
/** What is written to reminder_log.kind. The final "we will be here" note is logged separately so the cadence can see it. */
export type LogKind = ReminderKind | 'nudge_final';
export type LogEntry = { sentOn: string; kind: string | null };
export type OpenItem = { name: string; category: string; status: string };
export type FactApp = {
  id: string; label: string;
  state: 'active' | 'submitted' | 'closed';
  deadlineOn: string | null;      // local date of the governing deadline
  resultOn: string | null;        // expected result date (calendar date)
  submittedOn: string | null;     // local date it was submitted
  total: number; ready: number;   // mandatory checklist items (the "Submission confirmation" item is not counted)
  remaining: OpenItem[];          // mandatory items still open, started ones first
  readyOn: (string | null)[];     // local completion date of each ready item (null when unknown)
};
export type ReminderFacts = { userId: string; name: string | null; today: string; apps: FactApp[]; lastActiveOn: string | null; history: LogEntry[] };

/** Raw rows for one user, as loaded by lib/email/reminder-rows.ts. Optional columns may be missing in older databases. */
export type ReminderRows = {
  schools: { id: string; name: string; short_name: string | null }[];
  applications: { id: string; school_id: string; stage: string; round: string | null; submission_confirmed_at: string | null; submitted_at: string | null; program_requirement_id?: string | null; expected_result_on?: string | null }[];
  deadlines: { id: string; application_id: string; name: string; due_at: string; timezone: string; kind: string; is_primary: boolean }[];
  requirements: { id: string; application_id: string; name: string; category: string; status: string; mandatory: boolean; completed_at?: string | null; updated_at?: string | null }[];
  decisions: { application_id: string; decision: string }[];
  /** program_requirements.decision_dates by program_requirement_id. */
  decisionDates: Record<string, unknown>;
  /** Timestamps of anything that counts as progress: xp_events.occurred_at, essays.updated_at, and so on. */
  activityAt: (string | null | undefined)[];
  history: LogEntry[];
};
export type FactsMeta = { userId: string; name?: string | null; timezone: string };

const FINAL_DECISIONS = ['admitted', 'rejected', 'withdrawn'];
const NOT_COUNTED = 'Submission confirmation';

export function buildReminderFacts(rows: ReminderRows, meta: FactsMeta, now: Date): ReminderFacts {
  const tz = safeTimeZone(meta.timezone);
  const today = localParts(now, tz).date;
  const school = new Map(rows.schools.map((s) => [s.id, s.short_name?.trim() || s.name]));
  const decided = new Set(rows.decisions.filter((d) => FINAL_DECISIONS.includes(d.decision)).map((d) => d.application_id));

  const apps: FactApp[] = rows.applications.map((a) => {
    const mandatory = rows.requirements.filter((r) => r.application_id === a.id && r.mandatory && r.name !== NOT_COUNTED);
    const done = mandatory.filter(reqDone);
    const open = mandatory.filter((r) => !reqDone(r));
    const remaining = [...open.filter((r) => r.status === 'in_progress'), ...open.filter((r) => r.status !== 'in_progress')].map((r) => ({ name: r.name, category: r.category, status: r.status }));
    const dl = governingDeadline(rows.deadlines, a.id, now);
    const state: FactApp['state'] = decided.has(a.id) ? 'closed' : isActiveApp(a) ? 'active' : isSubmitted(a) && !FINAL_DECISIONS.includes(a.stage) ? 'submitted' : 'closed';
    return {
      id: a.id, label: school.get(a.school_id) ?? 'your application', state,
      deadlineOn: dl ? localDateOf(dl.due_at, tz) : null,
      resultOn: expectedResultOn(a, a.program_requirement_id ? rows.decisionDates[a.program_requirement_id] : undefined),
      submittedOn: localDateOf(a.submission_confirmed_at ?? a.submitted_at, tz),
      total: mandatory.length, ready: done.length, remaining,
      readyOn: done.map((r) => localDateOf(r.completed_at, tz)),
    };
  });

  const stamps = [...rows.activityAt, ...rows.requirements.flatMap((r) => [r.updated_at, r.completed_at]), ...rows.applications.flatMap((a) => [a.submission_confirmed_at, a.submitted_at])];
  let lastActiveOn: string | null = null;
  for (const ts of stamps) {
    const d = localDateOf(ts, tz);
    if (d && d <= today && (!lastActiveOn || d > lastActiveOn)) lastActiveOn = d;
  }
  return { userId: meta.userId, name: meta.name?.trim() || null, today, apps, lastActiveOn, history: rows.history };
}

// ---------------------------------------------------------------------------------------------------------------
// The decision
export const DEADLINE_DAYS = [7, 3, 1] as const;
/** Full days of silence at which a gentle nudge goes out. */
export const NUDGE_DAYS = [2, 5, 12] as const;
/** After this many full days of silence: one final "we will be here when you are ready" note, then nothing. */
export const NUDGE_FINAL_DAY = 21;
/** The final note may go out up to this many days late (a missed run). After that we stay quiet for good. */
export const NUDGE_FINAL_GRACE = 6;
/** Never two nudges closer together than this many days. */
export const NUDGE_MIN_GAP = 3;

export type TinyStep = { text: string; href: string };
export type Milestone = 'first_item' | 'half_way' | 'all_ready' | 'submitted';
export type Decision =
  | { kind: 'deadline_week'; logKind: 'deadline_week'; reason: string; app: FactApp; daysLeft: 7 | 3 | 1 }
  | { kind: 'result_soon'; logKind: 'result_soon'; reason: string; app: FactApp; when: 'today' | 'tomorrow' }
  | { kind: 'nudge'; logKind: 'nudge' | 'nudge_final'; reason: string; final: boolean; silentDays: number; app: FactApp | null; step: TinyStep }
  | { kind: 'celebration'; logKind: 'celebration'; reason: string; app: FactApp; milestone: Milestone; ready: number }
  | { kind: null; logKind: null; reason: string };

export const appHref = (id: string) => `/applications?a=${encodeURIComponent(id)}`;
const byDeadline = (today: string) => (a: FactApp, b: FactApp) => {
  const key = (x: FactApp) => (x.deadlineOn && x.deadlineOn >= today ? x.deadlineOn : '9999-99-99');
  return key(a).localeCompare(key(b)) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
};

/** One tiny step, about 2 minutes, built from a real open item. */
export function tinyStepFor(item: OpenItem): string {
  const n = `"${item.name}"`;
  switch (item.category) {
    case 'essays': return `Open ${n} and write one rough sentence. It does not need to be good.`;
    case 'recommendations': return item.status === 'in_progress' ? `Open ${n} and check where it stands with your recommender.` : `For ${n}, write down the name of one person you could ask.`;
    case 'tests': return `Open ${n} and add your test date or your latest score.`;
    case 'resume': return `For ${n}, open your resume and improve one line.`;
    case 'academics': return `For ${n}, find your transcript file and note where it is saved.`;
    case 'form': return `Open ${n} and fill in one field.`;
    default: return `Open ${n} and write one line about what it still needs.`;
  }
}
/** Picks the application with the nearest deadline that still has open items, and one tiny step for it. */
export function pickTinyStep(f: ReminderFacts): { app: FactApp | null; step: TinyStep } {
  const active = f.apps.filter((a) => a.state === 'active').sort(byDeadline(f.today));
  const app = active.find((a) => a.remaining.length) ?? active[0] ?? null;
  if (!app) return { app: null, step: { text: 'Add one school you are curious about. A name is enough for now.', href: '/schools' } };
  if (!app.remaining.length) return { app, step: { text: `Read through your ${app.label} checklist once and see how it feels.`, href: appHref(app.id) } };
  return { app, step: { text: tinyStepFor(app.remaining[0]), href: appHref(app.id) } };
}

function findMilestone(f: ReminderFacts): { app: FactApp; milestone: Milestone; ready: number } | null {
  const yesterday = addDays(f.today, -1);
  if (!f.lastActiveOn || f.lastActiveOn < yesterday) return null; // only when they were active yesterday
  const rows = f.apps.map((app) => {
    const y = app.readyOn.filter((d) => d === yesterday).length;
    const after = app.ready - app.readyOn.filter((d) => d === f.today).length; // ready at the end of yesterday
    return { app, y, after, before: after - y };
  });
  const order = [...rows].sort((a, b) => byDeadline(f.today)(a.app, b.app));
  const submitted = order.find((r) => r.app.submittedOn === yesterday);
  if (submitted) return { app: submitted.app, milestone: 'submitted', ready: submitted.after };
  const all = order.find((r) => r.y > 0 && r.app.total > 0 && r.after === r.app.total);
  if (all) return { app: all.app, milestone: 'all_ready', ready: all.after };
  const half = order.find((r) => r.y > 0 && r.before * 2 < r.app.total && r.after * 2 >= r.app.total);
  if (half) return { app: half.app, milestone: 'half_way', ready: half.after };
  const first = order.find((r) => r.y > 0);
  if (first && rows.reduce((n, r) => n + r.before, 0) === 0) return { app: first.app, milestone: 'first_item', ready: first.after };
  return null;
}

const NONE = (reason: string): Decision => ({ kind: null, logKind: null, reason });
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Why a nudge is or is not due. Exported for tests and the dry run. */
export function nudgeStatus(f: ReminderFacts): { send: false; reason: string } | { send: true; final: boolean; silentDays: number; reason: string } {
  if (!f.lastActiveOn) return { send: false, reason: 'no activity on record yet' };
  const silent = Math.max(0, dayDiff(f.lastActiveOn, f.today) - 1); // full local days with no progress, not counting today
  if (silent < NUDGE_DAYS[0]) return { send: false, reason: silent === 0 ? 'active today or yesterday' : `only ${days(silent)} without progress` };
  if (f.apps.length && !f.apps.some((a) => a.state === 'active')) return { send: false, reason: 'nothing left to do: every application is submitted or closed' };
  if (silent > NUDGE_FINAL_DAY + NUDGE_FINAL_GRACE) return { send: false, reason: `quiet for ${days(silent)}: staying silent until they return` };
  const since = f.history.filter((h) => h.sentOn > f.lastActiveOn! && h.sentOn < f.today && (h.kind == null || h.kind === 'nudge' || h.kind === 'nudge_final'));
  if (since.some((h) => h.kind === 'nudge_final')) return { send: false, reason: 'the final note was already sent: staying silent until they return' };
  const last = since.map((h) => h.sentOn).sort().pop();
  const gapOk = !last || dayDiff(last, f.today) >= NUDGE_MIN_GAP;
  if (silent >= NUDGE_FINAL_DAY) {
    if (!gapOk) return { send: false, reason: `final note is due, waiting ${days(NUDGE_MIN_GAP)} after the last nudge` };
    return { send: true, final: true, silentDays: silent, reason: `no progress for ${days(silent)} (last active ${f.lastActiveOn}): one final note, then silence` };
  }
  const stage = NUDGE_DAYS.filter((d) => d <= silent).length;
  const next = NUDGE_DAYS[stage] ?? NUDGE_FINAL_DAY;
  if (since.length >= stage) return { send: false, reason: `no progress for ${days(silent)}, nudge ${since.length} of ${NUDGE_DAYS.length} already sent: next check-in at day ${next}` };
  if (!gapOk) return { send: false, reason: `nudge ${stage} is due, waiting ${days(NUDGE_MIN_GAP)} after the last one` };
  return { send: true, final: false, silentDays: silent, reason: `no progress for ${days(silent)} (last active ${f.lastActiveOn}): nudge ${stage} of ${NUDGE_DAYS.length}` };
}

/**
 * The whole policy in one pure function. Returns at most one email kind for today, highest priority first:
 * deadline_week, result_soon, nudge, celebration. `reason` always says why, including when nothing is sent.
 */
export function decideReminder(f: ReminderFacts): Decision {
  // 1. A deadline exactly 7, 3 or 1 local day(s) away, for an application that is not submitted yet.
  const dl = f.apps.filter((a) => a.state === 'active' && a.deadlineOn && (DEADLINE_DAYS as readonly number[]).includes(dayDiff(f.today, a.deadlineOn)))
    .sort(byDeadline(f.today))[0];
  if (dl) {
    const n = dayDiff(f.today, dl.deadlineOn!) as 7 | 3 | 1;
    return { kind: 'deadline_week', logKind: 'deadline_week', app: dl, daysLeft: n, reason: `${dl.label} deadline is ${days(n)} away (${dl.deadlineOn})` };
  }
  // 2. A result expected tomorrow or today. One email per result: if we wrote yesterday, we do not write again today.
  const wroteYesterday = f.history.some((h) => h.kind === 'result_soon' && h.sentOn === addDays(f.today, -1));
  const res = f.apps.filter((a) => a.state === 'submitted' && a.resultOn)
    .map((a) => ({ a, n: dayDiff(f.today, a.resultOn!) }))
    .filter((x) => x.n === 1 || (x.n === 0 && !wroteYesterday))
    .sort((x, y) => x.n - y.n || byDeadline(f.today)(x.a, y.a))[0];
  if (res) return { kind: 'result_soon', logKind: 'result_soon', app: res.a, when: res.n === 0 ? 'today' : 'tomorrow', reason: `${res.a.label} result is expected ${res.n === 0 ? 'today' : 'tomorrow'} (${res.a.resultOn})` };
  // 3. A gentle nudge after silence.
  const n = nudgeStatus(f);
  if (n.send) {
    const { app, step } = pickTinyStep(f);
    return { kind: 'nudge', logKind: n.final ? 'nudge_final' : 'nudge', final: n.final, silentDays: n.silentDays, app, step, reason: n.reason };
  }
  // 4. A short congratulation for a milestone reached yesterday.
  const m = findMilestone(f);
  if (m) return { kind: 'celebration', logKind: 'celebration', ...m, reason: `milestone yesterday: ${m.milestone.replace('_', ' ')} for ${m.app.label}` };
  return NONE(n.reason);
}

// ---------------------------------------------------------------------------------------------------------------
// Email copy. Rules for every line here (checked by tests/reminders.test.ts): calm and kind, no alarm words,
// no words in capitals, no long dashes, at most one exclamation mark per email.
export type ReminderEmail = { kind: ReminderKind; subject: string; preheader: string; text: string; html: string };
export type ComposeOptions = { appUrl: string; unsubscribeUrl: string; seed?: string };

/** Small stable hash so the copy varies from day to day but is the same for the same (user, date). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = <T,>(list: readonly T[], seed: string, salt: string): T => list[hashSeed(`${salt}|${seed}`) % list.length];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

type DeadlineCtx = { school: string; when: string; date: string; pace: string; left: number };
type ResultCtx = { school: string; when: 'today' | 'tomorrow' };
type NudgeCtx = { school: string | null; progress: string | null };
type CelebrationCtx = { school: string; done: string; headline: string };
type Variants<C> = { subjects: readonly ((c: C) => string)[]; openings: readonly ((c: C) => string)[] };

const WHEN: Record<number, string> = { 7: 'a week', 3: 'three days', 1: 'one day' };
const PACE: Record<number, string> = { 7: 'That is plenty of room to do this well.', 3: 'That is enough for a steady finish.', 1: 'One focused session will do it.' };

export const TEMPLATES: { deadline_week: Variants<DeadlineCtx>; result_soon: Variants<ResultCtx>; nudge: Variants<NudgeCtx>; nudge_final: Variants<NudgeCtx>; celebration: Variants<CelebrationCtx> } = {
  deadline_week: {
    subjects: [
      (c) => `${c.school}: ${c.when} to go, and a short list`,
      (c) => `Your ${c.school} deadline is in ${c.when}. Here is what is left`,
      (c) => `${cap(c.when)} until ${c.school}: your short list`,
      (c) => `A calm look at ${c.school}, due in ${c.when}`,
      (c) => `${c.school} in ${c.when}. ${c.left ? `${cap(items(c.left))} to go` : 'Everything is ready'}`,
    ],
    openings: [
      (c) => `You have ${c.when} until your ${c.school} deadline on ${c.date}. ${c.pace}`,
      (c) => `Your ${c.school} application is due in ${c.when}, on ${c.date}. ${c.pace}`,
      (c) => `A quick, calm check-in: ${c.school} is due on ${c.date}, ${c.when} from now. ${c.pace}`,
      (c) => `${c.date} is the ${c.school} deadline, which gives you ${c.when}. ${c.pace}`,
      (c) => `Just so it is on your radar: ${c.when} to go for ${c.school} (${c.date}). ${c.pace}`,
    ],
  },
  result_soon: {
    subjects: [
      (c) => `Whatever ${c.school} says ${c.when}, you did the work`,
      (c) => `${c.school} results are expected ${c.when}. We are cheering for you`,
      (c) => `Thinking of you: ${c.school} may share results ${c.when}`,
      (c) => `A note before your ${c.school} result ${c.when}`,
      (c) => `${cap(c.when)} could be ${c.school} day. Be kind to yourself`,
    ],
    openings: [
      (c) => `${c.school} is expected to share its decision ${c.when}. A small note before it arrives: we are in your corner.`,
      (c) => `Your ${c.school} result is expected ${c.when}. You put real effort into this application, and nothing in the result changes that.`,
      (c) => `A small note of support: ${c.school} may send its decision ${c.when}. You showed up and finished something hard.`,
      (c) => `${cap(c.when)} is the day ${c.school} expects to share results. However it goes, you gave this a proper try, and we are proud of that.`,
      (c) => `The ${c.school} decision is expected ${c.when}. Whatever the outcome, the stories you wrote and the work you did go with you to every next step.`,
    ],
  },
  nudge: {
    subjects: [
      (c) => (c.school ? `Two minutes for ${c.school}?` : 'Two minutes for your plan?'),
      (c) => (c.progress && c.school ? `${cap(c.progress)} for ${c.school}. One tiny step next?` : 'One tiny step, whenever you are ready'),
      () => 'A 2 minute step, whenever you are ready',
      (c) => (c.progress ? `Picking up where you left off: ${c.progress}` : 'Picking up where you left off'),
      (c) => (c.school ? `One small thing for ${c.school}` : 'One small thing for your plan'),
      () => 'Your list is waiting patiently',
    ],
    openings: [
      (c) => (c.progress && c.school ? `No pressure at all. You already have ${c.progress} for ${c.school}, and that is real progress.` : 'No pressure at all. Getting started is the hardest part, and you have already done that.'),
      (c) => (c.progress && c.school ? `It has been a few days, which is completely fine. Your ${c.school} checklist is at ${c.progress}, just as you left it.` : 'It has been a few days, which is completely fine. Everything is just as you left it.'),
      (c) => (c.progress && c.school ? `A friendly hello. So far you have ${c.progress} for ${c.school}. That work is done and it stays done.` : 'A friendly hello. Your plan is saved and ready whenever you are.'),
      (c) => (c.progress && c.school ? `Life gets busy, we know. The good news: ${c.progress} for ${c.school} already.` : 'Life gets busy, we know. The good news: your plan keeps your place for you.'),
      (c) => (c.progress && c.school ? `Checking in, gently. You are at ${c.progress} for ${c.school}, which is further along than it may feel.` : 'Checking in, gently. You are further along than it may feel.'),
    ],
  },
  nudge_final: {
    subjects: [
      () => 'We will be here when you are ready',
      () => 'Taking a break is fine. Your plan is saved',
      () => 'Pausing our check-ins for now',
      () => 'No more check-ins from us until you are back',
    ],
    openings: [
      (c) => `It has been about three weeks, so we will stop checking in. Nothing is lost: ${c.progress && c.school ? `your ${c.school} checklist (${c.progress}) is saved just as you left it.` : 'everything is saved just as you left it.'}`,
      (c) => `Sometimes plans need a pause, and that is okay. We will stop sending check-ins now. ${c.progress && c.school ? `Your ${c.progress} for ${c.school} will be waiting.` : 'Your plan will be waiting.'}`,
      (c) => `This is a quiet note to say we will stop writing for now. ${c.progress && c.school ? `You got to ${c.progress} for ${c.school}, and that work is safe.` : 'Everything you set up is safe.'}`,
      (c) => `We do not want to crowd your inbox, so this is our last check-in for now. ${c.progress && c.school ? `Your ${c.school} checklist stays at ${c.progress} until you return.` : 'Your plan stays exactly as it is until you return.'}`,
    ],
  },
  celebration: {
    subjects: [
      (c) => `Nice work: ${c.headline}`,
      (c) => `${cap(c.headline)}. That counts`,
      (c) => `A small cheer: ${c.headline}`,
      (c) => `Worth a pause: ${c.headline}`,
      (c) => `Look at that: ${c.headline}`,
    ],
    openings: [
      (c) => `Yesterday you ${c.done}. That deserves a moment.`,
      (c) => `Quick note to say well done. Yesterday you ${c.done}.`,
      (c) => `We noticed something good: yesterday you ${c.done}.`,
      (c) => `A little celebration is in order. Yesterday you ${c.done}.`,
      (c) => `This one is just good news. Yesterday you ${c.done}.`,
    ],
  },
};

const MILESTONE_COPY: Record<Milestone, { headline: (s: string) => string; done: (s: string, p: string) => string; next: string; button: string }> = {
  first_item: { headline: () => 'your first item is done', done: (s) => `finished your first item for ${s}`, next: 'The first one is the hardest to start, and it is behind you now.', button: 'See my progress' },
  half_way: { headline: (s) => `you are half way for ${s}`, done: (s, p) => `reached the half way mark for ${s} (${p})`, next: 'The second half tends to go faster, because you know the routine now.', button: 'See my progress' },
  all_ready: { headline: (s) => `everything for ${s} is ready`, done: (s) => `got every item ready for ${s}`, next: 'All that is left is to submit, whenever you feel ready.', button: 'Open my application' },
  submitted: { headline: (s) => `${s} is submitted`, done: (s) => `submitted your ${s} application`, next: 'That took real work. Take the evening off, you earned it.', button: 'See my application' },
};

type Parts = { subject: string; preheader: string; opening: string; lead?: string; list?: string[]; listNote?: string; highlight?: string; button: { label: string; href: string }; after: string[] };
const progressText = (a: FactApp | null, ready = a?.ready ?? 0) => (a && a.total > 0 ? `${ready} of ${a.total} ready` : null);
export const MAX_LISTED = 4;

function partsFor(d: Exclude<Decision, { kind: null }>, seed: string): Parts {
  const sub = <C,>(v: Variants<C>, c: C) => ({ subject: pick(v.subjects, seed, 'subject')(c), opening: pick(v.openings, seed, 'opening')(c) });
  switch (d.kind) {
    case 'deadline_week': {
      const a = d.app, left = a.remaining.length;
      const c: DeadlineCtx = { school: a.label, when: WHEN[d.daysLeft], date: longDate(a.deadlineOn!), pace: PACE[d.daysLeft], left };
      const more = left - MAX_LISTED;
      return {
        ...sub(TEMPLATES.deadline_week, c),
        preheader: left ? `${cap(items(left))} left, and ${c.when} to do it.` : 'Everything on your checklist is ready.',
        lead: left ? 'Here is the short list:' : 'Every item on your checklist is ready. The only step left is to submit.',
        list: left ? a.remaining.slice(0, MAX_LISTED).map((r) => r.name) : undefined,
        listNote: more > 0 ? `and ${more} more on your checklist` : undefined,
        button: { label: left ? 'Open my checklist' : 'Open my application', href: appHref(a.id) },
        after: [...(left && a.ready > 0 ? [`You already have ${progressText(a)}.`] : []), left ? 'One item at a time is plenty.' : 'Nicely done getting here.'],
      };
    }
    case 'result_soon': {
      const c: ResultCtx = { school: d.app.label, when: d.when };
      return {
        ...sub(TEMPLATES.result_soon, c),
        preheader: 'Whatever it says, you did the work.',
        button: { label: 'Open my application', href: appHref(d.app.id) },
        after: ['Dates like this sometimes move by a day or two, so a quiet inbox means nothing yet.', 'When you hear back, you can record it in your application, and we will help with the next step either way.', 'Whatever it says, you did the work, and that stays yours.'],
      };
    }
    case 'nudge': {
      const c: NudgeCtx = { school: d.app?.label ?? null, progress: progressText(d.app) };
      if (d.final) return {
        ...sub(TEMPLATES.nudge_final, c),
        preheader: 'Your plan is saved. Come back any time.',
        button: { label: `Open ${PRODUCT_NAME}`, href: d.app ? appHref(d.app.id) : '/' },
        after: ['This is our last email until you come back. Whenever you are ready, we will be here.'],
      };
      return {
        ...sub(TEMPLATES.nudge, c),
        preheader: 'One tiny step, about 2 minutes.',
        lead: 'If you have 2 minutes, here is one tiny step:',
        highlight: d.step.text,
        button: { label: 'Do this one step', href: d.step.href },
        after: ['That is all. Small steps add up, and there is no wrong day to take one.'],
      };
    }
    case 'celebration': {
      const m = MILESTONE_COPY[d.milestone], p = progressText(d.app, d.ready) ?? '';
      const c: CelebrationCtx = { school: d.app.label, headline: m.headline(d.app.label), done: m.done(d.app.label, p) };
      return { ...sub(TEMPLATES.celebration, c), preheader: m.next, button: { label: m.button, href: appHref(d.app.id) }, after: [m.next, 'Well done!'] };
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

/** Builds the email for a decision. Returns null when the decision is to send nothing. */
export function composeReminder(d: Decision, f: Pick<ReminderFacts, 'name' | 'userId' | 'today'>, o: ComposeOptions): ReminderEmail | null {
  if (d.kind === null) return null;
  const x = partsFor(d, o.seed ?? `${f.userId}:${f.today}`);
  const hi = f.name ? `Hi ${f.name},` : 'Hi there,';
  const url = join(o.appUrl, x.button.href);
  const settingsUrl = join(o.appUrl, '/settings');
  const footer = d.kind === 'nudge' && d.final ? `You get this because email reminders are on in ${PRODUCT_NAME}. We will not write again until you are back.` : `You get this because email reminders are on in ${PRODUCT_NAME}.`;

  const text = [
    hi, '', x.opening,
    ...(x.lead ? ['', x.lead] : []),
    ...(x.list ? ['', ...x.list.map((i) => `- ${i}`), ...(x.listNote ? [`  (${x.listNote})`] : [])] : []),
    ...(x.highlight ? ['', `> ${x.highlight}`] : []),
    '', `${x.button.label}: ${url}`,
    ...x.after.flatMap((l) => ['', l]),
    '', PRODUCT_NAME, '',
    '--',
    footer,
    `Change the time or turn these off: ${settingsUrl}`,
    `Unsubscribe in one click: ${o.unsubscribeUrl}`,
  ].join('\n');

  const p = 'margin:0 0 14px;font-size:16px;line-height:1.5;color:#3c3c3c;';
  const box = 'border:2px solid #e5e5e5;border-bottom-width:4px;border-radius:14px;padding:14px 16px;margin:0 0 16px;';
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${esc(x.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(x.preheader)}</div>
<div style="max-width:480px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border:2px solid #e5e5e5;border-radius:16px;padding:24px 20px;">
<p style="${p}">${esc(hi)}</p>
<p style="${p}">${esc(x.opening)}</p>
${x.lead ? `<p style="${p}">${esc(x.lead)}</p>` : ''}
${x.list ? `<div style="${box}"><ul style="margin:0;padding-left:20px;font-size:16px;line-height:1.7;color:#3c3c3c;">${x.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>${x.listNote ? `<p style="margin:6px 0 0;font-size:14px;color:#777777;">${esc(x.listNote)}</p>` : ''}</div>` : ''}
${x.highlight ? `<div style="${box}"><p style="margin:0;font-size:17px;font-weight:700;line-height:1.4;color:#3c3c3c;">${esc(x.highlight)}</p></div>` : ''}
<p style="margin:0 0 18px;"><a href="${esc(url)}" style="display:inline-block;background:#58cc02;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 22px;border-radius:12px;border-bottom:4px solid #58a700;">${esc(x.button.label)}</a></p>
${x.after.map((l) => `<p style="${p}">${esc(l)}</p>`).join('\n')}
<p style="margin:0;font-size:14px;font-weight:700;color:#777777;">${esc(PRODUCT_NAME)}</p>
</div>
<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#999999;text-align:center;">
${esc(footer)} <a href="${esc(settingsUrl)}" style="color:#999999;">Change the time or turn these off</a>, or <a href="${esc(o.unsubscribeUrl)}" style="color:#999999;">unsubscribe in one click</a>.
</p>
</div></body></html>`;
  return { kind: d.kind, subject: x.subject, preheader: x.preheader, text, html };
}
