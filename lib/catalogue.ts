// "Find universities": the researched catalogue (public.program_requirements) grouped by university, plus the
// filters and summary chips the Find view shows. Pure logic only: no React, no Supabase. Tested in tests/catalogue.test.ts.
import { englishSummary, noStudentVisa, parseProgram, type Program, type ProgramRow } from './programs.ts';
import { DESTINATION_LABEL, type Destination, type Program as ProgramChoice } from './onboarding.ts';

export type Level = 'grad' | 'undergrad';

/* ------------------------------------------------------------------ where the 26 business schools are */
/** Country and city of the researched business schools, copied from the seed list in migration 019. */
export const SCHOOL_PLACES: Record<string, { country: string; city: string }> = {
  'Harvard Business School': { country: 'United States', city: 'Boston, MA' }, 'Stanford GSB': { country: 'United States', city: 'Stanford, CA' },
  Wharton: { country: 'United States', city: 'Philadelphia, PA' }, 'Chicago Booth': { country: 'United States', city: 'Chicago, IL' },
  'MIT Sloan': { country: 'United States', city: 'Cambridge, MA' }, Kellogg: { country: 'United States', city: 'Evanston, IL' },
  'Columbia Business School': { country: 'United States', city: 'New York, NY' }, 'Berkeley Haas': { country: 'United States', city: 'Berkeley, CA' },
  'Yale SOM': { country: 'United States', city: 'New Haven, CT' }, 'Dartmouth Tuck': { country: 'United States', city: 'Hanover, NH' },
  'Michigan Ross': { country: 'United States', city: 'Ann Arbor, MI' }, 'NYU Stern': { country: 'United States', city: 'New York, NY' },
  'UCLA Anderson': { country: 'United States', city: 'Los Angeles, CA' }, 'Cornell Johnson': { country: 'United States', city: 'Ithaca, NY' },
  'Duke Fuqua': { country: 'United States', city: 'Durham, NC' }, 'UVA Darden': { country: 'United States', city: 'Charlottesville, VA' },
  INSEAD: { country: 'France', city: 'Fontainebleau' }, 'London Business School': { country: 'United Kingdom', city: 'London' },
  'HEC Paris': { country: 'France', city: 'Jouy-en-Josas' }, 'Cambridge Judge': { country: 'United Kingdom', city: 'Cambridge' },
  'Oxford Saïd': { country: 'United Kingdom', city: 'Oxford' }, IESE: { country: 'Spain', city: 'Barcelona' }, IMD: { country: 'Switzerland', city: 'Lausanne' },
  NUS: { country: 'Singapore', city: 'Singapore' }, HKUST: { country: 'Hong Kong', city: 'Hong Kong' }, CEIBS: { country: 'China', city: 'Shanghai' },
};

/* ------------------------------------------------------------------ fields of study */
export type FieldKey = 'business' | 'finance' | 'analytics' | 'management' | 'marketing' | 'accounting' | 'cs' | 'engineering';
export const FIELDS: { key: FieldKey; label: string; re: RegExp }[] = [
  { key: 'business', label: 'Business / MBA', re: /\bmba\b|\bbusiness\b|\badministration\b/i },
  { key: 'finance', label: 'Finance', re: /financ/i },
  { key: 'analytics', label: 'Analytics / Data', re: /analytic|\bdata\b|business intelligence/i },
  { key: 'management', label: 'Management', re: /management|\bmim\b|\bmsm\b/i },
  { key: 'marketing', label: 'Marketing', re: /marketing/i },
  { key: 'accounting', label: 'Accounting', re: /accounting|accountancy/i },
  { key: 'cs', label: 'Computer Science', re: /computer|computing|software|\bcs\b/i },
  { key: 'engineering', label: 'Engineering', re: /engineering/i },
];
export const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;
const FIELD_KEYS = FIELDS.map((f) => f.key);

/** Fields a program name points to ("Master in Finance" is Finance, "MBA" is Business / MBA). */
export function fieldsFor(programName: string): FieldKey[] {
  return FIELDS.filter((f) => f.re.test(programName)).map((f) => f.key);
}

/** Onboarding field keys (lib/onboarding.ts Field) to catalogue fields. Design, health, social sciences and other have no researched programs yet, so they do not narrow the list. */
const ONBOARDING_FIELD: Record<string, FieldKey[]> = {
  business: ['business', 'management', 'marketing', 'accounting'], cs: ['cs'], engineering: ['engineering'], 'econ-finance': ['finance'], 'data-science': ['analytics'],
};
const NO_FILTER = new Set(['design', 'health', 'social-sciences', 'other']);

/**
 * The student's fields of interest from settings.onboarding.fields, when present. Accepts our keys or free text
 * ("Computer science", "Data") and maps them by keyword. Unknown entries are ignored.
 */
export function fieldsFromOnboarding(settings: unknown): FieldKey[] {
  const ob = isObj(settings) && isObj(settings.onboarding) ? settings.onboarding : isObj(settings) ? settings : null;
  const raw = ob && Array.isArray(ob.fields) ? ob.fields : [];
  const out = new Set<FieldKey>();
  for (const v of raw) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const s = v.trim().toLowerCase();
    if ((FIELD_KEYS as string[]).includes(s)) { out.add(s as FieldKey); continue; }
    if (ONBOARDING_FIELD[s]) { ONBOARDING_FIELD[s].forEach((k) => out.add(k)); continue; }
    if (NO_FILTER.has(s)) continue;
    for (const f of FIELDS) if (f.re.test(s) || f.label.toLowerCase().includes(s)) out.add(f.key);
  }
  return FIELD_KEYS.filter((k) => out.has(k));
}

/* ------------------------------------------------------------------ catalogue entries */
export type Money = { amount: number; currency: string; basis: string | null; year: string | null };
export type CatalogueProgram = {
  program: Program; level: Level; school: string; fullName: string | null; country: string | null; city: string | null;
  tuition: Money | null; lpdpOnList: boolean; noVisa: boolean; fields: FieldKey[]; ranking: number | null;
};
export type University = { name: string; fullName: string | null; country: string | null; city: string | null; ranking: number | null; programs: CatalogueProgram[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(v)) { const n = Number(v.replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
};

/** True when the row is an undergraduate entry (degree_type 'undergrad' in the column or in data). */
export function isUndergradRow(row: ProgramRow): boolean {
  const d = isObj(row.data) ? row.data : {};
  const t = String(row.degree_type ?? d.degree_type ?? '').trim().toLowerCase();
  return t === 'undergrad' || t === 'undergraduate' || t === 'bachelor' || t === 'bachelors';
}

function tuitionOf(cost: unknown): Money | null {
  if (!isObj(cost) || !isObj(cost.tuition)) return null;
  const t = cost.tuition;
  const amount = num(t.amount);
  const currency = text(t.currency, 8)?.toUpperCase() ?? null;
  if (amount == null || amount <= 0 || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency, basis: text(t.basis, 40), year: text(t.year, 20) };
}

/** One researched row as a catalogue entry. Never reads data.internal_notes. null when the row is unusable. */
export function toCatalogueProgram(row: ProgramRow): CatalogueProgram | null {
  const program = parseProgram(row);
  if (!program) return null;
  const d = isObj(row.data) ? row.data : {};
  const level: Level = isUndergradRow(row) ? 'undergrad' : 'grad';
  const place = SCHOOL_PLACES[program.school];
  const ranking = isObj(d.ranking) ? num(d.ranking.value) : null;
  return {
    program, level, school: program.school, fullName: text(d.full_name),
    country: text(d.country, 80) ?? place?.country ?? null, city: text(d.city, 80) ?? place?.city ?? null,
    tuition: tuitionOf(d.cost), lpdpOnList: isObj(d.lpdp) && d.lpdp.on_list === true, noVisa: noStudentVisa(program.notes),
    fields: fieldsFor(program.program_name), ranking: ranking != null && ranking > 0 ? ranking : null,
  };
}

/** All rows grouped by university (school_name), universities sorted by name. */
export function buildCatalogue(rows: unknown): University[] {
  if (!Array.isArray(rows)) return [];
  const by = new Map<string, University>();
  for (const r of rows) {
    const cp = toCatalogueProgram(r as ProgramRow);
    if (!cp) continue;
    let u = by.get(cp.school);
    if (!u) { u = { name: cp.school, fullName: null, country: null, city: null, ranking: null, programs: [] }; by.set(cp.school, u); }
    u.fullName ??= cp.fullName; u.country ??= cp.country; u.city ??= cp.city; u.ranking ??= cp.ranking;
    if (!u.programs.some((p) => p.program.id === cp.program.id)) u.programs.push(cp);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ filters */
export type CatalogueFilter = { track: Level; countries: string[]; fields: FieldKey[]; q: string; preferred?: ProgramChoice };

/** Country names for the onboarding destinations ("us" is "United States"). */
export function countriesFromDestinations(dest: readonly Destination[]): string[] {
  return dest.map((d) => DESTINATION_LABEL[d]).filter(Boolean);
}

/** Every country in the catalogue plus the student's own destinations (so a destination with no data can still be picked). */
export function catalogueCountries(unis: University[], extra: string[] = []): string[] {
  return [...new Set([...unis.map((u) => u.country).filter((c): c is string => !!c), ...extra])].sort((a, b) => a.localeCompare(b));
}

/** An undergraduate entry that covers first-year admission for every major (its name names no field). */
const coversAllMajors = (p: CatalogueProgram) => p.level === 'undergrad' && p.fields.length === 0;

function matchesField(p: CatalogueProgram, fields: FieldKey[]): boolean {
  if (!fields.length || coversAllMajors(p)) return true;
  return p.fields.some((f) => fields.includes(f));
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function haystack(u: University, p: CatalogueProgram): string {
  const fieldWords = (coversAllMajors(p) ? FIELDS.map((f) => f.label) : p.fields.map((f) => FIELD_LABEL[f])).join(' ');
  return norm([u.name, u.fullName, u.city, u.country, p.program.program_name, fieldWords].filter(Boolean).join(' '));
}
function matchesQuery(u: University, p: CatalogueProgram, q: string): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(u, p);
  return words.every((w) => h.includes(w));
}
const PREF_DEGREE: Record<ProgramChoice, string> = { mba: 'mba', masters: 'masters', phd: 'other' };

/**
 * Universities that have at least one program matching the filter, each with only its matching programs.
 * Grad shows MBA, master's and other degrees (the student's chosen program type first); undergrad shows undergrad entries.
 */
export function filterCatalogue(unis: University[], f: CatalogueFilter): University[] {
  const countries = new Set(f.countries.map((c) => c.toLowerCase()));
  const rank = (p: CatalogueProgram) => {
    const d = p.program.degree_type;
    return f.preferred && d === PREF_DEGREE[f.preferred] ? 0 : d === 'mba' ? 1 : d === 'masters' ? 2 : 3;
  };
  const out: University[] = [];
  for (const u of unis) {
    if (countries.size && !countries.has((u.country ?? '').toLowerCase())) continue;
    const programs = u.programs
      .filter((p) => p.level === f.track && matchesField(p, f.fields) && matchesQuery(u, p, f.q))
      .sort((a, b) => rank(a) - rank(b) || a.program.program_name.localeCompare(b.program.program_name));
    if (programs.length) out.push({ ...u, programs });
  }
  if (f.track === 'undergrad') out.sort((a, b) => (a.ranking ?? 9999) - (b.ranking ?? 9999) || a.name.localeCompare(b.name));
  return out;
}

/* ------------------------------------------------------------------ chips */
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (d: Date) => `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear()}`;
// Words just before a date that mean it is not a deadline (a decision date, an opening date).
const NOT_A_DEADLINE = /decision|notif|result|release|respon|reply|replies|from|opens?|starts?|begin|interview|classes|orientation|enrol/i;

export type DeadlineInfo = { kind: 'next'; date: Date; label: string; daysLeft: number } | { kind: 'passed' } | { kind: 'rolling' };

/** The next application deadline written in the deadlines text, from `today`. Decision and opening dates are skipped. */
export function nextDeadline(value: string | null | undefined, today: Date): DeadlineInfo | null {
  if (!value) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const found: Date[] = [];
  const push = (y: number, m: number, d: number, at: number) => {
    const before = value.slice(Math.max(0, at - 40), at);
    const ctx = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('('), before.lastIndexOf('.')) + 1);
    if (NOT_A_DEADLINE.test(ctx)) return;
    const dt = new Date(y, m, d);
    if (dt.getMonth() === m && dt.getDate() === d) found.push(dt);
  };
  for (const m of value.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) push(Number(m[3]), MONTH_INDEX[m[1].slice(0, 3).toLowerCase()], Number(m[2]), m.index ?? 0);
  for (const m of value.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(20\\d{2})\\b`, 'gi'))) push(Number(m[3]), MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], Number(m[1]), m.index ?? 0);
  for (const m of value.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) push(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m.index ?? 0);
  const future = found.filter((d) => d >= start).sort((a, b) => a.getTime() - b.getTime());
  if (future.length) return { kind: 'next', date: future[0], label: fmtDay(future[0]), daysLeft: Math.round((future[0].getTime() - start.getTime()) / 86400000) };
  if (/rolling/i.test(value)) return { kind: 'rolling' };
  return found.length ? { kind: 'passed' } : null;
}

/** A short test policy from the tests text: "Tests optional", "Test blind", "No test needed", "GMAT or GRE", "SAT or ACT required". */
export function testPolicy(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value;
  if (/test[- ]blind|will not (?:consider|review|accept) (?:sat|act|test)/i.test(v)) return 'Test blind';
  if (/test[- ]optional|\b(?:sat|act|gmat|gre|tests?|scores?)\b[^.;]{0,30}\boptional\b/i.test(v)) return 'Tests optional';
  if (/\b(?:sat|act|gmat|gre|tests?|scores?)\b[^.;]{0,20}\bnot required\b|\bno (?:sat|act|gmat|gre|admissions? test|entrance test)s? (?:is |are )?required\b|\bdoes not require (?:the )?(?:sat|act|gmat|gre|tests?)/i.test(v)) return 'No test needed';
  const gm = /\bgmat\b/i.test(v), gr = /\bgre\b/i.test(v), sat = /\bsat\b/i.test(v), act = /\bact\b/.test(v) || /\bACT\b/.test(v);
  const req = /required|must/i.test(v);
  if (gm || gr) return `${gm && gr ? 'GMAT or GRE' : gm ? 'GMAT' : 'GRE'}${req ? ' required' : ''}`;
  if (sat || act) return `${sat && act ? 'SAT or ACT' : sat ? 'SAT' : 'ACT'}${req ? ' required' : ''}`;
  return null;
}

/** The first published English minimum ("IELTS 7.0"), or null when the school gives none. */
export function englishMinimum(p: Pick<Program, 'english'>): string | null {
  if (!p.english) return null;
  return englishSummary(p).find((c) => /^(IELTS|TOEFL|PTE|Duolingo) \d/.test(c)) ?? null;
}

/** "USD 84,760 a year" or "GBP 60,000 total" for the tuition chip. */
export function formatTuition(m: Money): string {
  const amount = `${m.currency} ${Math.round(m.amount).toLocaleString('en-US')}`;
  const b = (m.basis ?? '').toLowerCase();
  if (!b || /year|annual|annum/.test(b)) return `${amount} a year`;
  if (/total|program|course|whole/.test(b)) return `${amount} total`;
  return `${amount} (${m.basis})`;
}

export type Chip = { key: string; text: string; tone: 'blue' | 'green' | 'orange' | 'purple' | 'yellow' | 'neutral' };
/** Key facts for one program card, in a fixed order. Never includes internal research notes. */
export function chipsFor(cp: CatalogueProgram, today: Date): Chip[] {
  const out: Chip[] = [];
  const eng = englishMinimum(cp.program); if (eng) out.push({ key: 'english', text: eng, tone: 'blue' });
  const tp = testPolicy(cp.program.tests?.value); if (tp) out.push({ key: 'tests', text: tp, tone: 'purple' });
  const dl = nextDeadline(cp.program.deadlines?.value, today);
  if (dl?.kind === 'next') out.push({ key: 'deadline', text: `Next deadline ${dl.label}`, tone: dl.daysLeft <= 14 ? 'orange' : 'yellow' });
  else if (dl?.kind === 'rolling') out.push({ key: 'deadline', text: 'Rolling deadlines', tone: 'yellow' });
  else if (dl?.kind === 'passed') out.push({ key: 'deadline', text: 'This year\'s deadlines have passed', tone: 'neutral' });
  if (cp.lpdpOnList) out.push({ key: 'lpdp', text: 'On LPDP list', tone: 'green' });
  if (cp.tuition) out.push({ key: 'tuition', text: `Tuition ${formatTuition(cp.tuition)}`, tone: 'neutral' });
  return out;
}

/* ------------------------------------------------------------------ adding to the student's list */
export type ExistingSchool = { id: string; name: string; deleted_at: string | null };
export type AddPlan = {
  /** University name to the id of the student's existing school row. */
  existing: Map<string, string>;
  /** Removed rows to bring back (the student removed the school before). */
  restore: { id: string; name: string }[];
  /** New school rows to insert. */
  create: { name: string; country: string | null; location: string | null }[];
};
const key = (s: string) => norm(s).trim().replace(/\s+/g, ' ');

/** Which school rows to reuse, restore or create for the picked universities. Matches by name, ignoring case and accents. */
export function planAdd(unis: Pick<University, 'name' | 'country' | 'city'>[], mine: ExistingSchool[]): AddPlan {
  const live = new Map<string, string>(); const removed = new Map<string, string>();
  for (const s of mine) { const k = key(s.name); if (s.deleted_at) { if (!removed.has(k)) removed.set(k, s.id); } else if (!live.has(k)) live.set(k, s.id); }
  const plan: AddPlan = { existing: new Map(), restore: [], create: [] };
  const seen = new Set<string>();
  for (const u of unis) {
    const k = key(u.name);
    if (seen.has(k)) continue; seen.add(k);
    if (live.has(k)) plan.existing.set(u.name, live.get(k)!);
    else if (removed.has(k)) plan.restore.push({ id: removed.get(k)!, name: u.name });
    else plan.create.push({ name: u.name, country: u.country, location: u.city });
  }
  return plan;
}
/** Case and accent insensitive name key, shared with the view for "On your list" badges. */
export const schoolKey = key;
