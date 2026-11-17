// Pure scholarship logic and validation. No I/O. Unit tested in tests/finance.test.ts.
import { z } from 'zod';

export const SCHOLARSHIP_STATUSES = ['identified', 'researching', 'potentially_eligible', 'eligible', 'preparing', 'applied', 'awarded', 'rejected'] as const;
export const SCHOLARSHIP_CATEGORIES = ['merit', 'need', 'institutional', 'external', 'fellowship', 'employer'] as const;
export type ScholarshipStatus = (typeof SCHOLARSHIP_STATUSES)[number];

export type ScholarshipRow = {
  id: string; name: string; institution: string | null; school_id: string | null; amount: number | null; currency: string;
  category: string | null; eligibility: string | null; requirements: string | null; deadline: string | null; website_url: string | null;
  source_verified_on: string | null; status: string; notes: string | null; eligibility_checked: boolean; deleted_at?: string | null;
};

const MS_DAY = 86_400_000;
const toUtc = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).getTime();
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysUntil = (date: string | null | undefined, today: string): number | null => (date ? Math.round((toUtc(date) - toUtc(today)) / MS_DAY) : null);

/** Statuses where a deadline no longer needs attention. */
const DEADLINE_DONE: string[] = ['applied', 'awarded', 'rejected'];
export type DeadlineFlag = 'overdue' | 'soon' | null;
export function deadlineFlag(s: Pick<ScholarshipRow, 'deadline' | 'status'>, today: string): DeadlineFlag {
  if (!s.deadline || DEADLINE_DONE.includes(s.status)) return null;
  const d = daysUntil(s.deadline, today)!;
  return d < 0 ? 'overdue' : d <= 14 ? 'soon' : null;
}

export type VerifyFlag = 'missing' | 'stale' | 'ok';
/** Stale when the verification date is more than 12 calendar months before today. */
export function verificationFlag(verifiedOn: string | null | undefined, today: string): VerifyFlag {
  if (!verifiedOn) return 'missing';
  const t = new Date(`${today}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() - 1);
  return toUtc(verifiedOn) < t.getTime() ? 'stale' : 'ok';
}

export type Filters = { status: string; category: string; schoolId: string; window: 'all' | 'overdue' | '7' | '14' | '30' | '90' | 'none'; search: string };
export const defaultFilters: Filters = { status: '', category: '', schoolId: '', window: 'all', search: '' };
export function filterScholarships(rows: ScholarshipRow[], f: Filters, today: string): ScholarshipRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (r.deleted_at) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.schoolId === 'none' ? r.school_id != null : f.schoolId && r.school_id !== f.schoolId) return false;
    if (f.window !== 'all') {
      const d = daysUntil(r.deadline, today);
      if (f.window === 'none') { if (r.deadline) return false; }
      else if (d == null) return false;
      else if (f.window === 'overdue') { if (d >= 0) return false; }
      else if (d < 0 || d > Number(f.window)) return false;
    }
    if (q && ![r.name, r.institution, r.eligibility, r.requirements, r.notes].some((x) => x?.toLowerCase().includes(q))) return false;
    return true;
  });
}

export type SortKey = 'deadline' | 'name' | 'amount' | 'status';
export function sortScholarships(rows: ScholarshipRow[], key: SortKey, dir: 'asc' | 'desc'): ScholarshipRow[] {
  const m = dir === 'asc' ? 1 : -1;
  const out = [...rows];
  out.sort((a, b) => {
    // Missing values always sort last regardless of direction.
    const av = key === 'name' ? a.name.toLowerCase() : key === 'status' ? SCHOLARSHIP_STATUSES.indexOf(a.status as ScholarshipStatus) : key === 'amount' ? a.amount : a.deadline;
    const bv = key === 'name' ? b.name.toLowerCase() : key === 'status' ? SCHOLARSHIP_STATUSES.indexOf(b.status as ScholarshipStatus) : key === 'amount' ? b.amount : b.deadline;
    if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
    return av < bv ? -m : av > bv ? m : 0;
  });
  return out;
}

export type CompareGroup = { schoolId: string | null; count: number; totalsByCurrency: Record<string, number>; withoutAmount: number };
/** Per-school totals, one subtotal per currency. Currencies are never combined (no fx rate is stored on scholarships). */
export function compareBySchool(rows: ScholarshipRow[]): CompareGroup[] {
  const map = new Map<string, CompareGroup>();
  for (const r of rows) {
    if (r.deleted_at) continue;
    const k = r.school_id ?? 'none';
    const g = map.get(k) ?? { schoolId: r.school_id, count: 0, totalsByCurrency: {}, withoutAmount: 0 }; map.set(k, g);
    g.count++;
    if (r.amount == null) g.withoutAmount++; else { const c = r.currency.toUpperCase(); g.totalsByCurrency[c] = (g.totalsByCurrency[c] ?? 0) + r.amount; }
  }
  return [...map.values()];
}
export function totalsByCurrency(rows: { amount: number | null; currency: string }[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows) if (r.amount != null) { const c = r.currency.toUpperCase(); t[c] = (t[c] ?? 0) + r.amount; }
  return t;
}

// ---------- Validation ----------
const optText = (max: number) => z.preprocess((v) => (v === '' || v == null ? null : v), z.string().trim().max(max).nullable());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Use a valid date');
const optDate = z.preprocess((v) => (v === '' || v == null ? null : v), isoDate.nullable());
const optMoney = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number({ error: 'Amount must be a number' }).min(0, 'Amount cannot be negative').finite().nullable());

export const scholarshipSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  institution: optText(200),
  school_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()),
  amount: optMoney,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code such as USD').transform((s) => s.toUpperCase()),
  category: z.preprocess((v) => (v === '' ? null : v), z.enum(SCHOLARSHIP_CATEGORIES).nullable()),
  eligibility: optText(4000), requirements: optText(4000),
  deadline: optDate,
  website_url: z.preprocess((v) => (v === '' || v == null ? null : v), z.string().trim().url('Enter a full URL starting with https://').refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://').nullable()),
  source_verified_on: optDate,
  status: z.enum(SCHOLARSHIP_STATUSES),
  notes: optText(4000),
});
export type ScholarshipInput = z.infer<typeof scholarshipSchema>;

export const scholarshipApplicationSchema = z.object({
  application_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()),
  status: z.string().trim().min(1, 'Status is required').max(60),
  applied_at: optDate, decision_at: optDate, awarded_amount: optMoney,
  notes: optText(2000),
}).superRefine((v, ctx) => {
  if (v.applied_at && v.decision_at && v.decision_at < v.applied_at) ctx.addIssue({ code: 'custom', path: ['decision_at'], message: 'Decision date cannot be before the applied date' });
});

// ---------- AI helper (stored record only) ----------
export const AI_SYSTEM = [
  'You help an MBA applicant decide whether a scholarship record they saved is worth investigating further.',
  'Use ONLY the fields in the record provided. Never invent scholarships, amounts, deadlines, URLs, eligibility rules or selection criteria.',
  'Do NOT assume the applicant is eligible. Eligibility text is the applicant\'s own note and may be incomplete or outdated.',
  'Explain in a short list why the record may be worth investigating and list what is missing or unverified.',
  'State plainly that eligibility must be checked against the published requirements from the official source before relying on it.',
  'If you want to suggest other scholarships, do not name any; instead tell the applicant what kind of sources and search terms to research.',
].join(' ');
export function buildInvestigatePrompt(r: ScholarshipRow, today: string): string {
  const v = verificationFlag(r.source_verified_on, today);
  const lines: [string, string | number | null][] = [
    ['Name', r.name], ['Institution', r.institution], ['Category', r.category], ['Amount', r.amount == null ? null : `${r.amount} ${r.currency}`], ['Deadline', r.deadline],
    ['Eligibility (applicant-entered)', r.eligibility], ['Application requirements (applicant-entered)', r.requirements], ['Website', r.website_url],
    ['Source verified on', r.source_verified_on], ['Source verification status', v === 'ok' ? 'verified within 12 months' : v === 'stale' ? 'older than 12 months' : 'no verification date'],
    ['Pipeline status', r.status], ['Applicant confirmed eligibility', r.eligibility_checked ? 'yes' : 'no'], ['Applicant notes', r.notes],
  ];
  return `Today is ${today}. Saved scholarship record (fields shown as "not provided" are empty):\n` + lines.map(([k, val]) => `- ${k}: ${val == null || val === '' ? 'not provided' : val}`).join('\n') + '\n\nWhy might this be worth investigating, and what should I verify first?';
}
