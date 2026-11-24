// First-run onboarding answers, stored as applicant_profiles.settings.onboarding (jsonb).
// Pure types and helpers only: no database access here (see components/onboarding/data.ts).

export type Track = 'grad' | 'undergrad';
export type Program = 'mba' | 'masters' | 'phd';
export type Destination = 'us' | 'canada' | 'australia' | 'uk' | 'singapore' | 'hongkong';
export type Field = 'business' | 'cs' | 'engineering' | 'econ-finance' | 'data-science' | 'design' | 'health' | 'social-sciences' | 'other';
export type Stage = 'exploring' | 'shortlisting' | 'applying' | 'submitted';
export type CurrentStatus = 'sma_10_11' | 'sma_12' | 'gap_year' | 'uni_student' | 'uni_final' | 'working' | 'masters' | 'other';
/** Optional "About you" answers: what the student does now, where they study or studied, and where they live. */
export type Funding = 'lpdp' | 'gov' | 'family' | 'savings' | 'need' | 'unsure';
export type LpdpStatus = 'planning' | 'applied' | 'awarded';
export type EnglishStatus = 'taken' | 'booked' | 'not_yet';
export type Worry = 'schools' | 'essays' | 'tests' | 'money' | 'deadlines' | 'none';
export type About = {
  status?: CurrentStatus; school?: string; city?: string;
  funding?: Funding; lpdp?: LpdpStatus; english?: EnglishStatus; worry?: Worry;
};

export type Onboarding = {
  done: boolean;
  track: Track;
  program?: Program; // grad only; always the first of `programs` (kept for older readers)
  programs?: Program[]; // grad only; every program the student is considering, first choice first
  fields?: Field[]; // optional "What do you want to study?" answers; absent when skipped
  destinations: Destination[];
  intake?: string; // e.g. 'Fall 2027' or 'Semester 1 2027 (Feb)'; undefined means "not sure yet"
  stage: Stage;
  reminders: { email: boolean; hourLocal: number };
  timezone: string;
  about?: About; // optional, absent when skipped
};

export const TRACKS: readonly Track[] = ['grad', 'undergrad'];
export const PROGRAMS: readonly Program[] = ['mba', 'masters', 'phd'];
export const DESTINATIONS: readonly Destination[] = ['us', 'canada', 'australia', 'uk', 'singapore', 'hongkong'];
export const FIELDS: readonly Field[] = ['business', 'cs', 'engineering', 'econ-finance', 'data-science', 'design', 'health', 'social-sciences', 'other'];
export const STAGES: readonly Stage[] = ['exploring', 'shortlisting', 'applying', 'submitted'];
export const STATUSES: readonly CurrentStatus[] = ['sma_10_11', 'sma_12', 'gap_year', 'uni_student', 'uni_final', 'working', 'masters', 'other'];
export const STATUS_LABEL: Record<CurrentStatus, string> = {
  sma_10_11: 'In high school (SMA/SMK, Grade 10 or 11)', sma_12: 'Final year of high school (Grade 12)', gap_year: 'Finished high school, taking a gap year',
  uni_student: 'At university now', uni_final: 'Final year of university', working: 'Working', masters: "Doing a master's now", other: 'Something else',
};
/** Status choices that fit each track, most common first. */
export const STATUS_FOR_TRACK: Record<Track, readonly CurrentStatus[]> = {
  undergrad: ['sma_10_11', 'sma_12', 'gap_year', 'uni_student', 'other'],
  grad: ['uni_final', 'working', 'masters', 'other'],
};
export const FUNDINGS: readonly Funding[] = ['lpdp', 'gov', 'family', 'savings', 'need', 'unsure'];
export const FUNDING_LABEL: Record<Funding, string> = {
  lpdp: 'LPDP', gov: 'Another government scholarship', family: 'Parents or family', savings: 'My own savings', need: 'I need a scholarship', unsure: 'Not sure yet',
};
export const LPDP_STATUSES: readonly LpdpStatus[] = ['planning', 'applied', 'awarded'];
export const LPDP_LABEL: Record<LpdpStatus, string> = { planning: 'Planning to apply', applied: 'Applied, waiting', awarded: 'Already awarded' };
export const ENGLISH_STATUSES: readonly EnglishStatus[] = ['taken', 'booked', 'not_yet'];
export const ENGLISH_LABEL: Record<EnglishStatus, string> = { taken: 'Yes, I have a score', booked: 'Booked a test date', not_yet: 'Not yet' };
export const WORRIES: readonly Worry[] = ['schools', 'essays', 'tests', 'money', 'deadlines', 'none'];
export const WORRY_LABEL: Record<Worry, string> = {
  schools: 'Choosing schools', essays: 'Essays', tests: 'Tests', money: 'Money', deadlines: 'Deadlines', none: 'Nothing yet',
};
const ABOUT_MAX = 120;
/** Cleans the optional About answers; returns undefined when nothing useful is left. */
export function parseAbout(v: unknown): About | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, ABOUT_MAX) : undefined);
  const status = typeof r.status === 'string' && (STATUSES as readonly string[]).includes(r.status) ? (r.status as CurrentStatus) : undefined;
  const pick = <T extends string>(list: readonly T[], x: unknown): T | undefined => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : undefined);
  const funding = pick(FUNDINGS, r.funding);
  const lpdp = funding === 'lpdp' ? pick(LPDP_STATUSES, r.lpdp) : undefined; // only meaningful with LPDP funding
  const english = pick(ENGLISH_STATUSES, r.english), worry = pick(WORRIES, r.worry);
  const out: About = {
    ...(status ? { status } : {}), ...(text(r.school) ? { school: text(r.school) } : {}), ...(text(r.city) ? { city: text(r.city) } : {}),
    ...(funding ? { funding } : {}), ...(lpdp ? { lpdp } : {}), ...(english ? { english } : {}), ...(worry ? { worry } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
export const REMINDER_HOURS = [8, 12, 19] as const;
export const DEFAULT_REMINDER_HOUR = 19;
export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

export const PROGRAM_LABEL: Record<Program, string> = { mba: 'MBA', masters: "Master's", phd: 'PhD' };
export const DESTINATION_LABEL: Record<Destination, string> = {
  us: 'United States', canada: 'Canada', australia: 'Australia', uk: 'United Kingdom', singapore: 'Singapore', hongkong: 'Hong Kong',
};
export const FIELD_LABEL: Record<Field, string> = {
  business: 'Business', cs: 'Computer Science', engineering: 'Engineering', 'econ-finance': 'Economics/Finance', 'data-science': 'Data Science',
  design: 'Design', health: 'Health/Medicine', 'social-sciences': 'Social Sciences', other: 'Other',
};

export const DEFAULT_ONBOARDING: Onboarding = {
  done: false, track: 'grad', destinations: [], stage: 'exploring',
  reminders: { email: true, hourLocal: DEFAULT_REMINDER_HOUR }, timezone: DEFAULT_TIMEZONE,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uniq = <T,>(xs: T[]): T[] => xs.filter((x, i) => xs.indexOf(x) === i);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** True when the string is an IANA time zone the runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Reads the onboarding object defensively from the whole settings jsonb (or from the onboarding object itself
 * when `{ onboarding: ... }` is not present). Missing or invalid values fall back to defaults; done is true
 * only when stored as exactly `true`.
 */
export function parseOnboarding(settings: unknown): Onboarding {
  const raw = isObj(settings) && 'onboarding' in settings ? settings.onboarding : undefined;
  if (!isObj(raw)) return { ...DEFAULT_ONBOARDING, reminders: { ...DEFAULT_ONBOARDING.reminders } };
  const track: Track = oneOf(TRACKS, raw.track) ? raw.track : DEFAULT_ONBOARDING.track;
  // programs: stored order (first choice first), deduped; an explicit valid `program` always leads.
  const programs = track !== 'grad' ? [] : uniq([
    ...(oneOf(PROGRAMS, raw.program) ? [raw.program] : []),
    ...(Array.isArray(raw.programs) ? raw.programs.filter((p): p is Program => oneOf(PROGRAMS, p)) : []),
  ]);
  const program = programs[0];
  const fields = Array.isArray(raw.fields) ? uniq(raw.fields.filter((f): f is Field => oneOf(FIELDS, f))) : [];
  const destinations = Array.isArray(raw.destinations) ? DESTINATIONS.filter((d) => (raw.destinations as unknown[]).includes(d)) : [];
  const intake = typeof raw.intake === 'string' && raw.intake.trim() && raw.intake.length <= 40 ? raw.intake.trim() : undefined;
  const stage: Stage = oneOf(STAGES, raw.stage) ? raw.stage : DEFAULT_ONBOARDING.stage;
  const r = isObj(raw.reminders) ? raw.reminders : {};
  const hour = typeof r.hourLocal === 'number' && Number.isInteger(r.hourLocal) && r.hourLocal >= 0 && r.hourLocal <= 23 ? r.hourLocal : DEFAULT_REMINDER_HOUR;
  const email = typeof r.email === 'boolean' ? r.email : DEFAULT_ONBOARDING.reminders.email;
  const about = parseAbout(raw.about);
  return {
    done: raw.done === true, track, ...(program ? { program, programs } : {}), ...(fields.length ? { fields } : {}), destinations, ...(intake ? { intake } : {}), stage,
    reminders: { email, hourLocal: hour }, timezone: isValidTimeZone(raw.timezone) ? raw.timezone : DEFAULT_TIMEZONE,
    ...(about ? { about } : {}),
  };
}

/** Normalises an onboarding object for storage (drops programs for undergrad, empty intake and so on). */
export function toStoredOnboarding(o: Onboarding): Onboarding {
  return parseOnboarding({ onboarding: o });
}

/** The browser time zone, or the default when Intl cannot tell. */
export function browserTimeZone(): string {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE; } catch { return DEFAULT_TIMEZONE; }
}

/**
 * The next three intakes a student could still realistically aim for, from `today`.
 * Uses the common Spring (January) and Fall (September) starts and skips any start less than 3 months away.
 */
export function nextIntakes(today: Date, count = 3): string[] {
  const out: string[] = [];
  const minStart = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  for (let y = today.getFullYear(); out.length < count && y < today.getFullYear() + 5; y++) {
    for (const [label, month] of [['Spring', 0], ['Fall', 8]] as const) {
      if (out.length < count && new Date(y, month, 1) >= minStart) out.push(`${label} ${y}`);
    }
  }
  return out;
}

/** Countries whose universities mostly start in February and July (semesters), not September. */
const SEMESTER_DESTINATIONS: readonly Destination[] = ['australia'];

/**
 * Intake choices that fit the chosen countries, soonest first, each at least 3 months away.
 * - Australia: "Semester 1 2027 (Feb)" and "Semester 2 2027 (Jul)".
 * - Everywhere else: "Fall 2027" plus a January start, called "Spring 2028" when the US is picked
 *   (that is what US schools call it) and "January 2028" otherwise (UK, Canada, Singapore, Hong Kong).
 * With no country picked yet it falls back to the US style Fall/Spring list.
 * `count` applies per style, so picking Australia and the UK shows both sets.
 */
export function intakeOptions(destinations: readonly Destination[], today: Date, count = 3): string[] {
  const semester = destinations.some((d) => SEMESTER_DESTINATIONS.includes(d));
  const northern = destinations.length === 0 || destinations.some((d) => !SEMESTER_DESTINATIONS.includes(d));
  const january = destinations.length === 0 || destinations.includes('us') ? 'Spring' : 'January';
  const minStart = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const pick = (starts: (y: number) => [string, number][]): string[] => {
    const out: string[] = [];
    for (let y = today.getFullYear(); out.length < count && y < today.getFullYear() + 5; y++) {
      for (const [label, month] of starts(y)) if (out.length < count && new Date(y, month, 1) >= minStart) out.push(label);
    }
    return out;
  };
  return [
    ...(northern ? pick((y) => [[`${january} ${y}`, 0], [`Fall ${y}`, 8]]) : []),
    ...(semester ? pick((y) => [[`Semester 1 ${y} (Feb)`, 1], [`Semester 2 ${y} (Jul)`, 6]]) : []),
  ];
}

/** Every IANA time zone the runtime knows, with a short fallback list for older runtimes. */
export function timeZoneOptions(): string[] {
  const common = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Hong_Kong', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
    'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'UTC'];
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (all?.length) return uniq([...common.filter((z) => all.includes(z) || z === 'UTC'), ...all]);
  } catch { /* fall through */ }
  return common.filter(isValidTimeZone);
}
