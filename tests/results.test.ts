import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phaseOf, isInterviewStage, isoDay, daysUntil, dueLabel, resultLabel, fmtDay, parseDecisionDates, pickRound, expectedResult, checklistProgress, readyText,
  todoStatus, shortDetail, reqAction, sortForList, type CheckReq,
} from '../lib/results.ts';
import { STAGES } from '../lib/constants.ts';
import { submissionDeadline, type Deadline } from '../lib/applications.ts';

const now = new Date(2026, 10, 23, 15, 30); // 23 Nov 2026, local afternoon
const req = (name: string, o: Partial<CheckReq> = {}): CheckReq => ({ id: name, name, category: 'other', status: 'not_started', mandatory: true, notes: null, essay_id: null, recommendation_id: null, sort_order: 0, ...o });
const DATES = {
  cycle: '2026-2027', policy: 'Decisions are released on fixed dates.', source_url: 'https://school.edu/dates',
  rounds: [
    { round: 'Round 1', deadline: '2026-09-10', decision_date: '2026-12-10', decision_text: null },
    { round: 'Round 2', deadline: '2027-01-06', decision_date: '2027-03-18', decision_text: null },
    { round: 'Round 3', deadline: '2027-04-02', decision_date: null, decision_text: 'Mid May' },
  ],
};

test('every database stage maps to one of three steps', () => {
  const map = Object.fromEntries(STAGES.map((s) => [s, phaseOf(s)]));
  assert.deepEqual(map, {
    researching: 'prepare', shortlisted: 'prepare', preparing: 'prepare', ready: 'prepare',
    submitted: 'submitted', interview_invited: 'submitted', interview_scheduled: 'submitted', interview_completed: 'submitted',
    waitlisted: 'result', admitted: 'result', rejected: 'result', withdrawn: 'result',
  });
  assert.equal(phaseOf('something new'), 'prepare');
  assert.ok(isInterviewStage('interview_scheduled')); assert.ok(!isInterviewStage('submitted'));
});

test('isoDay accepts real dates only', () => {
  assert.equal(isoDay('2026-12-10'), '2026-12-10');
  assert.equal(isoDay('2026-12-10T05:00:00Z'), '2026-12-10');
  assert.equal(isoDay('2026-02-30'), null); assert.equal(isoDay('Mid May'), null); assert.equal(isoDay(null), null); assert.equal(isoDay(20261210), null);
});

test('daysUntil counts whole calendar days', () => {
  assert.equal(daysUntil('2026-11-23', now), 0);
  assert.equal(daysUntil('2026-11-24', now), 1);
  assert.equal(daysUntil('2026-12-31', now), 38);
  assert.equal(daysUntil('2026-11-20', now), -3);
  // a timestamp later today is still today, one early tomorrow is tomorrow
  assert.equal(daysUntil(new Date(2026, 10, 23, 23, 59).toISOString(), now), 0);
  assert.equal(daysUntil(new Date(2026, 10, 24, 0, 5).toISOString(), now), 1);
  // across a daylight saving change the count stays whole
  assert.equal(daysUntil('2027-03-20', new Date(2027, 2, 1, 9)), 19);
});

test('list labels', () => {
  assert.equal(dueLabel(null, now), 'No deadline yet');
  assert.equal(dueLabel('2027-01-05', now), 'Due in 43 days');
  assert.equal(dueLabel('2026-11-24', now), 'Due tomorrow');
  assert.equal(dueLabel('2026-11-23', now), 'Due today');
  assert.equal(dueLabel('2026-11-22', now), '1 day overdue');
  assert.equal(resultLabel('2026-12-31', now), 'Result in 38 days');
  assert.equal(resultLabel('2026-11-24', now), 'Result in 1 day');
  assert.equal(resultLabel('2026-11-23', now), 'Result due today');
  assert.equal(resultLabel('2026-11-01', now), 'Result any day now');
  assert.equal(resultLabel(null, now), 'Waiting for result');
  assert.equal(fmtDay('2026-12-10'), '10 Dec 2026'); assert.equal(fmtDay(null), '');
});

test('parseDecisionDates is defensive', () => {
  assert.equal(parseDecisionDates(null), null); assert.equal(parseDecisionDates('x'), null); assert.equal(parseDecisionDates({}), null); assert.equal(parseDecisionDates([]), null);
  const d = parseDecisionDates(DATES)!;
  assert.equal(d.rounds.length, 3); assert.equal(d.source_url, 'https://school.edu/dates'); assert.equal(d.cycle, '2026-2027');
  const odd = parseDecisionDates({ rounds: [{ deadline: '2027-01-06', decision_date: 'late March' }, null, 'junk', { round: ' Final ', deadline: 'soon' }], source_url: 'javascript:alert(1)' })!;
  assert.equal(odd.rounds.length, 2);
  assert.deepEqual(odd.rounds[0], { round: 'Round 1', deadline: '2027-01-06', decision_date: null, decision_text: 'late March' });
  assert.deepEqual(odd.rounds[1], { round: 'Final', deadline: null, decision_date: null, decision_text: null });
  assert.equal(odd.source_url, null);
  assert.equal(parseDecisionDates({ policy: 'Rolling, about six weeks after you apply' })!.rounds.length, 0);
});

test('pickRound: nearest deadline on or after the submitted date, unless the user chose one', () => {
  const r = parseDecisionDates(DATES)!.rounds;
  assert.equal(pickRound(r, '2026-09-01')?.round, 'Round 1');
  assert.equal(pickRound(r, '2026-09-10')?.round, 'Round 1'); // submitting on deadline day still counts
  assert.equal(pickRound(r, '2026-09-11')?.round, 'Round 2');
  assert.equal(pickRound(r, '2026-11-23')?.round, 'Round 2');
  assert.equal(pickRound(r, '2027-04-03'), null); // after the last deadline: ask the user
  assert.equal(pickRound(r, null), null);
  assert.equal(pickRound(r, '2026-09-01', 'Round 3')?.round, 'Round 3');
  assert.equal(pickRound(r, '2026-09-01', 'Round 9')?.round, 'Round 1'); // an unknown choice is ignored
  assert.equal(pickRound([...r].reverse(), '2026-09-11')?.round, 'Round 2'); // order in the data does not matter
  assert.equal(pickRound([{ round: 'Only', deadline: null, decision_date: '2027-01-01', decision_text: null }], '2026-09-01'), null);
});

test('expectedResult: school date, own date, or nothing', () => {
  const dates = parseDecisionDates(DATES);
  const school = expectedResult({ dates, submittedOn: '2026-11-23', now });
  assert.equal(school.date, '2027-03-18'); assert.equal(school.from, 'school'); assert.equal(school.daysLeft, 115); assert.equal(school.needsRoundChoice, false); assert.equal(school.sourceUrl, 'https://school.edu/dates');
  // the school's date wins over the applicant's own estimate
  assert.equal(expectedResult({ dates, submittedOn: '2026-11-23', ownDate: '2027-02-01', now }).date, '2027-03-18');
  // a round with words but no date: show the words, count down to the applicant's own date if they gave one
  const r3 = expectedResult({ dates, submittedOn: '2027-03-01', now });
  assert.equal(r3.date, null); assert.equal(r3.from, null); assert.equal(r3.note, 'Mid May'); assert.equal(r3.daysLeft, null);
  const r3own = expectedResult({ dates, submittedOn: '2027-03-01', ownDate: '2027-05-15', now });
  assert.equal(r3own.date, '2027-05-15'); assert.equal(r3own.from, 'you');
  // cannot tell the round: ask, and let a saved choice settle it
  const late = expectedResult({ dates, submittedOn: '2027-05-01', now });
  assert.equal(late.needsRoundChoice, true); assert.equal(late.date, null); assert.equal(late.note, 'Decisions are released on fixed dates.');
  assert.equal(expectedResult({ dates, submittedOn: '2027-05-01', chosenRound: 'Round 1', now }).date, '2026-12-10');
  // no researched dates at all
  const none = expectedResult({ dates: null, submittedOn: '2026-11-23', now });
  assert.deepEqual([none.date, none.from, none.needsRoundChoice, none.note, none.sourceUrl], [null, null, false, null, null]);
  assert.equal(expectedResult({ dates: null, submittedOn: '2026-11-23', ownDate: '2026-12-31', now }).daysLeft, 38);
  assert.equal(expectedResult({ dates: null, submittedOn: null, ownDate: 'not a date', now }).date, null);
});

test('checklistProgress splits to do and done, and leaves out the submit step', () => {
  const p = checklistProgress([
    req('Resume', { status: 'complete', sort_order: 1 }), req('Optional essay', { mandatory: false, sort_order: 2 }), req('GMAT/GRE', { sort_order: 3 }),
    req('English proficiency', { status: 'waived', sort_order: 4 }), req('Essay 1', { status: 'in_progress', sort_order: 5 }), req('Submission confirmation', { sort_order: 6 }),
  ]);
  assert.equal(p.total, 5); assert.equal(readyText(p), '2 of 5 ready'); assert.equal(p.percent, 40);
  assert.deepEqual(p.todo.map((r) => r.name), ['GMAT/GRE', 'Essay 1', 'Optional essay']); // required first
  assert.deepEqual(p.mandatoryOpen.map((r) => r.name), ['GMAT/GRE', 'Essay 1']);
  assert.deepEqual(p.done.map((r) => r.name), ['Resume', 'English proficiency']);
  const empty = checklistProgress([]); assert.equal(empty.percent, 0); assert.equal(readyText(empty), '0 of 0 ready');
});

test('row status, detail and the one action', () => {
  const draft = { id: 'e1', words: 310, word_limit: 750 }, blank = { id: 'e2', words: 0, word_limit: 500 };
  assert.equal(todoStatus(req('Essay 1'), draft), 'in_progress'); assert.equal(todoStatus(req('Essay 2'), blank), 'not_started'); assert.equal(todoStatus(req('Fee', { status: 'in_progress' })), 'in_progress');
  assert.equal(shortDetail(req('Essay 1'), draft), 'Draft saved, 310 of 750 words.');
  assert.equal(shortDetail(req('Essay 2'), blank), 'Prompt and word limit already loaded. Up to 500 words.');
  assert.equal(shortDetail(req('English', { status: 'waived' })), 'Not needed for this school.');
  assert.equal(shortDetail(req('Fee', { notes: '\nUS$250, paid online.\nSource: https://school.edu/fee' })), 'US$250, paid online.');
  assert.equal(shortDetail(req('Fee', { notes: 'Source: https://school.edu/fee' })), '');
  const long = shortDetail(req('Tests', { notes: 'word '.repeat(80) })); assert.ok(long.length <= 140 && long.endsWith('...'));
  assert.deepEqual(reqAction(req('Essay 1', { category: 'essays', essay_id: 'e1' }), draft), { kind: 'link', label: 'Continue writing', href: '/essays/e1' });
  assert.deepEqual(reqAction(req('Essay 2', { category: 'essays', essay_id: 'e2' }), blank), { kind: 'link', label: 'Start essay', href: '/essays/e2' });
  assert.deepEqual(reqAction(req('Essay 3', { category: 'essays' })), { kind: 'link', label: 'Open essays', href: '/essays' });
  assert.deepEqual(reqAction(req('Recommendation 1', { category: 'recommendations' })), { kind: 'link', label: 'Add recommender', href: '/recommendations' });
  assert.deepEqual(reqAction(req('GMAT/GRE', { category: 'tests' })), { kind: 'link', label: 'Add score', href: '/profile?tab=tests' });
  assert.deepEqual(reqAction(req('Application fee')), { kind: 'done', label: 'Mark as paid' });
  assert.deepEqual(reqAction(req('Resume', { category: 'resume' })), { kind: 'done', label: 'Mark as done' });
});

test('list order: preparing by nearest deadline, then waiting, then results', () => {
  const rows = [
    { id: 'admitted', stage: 'admitted', dueAt: '2026-09-01T00:00:00Z', resultDate: null },
    { id: 'waiting-late', stage: 'submitted', dueAt: '2026-09-01T00:00:00Z', resultDate: '2027-03-18' },
    { id: 'no-deadline', stage: 'researching', dueAt: null, resultDate: null },
    { id: 'far', stage: 'preparing', dueAt: '2027-01-13T04:59:00Z', resultDate: null },
    { id: 'waiting-soon', stage: 'interview_invited', dueAt: null, resultDate: '2026-12-10' },
    { id: 'near', stage: 'ready', dueAt: '2027-01-05T04:59:00Z', resultDate: null },
  ];
  assert.deepEqual(sortForList(rows).map((r) => r.id), ['near', 'far', 'no-deadline', 'waiting-soon', 'waiting-late', 'admitted']);
});

test('submissionDeadline prefers the submission or primary deadline', () => {
  const at = new Date('2026-11-23T12:00:00Z');
  const dl = (id: string, days: number, o: Partial<Deadline> = {}): Deadline => ({ id, application_id: 'a', name: id, due_at: new Date(at.getTime() + days * 86_400_000).toISOString(), timezone: 'UTC', kind: 'other', is_primary: false, ...o });
  assert.equal(submissionDeadline([], at), null);
  assert.equal(submissionDeadline([dl('essay', 3, { kind: 'essay' }), dl('submit', 40, { kind: 'submission' })], at)?.id, 'submit');
  assert.equal(submissionDeadline([dl('essay', 3, { kind: 'essay' }), dl('main', 20, { is_primary: true })], at)?.id, 'main');
  assert.equal(submissionDeadline([dl('later', 9), dl('sooner', 3)], at)?.id, 'sooner');
});
