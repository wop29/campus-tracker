import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToBase, budgetSummary, breakdown, sumInCurrency, csvCell, expensesToCsv, expenseSchema, assumptionsSchema, computeInvestment, emptyAssumptions, loanPayment, paybackLabel, sourcedValue, parseAssumptions, countCostApplications, type ExpenseRow, type Assumptions } from '../lib/finance.ts';
import { deadlineFlag, verificationFlag, filterScholarships, sortScholarships, compareBySchool, scholarshipSchema, scholarshipApplicationSchema, buildInvestigatePrompt, defaultFilters, daysUntil, type ScholarshipRow } from '../lib/scholarships.ts';

const ex = (o: Partial<ExpenseRow>): ExpenseRow => ({ id: 'x', school_id: null, application_id: null, category: 'application_fee', description: null, estimated_cost: null, actual_cost: null, currency: 'USD', fx_rate_to_base: null, fx_rate_date: null, payment_date: null, payment_status: 'planned', notes: null, ...o });
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('convertToBase: same currency, rate, missing rate', () => {
  assert.equal(convertToBase(100, 'usd', 'USD', null), 100);
  assert.equal(convertToBase(100, 'IDR', 'USD', 0.00006), 0.006);
  assert.equal(convertToBase(100, 'EUR', 'USD', null), null);
  assert.equal(convertToBase(100, 'EUR', 'USD', 0), null);
  assert.equal(convertToBase(null, 'USD', 'USD', null), null);
});
test('budget: planned/spent/outstanding/remaining in base', () => {
  const s = budgetSummary([
    ex({ estimated_cost: 250, actual_cost: 250, payment_status: 'paid' }),
    ex({ estimated_cost: 100, payment_status: 'planned' }),
    ex({ estimated_cost: 50, payment_status: 'due' }),
    ex({ estimated_cost: 999, payment_status: 'refunded' }),
    ex({ estimated_cost: 5, payment_status: 'planned', deleted_at: '2026-01-01' }),
  ], 'USD', 2);
  assert.equal(s.planned.base, 400); assert.equal(s.spent.base, 250); assert.equal(s.remainingBase, 150);
  assert.equal(s.outstanding.base, 150); assert.equal(s.futurePlanned.base, 100); assert.equal(s.due.base, 50);
  assert.equal(s.refundedCount, 1); assert.equal(s.costPerApplication, 125);
});
test('budget: cost per application hidden (null) when n = 0 and no divide by zero', () => {
  const s = budgetSummary([ex({ actual_cost: 10, estimated_cost: 10, payment_status: 'paid' })], 'USD', 0);
  assert.equal(s.costPerApplication, null);
});
test('budget: mixed currency without rate stays separate and flags missing', () => {
  const s = budgetSummary([
    ex({ estimated_cost: 100, currency: 'USD' }),
    ex({ estimated_cost: 80, currency: 'EUR' }),
    ex({ estimated_cost: 100, currency: 'GBP', fx_rate_to_base: 1.25, fx_rate_date: '2026-10-01' }),
  ], 'USD', 1);
  assert.equal(s.planned.base, 225);
  assert.deepEqual(s.planned.byCurrency, { USD: 100, EUR: 80, GBP: 100 });
  assert.deepEqual(s.planned.missingRate, { EUR: 80 }); assert.equal(s.planned.missingRateCount, 1);
});
test('budget: paid without actual is counted, not invented; incomplete cost per application flagged', () => {
  const s = budgetSummary([ex({ estimated_cost: 90, payment_status: 'paid' }), ex({ actual_cost: 40, currency: 'EUR', payment_status: 'paid' })], 'USD', 1);
  assert.equal(s.paidWithoutActual, 1); assert.equal(s.spent.base, 0); assert.equal(s.costPerApplicationIncomplete, true);
});
test('budget: empty list', () => { const s = budgetSummary([], 'USD', 0); assert.equal(s.planned.base, 0); assert.equal(s.remainingBase, 0); });
test('countCostApplications excludes researching and deleted', () => {
  assert.equal(countCostApplications([{ stage: 'researching' }, { stage: 'submitted' }, { stage: 'preparing', deleted_at: 'x' }, { stage: 'shortlisted' }]), 2);
});
test('breakdown by category and school uses base-convertible rows only', () => {
  const rows = [ex({ category: 'test_fee', actual_cost: 200, payment_status: 'paid', school_id: 'a' }), ex({ category: 'test_fee', actual_cost: 50, payment_status: 'paid', school_id: 'b' }), ex({ category: 'other', actual_cost: 10, currency: 'EUR', payment_status: 'paid' }), ex({ category: 'other', estimated_cost: 5 })];
  const c = breakdown(rows, 'USD', 'category', 'spent'); assert.equal(c.slices.length, 1); assert.equal(c.slices[0].value, 250); assert.equal(c.excluded, 1);
  const s = breakdown(rows, 'USD', 'school', 'spent', (id) => id.toUpperCase()); assert.equal(s.slices[0].label, 'A');
  assert.equal(breakdown(rows, 'USD', 'category', 'planned').slices.find((x) => x.key === 'other')?.value, 5);
  assert.deepEqual(breakdown([], 'USD', 'category', 'spent').slices, []);
});
test('sumInCurrency never mixes currencies', () => {
  const r = sumInCurrency([{ amount: 100, currency: 'USD' }, { amount: 50, currency: 'eur' }, { amount: null, currency: 'USD' }, { amount: 25, currency: 'usd' }], 'USD');
  assert.equal(r.total, 125); assert.deepEqual(r.excluded, { EUR: 50 });
});
test('csv escaping and formula guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(csvCell(null), ''); assert.equal(csvCell(0), '0');
  const csv = expensesToCsv([ex({ description: 'GMAT, retake', estimated_cost: 275 })], () => 'School', () => '');
  assert.ok(csv.split('\r\n')[1].includes('"GMAT, retake"'));
});
test('expense schema validates', () => {
  const ok = { school_id: '', application_id: '', category: 'test_fee', description: '', estimated_cost: '100', actual_cost: '', currency: 'eur', fx_rate_to_base: '1.1', fx_rate_date: '2026-10-01', payment_date: '', payment_status: 'planned', notes: '' };
  const r = expenseSchema.safeParse(ok); assert.ok(r.success); assert.equal(r.data.currency, 'EUR'); assert.equal(r.data.school_id, null);
  assert.ok(!expenseSchema.safeParse({ ...ok, estimated_cost: '-1' }).success);
  assert.ok(!expenseSchema.safeParse({ ...ok, currency: 'US' }).success);
  assert.ok(!expenseSchema.safeParse({ ...ok, fx_rate_to_base: '0' }).success);
  assert.ok(!expenseSchema.safeParse({ ...ok, payment_date: '2026-02-31' }).success);
  assert.ok(!expenseSchema.safeParse({ ...ok, estimated_cost: '', actual_cost: '' }).success);
  assert.ok(!expenseSchema.safeParse({ ...ok, fx_rate_to_base: '' }).success, 'date without rate');
});

const A = (o: Partial<Assumptions>): Assumptions => ({ ...emptyAssumptions('USD'), ...o });
test('loanPayment standard amortisation and zero rate', () => {
  const l = loanPayment(100000, 6, 10)!; near(l.monthlyPayment, 1110.2050, 1e-3); near(l.totalInterest, l.monthlyPayment * 120 - 100000);
  const z = loanPayment(1200, 0, 1)!; assert.equal(z.monthlyPayment, 100); assert.equal(z.totalInterest, 0);
  assert.equal(loanPayment(0, 5, 5), null); assert.equal(loanPayment(1000, 5, 0), null);
});
test('investment: totals, borrowing, uplift, payback, 10-year net (no loan inputs)', () => {
  const r = computeInvestment(A({ tuition: 150000, living: 50000, otherEducation: 10000, opportunityCost: 100000, scholarships: 40000, personalFunds: 20000, preSalary: 80000, expectedSalary: 160000 }));
  assert.equal(r.grossCost, 310000); assert.equal(r.totalInvestment, 270000); assert.equal(r.cashCost, 170000); assert.equal(r.borrowing, 150000);
  assert.equal(r.annualUplift, 80000); assert.deepEqual(r.payback, { kind: 'years', years: 270000 / 80000 }); assert.equal(r.tenYearNet, 800000 - 270000);
  assert.ok(r.notes.some((n) => /loan interest rate/i.test(n)));
});
test('investment: loan interest increases outlay', () => {
  const r = computeInvestment(A({ tuition: 100000, personalFunds: 0, preSalary: 50000, expectedSalary: 100000, loanRate: 6, loanTermYears: 10 }));
  assert.equal(r.borrowing, 100000); assert.ok(r.financingCost > 0);
  assert.equal(r.payback.kind, 'years'); if (r.payback.kind === 'years') near(r.payback.years, (100000 + r.financingCost) / 50000);
});
test('investment: tax rate reduces uplift', () => {
  const r = computeInvestment(A({ tuition: 100000, preSalary: 50000, expectedSalary: 100000, taxRate: 40 })); assert.equal(r.annualUplift, 30000);
});
test('investment: zero uplift and negative uplift give no payback, no divide by zero', () => {
  const z = computeInvestment(A({ tuition: 1000, preSalary: 5000, expectedSalary: 5000 })); assert.deepEqual(z.payback, { kind: 'none' }); assert.equal(paybackLabel(z.payback), 'No payback at these assumptions');
  const n = computeInvestment(A({ tuition: 1000, preSalary: 9000, expectedSalary: 5000 })); assert.deepEqual(n.payback, { kind: 'none' }); assert.equal(n.annualUplift, -4000); assert.equal(n.tenYearNet, -40000 - 1000);
});
test('investment: zero borrowing has no loan and no financing cost', () => {
  const r = computeInvestment(A({ tuition: 10000, personalFunds: 50000, loanRate: 5, loanTermYears: 5, preSalary: 1, expectedSalary: 20001 }));
  assert.equal(r.borrowing, 0); assert.equal(r.loan, null); assert.equal(r.financingCost, 0);
});
test('investment: missing inputs yield null, not zero', () => {
  const e = computeInvestment(A({})); assert.equal(e.totalInvestment, null); assert.equal(e.borrowing, null); assert.deepEqual(e.payback, { kind: 'unknown' }); assert.equal(e.tenYearNet, null);
  const noSalary = computeInvestment(A({ tuition: 100 })); assert.equal(noSalary.annualUplift, null); assert.equal(paybackLabel(noSalary.payback), 'Not enough inputs');
});
test('investment: costs fully covered by scholarships gives zero-year payback and note', () => {
  const r = computeInvestment(A({ tuition: 1000, scholarships: 1500, preSalary: 1, expectedSalary: 100 }));
  assert.equal(r.totalInvestment, -500); assert.deepEqual(r.payback, { kind: 'years', years: 0 }); assert.ok(r.notes.some((n) => /exceed/i.test(n)));
});
test('investment: scholarships in another currency are excluded via sumInCurrency, not added', () => {
  const s = sumInCurrency([{ amount: 20000, currency: 'USD' }, { amount: 10000, currency: 'EUR' }], 'USD');
  const r = computeInvestment(A({ tuition: 100000, scholarships: s.total })); assert.equal(r.totalInvestment, 80000); assert.deepEqual(s.excluded, { EUR: 10000 });
});
test('assumptions schema and parse', () => {
  assert.ok(assumptionsSchema.safeParse({ ...emptyAssumptions(), tuition: '100' }).success);
  assert.ok(!assumptionsSchema.safeParse({ ...emptyAssumptions(), tuition: '-5' }).success);
  assert.ok(!assumptionsSchema.safeParse({ ...emptyAssumptions(), loanRate: '150' }).success);
  assert.ok(!assumptionsSchema.safeParse({ ...emptyAssumptions(), currency: 'DOLLAR' }).success);
  const p = parseAssumptions({ currency: 'eur', tuition: 5, living: 'abc', preSalary: -1 }); assert.equal(p.currency, 'EUR'); assert.equal(p.tuition, 5); assert.equal(p.living, null); assert.equal(p.preSalary, null);
  assert.equal(parseAssumptions(null).currency, 'USD');
});
test('sourcedValue requires numeric value and a source', () => {
  const row = (o: object) => ({ field: 'tuition_per_year', value_num: 100, currency: 'usd', source_name: 'School site', source_url: 'https://x.edu', date_accessed: '2026-09-01', verification_status: 'unverified', ...o });
  assert.equal(sourcedValue([row({})], 'tuition')?.value, 100);
  assert.equal(sourcedValue([row({})], 'tuition')?.currency, 'USD');
  assert.equal(sourcedValue([row({ source_name: ' ' })], 'tuition'), null);
  assert.equal(sourcedValue([row({ value_num: null })], 'tuition'), null);
  assert.equal(sourcedValue([row({})], 'salary'), null);
  assert.equal(sourcedValue([row({ field: 'median_salary' })], 'salary')?.field, 'median_salary');
});

// ---- scholarships ----
const sc = (o: Partial<ScholarshipRow>): ScholarshipRow => ({ id: 's', name: 'N', institution: null, school_id: null, amount: null, currency: 'USD', category: null, eligibility: null, requirements: null, deadline: null, website_url: null, source_verified_on: null, status: 'identified', notes: null, eligibility_checked: false, ...o });
const TODAY = '2026-11-16';
test('daysUntil', () => { assert.equal(daysUntil('2026-11-17', TODAY), 1); assert.equal(daysUntil('2026-11-15', TODAY), -1); assert.equal(daysUntil(null, TODAY), null); });
test('deadline flags: overdue, within 14 days, boundary, closed statuses', () => {
  assert.equal(deadlineFlag(sc({ deadline: '2026-11-15' }), TODAY), 'overdue');
  assert.equal(deadlineFlag(sc({ deadline: '2026-11-16' }), TODAY), 'soon');
  assert.equal(deadlineFlag(sc({ deadline: '2026-11-30' }), TODAY), 'soon');
  assert.equal(deadlineFlag(sc({ deadline: '2026-12-01' }), TODAY), null);
  assert.equal(deadlineFlag(sc({ deadline: '2026-11-01', status: 'applied' }), TODAY), null);
  assert.equal(deadlineFlag(sc({}), TODAY), null);
});
test('verification flags: missing, stale over 12 months, ok', () => {
  assert.equal(verificationFlag(null, TODAY), 'missing');
  assert.equal(verificationFlag('2025-11-16', TODAY), 'ok');
  assert.equal(verificationFlag('2025-11-15', TODAY), 'stale');
  assert.equal(verificationFlag('2026-01-01', TODAY), 'ok');
});
test('filter and search', () => {
  const rows = [sc({ id: '1', name: 'Alpha Fellowship', status: 'applied', category: 'fellowship', school_id: 'a', deadline: '2026-11-20' }), sc({ id: '2', name: 'Beta', eligibility: 'Women in tech', deadline: '2026-10-01' }), sc({ id: '3', name: 'Gamma', deadline: null, deleted_at: 'x' })];
  const f = (o: object) => filterScholarships(rows, { ...defaultFilters, ...o }, TODAY).map((r) => r.id);
  assert.deepEqual(f({}), ['1', '2']); assert.deepEqual(f({ status: 'applied' }), ['1']); assert.deepEqual(f({ category: 'fellowship' }), ['1']);
  assert.deepEqual(f({ schoolId: 'a' }), ['1']); assert.deepEqual(f({ schoolId: 'none' }), ['2']);
  assert.deepEqual(f({ window: '7' }), ['1']); assert.deepEqual(f({ window: 'overdue' }), ['2']);
  assert.deepEqual(f({ search: 'women' }), ['2']);
});
test('sort puts missing values last in both directions', () => {
  const rows = [sc({ id: 'a', amount: null }), sc({ id: 'b', amount: 5 }), sc({ id: 'c', amount: 10 })];
  assert.deepEqual(sortScholarships(rows, 'amount', 'asc').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortScholarships(rows, 'amount', 'desc').map((r) => r.id), ['c', 'b', 'a']);
});
test('compareBySchool keeps currencies separate', () => {
  const g = compareBySchool([sc({ school_id: 'a', amount: 10 }), sc({ school_id: 'a', amount: 5, currency: 'eur' }), sc({ school_id: 'a', amount: null }), sc({ school_id: null, amount: 1 })]);
  const a = g.find((x) => x.schoolId === 'a')!; assert.deepEqual(a.totalsByCurrency, { USD: 10, EUR: 5 }); assert.equal(a.withoutAmount, 1); assert.equal(a.count, 3);
});
test('scholarship schema validation', () => {
  const ok = { name: 'X', institution: '', school_id: '', amount: '1000', currency: 'usd', category: 'merit', eligibility: '', requirements: '', deadline: '2026-12-01', website_url: 'https://a.edu/x', source_verified_on: '', status: 'identified', notes: '' };
  const r = scholarshipSchema.safeParse(ok); assert.ok(r.success); assert.equal(r.data.currency, 'USD');
  assert.ok(!scholarshipSchema.safeParse({ ...ok, name: ' ' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, amount: '-1' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, website_url: 'not a url' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, website_url: 'javascript:alert(1)' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, deadline: '2026-13-01' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, currency: 'US' }).success);
  assert.ok(!scholarshipSchema.safeParse({ ...ok, status: 'won' }).success);
});
test('scholarship application schema: decision not before applied', () => {
  const b = { application_id: '', status: 'applied', applied_at: '2026-11-10', decision_at: '2026-11-01', awarded_amount: '', notes: '' };
  assert.ok(!scholarshipApplicationSchema.safeParse(b).success);
  assert.ok(scholarshipApplicationSchema.safeParse({ ...b, decision_at: '2026-12-01' }).success);
  assert.ok(!scholarshipApplicationSchema.safeParse({ ...b, decision_at: '', awarded_amount: '-3' }).success);
});
test('AI prompt contains only stored fields and flags unverified/eligibility', () => {
  const p = buildInvestigatePrompt(sc({ name: 'Zeta Award', eligibility: 'mine' }), TODAY);
  assert.ok(p.includes('Zeta Award')); assert.ok(p.includes('no verification date')); assert.ok(p.includes('Applicant confirmed eligibility: no')); assert.ok(p.includes('Amount: not provided'));
});
