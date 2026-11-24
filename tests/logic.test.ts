import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readiness, DEFAULT_WEIGHTS, type Req } from '../lib/logic/readiness.ts';
import { deadlineRisk, timeRemaining } from '../lib/logic/risk.ts';
import { countWords, wordLimitState } from '../lib/logic/text.ts';

const mk = (category: Req['category'], status: string, mandatory = true, name = 'x'): Req => ({ name, category, status, mandatory });
test('readiness: empty list is 0 and no blockers', () => { const r = readiness([]); assert.equal(r.percent, 0); assert.equal(r.blockers.length, 0); });
test('readiness: all complete is 100', () => { assert.equal(readiness([mk('essays', 'complete'), mk('resume', 'complete')]).percent, 100); });
test('readiness: weights renormalise over present categories', () => {
  // essays 25 (done) + resume 10 (not done) => 25/35
  assert.equal(readiness([mk('essays', 'complete'), mk('resume', 'not_started')]).percent, Math.round((25 / 35) * 100));
});
test('readiness: half of essays done contributes half the essay weight', () => {
  assert.equal(readiness([mk('essays', 'complete'), mk('essays', 'not_started')]).percent, 50);
});
test('readiness: waived counts as done, optional not a blocker', () => {
  const r = readiness([mk('essays', 'waived'), mk('form', 'not_started', false)]);
  assert.equal(r.blockers.length, 0); assert.equal(r.canBeReady, true);
});
test('readiness: mandatory open is a blocker', () => { const r = readiness([mk('tests', 'in_progress')]); assert.equal(r.blockers.length, 1); assert.equal(r.canBeReady, false); });
test('readiness: custom weights respected', () => {
  const w = { ...DEFAULT_WEIGHTS, essays: 90, resume: 10 };
  assert.equal(readiness([mk('essays', 'complete'), mk('resume', 'not_started')], w).percent, 90);
});
const now = new Date('2026-11-16T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
test('risk: overdue is red', () => assert.equal(deadlineRisk({ dueAt: inDays(-1), mandatoryOpen: 0, now }).risk, 'red'));
test('risk: submitted is green even if past', () => assert.equal(deadlineRisk({ dueAt: inDays(-5), mandatoryOpen: 3, submitted: true, now }).risk, 'green'));
test('risk: 3 days and open mandatory is red', () => assert.equal(deadlineRisk({ dueAt: inDays(3), mandatoryOpen: 1, now }).risk, 'red'));
test('risk: 10 days and open mandatory is yellow', () => assert.equal(deadlineRisk({ dueAt: inDays(10), mandatoryOpen: 2, now }).risk, 'yellow'));
test('risk: 40 days and open items is green', () => assert.equal(deadlineRisk({ dueAt: inDays(40), mandatoryOpen: 3, now }).risk, 'green'));
test('risk: not enough days for the work is red', () => assert.equal(deadlineRisk({ dueAt: inDays(5), mandatoryOpen: 12, now }).risk, 'red'));
test('timeRemaining formats', () => { assert.match(timeRemaining(inDays(2), now), /2d .* left/); assert.match(timeRemaining(inDays(-1), now), /overdue/); });
test('countWords handles blanks and whitespace', () => { assert.equal(countWords(''), 0); assert.equal(countWords('  a  b\nc '), 3); assert.equal(countWords(null), 0); });
test('wordLimitState', () => { assert.equal(wordLimitState(10, null), 'none'); assert.equal(wordLimitState(95, 100), 'near'); assert.equal(wordLimitState(101, 100), 'over'); assert.equal(wordLimitState(50, 100), 'ok'); });
