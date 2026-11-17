// Pure interview logic: categories, request schemas, prompts, validators and score aggregation.
import { z } from 'zod';
import { hasUnlabelledProbability, type ValidateOk } from './coach.ts';

export const CATEGORIES = [
  'Tell me about yourself', 'Why MBA', 'Why this school', 'Short-term goals', 'Long-term goals', 'Leadership', 'Failure', 'Conflict', 'Teamwork',
  'Innovation', 'Ethical dilemmas', 'Personal background', 'Career transitions',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const SCORE_KEYS = ['clarity', 'structure', 'specificity', 'authenticity', 'confidence', 'leadership_evidence', 'strategic_alignment', 'relevance'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export const SCORE_LABEL: Record<ScoreKey, string> = { clarity: 'Clarity', structure: 'Structure', specificity: 'Specificity', authenticity: 'Authenticity', confidence: 'Confidence', leadership_evidence: 'Leadership evidence', strategic_alignment: 'Strategic alignment', relevance: 'Relevance' };
export const ORIGIN_LABEL = { ai_generated: 'AI-generated practice question', verified_historical: 'Verified historical (user-sourced)', user: 'Your question' } as const;

const uuid = z.string().uuid();
export const InterviewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate_questions'), schoolId: uuid, category: z.enum(CATEGORIES).optional(), count: z.number().int().min(1).max(8).optional() }),
  z.object({ action: z.literal('follow_up'), sessionId: uuid, questionId: uuid, answer: z.string().trim().min(1, 'Answer is empty').max(6000) }),
  z.object({ action: z.literal('evaluate'), questionId: uuid, answer: z.string().trim().min(1, 'Answer is empty').max(6000) }),
]);

const GEN_COMMON = 'Respond with ONLY one JSON object, no markdown fences. Never give an admission probability. Never state school statistics unless they appear in a "Sourced school data" record.';
export function generateQuestionsPrompt(o: { schoolName: string; category?: string; count: number; contextText: string; hasSchoolData: boolean }) {
  return {
    system: `You write MOCK interview practice questions for an MBA applicant. ${GEN_COMMON}
These are AI-generated practice questions, NOT questions known to be asked by the school. Do not say or imply a school "asks" them, and never label them as historical or verified.
Shape: {"questions":[{"category":"<one of: ${CATEGORIES.join(' | ')}>","question":"...","rationale":"one sentence on what this probes, tied to the applicant's records when possible"}]}
Questions must be answerable from the applicant's own experience and goals in the records; do not assume experiences not in the records. ${o.hasSchoolData ? 'School-specific questions may reference only the sourced school data.' : 'School data is NOT RESEARCHED, so keep school-specific questions generic about the school and do not state facts about it.'}`,
    user: `School: ${o.schoolName}\nCategory: ${o.category ?? 'a varied mix across categories'}\nNumber of questions: ${o.count}\n=== RETRIEVED RECORDS ===\n${o.contextText || '(none)'}\n=== END RECORDS ===`,
  };
}
export const GeneratedQuestions = z.object({ questions: z.array(z.object({ category: z.enum(CATEGORIES), question: z.string().trim().min(8).max(500), rationale: z.string().trim().max(500).optional() })).min(1).max(8) });
export function followUpPrompt(o: { question: string; category: string; answer: string; contextText: string }) {
  return {
    system: `You are an MBA admissions interviewer. ${GEN_COMMON}
Ask exactly ONE natural follow-up question that probes the weakest or most interesting part of the answer (missing detail, unclear impact, a claim that needs evidence). Do not assume facts not stated by the applicant. Shape: {"question":"...","reason":"one sentence on why you are probing this"}`,
    user: `Original question (${o.category}): ${o.question}\nApplicant answer:\n${o.answer}\n=== RETRIEVED RECORDS ===\n${o.contextText || '(none)'}\n=== END RECORDS ===`,
  };
}
export const FollowUpOut = z.object({ question: z.string().trim().min(8).max(500), reason: z.string().trim().max(500).optional() });
const sc = z.number().int().min(1).max(10);
export const EvaluationOut = z.object({
  scores: z.object(Object.fromEntries(SCORE_KEYS.map((k) => [k, sc])) as Record<ScoreKey, z.ZodNumber>),
  feedback: z.array(z.string().trim().min(1).max(800)).min(1).max(10),
  unsupported_claims: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  practice_questions: z.array(z.string().trim().min(8).max(500)).max(5).default([]),
});
export type EvaluationOutT = z.infer<typeof EvaluationOut>;
export function evaluatePrompt(o: { question: string; category: string; answer: string; contextText: string; hasSchoolData: boolean }) {
  return {
    system: `You evaluate ONE mock MBA interview answer. ${GEN_COMMON}
Score honestly 1-10 (do not inflate; 5 is average) on: ${SCORE_KEYS.join(', ')}. Judge only the text given; you cannot assess voice, tone or body language, so "confidence" reflects wording only (directness, hedging, ownership).
Shape: {"scores":{${SCORE_KEYS.map((k) => `"${k}":<int>`).join(',')}},"feedback":["actionable, specific point"],"unsupported_claims":["claims in the answer that do not appear in the applicant records, to double check, or an empty list"],"practice_questions":["up to 5 follow-up practice questions"]}
Do not rewrite the answer with new facts. ${o.hasSchoolData ? '' : 'School data is NOT RESEARCHED, so judge strategic alignment from the applicant goals only and mention that school data is missing.'}`,
    user: `Question (${o.category}): ${o.question}\nAnswer:\n${o.answer}\n=== RETRIEVED RECORDS ===\n${o.contextText || '(none)'}\n=== END RECORDS ===`,
  };
}
function chk<T>(schema: z.ZodType<T>, raw: unknown): ValidateOk<T> {
  if (raw === null || raw === undefined) return { ok: false, error: 'not JSON' };
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ') };
  if (hasUnlabelledProbability(JSON.stringify(r.data))) return { ok: false, error: 'contains an unlabelled admission probability' };
  return { ok: true, value: r.data };
}
export const validateGenerated = (raw: unknown) => chk(GeneratedQuestions, raw);
export const validateFollowUp = (raw: unknown) => chk(FollowUpOut, raw);
export const validateEvaluation = (raw: unknown) => chk(EvaluationOut, raw);

// ---------- score aggregation ----------
export type ScoreMap = Partial<Record<ScoreKey, number>>;
export const overallScore = (s: ScoreMap): number | null => {
  const v = SCORE_KEYS.map((k) => s[k]).filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
export const cleanScores = (raw: unknown): ScoreMap => {
  const out: ScoreMap = {}; if (!raw || typeof raw !== 'object') return out;
  for (const k of SCORE_KEYS) { const v = (raw as Record<string, unknown>)[k]; if (typeof v === 'number' && v >= 1 && v <= 10) out[k] = v; }
  return out;
};
export type FeedbackRow = { question_id: string; scores: unknown; source: 'ai' | 'self'; created_at: string };
export type PerfPoint = { sessionId: string; label: string; date: string; overall: number | null; count: number } & Partial<Record<ScoreKey, number>>;
/** Average per-session scores of AI evaluations (latest AI feedback per question). Sessions with no AI feedback are skipped. */
export function sessionPerformance(sessions: { id: string; started_at: string | null; created_at: string }[], questions: { id: string; session_id: string | null }[], feedback: FeedbackRow[]): PerfPoint[] {
  const latest = new Map<string, FeedbackRow>();
  for (const f of feedback) { if (f.source !== 'ai') continue; const c = latest.get(f.question_id); if (!c || f.created_at > c.created_at) latest.set(f.question_id, f); }
  const bySession = new Map<string, ScoreMap[]>();
  for (const q of questions) { const f = latest.get(q.id); if (f && q.session_id) { const a = bySession.get(q.session_id) ?? []; a.push(cleanScores(f.scores)); bySession.set(q.session_id, a); } }
  return sessions.filter((s) => bySession.has(s.id)).sort((a, b) => (a.started_at ?? a.created_at).localeCompare(b.started_at ?? b.created_at)).map((s, i) => {
    const list = bySession.get(s.id)!; const pt: PerfPoint = { sessionId: s.id, label: `S${i + 1}`, date: (s.started_at ?? s.created_at).slice(0, 10), overall: null, count: list.length };
    const all: number[] = [];
    for (const k of SCORE_KEYS) { const v = list.map((m) => m[k]).filter((x): x is number => typeof x === 'number'); if (v.length) { pt[k] = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10; all.push(pt[k]!); } }
    pt.overall = all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null;
    return pt;
  });
}
export const countEvaluatedAnswers = (feedback: FeedbackRow[]) => new Set(feedback.filter((f) => f.source === 'ai').map((f) => f.question_id)).size;
/** The trend chart is shown only with at least 2 evaluated answers. */
export const canShowTrend = (evaluated: number) => evaluated >= 2;
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const p = (n: number) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}
/** Verified historical questions need a non-empty source note and only the user can create them. */
export function validateUserQuestionInput(i: { question: string; category: string; origin: 'user' | 'verified_historical'; sourceNote?: string }): string | null {
  if (i.question.trim().length < 8) return 'Question must be at least 8 characters.';
  if (i.question.length > 500) return 'Question must be 500 characters or fewer.';
  if (!i.category.trim()) return 'Choose a category.';
  if (i.origin === 'verified_historical' && !(i.sourceNote ?? '').trim()) return 'A verified question needs a source note (where you got it).';
  return null;
}
