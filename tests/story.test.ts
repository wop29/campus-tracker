import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStory } from '../lib/story.ts';

const base = { track: 'grad' as const, program: 'mba' as const, goals: null, work: [], education: [], tests: [] };

test('buildStory: nothing filled in gives no blocks (that is fine)', () => {
  assert.deepEqual(buildStory(base), []);
});

test('buildStory: goals come first for grad and only filled fields show', () => {
  const b = buildStory({ ...base, goals: { why_mba: 'To move into product strategy', short_term_goal: '  Strategy associate  ', long_term_goal: '', target_companies: ['Gojek', 'Grab'] } });
  assert.equal(b[0].key, 'goals');
  assert.deepEqual(b[0].items.map((i) => i.label), ['Why MBA', 'Short-term goal', 'Target companies']);
  assert.equal(b[0].items[1].text, 'Strategy associate');
  assert.equal(b[0].items[2].text, 'Gojek, Grab');
});

test('buildStory: work reads as a copyable paragraph with dates and impact', () => {
  const b = buildStory({ ...base, work: [{ id: 'w1', company: 'Ipsos', position: 'Consultant', start_date: '2021-03-01', end_date: '2024-02-01', achievements: 'Led 12 projects', measurable_impact: 'Saved 20% of review time' }] });
  assert.equal(b[0].key, 'work');
  assert.match(b[0].items[0].text, /^Consultant at Ipsos \(.* to .*\)/);
  assert.match(b[0].items[0].text, /Achievements: Led 12 projects/);
  assert.match(b[0].items[0].text, /Impact: Saved 20% of review time/);
});

test('buildStory: planned tests and tests without a score are left out', () => {
  const b = buildStory({ ...base, tests: [
    { id: 't1', test_type: 'GMAT', overall: 700, quant: 48, verbal: 40, test_date: '2026-05-10' },
    { id: 't2', test_type: 'IELTS', status: 'planned', test_date: '2027-01-10' },
    { id: 't3', test_type: 'GRE' },
  ] });
  assert.equal(b.length, 1);
  assert.equal(b[0].items.length, 1);
  assert.match(b[0].items[0].text, /700.*quant 48.*verbal 40/);
});

test('buildStory: undergrads see education first and no target companies', () => {
  const b = buildStory({ track: 'undergrad', goals: { why_mba: 'Computer science, because I like building things', target_companies: ['X'] }, work: [], tests: [],
    education: [{ id: 'e1', institution: 'SMA Negeri 3 Bandung', degree: 'SMA', major: 'IPA', country: 'Indonesia', enrollment_status: 'current', graduation_date: '2027-06-01' }] });
  assert.deepEqual(b.map((x) => x.key), ['education', 'goals']);
  assert.equal(b[1].items.length, 1);
});
