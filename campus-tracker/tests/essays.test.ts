import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords, diffStats, draftChanged, orderScores, reviewResponseSchema, essayFormSchema } from '../lib/essays.ts';
import { rankStories, suggestAlternatives, deriveUsage, usageState, OVERUSE_THRESHOLD, splitList, type RankableStory } from '../lib/stories.ts';
import { validateFile, sanitizeFileName, buildStoragePath, previewKind, MAX_FILE_BYTES } from '../lib/documents.ts';
import { recRisk, reminderDue, requirementNameFor, requirementTarget, statusPatch, buildRecAiRequest, REC_AI_SYSTEM } from '../lib/recommendations.ts';

test('diff: identical text is all equal', () => {
  const d = diffWords('a b c', 'a  b\nc'); assert.deepEqual(d, [{ type: 'equal', text: 'a b c' }]);
});
test('diff: word replacement and insertion', () => {
  const d = diffWords('I led a small team', 'I led a large cross-functional team');
  const s = diffStats(d);
  assert.equal(s.removed, 1); assert.equal(s.added, 2); assert.equal(s.unchanged, 4);
  assert.ok(d.some((g) => g.type === 'remove' && g.text === 'small'));
  assert.ok(d.some((g) => g.type === 'add' && g.text === 'large cross-functional'));
});
test('diff: from empty and to empty', () => {
  assert.deepEqual(diffWords('', 'x y'), [{ type: 'add', text: 'x y' }]);
  assert.deepEqual(diffWords('x y', ''), [{ type: 'remove', text: 'x y' }]);
  assert.deepEqual(diffWords('', ''), []);
});
test('diff: reconstructs both sides', () => {
  const a = 'the quick brown fox jumps over the lazy dog today', b = 'a quick red fox leaps over the very lazy dog';
  const d = diffWords(a, b);
  const left = d.filter((g) => g.type !== 'add').map((g) => g.text).join(' ');
  const right = d.filter((g) => g.type !== 'remove').map((g) => g.text).join(' ');
  assert.equal(left, a); assert.equal(right, b);
});
test('draftChanged is exact', () => { assert.equal(draftChanged('a', 'a'), false); assert.equal(draftChanged('a', 'a '), true); });
test('orderScores orders known keys and keeps extras', () => {
  const o = orderScores({ clarity: 7, prompt_alignment: 8, schoolFit: 6, extra_thing: 5 });
  assert.deepEqual(o.map((x) => x.label), ['Prompt alignment', 'Clarity', 'School fit', 'Extra thing']);
});
test('review response schema tolerates missing arrays and rejects bad scores', () => {
  const ok = reviewResponseSchema.safeParse({ scores: { clarity: 7 }, review: { works: ['x'] } });
  assert.ok(ok.success && ok.data.review.missing.length === 0);
  assert.equal(reviewResponseSchema.safeParse({ scores: { clarity: 'high' }, review: {} }).success, false);
});
test('essay form schema: word limit and title validation', () => {
  assert.equal(essayFormSchema.safeParse({ title: ' ' }).success, false);
  const r = essayFormSchema.safeParse({ title: 'Why Johnson', word_limit: '400', school_id: '' });
  assert.ok(r.success && r.data.word_limit === 400 && r.data.school_id === undefined);
  assert.equal(essayFormSchema.safeParse({ title: 'x', word_limit: '-5' }).success, false);
});

const st = (id: string, category: RankableStory['category'], extra: Partial<RankableStory> = {}): RankableStory => ({ id, title: id, category, competencies: [], related_school_ids: [], related_prompts: null, usage_count: 0, ...extra });
test('rank: prompt about leadership prefers leadership story and explains why', () => {
  const r = rankStories('Describe a time you led a team through a difficult change', [st('a', 'leadership'), st('b', 'diversity'), st('c', 'teamwork')]);
  assert.equal(r[0].story.id, 'a'); assert.ok(r[0].reasons[0].includes('Leadership'));
  assert.ok(!r.some((x) => x.story.id === 'b'));
});
test('rank: competency, related prompts and school add points', () => {
  const base = rankStories('Tell us about your career goals', [st('x', 'career_transition')])[0].score;
  const more = rankStories('Tell us about your career goals', [st('x', 'career_transition', { competencies: ['career goals'], related_prompts: 'career goals essay', related_school_ids: ['s1'] })], { schoolId: 's1' })[0];
  assert.ok(more.score > base); assert.ok(more.reasons.length >= 3);
});
test('rank: overused stories are penalised and deterministic', () => {
  const stories = [st('o', 'leadership', { usage_count: OVERUSE_THRESHOLD }), st('f', 'leadership', { usage_count: 0 })];
  const r = rankStories('How did you lead?', stories);
  assert.equal(r[0].story.id, 'f'); assert.equal(r[1].usage, 'overused');
  assert.deepEqual(rankStories('How did you lead?', stories).map((x) => x.story.id), r.map((x) => x.story.id));
});
test('rank: no overlap yields nothing', () => { assert.equal(rankStories('zebra', [st('a', 'leadership')]).length, 0); });
test('usage state and derived usage ignore deleted essays', () => {
  assert.equal(usageState(0), 'unused'); assert.equal(usageState(2), 'ok'); assert.equal(usageState(3), 'overused');
  const m = deriveUsage([{ story_id: 'a' }, { story_id: 'a' }, { story_id: 'a', essay_deleted_at: '2026-01-01' }, { story_id: 'b' }]);
  assert.equal(m.get('a'), 2); assert.equal(m.get('b'), 1);
});
test('suggestAlternatives: same category, less used, least first', () => {
  const all = [st('a', 'leadership'), st('b', 'leadership'), st('c', 'leadership'), st('d', 'failure')];
  const counts = new Map([['a', 4], ['b', 1], ['c', 0], ['d', 0]]);
  assert.deepEqual(suggestAlternatives(all[0], all, counts).map((s) => s.id), ['c', 'b']);
});
test('splitList dedupes and trims', () => { assert.deepEqual(splitList('a, b;a\n c '), ['a', 'b', 'c']); });

test('validateFile: type and size', () => {
  assert.equal(validateFile({ name: 'a.exe', size: 10 }).ok, false);
  assert.equal(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 }).ok, false);
  assert.equal(validateFile({ name: 'a.pdf', size: 0 }).ok, false);
  assert.deepEqual(validateFile({ name: 'My CV.PDF', size: 100, type: 'application/pdf' }), { ok: true, mime: 'application/pdf' });
  assert.equal(validateFile({ name: 'a.png', size: 5, type: 'application/pdf' }).ok, false);
  assert.equal(validateFile({ name: 'a.docx', size: 5, type: '' }).ok, true);
});
test('sanitizeFileName strips unsafe characters and keeps extension', () => {
  assert.equal(sanitizeFileName('../../Résumé final (v2).PDF'), 'Resume_final_v2.pdf');
  assert.equal(sanitizeFileName('...'), 'file');
  assert.equal(buildStoragePath('u1', 'd1', 2, 'a b.pdf'), 'u1/d1/v2-a_b.pdf');
  assert.ok(!sanitizeFileName('a/b\\c.pdf').includes('/'));
});
test('previewKind', () => { assert.equal(previewKind('a.PDF'), 'pdf'); assert.equal(previewKind('a.jpeg'), 'image'); assert.equal(previewKind('a.docx'), 'none'); });

const now = new Date('2026-11-16T12:00:00Z');
test('recRisk: overdue, at risk, submitted never flagged', () => {
  assert.equal(recRisk({ status: 'contacted', deadline: '2026-11-10T00:00:00Z' }, now), 'overdue');
  assert.equal(recRisk({ status: 'contacted', deadline: '2026-11-29T00:00:00Z' }, now), 'at_risk');
  assert.equal(recRisk({ status: 'contacted', deadline: '2026-12-20T00:00:00Z' }, now), 'none');
  assert.equal(recRisk({ status: 'submitted', deadline: '2026-11-10T00:00:00Z' }, now), 'none');
  assert.equal(recRisk({ status: 'follow_up_required', deadline: null }, now), 'follow_up');
});
test('reminderDue: needs close deadline and a week of silence', () => {
  assert.equal(reminderDue({ status: 'agreed', deadline: '2026-11-25T00:00:00Z', last_contact_at: '2026-11-01' }, now), true);
  assert.equal(reminderDue({ status: 'agreed', deadline: '2026-11-25T00:00:00Z', last_contact_at: '2026-11-14' }, now), false);
  assert.equal(reminderDue({ status: 'agreed', deadline: '2027-02-01T00:00:00Z', last_contact_at: null }, now), false);
  assert.equal(reminderDue({ status: 'submitted', deadline: '2026-11-20T00:00:00Z', last_contact_at: null }, now), false);
  assert.equal(reminderDue({ status: 'not_contacted', deadline: '2026-11-20T00:00:00Z', last_contact_at: null }, now), false);
});
test('requirementNameFor orders by assignment per application', () => {
  const recs = [{ id: 'b', created_at: '2026-02-01' }, { id: 'a', created_at: '2026-01-01' }, { id: 'c', created_at: '2026-03-01' }];
  assert.equal(requirementNameFor('a', recs), 'Recommendation 1'); assert.equal(requirementNameFor('b', recs), 'Recommendation 2'); assert.equal(requirementNameFor('c', recs), null);
});
test('requirementTarget and statusPatch', () => {
  assert.equal(requirementTarget('agreed', 'submitted'), 'complete'); assert.equal(requirementTarget('submitted', 'follow_up_required'), 'in_progress');
  assert.equal(requirementTarget('agreed', 'in_progress'), null); assert.equal(requirementTarget('submitted', 'submitted'), null);
  assert.equal(statusPatch('submitted', now).submitted_at, now.toISOString()); assert.equal(statusPatch('agreed', now).submitted_at, null);
});
test('AI prompt uses only supplied records and system forbids fabricating', () => {
  const r = buildRecAiRequest({ kind: 'briefing', recommender: { name: 'Pat' }, application: { school: 'Johnson', intake: 'Fall 2027' }, recommendation: { status: 'agreed' },
    experiences: [{ company: 'Acme', position: 'Analyst', achievements: 'Cut cost 12%' }], achievements: [], stories: [] });
  assert.ok(r.prompt.includes('Cut cost 12%') && r.prompt.includes('Johnson') && r.prompt.includes('Pat'));
  assert.ok(/Never write the recommendation itself/.test(REC_AI_SYSTEM) && /Never invent/.test(r.system));
  const empty = buildRecAiRequest({ kind: 'reminder', recommender: { name: 'Pat' }, application: { school: 'X' }, recommendation: { status: 'agreed' }, experiences: [], achievements: [], stories: [] });
  assert.ok(empty.prompt.includes('No applicant records were selected'));
  assert.ok(!r.system.includes('—'));
});
