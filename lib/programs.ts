// Researched degree programs and what each one needs (public.program_requirements).
// Pure logic only: no React, no Supabase. Unit tested in tests/programs.test.ts.
// The shape follows the research spec: every section carries the official page it was read from.
import type { ReqCategory } from './logic/readiness.ts';

/* ------------------------------------------------------------------ types */
export type DegreeType = 'mba' | 'masters' | 'other' | 'undergrad';
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
export type Money = { amount: number; currency: string; basis: string | null; year: string | null; source_url: string | null };
export type Cost = { tuition: Money | null; living: Money | null; notes: string | null };
export type Scholarship = { name: string; amount: string | null; eligibility: string | null; international_ok: boolean | null; source_url: string | null };
export type Lpdp = { on_list: boolean | null; list_name: string | null; notes: string | null; source_url: string | null };
/** Optional extras other research passes may fill. All of them may be missing. */
export type ProgramExtras = {
  cost: Cost | null; fee_waiver: Sourced | null; scholarships: Scholarship[]; lpdp: Lpdp | null;
  application_system: string | null; aid_policy: Sourced | null;
  /** Caution flags read from the raw research notes before they are cleaned for display. */
  paraphrased: { notes: boolean; essays: boolean };
};
export type Program = ProgramData & ProgramExtras & { id: string; collected_on: string; class_profile: ClassProfile | null; employment: Employment | null };

export const PROGRAM_COLS = 'id, school_name, program_name, degree_type, format, duration, intake, program_url, data, collected_on, class_profile, employment';
export const COLLECTED_ON_LABEL = '16 Nov 2026';
export const DEGREE_LABEL: Record<DegreeType, string> = { mba: 'MBA', masters: "Master's", other: 'Other degree', undergrad: "Bachelor's" };

/* ------------------------------------------------------------------ cleaning research text for students */
// Research notes sometimes describe how a page was read ("not in the fetched page text"). Students should never see that.
const RESEARCH_NOISE: RegExp[] = [
  /\bnot\s+(?:present|found|visible|captured|included|shown)\s+in\s+the\s+(?:retrievable\s+|fetched\s+|extracted\s+)?page/i,
  /\bretrievable\b/i, /\bpage\s+labels?\s+(?:conflict|differ)/i, /\bfetched\b/i, /\bsnippets?\b/i, /\bpage\s+text\b/i,
  /\bpage\s+extraction\b/i, /\bextraction\b/i, /\bnot\s+captured\b/i, /\bscrap(?:e|ed|er|ing)\b/i, /\bpage\s+body\b/i,
  /\bsearch\s+results?\b/i, /\binternal\s+notes?\b/i,
];
const noisy = (s: string) => RESEARCH_NOISE.some((re) => re.test(s));
/**
 * Removes research-process remarks from text shown to students: a bracketed remark goes, a sentence that carries one goes,
 * and a "; clause" that carries one goes (with the lower-case clause that depends on it). Returns null when nothing is left.
 */
export function sanitizeText(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  let t = v.replace(/\s*\([^()]*\)/g, (m) => (noisy(m) ? '' : m)).replace(/\s*\[[^\[\]]*\]/g, (m) => (noisy(m) ? '' : m));
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9'"(])/);
  const kept: string[] = [];
  for (const s of sentences) {
    if (!noisy(s)) { kept.push(s); continue; }
    const clauses = s.split(/;\s+/);
    if (clauses.length < 2) continue;
    const out: string[] = [];
    let dropNext = false;
    for (const c of clauses) {
      if (noisy(c)) { dropNext = true; continue; }
      if (dropNext && /^[a-z]/.test(c)) continue;
      dropNext = false; out.push(c);
    }
    if (out.length) { let j = out.join('; ').trim(); if (!/[.!?]$/.test(j)) j += '.'; kept.push(j.charAt(0).toUpperCase() + j.slice(1)); }
  }
  t = kept.join(' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
  return t && /[A-Za-z0-9]/.test(t) ? t.slice(0, MAX_TEXT) : null;
}
const MAX_TEXT = 4000;

/* ------------------------------------------------------------------ money */
// TODO: these are fixed planning rates, not live rates. Update them by hand now and then (last set Nov 2026).
// We never fetch live rates: the figure is labelled "approx." wherever it is shown.
export const IDR_PER_USD = 16500;
export const IDR_PER: Record<string, number> = {
  IDR: 1, USD: IDR_PER_USD, GBP: 21500, EUR: 18500, AUD: 10600, CAD: 11800, SGD: 12600, HKD: 2120, CHF: 19800,
};
export const IDR_RATE_NOTE = 'Approx., at today\'s rate we set (not a live rate). Rates change.';
/** Amount in rupiah at our fixed planning rate, or null when we have no rate for the currency. */
export function toIdr(amount: number, currency: string): number | null {
  const rate = IDR_PER[currency.toUpperCase()];
  return rate && Number.isFinite(amount) ? Math.round(amount * rate) : null;
}
/** "Rp 1.2 billion", "Rp 450 million", "Rp 75,000". */
export function formatIdr(n: number): string {
  const a = Math.abs(n);
  const short = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e9) return `Rp ${short(n / 1e9)} billion`;
  if (a >= 1e6) return `Rp ${short(n / 1e6)} million`;
  return `Rp ${Math.round(n).toLocaleString('en-US')}`;
}
export function formatMoney(m: Pick<Money, 'amount' | 'currency'>): string {
  return `${m.currency} ${m.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

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
/** Text that will be shown to students: trimmed, then cleaned of research-process remarks. */
const txt = (v: unknown): string | null => sanitizeText(str(v));
function sourced(v: unknown): Sourced | null {
  if (typeof v === 'string') { const s = txt(v); return s ? { value: s, source_url: null } : null; }
  if (!isObj(v)) return null;
  const value = txt(v.value);
  return value ? { value, source_url: safeUrl(v.source_url) } : null;
}
function english(v: unknown): EnglishReq | null {
  if (!isObj(v)) return null;
  const e: EnglishReq = {
    ielts_min: txt(v.ielts_min), toefl_min: txt(v.toefl_min), duolingo: txt(v.duolingo), pte_min: txt(v.pte_min),
    other_tests: txt(v.other_tests), waiver: txt(v.waiver), source_url: safeUrl(v.source_url),
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
  for (const k of PROFILE_STRS) out[k] = txt(v[k]);
  const hasData = PROFILE_NUMS.some((k) => out[k] != null) || ['gmat_range', 'gmat_focus_range', 'gre_range', 'gpa_range', 'work_exp_range'].some((k) => out[k as keyof ClassProfile] != null);
  return hasData ? out : null;
}
/** Employment report from the employment column; null when nothing usable is in it. */
export function parseEmployment(v: unknown): Employment | null {
  if (!isObj(v)) return null;
  const pct = num(v.employed_3_months_pct);
  const e: Employment = {
    report_label: txt(v.report_label), employed_3_months_pct: pct != null && pct >= 0 && pct <= 100 ? pct : null,
    median_base_salary: txt(v.median_base_salary), mean_base_salary: txt(v.mean_base_salary), top_industries: txt(v.top_industries),
    top_employers: txt(v.top_employers), international_employed_note: txt(v.international_employed_note), source_url: safeUrl(v.source_url), source_name: txt(v.source_name),
  };
  return e.employed_3_months_pct != null || e.median_base_salary || e.mean_base_salary || e.top_industries || e.top_employers || e.international_employed_note ? e : null;
}

export function parseDegreeType(v: unknown): DegreeType {
  const s = (str(v) ?? '').toLowerCase();
  if (s === 'mba') return 'mba';
  if (s === 'masters' || s === "master's" || s === 'master') return 'masters';
  if (s === 'undergrad' || s === 'undergraduate' || s === 'bachelor' || s === "bachelor's" || s === 'bachelors') return 'undergrad';
  return 'other';
}

function money(v: unknown): Money | null {
  if (!isObj(v)) return null;
  const amount = num(v.amount);
  const currency = (str(v.currency) ?? '').toUpperCase();
  if (amount == null || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency, basis: txt(v.basis), year: txt(v.year), source_url: safeUrl(v.source_url) };
}
export function parseCost(v: unknown): Cost | null {
  if (!isObj(v)) return null;
  const c: Cost = { tuition: money(v.tuition), living: money(v.living), notes: txt(v.notes) };
  return c.tuition || c.living || c.notes ? c : null;
}
export function parseScholarships(v: unknown): Scholarship[] {
  if (!Array.isArray(v)) return [];
  const out: Scholarship[] = [];
  for (const s of v.slice(0, 30)) {
    if (!isObj(s)) continue;
    const name = txt(s.name);
    if (!name) continue;
    out.push({ name, amount: txt(s.amount), eligibility: txt(s.eligibility), international_ok: typeof s.international_ok === 'boolean' ? s.international_ok : null, source_url: safeUrl(s.source_url) });
  }
  return out;
}
export function parseLpdp(v: unknown): Lpdp | null {
  if (!isObj(v)) return null;
  const l: Lpdp = { on_list: typeof v.on_list === 'boolean' ? v.on_list : null, list_name: txt(v.list_name), notes: txt(v.notes), source_url: safeUrl(v.source_url) };
  return l.on_list != null || l.notes ? l : null;
}

/** Reads one row defensively. Top-level columns win over the copy inside `data`. Returns null when unusable. */
export function parseProgram(row: ProgramRow | null | undefined): Program | null {
  if (!row || !isObj(row)) return null;
  const d = isObj(row.data) ? row.data : {};
  const program_name = str(row.program_name) ?? str(d.program_name);
  const school = str(row.school_name) ?? str(d.school);
  if (!program_name || !school) return null;
  const rawNotes = str(d.notes);
  return {
    id: String(row.id), collected_on: str(row.collected_on) ?? '2026-11-16',
    school, program_name,
    degree_type: parseDegreeType(row.degree_type ?? d.degree_type),
    format: txt(row.format) ?? txt(d.format), duration: txt(row.duration) ?? txt(d.duration), intake: txt(row.intake) ?? txt(d.intake),
    program_url: safeUrl(row.program_url) ?? safeUrl(d.program_url),
    deadlines: sourced(d.deadlines), application_fee: sourced(d.application_fee), tests: sourced(d.tests), english: english(d.english),
    essays: essays(d.essays), video_assessment: sourced(d.video_assessment), interview: sourced(d.interview),
    recommendations: sourced(d.recommendations), other_requirements: sourced(d.other_requirements), notes: txt(d.notes),
    class_profile: parseClassProfile(row.class_profile ?? d.class_profile), employment: parseEmployment(row.employment ?? d.employment),
    // data.internal_notes is research-only and is deliberately never read here.
    cost: parseCost(d.cost), fee_waiver: sourced(d.fee_waiver), scholarships: parseScholarships(d.scholarships), lpdp: parseLpdp(d.lpdp),
    application_system: txt(d.application_system), aid_policy: sourced(d.aid_policy ?? d.financial_aid ?? d.international_aid),
    paraphrased: { notes: isParaphrased(rawNotes), essays: /paraphras[^.]*(essay|prompt)|(essay|prompt)[^.]*paraphras/i.test(rawNotes ?? '') },
  };
}
export function parsePrograms(rows: unknown): Program[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => parseProgram(r as ProgramRow)).filter((p): p is Program => !!p);
}

/* ------------------------------------------------------------------ English chips */
const notAccepted = (s: string) => /^\s*not\s+accepted\b|^\s*no\s+longer\s+accepted\b|^\s*(?:the\s+school\s+)?does\s+not\s+accept\b/i.test(s);
const notStated = (s: string) => /^not\s+(stated|specified|found|published|listed)\b/i.test(s);
/** Takes out per-section minimums ("min 20 Listening", "6.5 each band") so only the overall score is left to read. */
export function stripSectionScores(v: string): string {
  return v
    .replace(/\b(?:min(?:imum)?\.?\s*)?\d+(?:\.\d+)?\s*(?:in\s+|on\s+|for\s+)?(?:each|every|per|all|any)\s+(?:band|component|section|skill|sub-?score|module|area|subtest)s?\b/gi, ' ')
    .replace(/\b(?:min(?:imum)?\.?\s*)?\d+(?:\.\d+)?\s*(?:in\s+|for\s+|on\s+)?(?:listening|speaking|reading|writing|literacy|comprehension|conversation|production)\b/gi, ' ')
    .replace(/\b(?:listening|speaking|reading|writing)\s*:?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b(?:band|section|component|sub-?score|skill)s?\s*(?:score\s*)?(?:of\s*)?(?:at\s+least\s*|min(?:imum)?\.?\s*|below\s*|under\s*|less\s+than\s*)?\d+(?:\.\d+)?/gi, ' ');
}
/**
 * The published minimum from free text, or null when the page gives no single minimum.
 * "min 135" wins; "no minimum" or "equivalent to ..." give null; otherwise a leading number ("7.0 overall", "100 iBT", "iBT 100").
 * Section minimums are ignored, so "100 iBT (min 20 Listening)" gives 100.
 */
export function minimumScore(raw: string): string | null {
  const v = stripSectionScores(raw);
  if (/\bno\s+minimum|discourag|equivalent/i.test(v)) return null;
  const explicit = v.match(/\bmin(?:imum)?\.?\s*(?:overall\s*)?(?:score\s*)?(?:of\s*)?:?\s*(\d+(?:\.\d+)?)/i);
  if (explicit) return explicit[1];
  return v.match(/^\s*(?:accepted\s*\(\s*)?(?:overall\s*)?(?:iBT\s*)?(\d+(?:\.\d+)?)/i)?.[1] ?? null;
}
export type EnglishTest = 'IELTS' | 'TOEFL' | 'Duolingo' | 'PTE';
/** Valid overall score ranges. TOEFL also has the new 1-6 band scale (from Jan 2026). */
export function validOverall(test: EnglishTest, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  switch (test) {
    case 'IELTS': return n >= 4 && n <= 9;
    case 'TOEFL': return (n >= 60 && n <= 120) || (n >= 1 && n <= 6);
    case 'Duolingo': return n >= 80 && n <= 160;
    case 'PTE': return n >= 30 && n <= 90;
  }
}
export type ScoreRead = { kind: 'score'; value: string } | { kind: 'none' } | { kind: 'invalid' };
/** The overall minimum for one test, checked against the test's real score range. */
export function overallScore(test: EnglishTest, raw: string): ScoreRead {
  const v = stripSectionScores(raw);
  if (/\bno\s+minimum|discourag|equivalent/i.test(v)) return { kind: 'none' };
  if (test === 'TOEFL') {
    // Most students know the 0-120 iBT score, so prefer it when the text gives one.
    const m = v.match(/\b(\d{2,3})\s*(?:\(\s*)?iBT\b|\biBT\s*(?:score\s*)?(?:of\s*)?:?\s*(\d{2,3})\b/i);
    const n = m ? Number(m[1] ?? m[2]) : NaN;
    if (m && validOverall('TOEFL', n) && n >= 60) return { kind: 'score', value: String(n) };
  }
  const s = minimumScore(raw);
  if (!s) return { kind: 'none' };
  return validOverall(test, Number(s)) ? { kind: 'score', value: s } : { kind: 'invalid' };
}
/** True when the school takes no English test at all (it judges English another way, such as the interview). */
export function noEnglishTestNeeded(e: EnglishReq | null): boolean {
  if (!e) return false;
  const given = (v: string | null) => !!v && !notStated(v) && !notAccepted(v);
  if (given(e.ielts_min) || given(e.toefl_min) || given(e.pte_min) || given(e.duolingo)) return false;
  const text = [e.waiver, e.other_tests, e.duolingo].filter(Boolean).join(' ');
  return /\bno\s+english\s+(?:language\s+)?(?:test|exam)\s+(?:is\s+)?(?:required|needed)|\bdoes\s+not\s+(?:accept|require)\s+(?:any\s+)?(?:ESL|english(?:\s+language)?\s+(?:test|proficiency|exam)|an\s+english)|\bdo(?:es)?\s+not\s+accept\s+(?:TOEFL|IELTS)|\bdoes\s+not\s+ask\s+for\s+(?:the\s+)?TOEFL|\bnot\s+require\s+an?\s+english\s+proficiency/i.test(text);
}
export type ChipTone = 'blue' | 'green' | 'neutral';
export type EnglishChip = { text: string; tone: ChipTone; title?: string };
const shorten = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n).replace(/[\s,;:.]+\S*$/, '')}...` : s);
function testChip(label: EnglishTest, v: string | null, keepNotStated = false): EnglishChip | null {
  if (!v || notStated(v)) return keepNotStated ? { text: `${label} not stated`, tone: 'neutral' } : null;
  if (notAccepted(v)) return { text: `${label} not accepted`, tone: 'neutral' };
  const r = overallScore(label, v);
  if (r.kind === 'score') return { text: `${label} ${r.value}${label === 'TOEFL' && Number(r.value) <= 6 ? ' (1-6 scale)' : ''}`, tone: 'blue', title: v };
  if (r.kind === 'invalid') return { text: `${label}: ${shorten(v)}`, tone: 'neutral', title: v };
  if (/accept/i.test(v) || label !== 'Duolingo') return { text: `${label} accepted`, tone: 'blue', title: v };
  return { text: `${label} not stated`, tone: 'neutral' };
}
/**
 * Chips for the English test rules, using the OVERALL score only: "IELTS 7.0", "TOEFL 100", "Duolingo 135".
 * A school that takes no English test gets one green "No English test needed" chip.
 */
export function englishChips(p: Pick<Program, 'english'>): EnglishChip[] {
  const e = p.english;
  if (!e) return [{ text: 'English test not stated', tone: 'neutral' }];
  if (noEnglishTestNeeded(e)) return [{ text: 'No English test needed', tone: 'green', title: e.waiver ?? undefined }];
  const out: EnglishChip[] = [];
  for (const [label, v, keep] of [['IELTS', e.ielts_min, false], ['TOEFL', e.toefl_min, false], ['Duolingo', e.duolingo, true], ['PTE', e.pte_min, false]] as const) {
    const c = testChip(label, v, keep); if (c) out.push(c);
  }
  return out;
}
/** The chip texts only. */
export function englishSummary(p: Pick<Program, 'english'>): string[] {
  return englishChips(p).map((c) => c.text);
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
  const ug = p.degree_type === 'undergrad';

  // Tests
  if (p.tests) {
    const named = /\b(gmat|gre)\b/i.test(p.tests.value);
    const sat = /\b(?:SAT|ACT)\b/.test(p.tests.value);
    items.push({ key: 'tests', name: ug ? (sat ? 'SAT/ACT' : 'Admissions test') : named ? 'GMAT/GRE' : 'Admissions test', category: 'tests', group: 'tests', detail: p.tests.value, source_url: p.tests.source_url ?? fallbackUrl, mandatory: !clearlyOptional(p.tests.value) });
  } else {
    items.push({ key: 'tests', name: ug ? 'Admissions test (SAT/ACT, if needed)' : 'GMAT/GRE', category: 'tests', group: 'tests', detail: `Test policy: ${NOT_FOUND}`, source_url: fallbackUrl, mandatory: false });
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
  items.push({ key: 'resume', name: ug ? 'Activities and achievements' : 'Resume', category: 'resume', group: 'other', detail: otherDetail, source_url: other?.source_url ?? fallbackUrl, mandatory: true });
  items.push({ key: 'transcripts', name: ug ? 'School transcripts (rapor)' : 'Academic transcripts', category: 'academics', group: 'other', detail: p.notes ? `${otherDetail}\nGood to know: ${p.notes}` : otherDetail, source_url: other?.source_url ?? fallbackUrl, mandatory: true });
  // Fee and deadline
  items.push({ key: 'fee', name: 'Application fee', category: 'other', group: 'deadlines', detail: p.application_fee?.value ?? NOT_FOUND, source_url: p.application_fee?.source_url ?? fallbackUrl, mandatory: true });
  items.unshift({ key: 'deadline', name: ug ? 'Pick your deadline' : 'Pick your round and deadline', category: 'other', group: 'deadlines', detail: p.deadlines?.value ?? NOT_FOUND, source_url: p.deadlines?.source_url ?? fallbackUrl, mandatory: true });
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
/* ------------------------------------------------------------------ application rounds */
export type Round = { label: string; date: string; closed: boolean; daysLeft: number };
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const monthOf = (m: string) => MONTH_INDEX[m.slice(0, 3).toLowerCase()];
const DATE_RE = new RegExp(
  `\\b(?:(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(20\\d{2}))?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?(?:\\s+(20\\d{2}))?)\\b`, 'i');
const ROUND_LABEL = /\b(Early\s+Action|Early\s+Decision|Round\s+(?:One|Two|Three|Four|Five|\d{1,2})|R\d{1,2}|Deferred\s+Admissions?|Rolling(?:\s*\((?:International|Intl\.?)\))?)\b/gi;
const WORD_NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5' };
function tidyLabel(l: string): string {
  const t = l.replace(/\s+/g, ' ').trim();
  const r = t.match(/^R(?:ound)?\s*(\d{1,2}|one|two|three|four|five)$/i);
  if (r) return `Round ${WORD_NUM[r[1].toLowerCase()] ?? r[1]}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** First date in the text: [year or null, month, day]. Rejects impossible days. */
function firstDate(text: string): { y: number | null; m: number; d: number } | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const month = monthOf(m[1] ?? m[5]);
  const day = Number(m[2] ?? m[4]);
  const year = m[3] ?? m[6];
  if (month == null || day < 1 || day > 31) return null;
  return { y: year ? Number(year) : null, m: month, d: day };
}
const dayNumber = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
/** Today's calendar date where the student is (not UTC), as YYYY-MM-DD. */
export const localIso = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Application rounds with dates, read from the deadlines text ("Round 1 Sep 9, 2026 (decision Dec 9, 2026); Round 2 ...").
 * Each round's deadline is the first date after its label. A date without a year takes the year of the round before it
 * (or the next year if that would go backwards). Text without round labels falls back to one deadline per "; " part.
 * A round is closed once its deadline day has passed. Returns [] when no dates can be read.
 */
export function parseRounds(text: string | null | undefined, today: Date = new Date()): Round[] {
  if (!text) return [];
  const raw: { label: string; y: number | null; m: number; d: number }[] = [];
  const labels = [...text.matchAll(ROUND_LABEL)];
  // Programs with two intakes ("Aug 2027 intake: R1 ...; Jan 2028 intake: R1 ...") get the intake added to repeated labels.
  const intakes = [...text.matchAll(new RegExp(`\\b((?:${MONTHS})\\.?\\s+20\\d{2})\\s+intake\\b`, 'gi'))];
  if (labels.length) {
    labels.forEach((l, i) => {
      const end = i + 1 < labels.length ? labels[i + 1].index! : text.length;
      const seg = text.slice(l.index! + l[0].length, end);
      const lead = seg.split(/[;]|\.\s/)[0];
      const date = firstDate(lead);
      if (!date) return;
      let label = tidyLabel(l[1]);
      if (intakes.length > 1) {
        const intake = [...intakes].reverse().find((x) => x.index! < l.index!);
        if (intake) label = `${label} (${intake[1]} intake)`;
      }
      raw.push({ label, ...date });
    });
  } else {
    text.split(/;\s*/).forEach((part, i, all) => {
      const date = firstDate(part);
      if (date && date.y != null) raw.push({ label: all.length > 1 ? `Deadline ${raw.length + 1}` : 'Deadline', ...date });
      void i;
    });
  }
  const out: Round[] = [];
  const todayN = dayNumber(localIso(today));
  let prev: { y: number; m: number } | null = null;
  for (const r of raw) {
    let y = r.y;
    if (y == null) {
      if (!prev) continue;
      y = r.m < prev.m ? prev.y + 1 : prev.y;
    }
    const iso = ymd(y, r.m, r.d);
    const n = dayNumber(iso);
    if (!Number.isFinite(n)) continue;
    prev = { y, m: r.m };
    if (out.some((o) => o.label === r.label && o.date === iso)) continue;
    out.push({ label: r.label, date: iso, closed: n < todayN, daysLeft: n - todayN });
  }
  return out;
}
/** The open round with the soonest deadline, or null when every round has closed (or none were read). */
export function nextOpenRound(rounds: Round[]): Round | null {
  return rounds.filter((r) => !r.closed).sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
}
/** "5 Jan 2027" from YYYY-MM-DD. */
export function formatRoundDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
export const daysLeftText = (n: number) => (n === 0 ? 'closes today' : n === 1 ? '1 day left' : `${n} days left`);

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

/** Programs the user can apply to on their track: grad users see MBA, master's and other degrees (chosen type first); undergrads see bachelor's programs. */
export function programsForTrack(programs: Program[], track: 'grad' | 'undergrad', preferred?: 'mba' | 'masters' | 'phd'): Program[] {
  if (track === 'undergrad') return programs.filter((p) => p.degree_type === 'undergrad').sort((a, b) => a.program_name.localeCompare(b.program_name));
  programs = programs.filter((p) => p.degree_type !== 'undergrad');
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
