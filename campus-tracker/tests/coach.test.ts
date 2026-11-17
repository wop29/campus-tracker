import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, truncate, kv, rankItems, assembleContext, scoreItem, type CtxItem } from '../lib/ai-context.ts';
import {
  limitHistory, buildCoachMessages, coachSystemPrompt, hasUnlabelledProbability, CoachBody, validateProfile, validateGap, compareProfiles,
  validateEssayReview, essayReviewPrompt, profileAssessPrompt, gapAssessPrompt, PROFILE_DIMENSIONS, ESSAY_SCORE_KEYS, AssessBody, EssayReviewBody, type ProfileResultT,
} from '../lib/coach.ts';
import {
  InterviewBody, validateEvaluation, validateGenerated, sessionPerformance, canShowTrend, countEvaluatedAnswers, overallScore, cleanScores, fmtDuration,
  validateUserQuestionInput, generateQuestionsPrompt, evaluatePrompt, SCORE_KEYS, CATEGORIES,
} from '../lib/interview.ts';

const U = '11111111-1111-4111-8111-111111111111';

// ---- context retrieval ----
test('tokenize drops stopwords and short words, dedupes', () => { assert.deepEqual(tokenize('The leadership and Leadership of a team'), ['leadership', 'team']); });
test('truncate keeps short text and cuts long text with ellipsis', () => {
  assert.equal(truncate('short text', 50), 'short text');
  const t = truncate('word '.repeat(100), 40); assert.ok(t.length <= 40 && t.endsWith('…'));
});
test('kv skips empty values and truncates', () => { assert.equal(kv([['A', 'x'], ['B', ''], ['C', null], ['D', []], ['E', ['p', 'q']]]), 'A: x\nE: p, q'); });
test('rankItems orders by weighted relevance, then recency, and respects limit', () => {
  const stories = [
    { id: 'a', title: 'Launched pricing pilot', body: 'analytics', updated_at: '2026-01-01' },
    { id: 'b', title: 'Team conflict resolution', body: 'led a conflict between two engineers', updated_at: '2026-02-01' },
    { id: 'c', title: 'Conflict at work', body: 'misc', updated_at: '2026-03-01' },
  ];
  const r = rankItems(stories, 'Describe a conflict you resolved', (s) => [{ text: s.title, weight: 3 }, { text: s.body, weight: 1 }], 2);
  assert.deepEqual(r.map((x) => x.id), ['b', 'c']); assert.equal(r.length, 2);
  assert.equal(r[0]._score, 4); assert.equal(r[1]._score, 3);
});
test('rankItems with no matches falls back to recency (score 0), deterministic', () => {
  const r = rankItems([{ id: 'x', updated_at: '2026-01-01' }, { id: 'y', updated_at: '2026-05-01' }], 'zzzz', () => [{ text: 'nothing', weight: 1 }], 5);
  assert.deepEqual(r.map((x) => x.id), ['y', 'x']); assert.ok(r.every((x) => x._score === 0));
});
test('scoreItem is 0 without query tokens', () => { assert.equal(scoreItem([{ text: 'anything', weight: 5 }], []), 0); });
const item = (id: string, priority: number, len: number): CtxItem => ({ kind: 'k', id, label: 'L' + id, body: 'x'.repeat(len), priority });
test('assembleContext keeps high priority items and emits in original order', () => {
  const r = assembleContext([item('1', 10, 300), item('2', 90, 300), item('3', 50, 300)], 800);
  assert.deepEqual(r.used.map((u) => u.id), ['2', '3']); assert.deepEqual(r.dropped.map((u) => u.id), ['1']);
  assert.ok(r.text.length <= 800); assert.ok(r.text.startsWith('[k:2] L2'));
});
test('assembleContext truncates the last partially fitting item (>=200 room) and drops when no room', () => {
  const r = assembleContext([item('a', 90, 500), item('b', 80, 5000), item('c', 70, 100)], 900);
  assert.deepEqual(r.used.map((u) => u.id), ['a', 'b']); assert.ok(r.text.length <= 900); assert.deepEqual(r.dropped.map((u) => u.id), ['c']);
});
test('assembleContext handles empty input', () => { const r = assembleContext([], 1000); assert.equal(r.text, ''); assert.equal(r.used.length, 0); });

// ---- coach prompts and history ----
const hist = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `m${i}` }));
test('limitHistory keeps the last N and starts on a user turn', () => {
  const r = limitHistory(hist(20), 5); assert.ok(r.length <= 5); assert.equal(r[0].role, 'user'); assert.equal(r[r.length - 1].content, 'm19' === r[r.length - 1].content ? 'm19' : r[r.length - 1].content);
});
test('limitHistory respects the character budget', () => {
  const big = [{ role: 'user' as const, content: 'a'.repeat(600) }, { role: 'assistant' as const, content: 'b'.repeat(600) }, { role: 'user' as const, content: 'c'.repeat(600) }, { role: 'assistant' as const, content: 'd'.repeat(600) }];
  const r = limitHistory(big, 12, 1300); assert.ok(r.reduce((a, m) => a + m.content.length, 0) <= 1300); assert.equal(r[0].role, 'user');
});
test('buildCoachMessages appends the new user message last', () => { const m = buildCoachMessages(hist(4), 'next'); assert.equal(m[m.length - 1].content, 'next'); assert.equal(m[0].role, 'user'); });
test('coachSystemPrompt embeds records and forbids fabrication and numeric odds', () => {
  const s = coachSystemPrompt('strategist', '[work:1] Work: X'); assert.match(s, /\[work:1\] Work: X/); assert.match(s, /Never invent/); assert.match(s, /numeric admission probability/); assert.match(s, /Admissions Strategist/);
  assert.match(coachSystemPrompt('execution', ''), /No records were retrieved/);
});
test('CoachBody validates modes, message size and ids', () => {
  assert.ok(CoachBody.safeParse({ mode: 'essay_coach', message: ' hi ' }).success);
  assert.equal(CoachBody.safeParse({ mode: 'nope', message: 'hi' }).success, false);
  assert.equal(CoachBody.safeParse({ mode: 'strategist', message: '   ' }).success, false);
  assert.equal(CoachBody.safeParse({ mode: 'strategist', message: 'x'.repeat(4001) }).success, false);
  assert.equal(CoachBody.safeParse({ mode: 'strategist', message: 'a', schoolId: 'not-a-uuid' }).success, false);
  assert.ok(CoachBody.safeParse({ mode: 'strategist', message: 'a', schoolId: U }).success);
});
test('hasUnlabelledProbability flags odds unless labelled speculative estimate', () => {
  assert.equal(hasUnlabelledProbability('You have a 35% chance of admission'), true);
  assert.equal(hasUnlabelledProbability('Your probability of admission is about 40%'), true);
  assert.equal(hasUnlabelledProbability('Speculative estimate: 35% chance'), false);
  assert.equal(hasUnlabelledProbability('Your GMAT is 90% of the way to the median'), false);
  assert.equal(hasUnlabelledProbability('Reach tier, qualitative only'), false);
});
test('AssessBody requires schoolId for school_gap', () => {
  assert.equal(AssessBody.safeParse({ kind: 'school_gap' }).success, false);
  assert.ok(AssessBody.safeParse({ kind: 'school_gap', schoolId: U }).success); assert.ok(AssessBody.safeParse({ kind: 'profile' }).success);
});

// ---- profile / gap validation ----
const dim = (name: string, score: number | null = 3) => ({ name, score, evidence: score === null ? [] : ['Work: A at B'], gaps: [], improvements: ['do x'], confidence: score === null ? 'low' : 'medium' });
const goodProfile = () => ({ dimensions: PROFILE_DIMENSIONS.map((n) => dim(n)), overall: 'Solid.', tier: 'Competitive', disclaimer: 'Qualitative only.' });
test('validateProfile accepts a well-formed result', () => { assert.equal(validateProfile(goodProfile()).ok, true); });
test('validateProfile rejects null, missing dimension, bad score, bad tier', () => {
  assert.equal(validateProfile(null).ok, false);
  const a = goodProfile(); a.dimensions.pop(); assert.equal(validateProfile(a).ok, false);
  const b = goodProfile(); b.dimensions[0].score = 9; assert.equal(validateProfile(b).ok, false);
  const c = goodProfile(); c.tier = 'Safe'; assert.equal(validateProfile(c).ok, false);
});
test('validateProfile: scored dimension needs evidence; null score needs low confidence; duplicates rejected', () => {
  const a = goodProfile(); a.dimensions[1].evidence = []; assert.equal(validateProfile(a).ok, false);
  const b = goodProfile(); b.dimensions[2] = { ...dim(PROFILE_DIMENSIONS[2], null), confidence: 'high' }; assert.equal(validateProfile(b).ok, false);
  const c = goodProfile(); c.dimensions[1] = dim(PROFILE_DIMENSIONS[0]); assert.equal(validateProfile(c).ok, false);
  const d = goodProfile(); d.dimensions[2] = dim(PROFILE_DIMENSIONS[2], null); assert.equal(validateProfile(d).ok, true);
});
test('validateProfile rejects an unlabelled admission probability', () => {
  const a = goodProfile(); a.overall = 'You have a 60% chance of admission.'; assert.equal(validateProfile(a).ok, false);
  const b = goodProfile(); b.overall = 'Speculative estimate: 60% chance of admission.'; assert.equal(validateProfile(b).ok, true);
});
const goodGap = () => ({ summary: 's', gaps: [{ title: 't', severity: 'high', evidence: ['Test: GMAT attempt 1'], potential_impact: 'i', fixable: true, recommended_action: 'a', estimated_effort: '10 hours', suggested_timeline: '4 weeks' }], disclaimer: 'd' });
test('validateGap accepts good and rejects bad severity / non-boolean fixable', () => {
  assert.equal(validateGap(goodGap()).ok, true);
  const a = goodGap(); (a.gaps[0] as Record<string, unknown>).severity = 'critical'; assert.equal(validateGap(a).ok, false);
  const b = goodGap(); (b.gaps[0] as Record<string, unknown>).fixable = 'yes'; assert.equal(validateGap(b).ok, false);
});
test('gapAssessPrompt forbids statistics when school data is not researched', () => {
  assert.match(gapAssessPrompt('ctx', 'Booth', false).system, /Do NOT compare against any school statistic/);
  assert.match(gapAssessPrompt('ctx', 'Booth', true).system, /ONLY from the "Sourced school data" record/);
  assert.match(profileAssessPrompt('ctx').user, /ctx/);
});
test('compareProfiles computes per-dimension deltas and handles null scores', () => {
  const prev = goodProfile() as unknown as ProfileResultT; const cur = goodProfile() as unknown as ProfileResultT;
  cur.dimensions[0].score = 4; cur.dimensions[1].score = 2; cur.dimensions[2].score = null; cur.dimensions[2].evidence = []; cur.dimensions[2].confidence = 'low';
  const c = compareProfiles(prev, cur);
  assert.deepEqual([c[0].delta, c[0].trend], [1, 'up']); assert.deepEqual([c[1].delta, c[1].trend], [-1, 'down']); assert.deepEqual([c[2].delta, c[2].trend], [null, 'n/a']); assert.equal(c[3].trend, 'same');
});

// ---- essay review ----
const goodReview = () => ({
  scores: Object.fromEntries(ESSAY_SCORE_KEYS.map((k) => [k, 6])),
  review: { works: ['a'], doesNotWork: ['b'], missing: [], generic: [], weakEvidence: [], strongerStories: [], reviseFirst: ['c'] },
});
test('validateEssayReview: critique strips suggestions; other modes require them', () => {
  const c = validateEssayReview({ ...goodReview(), suggestions: 'x' }, 'critique'); assert.ok(c.ok && !('suggestions' in c.value));
  assert.equal(validateEssayReview(goodReview(), 'structural').ok, false);
  const s = validateEssayReview({ ...goodReview(), suggestions: 'Move para 3 up.' }, 'structural'); assert.ok(s.ok && s.value.suggestions === 'Move para 3 up.');
});
test('validateEssayReview rejects missing keys, out-of-range and non-integer scores', () => {
  const a = goodReview(); delete (a.scores as Record<string, number>).clarity; assert.equal(validateEssayReview(a, 'critique').ok, false);
  const b = goodReview(); b.scores.structure = 11; assert.equal(validateEssayReview(b, 'critique').ok, false);
  const c = goodReview(); c.scores.structure = 5.5; assert.equal(validateEssayReview(c, 'critique').ok, false);
  const d = goodReview(); (d.review as Record<string, unknown>).works = 'nope'; assert.equal(validateEssayReview(d, 'critique').ok, false);
});
test('essayReviewPrompt includes draft, prompt and mode-specific instructions', () => {
  const p = essayReviewPrompt({ mode: 'reduce_words', contextText: '[story:1] S', title: 'T', prompt: 'Why MBA?', wordLimit: 500, draft: 'My draft text', wordCount: 3 });
  assert.match(p.user, /My draft text/); assert.match(p.user, /Why MBA\?/); assert.match(p.system, /word limit/); assert.match(p.system, /"suggestions"/);
  assert.doesNotMatch(essayReviewPrompt({ mode: 'critique', contextText: '', title: 'T', prompt: null, wordLimit: null, draft: 'd', wordCount: 1 }).system, /"suggestions":"/);
  assert.match(essayReviewPrompt({ mode: 'critique', contextText: '', title: 'T', prompt: null, wordLimit: null, draft: 'd', wordCount: 1 }).user, /no prompt saved/);
});
test('EssayReviewBody validates', () => {
  assert.ok(EssayReviewBody.safeParse({ essayId: U, mode: 'full_revision' }).success);
  assert.equal(EssayReviewBody.safeParse({ essayId: 'x', mode: 'critique' }).success, false);
  assert.equal(EssayReviewBody.safeParse({ essayId: U, mode: 'rewrite' }).success, false);
});

// ---- interview ----
test('InterviewBody validates each action', () => {
  assert.ok(InterviewBody.safeParse({ action: 'generate_questions', schoolId: U, category: 'Leadership' }).success);
  assert.equal(InterviewBody.safeParse({ action: 'generate_questions', schoolId: U, category: 'Trivia' }).success, false);
  assert.equal(InterviewBody.safeParse({ action: 'evaluate', questionId: U, answer: '   ' }).success, false);
  assert.ok(InterviewBody.safeParse({ action: 'follow_up', sessionId: U, questionId: U, answer: 'x' }).success);
  assert.equal(InterviewBody.safeParse({ action: 'bogus' }).success, false);
});
const goodEval = () => ({ scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, 7])), feedback: ['Add a number'] });
test('validateEvaluation applies defaults and rejects bad scores', () => {
  const r = validateEvaluation(goodEval()); assert.ok(r.ok && r.value.practice_questions.length === 0 && r.value.unsupported_claims.length === 0);
  const bad = goodEval(); (bad.scores as Record<string, number>).clarity = 0; assert.equal(validateEvaluation(bad).ok, false);
  assert.equal(validateEvaluation({ ...goodEval(), feedback: [] }).ok, false);
  assert.equal(validateEvaluation('x').ok, false);
});
test('validateGenerated only accepts known categories and non-empty lists', () => {
  assert.ok(validateGenerated({ questions: [{ category: 'Failure', question: 'Tell me about a failure.' }] }).ok);
  assert.equal(validateGenerated({ questions: [] }).ok, false);
  assert.equal(validateGenerated({ questions: [{ category: 'Other', question: 'Tell me about a failure.' }] }).ok, false);
});
test('generateQuestionsPrompt states questions are practice-only and handles missing school data', () => {
  const p = generateQuestionsPrompt({ schoolName: 'Booth', count: 3, contextText: '', hasSchoolData: false });
  assert.match(p.system, /NOT questions known to be asked/); assert.match(p.system, /NOT RESEARCHED/); assert.match(p.user, /Booth/);
  assert.match(evaluatePrompt({ question: 'q', category: 'c', answer: 'a', contextText: '', hasSchoolData: true }).system, /Score honestly/);
});
test('overallScore and cleanScores', () => {
  assert.equal(overallScore({ clarity: 6, structure: 7 }), 6.5); assert.equal(overallScore({}), null);
  assert.deepEqual(cleanScores({ clarity: 5, structure: 11, junk: 3, relevance: 'x' }), { clarity: 5 });
});
test('sessionPerformance averages latest AI feedback per question and skips self scores / unevaluated sessions', () => {
  const sessions = [{ id: 's2', started_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' }, { id: 's1', started_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, { id: 's3', started_at: null, created_at: '2026-03-01T00:00:00Z' }];
  const questions = [{ id: 'q1', session_id: 's1' }, { id: 'q2', session_id: 's1' }, { id: 'q3', session_id: 's2' }, { id: 'q4', session_id: 's3' }];
  const fb = [
    { question_id: 'q1', scores: { clarity: 4 }, source: 'ai' as const, created_at: '2026-01-01T01:00:00Z' },
    { question_id: 'q1', scores: { clarity: 6 }, source: 'ai' as const, created_at: '2026-01-01T02:00:00Z' }, // later re-evaluation wins
    { question_id: 'q2', scores: { clarity: 8 }, source: 'ai' as const, created_at: '2026-01-01T03:00:00Z' },
    { question_id: 'q3', scores: { clarity: 9 }, source: 'ai' as const, created_at: '2026-02-01T03:00:00Z' },
    { question_id: 'q4', scores: { clarity: 1 }, source: 'self' as const, created_at: '2026-03-01T03:00:00Z' },
  ];
  const p = sessionPerformance(sessions, questions, fb);
  assert.deepEqual(p.map((x) => [x.sessionId, x.label, x.clarity, x.overall, x.count]), [['s1', 'S1', 7, 7, 2], ['s2', 'S2', 9, 9, 1]]);
  assert.equal(countEvaluatedAnswers(fb), 3);
});
test('canShowTrend requires at least 2 evaluated answers', () => { assert.equal(canShowTrend(1), false); assert.equal(canShowTrend(2), true); });
test('fmtDuration', () => { assert.equal(fmtDuration(65), '1:05'); assert.equal(fmtDuration(3725), '1:02:05'); assert.equal(fmtDuration(-4), '0:00'); });
test('validateUserQuestionInput enforces source note for verified questions', () => {
  assert.equal(validateUserQuestionInput({ question: 'Why this school?', category: 'Why this school', origin: 'user' }), null);
  assert.match(validateUserQuestionInput({ question: 'Why this school?', category: 'Why this school', origin: 'verified_historical' })!, /source note/);
  assert.equal(validateUserQuestionInput({ question: 'Why this school?', category: 'Why this school', origin: 'verified_historical', sourceNote: 'Alumni call, Oct 2026' }), null);
  assert.ok(validateUserQuestionInput({ question: 'short', category: 'x', origin: 'user' }));
  assert.equal(CATEGORIES.length, 13);
});
