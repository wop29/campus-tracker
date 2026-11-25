// Pure essay logic: statuses, validation, word-level diff, AI review parsing. No runtime imports from the app so it can be unit tested.
import { z } from 'zod';

export const ESSAY_STATUSES = ['not_started', 'brainstorming', 'first_draft', 'revision', 'final_review', 'approved', 'submitted'] as const;
export type EssayStatus = (typeof ESSAY_STATUSES)[number];
export const ESSAY_STATUS_LABEL: Record<EssayStatus, string> = {
  not_started: 'Not started', brainstorming: 'Brainstorming', first_draft: 'First draft', revision: 'Revision',
  final_review: 'Final review', approved: 'Approved', submitted: 'Submitted',
};

export type EssayRow = {
  id: string; application_id: string | null; school_id: string | null; title: string; prompt: string | null; word_limit: number | null;
  draft: string; status: EssayStatus; deadline: string | null; change_notes: string | null; duplicated_from: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
};
export type EssayVersionRow = {
  id: string; essay_id: string; version_number: number; text: string; word_count: number; change_notes: string | null;
  ai_review: StoredReview | null; user_comments: string | null; created_at: string;
};

/** Flattens a zod error to { field: first message }. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? '_'); if (!(k in out)) out[k] = i.message; }
  return out;
}

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
export const essayFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Keep the title under 200 characters'),
  school_id: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  application_id: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  prompt: z.string().trim().max(5000, 'Prompt is too long (5000 characters max)').optional(),
  word_limit: z.preprocess(emptyToUndef, z.coerce.number({ error: 'Word limit must be a number' }).int('Whole number only').positive('Must be greater than 0').max(100000).optional()),
  deadline: z.preprocess(emptyToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()),
});
export type EssayFormInput = z.infer<typeof essayFormSchema>;

/** True when the draft text differs from what is saved. The DB trigger compares exact text, so we do too. */
export const draftChanged = (saved: string, current: string) => saved !== current;

// ---------- word-level diff ----------
export type DiffSegment = { type: 'equal' | 'add' | 'remove'; text: string };
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const MAX_DP_CELLS = 4_000_000;

/** Word-level diff (LCS). Whitespace and paragraph breaks are normalised to single spaces. */
export function diffWords(a: string, b: string): DiffSegment[] {
  const x = words(a), y = words(b);
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const xm = x.slice(s, x.length - e), ym = y.slice(s, y.length - e);
  const raw: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], w: string) => {
    const last = raw[raw.length - 1];
    if (last && last.type === type) last.text += ' ' + w; else raw.push({ type, text: w });
  };
  x.slice(0, s).forEach((w) => push('equal', w));
  const n = xm.length, m = ym.length;
  if (n * m > MAX_DP_CELLS) {
    xm.forEach((w) => push('remove', w)); ym.forEach((w) => push('add', w));
  } else if (n === 0 || m === 0) {
    xm.forEach((w) => push('remove', w)); ym.forEach((w) => push('add', w));
  } else {
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = xm[i] === ym[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (xm[i] === ym[j]) { push('equal', xm[i]); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push('remove', xm[i]); i++; }
      else { push('add', ym[j]); j++; }
    }
    while (i < n) push('remove', xm[i++]);
    while (j < m) push('add', ym[j++]);
  }
  x.slice(x.length - e).forEach((w) => push('equal', w));
  // push() merges adjacent same-type words, but a remove followed by add can interleave; keep removals before additions in a run.
  return raw;
}
export function diffStats(segs: DiffSegment[]) {
  const c = (t: DiffSegment['type']) => segs.filter((g) => g.type === t).reduce((n, g) => n + words(g.text).length, 0);
  return { added: c('add'), removed: c('remove'), unchanged: c('equal') };
}

// ---------- AI review ----------
export const AI_MODES = [
  { mode: 'critique', label: 'Critique', hint: 'Overall strengths, weaknesses and scores' },
  { mode: 'structural', label: 'Structural review', hint: 'Flow, order and paragraph roles' },
  { mode: 'sentence', label: 'Sentence-level feedback', hint: 'Clarity and wording' },
  { mode: 'full_revision', label: 'Full revision notes', hint: 'Suggestions for a complete rewrite pass' },
  { mode: 'reduce_words', label: 'Reduce word count', hint: 'Where to cut to meet the limit' },
  { mode: 'school_positioning', label: 'School positioning', hint: 'Fit with the target school' },
] as const;
export type AiMode = (typeof AI_MODES)[number]['mode'];

export const SCORE_KEYS: { key: string; label: string }[] = [
  { key: 'promptalignment', label: 'Prompt alignment' }, { key: 'clarity', label: 'Clarity' }, { key: 'authenticity', label: 'Authenticity' },
  { key: 'specificity', label: 'Specificity' }, { key: 'leadership', label: 'Leadership' }, { key: 'careernarrative', label: 'Career narrative' },
  { key: 'schoolfit', label: 'School fit' }, { key: 'storytelling', label: 'Storytelling' }, { key: 'differentiation', label: 'Differentiation' },
  { key: 'structure', label: 'Structure' },
];
const norm = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '');
const prettify = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** Orders returned scores: the 10 known dimensions first (in a fixed order), then any extras. Never invents a missing score. */
export function orderScores(scores: Record<string, number>): { label: string; value: number }[] {
  const used = new Set<string>(); const out: { label: string; value: number }[] = [];
  for (const k of SCORE_KEYS) {
    const hit = Object.keys(scores).find((s) => norm(s) === k.key);
    if (hit && typeof scores[hit] === 'number') { out.push({ label: k.label, value: scores[hit] }); used.add(hit); }
  }
  for (const [k, v] of Object.entries(scores)) if (!used.has(k) && typeof v === 'number') out.push({ label: prettify(k), value: v });
  return out;
}

const strArr = z.array(z.string()).default([]);
export const reviewSchema = z.object({
  works: strArr, doesNotWork: strArr, missing: strArr, generic: strArr, weakEvidence: strArr, strongerStories: strArr, reviseFirst: strArr,
});
export const reviewResponseSchema = z.object({
  scores: z.record(z.string(), z.number()).default({}),
  review: reviewSchema,
  suggestions: z.string().optional(),
  assessmentId: z.string().optional(),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
export type StoredReview = ReviewResponse & { mode?: string; reviewedAt?: string };

export const REVIEW_SECTIONS: { key: keyof z.infer<typeof reviewSchema>; label: string }[] = [
  { key: 'reviseFirst', label: 'Revise first' }, { key: 'works', label: 'What works' }, { key: 'doesNotWork', label: 'What does not work' },
  { key: 'missing', label: 'What is missing' }, { key: 'generic', label: 'Generic passages' }, { key: 'weakEvidence', label: 'Weak evidence' },
  { key: 'strongerStories', label: 'Stronger story options' },
];

// ---------- status and labels ----------
/**
 * The status to store after a draft save. An essay that was "Not started" moves to "First draft" as soon as a save
 * has real words in it; every other status is the student's own choice and is left alone. Null means "no change".
 */
export function statusAfterSave(current: EssayStatus, savedText: string): EssayStatus | null {
  return current === 'not_started' && savedText.trim().length > 0 ? 'first_draft' : null;
}

/**
 * The line under an essay title: the school once, then the application's own details (program, intake, round).
 * Example: "Duke Fuqua · Full-time MBA, Fall 2027, Round 2". Falls back to the application's school when no school is linked.
 */
export function essaySubtitle(schoolName: string | null | undefined, app: { schoolName?: string | null; program?: string | null; intake?: string | null; round?: string | null } | null | undefined): string {
  const school = (schoolName ?? '').trim() || (app?.schoolName ?? '').trim();
  const details = app ? [app.program, app.intake, app.round].map((x) => (x ?? '').trim()).filter(Boolean).join(', ') : '';
  return [school, details].filter(Boolean).join(' · ') || 'No school linked';
}

/** What the essay form says about the deadline. Essay deadlines come from the linked application, never typed by hand.
 *  undefined = no application linked; null = application has no deadline yet. */
export function essayDeadlineNote(appDue: string | null | undefined, now: Date = new Date()): string {
  if (appDue === undefined) return 'Link an application and the deadline will come from its real round date.';
  if (appDue === null) return "This application has no deadline yet. Pick its round on the Applications page and the date shows up here.";
  const d = new Date(appDue);
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return days < 0 ? `Due with your application on ${date} (passed).` : `Due with your application on ${date} (${days} day${days === 1 ? '' : 's'} left).`;
}
