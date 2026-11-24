import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRecommendations, secondarySuggestions, planSync, scoreItem, deadlinePoints, isVisibleRec, type NbaInput, type Recommendation } from '../lib/nba.ts';
import { buildDayPlan, buildWeeklyReview } from '../lib/planning.ts';
import { buildNotifications, reminderTier } from '../lib/notifications.ts';
import { toCsv, csvCell } from '../lib/export.ts';
import { computeKpis, sumMoney, zonedToUtcIso, utcToZonedLocal, deadlineTimeline } from '../lib/overview-logic.ts';
import { computeAnalytics, rate } from '../lib/analytics.ts';
import { parseSettings, parseReminderDays, weightsSchema } from '../lib/settings.ts';
import { DEFAULT_WEIGHTS } from '../lib/logic/readiness.ts';
import type { OverviewData } from '../lib/overview-data.ts';

const now = new Date('2026-11-16T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const empty = (): OverviewData => ({
  schools: [], applications: [], deadlines: [], requirements: [], tasks: [], recommendations: [], recommenders: [], essays: [], expenses: [], scholarships: [],
  interviews: [], testScores: [], work: [], assessments: [], decisions: [], settings: {}, profileExists: false,
});
const app = (id: string, over: Record<string, unknown> = {}) => ({ id, school_id: 's1', program: 'MBA', intake: 'Fall 2027', round: 'R1', priority: 3, application_fee: null, fee_currency: 'USD', stage: 'preparing', submission_confirmed_at: null, submitted_at: null, created_at: '2026-10-01T00:00:00Z', ...over });
const school = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `School ${id}`, short_name: null, country: 'United States', location: null, tier: 'reach', in_portfolio: true, priority: 3, ...over });
const base = (): OverviewData => {
  const d = empty();
  d.schools = [school('s1') as never]; d.applications = [app('a1') as never];
  d.deadlines = [{ id: 'd1', application_id: 'a1', name: 'Round 1', due_at: inDays(10), timezone: 'America/New_York', kind: 'submission', is_primary: true }];
  d.testScores = [{ id: 't', test_type: 'GMAT' }]; d.work = [{ id: 'w', company: 'X', position: 'Y', measurable_impact: 'Grew revenue' }];
  return d;
};
const gen = (d: OverviewData) => generateRecommendations({ ...d, now });
const keys = (r: Recommendation[]) => r.map((x) => x.dedupe_key);

test('score: close mandatory deadline ranks high, far optional ranks low', () => {
  assert.equal(scoreItem({ daysLeft: 2, mandatory: true, readinessPct: 20, weakness: false, impact: 12, effort: 60 }).priority, 'high');
  assert.equal(scoreItem({ daysLeft: null, mandatory: false, readinessPct: null, weakness: false, impact: 6, effort: 120 }).priority, 'low');
  assert.equal(deadlinePoints(-1), 40); assert.equal(deadlinePoints(100), 0);
});
test('score: breakdown sums to score and is capped at 100', () => {
  const s = scoreItem({ daysLeft: -1, mandatory: true, readinessPct: 0, weakness: true, impact: 99, effort: 1 });
  assert.ok(s.score <= 100); assert.equal(s.score, Math.min(100, Object.values(s.breakdown).reduce((a, b) => a + b, 0)));
});
test('nba: recommender pending within 21 days, none beyond', () => {
  const d = base(); d.recommenders = [{ id: 'r1', name: 'Dana' }]; d.recommendations = [{ id: 'rc1', recommender_id: 'r1', application_id: 'a1', status: 'contacted', deadline: null, submitted_at: null }];
  assert.ok(keys(gen(d)).includes('rec-pending:rc1'));
  d.deadlines[0].due_at = inDays(40); assert.ok(!keys(gen(d)).includes('rec-pending:rc1'));
  d.deadlines[0].due_at = inDays(10); d.recommendations[0].status = 'submitted'; assert.ok(!keys(gen(d)).includes('rec-pending:rc1'));
});
test('nba: no recommender assigned (not for researching stage)', () => {
  const d = base(); assert.ok(keys(gen(d)).includes('no-recommender:a1'));
  d.applications[0].stage = 'researching'; assert.ok(!keys(gen(d)).includes('no-recommender:a1'));
});
test('nba: mandatory open on application with deadline in 30 days, ignores Submission confirmation and optional', () => {
  const d = base();
  d.requirements = [
    { id: 'q1', application_id: 'a1', name: 'Resume', category: 'resume', status: 'not_started', mandatory: true, due_date: null, essay_id: null, recommendation_id: null },
    { id: 'q2', application_id: 'a1', name: 'Submission confirmation', category: 'other', status: 'not_started', mandatory: true, due_date: null, essay_id: null, recommendation_id: null },
    { id: 'q3', application_id: 'a1', name: 'Optional essay', category: 'essays', status: 'not_started', mandatory: false, due_date: null, essay_id: null, recommendation_id: null },
  ];
  const r = gen(d).find((x) => x.dedupe_key === 'mandatory-open:a1')!;
  assert.ok(r); assert.match(r.title, /1 mandatory item/); assert.equal(r.source, 'rules: mandatory_open');
  d.deadlines[0].due_at = inDays(45); assert.ok(!keys(gen(d)).includes('mandatory-open:a1'));
});
test('nba: essays not started, over limit, unreviewed', () => {
  const d = base();
  const e = (id: string, o: Record<string, unknown>) => ({ id, application_id: 'a1', school_id: 's1', title: id, word_limit: 5, draft: '', status: 'not_started', deadline: null, created_at: '', ...o }) as never;
  d.essays = [e('e1', {}), e('e2', { draft: 'one two three four five six', status: 'revision' }), e('e3', { draft: 'ok', status: 'final_review' }), e('e4', { draft: 'ok', status: 'final_review' })];
  d.assessments = [{ id: 'x', kind: 'essay', subject_id: 'e4' }];
  const k = keys(gen(d));
  assert.ok(k.includes('essay-start:e1')); assert.ok(k.includes('essay-over:e2')); assert.ok(k.includes('essay-review:e3')); assert.ok(!k.includes('essay-review:e4'));
});
test('nba: profile gaps', () => {
  const d = base(); d.testScores = []; d.work = [{ id: 'w', company: 'X', position: 'Y', measurable_impact: '  ' }];
  const k = keys(gen(d)); assert.ok(k.includes('profile-test')); assert.ok(k.includes('profile-impact:w'));
  d.work = []; assert.ok(keys(gen(d)).includes('profile-work'));
});
test('nba: fee unpaid, resolved by a paid fee expense', () => {
  const d = base(); d.applications[0].application_fee = 250;
  assert.ok(keys(gen(d)).includes('fee-unpaid:a1'));
  d.expenses = [{ id: 'x', school_id: null, application_id: 'a1', category: 'application_fee', description: null, estimated_cost: 250, actual_cost: 250, currency: 'USD', fx_rate_to_base: null, payment_status: 'paid', payment_date: null }];
  assert.ok(!keys(gen(d)).includes('fee-unpaid:a1'));
});
test('nba: no mock interview prompt while Interview Practice is switched off', () => {
  const d = base(); d.interviews = [{ id: 'i1', application_id: 'a1', school_id: 's1', kind: 'real', scheduled_at: inDays(5), status: 'scheduled' }];
  assert.ok(!keys(gen(d)).includes('interview-mock:i1'));
});
test('nba: overdue task and done task', () => {
  const d = base(); const t = { id: 't1', application_id: 'a1', title: 'Send transcript', status: 'todo', due_date: '2026-11-10', estimated_minutes: 20, priority: 2, completed_at: null, created_at: '', source: 'manual' };
  d.tasks = [t, { ...t, id: 't2', status: 'done' }];
  const r = gen(d); assert.ok(keys(r).includes('task-overdue:t1')); assert.ok(!keys(r).includes('task-overdue:t2'));
  assert.equal(r.find((x) => x.dedupe_key === 'task-overdue:t1')!.effort_minutes, 20);
});
test('nba: deterministic, sorted by score, unique keys, honest source', () => {
  const d = base(); d.testScores = [];
  const a = gen(d), b = gen(d);
  assert.deepEqual(a, b); assert.equal(new Set(keys(a)).size, a.length);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].score >= a[i].score);
  assert.ok(a.every((x) => x.source.startsWith('rules: ')));
});
test('nba: no data produces profile gaps only, no fabricated school items', () => {
  const r = gen(empty()); assert.deepEqual(keys(r).sort(), ['profile-english', 'profile-test', 'profile-work']);
});
test('sync plan: insert new, never resurrect dismissed/completed/converted, snooze respected', () => {
  const g = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ dedupe_key: k }) as Recommendation);
  const ex = [
    { id: '1', dedupe_key: 'a', status: 'dismissed', snoozed_until: null }, { id: '2', dedupe_key: 'b', status: 'completed', snoozed_until: null },
    { id: '3', dedupe_key: 'c', status: 'snoozed', snoozed_until: inDays(2) }, { id: '4', dedupe_key: 'd', status: 'snoozed', snoozed_until: inDays(-1) },
    { id: '5', dedupe_key: 'e', status: 'new', snoozed_until: null }, { id: '7', dedupe_key: 'z', status: 'new', snoozed_until: null },
    { id: '8', dedupe_key: 'y', status: 'accepted', snoozed_until: null }, { id: '9', dedupe_key: 'x', status: 'dismissed', snoozed_until: null }, { id: '10', dedupe_key: 'w', status: 'converted', snoozed_until: null },
  ];
  const p = planSync(g, ex, now);
  assert.deepEqual(p.insert.map((x) => x.dedupe_key), ['f']); assert.deepEqual(p.refresh.map((x) => x.dedupe_key), ['e']); assert.deepEqual(p.resurface.map((x) => x.dedupe_key), ['d']);
  assert.deepEqual(p.remove, ['7']); assert.deepEqual(p.complete, ['8']);
});
test('visible recs: snoozed hidden until time passes', () => {
  assert.equal(isVisibleRec({ status: 'snoozed', snoozed_until: inDays(1) }, now), false);
  assert.equal(isVisibleRec({ status: 'snoozed', snoozed_until: inDays(-1) }, now), true);
  assert.equal(isVisibleRec({ status: 'dismissed', snoozed_until: null }, now), false);
});
test('daily plan fits hours, reports what did not fit, flags assumed minutes', () => {
  const mk = (id: string, min: number | null, due: string | null, p = 3) => ({ id, application_id: null, title: id, status: 'todo', due_date: due, estimated_minutes: min, priority: p, completed_at: null, created_at: '', source: 'manual' });
  const plan = buildDayPlan({ hours: 2, now, tasks: [mk('big', 100, '2026-11-10'), mk('small', 30, '2026-11-20'), mk('unsized', null, null, 5), mk('done', 10, null)].map((t) => (t.id === 'done' ? { ...t, status: 'done' } : t)), recs: [] });
  assert.equal(plan.capacityMin, 120); assert.ok(plan.usedMin <= 120);
  assert.deepEqual(plan.planned.map((x) => x.id), ['big']);
  assert.deepEqual(plan.didNotFit.map((x) => x.id), ['small', 'unsized']); assert.equal(plan.didNotFit[1].assumed, true);
  assert.ok(plan.planned.every((x) => x.id !== 'done') && plan.didNotFit.every((x) => x.id !== 'done'));
});
test('daily plan: smaller items still fit after a large one is skipped; converted recs not double counted', () => {
  const t = { id: 'tk', application_id: null, title: 't', status: 'todo', due_date: null, estimated_minutes: 30, priority: 3, completed_at: null, created_at: '', source: 'next_best_action' };
  const rec = (id: string, m: number, score: number, task_id: string | null = null) => ({ id, title: id, score, effort_minutes: m, due_date: null, status: 'new', snoozed_until: null, task_id });
  const plan = buildDayPlan({ hours: 1, now, tasks: [t], recs: [rec('huge', 90, 90), rec('tiny', 20, 10), rec('conv', 30, 50, 'tk')] });
  assert.deepEqual(plan.planned.map((x) => x.id), ['conv', 'tiny']);
  assert.ok(plan.didNotFit.some((x) => x.id === 'huge')); assert.ok(plan.planned.some((x) => x.id === 'tiny'));
  assert.equal([...plan.planned, ...plan.didNotFit].filter((x) => x.id === 'tk').length, 0);
});
test('weekly review compares completions by completed_at', () => {
  const t = (id: string, completed: string | null, o = {}) => ({ id, application_id: 'a1', title: id, status: completed ? 'done' : 'todo', due_date: null, estimated_minutes: null, priority: 3, completed_at: completed, created_at: '', source: 'manual', ...o });
  const d = base();
  const r = buildWeeklyReview({ tasks: [t('a', inDays(-1)), t('b', inDays(-2)), t('c', inDays(-9)), t('d', null, { due_date: '2026-11-01' })], applications: d.applications, deadlines: d.deadlines, schools: d.schools, recs: [{ title: 'x', score: 50, status: 'new' }, { title: 'y', score: 70, status: 'dismissed' }], atRiskAppIds: new Set(), now });
  assert.equal(r.completedThisWeek, 2); assert.equal(r.completedLastWeek, 1); assert.equal(r.progress, 'up'); assert.equal(r.overdueTasks, 1);
  assert.deepEqual(r.priorities.map((p) => p.title), ['x']); assert.equal(r.needsAttention.length, 1); assert.equal(r.deadlinesNext7.length, 0);
  assert.equal(buildWeeklyReview({ tasks: [], applications: [], deadlines: [], schools: [], recs: [], atRiskAppIds: new Set(), now }).progress, 'no_data');
});
test('notifications: reminder tier picks the current tier only', () => {
  assert.equal(reminderTier(20, [30, 14, 7, 3, 1]), 30); assert.equal(reminderTier(5, [30, 14, 7, 3, 1]), 7); assert.equal(reminderTier(0.5, [30, 14, 7, 3, 1]), 1);
  assert.equal(reminderTier(31, [30, 14, 7, 3, 1]), null); assert.equal(reminderTier(-1, [30]), null); assert.equal(reminderTier(5, [30, 3]), 30);
});
test('notifications: deadline reminders are deduped by deadline and tier; submitted apps get none; custom days respected', () => {
  const d = base(); const input = (o: Partial<OverviewData> = {}, days?: number[]) => ({ ...d, ...o, highPriorityRecs: 0, now, reminderDays: days });
  d.deadlines[0].due_at = inDays(6);
  const a = buildNotifications(input()), b = buildNotifications(input());
  assert.deepEqual(a, b); assert.equal(a.filter((n) => n.category === 'deadline').length, 1); assert.match(a[0].dedupe_key, /:7d:/);
  assert.equal(buildNotifications(input({ applications: [app('a1', { stage: 'submitted', submission_confirmed_at: inDays(-1) }) as never] })).filter((n) => n.category === 'deadline').length, 0);
  assert.match(buildNotifications(input({}, [10, 2])).find((n) => n.category === 'deadline')!.dedupe_key, /:10d:/);
});
test('notifications: overdue tasks, essays, scholarships, decisions, high priority recs', () => {
  const d = base(); d.tasks = [{ id: 't', application_id: 'a1', title: 'x', status: 'todo', due_date: '2026-11-01', estimated_minutes: null, priority: 3, completed_at: null, created_at: '', source: 'm' }];
  d.essays = [{ id: 'e', application_id: 'a1', school_id: 's1', title: 'Why MBA', word_limit: null, draft: '', status: 'not_started', deadline: null, created_at: '' }];
  d.scholarships = [{ id: 'sc', name: 'Fellowship', school_id: null, amount: null, currency: 'USD', deadline: '2026-11-20', status: 'identified' }];
  d.decisions = [{ id: 'dc', application_id: 'a1', decision: 'admitted', decision_date: null, deposit_deadline: null, waitlist_response_deadline: null, scholarship_amount: null, scholarship_currency: null, updated_at: inDays(-1) }];
  const cats = buildNotifications({ ...d, highPriorityRecs: 2, now }).map((n) => n.category);
  for (const c of ['task', 'essay', 'scholarship', 'decision', 'recommendation', 'deadline']) assert.ok(cats.includes(c as never), c);
});
test('csv: quoting, newlines, formula injection, null, numbers', () => {
  assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
  assert.equal(csvCell(null), ''); assert.equal(csvCell(-5), '-5'); assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(toCsv([{ a: 1, b: 'x,y' }], ['a', 'b']), 'a,b\r\n1,"x,y"'); assert.equal(toCsv([], ['a']), 'a');
});
test('money: converts with rate, reports missing rates separately, never guesses', () => {
  const m = sumMoney([{ amount: 100, currency: 'USD', rate: null }, { amount: 100, currency: 'EUR', rate: 1.1 }, { amount: 50, currency: 'GBP', rate: null }, { amount: null, currency: 'USD', rate: null }], 'USD');
  assert.ok(Math.abs(m.total - 210) < 1e-9); assert.deepEqual(m.unconverted, { GBP: 50 }); assert.equal(m.counted, 2); assert.equal(m.unconvertedCount, 1);
});
test('kpis: counted from data, exclude submitted from deadlines, scholarships identified/applied only', () => {
  const d = base();
  d.applications = [app('a1') as never, app('a2', { stage: 'submitted', submission_confirmed_at: inDays(-2) }) as never, app('a3', { stage: 'interview_scheduled' }) as never, app('a4', { stage: 'admitted' }) as never];
  d.deadlines.push({ id: 'd2', application_id: 'a2', name: 'x', due_at: inDays(5), timezone: 'UTC', kind: 'submission', is_primary: true }, { id: 'd3', application_id: 'a1', name: 'far', due_at: inDays(50), timezone: 'UTC', kind: 'other', is_primary: false });
  d.tasks = [{ id: 't', application_id: 'a1', title: 'x', status: 'todo', due_date: '2026-11-01', estimated_minutes: null, priority: 3, completed_at: null, created_at: '', source: 'm' }, { id: 't2', application_id: 'a1', title: 'x', status: 'done', due_date: null, estimated_minutes: null, priority: 3, completed_at: null, created_at: '', source: 'm' }];
  d.scholarships = ['identified', 'applied', 'awarded', 'rejected'].map((s, i) => ({ id: String(i), name: s, school_id: null, amount: 1, currency: 'USD', deadline: null, status: s }));
  d.expenses = [{ id: 'e', school_id: null, application_id: null, category: 'other', description: null, estimated_cost: 100, actual_cost: 90, currency: 'USD', fx_rate_to_base: null, payment_status: 'paid', payment_date: null }, { id: 'e2', school_id: null, application_id: null, category: 'other', description: null, estimated_cost: 50, actual_cost: null, currency: 'USD', fx_rate_to_base: null, payment_status: 'planned', payment_date: null }];
  const k = computeKpis(d, 'USD', now);
  assert.equal(k.targetSchools, 1); assert.equal(k.inProgress, 1); assert.equal(k.submitted, 3); assert.equal(k.interviews, 1); assert.equal(k.admitted, 1);
  assert.equal(k.outstandingTasks, 1); assert.equal(k.upcomingDeadlines, 1); assert.equal(k.scholarships, 2); assert.equal(k.budget.total, 150); assert.equal(k.spending.total, 90);
});
test('timeline: within 30 days incl overdue, excludes submitted, risk and requirement counts', () => {
  const d = base();
  d.applications = [app('a1') as never, app('a2', { stage: 'submitted', submission_confirmed_at: inDays(-1) }) as never];
  d.deadlines = [{ id: 'd1', application_id: 'a1', name: 'x', due_at: inDays(2), timezone: 'UTC', kind: 'submission', is_primary: true }, { id: 'd2', application_id: 'a2', name: 'y', due_at: inDays(3), timezone: 'UTC', kind: 'submission', is_primary: true }, { id: 'd3', application_id: 'a1', name: 'late', due_at: inDays(-1), timezone: 'UTC', kind: 'other', is_primary: false }, { id: 'd4', application_id: 'a1', name: 'far', due_at: inDays(45), timezone: 'UTC', kind: 'other', is_primary: false }];
  d.requirements = [{ id: 'q1', application_id: 'a1', name: 'Resume', category: 'resume', status: 'complete', mandatory: true, due_date: null, essay_id: null, recommendation_id: null }, { id: 'q2', application_id: 'a1', name: 'Essay 1', category: 'essays', status: 'not_started', mandatory: true, due_date: null, essay_id: null, recommendation_id: null }];
  const rows = deadlineTimeline(d, d.applications, now);
  assert.deepEqual(rows.map((r) => r.deadline.id), ['d3', 'd1']); assert.equal(rows[1].done, 1); assert.equal(rows[1].total, 2); assert.equal(rows[1].risk, 'red'); assert.equal(rows[0].overdue, true);
});
test('timezone conversion round-trips and handles DST', () => {
  assert.equal(zonedToUtcIso('2026-12-01T23:59', 'America/New_York'), '2026-12-02T04:59:00.000Z');
  assert.equal(zonedToUtcIso('2026-07-01T12:00', 'America/New_York'), '2026-07-01T16:00:00.000Z');
  assert.equal(utcToZonedLocal('2026-12-02T04:59:00.000Z', 'America/New_York'), '2026-12-01T23:59');
  assert.equal(zonedToUtcIso('2026-03-08T12:00', 'America/New_York'), '2026-03-08T16:00:00.000Z');
  assert.throws(() => zonedToUtcIso('bad', 'UTC'));
});
test('analytics: no data yields no rates and no fabricated numbers', () => {
  const a = computeAnalytics(empty(), DEFAULT_WEIGHTS, 'USD', now);
  assert.equal(a.interviewRate.pct, null); assert.equal(a.admitRate.pct, null); assert.equal(a.scholarshipSuccess.pct, null); assert.equal(a.costPerSubmitted, null);
  assert.equal(a.applicationCount, 0); assert.equal(a.readinessN, 0); assert.deepEqual(rate(0, 0), { numerator: 0, n: 0, pct: null }); assert.equal(rate(1, 4).pct, 25);
});
test('analytics: counts and rates with n', () => {
  const d = base();
  d.schools = [school('s1', { tier: 'reach' }) as never, school('s2', { tier: null, country: 'France' }) as never];
  d.applications = [app('a1', { stage: 'admitted', submission_confirmed_at: inDays(-30) }) as never, app('a2', { school_id: 's2', stage: 'rejected', submission_confirmed_at: inDays(-30) }) as never, app('a3', { stage: 'interview_invited', submission_confirmed_at: inDays(-5) }) as never];
  d.scholarships = [{ id: '1', name: 'a', school_id: null, amount: 1000, currency: 'USD', deadline: null, status: 'awarded' }, { id: '2', name: 'b', school_id: null, amount: 500, currency: 'USD', deadline: null, status: 'rejected' }];
  d.expenses = [{ id: 'e', school_id: null, application_id: null, category: 'other', description: null, estimated_cost: 0, actual_cost: 300, currency: 'USD', fx_rate_to_base: null, payment_status: 'paid', payment_date: null }];
  const a = computeAnalytics(d, DEFAULT_WEIGHTS, 'USD', now);
  assert.deepEqual(a.byCountry.map((c) => c.name).sort(), ['France', 'United States']); assert.ok(a.byTier.some((t) => t.name === 'No tier set'));
  assert.equal(a.admitRate.n, 2); assert.equal(a.admitRate.pct, 50); assert.equal(a.scholarshipSuccess.pct, 50); assert.equal(a.interviewRate.n, 3); assert.equal(a.interviewRate.numerator, 1);
  assert.equal(a.costPerSubmitted, 100); assert.deepEqual(a.scholarshipAwarded, { USD: 1000 });
});
test('settings: defaults, validation, weights sum to 100', () => {
  const s = parseSettings({}); assert.equal(s.workingHours, null); assert.deepEqual(s.reminderDays, [30, 14, 7, 3, 1]); assert.equal(s.baseCurrency, 'USD');
  assert.equal(parseSettings({ working_hours_per_day: 4, reminder_days: [10, 2], base_currency: 'idr' }).workingHours, 4);
  assert.equal(parseSettings({ working_hours_per_day: 99 }).workingHours, null); assert.deepEqual(parseSettings({ reminder_days: [] }).reminderDays, [30, 14, 7, 3, 1]);
  assert.deepEqual(parseReminderDays('3, 14,7 7'), { ok: true, days: [14, 7, 3] }); assert.equal(parseReminderDays('a').ok, false); assert.equal(parseReminderDays('').ok, false); assert.equal(parseReminderDays('0').ok, false);
  assert.equal(weightsSchema.safeParse(DEFAULT_WEIGHTS).success, true); assert.equal(weightsSchema.safeParse({ ...DEFAULT_WEIGHTS, essays: 30 }).success, false);
  assert.deepEqual(parseSettings({ readiness_weights: { ...DEFAULT_WEIGHTS, essays: 30 } }).weights, DEFAULT_WEIGHTS);
});
import { searchAll, normalize } from '../lib/search.ts';
test('search: multi-word AND, accent-insensitive, schools/applications/essays, empty query returns nothing', () => {
  const d = {
    schools: [{ id: 's1', name: 'Oxford Saïd', short_name: 'Saïd', country: 'United Kingdom', location: 'Oxford', tier: 'reach', in_portfolio: true, notes: null }, { id: 's2', name: 'INSEAD', short_name: null, country: 'France', location: 'Fontainebleau', tier: null, in_portfolio: false, notes: null }],
    applications: [{ id: 'a1', school_id: 's1', program: 'MBA', intake: 'Fall 2027', round: 'R1', stage: 'ready', notes: null }],
    essays: [{ id: 'e1', title: 'Why Oxford', status: 'first_draft', school_id: 's1', application_id: 'a1' }, { id: 'e2', title: 'Leadership', status: 'not_started', school_id: null, application_id: null }],
  };
  assert.equal(normalize('Saïd'), 'said');
  const r = searchAll('said', d); assert.equal(r.schools.length, 1); assert.equal(r.applications.length, 1);
  assert.equal(searchAll('oxford why', d).essays.length, 1); assert.equal(searchAll('oxford', d).essays[0].title, 'Why Oxford');
  assert.equal(searchAll('france', d).schools[0].id, 's2'); assert.equal(searchAll('zzz', d).schools.length, 0);
  const none = searchAll('  ', d); assert.equal(none.schools.length + none.applications.length + none.essays.length, 0);
  assert.equal(searchAll('ready', d).applications.length, 1);
});

// ---------- track-aware rules and one "what's next" ----------
const ug = (d: OverviewData, o: Record<string, unknown> = {}) => generateRecommendations({ ...d, now, profile: { track: 'undergrad', stage: 'exploring' }, ...o });
test('nba: undergrads never get GMAT/GRE or work experience items', () => {
  const d = empty(); d.work = [{ id: 'w', company: 'X', position: 'Y', measurable_impact: '' }];
  const k = keys(ug(d, { educationCount: 0, activityCount: 0 }));
  assert.ok(!k.some((x) => /^profile-(test|work|impact)/.test(x)), k.join(','));
  assert.ok(k.includes('profile-english')); assert.ok(k.includes('profile-grades')); assert.ok(k.includes('profile-activities'));
  assert.ok(!k.includes('profile-sat'), 'no SAT unless a school asks');
  for (const r of ug(d, { educationCount: 0, activityCount: 0 })) assert.doesNotMatch(`${r.title} ${r.description}`, /GMAT|GRE|work experience|—|\bactually\b/i);
});
test('nba: undergrad SAT only when a school on the list asks for it', () => {
  const r = ug(empty(), { satSchools: ['MIT', 'Purdue', 'UCLA'] }).find((x) => x.dedupe_key === 'profile-sat')!;
  assert.ok(r); assert.match(r.description, /MIT and Purdue and 1 more/);
  const d = empty(); d.testScores = [{ id: 's', test_type: 'SAT' }];
  assert.ok(!keys(ug(d, { satSchools: ['MIT'] })).includes('profile-sat'));
  d.testScores = [{ id: 'i', test_type: 'IELTS' }]; assert.ok(!keys(ug(d)).includes('profile-english'));
});
test('nba: unknown education/activity counts never invent grade or activity items', () => {
  const k = keys(ug(empty())); assert.ok(!k.includes('profile-grades')); assert.ok(!k.includes('profile-activities'));
});
test('nba: stage "applying" raises deadline items, names the school in "Set the deadline"', () => {
  const d = base(); d.deadlines = []; d.schools = [school('s1', { short_name: 'Duke Fuqua' }) as never];
  const explore = generateRecommendations({ ...d, now, profile: { track: 'grad', stage: 'exploring' } });
  const apply = generateRecommendations({ ...d, now, profile: { track: 'grad', stage: 'applying' } });
  const a = apply.find((x) => x.dedupe_key === 'no-deadline:a1')!, e = explore.find((x) => x.dedupe_key === 'no-deadline:a1')!;
  assert.equal(a.title, 'Set the deadline for Duke Fuqua');
  assert.equal(a.score - e.score, 10); assert.equal(a.score_breakdown.stage, 10); assert.equal(e.score_breakdown.stage, 0);
  const t = (r: Recommendation[]) => r.find((x) => x.dedupe_key === 'no-recommender:a1')!.score;
  assert.ok(t(apply) > t(explore));
});
test('secondary suggestions: at most 2, visible only, no repeat of the journey step, track filter', () => {
  const r = (k: string, score: number, status = 'new') => ({ dedupe_key: k, score, status, snoozed_until: null });
  const recs = [r('profile-test', 90), r('no-deadline:a1', 80), r('fee-unpaid:a1', 70), r('x', 60), r('gone', 99, 'dismissed')];
  assert.deepEqual(secondarySuggestions(recs, { now, stepId: 'set-deadline' }).map((x) => x.dedupe_key), ['profile-test', 'fee-unpaid:a1']);
  assert.deepEqual(secondarySuggestions(recs, { now, stepId: 'add-test', track: 'undergrad' }).map((x) => x.dedupe_key), ['no-deadline:a1', 'fee-unpaid:a1']);
  assert.equal(secondarySuggestions(recs, { now, max: Infinity }).length, 4);
});
