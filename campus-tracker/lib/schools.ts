// Pure school-research logic: field catalogue, data point validation, flags, comparison table, CSV.
import { z } from 'zod';
import { latestValidScores, type EducationRow, type GoalsRow, type TestRow } from './profile.ts';

export type FieldGroup = 'general' | 'admissions' | 'class' | 'career' | 'financial';
export const GROUP_LABEL: Record<FieldGroup, string> = { general: 'General', admissions: 'Admissions', class: 'Class profile', career: 'Career outcomes', financial: 'Financial' };
export const GROUP_ORDER: FieldGroup[] = ['general', 'admissions', 'class', 'career', 'financial'];

export interface FieldDef {
  key: string; label: string; group: FieldGroup; kind: 'num' | 'text'; unit?: string; money?: boolean; pct?: boolean;
  min?: number; max?: number; hint: string;
}
export const FIELD_CATALOGUE: FieldDef[] = [
  { key: 'ranking', label: 'Ranking', group: 'general', kind: 'num', min: 1, max: 1000, hint: 'Rank position. Put the ranking name and year in the source name, for example the publisher and list year.' },
  { key: 'duration_months', label: 'Program duration', group: 'general', kind: 'num', unit: 'months', min: 1, max: 120, hint: 'Length of the full-time program in months.' },
  { key: 'application_rounds', label: 'Application rounds', group: 'admissions', kind: 'text', hint: 'Round names for the intake you target.' },
  { key: 'application_deadlines', label: 'Application deadlines', group: 'admissions', kind: 'text', hint: 'Deadline dates exactly as published, with the intake year.' },
  { key: 'app_fee', label: 'Application fee', group: 'admissions', kind: 'num', money: true, min: 0, hint: 'Fee amount, in the currency chosen below.' },
  { key: 'essay_questions', label: 'Essay questions', group: 'admissions', kind: 'text', hint: 'Prompts as published. Do not paraphrase.' },
  { key: 'word_limits', label: 'Word limits', group: 'admissions', kind: 'text', hint: 'Word or character limits per essay.' },
  { key: 'recommendation_requirements', label: 'Recommendation requirements', group: 'admissions', kind: 'text', hint: 'Number and type of recommenders.' },
  { key: 'interview_process', label: 'Interview process', group: 'admissions', kind: 'text', hint: 'Format, invite-only or open, who interviews.' },
  { key: 'gmat_gre_requirement', label: 'GMAT/GRE requirement', group: 'admissions', kind: 'text', hint: 'Required, optional or waiver rules.' },
  { key: 'english_requirement', label: 'English requirement', group: 'admissions', kind: 'text', hint: 'Accepted tests and minimum scores or waiver rules.' },
  { key: 'avg_gmat', label: 'Average GMAT', group: 'class', kind: 'num', min: 200, max: 805, hint: 'Class average or median. Note the GMAT version in the source name if the school states it.' },
  { key: 'avg_gre', label: 'Average GRE', group: 'class', kind: 'num', min: 130, max: 340, hint: 'Use the figure the school publishes and say what it measures (total, verbal or quant) in the source name.' },
  { key: 'avg_gpa', label: 'Average GPA', group: 'class', kind: 'num', min: 0, max: 10, hint: 'Class average or median GPA.' },
  { key: 'avg_work_experience', label: 'Average work experience', group: 'class', kind: 'num', unit: 'years', min: 0, max: 40, hint: 'Years, class average or median.' },
  { key: 'class_size', label: 'Class size', group: 'class', kind: 'num', unit: 'students', min: 1, max: 5000, hint: 'Number of students in the entering class.' },
  { key: 'international_pct', label: 'International students', group: 'class', kind: 'num', unit: '%', pct: true, min: 0, max: 100, hint: 'Percent of the class, 0 to 100.' },
  { key: 'median_salary', label: 'Median salary', group: 'career', kind: 'num', money: true, min: 0, hint: 'Median base salary in the chosen currency.' },
  { key: 'employment_rate', label: 'Employment rate', group: 'career', kind: 'num', unit: '%', pct: true, min: 0, max: 100, hint: 'Percent employed within the period the school reports. Name that period in the source name.' },
  { key: 'industry_placement', label: 'Industry placement', group: 'career', kind: 'text', hint: 'Industries graduates join, with shares if published.' },
  { key: 'geographic_placement', label: 'Geographic placement', group: 'career', kind: 'text', hint: 'Regions or countries graduates work in.' },
  { key: 'recruiting_companies', label: 'Recruiting companies', group: 'career', kind: 'text', hint: 'Top employers as published, separated by commas.' },
  { key: 'internship_outcomes', label: 'Internship outcomes', group: 'career', kind: 'text', hint: 'Internship placement rate, industries or pay if published.' },
  { key: 'tuition', label: 'Tuition', group: 'financial', kind: 'num', money: true, min: 0, hint: 'Total program tuition, or state the basis in the source name.' },
  { key: 'living_expenses', label: 'Living expenses', group: 'financial', kind: 'num', money: true, min: 0, hint: 'School estimate for the whole program.' },
  { key: 'scholarships', label: 'Scholarships', group: 'financial', kind: 'text', hint: 'Scholarship availability and names as published.' },
];
export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELD_CATALOGUE.map((f) => [f.key, f]));
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'SGD', 'HKD', 'CNY', 'IDR', 'AUD', 'CAD', 'JPY', 'INR'];

export interface DataRow {
  id: string; school_id: string; field: string; value_num: number | null; value_text: string | null; currency: string | null;
  source_name: string; source_url: string; date_accessed: string; publication_year: number | null;
  verification_status: 'unverified' | 'verified' | 'outdated';
}

// ---------- flags ----------
/** A publication year is possibly outdated when it is more than 2 years before the current year. */
export const isOutdatedYear = (year: number | null | undefined, now: Date = new Date()) => year != null && now.getFullYear() - year > 2;
export interface DataFlags { unverified: boolean; outdated: boolean; outdatedByYear: boolean; yearUnknown: boolean }
export function dataFlags(r: Pick<DataRow, 'verification_status' | 'publication_year'>, now: Date = new Date()): DataFlags {
  const byYear = isOutdatedYear(r.publication_year, now);
  return { unverified: r.verification_status === 'unverified', outdated: r.verification_status === 'outdated' || byYear, outdatedByYear: byYear, yearUnknown: r.publication_year == null };
}
export const flagWords = (f: DataFlags) => [f.unverified ? 'unverified' : '', f.outdated ? 'possibly outdated' : '', f.yearUnknown ? 'year unknown' : ''].filter(Boolean);
/** A row counts as sourced only if it carries a source name and a valid URL. */
export const isSourced = (r: Pick<DataRow, 'source_name' | 'source_url'>) => r.source_name.trim().length > 0 && isHttpUrl(r.source_url);

export function isHttpUrl(s: string): boolean { try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } }

// ---------- formatting ----------
const fmtNum = (n: number, d = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n);
export function formatValue(def: FieldDef | undefined, r: Pick<DataRow, 'value_num' | 'value_text' | 'currency'>): string {
  if (r.value_num != null) {
    if (def?.money) return `${r.currency ?? ''} ${fmtNum(r.value_num)}`.trim();
    if (def?.pct) return `${fmtNum(r.value_num, 1)}%`;
    const base = fmtNum(r.value_num, r.value_num % 1 ? 2 : 0);
    return def?.unit && def.unit !== '%' ? `${base} ${def.unit}` : base;
  }
  return r.value_text ?? '';
}

// ---------- data point validation ----------
export interface DataPointInput {
  field: string; value: string; currency: string; source_name: string; source_url: string; date_accessed: string; publication_year: string; verification_status: string;
}
export type DataPointResult = { ok: true; row: { field: string; value_num: number | null; value_text: string | null; currency: string | null; source_name: string; source_url: string; date_accessed: string; publication_year: number | null; verification_status: 'unverified' | 'verified' | 'outdated' } } | { ok: false; errors: Record<string, string> };

export function validateDataPoint(inp: DataPointInput, now: Date = new Date()): DataPointResult {
  const errors: Record<string, string> = {};
  const def = FIELD_BY_KEY[inp.field];
  if (!def) errors.field = 'Choose a field';
  let value_num: number | null = null; let value_text: string | null = null;
  const v = inp.value.trim();
  if (def) {
    if (!v) errors.value = 'Enter a value';
    else if (def.kind === 'num') {
      const n = Number(v.replace(/,/g, ''));
      if (!Number.isFinite(n)) errors.value = 'Enter a number';
      else if (def.min != null && n < def.min) errors.value = `Must be at least ${def.min}`;
      else if (def.max != null && n > def.max) errors.value = `Must be at most ${def.max}`;
      else value_num = n;
    } else if (v.length > 4000) errors.value = 'Too long (max 4000 characters)';
    else value_text = v;
  }
  if (!inp.source_name.trim()) errors.source_name = 'A source name is required. Data without a source cannot be saved.';
  if (!inp.source_url.trim()) errors.source_url = 'A source URL is required. Data without a source cannot be saved.';
  else if (!isHttpUrl(inp.source_url)) errors.source_url = 'Enter a valid URL starting with http:// or https://';
  const da = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(inp.date_accessed);
  if (!da.success || Number.isNaN(Date.parse(inp.date_accessed))) errors.date_accessed = 'Enter the date you accessed the source';
  else if (inp.date_accessed > now.toISOString().slice(0, 10)) errors.date_accessed = 'Date accessed cannot be in the future';
  let publication_year: number | null = null;
  if (inp.publication_year.trim()) {
    const y = Number(inp.publication_year);
    if (!Number.isInteger(y) || y < 1990 || y > now.getFullYear() + 1) errors.publication_year = `Enter a year between 1990 and ${now.getFullYear() + 1}`;
    else publication_year = y;
  }
  const st = z.enum(['unverified', 'verified', 'outdated']).safeParse(inp.verification_status);
  if (!st.success) errors.verification_status = 'Choose a status';
  if (def?.money && value_num != null && !CURRENCIES.includes(inp.currency)) errors.currency = 'Choose a currency';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { field: inp.field, value_num, value_text, currency: def!.money ? inp.currency : null, source_name: inp.source_name.trim(), source_url: inp.source_url.trim(), date_accessed: inp.date_accessed, publication_year, verification_status: st.data! } };
}

// ---------- add school validation ----------
export const SchoolFormSchema = z.object({
  name: z.string().trim().min(1, 'School name is required').max(200),
  country: z.string().trim().max(100).optional().or(z.literal('')),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  website_url: z.string().trim().refine((s) => !s || isHttpUrl(s), 'Enter a valid URL starting with http:// or https://').optional(),
  admissions_url: z.string().trim().refine((s) => !s || isHttpUrl(s), 'Enter a valid URL starting with http:// or https://').optional(),
  program: z.string().trim().max(200).optional().or(z.literal('')),
  duration_months: z.string().trim().refine((s) => !s || (/^\d+$/.test(s) && +s >= 1 && +s <= 120), 'Whole number of months, 1 to 120').optional(),
  format: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(4000).optional(),
});

// ---------- career alignment ----------
const phrases = (s: string | null | undefined) => (s ?? '').split(/[,;/&\n]|\band\b/i).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3);
const norm = (s: string) => s.toLowerCase();
export interface Alignment { text: string; missing: boolean; flags: string[] }
/** Overlap between the applicant's career goals and the sourced recruiting/placement text of one school. */
export function careerAlignment(goals: GoalsRow | null, rows: DataRow[], now: Date = new Date()): Alignment {
  const by = (k: string) => rows.find((r) => r.field === k && isSourced(r) && r.value_text);
  const industryHay = [by('industry_placement'), by('recruiting_companies'), by('internship_outcomes')].filter(Boolean) as DataRow[];
  const geoRow = by('geographic_placement'); const coRow = by('recruiting_companies');
  const terms = [...phrases(goals?.target_industry), ...phrases(goals?.target_function)];
  const geo = phrases(goals?.target_geography); const companies = (goals?.target_companies ?? []).map((c) => c.trim()).filter(Boolean);
  if (!terms.length && !geo.length && !companies.length) return { text: 'Add target industry, function or companies in My Profile', missing: true, flags: [] };
  if (!industryHay.length && !geoRow) return { text: 'Not researched', missing: true, flags: [] };
  const hay = norm(industryHay.map((r) => r.value_text).join(' | '));
  const parts: string[] = [];
  if (terms.length && industryHay.length) { const m = terms.filter((t) => hay.includes(t)); parts.push(`Industry/function: ${m.length} of ${terms.length} goal terms found${m.length ? ` (${m.join(', ')})` : ''}`); }
  if (companies.length && coRow) { const m = companies.filter((c) => norm(coRow.value_text!).includes(norm(c))); parts.push(`Target companies: ${m.length} of ${companies.length} listed${m.length ? ` (${m.join(', ')})` : ''}`); }
  if (geo.length && geoRow) { const m = geo.filter((g) => norm(geoRow.value_text!).includes(g)); parts.push(`Geography: ${m.length} of ${geo.length} found${m.length ? ` (${m.join(', ')})` : ''}`); }
  if (!parts.length) return { text: 'Not researched for your goal areas', missing: true, flags: [] };
  const used = [...industryHay, ...(geoRow ? [geoRow] : [])];
  const flags = new Set<string>(); for (const r of used) flagWords(dataFlags(r, now)).forEach((f) => flags.add(f));
  return { text: parts.join('. '), missing: false, flags: [...flags] };
}

// ---------- comparison ----------
export interface CompareSchool { id: string; name: string; country?: string | null; location?: string | null; program?: { duration_months?: number | null; format?: string | null } | null }
export interface ApplicantMetrics { gmat: number | null; gpa: number | null; gpaScale: number | null }
export interface DeadlineInput { school_id: string; due_at: string; name: string }
export interface Cell { text: string; num?: number; currency?: string | null; missing: boolean; flags: string[]; url?: string }
export interface CompareRow { key: string; label: string; better: 'high' | 'low' | null; cells: Cell[]; best: boolean[] }
export const MAX_COMPARE = 5; export const MIN_COMPARE = 2;
const NR: Cell = { text: 'Not researched', missing: true, flags: [] };

function dataCell(def: FieldDef, r: DataRow | undefined, now: Date): Cell {
  if (!r || !isSourced(r)) return NR;
  return { text: formatValue(def, r), num: r.value_num ?? undefined, currency: r.currency, missing: false, flags: flagWords(dataFlags(r, now)), url: r.source_url };
}
export function buildComparison(inp: { schools: CompareSchool[]; data: DataRow[]; goals: GoalsRow | null; deadlines: DeadlineInput[]; applicant: ApplicantMetrics; now?: Date }): CompareRow[] {
  const now = inp.now ?? new Date();
  const get = (sid: string, f: string) => inp.data.find((r) => r.school_id === sid && r.field === f);
  const dataRow = (key: string, better: CompareRow['better']): CompareRow => ({ key, label: FIELD_BY_KEY[key].label, better, cells: inp.schools.map((s) => dataCell(FIELD_BY_KEY[key], get(s.id, key), now)), best: [] });
  const rows: CompareRow[] = [];
  rows.push(dataRow('ranking', 'low'));
  rows.push({ key: 'duration', label: 'Program duration', better: null, best: [], cells: inp.schools.map((s) => {
    const d = get(s.id, 'duration_months'); if (d && isSourced(d)) return dataCell(FIELD_BY_KEY.duration_months, d, now);
    const m = s.program?.duration_months; return m ? { text: `${m} months (entered by you, no source)`, num: m, missing: false, flags: ['unverified'] } : NR; }) });
  rows.push({ key: 'location', label: 'Location', better: null, best: [], cells: inp.schools.map((s) => { const t = [s.location, s.country].filter(Boolean).join(', '); return t ? { text: t, missing: false, flags: [] } : NR; }) });
  rows.push(dataRow('tuition', 'low'));
  rows.push(dataRow('avg_gmat', null));
  rows.push(dataRow('avg_gpa', null));
  rows.push(dataRow('class_size', null));
  rows.push(dataRow('employment_rate', 'high'));
  rows.push(dataRow('median_salary', 'high'));
  rows.push({ ...dataRow('scholarships', null), label: 'Scholarship availability' });
  rows.push({ key: 'career_alignment', label: 'Career alignment with your goals', better: null, best: [], cells: inp.schools.map((s) => { const a = careerAlignment(inp.goals, inp.data.filter((r) => r.school_id === s.id), now); return { text: a.text, missing: a.missing, flags: a.flags }; }) });
  rows.push({ key: 'deadline', label: 'Nearest application deadline', better: null, best: [], cells: inp.schools.map((s) => {
    const ds = inp.deadlines.filter((d) => d.school_id === s.id && new Date(d.due_at) >= now).sort((a, b) => a.due_at.localeCompare(b.due_at));
    if (!ds.length) return { text: 'No upcoming deadline recorded', missing: true, flags: [] };
    return { text: `${new Date(ds[0].due_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} (${ds[0].name})`, missing: false, flags: [] }; }) });
  rows.push({ key: 'competitiveness', label: 'You vs sourced averages', better: null, best: [], cells: inp.schools.map((s) => {
    const parts: string[] = []; const flags = new Set<string>();
    const g = get(s.id, 'avg_gmat'); const p = get(s.id, 'avg_gpa'); const a = inp.applicant;
    if (g && isSourced(g) && g.value_num != null && a.gmat != null) { const d = a.gmat - g.value_num; parts.push(`GMAT ${d > 0 ? '+' : ''}${d} (yours ${a.gmat} vs ${g.value_num})`); flagWords(dataFlags(g, now)).forEach((f) => flags.add(f)); }
    if (p && isSourced(p) && p.value_num != null && a.gpa != null && a.gpaScale === 4) { const d = Math.round((a.gpa - p.value_num) * 100) / 100; parts.push(`GPA ${d > 0 ? '+' : ''}${d} (yours ${a.gpa} vs ${p.value_num})`); flagWords(dataFlags(p, now)).forEach((f) => flags.add(f)); }
    if (parts.length) return { text: parts.join('; '), missing: false, flags: [...flags] };
    const schoolHas = (g && isSourced(g)) || (p && isSourced(p));
    return { text: schoolHas ? 'Add a valid GMAT or a 4.0-scale GPA in My Profile' : 'Not researched', missing: true, flags: [] }; }) });
  for (const r of rows) r.best = bestFlags(r);
  return rows;
}
/** Marks the most favourable numeric cell(s) in a row. Skipped when direction is unclear, fewer than 2 values, or currencies differ. */
export function bestFlags(r: Pick<CompareRow, 'better' | 'cells'>): boolean[] {
  const none = r.cells.map(() => false);
  if (!r.better) return none;
  const vals = r.cells.map((c) => (c.num != null && !c.missing ? c : null));
  const present = vals.filter(Boolean) as Cell[];
  if (present.length < 2) return none;
  if (new Set(present.map((c) => c.currency ?? '')).size > 1) return none;
  const target = r.better === 'high' ? Math.max(...present.map((c) => c.num!)) : Math.min(...present.map((c) => c.num!));
  if (present.every((c) => c.num === target)) return none;
  return vals.map((c) => c != null && c.num === target);
}

// ---------- CSV ----------
const csvCell = (s: string) => { const safe = /^[=+@]|^-(?!\d)/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export function comparisonToCsv(schools: { name: string }[], rows: CompareRow[]): string {
  const lines = [['Metric', ...schools.map((s) => s.name)].map(csvCell).join(',')];
  for (const r of rows) lines.push([r.label, ...r.cells.map((c) => (c.flags.length && !c.missing ? `${c.text} [${c.flags.join(', ')}]` : c.text))].map(csvCell).join(','));
  return lines.join('\r\n');
}

// ---------- research assistant context ----------
export function buildResearchContext(rows: (DataRow & { school_name: string })[], now: Date = new Date(), maxChars = 40000): { text: string; used: (DataRow & { school_name: string })[]; truncated: boolean } {
  const used: (DataRow & { school_name: string })[] = []; const lines: string[] = []; let len = 0; let truncated = false;
  for (const r of rows.filter(isSourced)) {
    const def = FIELD_BY_KEY[r.field]; const f = flagWords(dataFlags(r, now));
    const line = `- ${r.school_name} | ${def?.label ?? r.field} | ${formatValue(def, r)} | source: ${r.source_name} (${r.source_url}) | accessed ${r.date_accessed} | published ${r.publication_year ?? 'unknown'} | ${r.verification_status}${f.length ? ` | FLAGS: ${f.join(', ')}` : ''}`;
    if (len + line.length > maxChars) { truncated = true; break; }
    lines.push(line); used.push(r); len += line.length + 1;
  }
  return { text: lines.join('\n'), used, truncated };
}

/** Applicant numbers used for comparison deltas: best currently valid GMAT total, and the best GPA recorded on a 4.0 scale. */
export function applicantMetrics(tests: TestRow[], education: EducationRow[], now: Date = new Date()): ApplicantMetrics {
  const g = latestValidScores(tests, now).find((l) => l.type === 'GMAT')?.latestValid;
  const four = education.filter((e) => e.gpa != null && e.gpa_scale === 4).sort((a, b) => b.gpa! - a.gpa!)[0];
  return { gmat: g?.overall ?? null, gpa: four?.gpa ?? null, gpaScale: four ? 4 : null };
}
