import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataPoint, isOutdatedYear, dataFlags, buildComparison, bestFlags, comparisonToCsv, careerAlignment, buildResearchContext, applicantMetrics, FIELD_CATALOGUE, isHttpUrl, type DataRow, type DataPointInput } from '../lib/schools.ts';

const NOW = new Date('2026-06-15T00:00:00Z');
const good: DataPointInput = { field: 'avg_gmat', value: '700', currency: 'USD', source_name: 'Class profile', source_url: 'https://school.edu/profile', date_accessed: '2026-05-01', publication_year: '2025', verification_status: 'unverified' };
const row = (school_id: string, field: string, o: Partial<DataRow> = {}): DataRow => ({ id: school_id + field, school_id, field, value_num: null, value_text: null, currency: null, source_name: 'S', source_url: 'https://x.org', date_accessed: '2026-01-01', publication_year: 2026, verification_status: 'verified', ...o });

test('catalogue has required fields and unique keys', () => {
  const keys = FIELD_CATALOGUE.map((f) => f.key); assert.equal(new Set(keys).size, keys.length);
  for (const k of ['avg_gmat', 'avg_gre', 'avg_gpa', 'avg_work_experience', 'class_size', 'international_pct', 'median_salary', 'employment_rate', 'tuition', 'living_expenses', 'app_fee', 'essay_questions', 'word_limits', 'recommendation_requirements', 'interview_process', 'gmat_gre_requirement', 'english_requirement', 'scholarships', 'recruiting_companies', 'industry_placement', 'geographic_placement', 'internship_outcomes', 'duration_months', 'ranking']) assert.ok(keys.includes(k), k);
});
test('validateDataPoint accepts a good row', () => { const r = validateDataPoint(good, NOW); assert.equal(r.ok, true); if (r.ok) { assert.equal(r.row.value_num, 700); assert.equal(r.row.currency, null); } });
test('validateDataPoint refuses missing source or bad url', () => {
  let r = validateDataPoint({ ...good, source_name: ' ' }, NOW); assert.ok(!r.ok && r.errors.source_name);
  r = validateDataPoint({ ...good, source_url: '' }, NOW); assert.ok(!r.ok && r.errors.source_url);
  r = validateDataPoint({ ...good, source_url: 'javascript:alert(1)' }, NOW); assert.ok(!r.ok && r.errors.source_url);
  assert.equal(isHttpUrl('ftp://x.com'), false);
});
test('validateDataPoint checks ranges, future dates and money currency', () => {
  assert.ok(!validateDataPoint({ ...good, value: '900' }, NOW).ok);
  assert.ok(!validateDataPoint({ ...good, value: 'abc' }, NOW).ok);
  assert.ok(!validateDataPoint({ ...good, date_accessed: '2027-01-01' }, NOW).ok);
  assert.ok(!validateDataPoint({ ...good, publication_year: '1900' }, NOW).ok);
  const m = validateDataPoint({ ...good, field: 'tuition', value: '120,000', currency: 'EUR' }, NOW); assert.ok(m.ok && m.row.currency === 'EUR' && m.row.value_num === 120000);
  const t = validateDataPoint({ ...good, field: 'essay_questions', value: 'Why MBA?' }, NOW); assert.ok(t.ok && t.row.value_text === 'Why MBA?' && t.row.value_num === null);
  assert.ok(!validateDataPoint({ ...good, field: 'nope' }, NOW).ok);
});
test('outdated: more than 2 years old', () => {
  assert.equal(isOutdatedYear(2023, NOW), true); assert.equal(isOutdatedYear(2024, NOW), false); assert.equal(isOutdatedYear(null, NOW), false);
  const f = dataFlags({ verification_status: 'unverified', publication_year: 2020 }, NOW); assert.ok(f.unverified && f.outdated && f.outdatedByYear);
  assert.equal(dataFlags({ verification_status: 'outdated', publication_year: 2026 }, NOW).outdated, true);
});

const schools = [{ id: 'a', name: 'A', location: 'X', country: 'US' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
test('best flags: direction, ties, missing and mixed currencies', () => {
  const c = (num: number | undefined, cur = 'USD') => ({ text: String(num), num, currency: cur, missing: num == null, flags: [] as string[] });
  assert.deepEqual(bestFlags({ better: 'low', cells: [c(10), c(5), c(undefined)] }), [false, true, false]);
  assert.deepEqual(bestFlags({ better: 'high', cells: [c(10), c(5)] }), [true, false]);
  assert.deepEqual(bestFlags({ better: 'low', cells: [c(5), c(5)] }), [false, false]);
  assert.deepEqual(bestFlags({ better: 'low', cells: [c(10), c(5, 'EUR')] }), [false, false]);
  assert.deepEqual(bestFlags({ better: 'low', cells: [c(5), c(undefined)] }), [false, false]);
  assert.deepEqual(bestFlags({ better: null, cells: [c(1), c(2)] }), [false, false]);
});
test('buildComparison: missing shows Not researched, deltas only when both exist, nearest deadline', () => {
  const data = [row('a', 'avg_gmat', { value_num: 700 }), row('b', 'tuition', { value_num: 100000, currency: 'USD' }), row('a', 'tuition', { value_num: 90000, currency: 'USD' })];
  const rows = buildComparison({ schools, data, goals: null, applicant: { gmat: 720, gpa: null, gpaScale: null }, now: NOW,
    deadlines: [{ school_id: 'a', due_at: '2026-09-01T00:00:00Z', name: 'R1' }, { school_id: 'a', due_at: '2026-08-01T00:00:00Z', name: 'Early' }, { school_id: 'a', due_at: '2026-01-01T00:00:00Z', name: 'Past' }] });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.avg_gmat.cells[1].text, 'Not researched');
  assert.match(by.competitiveness.cells[0].text, /GMAT \+20/);
  assert.equal(by.competitiveness.cells[1].text, 'Not researched');
  assert.match(by.deadline.cells[0].text, /Early/); assert.equal(by.deadline.cells[1].missing, true);
  assert.deepEqual(by.tuition.best, [true, false, false]);
  assert.equal(by.ranking.cells[0].text, 'Not researched');
});
test('buildComparison: unsourced rows are treated as not researched', () => {
  const rows = buildComparison({ schools: schools.slice(0, 2), data: [row('a', 'avg_gmat', { value_num: 700, source_url: '' })], goals: null, deadlines: [], applicant: { gmat: 700, gpa: null, gpaScale: null }, now: NOW });
  assert.equal(rows.find((r) => r.key === 'avg_gmat')!.cells[0].text, 'Not researched');
});
test('career alignment: overlap, no data, no goals', () => {
  const rows = [row('a', 'industry_placement', { value_text: 'Consulting 30%, Technology 25%, Financial Services 20%' }), row('a', 'recruiting_companies', { value_text: 'McKinsey, Google' })];
  const a = careerAlignment({ target_industry: 'Technology, Healthcare', target_function: 'Strategy', target_companies: ['Google', 'Stripe'] }, rows, NOW);
  assert.match(a.text, /1 of 3 goal terms found \(technology\)/); assert.match(a.text, /1 of 2 listed \(Google\)/);
  assert.equal(careerAlignment({ target_industry: 'Tech' }, [], NOW).text, 'Not researched');
  assert.match(careerAlignment(null, rows, NOW).text, /Add target/);
});
test('csv export escapes quotes, commas and formula characters', () => {
  const rows = [{ key: 'k', label: 'Metric, one', better: null, best: [false], cells: [{ text: '=SUM(A1)', missing: false, flags: ['unverified'] }, { text: 'He said "hi"', missing: false, flags: [] }] }];
  const csv = comparisonToCsv([{ name: 'A' }, { name: 'B' }], rows);
  assert.equal(csv, 'Metric,A,B\r\n"Metric, one",\'=SUM(A1) [unverified],"He said ""hi"""');
});
test('research context includes only sourced rows and flags outdated ones', () => {
  const r = buildResearchContext([{ ...row('a', 'avg_gmat', { value_num: 700, publication_year: 2020 }), school_name: 'A' }, { ...row('a', 'avg_gpa', { value_num: 3.5, source_url: 'bad' }), school_name: 'A' }], NOW);
  assert.equal(r.used.length, 1); assert.match(r.text, /possibly outdated/);
});
test('applicant metrics: valid GMAT only and 4.0-scale GPA only', () => {
  const m = applicantMetrics([{ id: '1', test_type: 'GMAT', overall: 700, test_date: '2019-01-01' }, { id: '2', test_type: 'GMAT', overall: 660, test_date: '2025-01-01' }], [{ id: 'e', institution: 'U', gpa: 3.4, gpa_scale: 4, enrollment_status: 'completed' }, { id: 'f', institution: 'V', gpa: 85, gpa_scale: 100, enrollment_status: 'completed' }], NOW);
  assert.deepEqual(m, { gmat: 660, gpa: 3.4, gpaScale: 4 });
  assert.deepEqual(applicantMetrics([], [], NOW), { gmat: null, gpa: null, gpaScale: null });
});
