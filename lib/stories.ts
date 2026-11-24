// Pure story bank logic: categories, usage, overuse detection and transparent ranking against an essay prompt.
import { z } from 'zod';

export const STORY_CATEGORIES = ['leadership', 'failure', 'conflict', 'teamwork', 'innovation', 'entrepreneurship', 'social_impact', 'career_transition', 'personal_motivation', 'diversity', 'ethical_decisions', 'international'] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];
export const STORY_CATEGORY_LABEL: Record<StoryCategory, string> = {
  leadership: 'Leadership', failure: 'Failure', conflict: 'Conflict', teamwork: 'Teamwork', innovation: 'Innovation', entrepreneurship: 'Entrepreneurship',
  social_impact: 'Social impact', career_transition: 'Career transition', personal_motivation: 'Personal motivation', diversity: 'Diversity',
  ethical_decisions: 'Ethical decisions', international: 'International',
};

/** A story used in this many essays or more is flagged as overused. Admissions readers see all of your essays for a school, and reuse across
 *  schools is fine, but the same story three or more times starts to look like a thin profile. Change here to tune. */
export const OVERUSE_THRESHOLD = 3;
export const usageState = (count: number): 'unused' | 'ok' | 'overused' => (count <= 0 ? 'unused' : count >= OVERUSE_THRESHOLD ? 'overused' : 'ok');

export type StoryRow = {
  id: string; title: string; category: StoryCategory; situation: string | null; task: string | null; action: string | null; result: string | null;
  lessons_learned: string | null; quantified_impact: string | null; competencies: string[]; related_school_ids: string[]; related_prompts: string | null;
  usage_count: number; created_at: string; updated_at: string; deleted_at: string | null;
};

export const splitList = (s: string): string[] => Array.from(new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)));
const opt = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional();
export const storyFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Keep the title under 200 characters'),
  category: z.enum(STORY_CATEGORIES, { error: 'Choose a category' }),
  situation: opt(4000), task: opt(4000), action: opt(4000), result: opt(4000), lessons_learned: opt(4000), quantified_impact: opt(1000), related_prompts: opt(4000),
  competencies: z.string().max(500, 'Too long').optional(),
});

// ---------- ranking ----------
const STOP = new Set('a an the and or but of to in on for with at by from as is are was were be been being this that these those it its your you we our their they he she his her i me my what why how when where which who whom do does did describe tell us about please explain share give example time have has had can could would should will may might any one more most than then so such into out up over also not no yes if how'.split(' '));
export function stem(w: string): string {
  let s = w.toLowerCase();
  for (const suf of ['ations', 'ation', 'ships', 'ship', 'ing', 'ers', 'er', 'ed', 'es', 'ly', 's']) if (s.length > suf.length + 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  return s;
}
export function tokenize(text: string | null | undefined): string[] {
  return (text ?? '').toLowerCase().match(/[a-z][a-z-]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)).map(stem) ?? [];
}

/** Prompt words that signal each category. Visible to the user through the "why ranked" reasons. */
export const CATEGORY_KEYWORDS: Record<StoryCategory, string[]> = {
  leadership: ['lead', 'leader', 'leadership', 'manage', 'influence', 'guide', 'mentor', 'inspire', 'team', 'initiative'],
  failure: ['fail', 'failure', 'mistake', 'setback', 'challenge', 'difficult', 'learn', 'regret', 'disappoint', 'adversity'],
  conflict: ['conflict', 'disagree', 'disagreement', 'tension', 'negotiate', 'persuade', 'dispute', 'differing', 'resolve'],
  teamwork: ['team', 'collaborate', 'collaboration', 'together', 'group', 'colleague', 'cooperate', 'peers'],
  innovation: ['innovate', 'innovation', 'creative', 'new', 'build', 'launch', 'invent', 'improve', 'solution', 'technology'],
  entrepreneurship: ['entrepreneur', 'entrepreneurship', 'startup', 'venture', 'founder', 'found', 'risk', 'business'],
  social_impact: ['social', 'impact', 'community', 'society', 'volunteer', 'nonprofit', 'sustainability', 'give', 'contribute', 'world'],
  career_transition: ['career', 'goal', 'goals', 'transition', 'future', 'post-mba', 'aspiration', 'plan', 'professional', 'why mba', 'mba'],
  personal_motivation: ['passion', 'motivate', 'motivation', 'value', 'values', 'define', 'who', 'background', 'story', 'personal', 'drive'],
  diversity: ['diverse', 'diversity', 'inclusion', 'inclusive', 'perspective', 'culture', 'identity', 'unique', 'background', 'contribute'],
  ethical_decisions: ['ethic', 'ethical', 'integrity', 'dilemma', 'honest', 'right', 'principle', 'responsib', 'decision'],
  international: ['international', 'global', 'abroad', 'cross-cultural', 'country', 'countries', 'cultur', 'region', 'overseas'],
};
export const WEIGHTS = { categoryPerHit: 2, categoryMaxHits: 3, competency: 3, relatedPromptPerWord: 1, relatedPromptMax: 4, school: 2, titlePerWord: 1, titleMax: 2, overusePenalty: 2 } as const;

export type RankableStory = Pick<StoryRow, 'id' | 'title' | 'category' | 'competencies' | 'related_school_ids' | 'related_prompts'> & { usage_count: number };
export type RankedStory<T extends RankableStory> = { story: T; score: number; reasons: string[]; usage: ReturnType<typeof usageState> };

/** Ranks stories for an essay prompt. Pure: the same inputs always give the same order, and every point is explained in `reasons`. */
export function rankStories<T extends RankableStory>(prompt: string | null | undefined, stories: T[], opts: { schoolId?: string | null; usageCounts?: Map<string, number> } = {}): RankedStory<T>[] {
  const ptoks = new Set(tokenize(prompt));
  const out: RankedStory<T>[] = [];
  for (const story of stories) {
    let score = 0; const reasons: string[] = [];
    const kws = CATEGORY_KEYWORDS[story.category] ?? [];
    const hits = Array.from(new Set(kws.map(stem))).filter((k) => ptoks.has(k));
    if (hits.length) {
      const n = Math.min(hits.length, WEIGHTS.categoryMaxHits);
      score += n * WEIGHTS.categoryPerHit;
      reasons.push(`Category "${STORY_CATEGORY_LABEL[story.category]}" matches prompt words: ${hits.join(', ')} (+${n * WEIGHTS.categoryPerHit})`);
    }
    for (const c of story.competencies ?? []) {
      const ctoks = tokenize(c);
      if (ctoks.length && ctoks.every((t) => ptoks.has(t))) { score += WEIGHTS.competency; reasons.push(`Competency "${c}" appears in the prompt (+${WEIGHTS.competency})`); }
    }
    const rp = Array.from(new Set(tokenize(story.related_prompts))).filter((t) => ptoks.has(t));
    if (rp.length) { const n = Math.min(rp.length, WEIGHTS.relatedPromptMax); score += n * WEIGHTS.relatedPromptPerWord; reasons.push(`Related prompts you noted share words with this prompt: ${rp.slice(0, 6).join(', ')} (+${n * WEIGHTS.relatedPromptPerWord})`); }
    const tt = Array.from(new Set(tokenize(story.title))).filter((t) => ptoks.has(t));
    if (tt.length) { const n = Math.min(tt.length, WEIGHTS.titleMax); score += n * WEIGHTS.titlePerWord; reasons.push(`Title shares words with the prompt: ${tt.join(', ')} (+${n})`); }
    if (opts.schoolId && story.related_school_ids?.includes(opts.schoolId)) { score += WEIGHTS.school; reasons.push(`Marked as relevant to this school (+${WEIGHTS.school})`); }
    if (score <= 0) continue; // nothing in the prompt connects to this story
    const used = opts.usageCounts?.get(story.id) ?? story.usage_count;
    const usage = usageState(used);
    if (usage === 'overused') { score -= WEIGHTS.overusePenalty; reasons.push(`Already used in ${used} essays, so ranked lower (-${WEIGHTS.overusePenalty})`); }
    out.push({ story, score, reasons, usage });
  }
  return out.sort((a, b) => b.score - a.score || a.story.usage_count - b.story.usage_count || a.story.title.localeCompare(b.story.title));
}

/** Other stories in the same category that are used less than `story`, least used first. */
export function suggestAlternatives<T extends Pick<StoryRow, 'id' | 'category' | 'title'>>(story: T, all: T[], counts: Map<string, number>, limit = 3): T[] {
  const mine = counts.get(story.id) ?? 0;
  return all.filter((s) => s.id !== story.id && s.category === story.category && (counts.get(s.id) ?? 0) < mine)
    .sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.title.localeCompare(b.title)).slice(0, limit);
}

/** usage_count is always derived from live essay links, never incremented, so it cannot drift. */
export function deriveUsage(links: { story_id: string; essay_deleted_at?: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of links) if (!l.essay_deleted_at) m.set(l.story_id, (m.get(l.story_id) ?? 0) + 1);
  return m;
}
