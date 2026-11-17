// Pure profile logic: test validity, latest valid scores, score validation and completeness.
// No imports from app code so it can be unit tested with node:test.

export type Maybe<T> = T | null | undefined;
export type TestType = 'GMAT' | 'GRE' | 'IELTS' | 'TOEFL' | 'OTHER';
export const TEST_TYPES: TestType[] = ['GMAT', 'GRE', 'IELTS', 'TOEFL', 'OTHER'];

export interface ProfileRow {
  id?: string; full_name?: Maybe<string>; preferred_name?: Maybe<string>; email?: Maybe<string>; nationality?: Maybe<string>;
  current_country?: Maybe<string>; current_city?: Maybe<string>;
  personal_narrative?: Maybe<Record<string, string>>; field_verification?: Maybe<Record<string, boolean>>; settings?: Maybe<Record<string, unknown>>;
}
export interface EducationRow {
  id: string; institution: string; degree?: Maybe<string>; major?: Maybe<string>; country?: Maybe<string>; graduation_date?: Maybe<string>;
  gpa?: Maybe<number>; gpa_scale?: Maybe<number>; honors?: Maybe<string>; additional_qualifications?: Maybe<string>;
  enrollment_status: 'completed' | 'current' | 'incomplete';
}
export interface TestRow {
  id: string; test_type: TestType; exam_version?: Maybe<string>; overall?: Maybe<number>; quant?: Maybe<number>; verbal?: Maybe<number>;
  data_insights?: Maybe<number>; analytical_writing?: Maybe<number>; test_date?: Maybe<string>; attempt_number?: Maybe<number>; notes?: Maybe<string>;
}
export interface WorkRow {
  id: string; company: string; industry?: Maybe<string>; position: string; location?: Maybe<string>; start_date?: Maybe<string>; end_date?: Maybe<string>;
  employment_type?: Maybe<string>; description?: Maybe<string>; responsibilities?: Maybe<string>; achievements?: Maybe<string>;
  team_size?: Maybe<number>; budget_ownership?: Maybe<string>; promotions?: Maybe<string>; measurable_impact?: Maybe<string>;
}
export interface LeadershipRow {
  id: string; organization: string; role?: Maybe<string>; start_date?: Maybe<string>; end_date?: Maybe<string>; responsibilities?: Maybe<string>;
  leadership_experience?: Maybe<string>; achievements?: Maybe<string>; social_impact?: Maybe<string>; awards?: Maybe<string>;
}
export interface AchievementRow { id: string; title: string; description?: Maybe<string>; achieved_on?: Maybe<string>; quantified_impact?: Maybe<string> }
export interface GoalsRow {
  id?: string; why_mba?: Maybe<string>; why_now?: Maybe<string>; short_term_goal?: Maybe<string>; long_term_goal?: Maybe<string>;
  target_industry?: Maybe<string>; target_function?: Maybe<string>; target_geography?: Maybe<string>; career_transition?: Maybe<string>;
  target_companies?: Maybe<string[]>;
}

export const filled = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null);
export const words = (s: Maybe<string>): number => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

// ---------- test validity ----------
/** Years a score stays valid, counted from test_date. null = no expiry rule. */
export const TEST_VALIDITY_YEARS: Record<TestType, number | null> = { GMAT: 5, GRE: 5, TOEFL: 2, IELTS: 2, OTHER: null };
export type TestStatus = 'valid' | 'expired' | 'undated' | 'no_rule';

const parseDay = (d: string): Date | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
export function testExpiry(t: Pick<TestRow, 'test_type' | 'test_date'>): string | null {
  const yrs = TEST_VALIDITY_YEARS[t.test_type]; if (yrs == null || !t.test_date) return null;
  const d = parseDay(t.test_date); if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear() + yrs, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
export function testStatus(t: Pick<TestRow, 'test_type' | 'test_date'>, now: Date): TestStatus {
  if (TEST_VALIDITY_YEARS[t.test_type] == null) return 'no_rule';
  const exp = testExpiry(t); if (!exp) return 'undated';
  return exp >= now.toISOString().slice(0, 10) ? 'valid' : 'expired';
}
export const hasScore = (t: TestRow) => [t.overall, t.quant, t.verbal, t.data_insights, t.analytical_writing].some((v) => v != null);

export interface LatestForType { type: TestType; latest: TestRow; latestValid: TestRow | null; expired: TestRow[]; undated: TestRow[]; count: number }
const byDateDesc = (a: TestRow, b: TestRow) => (b.test_date ?? '').localeCompare(a.test_date ?? '') || (b.attempt_number ?? 0) - (a.attempt_number ?? 0);
/** For each test type that has records: the latest record and the latest record that is still valid. */
export function latestValidScores(tests: TestRow[], now: Date): LatestForType[] {
  const out: LatestForType[] = [];
  for (const type of TEST_TYPES) {
    const recs = tests.filter((t) => t.test_type === type).sort(byDateDesc);
    if (!recs.length) continue;
    const ok = recs.filter((t) => hasScore(t) && ['valid', 'no_rule'].includes(testStatus(t, now)));
    out.push({ type, latest: recs[0], latestValid: ok[0] ?? null, expired: recs.filter((t) => testStatus(t, now) === 'expired'), undated: recs.filter((t) => testStatus(t, now) === 'undated'), count: recs.length });
  }
  return out;
}

// ---------- score range validation ----------
export const GMAT_VERSIONS = ['Focus Edition', 'Classic (10th Edition)'] as const;
/** Returns a map of field -> error message. Empty object means valid. */
export function validateTestScore(t: Partial<TestRow>): Record<string, string> {
  const e: Record<string, string> = {};
  const rng = (k: keyof TestRow, lo: number, hi: number, label: string) => { const v = t[k] as number | null | undefined; if (v != null && (Number.isNaN(v) || v < lo || v > hi)) e[k] = `${label} must be between ${lo} and ${hi}`; };
  switch (t.test_type) {
    case 'GMAT':
      if (t.exam_version === 'Classic (10th Edition)') { rng('overall', 200, 800, 'Total'); rng('quant', 0, 60, 'Quant'); rng('verbal', 0, 60, 'Verbal'); rng('analytical_writing', 0, 6, 'AWA'); }
      else { rng('overall', 205, 805, 'Total'); rng('quant', 60, 90, 'Quant'); rng('verbal', 60, 90, 'Verbal'); rng('data_insights', 60, 90, 'Data Insights'); }
      break;
    case 'GRE': rng('verbal', 130, 170, 'Verbal'); rng('quant', 130, 170, 'Quant'); rng('analytical_writing', 0, 6, 'Analytical Writing'); break;
    case 'IELTS': rng('overall', 0, 9, 'Overall band'); break;
    case 'TOEFL': rng('overall', 0, 120, 'Total'); break;
    default: if (t.overall != null && t.overall < 0) e.overall = 'Score cannot be negative';
  }
  if (!hasScore(t as TestRow)) e.overall = e.overall ?? 'Enter at least one score';
  if (t.test_type === 'GRE' && t.overall != null) e.overall = 'GRE has no overall score, use Verbal, Quant and Writing';
  return e;
}

// ---------- completeness ----------
export type SectionKey = 'personal' | 'education' | 'tests' | 'work' | 'leadership' | 'achievements' | 'goals' | 'narrative';
export type SectionStatus = 'missing' | 'incomplete' | 'needs_verification' | 'complete';
export const NARRATIVE_KEYS = ['background', 'life_experiences', 'motivations', 'challenges', 'leadership_philosophy', 'values', 'aspirations'] as const;
export const SECTION_LABEL: Record<SectionKey, string> = { personal: 'Personal details', education: 'Education', tests: 'Standardized tests', work: 'Work experience', leadership: 'Leadership & extracurriculars', achievements: 'Achievements', goals: 'Career objectives', narrative: 'Personal narrative' };
/** Relative weight of each section in the overall percent. */
export const SECTION_WEIGHT: Record<SectionKey, number> = { personal: 10, education: 15, tests: 15, work: 20, leadership: 10, achievements: 5, goals: 15, narrative: 10 };
/** Share of a section's weight credited for each status. */
export const STATUS_CREDIT: Record<SectionStatus, number> = { missing: 0, incomplete: 0.4, needs_verification: 0.8, complete: 1 };
export const verifyKey = (section: SectionKey, id: string) => `${section}:${id}`;

export interface SectionResult { key: SectionKey; label: string; status: SectionStatus; missing: string[]; flagged: string[]; items: number }
export interface CompletenessInput {
  profile: ProfileRow | null; education: EducationRow[]; tests: TestRow[]; work: WorkRow[]; leadership: LeadershipRow[]; achievements: AchievementRow[];
  goals: GoalsRow | null; verification?: Maybe<Record<string, boolean>>;
}
const GOAL_FIELDS: [keyof GoalsRow, string][] = [['why_mba', 'Why MBA'], ['why_now', 'Why now'], ['short_term_goal', 'Short-term goal'], ['long_term_goal', 'Long-term goal'], ['target_industry', 'Target industry'], ['target_function', 'Target function'], ['target_geography', 'Target geography']];
const PERSONAL_FIELDS: [keyof ProfileRow, string][] = [['full_name', 'Full name'], ['email', 'Email'], ['nationality', 'Nationality'], ['current_country', 'Current country'], ['current_city', 'Current city']];

export function profileCompleteness(inp: CompletenessInput, now: Date = new Date()): { percent: number; sections: SectionResult[] } {
  const ver = inp.verification ?? {};
  const flaggedKeys = (section: SectionKey, ids: string[], label: (id: string) => string) => ids.filter((id) => ver[verifyKey(section, id)]).map(label);
  const sections: SectionResult[] = [];
  const add = (key: SectionKey, items: number, missing: string[], flagged: string[]) => {
    const status: SectionStatus = items === 0 ? 'missing' : missing.length ? 'incomplete' : flagged.length ? 'needs_verification' : 'complete';
    sections.push({ key, label: SECTION_LABEL[key], status, missing, flagged, items });
  };

  // personal
  const p = inp.profile; const pm: string[] = [];
  const pFilled = p ? PERSONAL_FIELDS.filter(([k]) => filled(p[k])).length : 0;
  for (const [k, l] of PERSONAL_FIELDS) if (!p || !filled(p[k])) pm.push(l);
  add('personal', pFilled, pm, flaggedKeys('personal', PERSONAL_FIELDS.map(([k]) => k as string), (id) => PERSONAL_FIELDS.find(([k]) => k === id)?.[1] ?? id));

  // education
  const em: string[] = [];
  for (const e of inp.education) {
    const need: [unknown, string][] = [[e.degree, 'degree'], [e.major, 'major']];
    if (e.enrollment_status === 'completed') need.push([e.country, 'country'], [e.graduation_date, 'graduation date'], [e.gpa, 'GPA'], [e.gpa_scale, 'GPA scale']);
    const miss = need.filter(([v]) => !filled(v)).map(([, l]) => l); if (miss.length) em.push(`${e.institution}: ${miss.join(', ')}`);
  }
  add('education', inp.education.length, em, flaggedKeys('education', inp.education.map((e) => e.id), (id) => inp.education.find((e) => e.id === id)!.institution));

  // tests
  const tm: string[] = []; const latest = latestValidScores(inp.tests, now);
  const main = latest.filter((l) => l.type === 'GMAT' || l.type === 'GRE');
  if (!main.some((l) => l.latestValid)) {
    if (main.length) for (const l of main) tm.push(l.expired.length ? `${l.type} score expired (valid ${TEST_VALIDITY_YEARS[l.type]} years from test date)` : `${l.type} record has no valid scored result`);
    else tm.push('A valid GMAT or GRE score');
  }
  for (const l of latest) if (l.undated.length) tm.push(`${l.type}: add the test date so validity can be checked`);
  add('tests', inp.tests.length, tm, flaggedKeys('tests', inp.tests.map((t) => t.id), (id) => { const t = inp.tests.find((x) => x.id === id)!; return `${t.test_type} ${t.test_date ?? ''}`.trim(); }));

  // work
  const wm: string[] = [];
  for (const w of inp.work) {
    const miss: string[] = [];
    if (!w.start_date) miss.push('start date');
    if (!filled(w.responsibilities) && !filled(w.description)) miss.push('responsibilities');
    if (!filled(w.measurable_impact) && !filled(w.achievements)) miss.push('measurable impact');
    if (miss.length) wm.push(`${w.position} at ${w.company}: ${miss.join(', ')}`);
  }
  add('work', inp.work.length, wm, flaggedKeys('work', inp.work.map((w) => w.id), (id) => { const w = inp.work.find((x) => x.id === id)!; return `${w.position} at ${w.company}`; }));

  // leadership
  const lm: string[] = [];
  for (const l of inp.leadership) {
    const miss: string[] = [];
    if (!filled(l.role)) miss.push('role');
    if (!filled(l.responsibilities) && !filled(l.leadership_experience)) miss.push('what you led or did');
    if (!filled(l.achievements) && !filled(l.social_impact)) miss.push('outcome or impact');
    if (miss.length) lm.push(`${l.organization}: ${miss.join(', ')}`);
  }
  add('leadership', inp.leadership.length, lm, flaggedKeys('leadership', inp.leadership.map((l) => l.id), (id) => inp.leadership.find((x) => x.id === id)!.organization));

  // achievements
  const am: string[] = [];
  for (const a of inp.achievements) if (!filled(a.description) && !filled(a.quantified_impact)) am.push(`${a.title}: description or quantified impact`);
  add('achievements', inp.achievements.length, am, flaggedKeys('achievements', inp.achievements.map((a) => a.id), (id) => inp.achievements.find((x) => x.id === id)!.title));

  // goals
  const g = inp.goals; const gFilled = g ? GOAL_FIELDS.filter(([k]) => filled(g[k])).length + (filled(g.career_transition) ? 1 : 0) + (filled(g.target_companies) ? 1 : 0) : 0;
  const gm = GOAL_FIELDS.filter(([k]) => !g || !filled(g[k])).map(([, l]) => l);
  add('goals', gFilled, gm, flaggedKeys('goals', [...GOAL_FIELDS.map(([k]) => k as string), 'career_transition', 'target_companies'], (id) => id.replace(/_/g, ' ')));

  // narrative
  const nar = p?.personal_narrative ?? {}; const nFilled = NARRATIVE_KEYS.filter((k) => filled(nar[k])).length;
  add('narrative', nFilled, NARRATIVE_KEYS.filter((k) => !filled(nar[k])).map((k) => k.replace(/_/g, ' ')), flaggedKeys('narrative', [...NARRATIVE_KEYS], (id) => id.replace(/_/g, ' ')));

  const totalW = Object.values(SECTION_WEIGHT).reduce((a, b) => a + b, 0);
  const got = sections.reduce((s, x) => s + SECTION_WEIGHT[x.key] * STATUS_CREDIT[x.status], 0);
  return { percent: Math.round((got / totalW) * 100), sections };
}
