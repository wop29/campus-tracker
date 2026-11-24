import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationSchema, NewApplicationSchema, DeadlineSchema, TaskSchema, SubmissionSchema, PortalUrlSchema, friendlyDbError, wallToIso, isoToWall, nearestDeadline, resolveWeights, validateWeights, enrich, filterApps,
  sortApps, parseQuick, parseView, quickMatch, readyBlockers, stageBlock, stageForDecision, decisionForStage, buildChecklist, checklistComplete, weightedTotal, rankOffers, parseMatrix,
  pickSourced, sourcedTotalCost, filterTasks, isOverdue, taskCompletedAt, buildLetterPrompt, EMPTY_FILTERS, type AppListRow, type Deadline, type Task,
} from '../lib/applications.ts';
import { DEFAULT_WEIGHTS } from '../lib/logic/readiness.ts';

const now = new Date('2026-11-16T12:00:00Z');
const dl = (id: string, days: number, extra: Partial<Deadline> = {}): Deadline => ({ id, application_id: 'a', name: 'd', due_at: new Date(now.getTime() + days * 86_400_000).toISOString(), timezone: 'UTC', kind: 'submission', is_primary: false, ...extra });
const req = (name: string, category: string, status = 'not_started', mandatory = true, extra: object = {}) => ({ id: name, application_id: 'a', name, category, status, mandatory, due_date: null, priority: 3, document_id: null, essay_id: null, recommendation_id: null, assigned_to: null, notes: null, completed_at: null, sort_order: 0, is_default: true, ...extra }) as never;
const row = (o: Partial<AppListRow> & { id: string }): AppListRow => ({
  school_id: 's1', program: 'MBA', intake: 'Fall 2027', round: 'R1', priority: 3, application_fee: null, fee_currency: 'USD', stage: 'preparing', notes: null, submission_confirmed_at: null, submitted_at: null,
  confirmation_number: null, confirmation_document_id: null, portal_url: null, final_resume_version_id: null, submission_checklist: {}, final_essay_versions: {}, submission_notes: null, additional_requirements: null,
  updated_at: now.toISOString(), created_at: now.toISOString(), school: { id: 's1', name: 'Alpha School', short_name: 'AS', country: 'United States', tier: 'reach' }, deadlines: [], application_requirements: [], decision: null, ...o,
} as AppListRow);

test('duplicate application error is friendly, trigger errors stay verbatim', () => {
  assert.match(friendlyDbError('duplicate key value violates unique constraint "applications_unique_round"'), /already have an application/);
  assert.equal(friendlyDbError('Cannot mark Ready: 3 mandatory requirement(s) incomplete'), 'Cannot mark Ready: 3 mandatory requirement(s) incomplete');
});
test('application schema validates and normalises', () => {
  const ok = ApplicationSchema.safeParse({ school_id: 'x', program: ' MBA ', intake: 'Fall 2027', round: '', priority: '2', application_fee: '250', fee_currency: 'USD', notes: '' });
  assert.ok(ok.success); assert.equal(ok.data.program, 'MBA'); assert.equal(ok.data.round, null); assert.equal(ok.data.application_fee, 250); assert.equal(ok.data.priority, 2);
  assert.ok(!ApplicationSchema.safeParse({ school_id: '', program: '', intake: 'x', priority: 9, application_fee: '-1', fee_currency: 'USD' }).success);
  assert.ok(!NewApplicationSchema.safeParse({ school_id: 'x', program: 'p', intake: 'i', priority: 3, fee_currency: 'USD', stage: 'ready' }).success);
  assert.ok(!NewApplicationSchema.safeParse({ school_id: 'x', program: 'p', intake: 'i', priority: 3, fee_currency: 'USD', stage: 'preparing', deadline_date: '2026-12-01' }).success);
});
test('deadline, task, submission, portal schemas', () => {
  assert.ok(!DeadlineSchema.safeParse({ name: 'x', date: '2026-01-01', time: '10:00', timezone: 'Mars/Base', kind: 'submission', is_primary: false }).success);
  assert.ok(DeadlineSchema.safeParse({ name: 'x', date: '2026-01-01', time: '10:00', timezone: 'Asia/Jakarta', kind: 'submission', is_primary: true }).success);
  assert.ok(!TaskSchema.safeParse({ title: ' ', priority: 3 }).success);
  assert.ok(!TaskSchema.safeParse({ title: 't', priority: 3, estimated_minutes: '0' }).success);
  assert.equal(TaskSchema.parse({ title: 't', priority: '2', estimated_minutes: '30', due_date: '' }).estimated_minutes, 30);
  assert.ok(!SubmissionSchema.safeParse({ submitted_at: '2026-11-01', confirmation_number: '' }).success);
  assert.ok(PortalUrlSchema.safeParse('').success); assert.ok(!PortalUrlSchema.safeParse('portal.edu').success);
});
test('timezone conversion round trips and handles DST', () => {
  assert.equal(wallToIso('2026-01-15', '23:59', 'America/New_York'), '2026-01-16T04:59:00.000Z');
  assert.equal(wallToIso('2026-07-15', '12:00', 'America/New_York'), '2026-07-15T16:00:00.000Z');
  assert.equal(wallToIso('2026-03-01', '09:00', 'Asia/Jakarta'), '2026-03-01T02:00:00.000Z');
  assert.deepEqual(isoToWall('2026-01-16T04:59:00.000Z', 'America/New_York'), { date: '2026-01-15', time: '23:59' });
});
test('nearestDeadline prefers upcoming, falls back to latest past', () => {
  assert.equal(nearestDeadline([], now), null);
  assert.equal(nearestDeadline([dl('past', -3), dl('far', 30), dl('near', 5)], now)?.id, 'near');
  assert.equal(nearestDeadline([dl('old', -30), dl('recent', -2)], now)?.id, 'recent');
});
test('resolveWeights falls back to defaults and validates', () => {
  assert.deepEqual(resolveWeights(null), DEFAULT_WEIGHTS);
  assert.equal(resolveWeights({ readiness_weights: { essays: 50, form: 'bad', tests: -1 } }).essays, 50);
  assert.equal(resolveWeights({ readiness_weights: { essays: 50 } }).form, DEFAULT_WEIGHTS.form);
  assert.deepEqual(resolveWeights({ readiness_weights: { essays: 0, recommendations: 0, academics: 0, tests: 0, resume: 0, form: 0, other: 0 } }), DEFAULT_WEIGHTS);
  assert.ok(validateWeights({ ...DEFAULT_WEIGHTS, essays: -1 }));
  assert.equal(validateWeights(DEFAULT_WEIGHTS), null);
  assert.ok(validateWeights({ essays: 0, recommendations: 0, academics: 0, tests: 0, resume: 0, form: 0, other: 0 }));
});
test('enrich computes readiness, nearest deadline and risk from data', () => {
  const r = enrich(row({ id: 'a', deadlines: [dl('x', 2)], application_requirements: [req('Essay 1', 'essays', 'complete'), req('Resume', 'resume')] }), DEFAULT_WEIGHTS, now);
  assert.equal(r.readinessPct, Math.round((25 / 35) * 100)); assert.equal(r.mandatoryOpen, 1); assert.equal(r.nearest?.id, 'x'); assert.equal(r.risk?.risk, 'red');
  const sub = enrich(row({ id: 'b', stage: 'submitted', deadlines: [dl('y', -1)], application_requirements: [req('Resume', 'resume')] }), DEFAULT_WEIGHTS, now);
  assert.equal(sub.risk?.risk, 'green');
  assert.equal(enrich(row({ id: 'c' }), DEFAULT_WEIGHTS, now).risk, null);
  assert.equal(enrich(row({ id: 'd', application_requirements: [req('Submission confirmation', 'other')], deadlines: [dl('z', 40)] }), DEFAULT_WEIGHTS, now).mandatoryOpen, 0);
});
test('quick filters match the cross-module link contract', () => {
  assert.equal(parseQuick('bogus'), 'all'); assert.equal(parseQuick('interview'), 'interview'); assert.equal(parseView('x'), 'pipeline'); assert.equal(parseView('decisions'), 'decisions');
  assert.ok(quickMatch('in_progress', { stage: 'ready', deadlines: [] })); assert.ok(!quickMatch('in_progress', { stage: 'submitted', deadlines: [] }));
  assert.ok(quickMatch('submitted', { stage: 'admitted', deadlines: [] })); assert.ok(!quickMatch('submitted', { stage: 'withdrawn', deadlines: [] }));
  assert.ok(quickMatch('interview', { stage: 'interview_scheduled', deadlines: [] })); assert.ok(quickMatch('admitted', { stage: 'admitted', deadlines: [] }));
  assert.ok(!quickMatch('deadlines', { stage: 'preparing', deadlines: [] })); assert.ok(quickMatch('deadlines', { stage: 'preparing', deadlines: [1] }));
});
test('filters and sorting', () => {
  const a = enrich(row({ id: 'a', deadlines: [dl('1', 20)], priority: 2 }), DEFAULT_WEIGHTS, now);
  const b = enrich(row({ id: 'b', school_id: 's2', school: { id: 's2', name: 'Beta', short_name: null, country: 'France', tier: 'target' }, stage: 'submitted', round: null, deadlines: [dl('2', 5)], priority: 1 }), DEFAULT_WEIGHTS, now);
  const c = enrich(row({ id: 'c', school_id: 's3', school: { id: 's3', name: 'Gamma', short_name: null, country: 'France', tier: 'target' }, deadlines: [dl('3', -4)] }), DEFAULT_WEIGHTS, now);
  const d = enrich(row({ id: 'd', school: { id: 's4', name: 'Delta', short_name: null, country: 'UK', tier: null } }), DEFAULT_WEIGHTS, now);
  const all = [a, b, c, d];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, country: 'France' }, now)), ['b', 'c']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, deadline: 'overdue' }, now)), ['c']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, deadline: '7' }, now)), ['b']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, deadline: 'none' }, now)), ['d']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, q: 'gamm' }, now)), ['c']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, quick: 'submitted' }, now)), ['b']);
  assert.deepEqual(ids(filterApps(all, { ...EMPTY_FILTERS, priority: '1', stage: 'submitted' }, now)), ['b']);
  assert.deepEqual(ids(sortApps(all, 'deadline')), ['c', 'b', 'a', 'd']);
  assert.deepEqual(ids(sortApps(all, 'deadline', 'desc')), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(sortApps(all, 'priority')), ['b', 'a', 'c', 'd'].filter((x) => x !== 'x'));
});
test('stage rules', () => {
  assert.equal(readyBlockers([req('A', 'form'), req('B', 'form', 'complete'), req('C', 'form', 'not_started', false), req('Submission confirmation', 'other')]).length, 1);
  assert.ok(stageBlock('submitted', { confirmed: false })); assert.ok(stageBlock('admitted', { confirmed: false })); assert.equal(stageBlock('admitted', { confirmed: true }), null);
  assert.equal(stageBlock('preparing', { confirmed: false }), null); assert.ok(stageBlock('preparing', { confirmed: true })); assert.equal(stageBlock('withdrawn', { confirmed: true }), null); assert.equal(stageBlock('withdrawn', { confirmed: false }), null);
  assert.equal(stageForDecision('admitted', 'submitted'), 'admitted'); assert.equal(stageForDecision('awaiting', 'admitted'), 'submitted'); assert.equal(stageForDecision('awaiting', 'submitted'), null);
  assert.equal(stageForDecision('interview_invited', 'submitted'), 'interview_invited'); assert.equal(stageForDecision('interview_invited', 'interview_scheduled'), null);
  assert.equal(decisionForStage('interview_completed'), 'interview_invited'); assert.equal(decisionForStage('preparing'), null); assert.equal(decisionForStage('waitlisted'), 'waitlisted');
});
test('checklist is derived from data and respects overrides', () => {
  const base = { confirmations: {}, essays: [{ title: 'E1', draft: 'one two three', word_limit: 5 }], requirements: [req('Resume', 'resume', 'not_started', true, { document_id: 'd' }), req('Academic transcripts', 'academics'), req('Application form', 'form', 'complete'), req('Application fee', 'other')], hasTestScores: true, recommendations: [{ status: 'submitted' }, { status: 'in_progress' }], feePaidExpense: false };
  const items = buildChecklist(base); const by = (id: string) => items.find((i) => i.id === id)!;
  assert.equal(by('essays').auto, 'pass'); assert.equal(by('resume').auto, 'pass'); assert.equal(by('transcripts').auto, 'fail'); assert.equal(by('test_scores').auto, 'pass');
  assert.equal(by('recommendations').auto, 'fail'); assert.match(by('recommendations').detail, /1 of 2/); assert.equal(by('form').auto, 'pass'); assert.equal(by('fee').auto, 'fail'); assert.equal(by('school_program').auto, 'unknown');
  assert.equal(checklistComplete(items), false);
  const all = buildChecklist({ ...base, confirmations: { school_program: true, transcripts: true, recommendations: true, fee: true } });
  assert.equal(checklistComplete(all), true);
  const over = buildChecklist({ ...base, essays: [{ title: 'E1', draft: 'a b c d e f', word_limit: 5 }], confirmations: { essays: true } }).find((i) => i.id === 'essays')!;
  assert.equal(over.auto, 'fail'); assert.equal(over.satisfied, false); assert.match(over.detail, /6\/5/);
  assert.equal(buildChecklist({ ...base, essays: [] }).find((i) => i.id === 'essays')!.auto, 'unknown');
  assert.equal(buildChecklist({ ...base, recommendations: [] }).find((i) => i.id === 'recommendations')!.auto, 'unknown');
  assert.equal(buildChecklist({ ...base, feePaidExpense: true }).find((i) => i.id === 'fee')!.auto, 'pass');
  assert.equal(buildChecklist({ ...base, hasTestScores: false }).find((i) => i.id === 'test_scores')!.auto, 'fail');
});
test('weighted decision matrix', () => {
  const w = { reputation: 3, career: 1 } as never; const r = { reputation: 5, career: 3 } as never;
  assert.equal(weightedTotal(r, w).score, Math.round(((15 + 3) / 4) * 100) / 100);
  // unrated criteria are ignored, not counted as zero
  assert.equal(weightedTotal({ reputation: 4 } as never, {} as never).score, 4);
  assert.equal(weightedTotal({} as never, {} as never).score, null);
  // zero weight removes a criterion
  assert.equal(weightedTotal({ reputation: 5, career: 1 } as never, { reputation: 0, career: 2 } as never).score, 1);
  assert.deepEqual(weightedTotal({ reputation: 5, fit: 2 } as never, {} as never), { score: 3.5, rated: 2, of: 9 });
  const ranked = rankOffers([{ id: 'a', score: 3 }, { id: 'b', score: 4 }, { id: 'c', score: null }, { id: 'd', score: 4 }]);
  assert.deepEqual(ranked.map((x) => [x.id, x.rank]).sort(), [['a', 3], ['b', 1], ['c', null], ['d', 1]]);
});
test('parseMatrix drops invalid values', () => {
  const m = parseMatrix({ weights: { career: 2, fit: -1, bogus: 3 }, ratings: { career: 6, fit: 4, aid: 2.5 }, inputs: { total_cost: '1000', expected_salary: 'x', currency: 'USD' } });
  assert.deepEqual(m.weights, { career: 2 }); assert.deepEqual(m.ratings, { fit: 4 }); assert.equal(m.inputs.total_cost, 1000); assert.equal(m.inputs.expected_salary, null);
  assert.deepEqual(parseMatrix(null).ratings, {});
});
test('sourced cost never guesses', () => {
  const rows = [{ field: 'tuition_total', value_num: 100, currency: 'USD', source_name: 'S1' }, { field: 'Tuition', value_num: 90, currency: 'USD', source_name: 'S2' }, { field: 'living_expenses', value_num: 40, currency: 'USD', source_name: 'S3' }, { field: 'avg_salary', value_num: null, currency: 'USD', source_name: 'S4' }];
  assert.equal(pickSourced(rows, 'tuition')?.value, 90); assert.equal(pickSourced(rows, 'salary'), null);
  assert.equal(sourcedTotalCost(pickSourced(rows, 'tuition'), pickSourced(rows, 'living')).value, 130);
  assert.equal(sourcedTotalCost({ value: 1, currency: 'USD', source: 'a' }, { value: 1, currency: 'EUR', source: 'b' }).value, null);
  assert.equal(sourcedTotalCost(null, null).value, null);
  assert.match(sourcedTotalCost({ value: 5, currency: 'USD', source: 'a' }, null).note, /Tuition only/);
});
test('task filtering and overdue', () => {
  const t = (id: string, status: Task['status'], due: string | null, app: string | null = 'a'): Task => ({ id, application_id: app, requirement_id: null, title: id, description: null, status, due_date: due, estimated_minutes: null, priority: 3, completed_at: null, source: 'manual', created_at: '' });
  const ts = [t('1', 'todo', '2026-11-10'), t('2', 'done', '2026-11-01'), t('3', 'in_progress', '2026-12-01'), t('4', 'todo', null, null)];
  assert.ok(isOverdue(ts[0], now)); assert.ok(!isOverdue(ts[1], now)); assert.ok(!isOverdue(ts[3], now));
  assert.deepEqual(filterTasks(ts, { status: 'overdue', applicationId: '' }, now).map((x) => x.id), ['1']);
  assert.deepEqual(filterTasks(ts, { status: 'open', applicationId: '' }, now).map((x) => x.id), ['1', '3', '4']);
  assert.deepEqual(filterTasks(ts, { status: 'all', applicationId: 'none' }, now).map((x) => x.id), ['4']);
  assert.equal(taskCompletedAt('todo', 'x'), null); assert.equal(taskCompletedAt('done', 'x'), 'x');
});
test('letter prompt contains only user-entered facts', () => {
  const p = buildLetterPrompt({ school: 'Alpha', program: 'MBA', achievements: ['Led a team of 4', ' '], interest: 'I like the lab', materials: '' });
  assert.match(p.prompt, /Led a team of 4/); assert.match(p.prompt, /I like the lab/); assert.match(p.prompt, /\(none provided\)/); assert.match(p.system, /only the facts/i);
  assert.match(buildLetterPrompt({ school: 'A', program: 'M', achievements: [], interest: '', materials: '' }).prompt, /\(not provided\)/);
});

/* ---- create-dialog defaults (track and country aware) */
import {
  countryCode, currencyForCountry, timezoneForSchool, defaultProgram, intakeOptions, defaultIntake, applicationPlans, UNDERGRAD_PROGRAM, TIMEZONES,
} from '../lib/applications.ts';
test('countryCode normalises free-text countries', () => {
  assert.equal(countryCode('United States'), 'US'); assert.equal(countryCode('USA'), 'US'); assert.equal(countryCode(' u.s. '), 'US');
  assert.equal(countryCode('United Kingdom'), 'UK'); assert.equal(countryCode('England'), 'UK'); assert.equal(countryCode('Australia'), 'AU');
  assert.equal(countryCode('Hong Kong'), 'HK'); assert.equal(countryCode('Switzerland'), 'CH'); assert.equal(countryCode('Atlantis'), null); assert.equal(countryCode(null), null);
});
test('currencyForCountry maps the school country to its currency', () => {
  const cases: [string, string][] = [['United States', 'USD'], ['UK', 'GBP'], ['Canada', 'CAD'], ['Australia', 'AUD'], ['Singapore', 'SGD'], ['Hong Kong', 'HKD'], ['France', 'EUR'], ['Spain', 'EUR'], ['Switzerland', 'CHF'], ['China', 'CNY']];
  for (const [c, cur] of cases) assert.equal(currencyForCountry(c), cur, c);
  assert.equal(currencyForCountry(null), 'USD'); assert.equal(currencyForCountry('Narnia'), 'USD');
});
test('timezoneForSchool uses country and city', () => {
  assert.equal(timezoneForSchool('Australia', 'Melbourne'), 'Australia/Melbourne');
  assert.equal(timezoneForSchool('Australia', 'Parkville, Victoria'), 'Australia/Melbourne');
  assert.equal(timezoneForSchool('Australia', 'Sydney'), 'Australia/Sydney'); assert.equal(timezoneForSchool('Australia', null), 'Australia/Sydney');
  assert.equal(timezoneForSchool('Australia', 'Perth, WA'), 'Australia/Perth'); assert.equal(timezoneForSchool('Australia', 'Brisbane'), 'Australia/Brisbane');
  assert.equal(timezoneForSchool('United States', 'Chicago, IL'), 'America/Chicago'); assert.equal(timezoneForSchool('United States', 'Stanford, CA'), 'America/Los_Angeles');
  assert.equal(timezoneForSchool('United States', 'Boston, MA'), 'America/New_York'); assert.equal(timezoneForSchool('United States', 'Tempe, AZ'), 'America/Phoenix');
  assert.equal(timezoneForSchool('Canada', 'Vancouver, BC'), 'America/Vancouver'); assert.equal(timezoneForSchool('Canada', 'Victoria, BC'), 'America/Vancouver'); assert.equal(timezoneForSchool('Canada', 'Toronto'), 'America/Toronto');
  assert.equal(timezoneForSchool('United Kingdom', 'London'), 'Europe/London'); assert.equal(timezoneForSchool('France', 'Fontainebleau'), 'Europe/Paris');
  assert.equal(timezoneForSchool('Singapore'), 'Asia/Singapore'); assert.equal(timezoneForSchool(null), 'America/New_York');
  for (const c of ['United States', 'UK', 'Canada', 'Australia', 'Singapore', 'Hong Kong', 'France', 'Spain', 'Switzerland', 'China', 'New Zealand', 'Japan']) assert.ok(TIMEZONES.includes(timezoneForSchool(c)), c);
});
test('defaultProgram never defaults to Full-time MBA and respects the track', () => {
  assert.equal(defaultProgram('undergrad', []), UNDERGRAD_PROGRAM);
  assert.equal(defaultProgram('undergrad', ['MBA', 'Bachelor of Commerce']), 'Bachelor of Commerce');
  assert.equal(defaultProgram('undergrad', ['Full-time MBA']), UNDERGRAD_PROGRAM);
  assert.equal(defaultProgram('grad', ['Bachelor of Arts', 'Master of Finance']), 'Master of Finance');
  assert.equal(defaultProgram('grad', [], 'mba'), 'MBA'); assert.equal(defaultProgram('grad', [], 'masters'), "Master's"); assert.equal(defaultProgram('grad', []), '');
  assert.notEqual(defaultProgram('grad', []), 'Full-time MBA');
});
test('intakeOptions: Australia uses semesters, others Fall/Spring, near starts skipped', () => {
  const today = new Date(2026, 10, 23);
  assert.deepEqual(intakeOptions('Australia', today, 3), ['Semester 1 2027 (Feb)', 'Semester 2 2027 (Jul)', 'Semester 1 2028 (Feb)']);
  assert.deepEqual(intakeOptions('United States', today, 3), ['Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(intakeOptions('United States', new Date(2026, 11, 5), 2), ['Fall 2027', 'Spring 2028']);
  assert.equal(defaultIntake('United States', 'Fall 2027', today), 'Fall 2027');
  assert.equal(defaultIntake('Australia', 'Fall 2027', today), 'Semester 1 2028 (Feb)');
  assert.equal(defaultIntake('Australia', 'Semester 2 2027 (Jul)', today), 'Semester 2 2027 (Jul)');
  assert.equal(defaultIntake('Australia', undefined, today), 'Semester 1 2027 (Feb)');
  assert.equal(defaultIntake('UK', 'Fall 2027', today), 'Fall 2027');
});
test('applicationPlans per country for undergrads', () => {
  assert.ok(applicationPlans('United States').includes('Early Action') && applicationPlans('USA').includes('Regular Decision'));
  assert.ok(applicationPlans('United Kingdom')[0].startsWith('UCAS main'));
  assert.deepEqual(applicationPlans('Australia'), []); assert.deepEqual(applicationPlans(null), []);
});
test('final checklist understands undergrad template names', () => {
  const reqs = [req('School transcripts (rapor) and translation', 'academics', 'complete'), req('English test (IELTS/TOEFL/Duolingo)', 'tests', 'complete'), req('Application form', 'form'), req('Application fee', 'other')];
  const items = buildChecklist({ confirmations: {}, essays: [], requirements: reqs, hasTestScores: false, recommendations: [], feePaidExpense: false });
  assert.equal(items.find((i) => i.id === 'transcripts')!.auto, 'pass');
  assert.equal(items.find((i) => i.id === 'test_scores')!.auto, 'pass');
});
