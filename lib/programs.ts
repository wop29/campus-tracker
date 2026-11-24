// Researched degree programs and what each one needs (public.program_requirements).
// Pure logic only: no React, no Supabase. Unit tested in tests/programs.test.ts.
// The shape follows the research spec: every section carries the official page it was read from.
import type { ReqCategory } from './logic/readiness.ts';

/* ------------------------------------------------------------------ types */
export type DegreeType = 'mba' | 'masters' | 'other';
export type Sourced = { value: string; source_url: string | null };
export type EnglishReq = {
  ielts_min: string | null; toefl_min: string | null; duolingo: string | null; pte_min: string | null;
  other_tests: string | null; waiver: string | null; source_url: string | null;
};
export type EssayPrompt = { prompt: string; limit: string | null; required: boolean };
export type Essays = { items: EssayPrompt[]; source_url: string | null };
export type ProgramData = {
  school: string; program_name: string; degree_type: DegreeType; format: string | null; duration: string | null; intake: string | null; program_url: string | null;
  deadlines: Sourced | null; application_fee: Sourced | null; tests: Sourced | null; english: EnglishReq | null; essays: Essays | null;
  video_assessment: Sourced | null; interview: Sourced | null; recommendations: Sourced | null; other_requirements: Sourced | null; notes: string | null;
};
/** A row of public.program_requirements as selected from the database. */
export type ProgramRow = {
  id: string; school_name: string; program_name: string; degree_type: string | null; format: string | null; duration: string | null;
  intake: string | null; program_url: string | null; data: unknown; collected_on: string;
  class_profile?: unknown; employment?: unknown;
};
export type ClassProfile = {
  class_label: string | null;
  gmat_avg: number | null; gmat_median: number | null; gmat_range: string | null;
  gmat_focus_median: number | null; gmat_focus_range: string | null;
  gre_verbal_avg: number | null; gre_quant_avg: number | null; gre_range: string | null;
  gpa_avg: number | null; gpa_range: string | null;
  work_exp_avg_years: number | null; work_exp_range: string | null;
  class_size: number | null; international_pct: number | null; women_pct: number | null; countries: number | null;
  pct_submitted_gre: number | null; source_url: string | null; source_name: string | null;
};
export type Employment = {
  report_label: string | null; employed_3_months_pct: number | null; median_base_salary: string | null; mean_base_salary: string | null;
  top_industries: string | null; top_employers: string | null; international_employed_note: string | null; source_url: string | null; source_name: string | null;
};
export type Program = ProgramData & { id: string; collected_on: string; class_profile: ClassProfile | null; employment: Employment | null };

export const PROGRAM_COLS = 'id, school_name, program_name, degree_type, format, duration, intake, program_url, data, collected_on, class_profile, employment';
export const COLLECTED_ON_LABEL = '16 Nov 2026';
export const DEGREE_LABEL: Record<DegreeType, string> = { mba: 'MBA', masters: "Master's", other: 'Other degree' };

/* ------------------------------------------------------------------ defensive parsing */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX = 4000;
/** Trimmed non-empty string (capped), else null. Numbers are accepted and turned into text. */
function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, MAX) : null;
}
/** Only http(s) links are kept, so a bad value can never become a javascript: link. */
export function safeUrl(v: unknown): string | null {
  const s = str(v);
  return s && /^https?:\/\/\S+$/i.test(s) ? s : null;
}
function sourced(v: unknown): Sourced | null {
  if (typeof v === 'string') { const s = str(v); return s ? { value: s, source_url: null } : null; }
  if (!isObj(v)) return null;
  const value = str(v.value);
  return value ? { value, source_url: safeUrl(v.source_url) } : null;
}
function english(v: unknown): EnglishReq | null {
  if (!isObj(v)) return null;
  const e: EnglishReq = {
    ielts_min: str(v.ielts_min), toefl_min: str(v.toefl_min), duolingo: str(v.duolingo), pte_min: str(v.pte_min),
    other_tests: str(v.other_tests), waiver: str(v.waiver), source_url: safeUrl(v.source_url),
  };
  return e.ielts_min || e.toefl_min || e.duolingo || e.pte_min || e.other_tests || e.waiver ? e : null;
}
function essays(v: unknown): Essays | null {
  if (!isObj(v)) return null;
  const items: EssayPrompt[] = [];
  if (Array.isArray(v.items)) {
    for (const it of v.items) {
      if (typeof it === 'string') { const p = str(it); if (p) items.push({ prompt: p, limit: null, required: true }); continue; }
      if (!isObj(it)) continue;
      const prompt = str(it.prompt);
      if (!prompt) continue;
      items.push({ prompt, limit: str(it.limit), required: it.required !== false });
    }
  }
  return { items, source_url: safeUrl(v.source_url) };
}
/** A finite number from a number or a numeric string ("3.6", "1,200"), else null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/,/g, '').replace(/%$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const PROFILE_NUMS = ['gmat_avg', 'gmat_median', 'gmat_focus_median', 'gre_verbal_avg', 'gre_quant_avg', 'gpa_avg', 'work_exp_avg_years', 'class_size', 'international_pct', 'women_pct', 'countries', 'pct_submitted_gre'] as const;
const PROFILE_STRS = ['class_label', 'gmat_range', 'gmat_focus_range', 'gre_range', 'gpa_range', 'work_exp_range', 'source_name'] as const;
/** Class profile from the class_profile column; null when nothing usable is in it. */
export function parseClassProfile(v: unknown): ClassProfile | null {
  if (!isObj(v)) return null;
  const out = { source_url: safeUrl(v.source_url) } as ClassProfile;
  for (const k of PROFILE_NUMS) out[k] = num(v[k]);
  for (const k of PROFILE_STRS) out[k] = str(v[k]);
  const hasData = PROFILE_NUMS.some((k) => out[k] != null) || ['gmat_range', 'gmat_focus_range', 'gre_range', 'gpa_range', 'work_exp_range'].some((k) => out[k as keyof ClassProfile] != null);
  return hasData ? out : null;
}
/** Employment report from the employment column; null when nothing usable is in it. */
export function parseEmployment(v: unknown): Employment | null {
  if (!isObj(v)) return null;
  const pct = num(v.employed_3_months_pct);
  const e: Employment = {
    report_label: str(v.report_label), employed_3_months_pct: pct != null && pct >= 0 && pct <= 100 ? pct : null,
    median_base_salary: str(v.median_base_salary), mean_base_salary: str(v.mean_base_salary), top_industries: str(v.top_industries),
    top_employers: str(v.top_employers), international_employed_note: str(v.international_employed_note), source_url: safeUrl(v.source_url), source_name: str(v.source_name),
  };
  return e.employed_3_months_pct != null || e.median_base_salary || e.mean_base_salary || e.top_industries || e.top_employers || e.international_employed_note ? e : null;
}

export function parseDegreeType(v: unknown): DegreeType {
  const s = (str(v) ?? '').toLowerCase();
  if (s === 'mba') return 'mba';
  if (s === 'masters' || s === "master's" || s === 'master') return 'masters';
  return 'other';
}

/** Reads one row defensively. Top-level columns win over the copy inside `data`. Returns null when unusable. */
export function parseProgram(row: ProgramRow | null | undefined): Program | null {
  if (!row || !isObj(row)) return null;
  const d = isObj(row.data) ? row.data : {};
  const program_name = str(row.program_name) ?? str(d.program_name);
  const school = str(row.school_name) ?? str(d.school);
  if (!program_name || !school) return null;
  return {
    id: String(row.id), collected_on: str(row.collected_on) ?? '2026-11-16',
    school, program_name,
    degree_type: parseDegreeType(row.degree_type ?? d.degree_type),
    format: str(row.format) ?? str(d.format), duration: str(row.duration) ?? str(d.duration), intake: str(row.intake) ?? str(d.intake),
    program_url: safeUrl(row.program_url) ?? safeUrl(d.program_url),
    deadlines: sourced(d.deadlines), application_fee: sourced(d.application_fee), tests: sourced(d.tests), english: english(d.english),
    essays: essays(d.essays), video_assessment: sourced(d.video_assessment), interview: sourced(d.interview),
    recommendations: sourced(d.recommendations), other_requirements: sourced(d.other_requirements), notes: str(d.notes),
    class_profile: parseClassProfile(row.class_profile ?? d.class_profile), employment: parseEmployment(row.employment ?? d.employment),
  };
}
export function parsePrograms(rows: unknown): Program[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => parseProgram(r as ProgramRow)).filter((p): p is Program => !!p);
}

/* ------------------------------------------------------------------ English chips */
const notAccepted = (s: string) => /^\s*not\s+accepted\b|^\s*no\s+longer\s+accepted\b|^\s*(?:the\s+school\s+)?does\s+not\s+accept\b/i.test(s);
const notStated = (s: string) => /^not\s+(stated|specified|found|published|listed)\b/i.test(s);
/**
 * The published minimum from free text, or null when the page gives no single minimum.
 * "min 135" wins; "no minimum" or "equivalent to ..." give null; otherwise a leading number ("7.0 overall", "100 iBT", "iBT 100").
 */
export function minimumScore(v: string): string | null {
  const explicit = v.match(/\bmin(?:imum)?\.?\s*(?:score\s*)?(?:of\s*)?:?\s*(\d+(?:\.\d+)?)/i);
  if (explicit) return explicit[1];
  if (/\bno\s+minimum|discourag|equivalent/i.test(v)) return null;
  return v.match(/^\s*(?:accepted\s*\(\s*)?(?:iBT\s*)?(\d+(?:\.\d+)?)/i)?.[1] ?? null;
}
function testChip(label: string, v: string | null): string | null {
  if (!v || notStated(v)) return null;
  if (notAccepted(v)) return `${label} not accepted`;
  const n = minimumScore(v);
  return n ? `${label} ${n}` : `${label} accepted`;
}
/** Short chips for the English test minimums: "IELTS 7.0", "TOEFL 100", "Duolingo 125" / "Duolingo not accepted" / "Duolingo not stated". */
export function englishSummary(p: Pick<Program, 'english'>): string[] {
  const e = p.english;
  if (!e) return ['English test not stated'];
  const out: string[] = [];
  for (const [label, v] of [['IELTS', e.ielts_min], ['TOEFL', e.toefl_min]] as const) { const c = testChip(label, v); if (c) out.push(c); }
  const d = e.duolingo;
  if (!d || notStated(d)) out.push('Duolingo not stated');
  else if (notAccepted(d)) out.push('Duolingo not accepted');
  else { const n = minimumScore(d); out.push(n ? `Duolingo ${n}` : /accept/i.test(d) ? 'Duolingo accepted' : 'Duolingo not stated'); }
  const pte = testChip('PTE', e.pte_min); if (pte) out.push(pte);
  return out;
}

/* ------------------------------------------------------------------ checklist */
export type ChecklistGroup = 'tests' | 'essays' | 'interview' | 'recommendations' | 'other' | 'deadlines';
export const GROUP_ORDER: ChecklistGroup[] = ['tests', 'essays', 'interview', 'recommendations', 'other', 'deadlines'];
export const GROUP_LABEL: Record<ChecklistGroup, string> = {
  tests: 'Tests and English', essays: 'Essays', interview: 'Interview and video', recommendations: 'Recommendations', other: 'Other', deadlines: 'Deadlines and fee',
};
export type ChecklistItem = {
  key: string; name: string; category: ReqCategory; group: ChecklistGroup; detail: string; source_url: string | null; mandatory: boolean;
  /** Only for essay items: the prompt and its parsed word limit, used to create the essay record. */
  essay?: { prompt: string; limit: string | null; word_limit: number | null; index: number };
};

const NOT_FOUND = 'We could not find this on the school\'s official pages yet. Check the program page before you submit.';
/** True only when the text clearly says the item is optional or not required, and never says it is required. */
export function clearlyOptional(v: string): boolean {
  const optional = /test[-\s]optional|\b(optional|not\s+required|not\s+mandatory)\b/i.test(v);
  const required = /\brequired\b/i.test(v.replace(/not\s+required/gi, ''));
  return optional && !required;
}
/** "none", "no video", "not stated" and similar: nothing to put on the checklist. */
const noneish = (v: string) => /^(none\b|no\b|n\/a\b|not\s+(required|stated|specified|found|published|part|mentioned|listed))/i.test(v.trim())
  || /^[^.]{0,40}\b(does\s+not\s+mention|not\s+mentioned)\b/i.test(v.trim());

/** "Essay 1: What matters most to..." from the prompt's first words. */
export function essayTitle(index: number, prompt: string): string {
  const words = prompt.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= 7) return `Essay ${index}: ${words.join(' ')}`;
  return `Essay ${index}: ${words.slice(0, 7).join(' ').replace(/[\s,.;:!?-]+$/, '')}...`;
}
/** Whole-number word limit from text like "500 words" or "up to 1,000 words"; null for characters, pages or minutes. */
export function parseWordLimit(limit: string | null | undefined): number | null {
  if (!limit) return null;
  const m = limit.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:-\s*word|words?\b)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isInteger(n) && n > 0 && n <= 100000 ? n : null;
}
function englishDetail(e: EnglishReq): string {
  const parts: string[] = [];
  if (e.ielts_min) parts.push(`IELTS: ${e.ielts_min}`);
  if (e.toefl_min) parts.push(`TOEFL: ${e.toefl_min}`);
  parts.push(`Duolingo: ${e.duolingo ?? 'not stated'}`);
  if (e.pte_min) parts.push(`PTE: ${e.pte_min}`);
  if (e.other_tests) parts.push(`Other tests: ${e.other_tests}`);
  parts.push(`Waiver: ${e.waiver ?? 'not stated'}`);
  return parts.join('\n');
}

/**
 * The program's requirements as an ordered checklist, ready to show or to turn into application_requirements rows.
 * Order: test policy, English, one item per essay prompt, video (only if one exists), interview (if described),
 * recommendations, resume, transcripts, application fee, deadline.
 */
export function requirementChecklist(p: Program): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const fallbackUrl = p.program_url;
  const other = p.other_requirements;

  // Tests
  if (p.tests) {
    const named = /\b(gmat|gre)\b/i.test(p.tests.value);
    items.push({ key: 'tests', name: named ? 'GMAT/GRE' : 'Admissions test', category: 'tests', group: 'tests', detail: p.tests.value, source_url: p.tests.source_url ?? fallbackUrl, mandatory: !clearlyOptional(p.tests.value) });
  } else {
    items.push({ key: 'tests', name: 'GMAT/GRE', category: 'tests', group: 'tests', detail: `Test policy: ${NOT_FOUND}`, source_url: fallbackUrl, mandatory: false });
  }
  // English
  if (p.english) {
    items.push({ key: 'english', name: 'English proficiency', category: 'tests', group: 'tests', detail: englishDetail(p.english), source_url: p.english.source_url ?? fallbackUrl, mandatory: true });
  } else {
    items.push({ key: 'english', name: 'English proficiency', category: 'tests', group: 'tests', detail: `English test rules: ${NOT_FOUND}`, source_url: fallbackUrl, mandatory: true });
  }
  // Essays
  (p.essays?.items ?? []).forEach((e, i) => {
    const n = i + 1;
    items.push({
      key: `essay-${n}`, name: essayTitle(n, e.prompt), category: 'essays', group: 'essays',
      detail: `${e.prompt}${e.limit ? `\nLimit: ${e.limit}` : ''}${e.required ? '' : '\n(Optional)'}`,
      source_url: p.essays?.source_url ?? fallbackUrl, mandatory: e.required,
      essay: { prompt: e.prompt, limit: e.limit, word_limit: parseWordLimit(e.limit), index: n },
    });
  });
  // Video assessment, only when the school has one
  const v = p.video_assessment;
  if (v && !noneish(v.value)) {
    items.push({ key: 'video', name: 'Video assessment', category: 'other', group: 'interview', detail: v.value, source_url: v.source_url ?? fallbackUrl, mandatory: !clearlyOptional(v.value) });
  }
  // Interview, when described (invite-only, so never blocks Ready)
  if (p.interview && !noneish(p.interview.value)) {
    items.push({ key: 'interview', name: 'Interview', category: 'other', group: 'interview', detail: p.interview.value, source_url: p.interview.source_url ?? fallbackUrl, mandatory: false });
  }
  // Recommendations
  if (p.recommendations) {
    const none = noneish(p.recommendations.value);
    items.push({ key: 'recommendations', name: 'Recommendations', category: 'recommendations', group: 'recommendations', detail: p.recommendations.value, source_url: p.recommendations.source_url ?? fallbackUrl, mandatory: !none && !clearlyOptional(p.recommendations.value) });
  } else {
    items.push({ key: 'recommendations', name: 'Recommendations', category: 'recommendations', group: 'recommendations', detail: NOT_FOUND, source_url: fallbackUrl, mandatory: false });
  }
  // Resume and transcripts (both come from other_requirements)
  const otherDetail = other ? other.value : NOT_FOUND;
  items.push({ key: 'resume', name: 'Resume', category: 'resume', group: 'other', detail: otherDetail, source_url: other?.source_url ?? fallbackUrl, mandatory: true });
  items.push({ key: 'transcripts', name: 'Academic transcripts', category: 'academics', group: 'other', detail: p.notes ? `${otherDetail}\nGood to know: ${p.notes}` : otherDetail, source_url: other?.source_url ?? fallbackUrl, mandatory: true });
  // Fee and deadline
  items.push({ key: 'fee', name: 'Application fee', category: 'other', group: 'deadlines', detail: p.application_fee?.value ?? NOT_FOUND, source_url: p.application_fee?.source_url ?? fallbackUrl, mandatory: true });
  items.push({ key: 'deadline', name: 'Pick your round and deadline', category: 'other', group: 'deadlines', detail: p.deadlines?.value ?? NOT_FOUND, source_url: p.deadlines?.source_url ?? fallbackUrl, mandatory: false });
  return items;
}

/** Checklist items grouped for display, in GROUP_ORDER, skipping empty groups. */
export function groupChecklist(items: ChecklistItem[]): { group: ChecklistGroup; label: string; items: ChecklistItem[] }[] {
  return GROUP_ORDER.map((g) => ({ group: g, label: GROUP_LABEL[g], items: items.filter((i) => i.group === g) })).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ turning a program into an application */
export type RequirementInsert = {
  key: string; name: string; category: ReqCategory; mandatory: boolean; notes: string; sort_order: number; is_default: boolean; essay_key: string | null;
};
/**
 * Rows for application_requirements. The program checklist plus the two items the app itself relies on:
 * "Application form" (submission checklist) and "Submission confirmation" (completed by the Submit step).
 * Those two stay is_default so their names cannot be edited; program items are editable.
 */
export function requirementRows(p: Program): RequirementInsert[] {
  const items = requirementChecklist(p);
  const rows: RequirementInsert[] = [];
  const push = (i: { key: string; name: string; category: ReqCategory; mandatory: boolean; notes: string; is_default: boolean; essay_key: string | null }) => rows.push({ ...i, sort_order: rows.length + 1 });
  const note = (i: ChecklistItem) => `${i.detail}${i.source_url ? `\nSource: ${i.source_url}` : ''}`.slice(0, 5000);
  for (const i of items) {
    if (i.key === 'fee') push({ key: 'form', name: 'Application form', category: 'form', mandatory: true, notes: `Fill in the online application form for ${p.program_name}.`, is_default: true, essay_key: null });
    push({ key: i.key, name: i.name, category: i.category, mandatory: i.mandatory, notes: note(i), is_default: false, essay_key: i.essay ? i.key : null });
  }
  push({ key: 'submission', name: 'Submission confirmation', category: 'other', mandatory: true, notes: 'Marked complete when you record your submission.', is_default: true, essay_key: null });
  return rows;
}
export type EssayInsert = { key: string; title: string; prompt: string; word_limit: number | null };
export function essayRows(p: Program): EssayInsert[] {
  return requirementChecklist(p).filter((i) => i.essay).map((i) => ({
    key: i.key, title: i.name.slice(0, 200), prompt: `${i.essay!.prompt}${i.essay!.limit ? `\n\nLimit: ${i.essay!.limit}` : ''}`.slice(0, 5000), word_limit: i.essay!.word_limit,
  }));
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
/** "Fall 2027", "August 2027" or "January 2028" from the program's intake text; null when there is no clear term and year. */
export function parseIntake(intake: string | null | undefined): string | null {
  if (!intake) return null;
  const m = intake.match(new RegExp(`\\b(Spring|Summer|Fall|Autumn|Winter|${MONTHS})\\b\\.?[\\s,]+(?:intake\\s+)?(20\\d{2})\\b`, 'i'));
  if (!m) return null;
  const term = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${term} ${m[2]}`;
}
const SYMBOLS: [RegExp, string][] = [[/S\$/, 'SGD'], [/HK\$/, 'HKD'], [/C\$|CA\$/, 'CAD'], [/A\$|AU\$/, 'AUD'], [/£/, 'GBP'], [/€/, 'EUR'], [/¥|RMB/, 'CNY'], [/\$/, 'USD']];
/** Fee amount and currency when the text names exactly one amount, else null (we never guess between several). */
export function parseFee(value: string | null | undefined, currencies: readonly string[]): { amount: number; currency: string } | null {
  if (!value) return null;
  const cleaned = value.replace(/\b20\d{2}\s*[-/]\s*\d{2,4}\b/g, ' ').replace(/\b(?:round|r)\s*\d\b/gi, ' ');
  const nums = [...new Set((cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))).filter((n) => n > 0 && n < 100000 && !(n >= 1900 && n <= 2100 && Number.isInteger(n))))];
  if (nums.length !== 1) return null;
  const code = value.match(/\b([A-Z]{3})\b/g)?.find((c) => currencies.includes(c));
  const currency = code ?? SYMBOLS.find(([re]) => re.test(value))?.[1];
  return currency && currencies.includes(currency) ? { amount: nums[0], currency } : null;
}

/** Programs the user can apply to on their track: grad users see MBA, master's and other degrees; the chosen program type first. */
export function programsForTrack(programs: Program[], track: 'grad' | 'undergrad', preferred?: 'mba' | 'masters' | 'phd'): Program[] {
  if (track === 'undergrad') return [];
  const rank = (d: DegreeType) => (preferred && d === preferred ? 0 : d === 'mba' ? 1 : d === 'masters' ? 2 : 3);
  return [...programs].sort((a, b) => rank(a.degree_type) - rank(b.degree_type) || a.program_name.localeCompare(b.program_name));
}

/* ------------------------------------------------------------------ how you compare (never a prediction) */
export type ScoreRange = { low: number; high: number };
/** First "low-high" pair inside the given bounds, e.g. "middle 80%: 690-770" gives 690..770. */
export function parseRange(text: string | null | undefined, min: number, max: number): ScoreRange | null {
  if (!text) return null;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/g)) {
    const low = Number(m[1]), high = Number(m[2]);
    if (low >= min && high <= max && low <= high) return { low, high };
  }
  return null;
}
/** GRE section range: the first 130-170 pair after a "V"/"Verbal" (or "Q"/"Quant") label and before the other section's label. */
export function parseGreRange(text: string | null | undefined, section: 'verbal' | 'quant'): ScoreRange | null {
  if (!text) return null;
  const mine = section === 'verbal' ? /\bV(?:erbal)?\b/i : /\bQ(?:uant(?:itative)?)?\b/i;
  const other = section === 'verbal' ? /\bQ(?:uant(?:itative)?)?\b/i : /\bV(?:erbal)?\b/i;
  const at = text.search(mine);
  if (at < 0) return null;
  const rest = text.slice(at);
  const end = rest.slice(1).search(other);
  return parseRange(end >= 0 ? rest.slice(0, end + 1) : rest, 130, 170);
}
export type Position = 'below' | 'within' | 'above';
export const positionOf = (score: number, r: ScoreRange): Position => (score < r.low ? 'below' : score > r.high ? 'above' : 'within');
export type UserScore = { test_type: string; exam_version: string | null; overall: number | null; quant: number | null; verbal: number | null };
export type Comparison = { test: string; score: string; position: Position | 'vs_median'; text: string };

/** Which GMAT scale a score is on: Focus (205-805, ends in 5) or Classic (200-800, ends in 0). */
export function gmatEdition(s: UserScore): 'focus' | 'classic' | null {
  const v = (s.exam_version ?? '').toLowerCase();
  if (v.includes('focus')) return 'focus';
  if (v.includes('classic') || v.includes('10th')) return 'classic';
  if (s.overall == null) return null;
  return s.overall % 10 === 5 ? 'focus' : s.overall % 10 === 0 ? 'classic' : null;
}
const POS_TEXT: Record<Position, string> = { below: 'below', within: 'within', above: 'above' };
/**
 * Where the user's best GMAT and GRE scores sit against the published class range (or median when no range is published).
 * Purely descriptive: it never says anything about the chance of admission.
 */
export function compareScores(cp: ClassProfile | null, scores: UserScore[]): Comparison[] {
  if (!cp) return [];
  const out: Comparison[] = [];
  const label = cp.class_label ? ` (${cp.class_label})` : '';
  const best = (list: UserScore[], key: 'overall' | 'quant' | 'verbal') => list.filter((s) => s[key] != null).sort((a, b) => (b[key] as number) - (a[key] as number))[0];
  for (const ed of ['focus', 'classic'] as const) {
    const s = best(scores.filter((x) => x.test_type === 'GMAT' && gmatEdition(x) === ed), 'overall');
    if (!s || s.overall == null) continue;
    const name = ed === 'focus' ? 'GMAT Focus' : 'GMAT';
    const range = ed === 'focus' ? parseRange(cp.gmat_focus_range, 205, 805) : parseRange(cp.gmat_range, 200, 800);
    const rangeText = ed === 'focus' ? cp.gmat_focus_range : cp.gmat_range;
    const median = ed === 'focus' ? cp.gmat_focus_median : cp.gmat_median ?? cp.gmat_avg;
    if (range) { const p = positionOf(s.overall, range); out.push({ test: name, score: String(s.overall), position: p, text: `Your ${name} ${s.overall} is ${POS_TEXT[p]} the published range ${rangeText}${label}.` }); }
    else if (median != null) {
      const word = ed === 'classic' && cp.gmat_median == null ? 'average' : 'median';
      const rel = s.overall > median ? 'above' : s.overall < median ? 'below' : 'equal to';
      out.push({ test: name, score: String(s.overall), position: 'vs_median', text: `Your ${name} ${s.overall} is ${rel} the published ${word} of ${median}${label}.` });
    }
  }
  const gre = scores.filter((x) => x.test_type === 'GRE');
  for (const section of ['verbal', 'quant'] as const) {
    const s = best(gre, section);
    const v = s?.[section];
    if (v == null) continue;
    const name = `GRE ${section === 'verbal' ? 'Verbal' : 'Quant'}`;
    const range = parseGreRange(cp.gre_range, section);
    const avg = section === 'verbal' ? cp.gre_verbal_avg : cp.gre_quant_avg;
    if (range) { const p = positionOf(v, range); out.push({ test: name, score: String(v), position: p, text: `Your ${name} ${v} is ${POS_TEXT[p]} the published range ${range.low}-${range.high}${label}.` }); }
    else if (avg != null) {
      const rel = v > avg ? 'above' : v < avg ? 'below' : 'equal to';
      out.push({ test: name, score: String(v), position: 'vs_median', text: `Your ${name} ${v} is ${rel} the published average of ${avg}${label}.` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ source and caution tags */
const THIRD_PARTY = ['clearadmit', 'poetsandquants', 'gmatclub', 'shiksha', 'topmba', 'mbacrystalball', 'wikipedia', 'linkedin', 'reddit', 'quora', 'beatthegmat', 'mbaprepadvisor', 'stratusadmissions', 'menlocoaching', 'aringo', 'fortuna-admissions', 'fortunaadmissions', 'usnews', 'businessbecause', 'findamba', 'collegedunia'];
/** "clearadmit.com" from a link; handles second-level country domains such as ox.ac.uk or nus.edu.sg. */
export function registrableDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const parts = host.replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const second = parts[parts.length - 2], last = parts[parts.length - 1];
  const take = parts.length >= 3 && last.length === 2 && ['co', 'ac', 'edu', 'com', 'org', 'gov', 'net'].includes(second) ? 3 : 2;
  return parts.slice(-take).join('.');
}
const isAcademic = (d: string) => /\.edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(d);
/** Domains the program's own requirement sections cite (those come from official pages by the research rules). */
export function officialDomains(p: Program): Set<string> {
  const urls = [p.program_url, p.deadlines?.source_url, p.application_fee?.source_url, p.tests?.source_url, p.english?.source_url, p.essays?.source_url,
    p.video_assessment?.source_url, p.interview?.source_url, p.recommendations?.source_url, p.other_requirements?.source_url];
  const out = new Set<string>();
  for (const u of urls) { const d = registrableDomain(u); if (d && !THIRD_PARTY.some((t) => d.startsWith(`${t}.`))) out.add(d); }
  return out;
}
/** The third-party site name when a source is not the school's own page, else null. Unknown or missing links give null. */
export function thirdPartySite(url: string | null | undefined, official: Set<string>): string | null {
  const d = registrableDomain(url);
  if (!d) return null;
  if (THIRD_PARTY.some((t) => d.startsWith(`${t}.`))) return d;
  if (isAcademic(d) || official.has(d)) return null;
  return d;
}
/** True when the text says it is a paraphrase rather than the official wording. */
export const isParaphrased = (text: string | null | undefined) => !!text && /paraphras/i.test(text);
/** True when the program notes say the program does not lead to a student visa (for example F-1 not sponsored). */
export function noStudentVisa(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\bno\s+(?:student\s+)?visa\b|\b(?:does\s+not|do\s+not|doesn't|cannot|can't|will\s+not|won't)\s+(?:sponsor|issue|support|qualify\s+for)\b[^.]{0,40}\b(?:visa|f-?1|i-?20|cas)\b|\b(?:f-?1|i-?20|student\s+visa|visa|cas)\b[^.]{0,30}\bnot\s+(?:sponsored|available|issued|offered|supported|eligible)\b|\bnot\s+(?:f-?1|visa)[-\s]eligible\b|\bineligible\s+for\s+(?:an?\s+)?(?:f-?1|student\s+visa|visa)\b/i.test(notes);
}
