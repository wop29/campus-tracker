import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ONBOARDING, nextIntakes, parseOnboarding, toStoredOnboarding, isValidTimeZone } from '../lib/onboarding.ts';
import { buildUnits, computeJourney, EMPTY_JOURNEY_DATA, skippedUnitCount, type JourneyData } from '../lib/journey.ts';

// ---------- parse ----------
test('onboarding parse: missing or junk settings give defaults with done=false', () => {
  for (const raw of [undefined, null, {}, { onboarding: 'x' }, { onboarding: [] }, 'junk', 42]) {
    const o = parseOnboarding(raw);
    assert.equal(o.done, false); assert.equal(o.track, 'grad'); assert.equal(o.stage, 'exploring'); assert.deepEqual(o.destinations, []);
    assert.deepEqual(o.reminders, { email: true, hourLocal: 19 }); assert.equal(o.program, undefined); assert.equal(o.intake, undefined);
    assert.ok(isValidTimeZone(o.timezone));
  }
  assert.deepEqual(parseOnboarding(undefined), DEFAULT_ONBOARDING);
});
test('onboarding parse: valid values survive', () => {
  const o = parseOnboarding({ theme: 'ocean', onboarding: { done: true, track: 'grad', program: 'phd', destinations: ['uk', 'us'], intake: 'Fall 2027', stage: 'applying', reminders: { email: false, hourLocal: 8 }, timezone: 'Asia/Jakarta' } });
  assert.deepEqual(o, { done: true, track: 'grad', program: 'phd', destinations: ['us', 'uk'], intake: 'Fall 2027', stage: 'applying', reminders: { email: false, hourLocal: 8 }, timezone: 'Asia/Jakarta' });
});
test('onboarding parse: invalid fields fall back one by one', () => {
  const o = parseOnboarding({ onboarding: { done: 'yes', track: 'phd', program: 'law', destinations: ['us', 'mars', 3, 'us'], intake: '   ', stage: 'done', reminders: { email: 'no', hourLocal: 25 }, timezone: 'Not/AZone' } });
  assert.equal(o.done, false); assert.equal(o.track, 'grad'); assert.equal(o.program, undefined); assert.deepEqual(o.destinations, ['us']);
  assert.equal(o.intake, undefined); assert.equal(o.stage, 'exploring'); assert.deepEqual(o.reminders, { email: true, hourLocal: 19 }); assert.equal(o.timezone, DEFAULT_ONBOARDING.timezone);
  assert.equal(parseOnboarding({ onboarding: { reminders: { hourLocal: 7.5 } } }).reminders.hourLocal, 19);
});
test('onboarding parse: program is dropped for undergrad', () => {
  const o = toStoredOnboarding({ ...DEFAULT_ONBOARDING, done: true, track: 'undergrad', program: 'mba' });
  assert.equal(o.program, undefined); assert.equal(o.done, true); assert.equal(o.track, 'undergrad');
});
test('next intakes: three upcoming starts at least three months out', () => {
  assert.deepEqual(nextIntakes(new Date(2026, 10, 16)), ['Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(nextIntakes(new Date(2026, 2, 1)), ['Fall 2026', 'Spring 2027', 'Fall 2027']);
  assert.deepEqual(nextIntakes(new Date(2026, 6, 1)), ['Spring 2027', 'Fall 2027', 'Spring 2028']);
});

// ---------- journey tailoring ----------
const d = (over: Partial<JourneyData> = {}): JourneyData => ({ ...EMPTY_JOURNEY_DATA, ...over });
const ids = (j: ReturnType<typeof computeJourney>) => Object.fromEntries(j.units.flatMap((u) => u.lessons).map((l) => [l.id, l.state]));

test('journey: short path, at most 5 units and about 10 lessons, no funding or interview', () => {
  for (const track of ['grad', 'undergrad'] as const) {
    const units = buildUnits({ track, stage: 'exploring' });
    const lessons = units.flatMap((u) => u.lessons);
    assert.ok(units.length <= 5); assert.ok(lessons.length >= 10 && lessons.length <= 12);
    assert.ok(lessons.every((l) => !/scholarship|finance|interview/.test(l.href)));
    for (const text of lessons.flatMap((l) => [l.title, l.hint])) { assert.ok(!text.includes('—'), `no em dash: ${text}`); assert.ok(!/\bactually\b/i.test(text)); }
  }
});
test('journey: grad and undergrad wording differ', () => {
  const grad = buildUnits({ track: 'grad', program: 'mba', stage: 'exploring' }).flatMap((u) => u.lessons);
  const masters = buildUnits({ track: 'grad', program: 'masters', stage: 'exploring' }).flatMap((u) => u.lessons);
  const ug = buildUnits({ track: 'undergrad', stage: 'exploring' }).flatMap((u) => u.lessons);
  const by = (ls: typeof grad, id: string) => ls.find((l) => l.id === id)!;
  assert.match(by(grad, 'add-test').hint, /GMAT/); assert.doesNotMatch(by(masters, 'add-test').hint, /GMAT/);
  assert.match(by(ug, 'add-test').hint, /SAT/); assert.match(by(ug, 'create-essay').title, /personal statement/);
  assert.match(by(masters, 'create-essay').title, /statement of purpose/); assert.match(by(ug, 'add-recommender').title, /teacher or counselor/);
  assert.deepEqual(grad.map((l) => l.id), ug.map((l) => l.id));
});
test('journey: exploring and shortlisting skip nothing', () => {
  for (const stage of ['exploring', 'shortlisting'] as const) {
    const j = computeJourney(EMPTY_JOURNEY_DATA, { track: 'grad', stage });
    assert.equal(j.skipped, 0); assert.equal(j.currentLessonId, 'add-education'); assert.equal(j.total, 10); assert.equal(j.step, 1);
  }
});
test('journey: applying skips unfinished units 1-2 as optional and starts at Plan', () => {
  assert.equal(skippedUnitCount('applying'), 2);
  const j = computeJourney(EMPTY_JOURNEY_DATA, { track: 'grad', stage: 'applying' });
  const s = ids(j);
  assert.deepEqual([s['add-education'], s['add-test'], s['add-schools'], s['mark-tier']], ['skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal(j.currentLessonId, 'create-app'); assert.equal(j.currentUnitId, 'plan');
  assert.equal(j.total, 6); assert.equal(j.skipped, 4); assert.equal(j.overallPct, 0); assert.equal(j.step, 1);
  assert.equal(j.units[0].total, 0); assert.equal(j.units[0].crowned, false);
});
test('journey: applying counts early lessons that are already done', () => {
  const j = computeJourney(d({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1 }, applications: { total: 1, withDeadline: 0, requirementsComplete: 0 } }), { track: 'undergrad', stage: 'applying' });
  const s = ids(j);
  assert.equal(s['add-education'], 'done'); assert.equal(s['add-test'], 'skipped');
  assert.equal(j.total, 7); assert.equal(j.doneCount, 2); assert.equal(j.overallPct, Math.round((2 / 7) * 100));
  assert.equal(j.currentLessonId, 'set-deadline'); assert.equal(j.step, 3);
});
test('journey: submitted starts at Finish', () => {
  const j = computeJourney(EMPTY_JOURNEY_DATA, { track: 'grad', stage: 'submitted' });
  assert.equal(j.currentUnitId, 'finish'); assert.equal(j.currentLessonId, 'add-recommender'); assert.equal(j.total, 2); assert.equal(j.skipped, 8);
  const done = computeJourney(d({ recs: { ...EMPTY_JOURNEY_DATA.recs, recommenders: 1 }, decide: { ...EMPTY_JOURNEY_DATA.decide, submitted: 2 } }), { track: 'grad', stage: 'submitted' });
  assert.equal(done.overallPct, 100); assert.equal(done.currentLessonId, null); assert.equal(done.step, 2);
});
test('journey: percent counts done over non-skipped lessons for an early starter', () => {
  const j = computeJourney(d({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1, tests: 1 }, schools: { ...EMPTY_JOURNEY_DATA.schools, inPortfolio: 3, withTier: 1 } }), { track: 'grad', stage: 'exploring' });
  assert.equal(j.doneCount, 4); assert.equal(j.overallPct, 40); assert.equal(j.step, 5); assert.equal(j.currentUnitId, 'plan');
});
