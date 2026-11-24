import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHOOL_PLACES, buildCatalogue, catalogueCountries, chipsFor, countriesFromDestinations, englishMinimum, fieldsFor, fieldsFromOnboarding, filterCatalogue,
  formatTuition, nextDeadline, planAdd, testPolicy, toCatalogueProgram, type CatalogueFilter,
} from '../lib/catalogue.ts';
import type { ProgramRow } from '../lib/programs.ts';

let n = 0;
const row = (school: string, program: string, degree: string, data: Record<string, unknown> = {}): ProgramRow => ({
  id: `id-${++n}`, school_name: school, program_name: program, degree_type: degree, format: 'full-time', duration: null, intake: null,
  program_url: 'https://example.edu/program', data, collected_on: '2026-11-16',
});
const ROWS = [
  row('Stanford GSB', 'Stanford MBA', 'mba', { deadlines: { value: 'Round 1 Sep 9, 2026 (decision Dec 9, 2026); Round 2 Jan 6, 2027 (decision Apr 1, 2027)' }, tests: { value: 'GMAT or GRE required; no minimum.' }, english: { ielts_min: '7.0 overall', toefl_min: '100 iBT' } }),
  row('Stanford GSB', 'MSx Program', 'masters'),
  row('Chicago Booth', 'Master in Finance', 'masters'),
  row('London Business School', 'Masters in Analytics and Management', 'masters'),
  row('NUS', 'NUS MBA', 'mba', { notes: 'Part-time format does not sponsor a student visa.' }),
  row('HKUST', 'HKUST MBA', 'mba'),
  row('University of Melbourne', 'Undergraduate (first-year entry)', 'undergrad', { country: 'Australia', city: 'Melbourne', full_name: 'The University of Melbourne', ranking: { value: 13 }, cost: { tuition: { amount: 52000, currency: 'AUD', basis: 'per year' } }, lpdp: { on_list: true }, internal_notes: 'secret' }),
  row('MIT', 'Undergraduate (first-year entry)', 'undergrad', { country: 'United States', city: 'Cambridge, MA', ranking: { value: 1 }, tests: { value: 'SAT or ACT required for 2027 entry.' } }),
];
const CAT = buildCatalogue(ROWS);
const base: CatalogueFilter = { track: 'grad', countries: [], fields: [], q: '' };
const names = (f: Partial<CatalogueFilter>) => filterCatalogue(CAT, { ...base, ...f }).map((u) => u.name);

test('the static place map covers all 26 seeded business schools', () => {
  assert.equal(Object.keys(SCHOOL_PLACES).length, 26);
  assert.equal(SCHOOL_PLACES['Oxford Saïd'].country, 'United Kingdom');
  assert.equal(SCHOOL_PLACES.HKUST.country, 'Hong Kong');
});

test('buildCatalogue groups by university and fills country and city', () => {
  const gsb = CAT.find((u) => u.name === 'Stanford GSB')!;
  assert.equal(gsb.programs.length, 2);
  assert.equal(gsb.country, 'United States');
  assert.equal(gsb.city, 'Stanford, CA');
  const mel = CAT.find((u) => u.name === 'University of Melbourne')!;
  assert.equal(mel.country, 'Australia'); assert.equal(mel.fullName, 'The University of Melbourne'); assert.equal(mel.ranking, 13);
  assert.equal(mel.programs[0].level, 'undergrad');
  assert.equal(buildCatalogue(null).length, 0);
  assert.equal(buildCatalogue([{ id: 'x' }]).length, 0);
});

test('track: grad shows MBA and master\'s, undergrad shows only undergrad entries', () => {
  assert.deepEqual(names({}), ['Chicago Booth', 'HKUST', 'London Business School', 'NUS', 'Stanford GSB']);
  assert.deepEqual(names({ track: 'undergrad' }), ['MIT', 'University of Melbourne']); // sorted by ranking
});

test('country filter uses onboarding destinations, including Singapore and Hong Kong', () => {
  assert.deepEqual(countriesFromDestinations(['us', 'singapore', 'hongkong']), ['United States', 'Singapore', 'Hong Kong']);
  assert.deepEqual(names({ countries: ['Singapore', 'Hong Kong'] }), ['HKUST', 'NUS']);
  assert.deepEqual(names({ countries: ['Australia'] }), []);
  assert.deepEqual(names({ track: 'undergrad', countries: ['Australia'] }), ['University of Melbourne']);
  assert.ok(catalogueCountries(CAT, ['Canada']).includes('Canada'));
});

test('field filter matches program names; undergrad entries cover every major', () => {
  assert.deepEqual(fieldsFor('Master in Finance'), ['finance']);
  assert.deepEqual(fieldsFor('Masters in Analytics and Management'), ['analytics', 'management']);
  assert.deepEqual(names({ fields: ['finance'] }), ['Chicago Booth']);
  assert.deepEqual(names({ fields: ['analytics'] }), ['London Business School']);
  const gsb = filterCatalogue(CAT, { ...base, fields: ['business'] }).find((u) => u.name === 'Stanford GSB')!;
  assert.deepEqual(gsb.programs.map((p) => p.program.program_name), ['Stanford MBA']);
  assert.deepEqual(names({ track: 'undergrad', fields: ['cs'] }), ['MIT', 'University of Melbourne']);
  assert.deepEqual(names({ fields: ['cs'] }), []);
});

test('fields from onboarding accept the onboarding keys and free text', () => {
  assert.deepEqual(fieldsFromOnboarding({ onboarding: { fields: ['cs', 'econ-finance', 'data-science'] } }), ['finance', 'analytics', 'cs']);
  assert.deepEqual(fieldsFromOnboarding({ onboarding: { fields: ['design', 'other', 42] } }), []);
  assert.deepEqual(fieldsFromOnboarding({ onboarding: { fields: ['Computer Science'] } }), ['cs']);
  assert.deepEqual(fieldsFromOnboarding(null), []);
});

test('search matches university, city and program, ignoring case and accents', () => {
  assert.deepEqual(names({ q: 'finance' }), ['Chicago Booth']);
  assert.deepEqual(names({ q: 'stanford ca' }), ['Stanford GSB']);
  assert.deepEqual(names({ track: 'undergrad', q: 'computer science' }), ['MIT', 'University of Melbourne']);
  assert.deepEqual(names({ track: 'undergrad', q: 'melbourne' }), ['University of Melbourne']);
});

test('preferred program type comes first', () => {
  const gsb = filterCatalogue(CAT, { ...base, preferred: 'masters' }).find((u) => u.name === 'Stanford GSB')!;
  assert.equal(gsb.programs[0].program.program_name, 'MSx Program');
});

test('nextDeadline skips decision dates and past rounds', () => {
  const v = 'Round 1 Sep 9, 2026 (decision Dec 9, 2026); Round 2 Jan 6, 2027 (decision Apr 1, 2027)';
  const r = nextDeadline(v, new Date(2026, 10, 24));
  assert.equal(r?.kind, 'next'); if (r?.kind === 'next') { assert.equal(r.label, '6 Jan 2027'); assert.equal(r.daysLeft, 43); }
  assert.equal(nextDeadline(v, new Date(2027, 5, 1))?.kind, 'passed');
  const uk = nextDeadline('UCAS deadline 14 January 2027, 18:00 UK time', new Date(2026, 10, 24));
  assert.ok(uk?.kind === 'next' && uk.label === '14 Jan 2027');
  assert.equal(nextDeadline('Rolling admission', new Date())?.kind, 'rolling');
  assert.equal(nextDeadline('Early Review: submit from Oct 1, 2026', new Date(2026, 8, 1)), null);
  assert.equal(nextDeadline(null, new Date()), null);
});

test('testPolicy summarises the tests text', () => {
  assert.equal(testPolicy('GMAT or GRE required; no minimum.'), 'GMAT or GRE required');
  assert.equal(testPolicy('SAT and ACT are optional for 2027 applicants.'), 'Tests optional');
  assert.equal(testPolicy('Test-optional policy.'), 'Tests optional');
  assert.equal(testPolicy('We are test blind.'), 'Test blind');
  assert.equal(testPolicy('SAT or ACT required for 2027 entry.'), 'SAT or ACT required');
  assert.equal(testPolicy('GMAT and GRE are not required.'), 'No test needed');
  assert.equal(testPolicy(null), null);
});

test('chips: English minimum, test policy, deadline, LPDP, tuition; no internal notes', () => {
  const gsb = CAT.find((u) => u.name === 'Stanford GSB')!.programs.find((p) => p.program.program_name === 'Stanford MBA')!;
  assert.equal(englishMinimum(gsb.program), 'IELTS 7.0');
  assert.deepEqual(chipsFor(gsb, new Date(2026, 10, 24)).map((c) => c.text), ['IELTS 7.0', 'GMAT or GRE required', 'Next deadline 6 Jan 2027']);
  const mel = CAT.find((u) => u.name === 'University of Melbourne')!.programs[0];
  const texts = chipsFor(mel, new Date()).map((c) => c.text);
  assert.ok(texts.includes('On LPDP list'));
  assert.ok(texts.includes('Tuition AUD 52,000 a year'));
  assert.ok(!JSON.stringify(texts).includes('secret'));
  assert.equal(formatTuition({ amount: 120000, currency: 'GBP', basis: 'total program', year: null }), 'GBP 120,000 total');
});

test('no student visa warning comes from the notes', () => {
  assert.equal(CAT.find((u) => u.name === 'NUS')!.programs[0].noVisa, true);
  assert.equal(CAT.find((u) => u.name === 'HKUST')!.programs[0].noVisa, false);
  assert.equal(toCatalogueProgram(row('X', 'Y', 'mba', { lpdp: { on_list: 'yes' } }))!.lpdpOnList, false);
});

test('planAdd reuses, restores or creates school rows by name', () => {
  const plan = planAdd(
    [{ name: 'Stanford GSB', country: 'United States', city: 'Stanford, CA' }, { name: 'Oxford Saïd', country: 'United Kingdom', city: 'Oxford' }, { name: 'NUS', country: 'Singapore', city: 'Singapore' }, { name: 'NUS', country: 'Singapore', city: 'Singapore' }],
    [{ id: 's1', name: 'stanford gsb', deleted_at: null }, { id: 's2', name: 'Oxford Said', deleted_at: '2026-01-01' }],
  );
  assert.equal(plan.existing.get('Stanford GSB'), 's1');
  assert.deepEqual(plan.restore, [{ id: 's2', name: 'Oxford Saïd' }]);
  assert.deepEqual(plan.create, [{ name: 'NUS', country: 'Singapore', location: 'Singapore' }]);
});
