// Pure gamification logic. Every number here is derived from real xp_events rows (written only by database triggers on
// real records, see supabase/migrations/018_gamification.sql). Nothing in this file creates XP.
import { z } from 'zod';

export type XpEvent = { kind: string; points: number; occurred_at: string };

/** Keep in sync with the comment block in 018_gamification.sql. dailyCap is enforced by the database. */
export const XP_TABLE = [
  { kind: 'requirement_complete', label: 'Complete a requirement', points: 10, note: '+15 when mandatory', dailyCap: 20 },
  { kind: 'task_done', label: 'Finish a task', points: 10, dailyCap: 20 },
  { kind: 'essay_first_version', label: 'Save the first draft of an essay', points: 10, dailyCap: 5 },
  { kind: 'essay_version', label: 'Save a new essay draft', points: 3, dailyCap: 10 },
  { kind: 'essay_approved', label: 'Approve an essay', points: 20 },
  { kind: 'story_created', label: 'Add a story to your story bank', points: 10, dailyCap: 10 },
  { kind: 'sourced_data_point', label: 'Add a school data point with a source', points: 5, dailyCap: 20 },
  { kind: 'profile_education', label: 'Add an education record', points: 5, dailyCap: 10 },
  { kind: 'profile_work', label: 'Add a work experience', points: 5, dailyCap: 10 },
  { kind: 'profile_leadership', label: 'Add a leadership experience', points: 5, dailyCap: 10 },
  { kind: 'profile_achievement', label: 'Add an achievement', points: 5, dailyCap: 10 },
  { kind: 'profile_test', label: 'Add a test score', points: 5, dailyCap: 10 },
  { kind: 'career_goals_filled', label: 'Fill in your career goals', points: 15 },
  { kind: 'recommender_added', label: 'Add a recommender', points: 5, dailyCap: 10 },
  { kind: 'recommendation_submitted', label: 'A recommendation is submitted', points: 25 },
  { kind: 'application_submitted', label: 'Submit an application', points: 100 },
  { kind: 'interview_completed', label: 'Complete an interview session', points: 20 },
  { kind: 'interview_feedback', label: 'Record interview feedback', points: 5, dailyCap: 10 },
  { kind: 'scholarship_applied', label: 'Apply for a scholarship', points: 30 },
  { kind: 'expense_paid', label: 'Mark an expense as paid', points: 5, dailyCap: 10 },
  { kind: 'ai_rec_completed', label: 'Complete a recommended action', points: 10, dailyCap: 10 },
  { kind: 'decision_admitted', label: 'Record an admission', points: 200 },
  { kind: 'document_version', label: 'Upload a document version', points: 5, dailyCap: 10 },
] as const;
export const KIND_LABEL: Record<string, string> = Object.fromEntries(XP_TABLE.map((x) => [x.kind, x.label]));

const ESSAY_KINDS = ['essay_first_version', 'essay_version'];
const PROFILE_KINDS = ['profile_education', 'profile_work', 'profile_leadership', 'profile_achievement', 'profile_test'];

// ---------------------------------------------------------------------------------------------------------------
// Levels. Going from level n to level n+1 costs 50*n XP, so the XP needed to REACH level L is 25*L*(L-1):
// L1 = 0, L2 = 50, L3 = 150, L4 = 300, L5 = 500, L8 = 1400, L10 = 2250, L15 = 5250. A full application season
// (a few schools, essays, recommenders, submissions) lands somewhere around level 8 to 12.
export const xpToReach = (level: number) => 25 * level * (level - 1);
export function levelFromXp(xp: number): number {
  const x = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let l = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * x) / 25)) / 2));
  while (xpToReach(l + 1) <= x) l++;
  while (l > 1 && xpToReach(l) > x) l--;
  return l;
}
export type LevelProgress = { level: number; xp: number; levelStart: number; nextLevelAt: number; intoLevel: number; neededForNext: number; remaining: number; pct: number };
export function levelProgress(xp: number): LevelProgress {
  const x = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = levelFromXp(x), levelStart = xpToReach(level), nextLevelAt = xpToReach(level + 1);
  const neededForNext = nextLevelAt - levelStart, intoLevel = x - levelStart;
  return { level, xp: x, levelStart, nextLevelAt, intoLevel, neededForNext, remaining: nextLevelAt - x, pct: Math.min(100, Math.round((intoLevel / neededForNext) * 100)) };
}
export const totalXp = (events: XpEvent[]) => events.reduce((s, e) => s + (e.points > 0 ? e.points : 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// Days and streaks. A "day" is a calendar day in the given IANA timezone. Day keys are YYYY-MM-DD; all day arithmetic
// is done on UTC midnights of those keys, so daylight saving changes (23 or 25 hour days) cannot break consecutiveness.
export const DEFAULT_TZ = 'UTC';
export function safeTz(tz?: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_TZ; }
}
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function dayKey(d: Date | string | number, tz: string = DEFAULT_TZ): string {
  const z_ = safeTz(tz);
  let f = fmtCache.get(z_);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: z_, year: 'numeric', month: '2-digit', day: '2-digit' }); fmtCache.set(z_, f); }
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const keyToUtcDay = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const utcDayToKey = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDays = (k: string, n: number) => utcDayToKey(keyToUtcDay(k) + n);
/** Monday of the week that contains the day key. */
export const weekStartKey = (k: string) => { const dow = (new Date(keyToUtcDay(k) * 86_400_000).getUTCDay() + 6) % 7; return addDays(k, -dow); };

export type Streak = { current: number; longest: number; todayCounts: boolean; atRisk: boolean; lastActiveDay: string | null; activeDays: number };
/** Streak from event timestamps. A day counts when at least one real XP event happened on it. */
export function computeStreak(eventTimes: string[], now: Date, tz: string = DEFAULT_TZ): Streak {
  const days = [...new Set(eventTimes.map((t) => dayKey(t, tz)).filter(Boolean))].sort();
  return streakFromDays(days, dayKey(now, tz));
}
export function streakFromDays(sortedDays: string[], today: string): Streak {
  const set = new Set(sortedDays);
  let longest = 0, run = 0, prev: number | null = null;
  for (const d of sortedDays) { const n = keyToUtcDay(d); run = prev !== null && n === prev + 1 ? run + 1 : 1; prev = n; if (run > longest) longest = run; }
  const todayCounts = set.has(today), yesterday = addDays(today, -1);
  const anchor = todayCounts ? today : set.has(yesterday) ? yesterday : null;
  let current = 0;
  if (anchor) for (let k = anchor; set.has(k); k = addDays(k, -1)) current++;
  return { current, longest, todayCounts, atRisk: !todayCounts && current > 0, lastActiveDay: sortedDays.length ? sortedDays[sortedDays.length - 1] : null, activeDays: sortedDays.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Settings stored in applicant_profiles.settings.gamification
export const DAILY_GOAL_DEFAULT = 30, DAILY_GOAL_MIN = 10, DAILY_GOAL_MAX = 200;
export const dailyGoalSchema = z.coerce.number({ error: 'Enter a number' }).int('Use a whole number').min(DAILY_GOAL_MIN, `At least ${DAILY_GOAL_MIN} XP`).max(DAILY_GOAL_MAX, `At most ${DAILY_GOAL_MAX} XP`);
export type GamificationSettings = { dailyGoalXp: number; lastSeenXp: number; lastSeenLevel: number; lastSeenBadges: string[] };
/** Defensive read of settings.gamification (or the whole settings object). */
export function parseGamificationSettings(raw: unknown): GamificationSettings {
  const g = (raw && typeof raw === 'object' ? ((raw as Record<string, unknown>).gamification ?? {}) : {}) as Record<string, unknown>;
  const goal = dailyGoalSchema.safeParse(g.daily_goal_xp);
  const nn = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    dailyGoalXp: goal.success && typeof g.daily_goal_xp === 'number' ? goal.data : DAILY_GOAL_DEFAULT,
    lastSeenXp: nn(g.last_seen_xp),
    lastSeenLevel: Math.max(1, nn(g.last_seen_level)),
    lastSeenBadges: Array.isArray(g.last_seen_badges) ? g.last_seen_badges.filter((x): x is string => typeof x === 'string').slice(0, 100) : [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Quests. Progress is computed from today's / this week's real xp_events. Completing a quest gives no bonus XP.
// A quest is only shown if the user has real open items that can complete it; otherwise a suggestion is returned.
export type QuestContext = { openRequirements: number; openTasks: number; essaysInProgress: number; activeApplications: number };
export type Quest = { id: string; scope: 'daily' | 'weekly'; title: string; description: string; progress: number; target: number; done: boolean; unit: 'xp' | 'count'; href: string };
export type Suggestion = { id: string; text: string; href: string; cta: string };
export type QuestBoard = { daily: Quest[]; weekly: Quest[]; suggestions: Suggestion[]; todayXp: number; weekXp: number };

const sumPoints = (evs: XpEvent[]) => evs.reduce((s, e) => s + e.points, 0);
const countKinds = (evs: XpEvent[], kinds: string[]) => evs.filter((e) => kinds.includes(e.kind)).length;
const quest = (q: Omit<Quest, 'done'>): Quest => ({ ...q, progress: Math.min(q.progress, q.target), done: q.progress >= q.target });

export function buildQuests(events: XpEvent[], ctx: QuestContext, now: Date, tz: string, dailyGoalXp: number = DAILY_GOAL_DEFAULT): QuestBoard {
  const today = dayKey(now, tz), weekStart = weekStartKey(today);
  const todays = events.filter((e) => dayKey(e.occurred_at, tz) === today);
  const week = events.filter((e) => { const k = dayKey(e.occurred_at, tz); return k >= weekStart && k <= today; });
  const goal = Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(dailyGoalXp)));
  const suggestions: Suggestion[] = [];
  const daily: Quest[] = [quest({ id: 'daily-xp', scope: 'daily', title: `Earn ${goal} XP today`, description: 'Any real progress counts. Edits and toggles do not.', progress: sumPoints(todays), target: goal, unit: 'xp', href: '/journey' })];

  const reqDone = countKinds(todays, ['requirement_complete']);
  const reqTarget = Math.min(2, ctx.openRequirements + reqDone);
  if (reqTarget > 0) daily.push(quest({ id: 'daily-req', scope: 'daily', title: `Complete ${reqTarget} requirement${reqTarget > 1 ? 's' : ''}`, description: 'Tick off items on an application checklist.', progress: reqDone, target: reqTarget, unit: 'count', href: '/applications' }));
  else suggestions.push({ id: 'sug-app', text: ctx.activeApplications === 0 ? 'Add an application to get a requirements checklist you can work through.' : 'All your requirements are done. Add another application or round to keep going.', href: '/applications', cta: 'Open applications' });

  const essayDone = countKinds(todays, ESSAY_KINDS);
  if (ctx.essaysInProgress > 0 || essayDone > 0) daily.push(quest({ id: 'daily-essay', scope: 'daily', title: 'Save an essay draft', description: 'Write a few lines and save a new version.', progress: essayDone, target: 1, unit: 'count', href: '/essays' }));
  else suggestions.push({ id: 'sug-essay', text: 'Start an essay to unlock the daily writing quest.', href: '/essays', cta: 'Open essays' });

  const taskDone = countKinds(todays, ['task_done']);
  if (ctx.openTasks > 0 || taskDone > 0) daily.push(quest({ id: 'daily-task', scope: 'daily', title: 'Finish a task', description: 'Close one open task on your list.', progress: taskDone, target: 1, unit: 'count', href: '/applications' }));

  const weekly: Quest[] = [quest({ id: 'weekly-xp', scope: 'weekly', title: `Earn ${goal * 5} XP this week`, description: `Five days at your daily goal of ${goal} XP.`, progress: sumPoints(week), target: goal * 5, unit: 'xp', href: '/journey' })];
  const steps = countKinds(week, ['requirement_complete', 'task_done', 'application_submitted']);
  if (ctx.activeApplications > 0 || steps > 0) weekly.push(quest({ id: 'weekly-steps', scope: 'weekly', title: 'Move your applications forward 5 times', description: 'Requirements, tasks and submissions all count.', progress: steps, target: 5, unit: 'count', href: '/applications' }));
  else suggestions.push({ id: 'sug-weekly', text: 'Create an application to unlock the weekly progress quest.', href: '/applications', cta: 'Open applications' });
  return { daily, weekly, suggestions, todayXp: sumPoints(todays), weekXp: sumPoints(week) };
}

export type WeeklySummary = { days: { date: string; label: string; xp: number; isToday: boolean }[]; totalXp: number; activeDays: number; top: { kind: string; label: string; count: number; xp: number }[] };
/** XP per day for the current Monday to Sunday week plus the kinds that earned most. */
export function weeklySummary(events: XpEvent[], now: Date, tz: string): WeeklySummary {
  const today = dayKey(now, tz), start = weekStartKey(today), names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = names.map((label, i) => ({ date: addDays(start, i), label, xp: 0, isToday: addDays(start, i) === today }));
  const byKind = new Map<string, { count: number; xp: number }>();
  for (const e of events) {
    const k = dayKey(e.occurred_at, tz), d = days.find((x) => x.date === k);
    if (!d) continue;
    d.xp += e.points; const t = byKind.get(e.kind) ?? { count: 0, xp: 0 }; t.count++; t.xp += e.points; byKind.set(e.kind, t);
  }
  const top = [...byKind.entries()].map(([kind, v]) => ({ kind, label: KIND_LABEL[kind] ?? kind, ...v })).sort((a, b) => b.xp - a.xp || a.kind.localeCompare(b.kind)).slice(0, 3);
  return { days, totalXp: days.reduce((s, d) => s + d.xp, 0), activeDays: days.filter((d) => d.xp > 0).length, top };
}

// ---------------------------------------------------------------------------------------------------------------
// Badges. Derived from events only. unlocked_at is the time of the event that completed the requirement.
export type BadgeColor = 'green' | 'blue' | 'orange' | 'pink' | 'yellow' | 'purple';
export type Badge = { id: string; title: string; description: string; color: BadgeColor; icon: string; target: number; current: number; unlocked: boolean; unlockedAt: string | null; hint: string };
type BadgeDef = { id: string; title: string; description: string; color: BadgeColor; icon: string; target: number; hint: string; measure: (c: BadgeCtx) => number; unlockedAt: (c: BadgeCtx) => string | null };
type BadgeCtx = { sorted: XpEvent[]; streak: Streak; dayFirst: Map<string, string>; days: string[] };

const nth = (c: BadgeCtx, kinds: string[], n: number) => { const m = c.sorted.filter((e) => kinds.includes(e.kind)); return m.length >= n ? m[n - 1].occurred_at : null; };
const cnt = (c: BadgeCtx, kinds: string[]) => c.sorted.filter((e) => kinds.includes(e.kind)).length;
const firstOf = (c: BadgeCtx, kind: string) => nth(c, [kind], 1);
/** ISO time of the first event on the day a streak of length n was first reached. */
function streakReached(c: BadgeCtx, n: number): string | null {
  let run = 0, prev: number | null = null;
  for (const d of c.days) { const x = keyToUtcDay(d); run = prev !== null && x === prev + 1 ? run + 1 : 1; prev = x; if (run >= n) return c.dayFirst.get(d) ?? null; }
  return null;
}
const maxTime = (ts: (string | null)[]) => (ts.some((t) => !t) ? null : ts.map((t) => t as string).sort().at(-1) ?? null);
const profileCore = (c: BadgeCtx) => (['profile_education', 'profile_work', 'career_goals_filled'] as const).filter((k) => firstOf(c, k)).length;

const BADGES: BadgeDef[] = [
  { id: 'first-step', title: 'First Step', description: 'Earned your first XP.', color: 'green', icon: 'Footprints', target: 1, hint: 'Complete any real step, like adding an education record.', measure: (c) => Math.min(1, c.sorted.length), unlockedAt: (c) => c.sorted[0]?.occurred_at ?? null },
  { id: 'profile-pro', title: 'Profile Pro', description: 'Added education and work experience and filled in your career goals.', color: 'blue', icon: 'UserCheck', target: 3, hint: 'Add an education record, a work experience and complete your career goals.', measure: profileCore, unlockedAt: (c) => (profileCore(c) === 3 ? maxTime([firstOf(c, 'profile_education'), firstOf(c, 'profile_work'), firstOf(c, 'career_goals_filled')]) : null) },
  { id: 'source-hunter', title: 'Source Hunter', description: 'Saved 10 school data points with sources.', color: 'orange', icon: 'Search', target: 10, hint: 'Add school facts together with where you found them.', measure: (c) => cnt(c, ['sourced_data_point']), unlockedAt: (c) => nth(c, ['sourced_data_point'], 10) },
  { id: 'wordsmith', title: 'Wordsmith', description: 'Saved 10 essay versions.', color: 'pink', icon: 'PenLine', target: 10, hint: 'Each saved draft of an essay counts (up to 10 a day).', measure: (c) => cnt(c, ESSAY_KINDS), unlockedAt: (c) => nth(c, ESSAY_KINDS, 10) },
  { id: 'streak-3', title: '3 Day Streak', description: 'Made real progress 3 days in a row.', color: 'yellow', icon: 'Flame', target: 3, hint: 'Do one real thing each day for 3 days.', measure: (c) => c.streak.longest, unlockedAt: (c) => streakReached(c, 3) },
  { id: 'streak-7', title: '7 Day Streak', description: 'Made real progress 7 days in a row.', color: 'orange', icon: 'Flame', target: 7, hint: 'Keep going for a full week.', measure: (c) => c.streak.longest, unlockedAt: (c) => streakReached(c, 7) },
  { id: 'streak-30', title: '30 Day Streak', description: 'Made real progress 30 days in a row.', color: 'pink', icon: 'Flame', target: 30, hint: 'A month of steady steps.', measure: (c) => c.streak.longest, unlockedAt: (c) => streakReached(c, 30) },
  { id: 'back-up-crew', title: 'Back-up Crew', description: 'A recommender submitted a recommendation.', color: 'purple', icon: 'Users', target: 1, hint: 'Mark a recommendation as submitted once it really is.', measure: (c) => Math.min(1, cnt(c, ['recommendation_submitted'])), unlockedAt: (c) => firstOf(c, 'recommendation_submitted') },
  { id: 'submitted', title: 'Submitted!', description: 'Submitted an application.', color: 'green', icon: 'Send', target: 1, hint: 'Confirm and submit your first application.', measure: (c) => Math.min(1, cnt(c, ['application_submitted'])), unlockedAt: (c) => firstOf(c, 'application_submitted') },
  { id: 'interview-ready', title: 'Interview Ready', description: 'Completed an interview session.', color: 'blue', icon: 'Mic', target: 1, hint: 'Finish a mock interview session.', measure: (c) => Math.min(1, cnt(c, ['interview_completed'])), unlockedAt: (c) => firstOf(c, 'interview_completed') },
  { id: 'funding-push', title: 'Funding Push', description: 'Applied for a scholarship.', color: 'yellow', icon: 'Award', target: 1, hint: 'Mark a scholarship as applied once you have applied.', measure: (c) => Math.min(1, cnt(c, ['scholarship_applied'])), unlockedAt: (c) => firstOf(c, 'scholarship_applied') },
  { id: 'admitted', title: 'Admitted', description: 'Recorded an admission.', color: 'purple', icon: 'PartyPopper', target: 1, hint: 'Shown only when you record an admitted decision.', measure: (c) => Math.min(1, cnt(c, ['decision_admitted'])), unlockedAt: (c) => firstOf(c, 'decision_admitted') },
];
export const BADGE_IDS = BADGES.map((b) => b.id);

export function computeBadges(events: XpEvent[], now: Date, tz: string): Badge[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const dayFirst = new Map<string, string>();
  for (const e of sorted) { const k = dayKey(e.occurred_at, tz); if (k && !dayFirst.has(k)) dayFirst.set(k, e.occurred_at); }
  const days = [...dayFirst.keys()].sort();
  const ctx: BadgeCtx = { sorted, streak: streakFromDays(days, dayKey(now, tz)), dayFirst, days };
  return BADGES.map((b) => {
    const current = Math.min(b.measure(ctx), b.target), at = current >= b.target ? b.unlockedAt(ctx) : null;
    return { id: b.id, title: b.title, description: b.description, color: b.color, icon: b.icon, target: b.target, current, unlocked: current >= b.target && at !== null, unlockedAt: at, hint: b.hint };
  });
}
/** Up to n locked badges, closest to unlocking first. */
export function nextBadges(badges: Badge[], n = 3): Badge[] {
  return badges.filter((b) => !b.unlocked).sort((a, b) => b.current / b.target - a.current / a.target || a.target - b.target).slice(0, n);
}

// ---------------------------------------------------------------------------------------------------------------
// Celebration. Decides what to celebrate by comparing the persisted "last seen" values with the real current state.
export type Celebration = { gainedXp: number; levelUp: boolean; newLevel: number; newBadges: string[]; intensity: 'none' | 'small' | 'big' };
export function detectCelebration(prev: { xp: number; level: number; badges: string[] }, cur: { xp: number; level: number; badges: string[] }): Celebration {
  const gainedXp = Math.max(0, cur.xp - prev.xp), levelUp = cur.level > prev.level, newBadges = cur.badges.filter((b) => !prev.badges.includes(b));
  return { gainedXp, levelUp, newLevel: cur.level, newBadges, intensity: levelUp || newBadges.length ? 'big' : gainedXp > 0 ? 'small' : 'none' };
}
