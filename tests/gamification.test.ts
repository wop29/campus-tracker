import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelFromXp, levelProgress, xpToReach, totalXp, dayKey, addDays, weekStartKey, computeStreak, streakFromDays, safeTz,
  buildQuests, weeklySummary, computeBadges, nextBadges, detectCelebration, parseGamificationSettings, XP_TABLE, DAILY_GOAL_DEFAULT, type XpEvent,
} from '../lib/gamification.ts';
import { computeJourney, EMPTY_JOURNEY_DATA, UNITS, type JourneyData } from '../lib/journey.ts';

const ev = (kind: string, iso: string, points = 10): XpEvent => ({ kind, points, occurred_at: iso });
const NOW = new Date('2026-11-16T15:00:00Z'); // a Monday

test('levels: documented curve and boundaries', () => {
  assert.equal(xpToReach(1), 0); assert.equal(xpToReach(2), 50); assert.equal(xpToReach(3), 150); assert.equal(xpToReach(10), 2250);
  assert.equal(levelFromXp(0), 1); assert.equal(levelFromXp(49), 1); assert.equal(levelFromXp(50), 2); assert.equal(levelFromXp(149), 2); assert.equal(levelFromXp(150), 3);
  assert.equal(levelFromXp(2249), 9); assert.equal(levelFromXp(2250), 10);
  for (let x = 0; x < 20000; x += 7) { const l = levelFromXp(x); assert.ok(xpToReach(l) <= x && x < xpToReach(l + 1), `xp ${x}`); }
});
test('levels: bad input is level 1 and progress is sane', () => {
  assert.equal(levelFromXp(-5), 1); assert.equal(levelFromXp(NaN), 1); assert.equal(levelFromXp(Infinity), 1);
  const p = levelProgress(75); assert.deepEqual([p.level, p.intoLevel, p.neededForNext, p.remaining, p.pct], [2, 25, 100, 75, 25]);
  const z = levelProgress(0); assert.deepEqual([z.level, z.pct, z.remaining], [1, 0, 50]);
  assert.equal(totalXp([]), 0); assert.equal(totalXp([ev('a', '2026-01-01T00:00:00Z', 5), ev('b', '2026-01-01T00:00:00Z', 7)]), 12);
});
test('dayKey respects the timezone and invalid zones fall back to UTC', () => {
  assert.equal(dayKey('2026-11-16T03:30:00Z', 'America/New_York'), '2026-11-15');
  assert.equal(dayKey('2026-11-16T03:30:00Z', 'Asia/Jakarta'), '2026-11-16');
  assert.equal(dayKey('2026-11-16T03:30:00Z', 'Not/AZone'), '2026-11-16'); assert.equal(safeTz('Not/AZone'), 'UTC'); assert.equal(dayKey('garbage', 'UTC'), '');
});
test('week starts on Monday and day math crosses months and years', () => {
  assert.equal(weekStartKey('2026-11-16'), '2026-11-16'); assert.equal(weekStartKey('2026-11-22'), '2026-11-16'); assert.equal(weekStartKey('2026-11-15'), '2026-11-09');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
test('streak: empty input', () => {
  const s = computeStreak([], NOW, 'UTC'); assert.deepEqual([s.current, s.longest, s.todayCounts, s.atRisk, s.lastActiveDay], [0, 0, false, false, null]);
});
test('streak: today counts, consecutive days, longest vs current', () => {
  const times = ['2026-11-16T10:00:00Z', '2026-11-15T10:00:00Z', '2026-11-14T10:00:00Z', '2026-11-10T10:00:00Z', '2026-11-09T10:00:00Z', '2026-11-08T10:00:00Z', '2026-11-07T10:00:00Z'];
  const s = computeStreak(times, NOW, 'UTC'); assert.deepEqual([s.current, s.longest, s.todayCounts, s.atRisk], [3, 4, true, false]);
});
test('streak: at risk when yesterday had activity but today has none; broken after a gap', () => {
  const s = computeStreak(['2026-11-15T10:00:00Z', '2026-11-14T10:00:00Z'], NOW, 'UTC'); assert.deepEqual([s.current, s.todayCounts, s.atRisk], [2, false, true]);
  const g = computeStreak(['2026-11-13T10:00:00Z', '2026-11-14T10:00:00Z'], NOW, 'UTC'); assert.deepEqual([g.current, g.longest, g.atRisk], [0, 2, false]);
});
test('streak: many events on one day count as one day', () => {
  const s = computeStreak(['2026-11-16T01:00:00Z', '2026-11-16T05:00:00Z', '2026-11-16T09:00:00Z'], NOW, 'UTC'); assert.deepEqual([s.current, s.longest, s.activeDays], [1, 1, 1]);
});
test('streak: timezone boundary decides the day (late evening New York is next day in UTC)', () => {
  const times = ['2026-11-15T23:30:00-05:00', '2026-11-16T09:00:00-05:00']; // UTC: 11-16 04:30 and 11-16 14:00
  assert.equal(computeStreak(times, NOW, 'UTC').current, 1);
  assert.equal(computeStreak(times, NOW, 'America/New_York').current, 2);
});
test('streak: daylight saving change does not break a streak (US fall back 2026-11-01, spring forward 2026-03-08)', () => {
  const tz = 'America/New_York';
  const fall = computeStreak(['2026-10-31T12:00:00Z', '2026-11-01T12:00:00Z', '2026-11-02T12:00:00Z'], new Date('2026-11-02T18:00:00Z'), tz); assert.equal(fall.current, 3);
  const spring = computeStreak(['2026-03-07T12:00:00Z', '2026-03-08T12:00:00Z', '2026-03-09T12:00:00Z'], new Date('2026-03-09T18:00:00Z'), tz); assert.equal(spring.current, 3);
  // 23:30 local on Nov 1 (the 25 hour day) and 00:30 local on Nov 2 are consecutive days one hour apart
  const edge = computeStreak(['2026-11-02T04:30:00Z', '2026-11-02T05:30:00Z'], new Date('2026-11-02T12:00:00Z'), tz); assert.equal(edge.current, 2);
  // 00:30 local on Nov 1 (EDT) and 23:30 local on Nov 1 (EST) are the same day despite 25 hours apart
  const same = computeStreak(['2026-11-01T04:30:00Z', '2026-11-02T04:30:00Z'], new Date('2026-11-02T12:00:00Z'), tz); assert.deepEqual([same.current, same.activeDays], [1, 1]);
});
test('streakFromDays handles year boundary', () => {
  const s = streakFromDays(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01'); assert.equal(s.current, 3);
});

test('quests: empty account shows xp quest at zero and suggestions, never an impossible quest', () => {
  const b = buildQuests([], { openRequirements: 0, openTasks: 0, essaysInProgress: 0, activeApplications: 0 }, NOW, 'UTC');
  assert.equal(b.daily.length, 1); assert.equal(b.daily[0].target, DAILY_GOAL_DEFAULT); assert.equal(b.daily[0].progress, 0);
  assert.equal(b.weekly.length, 1); assert.ok(b.suggestions.some((s) => s.id === 'sug-app') && b.suggestions.some((s) => s.id === 'sug-essay'));
  assert.deepEqual([b.todayXp, b.weekXp], [0, 0]);
});
test('quests: progress comes from today events only and caps at target', () => {
  const events = [ev('requirement_complete', '2026-11-16T09:00:00Z', 15), ev('requirement_complete', '2026-11-16T10:00:00Z', 10), ev('requirement_complete', '2026-11-16T11:00:00Z', 10), ev('essay_version', '2026-11-15T10:00:00Z', 3)];
  const b = buildQuests(events, { openRequirements: 5, openTasks: 0, essaysInProgress: 1, activeApplications: 1 }, NOW, 'UTC', 30);
  const xp = b.daily.find((q) => q.id === 'daily-xp')!, req = b.daily.find((q) => q.id === 'daily-req')!, essay = b.daily.find((q) => q.id === 'daily-essay')!;
  assert.deepEqual([xp.progress, xp.target, xp.done], [30, 30, true]); assert.deepEqual([req.progress, req.target, req.done], [2, 2, true]);
  assert.equal(essay.progress, 0); assert.equal(essay.done, false); assert.equal(b.todayXp, 35);
});
test('quests: requirement quest target never exceeds what is achievable', () => {
  const b = buildQuests([], { openRequirements: 1, openTasks: 0, essaysInProgress: 0, activeApplications: 1 }, NOW, 'UTC');
  assert.equal(b.daily.find((q) => q.id === 'daily-req')!.target, 1);
});
test('quests: weekly window is Monday to today in the user timezone and goal clamps', () => {
  const events = [ev('task_done', '2026-11-09T12:00:00Z'), ev('task_done', '2026-11-16T12:00:00Z'), ev('application_submitted', '2026-11-16T13:00:00Z', 100)];
  const b = buildQuests(events, { openRequirements: 0, openTasks: 1, essaysInProgress: 0, activeApplications: 1 }, NOW, 'UTC', 9999);
  assert.equal(b.weekly.find((q) => q.id === 'weekly-steps')!.progress, 2); assert.equal(b.weekXp, 110); assert.equal(b.daily[0].target, 200);
});
test('weekly summary buckets by day and ranks kinds', () => {
  const w = weeklySummary([ev('application_submitted', '2026-11-16T12:00:00Z', 100), ev('task_done', '2026-11-17T12:00:00Z'), ev('task_done', '2026-11-09T12:00:00Z')], NOW, 'UTC');
  assert.equal(w.days[0].xp, 100); assert.equal(w.days[0].isToday, true); assert.equal(w.days[1].xp, 10); assert.equal(w.totalXp, 110); assert.equal(w.activeDays, 2); assert.equal(w.top[0].kind, 'application_submitted');
});

test('badges: none unlocked on empty account and hints exist', () => {
  const b = computeBadges([], NOW, 'UTC'); assert.ok(b.length >= 11 && !b.some((x) => x.id === 'interview-ready') && b.every((x) => !x.unlocked && x.unlockedAt === null && x.current === 0));
  assert.equal(nextBadges(b).length, 3);
});
test('badges: unlocked_at is the time of the qualifying event', () => {
  const events: XpEvent[] = [ev('profile_education', '2026-11-01T10:00:00Z', 5), ev('profile_work', '2026-11-02T10:00:00Z', 5), ev('career_goals_filled', '2026-11-03T10:00:00Z', 15), ev('application_submitted', '2026-11-04T10:00:00Z', 100)];
  for (let i = 0; i < 12; i++) events.push(ev(i === 0 ? 'essay_first_version' : 'essay_version', `2026-11-05T${String(10 + (i % 10)).padStart(2, '0')}:${String(i).padStart(2, '0')}:00Z`, 3));
  const b = Object.fromEntries(computeBadges(events, NOW, 'UTC').map((x) => [x.id, x]));
  assert.equal(b['first-step'].unlockedAt, '2026-11-01T10:00:00Z'); assert.equal(b['profile-pro'].unlockedAt, '2026-11-03T10:00:00Z');
  assert.equal(b['submitted'].unlocked, true); assert.equal(b['wordsmith'].unlocked, true); assert.equal(b['admitted'].unlocked, false);
  assert.equal(b['streak-3'].unlocked, true); assert.equal(b['streak-3'].unlockedAt, '2026-11-03T10:00:00Z'); assert.equal(b['streak-7'].unlocked, false);
});
test('badges: source hunter needs 10 sourced data points, partial progress shows', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ev('sourced_data_point', `2026-11-0${i + 1}T10:00:00Z`, 5));
  let b = computeBadges(nine, NOW, 'UTC').find((x) => x.id === 'source-hunter')!; assert.deepEqual([b.unlocked, b.current, b.target], [false, 9, 10]);
  b = computeBadges([...nine, ev('sourced_data_point', '2026-11-10T10:00:00Z', 5)], NOW, 'UTC').find((x) => x.id === 'source-hunter')!; assert.equal(b.unlocked, true); assert.equal(b.unlockedAt, '2026-11-10T10:00:00Z');
  const next = nextBadges(computeBadges(nine, NOW, 'UTC'), 1)[0]; assert.equal(next.id, 'source-hunter');
});
test('badges: streak badges follow the longest run even after it ended', () => {
  const events = Array.from({ length: 7 }, (_, i) => ev('task_done', `2026-10-${String(1 + i).padStart(2, '0')}T12:00:00Z`));
  const b = Object.fromEntries(computeBadges(events, NOW, 'UTC').map((x) => [x.id, x])); assert.equal(b['streak-7'].unlocked, true); assert.equal(b['streak-7'].unlockedAt, '2026-10-07T12:00:00Z');
});

test('celebration: nothing when nothing changed, small for xp, big for level up or new badge', () => {
  const base = { xp: 100, level: 2, badges: ['first-step'] };
  assert.equal(detectCelebration(base, base).intensity, 'none');
  assert.equal(detectCelebration(base, { ...base, xp: 110 }).intensity, 'small');
  const lu = detectCelebration(base, { xp: 160, level: 3, badges: ['first-step'] }); assert.deepEqual([lu.levelUp, lu.intensity, lu.gainedXp], [true, 'big', 60]);
  assert.deepEqual(detectCelebration(base, { ...base, badges: ['first-step', 'submitted'] }).newBadges, ['submitted']);
  assert.equal(detectCelebration({ xp: 500, level: 5, badges: [] }, { xp: 400, level: 4, badges: [] }).gainedXp, 0);
});
test('settings parsing: defaults, clamping and bad data', () => {
  assert.deepEqual(parseGamificationSettings(undefined), { dailyGoalXp: 30, lastSeenXp: 0, lastSeenLevel: 1, lastSeenBadges: [] });
  assert.equal(parseGamificationSettings({ gamification: { daily_goal_xp: 5 } }).dailyGoalXp, 30);
  assert.equal(parseGamificationSettings({ gamification: { daily_goal_xp: 500 } }).dailyGoalXp, 30);
  assert.equal(parseGamificationSettings({ gamification: { daily_goal_xp: 60, last_seen_xp: 40, last_seen_level: 2, last_seen_badges: ['a', 3] } }).lastSeenBadges.length, 1);
  assert.equal(parseGamificationSettings({ gamification: 'junk' }).dailyGoalXp, 30);
});
test('xp table has unique kinds and positive points', () => {
  assert.equal(new Set(XP_TABLE.map((x) => x.kind)).size, XP_TABLE.length); assert.ok(XP_TABLE.every((x) => x.points > 0));
});

const full = (over: Partial<JourneyData> = {}): JourneyData => ({ ...EMPTY_JOURNEY_DATA, ...over });
test('journey: empty account is 0% and the first lesson is current', () => {
  const j = computeJourney(EMPTY_JOURNEY_DATA); assert.equal(j.overallPct, 0); assert.equal(j.currentLessonId, 'add-education'); assert.equal(j.units.length, 5);
  assert.equal(j.units[0].lessons[0].state, 'current'); assert.ok(j.units.flatMap((u) => u.lessons).filter((l) => l.state === 'current').length === 1);
  assert.ok(j.units.every((u) => !u.crowned && u.pct === 0)); assert.equal(j.step, 1); assert.equal(j.total, 10);
});
test('journey: the current lesson is the first not-done lesson, later done lessons stay done (no locking)', () => {
  const j = computeJourney(full({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1 }, essays: { ...EMPTY_JOURNEY_DATA.essays, total: 1 } }));
  assert.equal(j.currentLessonId, 'add-test'); const byId = Object.fromEntries(j.units.flatMap((u) => u.lessons).map((l) => [l.id, l.state]));
  assert.deepEqual([byId['add-education'], byId['add-test'], byId['add-schools'], byId['create-essay']], ['done', 'current', 'upcoming', 'done']);
});
test('journey: unit crown and percentages derive from predicates', () => {
  const j = computeJourney(full({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 2, tests: 1 } }));
  assert.equal(j.units[0].crowned, true); assert.equal(j.units[0].pct, 100); assert.equal(j.currentUnitId, 'pick-schools');
  assert.equal(j.doneCount, 2); assert.equal(j.total, UNITS.reduce((s, u) => s + u.lessons.length, 0)); assert.equal(j.overallPct, Math.round((2 / j.total) * 100));
});
test('journey: partial progress is exposed per lesson and a half-done lesson is not done', () => {
  const j = computeJourney(full({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1, tests: 1 }, schools: { ...EMPTY_JOURNEY_DATA.schools, inPortfolio: 2 } })); const l = j.units[1].lessons[0];
  assert.deepEqual([l.state, l.current, l.target], ['current', 2, 3]);
});
test('journey: everything done gives 100% and no current lesson', () => {
  const all: JourneyData = {
    ...EMPTY_JOURNEY_DATA,
    profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1, tests: 1 }, schools: { ...EMPTY_JOURNEY_DATA.schools, inPortfolio: 3, withTier: 1 },
    applications: { total: 1, withDeadline: 1, requirementsComplete: 0 }, essays: { ...EMPTY_JOURNEY_DATA.essays, total: 1, withDraft: 1 }, recs: { ...EMPTY_JOURNEY_DATA.recs, recommenders: 1 },
    decide: { ...EMPTY_JOURNEY_DATA.decide, submitted: 1 },
  };
  const j = computeJourney(all); assert.equal(j.overallPct, 100); assert.equal(j.currentLessonId, null); assert.ok(j.units.every((u) => u.crowned));
});
