// Journey: one numbering, track-scoped essays and applications, named application steps, the single next step.
// (General journey tailoring tests stay in tests/onboarding.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeJourney, EMPTY_JOURNEY_DATA, nextStep, programTrack, trackScope, type JourneyData } from '../lib/journey.ts';

const d = (over: Partial<JourneyData> = {}): JourneyData => ({ ...EMPTY_JOURNEY_DATA, ...over });
const lessons = (j: ReturnType<typeof computeJourney>) => j.units.flatMap((u) => u.lessons);

test('numbering: banner step equals the number shown on the current lesson in the path', () => {
  // Undergrad with lots done later in the path but no schools yet: old code said "Step 4" while the path said 1.
  const j = computeJourney(d({ essays: { ...EMPTY_JOURNEY_DATA.essays, total: 1, withDraft: 1 }, recs: { ...EMPTY_JOURNEY_DATA.recs, recommenders: 1 } }), { track: 'undergrad', stage: 'exploring' });
  const cur = lessons(j).find((l) => l.state === 'current')!;
  assert.equal(cur.id, 'add-schools'); assert.equal(cur.number, 1); assert.equal(j.step, 1); assert.equal(nextStep(j)!.step, 1);
  assert.deepEqual(lessons(j).map((l) => l.number), [1, 2, 3, 4, 5, 6, 7, 8]);
});
test('numbering: skipped optional lessons get no number, both views count the same lessons', () => {
  const j = computeJourney(d({ profile: { ...EMPTY_JOURNEY_DATA.profile, education: 1 }, applications: { total: 1, withDeadline: 0, requirementsComplete: 0 } }), { track: 'grad', stage: 'applying' });
  const ls = lessons(j);
  assert.ok(ls.filter((l) => l.state === 'skipped').every((l) => l.number === null));
  const numbered = ls.filter((l) => l.number !== null).map((l) => l.number);
  assert.deepEqual(numbered, Array.from({ length: j.total }, (_, i) => i + 1));
  const cur = ls.find((l) => l.state === 'current')!;
  assert.equal(cur.id, 'set-deadline'); assert.equal(j.step, cur.number); assert.equal(nextStep(j)!.total, j.total);
});
test('next step: null when the path is complete', () => {
  const j = computeJourney(d({ recs: { ...EMPTY_JOURNEY_DATA.recs, recommenders: 1 }, decide: { ...EMPTY_JOURNEY_DATA.decide, submitted: 1 } }), { track: 'grad', stage: 'submitted' });
  assert.equal(nextStep(j), null); assert.equal(j.step, j.total);
});
test('steps name the application: "Set the deadline for Duke Fuqua"', () => {
  const apps = [{ id: 'a', name: 'LBS', hasDeadline: true, submitted: false }, { id: 'b', name: 'Duke Fuqua', hasDeadline: false, submitted: false }];
  const j = computeJourney(d({ applications: { total: 2, withDeadline: 0, requirementsComplete: 0 }, apps }), { track: 'grad', stage: 'applying' });
  assert.equal(nextStep(j)!.title, 'Set the deadline for Duke Fuqua');
  const none = computeJourney(EMPTY_JOURNEY_DATA, { track: 'grad', stage: 'exploring' });
  assert.doesNotMatch(lessons(none).find((l) => l.id === 'set-deadline')!.title, /\bits\b/);
});
test('programTrack reads program names, unclear names are null', () => {
  assert.equal(programTrack('Full-time MBA'), 'grad'); assert.equal(programTrack('MSc Finance'), 'grad'); assert.equal(programTrack("Master's in CS"), 'grad');
  assert.equal(programTrack('Bachelor of Commerce'), 'undergrad'); assert.equal(programTrack('BSc Computer Science'), 'undergrad'); assert.equal(programTrack('Undergraduate Business'), 'undergrad');
  assert.equal(programTrack('Computer Science'), null); assert.equal(programTrack(''), null); assert.equal(programTrack(null), null);
});
test('personal statement Done counts only essays on the active track (MBA essays never count for an undergrad)', () => {
  const apps = [
    { id: 'mba', program: 'Full-time MBA', schoolName: 'Duke Fuqua', hasDeadline: true, submitted: false, createdAt: '2026-01-01' },
    { id: 'ug', program: 'Bachelor of Commerce', schoolName: 'Melbourne', hasDeadline: false, submitted: false, createdAt: '2026-02-01' },
  ];
  const mbaEssays = [{ id: 'e1', application_id: 'mba', hasDraft: true }, { id: 'e2', application_id: 'mba', hasDraft: true }];
  const ugOnly = trackScope(apps, mbaEssays, 'undergrad');
  assert.equal(ugOnly.essays.total, 0); assert.equal(ugOnly.applications.total, 1); assert.deepEqual(ugOnly.apps.map((a) => a.name), ['Melbourne']);
  const j = computeJourney(d({ essays: { ...EMPTY_JOURNEY_DATA.essays, ...ugOnly.essays }, applications: { ...ugOnly.applications, requirementsComplete: 0 }, apps: ugOnly.apps }), { track: 'undergrad', stage: 'exploring' });
  assert.notEqual(lessons(j).find((l) => l.id === 'create-essay')!.state, 'done');
  // A statement linked to the undergrad application, or not linked yet, does count.
  assert.equal(trackScope(apps, [...mbaEssays, { id: 'e3', application_id: 'ug', hasDraft: false }], 'undergrad').essays.total, 1);
  assert.deepEqual(trackScope(apps, [{ id: 'e4', application_id: null, hasDraft: true }], 'undergrad').essays, { total: 1, withDraft: 1 });
  // The grad view keeps the MBA essays.
  assert.equal(trackScope(apps, mbaEssays, 'grad').essays.total, 2);
});
