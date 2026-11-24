import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datePartsError, defaultTestType, fmtMonthYear, joinDate, latestValidScores, profileCompleteness, sectionLabels, splitDate, testStatus, testTypesFor, validateTestScore, goalFields, type TestRow } from '../lib/profile.ts';
import { assess } from '../lib/competitiveness.ts';

const NOW = new Date('2026-11-23T00:00:00Z');
const t = (o: Partial<TestRow>): TestRow => ({ id: Math.random().toString(), test_type: 'IELTS', ...o });
const empty = { profile: null, education: [], tests: [], work: [], leadership: [], achievements: [], goals: null };

test('default test: IELTS for undergrads, GMAT for MBA, GRE for other grad programs', () => {
  assert.equal(defaultTestType('undergrad'), 'IELTS'); assert.equal(defaultTestType('grad', 'mba'), 'GMAT'); assert.equal(defaultTestType('grad', 'masters'), 'GRE');
  const ug = testTypesFor('undergrad'); for (const x of ['SAT', 'ACT', 'PTE', 'DUOLINGO'] as const) assert.ok(ug.includes(x)); assert.ok(!ug.includes('GMAT'));
});
test('planned test needs no date or score; past target date is flagged; taken test needs a date not in the future', () => {
  assert.deepEqual(validateTestScore({ test_type: 'IELTS', status: 'planned' }, NOW), {});
  assert.deepEqual(validateTestScore({ test_type: 'SAT', status: 'planned', test_date: '2027-03-01' }, NOW), {});
  assert.ok(validateTestScore({ test_type: 'IELTS', status: 'planned', test_date: '2025-01-01' }, NOW).test_date);
  assert.ok(validateTestScore({ test_type: 'IELTS', overall: 7 }, NOW).test_date);
  assert.ok(validateTestScore({ test_type: 'IELTS', overall: 7, test_date: '2027-01-01' }, NOW).test_date);
  assert.deepEqual(validateTestScore({ test_type: 'IELTS', overall: 7, test_date: '2026-10-01' }, NOW), {});
});
test('new test ranges', () => {
  assert.ok(validateTestScore({ test_type: 'SAT', overall: 1700, test_date: '2026-01-01' }, NOW).overall);
  assert.ok(validateTestScore({ test_type: 'ACT', overall: 40, test_date: '2026-01-01' }, NOW).overall);
  assert.ok(validateTestScore({ test_type: 'PTE', overall: 95, test_date: '2026-01-01' }, NOW).overall);
  assert.ok(validateTestScore({ test_type: 'DUOLINGO', overall: 165, test_date: '2026-01-01' }, NOW).overall);
  assert.deepEqual(validateTestScore({ test_type: 'DUOLINGO', overall: 125, test_date: '2026-01-01' }, NOW), {});
});
test('planned tests are never treated as valid scores; SAT has no expiry', () => {
  assert.equal(testStatus({ test_type: 'IELTS', status: 'planned', test_date: '2027-02-01' }, NOW), 'planned');
  assert.equal(testStatus({ test_type: 'SAT', test_date: '2015-01-01' }, NOW), 'no_rule');
  const l = latestValidScores([t({ status: 'planned', test_date: '2027-02-01' })], NOW);
  assert.equal(l[0].latestValid, null); assert.equal(l[0].planned.length, 1); assert.equal(l[0].undated.length, 0);
});
test('month and year pickers: join, partial errors, impossible dates, display', () => {
  assert.equal(joinDate('2027', '6', '', false), '2027-06-01'); assert.equal(joinDate('', '', '', true), '');
  assert.equal(datePartsError(joinDate('2027', '', '', false), false), 'Pick both the month and the year');
  assert.equal(datePartsError(joinDate('2027', '02', '', true), true), 'Pick the day, month and year');
  assert.match(datePartsError('2027-02-30', true)!, /does not exist/);
  assert.equal(datePartsError('2027-06-15', true), null);
  assert.deepEqual(splitDate('2027-06-15'), { y: '2027', m: '06', d: '15' }); assert.equal(fmtMonthYear('2027-06-01'), 'Jun 2027');
});
test('undergrad completeness: no work section, rapor grades count, planned English test is progress, no GMAT ask', () => {
  const r = profileCompleteness({ ...empty, track: 'undergrad', education: [{ id: 'e', institution: 'SMAN 3', enrollment_status: 'current', gpa: 88, gpa_scale: 100 }], tests: [t({ status: 'planned', test_date: '2027-03-01' })] }, NOW);
  assert.ok(!r.sections.some((s) => s.key === 'work'));
  assert.equal(r.sections.find((s) => s.key === 'education')!.status, 'complete');
  const ts = r.sections.find((s) => s.key === 'tests')!; assert.equal(ts.status, 'incomplete'); assert.match(ts.missing[0], /planned IELTS.*Mar 2027/);
  assert.ok(!JSON.stringify(r).match(/GMAT|Why MBA/));
  assert.equal(r.percent, Math.round(25 + 20 * 0.4)); // education 25 complete + tests 20 at 40%
  const ok = profileCompleteness({ ...empty, track: 'undergrad', tests: [t({ overall: 7, test_date: '2026-06-01' })] }, NOW);
  assert.equal(ok.sections.find((s) => s.key === 'tests')!.status, 'complete');
});
test('goal wording per track', () => {
  assert.deepEqual(goalFields('undergrad').map(([, l]) => l), ['What you want to study and why', 'What you are curious about', 'Where it might lead']);
  assert.equal(goalFields('grad', 'masters')[0][1], 'Why this degree'); assert.equal(goalFields('grad', 'mba')[0][1], 'Why MBA');
  assert.equal(sectionLabels('undergrad').goals, 'Study goals');
  const r = profileCompleteness({ ...empty, track: 'undergrad', goals: { why_mba: 'CS because I like puzzles', short_term_goal: 'AI', long_term_goal: 'Startups' } }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'goals')!.status, 'complete');
});
test('master\'s completeness accepts an English test instead of GMAT/GRE', () => {
  const r = profileCompleteness({ ...empty, track: 'grad', program: 'masters', tests: [t({ test_type: 'TOEFL', overall: 105, test_date: '2026-01-01' })] }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'tests')!.status, 'complete');
});
test('undergrad competitiveness: track dimensions only, SAT optional, essays and recommenders scored', () => {
  const d = assess({ ...empty, track: 'undergrad', schoolData: [], now: NOW });
  assert.deepEqual(d.map((x) => x.key), ['grades', 'english', 'sat', 'activities', 'essays', 'recommendations']);
  assert.ok(d.every((x) => x.score === null)); assert.equal(d.find((x) => x.key === 'sat')!.optional, true);
  const full = assess({ ...empty, track: 'undergrad', schoolData: [], now: NOW,
    education: [{ id: 'e', institution: 'S', enrollment_status: 'current', gpa: 91, gpa_scale: 100 }], tests: [t({ overall: 7, test_date: '2026-06-01' }), t({ status: 'planned' })],
    essays: [{ id: 'x', status: 'revision', words: 400 }], recommenders: [{ id: 'r', statuses: ['agreed'] }] });
  const s = Object.fromEntries(full.map((x) => [x.key, x.score]));
  assert.equal(s.grades, 5); assert.equal(s.english, 4); assert.equal(s.sat, null); assert.equal(s.essays, 4); assert.equal(s.recommendations, 3);
  const planned = assess({ ...empty, track: 'undergrad', schoolData: [], now: NOW, tests: [t({ status: 'planned', test_date: '2027-03-01' })] }).find((x) => x.key === 'english')!;
  assert.match(planned.insufficientReason!, /planned for Mar 2027/);
  assert.equal(assess({ ...empty, schoolData: [], now: NOW }).length, 9); // grad unchanged
});
