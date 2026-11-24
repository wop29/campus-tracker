import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHOOL_COUNTRIES, OTHER_COUNTRY, countryChoice, countryValue, defaultCountryFor } from '../lib/school-form.ts';

test('school form: country list covers the agreed countries', () => {
  for (const c of ['United States', 'United Kingdom', 'Canada', 'Australia', 'Singapore', 'Hong Kong', 'France', 'Spain', 'Switzerland', 'China', 'Netherlands', 'Germany', 'Japan']) assert.ok((SCHOOL_COUNTRIES as readonly string[]).includes(c), c);
});
test('school form: stored country maps to the dropdown and back', () => {
  assert.deepEqual(countryChoice('USA'), { choice: 'United States', other: '' });
  assert.deepEqual(countryChoice(' united kingdom '), { choice: 'United Kingdom', other: '' });
  assert.deepEqual(countryChoice('Indonesia'), { choice: OTHER_COUNTRY, other: 'Indonesia' });
  assert.deepEqual(countryChoice(null), { choice: '', other: '' });
  assert.equal(countryValue('Japan', 'ignored'), 'Japan'); assert.equal(countryValue(OTHER_COUNTRY, '  Korea '), 'Korea');
  assert.equal(countryValue('Narnia', ''), ''); assert.equal(countryValue('', ''), '');
});
test('school form: default country only when there is exactly one destination', () => {
  assert.equal(defaultCountryFor(['australia']), 'Australia'); assert.equal(defaultCountryFor(['us', 'uk']), ''); assert.equal(defaultCountryFor(undefined), '');
});
