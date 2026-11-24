// Pure profile logic: test validity, latest valid scores, score validation and completeness.
// No imports from app code so it can be unit tested with node:test. Track-aware: undergrad applicants get
// school grades, English tests and study goals; grad applicants keep GMAT/GRE, work and career goals.

export type Maybe<T> = T | null | undefined;
export type ProfileTrack = 'grad' | 'undergrad';
export type ProfileProgram = 'mba' | 'masters' | 'phd';
export type TestType = 'GMAT' | 'GRE' | 'SAT' | 'ACT' | 'IELTS' | 'TOEFL' | 'PTE' | 'DUOLINGO' | 'OTHER';
export const TEST_TYPES: TestType[] = ['GMAT', 'GRE', 'SAT', 'ACT', 'IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'OTHER'];
export const TEST_LABEL: Record<TestType, string> = {
  GMAT: 'GMAT', GRE: 'GRE', SAT: 'SAT', ACT: 'ACT', IELTS: 'IELTS', TOEFL: 'TOEFL', PTE: 'PTE Academic', DUOLINGO: 'Duolingo English Test', OTHER: 'Other test',
};
export const ENGLISH_TESTS: TestType[] = ['IELTS', 'TOEFL', 'PTE', 'DUOLINGO'];
export const GRAD_TESTS: TestType[] = ['GMAT', 'GRE'];
export const UNDERGRAD_TESTS: TestType[] = ['SAT', 'ACT'];
export type TestRecordStatus = 'taken' | 'planned';

/** Test types in the order a student on this track is most likely to need them. */
export function testTypesFor(track: ProfileTrack = 'grad', program?: ProfileProgram): TestType[] {
  if (track === 'undergrad') return ['IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'SAT', 'ACT', 'OTHER'];
  if (program === 'mba') return ['GMAT', 'GRE', 'IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'OTHER'];
  return ['GRE', 'GMAT', 'IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'OTHER'];
}
/** The test the "Add test" form starts on: IELTS for undergrads, GMAT for MBA, GRE for other grad programs. */
export function defaultTestType(track: ProfileTrack = 'grad', program?: ProfileProgram): TestType {
  return testTypesFor(track, program)[0];
}

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
  /** 'planned' means not taken yet: test_date is the optional target date and there are no scores. Missing means taken. */
  status?: Maybe<TestRecordStatus>;
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
/**
 * career_goals row. Undergrads reuse three columns so XP and the Journey keep working:
 * why_mba = "What do you want to study and why", short_term_goal = "What are you curious about", long_term_goal = "Where might it lead".
 */
export interface GoalsRow {
  id?: string; why_mba?: Maybe<string>; why_now?: Maybe<string>; short_term_goal?: Maybe<string>; long_term_goal?: Maybe<string>;
  target_industry?: Maybe<string>; target_function?: Maybe<string>; target_geography?: Maybe<string>; career_transition?: Maybe<string>;
  target_companies?: Maybe<string[]>;
}

export const filled = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null);
export const words = (s: Maybe<string>): number => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

// ---------- dates (locale-neutral pickers) ----------
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** Splits 'YYYY-MM-DD' (or a partial value from the pickers) into parts. Empty parts are ''. */
export function splitDate(v: Maybe<string>): { y: string; m: string; d: string } {
  const [y = '', m = '', d = ''] = (v ?? '').slice(0, 10).split('-');
  const clean = (s: string) => (/^\d+$/.test(s) ? s : '');
  return { y: clean(y), m: clean(m), d: clean(d) };
}
/**
 * Joins picker parts into a stored value. All empty gives ''. A complete date gives 'YYYY-MM-DD'.
 * Missing parts are kept as underscores so validation can ask for them (see datePartsError).
 * withDay=false stores the first of the month (or keeps an existing day).
 */
export function joinDate(y: string, m: string, d: string, withDay: boolean): string {
  if (!y && !m && !d) return '';
  const day = withDay ? d : d || '01';
  return `${y || '____'}-${m ? m.padStart(2, '0') : '__'}-${day ? day.padStart(2, '0') : '__'}`;
}
/** Error message for a half-filled or impossible date, or null when the value is empty or a real date. */
export function datePartsError(v: string, withDay: boolean): string | null {
  if (!v) return null;
  if (v.includes('_')) return withDay ? 'Pick the day, month and year' : 'Pick both the month and the year';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return 'Use a valid date';
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3] ? null : 'That day does not exist in this month';
}
/** "Jun 2027" from 'YYYY-MM-DD', without time zone shifts. */
export function fmtMonthYear(v: Maybe<string>): string {
  const { y, m } = splitDate(v); return y && m ? `${MONTH_NAMES[+m - 1].slice(0, 3)} ${y}` : '';
}
/** "15 Jun 2027" from 'YYYY-MM-DD', without time zone shifts. */
export function fmtDayMonthYear(v: Maybe<string>): string {
  const { y, m, d } = splitDate(v); return y && m && d ? `${+d} ${MONTH_NAMES[+m - 1].slice(0, 3)} ${y}` : fmtMonthYear(v);
}

// ---------- GPA scales ----------
export const GPA_SCALES = [
  { value: 4, label: '4.0 (university GPA or IPK)' },
  { value: 100, label: '100 (rapor average)' },
  { value: 10, label: '10' },
] as const;

// ---------- test validity ----------
/** Years a score stays valid, counted from test_date. null = no expiry rule (SAT and ACT scores do not expire, but schools may prefer recent ones). */
export const TEST_VALIDITY_YEARS: Record<TestType, number | null> = { GMAT: 5, GRE: 5, TOEFL: 2, IELTS: 2, PTE: 2, DUOLINGO: 2, SAT: null, ACT: null, OTHER: null };
export type TestStatus = 'valid' | 'expired' | 'undated' | 'no_rule' | 'planned';
export const isPlanned = (t: Pick<TestRow, 'status'>) => t.status === 'planned';

const parseDay = (d: string): Date | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
export function testExpiry(t: Pick<TestRow, 'test_type' | 'test_date' | 'status'>): string | null {
  if (isPlanned(t)) return null;
  const yrs = TEST_VALIDITY_YEARS[t.test_type]; if (yrs == null || !t.test_date) return null;
  const d = parseDay(t.test_date); if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear() + yrs, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
export function testStatus(t: Pick<TestRow, 'test_type' | 'test_date' | 'status'>, now: Date): TestStatus {
  if (isPlanned(t)) return 'planned';
  if (TEST_VALIDITY_YEARS[t.test_type] == null) return 'no_rule';
  const exp = testExpiry(t); if (!exp) return 'undated';
  return exp >= now.toISOString().slice(0, 10) ? 'valid' : 'expired';
}
export const hasScore = (t: TestRow) => [t.overall, t.quant, t.verbal, t.data_insights, t.analytical_writing].some((v) => v != null);

export interface LatestForType { type: TestType; latest: TestRow; latestValid: TestRow | null; expired: TestRow[]; undated: TestRow[]; planned: TestRow[]; count: number }
const byDateDesc = (a: TestRow, b: TestRow) => (b.test_date ?? '').localeCompare(a.test_date ?? '') || (b.attempt_number ?? 0) - (a.attempt_number ?? 0);
/** For each test type that has records: the latest taken record, the latest still-valid one, and any planned sittings. */
export function latestValidScores(tests: TestRow[], now: Date): LatestForType[] {
  const out: LatestForType[] = [];
  for (const type of TEST_TYPES) {
    const all = tests.filter((t) => t.test_type === type);
    if (!all.length) continue;
    const taken = all.filter((t) => !isPlanned(t)).sort(byDateDesc);
    const planned = all.filter(isPlanned).sort((a, b) => (a.test_date ?? '9999').localeCompare(b.test_date ?? '9999'));
    const ok = taken.filter((t) => hasScore(t) && ['valid', 'no_rule'].includes(testStatus(t, now)));
    out.push({ type, latest: taken[0] ?? planned[0], latestValid: ok[0] ?? null, expired: taken.filter((t) => testStatus(t, now) === 'expired'), undated: taken.filter((t) => testStatus(t, now) === 'undated'), planned, count: all.length });
  }
  return out;
}

// ---------- score range validation ----------
export const GMAT_VERSIONS = ['Focus Edition', 'Classic (10th Edition)'] as const;
/** Returns a map of field -> error message. Empty object means valid. `now` is used for the date rules. */
export function validateTestScore(t: Partial<TestRow>, now: Date = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  const today = now.toISOString().slice(0, 10);
  if (isPlanned(t)) {
    // A planned test needs no score and no date. A target date in the past probably means the plan changed.
    if (t.test_date && t.test_date < today) e.test_date = 'This date has passed. Pick a new target date, or switch to "Taken" and add your score.';
    return e;
  }
  const rng = (k: keyof TestRow, lo: number, hi: number, label: string) => { const v = t[k] as number | null | undefined; if (v != null && (Number.isNaN(v) || v < lo || v > hi)) e[k] = `${label} must be between ${lo} and ${hi}`; };
  switch (t.test_type) {
    case 'GMAT':
      if (t.exam_version === 'Classic (10th Edition)') { rng('overall', 200, 800, 'Total'); rng('quant', 0, 60, 'Quant'); rng('verbal', 0, 60, 'Verbal'); rng('analytical_writing', 0, 6, 'AWA'); }
      else { rng('overall', 205, 805, 'Total'); rng('quant', 60, 90, 'Quant'); rng('verbal', 60, 90, 'Verbal'); rng('data_insights', 60, 90, 'Data Insights'); }
      break;
    case 'GRE': rng('verbal', 130, 170, 'Verbal'); rng('quant', 130, 170, 'Quant'); rng('analytical_writing', 0, 6, 'Analytical Writing'); break;
    case 'SAT': rng('overall', 400, 1600, 'Total'); rng('verbal', 200, 800, 'Reading and Writing'); rng('quant', 200, 800, 'Math'); break;
    case 'ACT': rng('overall', 1, 36, 'Composite'); break;
    case 'IELTS': rng('overall', 0, 9, 'Overall band'); break;
    case 'TOEFL': rng('overall', 0, 120, 'Total'); break;
    case 'PTE': rng('overall', 10, 90, 'Overall'); break;
    case 'DUOLINGO': rng('overall', 10, 160, 'Overall'); break;
    default: if (t.overall != null && t.overall < 0) e.overall = 'Score cannot be negative';
  }
  if (!hasScore(t as TestRow)) e.overall = e.overall ?? 'Enter at least one score';
  if (t.test_type === 'GRE' && t.overall != null) e.overall = 'GRE has no overall score, use Verbal, Quant and Writing';
  if (!t.test_date) e.test_date = 'Add the test date so we can check how long the score stays valid';
  else if (t.test_date > today) e.test_date = 'This date is in the future. Switch to "Planned" if you have not taken it yet.';
  return e;
}

// ---------- completeness ----------
export type SectionKey = 'personal' | 'education' | 'tests' | 'work' | 'leadership' | 'achievements' | 'goals' | 'narrative';
export type SectionStatus = 'missing' | 'incomplete' | 'needs_verification' | 'complete';
export const NARRATIVE_KEYS = ['background', 'life_experiences', 'motivations', 'challenges', 'leadership_philosophy', 'values', 'aspirations'] as const;
export const SECTION_LABEL: Record<SectionKey, string> = { personal: 'Personal details', education: 'Education', tests: 'Standardized tests', work: 'Work experience', leadership: 'Leadership & extracurriculars', achievements: 'Achievements', goals: 'Career objectives', narrative: 'Personal narrative' };
/** Section names in the words of each track. */
export function sectionLabels(track: ProfileTrack = 'grad', program?: ProfileProgram): Record<SectionKey, string> {
  if (track === 'undergrad') return { ...SECTION_LABEL, tests: 'Tests', leadership: 'Activities and leadership', goals: 'Study goals' };
  if (program === 'masters' || program === 'phd') return { ...SECTION_LABEL, tests: 'Tests', goals: 'Goals for this degree' };
  return SECTION_LABEL;
}
/** Relative weight of each section in the overall percent (grad). */
export const SECTION_WEIGHT: Record<SectionKey, number> = { personal: 10, education: 15, tests: 15, work: 20, leadership: 10, achievements: 5, goals: 15, narrative: 10 };
/** Undergrads are not expected to have work experience: its weight moves to grades, tests and activities. */
export const UNDERGRAD_SECTION_WEIGHT: Record<SectionKey, number> = { personal: 10, education: 25, tests: 20, work: 0, leadership: 15, achievements: 5, goals: 15, narrative: 10 };
export const sectionWeights = (track: ProfileTrack = 'grad') => (track === 'undergrad' ? UNDERGRAD_SECTION_WEIGHT : SECTION_WEIGHT);
/** Share of a section's weight credited for each status. */
export const STATUS_CREDIT: Record<SectionStatus, number> = { missing: 0, incomplete: 0.4, needs_verification: 0.8, complete: 1 };
export const verifyKey = (section: SectionKey, id: string) => `${section}:${id}`;

/** The career_goals fields a track is asked for, with their labels. */
export function goalFields(track: ProfileTrack = 'grad', program?: ProfileProgram): [keyof GoalsRow, string][] {
  if (track === 'undergrad') return [['why_mba', 'What you want to study and why'], ['short_term_goal', 'What you are curious about'], ['long_term_goal', 'Where it might lead']];
  const why = program === 'masters' || program === 'phd' ? 'Why this degree' : 'Why MBA';
  return [['why_mba', why], ['why_now', 'Why now'], ['short_term_goal', 'Short-term goal'], ['long_term_goal', 'Long-term goal'], ['target_industry', 'Target industry'], ['target_function', 'Target function'], ['target_geography', 'Target geography']];
}

export interface SectionResult { key: SectionKey; label: string; status: SectionStatus; missing: string[]; flagged: string[]; items: number }
export interface CompletenessInput {
  profile: ProfileRow | null; education: EducationRow[]; tests: TestRow[]; work: WorkRow[]; leadership: LeadershipRow[]; achievements: AchievementRow[];
  goals: GoalsRow | null; verification?: Maybe<Record<string, boolean>>; track?: ProfileTrack; program?: ProfileProgram;
}
const PERSONAL_FIELDS: [keyof ProfileRow, string][] = [['full_name', 'Full name'], ['email', 'Email'], ['nationality', 'Nationality'], ['current_country', 'Current country'], ['current_city', 'Current city']];
const plannedLine = (t: TestRow) => `Take your planned ${TEST_LABEL[t.test_type]}${t.test_date ? ` (target ${fmtMonthYear(t.test_date)})` : ''}`;

/** What the tests section still needs for this track. Planned sittings count as progress but not as a score. */
function testsMissing(inp: CompletenessInput, now: Date): string[] {
  const track = inp.track ?? 'grad'; const tm: string[] = []; const latest = latestValidScores(inp.tests, now);
  const need = (types: TestType[], wanted: string) => {
    const rel = latest.filter((l) => types.includes(l.type));
    if (rel.some((l) => l.latestValid)) return;
    const planned = rel.flatMap((l) => l.planned);
    if (planned.length) { tm.push(plannedLine(planned[0])); return; }
    const taken = rel.filter((l) => l.latest && !isPlanned(l.latest));
    if (taken.length) for (const l of taken) tm.push(l.expired.length ? `${TEST_LABEL[l.type]} score expired (valid ${TEST_VALIDITY_YEARS[l.type]} years from test date)` : `${TEST_LABEL[l.type]} record has no valid scored result`);
    else tm.push(wanted);
  };
  if (track === 'undergrad') need(ENGLISH_TESTS, 'An English test score (IELTS, TOEFL, PTE or Duolingo), or the test you plan to take');
  else if (inp.program === 'masters' || inp.program === 'phd') need([...GRAD_TESTS, ...ENGLISH_TESTS], 'A valid test score (GRE, GMAT or an English test), or the test you plan to take');
  else need(GRAD_TESTS, 'A valid GMAT or GRE score');
  for (const l of latest) if (l.undated.length) tm.push(`${TEST_LABEL[l.type]}: add the test date so validity can be checked`);
  return tm;
}

export function profileCompleteness(inp: CompletenessInput, now: Date = new Date()): { percent: number; sections: SectionResult[] } {
  const track = inp.track ?? 'grad'; const labels = sectionLabels(track, inp.program); const weights = sectionWeights(track);
  const ver = inp.verification ?? {};
  const flaggedKeys = (section: SectionKey, ids: string[], label: (id: string) => string) => ids.filter((id) => ver[verifyKey(section, id)]).map(label);
  const sections: SectionResult[] = [];
  const add = (key: SectionKey, items: number, missing: string[], flagged: string[]) => {
    if (weights[key] === 0) return; // not part of this track's profile
    const status: SectionStatus = items === 0 ? 'missing' : missing.length ? 'incomplete' : flagged.length ? 'needs_verification' : 'complete';
    sections.push({ key, label: labels[key], status, missing, flagged, items });
  };

  // personal
  const p = inp.profile; const pm: string[] = [];
  const pFilled = p ? PERSONAL_FIELDS.filter(([k]) => filled(p[k])).length : 0;
  for (const [k, l] of PERSONAL_FIELDS) if (!p || !filled(p[k])) pm.push(l);
  add('personal', pFilled, pm, flaggedKeys('personal', PERSONAL_FIELDS.map(([k]) => k as string), (id) => PERSONAL_FIELDS.find(([k]) => k === id)?.[1] ?? id));

  // education
  const em: string[] = [];
  for (const e of inp.education) {
    const need: [unknown, string][] = [];
    if (track === 'undergrad') {
      // School grades are what matters; a current student can use their rapor average so far.
      need.push([e.gpa, 'grade average'], [e.gpa_scale, 'grade scale']);
      if (e.enrollment_status === 'completed') need.push([e.graduation_date, 'graduation date']);
    } else {
      need.push([e.degree, 'degree'], [e.major, 'major']);
      if (e.enrollment_status === 'completed') need.push([e.country, 'country'], [e.graduation_date, 'graduation date'], [e.gpa, 'GPA'], [e.gpa_scale, 'GPA scale']);
    }
    const miss = need.filter(([v]) => !filled(v)).map(([, l]) => l); if (miss.length) em.push(`${e.institution}: ${miss.join(', ')}`);
  }
  add('education', inp.education.length, em, flaggedKeys('education', inp.education.map((e) => e.id), (id) => inp.education.find((e) => e.id === id)!.institution));

  // tests
  add('tests', inp.tests.length, testsMissing(inp, now), flaggedKeys('tests', inp.tests.map((t) => t.id), (id) => { const t = inp.tests.find((x) => x.id === id)!; return `${TEST_LABEL[t.test_type]} ${t.test_date ?? ''}`.trim(); }));

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
  const g = inp.goals; const gf = goalFields(track, inp.program);
  const extra: (keyof GoalsRow)[] = track === 'undergrad' ? [] : ['career_transition', 'target_companies'];
  const gFilled = g ? gf.filter(([k]) => filled(g[k])).length + extra.filter((k) => filled(g[k])).length : 0;
  const gm = gf.filter(([k]) => !g || !filled(g[k])).map(([, l]) => l);
  add('goals', gFilled, gm, flaggedKeys('goals', [...gf.map(([k]) => k as string), ...extra], (id) => gf.find(([k]) => k === id)?.[1] ?? id.replace(/_/g, ' ')));

  // narrative
  const nar = p?.personal_narrative ?? {}; const nFilled = NARRATIVE_KEYS.filter((k) => filled(nar[k])).length;
  add('narrative', nFilled, NARRATIVE_KEYS.filter((k) => !filled(nar[k])).map((k) => k.replace(/_/g, ' ')), flaggedKeys('narrative', [...NARRATIVE_KEYS], (id) => id.replace(/_/g, ' ')));

  const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  const got = sections.reduce((s, x) => s + weights[x.key] * STATUS_CREDIT[x.status], 0);
  return { percent: Math.round((got / totalW) * 100), sections };
}
