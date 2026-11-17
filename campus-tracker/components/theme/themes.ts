// Theme registry and DOM helpers. The database (applicant_profiles.settings.theme) is the source of truth.
// The `theme` cookie is only a presentation hint so the first paint matches the last applied theme.
export const THEMES = [
  { id: 'sunny', label: 'Sunny', blurb: 'Warm white with playful greens, yellows and oranges.' },
  { id: 'ocean', label: 'Ocean', blurb: 'Cool blues and teals.' },
  { id: 'berry', label: 'Berry', blurb: 'Purples and pinks.' },
  { id: 'midnight', label: 'Midnight', blurb: 'A dark theme with bright accents.' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const DEFAULT_THEME: ThemeId = 'sunny';
export const THEME_COOKIE = 'theme';

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && THEMES.some((t) => t.id === v);

export function readThemeCookie(): ThemeId | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)theme=([a-z]+)/);
  return m && isThemeId(m[1]) ? m[1] : null;
}
export function writeThemeCookie(id: ThemeId) {
  if (typeof document === 'undefined') return;
  document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}
export function applyTheme(id: ThemeId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', id);
}
/** Inline script source that applies the cookie hint before first paint. Optional: see components/theme/boot-script.tsx. */
export const BOOT_SCRIPT = `try{var m=document.cookie.match(/(?:^|;\\s*)theme=(sunny|ocean|berry|midnight)/);document.documentElement.setAttribute('data-theme',m?m[1]:'${DEFAULT_THEME}')}catch(e){}`;
