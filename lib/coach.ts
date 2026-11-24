// Pure prompt builders, request schemas and response validators for the AI coach, assessments and essay review.
// Nothing here calls a model or the database, so everything is unit-testable with fixed inputs.
import { z } from 'zod';

export const COACH_MODES = ['strategist', 'essay_coach', 'interview_coach', 'execution'] as const;
export type CoachMode = (typeof COACH_MODES)[number];
export const COACH_MODE_LABEL: Record<CoachMode, string> = { strategist: 'Admissions Strategist', essay_coach: 'Essay Coach', interview_coach: 'Interview Coach', execution: 'Execution Assistant' };
export const COACH_MODE_HINT: Record<CoachMode, string> = {
  strategist: 'Big-picture school strategy, positioning and gaps, grounded in your records.',
  essay_coach: 'Brainstorm and critique essays. It never writes your story for you or invents facts.',
  interview_coach: 'Plan answers and practice themes using your own stories and goals.',
  execution: 'Turn your applications, tasks and deadlines into a concrete plan.',
};

export const LIMITS = { message: 4000, historyMessages: 12, historyChars: 24000, storedMessages: 200 } as const;

export const CoachBody = z.object({
  mode: z.enum(COACH_MODES),
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, 'Message is empty').max(LIMITS.message, `Message is longer than ${LIMITS.message} characters`),
  schoolId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  essayId: z.string().uuid().optional(),
});

const COMMON = `You are an MBA admissions coach inside the applicant's private workspace. You are given retrieved records, each under a heading like [kind:id] Label. Ground every statement about the applicant in those records and mention the record label when you rely on it. If something is not in the records, say it is not in their records and ask them to add it on the Profile page; do not guess.
Hard rules:
- Never invent or embellish achievements, numbers, employers, titles, dates, recommender opinions or school statistics. School statistics may only come from a "Sourced school data" record, with its source. If that record says NOT RESEARCHED, say the school's data is not researched yet.
- Never give a numeric admission probability. If asked about chances, use qualitative tiers (Reach, Competitive, Stronger fit) and say this is a qualitative, non-official view. A number is only acceptable if you label it "speculative estimate".
- Never rewrite or alter the applicant's personal history. The applicant is the author; you advise.
- Be direct, specific and concise. Use short paragraphs or bullets. No flattery.`;
const MODE_PROMPTS: Record<CoachMode, string> = {
  strategist: `${COMMON}\nMode: Admissions Strategist. Help the applicant decide school fit, positioning, which gaps matter most, sequencing of effort and which stories to lead with. Distinguish what the records support from what is missing.`,
  essay_coach: `${COMMON}\nMode: Essay Coach. Help brainstorm angles, structure, and tighten arguments. Ask probing questions before suggesting. You may suggest structure or alternative phrasing of the applicant's own sentences, but never add facts, anecdotes or results that are not in the records; use placeholders like [add your specific result] where evidence is missing.`,
  interview_coach: `${COMMON}\nMode: Interview Coach. Help the applicant plan truthful answers using their own stories, goals and records. Suggest structure (situation, action, result, reflection) and likely follow-up probes. Do not claim a question is "commonly asked at" a school unless a sourced record says so; call such questions practice questions.`,
  execution: `${COMMON}\nMode: Execution Assistant. Turn the pipeline, requirements, tasks and deadlines in the records into a prioritised plan with realistic effort sizes. Only reference tasks and deadlines that appear in the records; propose new tasks clearly labelled as suggestions.`,
};
export const coachSystemPrompt = (mode: CoachMode, contextText: string) =>
  `${MODE_PROMPTS[mode]}\n\n=== RETRIEVED RECORDS (use only these) ===\n${contextText || '(No records were retrieved. The applicant has not entered data yet; say so and point them to the Profile page.)'}\n=== END RECORDS ===`;

export type ChatMsg = { role: 'user' | 'assistant'; content: string };
/** Keeps the most recent messages within count and character limits, always starting on a user turn. */
export function limitHistory(history: ChatMsg[], maxMessages: number = LIMITS.historyMessages, maxChars: number = LIMITS.historyChars): ChatMsg[] {
  const out: ChatMsg[] = []; let chars = 0;
  for (let i = history.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = history[i]; if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (chars + m.content.length > maxChars && out.length > 0) break;
    chars += m.content.length; out.unshift({ role: m.role, content: m.content.slice(0, maxChars) });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
export function buildCoachMessages(history: ChatMsg[], userMessage: string): ChatMsg[] {
  return [...limitHistory(history), { role: 'user', content: userMessage }];
}

/** Numeric admission odds are forbidden unless explicitly labelled as a speculative estimate. */
export function hasUnlabelledProbability(text: string): boolean {
  const re = /\b\d{1,3}(\.\d+)?\s?%\s*(chance|probability|likelihood|odds|shot)|\b(chance|probability|odds|likelihood)s?\s+(of\s+(admission|getting in|acceptance)\s+)?((is|are|of|at|about|around|roughly|approximately|~)\s*)*\d{1,3}(\.\d+)?\s?%/i;
  return re.test(text) && !/speculative estimate/i.test(text);
}

// ---------- profile assessment ----------
export const PROFILE_DIMENSIONS = ['Academic competitiveness', 'Professional experience', 'Leadership', 'Career clarity', 'Differentiation', 'Extracurriculars', 'School alignment', 'Application execution'] as const;
export const TIERS = ['Reach', 'Competitive', 'Stronger fit', 'Insufficient data'] as const;
export const ASSESSMENT_DISCLAIMER = 'Qualitative, AI-generated view based only on the records you entered. It is not an official evaluation and not a prediction of admission.';
const strs = z.array(z.string().trim().min(1).max(600)).max(12);
export const ProfileResult = z.object({
  dimensions: z.array(z.object({
    name: z.enum(PROFILE_DIMENSIONS),
    score: z.number().int().min(1).max(5).nullable(),
    evidence: strs, gaps: strs, improvements: strs,
    confidence: z.enum(['low', 'medium', 'high']),
  })).length(PROFILE_DIMENSIONS.length),
  overall: z.string().trim().min(1).max(3000),
  tier: z.enum(TIERS),
  disclaimer: z.string().trim().min(1).max(600),
}).superRefine((v, ctx) => {
  const names = new Set(v.dimensions.map((d) => d.name));
  if (names.size !== PROFILE_DIMENSIONS.length) ctx.addIssue({ code: 'custom', message: 'each dimension must appear exactly once' });
  v.dimensions.forEach((d, i) => {
    if (d.score !== null && d.evidence.length === 0) ctx.addIssue({ code: 'custom', path: ['dimensions', i, 'evidence'], message: 'a scored dimension needs evidence' });
    if (d.score === null && d.confidence !== 'low') ctx.addIssue({ code: 'custom', path: ['dimensions', i, 'confidence'], message: 'an unscored dimension must have low confidence' });
  });
});
export type ProfileResultT = z.infer<typeof ProfileResult>;

export const GapResult = z.object({
  summary: z.string().trim().min(1).max(2500),
  gaps: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    severity: z.enum(['low', 'medium', 'high']),
    evidence: strs,
    potential_impact: z.string().trim().min(1).max(800),
    fixable: z.boolean(),
    recommended_action: z.string().trim().min(1).max(800),
    estimated_effort: z.string().trim().min(1).max(200),
    suggested_timeline: z.string().trim().min(1).max(200),
  })).max(15),
  disclaimer: z.string().trim().min(1).max(600),
});
export type GapResultT = z.infer<typeof GapResult>;
export type SchoolDataStatus = 'researched' | 'not_researched';

export const AssessBody = z.object({ kind: z.enum(['profile', 'school_gap']), schoolId: z.string().uuid().optional() })
  .refine((v) => v.kind !== 'school_gap' || !!v.schoolId, { message: 'schoolId is required for a school gap analysis', path: ['schoolId'] });

const ASSESS_COMMON = `Respond with ONLY one JSON object, no prose and no markdown fences. Use ONLY the retrieved records. Cite records in "evidence" using their exact labels (for example "Work: Consultant at X" or "Test: GMAT attempt 1"). Never include a numeric admission probability. Every list item must be a single plain sentence.`;
export function profileAssessPrompt(contextText: string): { system: string; user: string } {
  return {
    system: `You assess an MBA applicant's profile qualitatively. ${ASSESS_COMMON}
Return JSON of this exact shape:
{"dimensions":[{"name":"<one of: ${PROFILE_DIMENSIONS.join(' | ')}>","score":<integer 1-5 or null if the records are insufficient>,"evidence":["record label: what it shows"],"gaps":["..."],"improvements":["..."],"confidence":"low|medium|high"}],"overall":"<short qualitative assessment>","tier":"Reach|Competitive|Stronger fit|Insufficient data","disclaimer":"<state that this is qualitative and not an official evaluation>"}
Rules: include all ${PROFILE_DIMENSIONS.length} dimensions exactly once, in the order given. Use score null with confidence "low" when records are insufficient (do not guess). A scored dimension must have at least one evidence item. "tier" is a qualitative overall position; use "Insufficient data" if key areas are missing. Do not compare to school statistics here.`,
    user: `=== RETRIEVED RECORDS ===\n${contextText || '(none)'}\n=== END RECORDS ===\nAssess this applicant.`,
  };
}
export function gapAssessPrompt(contextText: string, schoolName: string, hasSchoolData: boolean): { system: string; user: string } {
  return {
    system: `You run a gap analysis of an MBA applicant against ONE target school. ${ASSESS_COMMON}
Return JSON: {"summary":"...","gaps":[{"title":"...","severity":"low|medium|high","evidence":["record label: fact"],"potential_impact":"...","fixable":true|false,"recommended_action":"...","estimated_effort":"e.g. 10 hours","suggested_timeline":"e.g. within 4 weeks"}],"disclaimer":"qualitative, not an official evaluation"}
${hasSchoolData
  ? 'Compare numbers (for example GMAT or GPA) against school figures ONLY from the "Sourced school data" record and name the source and year when you do. If a figure is absent from that record, say it is not researched.'
  : 'The school record says NOT RESEARCHED. Do NOT compare against any school statistic and do not state any. Limit gaps to qualitative ones from the applicant records, and include a gap saying the school data is not researched with the action to add sourced data on the School page.'}
Order gaps by severity (high first).`,
    user: `Target school: ${schoolName}\n=== RETRIEVED RECORDS ===\n${contextText || '(none)'}\n=== END RECORDS ===\nProduce the gap analysis.`,
  };
}

export type ValidateOk<T> = { ok: true; value: T } | { ok: false; error: string };
function check<T>(schema: z.ZodType<T>, raw: unknown): ValidateOk<T> {
  if (raw === null || raw === undefined) return { ok: false, error: 'not JSON' };
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ') };
  if (hasUnlabelledProbability(JSON.stringify(r.data))) return { ok: false, error: 'contains an unlabelled admission probability' };
  return { ok: true, value: r.data };
}
export const validateProfile = (raw: unknown) => check(ProfileResult, raw);
export const validateGap = (raw: unknown) => check(GapResult, raw);

/** Compare two profile assessments dimension by dimension (previous -> latest). */
export function compareProfiles(prev: ProfileResultT, cur: ProfileResultT) {
  return PROFILE_DIMENSIONS.map((name) => {
    const a = prev.dimensions.find((d) => d.name === name)?.score ?? null;
    const b = cur.dimensions.find((d) => d.name === name)?.score ?? null;
    const delta = a !== null && b !== null ? b - a : null;
    return { name, previous: a, current: b, delta, trend: delta === null ? 'n/a' as const : delta > 0 ? 'up' as const : delta < 0 ? 'down' as const : 'same' as const };
  });
}

// ---------- essay review ----------
export const ESSAY_SCORE_KEYS = ['prompt_alignment', 'clarity', 'authenticity', 'specificity', 'leadership', 'career_narrative', 'school_fit', 'storytelling', 'differentiation', 'structure'] as const;
export const ESSAY_MODES = ['critique', 'structural', 'sentence', 'full_revision', 'reduce_words', 'school_positioning'] as const;
export type EssayMode = (typeof ESSAY_MODES)[number];
export const EssayReviewBody = z.object({ essayId: z.string().uuid(), mode: z.enum(ESSAY_MODES) });
const rv = z.array(z.string().trim().min(1).max(800)).max(15);
export const EssayReviewOut = z.object({
  scores: z.object(Object.fromEntries(ESSAY_SCORE_KEYS.map((k) => [k, z.number().int().min(1).max(10)])) as Record<(typeof ESSAY_SCORE_KEYS)[number], z.ZodNumber>),
  review: z.object({ works: rv, doesNotWork: rv, missing: rv, generic: rv, weakEvidence: rv, strongerStories: rv, reviseFirst: rv }),
  suggestions: z.string().trim().max(12000).optional(),
});
export type EssayReviewOutT = z.infer<typeof EssayReviewOut>;
export function validateEssayReview(raw: unknown, mode: EssayMode): ValidateOk<EssayReviewOutT> {
  const r = check(EssayReviewOut, raw); if (!r.ok) return r;
  if (mode !== 'critique' && !r.value.suggestions) return { ok: false, error: 'suggestions missing for this mode' };
  if (mode === 'critique') { const { suggestions: _s, ...rest } = r.value; void _s; return { ok: true, value: rest }; }
  return r;
}
const MODE_TASK: Record<EssayMode, string> = {
  critique: 'Give a critique only. Do NOT include a "suggestions" field.',
  structural: 'In "suggestions", give a structural edit plan: the ideal paragraph-by-paragraph structure for THIS draft, what to move, cut or expand, and why. Do not rewrite sentences.',
  sentence: 'In "suggestions", give sentence-level feedback: quote short fragments from the draft and say how to tighten or sharpen them (clarity, verbs, specificity). Suggested wording may only rephrase what the draft already says.',
  full_revision: 'In "suggestions", give a full revision proposal of the draft. Reuse only facts present in the draft or retrieved records. Where evidence is missing write a bracketed placeholder such as [add your specific result]. The applicant must review every sentence.',
  reduce_words: 'In "suggestions", show how to reduce the draft to fit the word limit (state the target) by listing cuts and tightenings, then give a trimmed version. Do not add new facts.',
  school_positioning: 'In "suggestions", explain how to position the essay for this school using ONLY the sourced school data in the records. If the school data is NOT RESEARCHED, say so and give only positioning advice that follows from the prompt itself.',
};
export function essayReviewPrompt(o: { mode: EssayMode; contextText: string; title: string; prompt: string | null; wordLimit: number | null; draft: string; wordCount: number }): { system: string; user: string } {
  return {
    system: `You review an MBA application essay. Respond with ONLY one JSON object, no markdown fences.
Shape: {"scores":{${ESSAY_SCORE_KEYS.map((k) => `"${k}":<integer 1-10>`).join(',')}},"review":{"works":[],"doesNotWork":[],"missing":[],"generic":[],"weakEvidence":[],"strongerStories":[],"reviseFirst":[]}${o.mode === 'critique' ? '' : ',"suggestions":"..."'}}
Each review list holds short plain sentences. "strongerStories" may only point to stories in the retrieved records (cite the story label); if none fit, return an empty list. "reviseFirst" is ordered by priority. Scores judge THIS draft against the prompt, honestly; do not inflate. Never add or alter the applicant's facts, never invent numbers or school statistics, never give an admission probability.
${MODE_TASK[o.mode]}`,
    user: `Essay title: ${o.title}\nPrompt: ${o.prompt || '(no prompt saved)'}\nWord limit: ${o.wordLimit ?? 'none'}\nDraft word count: ${o.wordCount}\n\n=== DRAFT ===\n${o.draft}\n=== END DRAFT ===\n\n=== RETRIEVED RECORDS (applicant data, sourced school data, stories) ===\n${o.contextText || '(none)'}\n=== END RECORDS ===`,
  };
}
