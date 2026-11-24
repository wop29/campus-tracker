import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readReminderPrefs, isReminderDue, localParts, withReminderPatch, dayDiff, addDays, longDate, expectedResultOn, buildReminderFacts, decideReminder, nudgeStatus,
  pickTinyStep, tinyStepFor, composeReminder, appHref, TEMPLATES, NUDGE_DAYS, NUDGE_FINAL_DAY, PRODUCT_NAME,
  type Decision, type FactApp, type LogEntry, type ReminderFacts, type ReminderRows,
} from '../lib/reminders.ts';
import { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from '../lib/email/token.ts';

const UID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-16T12:00:00Z'); // 19:00 Jakarta, 07:00 New York, 04:00 Los Angeles
const done = (extra: Record<string, unknown> = {}) => ({ onboarding: { done: true, track: 'grad', destinations: ['us'], stage: 'applying', ...extra } });

test('prefs: missing onboarding means no email; done defaults to on at 19 in Asia/Jakarta', () => {
  assert.equal(readReminderPrefs(null).enabled, false);
  assert.equal(readReminderPrefs({}).onboarded, false);
  assert.equal(readReminderPrefs({ onboarding: { done: 'yes' } }).enabled, false);
  const p = readReminderPrefs(done());
  assert.deepEqual([p.enabled, p.hourLocal, p.timezone], [true, 19, 'Asia/Jakarta']);
  const q = readReminderPrefs(done({ reminders: { email: false, hourLocal: 8 }, timezone: 'America/New_York', intake: 'Fall 2027' }));
  assert.deepEqual([q.enabled, q.hourLocal, q.timezone, q.intake], [false, 8, 'America/New_York', 'Fall 2027']);
  assert.equal(readReminderPrefs(done({ timezone: 'Not/AZone', reminders: { email: true, hourLocal: 99 } })).timezone, 'Asia/Jakarta');
  assert.equal(readReminderPrefs(done({ reminders: { email: true, hourLocal: 99 } })).hourLocal, 19);
});

test('withReminderPatch keeps every other key', () => {
  const s = { theme: 'night', onboarding: { done: true, track: 'undergrad', reminders: { email: true, hourLocal: 12 } } };
  const out = withReminderPatch(s, { email: false }) as { theme: string; onboarding: { done: boolean; track: string; reminders: { email: boolean; hourLocal: number } } };
  assert.equal(out.theme, 'night'); assert.equal(out.onboarding.track, 'undergrad'); assert.equal(out.onboarding.done, true);
  assert.deepEqual(out.onboarding.reminders, { email: false, hourLocal: 12 });
  assert.deepEqual((withReminderPatch(null, { hourLocal: 8 }) as { onboarding: unknown }).onboarding, { reminders: { hourLocal: 8 } });
  assert.equal(s.onboarding.reminders.email, true, 'input not mutated');
});

test('localParts across time zones', () => {
  assert.deepEqual(localParts(NOW, 'Asia/Jakarta'), { date: '2026-11-16', hour: 19 });
  assert.deepEqual(localParts(NOW, 'America/New_York'), { date: '2026-11-16', hour: 7 });
  assert.deepEqual(localParts(new Date('2026-11-16T03:00:00Z'), 'America/Los_Angeles'), { date: '2026-11-15', hour: 19 });
  assert.deepEqual(localParts(new Date('2026-11-16T18:30:00Z'), 'Asia/Kolkata'), { date: '2026-11-17', hour: 0 });
  assert.deepEqual(localParts(new Date('2026-11-16T00:00:00Z'), 'UTC'), { date: '2026-11-16', hour: 0 });
});

test('due: daily mode ignores the hour, hourly mode waits for it, never twice on the same local date', () => {
  const jkt = readReminderPrefs(done());
  assert.deepEqual(isReminderDue(jkt, NOW, []), { due: true, reason: 'due', localDate: '2026-11-16', localHour: 19 });
  assert.equal(isReminderDue(jkt, NOW, ['2026-11-16']).reason, 'already_sent');
  assert.equal(isReminderDue(jkt, NOW, ['2026-11-15']).due, true);
  const ny = readReminderPrefs(done({ timezone: 'America/New_York' }));
  assert.equal(isReminderDue(ny, NOW, []).due, true);                                   // daily cron: 7 am, still sends
  assert.equal(isReminderDue(ny, NOW, [], { respectHour: true }).reason, 'too_early'); // hourly scheduler: waits for 19
  assert.equal(isReminderDue(ny, new Date('2026-11-17T00:00:00Z'), [], { respectHour: true }).due, true); // 19:00 NY
  // Late evening in LA is already the next UTC day, but the local date is still the 15th
  const la = readReminderPrefs(done({ timezone: 'America/Los_Angeles' }));
  const r = isReminderDue(la, new Date('2026-11-16T03:30:00Z'), ['2026-11-16'], { respectHour: true });
  assert.deepEqual([r.due, r.localDate], [true, '2026-11-15']);
  assert.equal(isReminderDue(readReminderPrefs(done({ reminders: { email: false } })), NOW, []).reason, 'off');
  assert.equal(isReminderDue(readReminderPrefs({ onboarding: { done: false } }), NOW, []).reason, 'not_onboarded');
  // Calling hourly all day sends at most once per local date
  let sent: string[] = [], count = 0;
  for (let h = 0; h < 48; h++) {
    const t = new Date(Date.UTC(2026, 10, 16, h));
    const d = isReminderDue(jkt, t, sent, { respectHour: true });
    if (d.due) { count++; sent = [...sent, d.localDate]; }
  }
  assert.equal(count, 2); assert.deepEqual(sent, ['2026-11-16', '2026-11-17']);
});

// ---------------------------------------------------------------------------------------------------------------
// Decision function. Facts are plain local dates, so these tests need no clock.
const TODAY = '2026-11-16';
const day = (n: number) => addDays(TODAY, n);
const open = (name: string, category = 'other', status = 'not_started') => ({ name, category, status });
const fApp = (over: Partial<FactApp> = {}): FactApp => ({
  id: 'a1', label: 'Harbor University', state: 'active', deadlineOn: null, resultOn: null, submittedOn: null, total: 9, ready: 4,
  remaining: [open('Essay 1', 'essays', 'in_progress'), open('Resume', 'resume'), open('Transcript', 'academics'), open('Test score', 'tests'), open('Online form', 'form')],
  readyOn: [day(-9), day(-9), day(-8), day(-8)], ...over,
});
const facts = (over: Partial<ReminderFacts> = {}): ReminderFacts => ({ userId: UID, name: 'Wenny', today: TODAY, apps: [fApp()], lastActiveOn: TODAY, history: [], ...over });
const OPTS = { appUrl: 'https://app.example.com/', unsubscribeUrl: 'https://app.example.com/api/reminders/unsubscribe?u=1&t=2' };

test('dates: dayDiff, addDays, longDate', () => {
  assert.equal(dayDiff('2026-11-16', '2026-11-23'), 7); assert.equal(dayDiff('2026-12-31', '2027-01-01'), 1); assert.equal(dayDiff('2026-11-16', '2026-11-15'), -1);
  assert.equal(addDays('2026-02-27', 2), '2026-03-01'); assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(longDate('2026-11-30'), 'Monday, November 30');
});

test('deadline_week: exactly 7, 3 and 1 day(s) away, only for applications not submitted', () => {
  for (let n = -2; n <= 10; n++) {
    const d = decideReminder(facts({ apps: [fApp({ deadlineOn: day(n) })] }));
    assert.equal(d.kind, [7, 3, 1].includes(n) ? 'deadline_week' : null, `deadline in ${n} days`);
    if (d.kind === 'deadline_week') assert.equal(d.daysLeft, n);
  }
  assert.equal(decideReminder(facts({ apps: [fApp({ deadlineOn: day(7), state: 'submitted' })] })).kind, null);
  assert.equal(decideReminder(facts({ apps: [fApp({ deadlineOn: day(7), state: 'closed' })] })).kind, null);
  // Two deadlines on the same day: the nearer one is the subject of the single email
  const d = decideReminder(facts({ apps: [fApp({ id: 'far', label: 'Far', deadlineOn: day(7) }), fApp({ id: 'near', label: 'Near', deadlineOn: day(1) })] }));
  assert.ok(d.kind === 'deadline_week' && d.app.id === 'near' && d.daysLeft === 1);
  assert.match(d.reason, /Near deadline is 1 day away \(2026-11-17\)/);
});

test('result_soon: tomorrow or today, submitted and undecided only, one email per result', () => {
  const sub = (n: number, over: Partial<FactApp> = {}) => fApp({ state: 'submitted', resultOn: day(n), remaining: [], ready: 9, ...over });
  const t = decideReminder(facts({ apps: [sub(1)] }));
  assert.ok(t.kind === 'result_soon' && t.when === 'tomorrow');
  const d0 = decideReminder(facts({ apps: [sub(0)] }));
  assert.ok(d0.kind === 'result_soon' && d0.when === 'today');
  assert.equal(decideReminder(facts({ apps: [sub(0)], history: [{ sentOn: day(-1), kind: 'result_soon' }] })).kind, null, 'already wrote yesterday');
  assert.equal(decideReminder(facts({ apps: [sub(2)] })).kind, null); assert.equal(decideReminder(facts({ apps: [sub(-1)] })).kind, null);
  assert.equal(decideReminder(facts({ apps: [sub(1, { state: 'active' })] })).kind, null, 'not submitted yet');
  assert.equal(decideReminder(facts({ apps: [sub(1, { state: 'closed' })] })).kind, null, 'decision already recorded');
});

test('priority: deadline_week, then result_soon, then nudge, then celebration. Never more than one', () => {
  const deadline = fApp({ id: 'd', label: 'Deadline U', deadlineOn: day(7) });
  const result = fApp({ id: 'r', label: 'Result U', state: 'submitted', resultOn: day(1) });
  const milestone = fApp({ id: 'm', label: 'Milestone U', total: 4, ready: 4, remaining: [], readyOn: [day(-5), day(-5), day(-5), day(-1)] });
  const plain = fApp({ id: 'p', label: 'Plain U' });
  const silent = { lastActiveOn: day(-3) };
  assert.equal(decideReminder(facts({ apps: [milestone, result, deadline], ...silent })).kind, 'deadline_week');
  assert.equal(decideReminder(facts({ apps: [milestone, result, plain], ...silent })).kind, 'result_soon');
  assert.equal(decideReminder(facts({ apps: [milestone, plain], ...silent })).kind, 'nudge');
  assert.equal(decideReminder(facts({ apps: [milestone, plain], lastActiveOn: day(-1) })).kind, 'celebration');
  assert.equal(decideReminder(facts({ apps: [plain], lastActiveOn: day(-1) })).kind, null, 'simply active: no email');
  assert.equal(decideReminder(facts({ apps: [plain], lastActiveOn: TODAY })).kind, null);
});

/** Runs the policy once a day for a user who stops making progress on day 0, logging every email like the cron does. */
function simulate(daysToRun: number, opts: { apps?: FactApp[]; skip?: number[] } = {}) {
  const history: LogEntry[] = [], sent: { day: number; kind: string }[] = [];
  for (let n = 1; n <= daysToRun; n++) {
    if (opts.skip?.includes(n)) continue; // the cron did not run that day
    const today = addDays('2026-10-01', n);
    const d = decideReminder({ userId: UID, name: null, today, apps: opts.apps ?? [fApp()], lastActiveOn: '2026-10-01', history: [...history] });
    if (d.kind) { history.push({ sentOn: today, kind: d.logKind }); sent.push({ day: n, kind: d.logKind }); }
  }
  return sent;
}

test('nudge cadence: 2, 5 and 12 full days of silence, one final note at 3 weeks, then nothing ever', () => {
  // Last active on day 0. "2 full days of silence" means days 1 and 2 passed with no progress, so the email goes on day 3.
  assert.deepEqual(simulate(120), [{ day: 3, kind: 'nudge' }, { day: 6, kind: 'nudge' }, { day: 13, kind: 'nudge' }, { day: 22, kind: 'nudge_final' }]);
  assert.deepEqual([...NUDGE_DAYS], [2, 5, 12]); assert.equal(NUDGE_FINAL_DAY, 21);
  const at = (silent: number, history: LogEntry[] = []) => nudgeStatus(facts({ lastActiveOn: day(-(silent + 1)), history }));
  assert.equal(at(0).send, false); assert.equal(at(1).send, false); assert.equal(at(2).send, true);
  assert.equal(at(4, [{ sentOn: day(-2), kind: 'nudge' }]).send, false, 'between nudges');
  const fin = at(21, [{ sentOn: day(-19), kind: 'nudge' }, { sentOn: day(-16), kind: 'nudge' }, { sentOn: day(-9), kind: 'nudge' }]);
  assert.ok(fin.send && fin.final);
  assert.equal(at(22, [{ sentOn: day(-1), kind: 'nudge_final' }]).send, false, 'after the final note');
  assert.equal(at(60).send, false, 'long silence with no history: still quiet');
  assert.equal(at(400).send, false);
});

test('nudge cadence: missed runs catch up without bunching, coming back resets it, old rows count as nudges', () => {
  // Cron down on days 3 to 5: the first nudge goes on day 6, the next one waits at least 3 days
  assert.deepEqual(simulate(40, { skip: [3, 4, 5] }), [{ day: 6, kind: 'nudge' }, { day: 9, kind: 'nudge' }, { day: 13, kind: 'nudge' }, { day: 22, kind: 'nudge_final' }]);
  // Cron down for the whole final week and its grace days: no late final note
  assert.deepEqual(simulate(60, { skip: [22, 23, 24, 25, 26, 27, 28] }).map((s) => s.kind), ['nudge', 'nudge', 'nudge']);
  // Progress resets everything: emails sent before the new activity do not count
  const back = facts({ lastActiveOn: day(-3), history: [{ sentOn: day(-30), kind: 'nudge_final' }, { sentOn: day(-10), kind: 'nudge' }] });
  assert.equal(decideReminder(back).kind, 'nudge');
  // Rows from before migration 024 (kind null) count as nudges, so nobody gets a burst when this ships
  assert.equal(nudgeStatus(facts({ lastActiveOn: day(-7), history: [{ sentOn: day(-5), kind: null }, { sentOn: day(-4), kind: null }] })).send, false);
  // A deadline email in between does not use up a nudge
  assert.equal(nudgeStatus(facts({ lastActiveOn: day(-3), history: [{ sentOn: day(-1), kind: 'deadline_week' }] })).send, true);
  // Nothing left to do (all submitted): no nudge. No applications at all: a nudge towards a first school.
  assert.equal(decideReminder(facts({ lastActiveOn: day(-3), apps: [fApp({ state: 'submitted' })] })).kind, null);
  const none = decideReminder(facts({ lastActiveOn: day(-3), apps: [] }));
  assert.ok(none.kind === 'nudge' && none.app === null && none.step.href === '/schools');
  assert.equal(decideReminder(facts({ lastActiveOn: null })).kind, null);
});

test('nudge: one tiny step from a real open item, on the application with the nearest deadline', () => {
  const a = fApp({ id: 'later', label: 'Later U', deadlineOn: day(40), remaining: [open('Resume', 'resume')] });
  const b = fApp({ id: 'sooner', label: 'Sooner U', deadlineOn: day(12) });
  const { app, step } = pickTinyStep(facts({ apps: [a, b] }));
  assert.equal(app?.id, 'sooner'); assert.equal(step.href, '/applications?a=sooner');
  assert.equal(step.text, 'Open "Essay 1" and write one rough sentence. It does not need to be good.');
  assert.match(tinyStepFor(open('Letter from manager', 'recommendations')), /name of one person/);
  assert.match(tinyStepFor(open('Letter from manager', 'recommendations', 'in_progress')), /where it stands/);
  const done = pickTinyStep(facts({ apps: [fApp({ remaining: [], ready: 9 })] }));
  assert.match(done.step.text, /Read through your Harbor University checklist/);
  assert.equal(appHref('a b'), '/applications?a=a%20b');
});

test('celebration: first item, half way, all ready, submitted. Only for yesterday', () => {
  const y = day(-1);
  const m = (app: FactApp, over: Partial<ReminderFacts> = {}) => { const d = decideReminder(facts({ apps: [app], lastActiveOn: y, ...over })); return d.kind === 'celebration' ? d.milestone : d.kind; };
  assert.equal(m(fApp({ total: 9, ready: 1, readyOn: [y] })), 'first_item');
  assert.equal(m(fApp({ total: 9, ready: 2, readyOn: [day(-4), y] })), null, 'second item: just a normal active day');
  assert.equal(m(fApp({ total: 9, ready: 5, readyOn: [day(-4), day(-4), day(-4), day(-4), y] })), 'half_way');
  assert.equal(m(fApp({ total: 8, ready: 4, readyOn: [day(-4), day(-4), day(-4), y] })), 'half_way');
  assert.equal(m(fApp({ total: 9, ready: 6, readyOn: [day(-4), day(-4), day(-4), day(-4), day(-4), y] })), null, 'already past half');
  assert.equal(m(fApp({ total: 3, ready: 3, remaining: [], readyOn: [day(-4), y, y] })), 'all_ready');
  assert.equal(m(fApp({ state: 'submitted', submittedOn: y, total: 3, ready: 3, remaining: [], readyOn: [day(-4), day(-4), day(-4)] })), 'submitted');
  assert.equal(m(fApp({ state: 'submitted', submittedOn: day(-2) })), null, 'two days ago is not celebrated late');
  // Items finished today do not change what happened yesterday
  assert.equal(m(fApp({ total: 9, ready: 6, readyOn: [day(-4), day(-4), day(-4), day(-4), y, TODAY] }), { lastActiveOn: TODAY }), 'half_way');
  const d = decideReminder(facts({ apps: [fApp({ total: 8, ready: 5, readyOn: [day(-4), day(-4), day(-4), y, TODAY] })] }));
  assert.ok(d.kind === 'celebration' && d.ready === 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Facts from raw rows: time zone day boundaries and defensive reads
const rows = (over: Partial<ReminderRows> = {}): ReminderRows => ({
  schools: [{ id: 's1', name: 'Harbor University', short_name: null }],
  applications: [{ id: 'a1', school_id: 's1', stage: 'preparing', round: 'Round 2', submission_confirmed_at: null, submitted_at: null }],
  deadlines: [], requirements: [], decisions: [], decisionDates: {}, activityAt: [], history: [], ...over,
});
const req = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, application_id: 'a1', name: `Item ${id}`, category: 'other', status, mandatory: true, completed_at: null, updated_at: null, ...extra });
const meta = (timezone: string) => ({ userId: UID, name: ' Wenny ', timezone });

test('time zones: the same deadline is "7 days away" on different days in Jakarta and New York', () => {
  // Due 23:59 New York time on Nov 30 = 04:59 UTC Dec 1 = 11:59 Jakarta time on Dec 1
  const r = rows({ deadlines: [{ id: 'd', application_id: 'a1', name: 'Round 2', due_at: '2026-12-01T04:59:00Z', timezone: 'America/New_York', kind: 'submission', is_primary: true }] });
  const kindAt = (iso: string, tz: string) => decideReminder(buildReminderFacts(r, meta(tz), new Date(iso))).kind;
  assert.equal(buildReminderFacts(r, meta('America/New_York'), NOW).apps[0].deadlineOn, '2026-11-30');
  assert.equal(buildReminderFacts(r, meta('Asia/Jakarta'), NOW).apps[0].deadlineOn, '2026-12-01');
  assert.equal(kindAt('2026-11-23T12:00:00Z', 'America/New_York'), 'deadline_week'); // Nov 23 local, due Nov 30 local
  assert.equal(kindAt('2026-11-23T12:00:00Z', 'Asia/Jakarta'), null);                // Nov 23 local, due Dec 1 local: 8 days
  assert.equal(kindAt('2026-11-24T12:00:00Z', 'Asia/Jakarta'), 'deadline_week');
  assert.equal(kindAt('2026-11-24T12:00:00Z', 'America/New_York'), null);
  // Just before and just after local midnight in New York (05:00 UTC in November)
  assert.equal(kindAt('2026-11-23T04:59:00Z', 'America/New_York'), null);            // still Nov 22: 8 days
  assert.equal(kindAt('2026-11-23T05:00:00Z', 'America/New_York'), 'deadline_week'); // Nov 23: 7 days
  assert.equal(kindAt('2026-11-24T05:00:00Z', 'America/New_York'), null);            // Nov 24: 6 days
  assert.equal(kindAt('2026-11-29T05:00:00Z', 'America/New_York'), 'deadline_week'); // 1 day
});

test('time zones: silence is counted in the user\'s own days', () => {
  // Progress at 17:30 UTC on Nov 13 is already Nov 14 in Jakarta but still Nov 13 in Los Angeles
  const r = rows({ activityAt: ['2026-11-13T17:30:00Z', null, undefined, 'not a date'] });
  const jkt = buildReminderFacts(r, meta('Asia/Jakarta'), NOW), la = buildReminderFacts(r, meta('America/Los_Angeles'), NOW);
  assert.deepEqual([jkt.today, jkt.lastActiveOn], ['2026-11-16', '2026-11-14']);
  assert.deepEqual([la.today, la.lastActiveOn], ['2026-11-16', '2026-11-13']);
  assert.equal(decideReminder(jkt).kind, null, 'Jakarta: only Nov 15 was a full silent day');
  assert.equal(decideReminder(la).kind, 'nudge', 'Los Angeles: Nov 14 and 15 were silent');
  assert.equal(jkt.name, 'Wenny');
  // A requirement edit counts as progress, and a bad time zone falls back safely
  const edited = buildReminderFacts(rows({ requirements: [req('1', 'in_progress', { updated_at: '2026-11-16T01:00:00Z' })] }), meta('Not/AZone'), NOW);
  assert.equal(edited.lastActiveOn, '2026-11-16');
});

test('facts: checklist counts, application state, milestones from completion times', () => {
  const r = rows({
    requirements: [req('1', 'complete', { completed_at: '2026-11-15T03:00:00Z' }), req('2', 'waived'), req('3', 'in_progress'), req('4', 'not_started'),
      req('5', 'not_started', { mandatory: false }), req('6', 'not_started', { name: 'Submission confirmation' }), { ...req('7', 'not_started'), application_id: 'other' }],
  });
  const a = buildReminderFacts(r, meta('Asia/Jakarta'), NOW).apps[0];
  assert.deepEqual([a.label, a.state, a.total, a.ready], ['Harbor University', 'active', 4, 2]);
  assert.deepEqual(a.remaining.map((x) => x.name), ['Item 3', 'Item 4']);
  assert.deepEqual(a.readyOn, ['2026-11-15', null]);
  const state = (stage: string, decision?: string, confirmed: string | null = null) => buildReminderFacts(rows({
    applications: [{ id: 'a1', school_id: 's1', stage, round: null, submission_confirmed_at: confirmed, submitted_at: null }], decisions: decision ? [{ application_id: 'a1', decision }] : [],
  }), meta('UTC'), NOW).apps[0];
  assert.equal(state('submitted').state, 'submitted'); assert.equal(state('interview_invited', 'awaiting').state, 'submitted');
  assert.equal(state('preparing', undefined, '2026-11-15T10:00:00Z').state, 'submitted'); assert.equal(state('preparing', undefined, '2026-11-15T10:00:00Z').submittedOn, '2026-11-15');
  assert.equal(state('admitted').state, 'closed'); assert.equal(state('submitted', 'rejected').state, 'closed'); assert.equal(state('withdrawn').state, 'closed');
});

test('expected result date: own column first, then decision_dates by round, missing data is fine', () => {
  const list = [{ round: 'Round 1', decision_date: '2026-12-10' }, { round: 'Round 2', decision_date: '2027-03-25' }];
  assert.equal(expectedResultOn({ round: 'R2' }, list), '2027-03-25');
  assert.equal(expectedResultOn({ round: 'round 1' }, list), '2026-12-10');
  assert.equal(expectedResultOn({ round: '2', expected_result_on: '2027-04-01' }, list), '2027-04-01');
  assert.equal(expectedResultOn({ round: null }, list), null, 'two rounds and no round on the application: do not guess');
  assert.equal(expectedResultOn({ round: null }, [{ decision_date: '2027-02-01T00:00:00Z' }]), '2027-02-01');
  assert.equal(expectedResultOn({ round: 'Early Decision' }, { 'early decision': '2026-12-15', regular: { decision_date: '2027-03-30' } }), '2026-12-15');
  assert.equal(expectedResultOn({ round: 'Regular' }, { 'early decision': '2026-12-15', regular: { decision_date: '2027-03-30' } }), '2027-03-30');
  for (const bad of [undefined, null, 'soon', 7, [], {}, [{ round: 'Round 2', decision_date: 'March' }], [null]]) assert.equal(expectedResultOn({ round: 'Round 2' }, bad), null);
  // End to end: a submitted application whose program lists tomorrow as decision day
  const r = rows({ applications: [{ id: 'a1', school_id: 's1', stage: 'submitted', round: 'Round 2', submission_confirmed_at: null, submitted_at: '2026-11-01T00:00:00Z', program_requirement_id: 'p1' }],
    decisionDates: { p1: [{ round: 'Round 2', decision_date: '2026-11-17' }] } });
  const d = decideReminder(buildReminderFacts(r, meta('Asia/Jakarta'), NOW));
  assert.ok(d.kind === 'result_soon' && d.when === 'tomorrow');
});

// ---------------------------------------------------------------------------------------------------------------
// Emails
const DECISIONS: Record<string, Decision> = {
  deadline_week: decideReminder(facts({ apps: [fApp({ deadlineOn: day(7) })] })),
  deadline_3: decideReminder(facts({ apps: [fApp({ deadlineOn: day(3), remaining: [open('Resume', 'resume')], ready: 8 })] })),
  deadline_1_all_ready: decideReminder(facts({ apps: [fApp({ deadlineOn: day(1), remaining: [], ready: 9 })] })),
  result_tomorrow: decideReminder(facts({ apps: [fApp({ state: 'submitted', resultOn: day(1) })] })),
  result_today: decideReminder(facts({ apps: [fApp({ state: 'submitted', resultOn: TODAY })] })),
  nudge: decideReminder(facts({ lastActiveOn: day(-3) })),
  nudge_no_apps: decideReminder(facts({ lastActiveOn: day(-3), apps: [] })),
  nudge_empty_list: decideReminder(facts({ lastActiveOn: day(-3), apps: [fApp({ total: 0, ready: 0, remaining: [], readyOn: [] })] })),
  nudge_final: decideReminder(facts({ lastActiveOn: day(-22) })),
  nudge_final_no_apps: decideReminder(facts({ lastActiveOn: day(-22), apps: [] })),
  first_item: decideReminder(facts({ lastActiveOn: day(-1), apps: [fApp({ ready: 1, readyOn: [day(-1)] })] })),
  half_way: decideReminder(facts({ lastActiveOn: day(-1), apps: [fApp({ ready: 5, readyOn: [day(-4), day(-4), day(-4), day(-4), day(-1)] })] })),
  all_ready: decideReminder(facts({ lastActiveOn: day(-1), apps: [fApp({ total: 3, ready: 3, remaining: [], readyOn: [day(-4), day(-1), day(-1)] })] })),
  submitted: decideReminder(facts({ lastActiveOn: day(-1), apps: [fApp({ state: 'submitted', submittedOn: day(-1) })] })),
};
const mail = (d: Decision, seed = 'x', name: string | null = 'Wenny') => composeReminder(d, { userId: UID, name, today: TODAY }, { ...OPTS, seed })!;

test('emails: every scenario produces the expected kind', () => {
  const kinds = Object.fromEntries(Object.entries(DECISIONS).map(([k, d]) => [k, d.logKind]));
  assert.deepEqual(kinds, { deadline_week: 'deadline_week', deadline_3: 'deadline_week', deadline_1_all_ready: 'deadline_week', result_tomorrow: 'result_soon', result_today: 'result_soon',
    nudge: 'nudge', nudge_no_apps: 'nudge', nudge_empty_list: 'nudge', nudge_final: 'nudge_final', nudge_final_no_apps: 'nudge_final', first_item: 'celebration', half_way: 'celebration', all_ready: 'celebration', submitted: 'celebration' });
  assert.equal(composeReminder(decideReminder(facts()), facts(), OPTS), null, 'nothing to send: no email');
});

test('deadline email: calm, lists at most 4 open items, links to /applications?a=<id>', () => {
  const e = mail(DECISIONS.deadline_week);
  assert.equal(e.kind, 'deadline_week');
  assert.match(e.text, /^Hi Wenny,/);
  assert.match(e.text, /a week/); assert.match(e.text, /Monday, November 23/);
  assert.match(e.text, /- Essay 1\n- Resume\n- Transcript\n- Test score\n  \(and 1 more on your checklist\)/);
  assert.ok(!e.text.includes('- Online form'));
  assert.match(e.text, /You already have 4 of 9 ready\./);
  assert.match(e.text, /Open my checklist: https:\/\/app\.example\.com\/applications\?a=a1/);
  assert.match(e.html, /href="https:\/\/app\.example\.com\/applications\?a=a1"/);
  assert.match(e.text, /Unsubscribe in one click: https:\/\/app\.example\.com\/api\/reminders\/unsubscribe/);
  assert.match(e.html, /unsubscribe in one click/); assert.ok(e.text.includes(PRODUCT_NAME)); assert.ok(e.html.includes(PRODUCT_NAME));
  const ready = mail(DECISIONS.deadline_1_all_ready);
  assert.match(ready.text, /one day/); assert.match(ready.text, /The only step left is to submit\./); assert.ok(!ready.text.includes('\n- '));
  assert.match(mail(DECISIONS.deadline_3).text, /three days/);
});

test('result, nudge, final and celebration emails say the right thing', () => {
  assert.match(mail(DECISIONS.result_tomorrow).text, /tomorrow/); assert.match(mail(DECISIONS.result_today).text, /today/i);
  for (let i = 0; i < 12; i++) assert.match(mail(DECISIONS.result_tomorrow, `s${i}`).text, /you did the work/i);
  const n = mail(DECISIONS.nudge, 'x', null);
  assert.match(n.text, /^Hi there,/); assert.match(n.text, /4 of 9 ready/); assert.match(n.text, /2 minutes/);
  assert.match(n.text, /> Open "Essay 1" and write one rough sentence\./); assert.match(n.text, /Do this one step: https:\/\/app\.example\.com\/applications\?a=a1/);
  assert.match(mail(DECISIONS.nudge_no_apps).text, /Add one school you are curious about/);
  const f = mail(DECISIONS.nudge_final);
  assert.match(f.text, /last email until you come back/); assert.match(f.text, /we will be here/i); assert.match(f.text, /We will not write again until you are back\./);
  assert.match(mail(DECISIONS.half_way).text, /half way mark for Harbor University \(5 of 9 ready\)/);
  assert.match(mail(DECISIONS.submitted).text, /submitted your Harbor University application/);
  assert.match(mail(DECISIONS.all_ready).text, /every item ready/); assert.match(mail(DECISIONS.first_item).text, /first item/);
});

test('copy: 4 to 6 subjects and openings per kind, chosen from the seed, stable for the same user and date', () => {
  for (const [kind, v] of Object.entries(TEMPLATES)) {
    assert.ok(v.subjects.length >= 4 && v.subjects.length <= 6, `${kind} subjects`);
    assert.ok(v.openings.length >= 4 && v.openings.length <= 6, `${kind} openings`);
  }
  for (const key of ['deadline_week', 'result_tomorrow', 'nudge', 'nudge_final', 'half_way']) {
    const d = DECISIONS[key], tpl = TEMPLATES[d.logKind!];
    const subjects = new Set<string>(), openings = new Set<string>();
    for (let i = 0; i < 200; i++) { const e = mail(d, `${UID}:day-${i}`); subjects.add(e.subject); openings.add(e.text.split('\n')[2]); }
    assert.equal(subjects.size, tpl.subjects.length, `${key}: every subject is used`);
    assert.equal(openings.size, tpl.openings.length, `${key}: every opening is used`);
    assert.deepEqual(mail(d, `${UID}:2026-11-16`), mail(d, `${UID}:2026-11-16`));
  }
  // Default seed is user id + local date
  const d = DECISIONS.nudge;
  assert.equal(composeReminder(d, { userId: UID, name: null, today: TODAY }, OPTS)!.subject, mail(d, `${UID}:${TODAY}`).subject);
});

test('email html is escaped', () => {
  const d = decideReminder(facts({ apps: [fApp({ label: 'A&B <School>', deadlineOn: day(7), remaining: [open('<b>Essay</b> "one"', 'essays')] })] }));
  const e = mail(d);
  assert.ok(e.html.includes('&lt;b&gt;Essay&lt;/b&gt; &quot;one&quot;')); assert.ok(!e.html.includes('<b>Essay</b>')); assert.ok(e.html.includes('A&amp;B &lt;School&gt;'));
});

// ---------------------------------------------------------------------------------------------------------------
// Tone lint: every template, every variant, every scenario. Emails must never sound like an alarm.
const BANNED = ['urgent', 'urgently', 'last chance', "don't miss", 'dont miss', 'do not miss', 'running out', 'run out', 'hurry', 'asap', 'act now', 'too late', 'final warning', 'warning',
  'immediately', 'panic', 'falling behind', 'behind schedule', 'final notice', 'time is ticking', 'deadline alert', 'overdue', 'actually'];
function lint(label: string, body: string) {
  const plain = body.replace(/&#39;/g, "'").replace(/https?:\/\/\S+/g, ' ');
  for (const w of BANNED) assert.ok(!new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i').test(plain), `${label}: contains "${w}"`);
  assert.ok(!/[‒-―]/.test(plain), `${label}: contains an em or en dash`);
  assert.ok(!plain.includes('!!'), `${label}: contains "!!"`);
  assert.ok(!/\b[A-Z]{3,}\b/.test(plain.replace(/<[^>]+>/g, ' ')), `${label}: contains a word in capitals`);
}
test('lint: no alarm words, no capitals, no long dashes, no "actually", at most one exclamation mark', () => {
  // 1. Every raw template with every shape of context
  const deadlineCtx = [7, 3, 1].flatMap((n) => [0, 1, 6].map((left) => ({ school: 'Harbor University', when: ({ 7: 'a week', 3: 'three days', 1: 'one day' } as Record<number, string>)[n], date: 'Monday, November 30', pace: 'Fine.', left })));
  const nudgeCtx = [{ school: 'Harbor University', progress: '4 of 9 ready' }, { school: 'Harbor University', progress: null }, { school: null, progress: null }];
  const ctx: Record<keyof typeof TEMPLATES, unknown[]> = {
    deadline_week: deadlineCtx, result_soon: [{ school: 'Harbor University', when: 'today' }, { school: 'Harbor University', when: 'tomorrow' }], nudge: nudgeCtx, nudge_final: nudgeCtx,
    celebration: [{ school: 'Harbor University', headline: 'your first item is done', done: 'finished your first item for Harbor University' }],
  };
  let checked = 0;
  for (const kind of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
    for (const c of ctx[kind]) for (const [part, list] of [['subject', TEMPLATES[kind].subjects], ['opening', TEMPLATES[kind].openings]] as const) {
      list.forEach((fn, i) => {
        const out = (fn as (c: unknown) => string)(c);
        lint(`${kind} ${part} ${i}`, out); checked++;
        assert.ok(out.trim().length > 10 && !/undefined|null|NaN/.test(out), `${kind} ${part} ${i}: "${out}"`);
        if (part === 'subject') { assert.ok(!out.includes('!'), `${kind} subject ${i}: no exclamation mark in subjects`); assert.ok(out.length <= 90, `${kind} subject ${i} is short`); }
      });
    }
  }
  assert.ok(checked >= 150);
  // 2. Every full email (subject, text, html) for every scenario and many seeds
  for (const [key, d] of Object.entries(DECISIONS)) {
    for (let i = 0; i < 60; i++) {
      const e = mail(d, `seed-${i}`, i % 2 ? 'Wenny' : null);
      for (const [part, body] of [['subject', e.subject], ['preheader', e.preheader], ['text', e.text], ['html', e.html]] as const) lint(`${key} ${part} (seed ${i})`, body);
      const marks = (`${e.subject}\n${e.text}`.match(/!/g) ?? []).length;
      assert.ok(marks <= 1, `${key} (seed ${i}): ${marks} exclamation marks`);
      assert.ok(!/undefined|\bnull\b|NaN/.test(`${e.subject}\n${e.text}`), `${key} (seed ${i}): leaked a missing value`);
    }
  }
  // 3. The lint itself catches what it should
  for (const bad of ['This is URGENT', 'Last chance to apply', "Don't miss it", 'Time is running out', 'Wow!!', 'One — two', 'It is actually fine', 'DO THIS NOW'])
    assert.throws(() => lint('self-check', bad), `lint should reject "${bad}"`);
});

test('unsubscribe HMAC: verifies, rejects tampering, wrong secret, bad ids', () => {
  const t = unsubscribeToken(UID, 'secret-1');
  assert.ok(verifyUnsubscribeToken(UID, t, 'secret-1'));
  assert.ok(verifyUnsubscribeToken(UID.toUpperCase(), t, 'secret-1'), 'case-insensitive user id');
  assert.ok(!verifyUnsubscribeToken(UID, t, 'secret-2'));
  assert.ok(!verifyUnsubscribeToken('22222222-2222-4222-8222-222222222222', t, 'secret-1'));
  assert.ok(!verifyUnsubscribeToken(UID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), 'secret-1'));
  assert.ok(!verifyUnsubscribeToken(UID, '', 'secret-1')); assert.ok(!verifyUnsubscribeToken(UID, t, ''));
  assert.ok(!verifyUnsubscribeToken('not-a-uuid', t, 'secret-1')); assert.ok(!verifyUnsubscribeToken(null, null, 'secret-1'));
  assert.throws(() => unsubscribeToken(UID, ''));
  const url = new URL(unsubscribeUrl('https://app.example.com', UID, 'secret-1'));
  assert.equal(url.pathname, '/api/reminders/unsubscribe');
  assert.ok(verifyUnsubscribeToken(url.searchParams.get('u'), url.searchParams.get('t'), 'secret-1'));
});

test('expectedResultOn reads the researched {rounds:[...]} shape', () => {
  const dd = { cycle: '2026-27', rounds: [{ round: 'Round 1', deadline: '2026-09-08', decision_date: '2026-12-10' }, { round: 'Round 2', deadline: '2027-01-06', decision_date: '2027-03-25' }], policy: 'fixed dates', source_url: 'https://example.edu' };
  assert.equal(expectedResultOn({ round: 'R2' }, dd), '2027-03-25');
  assert.equal(expectedResultOn({ round: 'Round 1' }, dd), '2026-12-10');
});
