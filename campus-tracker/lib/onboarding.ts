// First-run onboarding answers, stored as applicant_profiles.settings.onboarding (jsonb).
// Pure types and helpers only: no database access here (see components/onboarding/data.ts).

export type Track = 'grad' | 'undergrad';
export type Program = 'mba' | 'masters' | 'phd';
export type Destination = 'us' | 'canada' | 'australia' | 'uk';
export type Stage = 'exploring' | 'shortlisting' | 'applying' | 'submitted';

export type Onboarding = {
  done: boolean;
  track: Track;
  program?: Program; // grad only
  destinations: Destination[];
  intake?: string; // e.g. 'Fall 2027'; undefined means "not sure yet"
  stage: Stage;
  reminders: { email: boolean; hourLocal: number };
  timezone: string;
};

export const TRACKS: readonly Track[] = ['grad', 'undergrad'];
export const PROGRAMS: readonly Program[] = ['mba', 'masters', 'phd'];
export const DESTINATIONS: readonly Destination[] = ['us', 'canada', 'australia', 'uk'];
export const STAGES: readonly Stage[] = ['exploring', 'shortlisting', 'applying', 'submitted'];
export const REMINDER_HOURS = [8, 12, 19] as const;
export const DEFAULT_REMINDER_HOUR = 19;
export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

export const PROGRAM_LABEL: Record<Program, string> = { mba: 'MBA', masters: "Master's", phd: 'PhD' };
export const DESTINATION_LABEL: Record<Destination, string> = { us: 'United States', canada: 'Canada', australia: 'Australia', uk: 'United Kingdom' };

export const DEFAULT_ONBOARDING: Onboarding = {
  done: false, track: 'grad', destinations: [], stage: 'exploring',
  reminders: { email: true, hourLocal: DEFAULT_REMINDER_HOUR }, timezone: DEFAULT_TIMEZONE,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
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
  const program = track === 'grad' && oneOf(PROGRAMS, raw.program) ? raw.program : undefined;
  const destinations = Array.isArray(raw.destinations) ? DESTINATIONS.filter((d) => (raw.destinations as unknown[]).includes(d)) : [];
  const intake = typeof raw.intake === 'string' && raw.intake.trim() && raw.intake.length <= 40 ? raw.intake.trim() : undefined;
  const stage: Stage = oneOf(STAGES, raw.stage) ? raw.stage : DEFAULT_ONBOARDING.stage;
  const r = isObj(raw.reminders) ? raw.reminders : {};
  const hour = typeof r.hourLocal === 'number' && Number.isInteger(r.hourLocal) && r.hourLocal >= 0 && r.hourLocal <= 23 ? r.hourLocal : DEFAULT_REMINDER_HOUR;
  const email = typeof r.email === 'boolean' ? r.email : DEFAULT_ONBOARDING.reminders.email;
  return {
    done: raw.done === true, track, ...(program ? { program } : {}), destinations, ...(intake ? { intake } : {}), stage,
    reminders: { email, hourLocal: hour }, timezone: isValidTimeZone(raw.timezone) ? raw.timezone : DEFAULT_TIMEZONE,
  };
}

/** Normalises an onboarding object for storage (drops program for undergrad, empty intake and so on). */
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
