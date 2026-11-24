import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ONBOARDING, DESTINATION_LABEL, DESTINATIONS, FIELD_LABEL, FIELDS, intakeOptions, nextIntakes, parseOnboarding, timeZoneOptions, toStoredOnboarding, isValidTimeZone } from '../lib/onboarding.ts';
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
  assert.deepEqual(o, { done: true, track: 'grad', program: 'phd', programs: ['phd'], destinations: ['us', 'uk'], intake: 'Fall 2027', stage: 'applying', reminders: { email: false, hourLocal: 8 }, timezone: 'Asia/Jakarta' });
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

test('onboarding parse: several programs keep their order and program stays the first choice', () => {
  const o = parseOnboarding({ onboarding: { track: 'grad', programs: ['masters', 'mba', 'law', 'masters'] } });
  assert.equal(o.program, 'masters'); assert.deepEqual(o.programs, ['masters', 'mba']);
  // older rows that only have `program`
  assert.deepEqual(parseOnboarding({ onboarding: { track: 'grad', program: 'mba' } }).programs, ['mba']);
  // an explicit program always leads
  assert.deepEqual(parseOnboarding({ onboarding: { track: 'grad', program: 'phd', programs: ['mba', 'phd'] } }).programs, ['phd', 'mba']);
  // undergrad drops both
  const u = toStoredOnboarding({ ...DEFAULT_ONBOARDING, track: 'undergrad', program: 'mba', programs: ['mba', 'masters'] });
  assert.equal(u.program, undefined); assert.equal(u.programs, undefined);
  assert.equal(parseOnboarding({ onboarding: { track: 'grad', programs: 'mba' } }).programs, undefined);
});
test('onboarding parse: fields are optional, known and deduped', () => {
  assert.equal(parseOnboarding({ onboarding: { track: 'undergrad' } }).fields, undefined);
  assert.equal(parseOnboarding({ onboarding: { fields: [] } }).fields, undefined);
  assert.deepEqual(parseOnboarding({ onboarding: { track: 'undergrad', fields: ['cs', 'astrology', 'business', 'cs', 4] } }).fields, ['cs', 'business']);
  assert.equal(FIELDS.length, 9);
  assert.deepEqual(FIELDS.map((f) => FIELD_LABEL[f]), ['Business', 'Computer Science', 'Engineering', 'Economics/Finance', 'Data Science', 'Design', 'Health/Medicine', 'Social Sciences', 'Other']);
});
test('onboarding: Singapore and Hong Kong are destinations', () => {
  assert.ok(DESTINATIONS.includes('singapore') && DESTINATIONS.includes('hongkong'));
  assert.equal(DESTINATION_LABEL.hongkong, 'Hong Kong');
  assert.deepEqual(parseOnboarding({ onboarding: { destinations: ['hongkong', 'singapore', 'sg'] } }).destinations, ['singapore', 'hongkong']);
});
test('intake options follow the chosen countries', () => {
  const nov = new Date(2026, 10, 16);
  assert.deepEqual(intakeOptions([], nov), ['Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(intakeOptions(['us', 'canada'], nov), ['Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(intakeOptions(['uk'], nov), ['Fall 2027', 'January 2028', 'Fall 2028']);
  assert.deepEqual(intakeOptions(['singapore', 'hongkong'], new Date(2026, 6, 1)), ['January 2027', 'Fall 2027', 'January 2028']);
  assert.deepEqual(intakeOptions(['australia'], nov), ['Semester 1 2027 (Feb)', 'Semester 2 2027 (Jul)', 'Semester 1 2028 (Feb)']);
  assert.deepEqual(intakeOptions(['australia'], new Date(2026, 11, 1)), ['Semester 2 2027 (Jul)', 'Semester 1 2028 (Feb)', 'Semester 2 2028 (Jul)']);
  const both = intakeOptions(['australia', 'us'], nov);
  assert.equal(both.length, 6); assert.ok(both.includes('Fall 2027') && both.includes('Semester 1 2027 (Feb)'));
  for (const label of both) assert.ok(label.length <= 40, 'fits the stored intake limit');
  // a semester label survives parsing
  assert.equal(parseOnboarding({ onboarding: { intake: 'Semester 1 2027 (Feb)' } }).intake, 'Semester 1 2027 (Feb)');
});
test('time zone options include Jakarta first and are all valid', () => {
  const tz = timeZoneOptions();
  assert.equal(tz[0], 'Asia/Jakarta'); assert.ok(tz.length >= 10); assert.equal(new Set(tz).size, tz.length);
  assert.ok(tz.every((z) => isValidTimeZone(z)));
});
test('onboarding copy: no em dashes, no "actually", says steps not taps, no daily nudge', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../components/onboarding/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.tsx'));
  const all = (await Promise.all(files.map((f) => readFile(new URL(f, dir), 'utf8')))).join('\n') + Object.values(FIELD_LABEL).join(' ');
  assert.ok(!all.includes('—')); assert.ok(!/\bactually\b/i.test(all));
  assert.ok(!/quick taps/i.test(all)); assert.match(all, /Five quick steps/);
  assert.ok(!/daily email nudge/i.test(all)); assert.match(all, /Gentle email reminders \(only when it helps, never daily\)/);
  // step 3: the mascot line and the subtitle must not repeat each other
  const stepThree = 'Joining late is fine, we will start you where you are.';
  assert.equal(all.split(stepThree).length - 1, 1);
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

test('about you: optional, trimmed, survives save and drops junk', async () => {
  const { parseOnboarding, parseAbout, STATUS_FOR_TRACK } = await import('../lib/onboarding.ts');
  assert.equal(parseAbout({}), undefined);
  assert.deepEqual(parseAbout({ status: 'sma_12', school: '  SMAN 3 Bandung ', city: '' }), { status: 'sma_12', school: 'SMAN 3 Bandung' });
  assert.equal(parseAbout({ status: 'astronaut' }), undefined);
  const ob = parseOnboarding({ onboarding: { done: true, track: 'undergrad', destinations: ['uk'], stage: 'exploring', about: { status: 'sma_12', city: 'Jakarta' } } });
  assert.deepEqual(ob.about, { status: 'sma_12', city: 'Jakarta' });
  assert.equal(parseOnboarding({ onboarding: { done: true, track: 'grad', destinations: [], stage: 'exploring' } }).about, undefined);
  assert.ok(STATUS_FOR_TRACK.undergrad.includes('sma_12') && STATUS_FOR_TRACK.grad.includes('working'));
});

test('about you: funding, LPDP only with LPDP funding, English status, worry', async () => {
  const { parseAbout } = await import('../lib/onboarding.ts');
  assert.deepEqual(parseAbout({ funding: 'lpdp', lpdp: 'applied', english: 'not_yet', worry: 'money' }), { funding: 'lpdp', lpdp: 'applied', english: 'not_yet', worry: 'money' });
  assert.deepEqual(parseAbout({ funding: 'family', lpdp: 'awarded' }), { funding: 'family' });
  assert.equal(parseAbout({ funding: 'lottery', english: 'maybe' }), undefined);
});
test('journey: English status changes the test step wording', async () => {
  const { buildUnits } = await import('../lib/journey.ts');
  const t = (english?: 'taken' | 'booked' | 'not_yet') => buildUnits({ track: 'undergrad', stage: 'exploring', english })[0].lessons[1].title;
  assert.equal(t('not_yet'), 'Book your English test');
  assert.match(t('booked'), /after the test/);
  assert.equal(t(), 'Add a test score');
});
