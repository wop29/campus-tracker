import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestValidScores, testExpiry, testStatus, validateTestScore, profileCompleteness, verifyKey, type TestRow } from '../lib/profile.ts';
import { assess, workMonths } from '../lib/competitiveness.ts';

const NOW = new Date('2026-06-15T00:00:00Z');
const t = (o: Partial<TestRow>): TestRow => ({ id: Math.random().toString(), test_type: 'GMAT', ...o });

test('test validity: GMAT/GRE 5 years, TOEFL/IELTS 2 years', () => {
  assert.equal(testExpiry({ test_type: 'GMAT', test_date: '2022-03-01' }), '2027-03-01');
  assert.equal(testStatus({ test_type: 'GMAT', test_date: '2021-06-14' }, NOW), 'expired');
  assert.equal(testStatus({ test_type: 'GMAT', test_date: '2021-06-15' }, NOW), 'valid');
  assert.equal(testStatus({ test_type: 'IELTS', test_date: '2024-06-14' }, NOW), 'expired');
  assert.equal(testStatus({ test_type: 'TOEFL', test_date: '2024-07-01' }, NOW), 'valid');
  assert.equal(testStatus({ test_type: 'GRE', test_date: null }, NOW), 'undated');
  assert.equal(testStatus({ test_type: 'OTHER', test_date: '2000-01-01' }, NOW), 'no_rule');
});
test('latest valid score skips expired and picks the newest valid attempt', () => {
  const r = latestValidScores([t({ overall: 700, test_date: '2019-01-01' }), t({ overall: 650, test_date: '2024-01-01', attempt_number: 1 }), t({ overall: 680, test_date: '2025-02-01', attempt_number: 2 })], NOW);
  assert.equal(r.length, 1); assert.equal(r[0].latestValid?.overall, 680); assert.equal(r[0].expired.length, 1);
});
test('latest valid is null when only expired', () => {
  const r = latestValidScores([t({ overall: 700, test_date: '2019-01-01' })], NOW);
  assert.equal(r[0].latestValid, null);
});
test('score validation by test type', () => {
  assert.ok(validateTestScore({ test_type: 'GMAT', exam_version: 'Focus Edition', overall: 900 }).overall);
  assert.deepEqual(validateTestScore({ test_type: 'GMAT', exam_version: 'Focus Edition', overall: 645, quant: 80, test_date: '2025-01-01' }, NOW), {});
  assert.ok(validateTestScore({ test_type: 'GMAT', exam_version: 'Classic (10th Edition)', quant: 70, overall: 700 }).quant);
  assert.ok(validateTestScore({ test_type: 'GRE', verbal: 120, quant: 160 }).verbal);
  assert.ok(validateTestScore({ test_type: 'IELTS', overall: 9.5 }).overall);
  assert.ok(validateTestScore({ test_type: 'TOEFL' }).overall);
});

const emptyIn = { profile: null, education: [], tests: [], work: [], leadership: [], achievements: [], goals: null };
test('completeness: empty profile is 0 and all sections missing', () => {
  const r = profileCompleteness(emptyIn, NOW); assert.equal(r.percent, 0); assert.ok(r.sections.every((s) => s.status === 'missing'));
});
test('completeness: statuses incomplete / needs_verification / complete', () => {
  const edu = { id: 'e1', institution: 'U', degree: 'BSc', major: 'X', country: 'ID', graduation_date: '2019-01-01', gpa: 3.5, gpa_scale: 4, enrollment_status: 'completed' as const };
  let r = profileCompleteness({ ...emptyIn, education: [{ ...edu, gpa: null }] }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'education')!.status, 'incomplete');
  r = profileCompleteness({ ...emptyIn, education: [edu] }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'education')!.status, 'complete');
  r = profileCompleteness({ ...emptyIn, education: [edu], verification: { [verifyKey('education', 'e1')]: true } }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'education')!.status, 'needs_verification');
  assert.equal(r.percent, Math.round((15 * 0.8 / 100) * 100));
});
test('completeness: tests incomplete when only expired', () => {
  const r = profileCompleteness({ ...emptyIn, tests: [t({ overall: 700, test_date: '2019-01-01' })] }, NOW);
  const s = r.sections.find((x) => x.key === 'tests')!; assert.equal(s.status, 'incomplete'); assert.match(s.missing[0], /expired/);
});
test('completeness: stale verification keys for deleted items are ignored', () => {
  const r = profileCompleteness({ ...emptyIn, verification: { 'work:ghost': true } }, NOW);
  assert.equal(r.sections.find((s) => s.key === 'work')!.status, 'missing');
});

test('competitiveness: insufficient data yields null score, never zero', () => {
  const d = assess({ ...emptyIn, schoolData: [], now: NOW });
  assert.equal(d.length, 9); assert.ok(d.every((x) => x.score === null && x.insufficientReason));
});
test('competitiveness: academics and test scored by documented rules', () => {
  const d = assess({ ...emptyIn, education: [{ id: 'e', institution: 'U', gpa: 3.6, gpa_scale: 4, enrollment_status: 'completed' }], tests: [t({ overall: 740, exam_version: 'Classic (10th Edition)', test_date: '2025-01-01' })], schoolData: [], now: NOW });
  assert.equal(d.find((x) => x.key === 'academics')!.score, 5); // 0.9
  const g = d.find((x) => x.key === 'test')!; assert.equal(g.score, 5); // (740-200)/600 = 0.9
  assert.match(g.expectations[0], /No sourced school data/);
});
test('competitiveness: expired test is insufficient', () => {
  const g = assess({ ...emptyIn, tests: [t({ overall: 740, test_date: '2015-01-01' })], schoolData: [], now: NOW }).find((x) => x.key === 'test')!;
  assert.equal(g.score, null); assert.match(g.insufficientReason!, /expired/);
});
test('competitiveness: work months merges overlaps', () => {
  const m = workMonths([{ id: '1', company: 'A', position: 'p', start_date: '2020-01-01', end_date: '2022-01-01' }, { id: '2', company: 'B', position: 'p', start_date: '2021-01-01', end_date: '2023-01-01' }], NOW);
  assert.equal(m, 36);
});
test('competitiveness: school expectations only from sourced rows', () => {
  const row = { id: 'x', school_id: 's', school_name: 'S', field: 'avg_gpa', value_num: 3.7, value_text: null, currency: null, source_name: 'Report', source_url: 'https://e.com', date_accessed: '2026-01-01', publication_year: 2025, verification_status: 'unverified' as const };
  const bad = { ...row, source_url: 'nope' };
  const a = assess({ ...emptyIn, education: [{ id: 'e', institution: 'U', gpa: 3.2, gpa_scale: 4, enrollment_status: 'completed' }], schoolData: [row, bad], now: NOW }).find((x) => x.key === 'academics')!;
  assert.equal(a.expectations.length, 1); assert.match(a.expectations[0], /3.7/); assert.match(a.expectations[0], /unverified/);
});
