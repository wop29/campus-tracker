// Pure helpers for the add/edit school form: the country list and how a stored country maps to the dropdown.
// No React or Supabase here so it can be unit tested (tests/school-form.test.ts).

/** Countries offered in the dropdown, in the order students see them. Stored as these full names (matches the starter list). */
export const SCHOOL_COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Singapore', 'Hong Kong', 'France', 'Spain', 'Switzerland',
  'China', 'Netherlands', 'Germany', 'Japan',
] as const;
export const OTHER_COUNTRY = 'Other';

/** Short names a student or an older record might use, mapped to the dropdown name. */
const ALIASES: Record<string, string> = {
  us: 'United States', usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States', 'united states of america': 'United States', america: 'United States',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom', england: 'United Kingdom', scotland: 'United Kingdom',
  'hong kong sar': 'Hong Kong', hk: 'Hong Kong', 'the netherlands': 'Netherlands', holland: 'Netherlands', prc: 'China',
};

/** Splits a stored country into the dropdown choice plus the free text shown when the choice is "Other". */
export function countryChoice(stored: string | null | undefined): { choice: string; other: string } {
  const t = (stored ?? '').trim();
  if (!t) return { choice: '', other: '' };
  const k = t.toLowerCase();
  const hit = SCHOOL_COUNTRIES.find((c) => c.toLowerCase() === k) ?? ALIASES[k];
  if (hit) return { choice: hit, other: '' };
  if (k === 'other') return { choice: OTHER_COUNTRY, other: '' };
  return { choice: OTHER_COUNTRY, other: t };
}

/** The value to save: the chosen country, the typed name for "Other", or empty when nothing is chosen. */
export function countryValue(choice: string, other: string): string {
  if (choice === OTHER_COUNTRY) return other.trim().slice(0, 100);
  return (SCHOOL_COUNTRIES as readonly string[]).includes(choice) ? choice : '';
}

/** Onboarding destination codes as dropdown names, so a new school can start on the student's only destination. */
const DESTINATION_COUNTRY: Record<string, string> = { us: 'United States', uk: 'United Kingdom', canada: 'Canada', australia: 'Australia' };
export function defaultCountryFor(destinations: readonly string[] | null | undefined): string {
  const list = (destinations ?? []).map((d) => DESTINATION_COUNTRY[d]).filter(Boolean);
  return list.length === 1 ? list[0] : '';
}
