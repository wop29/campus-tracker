import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAid, cleanAmount, fitFor, rankAid, aidProfile, LPDP_ENTRY, type AidEntry, type AidProfile } from '../lib/aid.ts';
import { DEFAULT_ONBOARDING } from '../lib/onboarding.ts';

const row = (id: string, school: string, program: string, data: Record<string, unknown>, degree = 'mba') => ({
  id, school_name: school, program_name: program, degree_type: degree, format: null, duration: null, intake: null, program_url: null, collected_on: '2026-11-24',
  data: { school, program_name: program, degree_type: degree, ...data },
});
const base: AidEntry = { key: 'k', kind: 'scholarship', name: 'Merit award', school: 'HKUST', programs: ['MBA'], country: 'Hong Kong', level: 'grad', amount: null, eligibility: null, internationalOk: null, sourceUrl: null };
const prof = (o: Partial<AidProfile> = {}): AidProfile => ({ level: 'grad', countries: [], onList: new Set(), ...o });

test('buildAid merges programs per school and name and keeps fee waivers', () => {
  const rows = [
    row('1', 'HKUST', 'MBA', { scholarships: [{ name: 'ASEAN Region Award', amount: 'HKD 100,000', eligibility: 'Citizens of ASEAN countries', international_ok: true }], fee_waiver: { value: 'Waived for alumni', source_url: 'https://x.edu' } }),
    row('2', 'HKUST', 'Part-time MBA', { scholarships: [{ name: 'ASEAN Region Award', amount: 'HKD 100,000' }] }),
  ];
  const aid = buildAid(rows);
  const asean = aid.find((a) => a.name === 'ASEAN Region Award')!;
  assert.deepEqual(asean.programs, ['MBA', 'Part-time MBA']);
  assert.equal(asean.country, 'Hong Kong');
  assert.ok(aid.some((a) => a.kind === 'fee_waiver'));
});
test('cleanAmount hides "not published"', () => {
  assert.equal(cleanAmount('amount not published'), null);
  assert.equal(cleanAmount('USD 20,000'), 'USD 20,000');
});
test('fitFor: region, need, restricted, women, level', () => {
  assert.equal(fitFor({ ...base, eligibility: 'For citizens of Southeast Asian countries' }, prof()).fit, 'good');
  assert.equal(fitFor({ ...base, eligibility: 'Open to U.S. citizens and permanent residents only' }, prof()).fit, 'no');
  assert.equal(fitFor({ ...base, internationalOk: false }, prof()).fit, 'no');
  const need = fitFor({ ...base, eligibility: 'Based on demonstrated financial need' }, prof({ funding: 'need' }));
  assert.equal(need.fit, 'good'); assert.match(need.reasons.join(' '), /you said you need support/);
  assert.equal(fitFor({ ...base, eligibility: 'Forte Fellowship for women' , internationalOk: true }, prof()).fit, 'check');
  assert.equal(fitFor({ ...base, level: 'undergrad' }, prof()).fit, 'no');
  assert.match(fitFor(base, prof()).reasons[0], /not clearly stated/);
  assert.ok(fitFor({ ...base, eligibility: 'all admitted students considered' }, prof({ countries: ['Hong Kong'], onList: new Set(['hkust']) })).reasons.includes('School is on your list'));
});
test('rankAid: LPDP first for grads, good fits before checks, filters apply', () => {
  const entries: AidEntry[] = [
    { ...base, key: 'a', name: 'Unclear award' },
    { ...base, key: 'b', name: 'ASEAN award', eligibility: 'ASEAN citizens' },
    { ...base, key: 'c', name: 'US only', eligibility: 'U.S. citizens only' },
  ];
  const r = rankAid(entries, prof(), { level: 'grad', countries: [], q: '', fitsOnly: true, kinds: ['scholarship', 'fee_waiver', 'government'] });
  assert.equal(r[0].key, LPDP_ENTRY.key); assert.equal(r[1].key, 'b'); assert.ok(!r.some((e) => e.key === 'c'));
  const ug = rankAid(entries, prof({ level: 'undergrad' }), { level: 'undergrad', countries: [], q: '', fitsOnly: false, kinds: ['scholarship', 'fee_waiver', 'government'] });
  assert.equal(ug.length, 0, 'no LPDP or grad awards for undergrads');
  assert.equal(rankAid(entries, prof(), { level: 'grad', countries: ['United Kingdom'], q: '', fitsOnly: false, kinds: ['scholarship'] }).length, 0);
});
test('aidProfile reads the plan', () => {
  const p = aidProfile({ ...DEFAULT_ONBOARDING, track: 'grad', destinations: ['hongkong'], about: { funding: 'lpdp' } }, ['HKUST']);
  assert.deepEqual(p.countries, ['Hong Kong']); assert.equal(p.funding, 'lpdp'); assert.ok(p.onList.has('hkust'));
});
