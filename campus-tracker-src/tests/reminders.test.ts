import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readReminderPrefs, isReminderDue, localParts, withReminderPatch, buildReminderSnapshot, composeReminderEmail, pickSubject, hrefForRecommendation, daysLeft, dueInText,
  type ReminderSnapshot, type SnapshotInput,
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

const empty: SnapshotInput = { schools: [], applications: [], deadlines: [], requirements: [], tasks: [], recommendations: [], recommenders: [], essays: [], expenses: [], interviews: [], testScores: [{ id: 't', test_type: 'GMAT' }], work: [{ id: 'w', company: 'Acme', position: 'Analyst', measurable_impact: 'Grew revenue 20%' }], assessments: [] };

test('snapshot: empty account points to building a school list', () => {
  const s = buildReminderSnapshot(empty, NOW);
  assert.equal(s.action.href, '/schools'); assert.deepEqual(s.deadlines, []); assert.equal(s.streak, 0);
});

test('snapshot: real data picks the top action, links deep, lists up to 2 upcoming deadlines', () => {
  const app = (id: string, school: string) => ({ id, school_id: school, program: 'MBA', intake: 'Fall 2027', round: 'R2', priority: 1, application_fee: null, fee_currency: 'USD', stage: 'preparing', submission_confirmed_at: null, submitted_at: null, created_at: '2026-10-01T00:00:00Z' });
  const dl = (id: string, appId: string, due: string) => ({ id, application_id: appId, name: 'Round 2', due_at: due, timezone: 'UTC', kind: 'submission', is_primary: true });
  const input: SnapshotInput = {
    ...empty,
    schools: [{ id: 's1', name: 'Columbia Business School', short_name: 'CBS', country: 'US', location: null, tier: null, in_portfolio: true, priority: 1 },
      { id: 's2', name: 'INSEAD', short_name: null, country: 'FR', location: null, tier: null, in_portfolio: true, priority: 1 },
      { id: 's3', name: 'Wharton', short_name: null, country: 'US', location: null, tier: null, in_portfolio: true, priority: 1 }],
    applications: [app('a1', 's1'), app('a2', 's2'), app('a3', 's3')],
    deadlines: [dl('d1', 'a1', '2026-11-20T12:00:00Z'), dl('d2', 'a2', '2026-12-10T12:00:00Z'), dl('d3', 'a3', '2027-01-05T12:00:00Z'), dl('d0', 'a3', '2026-11-01T00:00:00Z')],
    requirements: [{ id: 'r1', application_id: 'a1', name: 'Resume', category: 'documents', status: 'not_started', mandatory: true, due_date: null, essay_id: null, recommendation_id: null }],
    recommendations: [{ id: 'x', recommender_id: 'p', application_id: 'a1', status: 'requested', deadline: null, submitted_at: '2026-11-01T00:00:00Z' },
      { id: 'y', recommender_id: 'p', application_id: 'a2', status: 'submitted', deadline: null, submitted_at: '2026-11-01T00:00:00Z' },
      { id: 'z', recommender_id: 'p', application_id: 'a3', status: 'submitted', deadline: null, submitted_at: '2026-11-01T00:00:00Z' }],
    tasks: [{ id: 't1', application_id: null, title: 'Call alum', status: 'todo', due_date: null, estimated_minutes: 20, priority: 1, completed_at: null, created_at: '2026-11-01T00:00:00Z', source: 'manual' }],
    name: 'Wenny', streak: 4, activeToday: false,
  };
  const s = buildReminderSnapshot(input, NOW);
  assert.equal(s.action.title, 'Finish 1 mandatory item for CBS');
  assert.equal(s.action.href, '/applications/a1');
  assert.deepEqual(s.deadlines.map((d) => [d.label, d.daysLeft]), [['CBS Round 2', 4], ['INSEAD Round 2', 24]]);
  assert.equal(s.intake, 'Fall 2027'); assert.equal(s.openTasks, 1);

  const e = composeReminderEmail(s, { appUrl: 'https://app.example.com/', unsubscribeUrl: 'https://app.example.com/api/reminders/unsubscribe?u=1&t=2', seed: 'x' });
  assert.equal(e.subject, 'Keep your 4 day streak going today');
  assert.match(e.text, /^Hi Wenny,/);
  assert.match(e.text, /https:\/\/app\.example\.com\/applications\/a1/);
  assert.match(e.text, /CBS Round 2: 4 days left/);
  assert.match(e.text, /4 day streak/);
  assert.match(e.text, /Unsubscribe in one click: https:\/\/app\.example\.com\/api\/reminders\/unsubscribe/);
  assert.match(e.html, /href="https:\/\/app\.example\.com\/applications\/a1"/);
  assert.match(e.html, /unsubscribe/);
  for (const body of [e.subject, e.text, e.html]) {
    assert.ok(!body.includes('—') && !body.includes('–'), 'no em or en dashes');
    assert.ok(!/\bactually\b/i.test(body), 'no "actually"');
  }
});

const snap = (over: Partial<ReminderSnapshot> = {}): ReminderSnapshot => ({ name: null, intake: null, action: { title: 'Start the essay "Why MBA"', href: '/essays', minutes: 90, why: null }, deadlines: [], openTasks: 0, streak: 0, activeToday: false, ...over });

test('subject: deadline soon beats generic, generic varies by seed and is stable', () => {
  assert.equal(pickSubject(snap({ deadlines: [{ label: 'CBS Round 2', dueAt: '', daysLeft: 1 }] })), 'CBS Round 2: 1 day left');
  assert.equal(pickSubject(snap({ deadlines: [{ label: 'CBS Round 2', dueAt: '', daysLeft: 5 }] })), 'CBS Round 2 is in 5 days. One small step today?');
  const a = pickSubject(snap({ intake: 'Fall 2027' }), 'u:2026-11-16');
  assert.equal(a, pickSubject(snap({ intake: 'Fall 2027' }), 'u:2026-11-16'));
  const all = new Set(Array.from({ length: 40 }, (_, i) => pickSubject(snap({ intake: 'Fall 2027' }), `u:${i}`)));
  assert.ok(all.size >= 3, 'subjects vary');
  assert.ok(all.has('2 minutes today keeps your Fall 2027 plan on track'));
  // A streak that is already safe today does not get the streak subject
  assert.notEqual(pickSubject(snap({ streak: 3, activeToday: true }), 's'), 'Keep your 3 day streak going today');
});

test('email: no streak line at zero, html is escaped, no deadlines section when none', () => {
  const e = composeReminderEmail(snap({ action: { title: '<b>Cut</b> "Essay" & more', href: '/essays', minutes: 30, why: null } }), { appUrl: 'https://x.dev', unsubscribeUrl: 'https://x.dev/u' });
  assert.ok(!/streak/i.test(e.text)); assert.ok(!e.text.includes('Coming up'));
  assert.ok(e.html.includes('&lt;b&gt;Cut&lt;/b&gt; &quot;Essay&quot; &amp; more')); assert.ok(!e.html.includes('<b>Cut</b>'));
  assert.match(e.text, /about 30 minutes/);
});

test('helpers: hrefs, days left, due text', () => {
  assert.equal(hrefForRecommendation({ source: 'rules: essay_not_started', application_id: 'a' }), '/essays');
  assert.equal(hrefForRecommendation({ source: 'rules: recommender_pending', application_id: 'a' }), '/recommendations');
  assert.equal(hrefForRecommendation({ source: 'rules: fee_unpaid', application_id: 'a' }), '/applications/a');
  assert.equal(hrefForRecommendation({ source: 'rules: overdue_task', application_id: null }), '/applications');
  assert.equal(hrefForRecommendation({ source: 'rules: profile_missing_test', application_id: null }), '/profile');
  assert.equal(hrefForRecommendation({ source: 'rules: interview_no_mock', application_id: null }), '/interview');
  assert.equal(daysLeft('2026-11-16T20:00:00Z', NOW), 0); assert.equal(daysLeft('2026-11-17T12:00:00Z', NOW), 1); assert.equal(daysLeft('2026-11-16T12:00:00Z', NOW), 0); assert.equal(daysLeft('2026-11-15T12:00:00Z', NOW), -1);
  assert.equal(dueInText(0), 'due within 24 hours'); assert.equal(dueInText(1), '1 day left'); assert.equal(dueInText(9), '9 days left');
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
