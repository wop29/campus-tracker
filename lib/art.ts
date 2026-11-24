// Mochi art (public/art). Pure helpers: which picture goes where. All files are square and transparent.
// Kept free of React and path aliases so the tests can import it directly.

export const MASCOT_NAME = 'Mochi';

export const MASCOT_POSES = {
  wave: { src: '/art/mascot/wave.webp', alt: 'Mochi waving hello' },
  thinking: { src: '/art/mascot/thinking.webp', alt: 'Mochi thinking with a pencil' },
  cheer: { src: '/art/mascot/cheer.webp', alt: 'Mochi cheering' },
  sleepy: { src: '/art/mascot/sleepy.webp', alt: 'Mochi napping' },
  checklist: { src: '/art/mascot/checklist.webp', alt: 'Mochi holding a checklist' },
  party: { src: '/art/mascot/party.webp', alt: 'Mochi celebrating with a party popper' },
  search: { src: '/art/mascot/search.webp', alt: 'Mochi looking through a magnifying glass' },
  reading: { src: '/art/mascot/reading.webp', alt: 'Mochi reading a book' },
  happy: { src: '/art/character/face-happy.webp', alt: 'Mochi smiling' },
  surprised: { src: '/art/character/face-surprised.webp', alt: 'Mochi looking surprised' },
  admitted: { src: '/art/result/admitted.webp', alt: 'Mochi cheering with an acceptance letter' },
  waitlisted: { src: '/art/result/waitlisted.webp', alt: 'Mochi waiting patiently beside a clock' },
  'not-admitted': { src: '/art/result/not-admitted.webp', alt: 'Mochi holding a warm cup of tea' },
  interview: { src: '/art/result/interview.webp', alt: 'Mochi in a bow tie with an interview invitation' },
} as const;
export type MascotPose = keyof typeof MASCOT_POSES;
export const isMascotPose = (x: unknown): x is MascotPose => typeof x === 'string' && Object.hasOwn(MASCOT_POSES, x);

export const EMPTY_ART = {
  'no-applications': { src: '/art/empty/no-applications.webp', alt: 'Mochi with a backpack, ready to start' },
  'no-essays': { src: '/art/empty/no-essays.webp', alt: 'Mochi with a pencil and a blank notepad' },
  'all-done': { src: '/art/empty/all-done.webp', alt: 'Mochi relaxing in a deck chair' },
} as const;
export type EmptyArt = keyof typeof EMPTY_ART;

// ------------------------------------------------------------------ checklist icon tiles
export type ReqIcon = 'essay' | 'test-score' | 'english-test' | 'recommendation' | 'resume' | 'transcript' | 'fee' | 'interview' | 'video' | 'deadline';
export const REQ_ICON_LABEL: Record<ReqIcon, string> = {
  essay: 'Essay', 'test-score': 'Test score', 'english-test': 'English test', recommendation: 'Recommendation', resume: 'Resume',
  transcript: 'Transcript', fee: 'Fee', interview: 'Interview', video: 'Video', deadline: 'Deadline',
};
const CATEGORY_ICON: Record<string, ReqIcon> = { essays: 'essay', tests: 'test-score', recommendations: 'recommendation', resume: 'resume', academics: 'transcript' };
/** The icon tile for a checklist item, from its name first (more specific), then its category. null when nothing fits. */
export function reqIconFor(name: string, category?: string | null): ReqIcon | null {
  const n = name.toLowerCase();
  // Most specific first: "Video essay" is a video, "English proficiency" is filed under tests.
  if (/\bvideo\b/.test(n)) return 'video';
  if (/\binterview/.test(n)) return 'interview';
  if (/\bfees?\b/.test(n)) return 'fee';
  if (/\bdeadline/.test(n)) return 'deadline';
  if (/english|toefl|ielts|duolingo|\bpte\b|cambridge/.test(n)) return 'english-test';
  if (/gmat|\bgre\b|\bsat\b|\bact\b|\blsat\b|test score/.test(n)) return 'test-score';
  if (/essay|statement|\bsop\b/.test(n)) return 'essay';
  if (/recommend|reference|referee/.test(n)) return 'recommendation';
  if (/resume|résumé|\bcv\b|curriculum vitae/.test(n)) return 'resume';
  if (/transcript|academic record|marksheet|diploma/.test(n)) return 'transcript';
  return (category && CATEGORY_ICON[category]) || null;
}
export const reqIconSrc = (icon: ReqIcon) => `/art/icon/${icon}.webp`;

// ------------------------------------------------------------------ country stamps
export type Stamp = 'us' | 'uk' | 'canada' | 'australia' | 'europe' | 'asia';
export const STAMP_LABEL: Record<Stamp, string> = { us: 'United States', uk: 'United Kingdom', canada: 'Canada', australia: 'Australia', europe: 'Europe', asia: 'Asia' };
const EXACT: Record<string, Stamp> = {
  'united states': 'us', 'united states of america': 'us', usa: 'us', us: 'us', 'u.s.': 'us', 'u.s.a.': 'us', america: 'us',
  'united kingdom': 'uk', uk: 'uk', 'u.k.': 'uk', 'great britain': 'uk', britain: 'uk', england: 'uk', scotland: 'uk', wales: 'uk', 'northern ireland': 'uk',
  canada: 'canada', australia: 'australia',
};
const EUROPE = ['france', 'spain', 'switzerland', 'germany', 'italy', 'netherlands', 'belgium', 'ireland', 'portugal', 'austria', 'denmark', 'sweden', 'norway',
  'finland', 'poland', 'czech', 'hungary', 'greece', 'luxembourg', 'monaco', 'iceland', 'estonia', 'latvia', 'lithuania', 'slovenia', 'slovakia', 'croatia', 'romania', 'bulgaria', 'europe'];
const ASIA = ['singapore', 'hong kong', 'china', 'japan', 'korea', 'india', 'indonesia', 'malaysia', 'thailand', 'vietnam', 'philippines', 'taiwan', 'macau', 'macao',
  'united arab emirates', 'uae', 'qatar', 'israel', 'saudi', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'kazakhstan', 'asia'];
/** Passport stamp for a school country. null when the country is unknown or outside the six stamps. */
export function stampFor(country?: string | null): Stamp | null {
  const c = (country ?? '').trim().toLowerCase();
  if (!c) return null;
  if (EXACT[c]) return EXACT[c];
  if (EUROPE.some((x) => c.includes(x))) return 'europe';
  if (ASIA.some((x) => (x.length <= 3 ? c === x : c.includes(x)))) return 'asia';
  return null;
}
export const stampSrc = (s: Stamp) => `/art/stamp/${s}.webp`;

// ------------------------------------------------------------------ badges and emails
/** Badge id (lib/gamification.ts) to ribbon art. Badges without art keep their icon. */
export const BADGE_ART: Record<string, string> = {
  'first-step': 'first-step', 'profile-pro': 'profile-complete', wordsmith: 'essay-wizard', 'streak-3': 'streak-7', 'streak-7': 'streak-7', 'streak-30': 'streak-7',
  'back-up-crew': 'recommender', submitted: 'submitted', admitted: 'admitted',
};
export const badgeArtSrc = (id: string): string | null => (BADGE_ART[id] ? `/art/badge/${BADGE_ART[id]}.webp` : null);

export type EmailSticker = 'nudge' | 'deadline-week' | 'result-soon' | 'milestone';
export const EMAIL_STICKER_ALT: Record<EmailSticker, string> = {
  nudge: 'Mochi peeking in to say hello', 'deadline-week': 'Mochi with a checklist and a calendar', 'result-soon': 'Mochi cheering with pom-poms', milestone: 'Mochi holding a trophy',
};
export function emailStickerFor(kind: 'nudge' | 'deadline_week' | 'result_soon' | 'celebration'): EmailSticker {
  return ({ nudge: 'nudge', deadline_week: 'deadline-week', result_soon: 'result-soon', celebration: 'milestone' } as const)[kind];
}
