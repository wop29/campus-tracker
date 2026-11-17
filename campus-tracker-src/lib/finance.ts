// Pure finance calculations and validation. No I/O. Unit tested in tests/finance.test.ts.
import { z } from 'zod';

export const EXPENSE_CATEGORIES = ['application_fee', 'test_fee', 'test_prep', 'transcript', 'credential_evaluation', 'english_test', 'interview_travel', 'campus_visit', 'other'] as const;
export const PAYMENT_STATUSES = ['planned', 'due', 'paid', 'refunded'] as const;
export const DEFAULT_BASE_CURRENCY = 'USD';

export type ExpenseRow = {
  id: string; school_id: string | null; application_id: string | null; category: string; description: string | null;
  estimated_cost: number | null; actual_cost: number | null; currency: string; fx_rate_to_base: number | null; fx_rate_date: string | null;
  payment_date: string | null; payment_status: string; notes: string | null; deleted_at?: string | null;
};

const cur = (c: string | null | undefined) => (c ?? '').trim().toUpperCase();
const numOrNull = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Converts to base only when currencies match or a positive recorded rate exists. Otherwise null (never guess). */
export function convertToBase(amount: number | null | undefined, currency: string, base: string, fx: number | null | undefined): number | null {
  const a = numOrNull(amount); if (a == null) return null;
  if (cur(currency) === cur(base)) return a;
  const r = numOrNull(fx);
  return r != null && r > 0 ? a * r : null;
}

export type Totals = {
  /** Sum of rows that could be expressed in the base currency (same currency, or recorded fx rate). */
  base: number;
  /** Native-currency subtotals of every row. */
  byCurrency: Record<string, number>;
  /** Native sums of foreign-currency rows with no fx rate; these are NOT in `base`. */
  missingRate: Record<string, number>;
  missingRateCount: number;
  count: number;
};
export const emptyTotals = (): Totals => ({ base: 0, byCurrency: {}, missingRate: {}, missingRateCount: 0, count: 0 });
export function addToTotals(t: Totals, amount: number | null | undefined, currency: string, base: string, fx: number | null | undefined): Totals {
  const a = numOrNull(amount); if (a == null) return t;
  const c = cur(currency);
  t.count += 1;
  t.byCurrency[c] = (t.byCurrency[c] ?? 0) + a;
  const conv = convertToBase(a, c, base, fx);
  if (conv == null) { t.missingRate[c] = (t.missingRate[c] ?? 0) + a; t.missingRateCount += 1; } else t.base += conv;
  return t;
}

const live = (rows: ExpenseRow[]) => rows.filter((r) => !r.deleted_at);

export type BudgetSummary = {
  base: string;
  planned: Totals; spent: Totals; outstanding: Totals; futurePlanned: Totals; due: Totals;
  remainingBase: number; remainingByCurrency: Record<string, number>;
  rowsWithoutEstimate: number; paidWithoutActual: number; refundedCount: number;
  applicationsCounted: number; costPerApplication: number | null; costPerApplicationIncomplete: boolean;
};

/**
 * planned = estimated_cost of non-refunded rows. spent = actual_cost of paid rows (matches Overview).
 * outstanding = estimated_cost of planned + due rows. futurePlanned = estimated_cost of planned rows only.
 * remaining = planned - spent (can be negative). Rows lacking an fx rate are excluded from base totals and listed per currency.
 */
export function budgetSummary(expenses: ExpenseRow[], base: string, applicationsCounted: number): BudgetSummary {
  const rows = live(expenses);
  const planned = emptyTotals(), spent = emptyTotals(), outstanding = emptyTotals(), futurePlanned = emptyTotals(), due = emptyTotals();
  let rowsWithoutEstimate = 0, paidWithoutActual = 0, refundedCount = 0;
  for (const r of rows) {
    if (r.payment_status === 'refunded') { refundedCount++; continue; }
    if (r.estimated_cost == null) rowsWithoutEstimate++; else addToTotals(planned, r.estimated_cost, r.currency, base, r.fx_rate_to_base);
    if (r.payment_status === 'paid') {
      if (r.actual_cost == null) paidWithoutActual++; else addToTotals(spent, r.actual_cost, r.currency, base, r.fx_rate_to_base);
    } else if (r.payment_status === 'planned' || r.payment_status === 'due') {
      addToTotals(outstanding, r.estimated_cost, r.currency, base, r.fx_rate_to_base);
      if (r.payment_status === 'planned') addToTotals(futurePlanned, r.estimated_cost, r.currency, base, r.fx_rate_to_base);
      else addToTotals(due, r.estimated_cost, r.currency, base, r.fx_rate_to_base);
    }
  }
  const remainingByCurrency: Record<string, number> = {};
  for (const c of new Set([...Object.keys(planned.byCurrency), ...Object.keys(spent.byCurrency)])) remainingByCurrency[c] = (planned.byCurrency[c] ?? 0) - (spent.byCurrency[c] ?? 0);
  const n = Math.max(0, Math.floor(applicationsCounted));
  return {
    base: cur(base), planned, spent, outstanding, futurePlanned, due,
    remainingBase: planned.base - spent.base, remainingByCurrency, rowsWithoutEstimate, paidWithoutActual, refundedCount,
    applicationsCounted: n, costPerApplication: n > 0 ? spent.base / n : null, costPerApplicationIncomplete: spent.missingRateCount > 0,
  };
}

/** Count applications that are not deleted and have moved beyond 'researching'. */
export function countCostApplications(apps: { stage: string; deleted_at?: string | null }[]): number {
  return apps.filter((a) => !a.deleted_at && a.stage !== 'researching').length;
}

export type Slice = { key: string; label: string; value: number };
/** Spend or planned totals grouped by category or school, in base currency only. Rows without a usable rate are counted in `excluded`. */
export function breakdown(expenses: ExpenseRow[], base: string, by: 'category' | 'school', basis: 'spent' | 'planned', schoolName: (id: string) => string = (id) => id): { slices: Slice[]; excluded: number } {
  const map = new Map<string, Slice>(); let excluded = 0;
  for (const r of live(expenses)) {
    if (r.payment_status === 'refunded') continue;
    if (basis === 'spent' && r.payment_status !== 'paid') continue;
    const amt = basis === 'spent' ? r.actual_cost : r.estimated_cost;
    if (amt == null) continue;
    const v = convertToBase(amt, r.currency, base, r.fx_rate_to_base);
    if (v == null) { excluded++; continue; }
    const key = by === 'category' ? r.category : (r.school_id ?? 'none');
    const label = by === 'category' ? r.category : r.school_id ? schoolName(r.school_id) : 'No school';
    const cur0 = map.get(key) ?? { key, label, value: 0 }; cur0.value += v; map.set(key, cur0);
  }
  return { slices: [...map.values()].sort((a, b) => b.value - a.value), excluded };
}

/** Sums only amounts in the target currency; other currencies are reported separately and never added in. */
export function sumInCurrency(items: { amount: number | null | undefined; currency: string }[], target: string): { total: number; excluded: Record<string, number> } {
  let total = 0; const excluded: Record<string, number> = {};
  for (const i of items) {
    const a = numOrNull(i.amount); if (a == null) continue;
    if (cur(i.currency) === cur(target)) total += a; else excluded[cur(i.currency)] = (excluded[cur(i.currency)] ?? 0) + a;
  }
  return { total, excluded };
}

// ---------- CSV ----------
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function expensesToCsv(rows: ExpenseRow[], schoolName: (id: string | null) => string, appLabel: (id: string | null) => string): string {
  const head = ['School', 'Application', 'Category', 'Description', 'Estimated cost', 'Actual cost', 'Currency', 'FX rate to base', 'FX rate date', 'Payment date', 'Payment status', 'Notes'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push([schoolName(r.school_id), appLabel(r.application_id), r.category, r.description, r.estimated_cost, r.actual_cost, r.currency, r.fx_rate_to_base, r.fx_rate_date, r.payment_date, r.payment_status, r.notes].map(csvCell).join(','));
  return lines.join('\r\n');
}

// ---------- Validation ----------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Use a valid date');
const optDate = z.preprocess((v) => (v === '' || v == null ? null : v), isoDate.nullable());
const optMoney = (label: string) => z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`).finite().nullable());
export const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code such as USD').transform((s) => s.toUpperCase());

export const expenseSchema = z.object({
  school_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()),
  application_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()),
  category: z.enum(EXPENSE_CATEGORIES, { error: 'Choose a category' }),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500).nullable()),
  estimated_cost: optMoney('Estimated cost'),
  actual_cost: optMoney('Actual cost'),
  currency: currencyCode,
  fx_rate_to_base: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number({ error: 'FX rate must be a number' }).gt(0, 'FX rate must be greater than 0').finite().nullable()),
  fx_rate_date: optDate,
  payment_date: optDate,
  payment_status: z.enum(PAYMENT_STATUSES),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(2000).nullable()),
}).superRefine((v, ctx) => {
  if (v.estimated_cost == null && v.actual_cost == null) ctx.addIssue({ code: 'custom', path: ['estimated_cost'], message: 'Enter an estimated or actual cost' });
  if (v.fx_rate_date && v.fx_rate_to_base == null) ctx.addIssue({ code: 'custom', path: ['fx_rate_to_base'], message: 'Enter the rate that goes with this date' });
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

// ---------- MBA investment ----------
export const SCENARIOS = ['optimistic', 'base', 'conservative'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type Assumptions = {
  currency: string;
  tuition: number | null; living: number | null; otherEducation: number | null; opportunityCost: number | null;
  scholarships: number | null; personalFunds: number | null;
  expectedSalary: number | null; preSalary: number | null;
  loanRate: number | null; loanTermYears: number | null; taxRate: number | null;
};
export const ASSUMPTION_NUMBER_KEYS = ['tuition', 'living', 'otherEducation', 'opportunityCost', 'scholarships', 'personalFunds', 'expectedSalary', 'preSalary', 'loanRate', 'loanTermYears', 'taxRate'] as const;
export const emptyAssumptions = (currency = DEFAULT_BASE_CURRENCY): Assumptions => ({ currency, tuition: null, living: null, otherEducation: null, opportunityCost: null, scholarships: null, personalFunds: null, expectedSalary: null, preSalary: null, loanRate: null, loanTermYears: null, taxRate: null });

const nn = (label: string, max?: number) => z.preprocess((v) => (v === '' || v == null ? null : Number(v)), (max != null ? z.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(max, `${label} must be at most ${max}`) : z.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`)).finite().nullable());
export const assumptionsSchema = z.object({
  currency: currencyCode,
  tuition: nn('Tuition'), living: nn('Living expenses'), otherEducation: nn('Other education expenses'), opportunityCost: nn('Opportunity cost'),
  scholarships: nn('Scholarships'), personalFunds: nn('Personal funds'), expectedSalary: nn('Expected post-MBA salary'), preSalary: nn('Pre-MBA salary'),
  loanRate: nn('Loan interest rate', 100), loanTermYears: nn('Loan term', 50), taxRate: nn('Tax rate', 100),
});

/** Reads a jsonb blob defensively; unknown or malformed values become null. */
export function parseAssumptions(raw: unknown, fallbackCurrency = DEFAULT_BASE_CURRENCY): Assumptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const a = emptyAssumptions(typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency) ? o.currency.toUpperCase() : fallbackCurrency);
  for (const k of ASSUMPTION_NUMBER_KEYS) { const n = numOrNull(o[k]); a[k] = n != null && n >= 0 ? n : null; }
  return a;
}

export type Payback = { kind: 'years'; years: number } | { kind: 'none' } | { kind: 'unknown' };
export type InvestmentResult = {
  grossCost: number | null;      // tuition + living + other + opportunity cost (before scholarships)
  totalInvestment: number | null; // grossCost - scholarships
  cashCost: number | null;        // tuition + living + other - scholarships, floored at 0 (what could need funding)
  borrowing: number | null;       // max(0, cashCost - personalFunds)
  loan: { monthlyPayment: number; annualPayment: number; totalInterest: number } | null;
  financingCost: number;          // total loan interest (0 when no loan inputs)
  grossUplift: number | null;     // expected - pre salary, before tax
  annualUplift: number | null;    // after tax when a tax rate is given
  payback: Payback;               // (totalInvestment + interest) / annualUplift
  tenYearNet: number | null;      // 10 * annualUplift - (totalInvestment + interest)
  notes: string[];
};

/** Standard amortised loan. rate is an annual percent. */
export function loanPayment(principal: number, annualRatePct: number, termYears: number): { monthlyPayment: number; annualPayment: number; totalInterest: number } | null {
  if (!(principal > 0) || !(termYears > 0) || annualRatePct < 0) return null;
  const n = Math.round(termYears * 12); if (n < 1) return null;
  const r = annualRatePct / 100 / 12;
  const m = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  return { monthlyPayment: m, annualPayment: m * 12, totalInterest: m * n - principal };
}

export function computeInvestment(a: Assumptions): InvestmentResult {
  const notes: string[] = [];
  const costParts = [a.tuition, a.living, a.otherEducation, a.opportunityCost];
  const anyCost = costParts.some((x) => x != null);
  const z = (x: number | null) => x ?? 0;
  const grossCost = anyCost ? costParts.reduce<number>((s, x) => s + z(x), 0) : null;
  const totalInvestment = grossCost == null ? null : grossCost - z(a.scholarships);
  const cashParts = [a.tuition, a.living, a.otherEducation];
  const cashCost = cashParts.some((x) => x != null) ? Math.max(0, cashParts.reduce<number>((s, x) => s + z(x), 0) - z(a.scholarships)) : null;
  const borrowing = cashCost == null ? null : Math.max(0, cashCost - z(a.personalFunds));
  if (totalInvestment != null && totalInvestment < 0) notes.push('Scholarships exceed total costs in these inputs; check the scholarship amount.');
  if (a.opportunityCost == null && anyCost) notes.push('Opportunity cost is blank, so total investment excludes foregone salary.');

  let loan: InvestmentResult['loan'] = null;
  if (borrowing != null && borrowing > 0) {
    if (a.loanRate != null && a.loanTermYears != null) {
      loan = loanPayment(borrowing, a.loanRate, a.loanTermYears);
      if (!loan) notes.push('Loan term must be greater than 0 to calculate financing cost.');
    } else notes.push('Add a loan interest rate and term to include financing cost. Until then payback excludes interest.');
  }
  const financingCost = loan?.totalInterest ?? 0;

  const grossUplift = a.expectedSalary != null && a.preSalary != null ? a.expectedSalary - a.preSalary : null;
  if (grossUplift == null) notes.push('Enter both pre-MBA and expected post-MBA salary to calculate uplift and payback.');
  const tax = a.taxRate ?? 0;
  const annualUplift = grossUplift == null ? null : grossUplift > 0 ? grossUplift * (1 - tax / 100) : grossUplift;
  if (a.taxRate == null && grossUplift != null) notes.push('No tax rate entered: uplift is pre-tax.');

  let payback: Payback = { kind: 'unknown' }; let tenYearNet: number | null = null;
  if (annualUplift != null && totalInvestment != null) {
    const outlay = totalInvestment + financingCost;
    tenYearNet = annualUplift * 10 - outlay;
    if (annualUplift <= 0) payback = { kind: 'none' };
    else payback = { kind: 'years', years: outlay <= 0 ? 0 : outlay / annualUplift };
  }
  return { grossCost, totalInvestment, cashCost, borrowing, loan, financingCost, grossUplift, annualUplift, payback, tenYearNet, notes };
}

export const paybackLabel = (p: Payback): string => (p.kind === 'none' ? 'No payback at these assumptions' : p.kind === 'unknown' ? 'Not enough inputs' : p.years === 0 ? 'Costs already covered' : `${p.years.toFixed(1)} years`);

export const INVESTMENT_FORMULA = [
  'Total investment = tuition + living + other education + opportunity cost - scholarships.',
  'Borrowing = max(0, tuition + living + other education - scholarships - personal funds). Opportunity cost is foregone pay, so it is not borrowed.',
  'Loan interest = standard amortised loan over your term at your rate.',
  'Annual uplift = (expected post-MBA salary - pre-MBA salary) x (1 - tax rate). Tax is ignored unless you enter a rate.',
  'Payback (years) = (total investment + loan interest) / annual uplift. 10-year net benefit = 10 x annual uplift - (total investment + loan interest).',
  'No discounting, salary growth, bonuses or job-search gaps are modelled.',
];

// ---------- Sourced prefill from school_admissions_data ----------
export type AdmissionsDatum = { field: string; value_num: number | null; currency: string | null; source_name: string; source_url: string; date_accessed: string; verification_status: string };
export type SourcedValue = { value: number; currency: string | null; field: string; sourceName: string; sourceUrl: string; dateAccessed: string; verificationStatus: string };
const FIELD_PATTERNS: Record<'tuition' | 'living' | 'salary', RegExp> = { tuition: /tuition/i, living: /living/i, salary: /salary/i };
/** Only returns rows that carry a numeric value and a named source. Field names are free text, so matching is by keyword and the UI shows the exact field. */
export function sourcedValue(rows: AdmissionsDatum[], kind: keyof typeof FIELD_PATTERNS): SourcedValue | null {
  const hit = rows.filter((r) => FIELD_PATTERNS[kind].test(r.field) && r.value_num != null && r.value_num >= 0 && r.source_name?.trim() && r.source_url?.trim()).sort((a, b) => a.field.localeCompare(b.field))[0];
  return hit ? { value: Number(hit.value_num), currency: hit.currency ? cur(hit.currency) : null, field: hit.field, sourceName: hit.source_name, sourceUrl: hit.source_url, dateAccessed: hit.date_accessed, verificationStatus: hit.verification_status } : null;
}
