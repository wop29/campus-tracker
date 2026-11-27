import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programForRounds, programRounds, roundTimeline, unlinkedRoundInfo, type RoundSource } from '../lib/results.ts';
import { parseRounds } from '../lib/programs.ts';

const P = (id: string, program_name: string, format = 'full-time', degree_type = 'mba') => ({ id, program_name, format, degree_type });

test('programForRounds: matches the application program name, ignoring Daytime/Full-time words', () => {
  const list = [P('a', 'Daytime MBA'), P('b', 'Accelerated Daytime MBA')];
  assert.equal(programForRounds('MBA', list)?.id, 'a');
  assert.equal(programForRounds('Accelerated Daytime MBA', list)?.id, 'b');
});

test('programForRounds: falls back to the only regular full-time MBA', () => {
  const list = [P('a', 'Full-Time MBA (August entry)'), P('b', 'Full-Time MBA (January entry, J-Term)'), P('c', 'MBA/MPP (joint)'), P('d', 'Part-time MBA', 'part-time')];
  assert.equal(programForRounds('MBA', [P('x', 'INSEAD MBA')])?.id, 'x');
  // two programs both read as "MBA" once words in brackets are ignored: no guess from the name, but only one is a regular full-time MBA
  assert.equal(programForRounds('MBA', list)?.id, 'a');
});

test('programForRounds: never guesses between several regular MBAs', () => {
  const list = [P('a', 'Cornell MBA (two-year, Ithaca)'), P('b', 'Johnson Cornell Tech MBA (NYC, one-year)'), P('c', 'Johnson Cornell Tech MBA Future Tech Leaders Program (NYC)')];
  assert.equal(programForRounds('Executive thing', list), null);
});

test('parseRounds reads Stage labels (Oxford)', () => {
  const r = parseRounds('2027-28 cohort. Stage 1: Sep 2, 2026 (decision Oct 16, 2026). Stage 2: Oct 5, 2026 (decision Nov 20, 2026). Stage 4: Jan 6, 2027 (decision Mar 5, 2027).', new Date('2026-11-27T12:00:00'));
  assert.deepEqual(r.map((x) => [x.label, x.date, x.closed]), [['Stage 1', '2026-09-02', true], ['Stage 2', '2026-10-05', true], ['Stage 4', '2027-01-06', false]]);
});

const duke: RoundSource = { id: 'p1', school_name: 'Duke Fuqua', program_name: 'Daytime MBA', degree_type: 'mba', format: 'full-time', deadlines_info: null,
  decision_dates: { cycle: '2026-27', rounds: [{ round: 'Round 2', deadline: '2027-01-05', decision_date: '2027-03-11' }, { round: 'Round 3', deadline: '2027-03-25', decision_date: '2027-05-06' }] } };
const school = { name: 'Duke Fuqua', short_name: 'Fuqua' };

test('an application with no program link still shows its school rounds', () => {
  const info = unlinkedRoundInfo({ program: 'MBA', program_requirement_id: null, school }, [duke]);
  assert.ok(info);
  const rounds = roundTimeline(programRounds(info.decision_dates, info.deadlines_info), new Date('2026-11-27T12:00:00'));
  assert.deepEqual(rounds.map((r) => r.round), ['Round 2', 'Round 3']);
});

test('nothing is borrowed when the application is already linked, or the school differs', () => {
  assert.equal(unlinkedRoundInfo({ program: 'MBA', program_requirement_id: 'p9', school }, [duke]), null);
  assert.equal(unlinkedRoundInfo({ program: 'MBA', program_requirement_id: null, school: { name: 'Kellogg', short_name: 'Kellogg' } }, [duke]), null);
});
