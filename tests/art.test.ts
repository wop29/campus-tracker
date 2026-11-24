import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BADGE_ART, EMPTY_ART, MASCOT_POSES, badgeArtSrc, emailStickerFor, reqIconFor, reqIconSrc, stampFor, stampSrc, type ReqIcon } from '../lib/art.ts';

const pub = (src: string) => path.join(import.meta.dirname, '..', 'public', src);

test('checklist icon tiles: by name first, then by category, none when nothing fits', () => {
  const cases: [string, string | null, ReqIcon | null][] = [
    ['Essay 1', 'essays', 'essay'], ['Optional essay', 'essays', 'essay'], ['Statement of purpose', 'other', 'essay'],
    ['GMAT/GRE', 'tests', 'test-score'], ['GRE General', null, 'test-score'],
    ['English proficiency', 'tests', 'english-test'], ['TOEFL iBT', 'tests', 'english-test'], ['IELTS Academic', 'other', 'english-test'], ['Duolingo English Test', 'tests', 'english-test'],
    ['Recommendation 1', 'recommendations', 'recommendation'], ['Letter of reference', 'other', 'recommendation'],
    ['Resume', 'resume', 'resume'], ['CV', 'other', 'resume'], ['Academic transcripts', 'academics', 'transcript'],
    ['Application fee', 'other', 'fee'], ['Interview preparation', 'other', 'interview'], ['Video essay', 'essays', 'video'], ['Kira video interview', 'other', 'video'],
    ['Round 2 deadline', 'other', 'deadline'],
    ['Application profile', 'form', null], ['Final review', 'other', null], ['Employment history', 'other', null], ['Feedback form', 'form', null],
  ];
  for (const [name, cat, want] of cases) assert.equal(reqIconFor(name, cat), want, name);
});

test('country stamps', () => {
  const cases: [string | null, string | null][] = [
    ['United States', 'us'], ['USA', 'us'], ['United Kingdom', 'uk'], ['England', 'uk'], ['Canada', 'canada'], ['Australia', 'australia'],
    ['France', 'europe'], ['Spain', 'europe'], ['Switzerland', 'europe'], ['Germany', 'europe'],
    ['Singapore', 'asia'], ['Hong Kong', 'asia'], ['China', 'asia'], ['India', 'asia'],
    ['Brazil', null], ['', null], [null, null], ['South Africa', null],
  ];
  for (const [c, want] of cases) assert.equal(stampFor(c), want, String(c));
});

test('email stickers follow the reminder kind', () => {
  assert.equal(emailStickerFor('nudge'), 'nudge'); assert.equal(emailStickerFor('deadline_week'), 'deadline-week');
  assert.equal(emailStickerFor('result_soon'), 'result-soon'); assert.equal(emailStickerFor('celebration'), 'milestone');
});

test('every referenced art file exists', () => {
  const srcs = [
    ...Object.values(MASCOT_POSES).map((p) => p.src), ...Object.values(EMPTY_ART).map((p) => p.src),
    ...Object.keys(BADGE_ART).map((id) => badgeArtSrc(id)!),
    ...(['essay', 'test-score', 'english-test', 'recommendation', 'resume', 'transcript', 'fee', 'interview', 'video', 'deadline'] as ReqIcon[]).map(reqIconSrc),
    ...(['us', 'uk', 'canada', 'australia', 'europe', 'asia'] as const).map(stampSrc),
    ...['nudge', 'deadline-week', 'result-soon', 'milestone'].map((s) => `/art/email/${s}.png`),
  ];
  for (const s of srcs) assert.ok(existsSync(pub(s)), s);
  assert.equal(badgeArtSrc('source-hunter'), null);
});
