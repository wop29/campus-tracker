// Runs the migrations in an in-memory Postgres (PGlite) and tests RLS + business rules as two users.
// Usage: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const db = new PGlite();
const results = [];
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

// Minimal stand-ins for the schemas Supabase provides
await db.exec(`
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  create role authenticated nologin;
`);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));
await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all tables in schema storage to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on function auth.uid() to authenticated;
  insert into auth.users values ('${A}','a@test.dev'),('${B}','b@test.dev');
`);

async function as(uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
async function test(name, fn) {
  try { await fn(); results.push([name, 'PASS']); } catch (e) { results.push([name, 'FAIL', e.message.split('\n')[0]]); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
async function rejects(promise, match) {
  try { await promise; } catch (e) { if (!match || new RegExp(match, 'i').test(e.message)) return; throw new Error('wrong error: ' + e.message); }
  throw new Error('expected rejection but it succeeded');
}

let schoolA, appA;
await test('signup trigger creates public.users row', async () => {
  const r = await db.query('select count(*)::int n from public.users'); ok(r.rows[0].n === 2, 'users rows: ' + r.rows[0].n);
});
await test('seed_my_schools creates 26 schools and is idempotent', async () => {
  const r1 = (await as(A, 'select public.seed_my_schools() n')).rows[0].n; const r2 = (await as(A, 'select public.seed_my_schools() n')).rows[0].n;
  ok(r1 === 26 && r2 === 0, `got ${r1} then ${r2}`);
});
await test('RLS: user B cannot see user A schools', async () => {
  const r = await as(B, 'select count(*)::int n from public.schools'); ok(r.rows[0].n === 0, 'B sees ' + r.rows[0].n);
});
await test('RLS: B cannot insert a row claiming A as owner', async () => {
  await rejects(as(B, `insert into public.schools(user_id,name) values ('${A}','Hack')`), 'row-level security');
});
await test('RLS: B cannot update or delete A rows (0 rows affected)', async () => {
  const u = await as(B, `update public.schools set name='x' where user_id='${A}'`); const d = await as(B, `delete from public.schools where user_id='${A}'`);
  ok(u.affectedRows === 0 && d.affectedRows === 0, 'affected ' + u.affectedRows + '/' + d.affectedRows);
});
schoolA = (await as(A, `select id from public.schools where short_name='Johnson'`)).rows[0].id;
await test('creating an application auto-creates 17 default requirements', async () => {
  const r = await as(A, `insert into public.applications(school_id, round) values ($1,'Round 1') returning id`, [schoolA]); appA = r.rows[0].id;
  const c = await as(A, 'select count(*)::int n, count(*) filter (where mandatory)::int m from public.application_requirements where application_id=$1', [appA]);
  ok(c.rows[0].n === 17, 'count ' + c.rows[0].n); ok(c.rows[0].m === 14, 'mandatory ' + c.rows[0].m);
});
await test('duplicate application (same school/program/intake/round) is rejected', async () => {
  await rejects(as(A, `insert into public.applications(school_id, round) values ($1,'Round 1')`, [schoolA]), 'duplicate|unique');
});
await test('cannot mark Ready while mandatory requirements are open', async () => {
  await rejects(as(A, `update public.applications set stage='ready' where id=$1`, [appA]), 'mandatory');
});
await test('cannot mark Submitted without explicit confirmation', async () => {
  await rejects(as(A, `update public.applications set stage='submitted' where id=$1`, [appA]), 'confirmed');
});
await test('can mark Ready after all mandatory requirements are complete', async () => {
  await as(A, `update public.application_requirements set status='complete' where application_id=$1 and mandatory`, [appA]);
  await as(A, `update public.applications set stage='ready' where id=$1`, [appA]);
  const r = await as(A, 'select stage from public.applications where id=$1', [appA]); ok(r.rows[0].stage === 'ready', r.rows[0].stage);
});
await test('requirement completed_at is set on completion and cleared on reopen', async () => {
  const r = await as(A, `select completed_at from public.application_requirements where application_id=$1 and name='Resume'`, [appA]); ok(r.rows[0].completed_at, 'no completed_at');
  await as(A, `update public.application_requirements set status='in_progress' where application_id=$1 and name='Resume'`, [appA]);
  const r2 = await as(A, `select completed_at from public.application_requirements where application_id=$1 and name='Resume'`, [appA]); ok(r2.rows[0].completed_at === null, 'not cleared');
  await as(A, `update public.application_requirements set status='complete' where application_id=$1 and name='Resume'`, [appA]);
});
await test('Submitted succeeds with confirmation and sets submitted_at', async () => {
  await as(A, `update public.applications set stage='submitted', submission_confirmed_at=now(), confirmation_number='ABC123' where id=$1`, [appA]);
  const r = await as(A, 'select submitted_at from public.applications where id=$1', [appA]); ok(r.rows[0].submitted_at, 'submitted_at missing');
});
let essayId;
await test('essay: each saved draft creates a new immutable version with word count', async () => {
  const e = await as(A, `insert into public.essays(application_id,title,draft,word_limit) values ($1,'Goals','one two three',500) returning id`, [appA]); essayId = e.rows[0].id;
  await as(A, `update public.essays set draft='one two three four five', change_notes='expanded' where id=$1`, [essayId]);
  await as(A, `update public.essays set status='revision' where id=$1`, [essayId]);   // no draft change: no new version
  const v = await as(A, 'select version_number, word_count, change_notes from public.essay_versions where essay_id=$1 order by 1', [essayId]);
  ok(v.rows.length === 2, 'versions ' + v.rows.length); ok(v.rows[0].word_count === 3 && v.rows[1].word_count === 5, JSON.stringify(v.rows)); ok(v.rows[1].change_notes === 'expanded', 'notes');
});
await test('essay versions cannot be edited', async () => {
  await rejects(as(A, `update public.essay_versions set text='tampered' where essay_id=$1`, [essayId]), 'immutable');
});
await test('deleting an application keeps the essay (reusable)', async () => {
  const app2 = (await as(A, `insert into public.applications(school_id, round) values ($1,'Round 2') returning id`, [schoolA])).rows[0].id;
  const e = (await as(A, `insert into public.essays(application_id,title) values ($1,'Reusable') returning id`, [app2])).rows[0].id;
  await as(A, 'delete from public.applications where id=$1', [app2]);
  const r = await as(A, 'select application_id from public.essays where id=$1', [e]); ok(r.rows.length === 1 && r.rows[0].application_id === null, 'essay lost or still linked');
});
await test('cross-user foreign key is blocked (B cannot attach data to A application)', async () => {
  await rejects(as(B, `insert into public.deadlines(application_id, due_at) values ($1, now())`, [appA]), 'another user|row-level|owned');
  await rejects(as(B, `insert into public.essays(application_id,title) values ($1,'x')`, [appA]), 'another user|owned');
});
await test('audit log records changes and users cannot write or read others logs', async () => {
  const l = await as(A, 'select count(*)::int n from public.activity_logs'); ok(l.rows[0].n > 5, 'logs ' + l.rows[0].n);
  const lb = await as(B, 'select count(*)::int n from public.activity_logs'); ok(lb.rows[0].n === 0, 'B sees logs');
  await rejects(as(A, `insert into public.activity_logs(user_id,table_name,action) values ('${A}','x','y')`), 'row-level security');
});
await test('input constraints: negative fee, bad stage, GPA above scale, end before start', async () => {
  await rejects(as(A, `update public.applications set application_fee=-5 where id=$1`, [appA]), 'check');
  await rejects(as(A, `update public.applications set stage='bogus' where id=$1`, [appA]), 'check');
  await rejects(as(A, `insert into public.education_records(institution,gpa,gpa_scale) values ('X',5,4)`), 'check');
  await rejects(as(A, `insert into public.work_experiences(company,position,start_date,end_date) values ('X','Y','2024-01-01','2023-01-01')`), 'check');
});
await test('school data points require a source (name and url)', async () => {
  await rejects(as(A, `insert into public.school_admissions_data(school_id,field,value_num,source_name) values ($1,'avg_gmat',700,'x')`, [schoolA]), 'null|source_url');
  await as(A, `insert into public.school_admissions_data(school_id,field,value_num,source_name,source_url) values ($1,'avg_gmat',700,'Official class profile','https://example.edu')`, [schoolA]);
});
await test('saved comparison limited to 2-5 schools', async () => {
  const ids = (await as(A, 'select id from public.schools limit 6')).rows.map((r) => r.id);
  await rejects(as(A, `insert into public.saved_comparisons(name,school_ids) values ('big',$1)`, [ids]), 'check');
  await as(A, `insert into public.saved_comparisons(name,school_ids) values ('ok',$1)`, [ids.slice(0, 3)]);
});
await test('storage policy: user can only write under own folder', async () => {
  await as(A, `insert into storage.objects(bucket_id,name) values ('documents','${A}/resume.pdf')`);
  await rejects(as(A, `insert into storage.objects(bucket_id,name) values ('documents','${B}/steal.pdf')`), 'row-level security');
  const r = await as(B, `select count(*)::int n from storage.objects`); ok(r.rows[0].n === 0, 'B can list A files');
});

await test('applications module: submission columns, decision upsert and scholarship_decision check', async () => {
  const r = await as(A, `insert into public.applications(school_id, round) values ($1,'Round 2') returning id`, [schoolA]); const id = r.rows[0].id;
  await as(A, `update public.applications set submission_confirmed_at=now(), confirmation_number='C-1', final_essay_versions='{"e":2}', submission_checklist='{"fee":true}', submission_notes='n', stage='submitted' where id=$1`, [id]);
  const g = await as(A, `select stage, submitted_at, final_essay_versions->>'e' v from public.applications where id=$1`, [id]); ok(g.rows[0].stage === 'submitted' && g.rows[0].submitted_at && g.rows[0].v === '2', 'submission columns');
  await as(A, `insert into public.admissions_decisions(application_id, decision) values ($1,'awaiting') on conflict (application_id) do update set decision=excluded.decision`, [id]);
  await as(A, `insert into public.admissions_decisions(application_id, decision) values ($1,'waitlisted') on conflict (application_id) do update set decision=excluded.decision, waitlist_contact='x'`, [id]);
  const d = await as(A, `select count(*)::int n, max(decision) dec, max(waitlist_contact) c from public.admissions_decisions where application_id=$1`, [id]); ok(d.rows[0].n === 1 && d.rows[0].dec === 'waitlisted' && d.rows[0].c === 'x', 'one decision row');
  await rejects(as(A, `update public.admissions_decisions set scholarship_decision='bogus' where application_id=$1`, [id]), 'check');
  await as(A, `update public.applications set stage='waitlisted' where id=$1`, [id]);
});

await test('BUG-001: cannot create an application directly in Ready or Submitted stage (guard must also run on INSERT)', async () => {
  await rejects(as(A, `insert into public.applications(school_id, round, stage) values ($1,'Round 9','ready')`, [schoolA]), 'mandatory|ready');
  await rejects(as(A, `insert into public.applications(school_id, round, stage) values ($1,'Round 8','submitted')`, [schoolA]), 'confirmed');
});

// ---- Gamification (018) ----
const xpBase = {};
const xpRaw = async (uid, kind) => (await as(uid, `select count(*)::int n, coalesce(sum(points),0)::int p from public.xp_events where kind=$1`, [kind])).rows[0];
for (const k of ['requirement_complete','task_done','essay_first_version','essay_version','essay_approved','story_created','profile_education','profile_work','profile_test','career_goals_filled','sourced_data_point','recommender_added','recommendation_submitted','interview_completed','interview_feedback','scholarship_applied','expense_paid','decision_admitted','application_submitted']) xpBase[k] = await xpRaw(A, k);
/** XP earned for a kind since the start of the gamification tests (earlier tests already generated some real events). */
const xpOf = async (uid, kind) => { const r = await xpRaw(uid, kind), b = xpBase[kind] ?? { n: 0, p: 0 }; return { n: r.n - b.n, p: r.p - b.p }; };
let gApp, gReq;
await test('XP: completing a mandatory requirement awards +15 once; reopen and re-complete awards nothing more', async () => {
  gApp = (await as(A, `insert into public.applications(school_id, round) values ($1,'XP round') returning id`, [schoolA])).rows[0].id;
  gReq = (await as(A, `select id from public.application_requirements where application_id=$1 and mandatory order by sort_order limit 1`, [gApp])).rows[0].id;
  ok((await xpOf(A, 'requirement_complete')).n === 0, 'XP before completion');
  await as(A, `update public.application_requirements set status='complete' where id=$1`, [gReq]);
  let r = await xpOf(A, 'requirement_complete'); ok(r.n === 1 && r.p === 15, `after complete ${r.n}/${r.p}`);
  await as(A, `update public.application_requirements set status='in_progress' where id=$1`, [gReq]);
  await as(A, `update public.application_requirements set status='complete' where id=$1`, [gReq]);
  await as(A, `update public.application_requirements set notes='edited' where id=$1`, [gReq]);
  r = await xpOf(A, 'requirement_complete'); ok(r.n === 1 && r.p === 15, `after reopen ${r.n}/${r.p}`);
});
await test('XP: optional requirement is +10; waived and soft-deleted applications earn nothing', async () => {
  const opt = (await as(A, `select id from public.application_requirements where application_id=$1 and not mandatory limit 1`, [gApp])).rows[0].id;
  await as(A, `update public.application_requirements set status='complete' where id=$1`, [opt]);
  const o = (await as(A, `select points from public.xp_events where source_id=$1`, [opt])).rows; ok(o.length === 1 && o[0].points === 10, 'optional points ' + JSON.stringify(o));
  const w = (await as(A, `select id from public.application_requirements where application_id=$1 and mandatory and status='not_started' limit 1`, [gApp])).rows[0].id;
  await as(A, `update public.application_requirements set status='waived' where id=$1`, [w]);
  ok((await as(A, `select count(*)::int n from public.xp_events where source_id=$1`, [w])).rows[0].n === 0, 'waived earned XP');
  const dead = (await as(A, `insert into public.applications(school_id, round) values ($1,'Dead') returning id`, [schoolA])).rows[0].id;
  await as(A, `update public.applications set deleted_at=now() where id=$1`, [dead]);
  const dr = (await as(A, `select id from public.application_requirements where application_id=$1 limit 1`, [dead])).rows[0].id;
  await as(A, `update public.application_requirements set status='complete' where id=$1`, [dr]);
  ok((await as(A, `select count(*)::int n from public.xp_events where source_id=$1`, [dr])).rows[0].n === 0, 'soft-deleted app requirement earned XP');
});
await test('XP: task done +10 once', async () => {
  const t = (await as(A, `insert into public.application_tasks(application_id,title) values ($1,'t') returning id`, [gApp])).rows[0].id;
  ok((await xpOf(A, 'task_done')).n === 0, 'earned on create');
  await as(A, `update public.application_tasks set status='done' where id=$1`, [t]);
  await as(A, `update public.application_tasks set status='todo' where id=$1`, [t]);
  await as(A, `update public.application_tasks set status='done' where id=$1`, [t]);
  const r = await xpOf(A, 'task_done'); ok(r.n === 1 && r.p === 10, `${r.n}/${r.p}`);
});
await test('XP: essay first version +10 (empty draft earns nothing), later versions +3 each, approved +20 once', async () => {
  const e = (await as(A, `insert into public.essays(application_id,title,draft) values ($1,'XP essay','')`, [gApp]).then(() => as(A, `select id from public.essays where title='XP essay'`))).rows[0].id;
  ok((await xpOf(A, 'essay_first_version')).n === 0, 'empty draft earned XP');
  await as(A, `update public.essays set draft='one two three' where id=$1`, [e]);
  await as(A, `update public.essays set draft='one two three four' where id=$1`, [e]);
  await as(A, `update public.essays set draft='one two three four five' where id=$1`, [e]);
  const f = await xpOf(A, 'essay_first_version'), v = await xpOf(A, 'essay_version');
  ok(f.n === 1 && f.p === 10, `first ${f.n}/${f.p}`); ok(v.n === 2 && v.p === 6, `later ${v.n}/${v.p}`);
  await as(A, `update public.essays set status='approved' where id=$1`, [e]);
  await as(A, `update public.essays set status='revision' where id=$1`, [e]);
  await as(A, `update public.essays set status='approved' where id=$1`, [e]);
  const a = await xpOf(A, 'essay_approved'); ok(a.n === 1 && a.p === 20, `approved ${a.n}/${a.p}`);
});
await test('XP: story +10, profile rows +5, career goals +15 only when filled and only once, sourced data +5', async () => {
  await as(A, `insert into public.story_bank(title,category) values ('s','leadership')`);
  await as(A, `insert into public.education_records(institution) values ('Uni')`);
  await as(A, `insert into public.work_experiences(company,position) values ('Co','Analyst')`);
  await as(A, `insert into public.test_scores(test_type,overall) values ('GMAT',700)`);
  ok((await xpOf(A, 'story_created')).p === 10 && (await xpOf(A, 'profile_education')).p === 5 && (await xpOf(A, 'profile_work')).p === 5 && (await xpOf(A, 'profile_test')).p === 5, 'row XP');
  const g = (await as(A, `insert into public.career_goals(why_mba) values ('because') returning id`)).rows[0].id;
  ok((await xpOf(A, 'career_goals_filled')).n === 0, 'partial goals earned XP');
  await as(A, `update public.career_goals set short_term_goal='s', long_term_goal='l' where id=$1`, [g]);
  await as(A, `update public.career_goals set long_term_goal='l2' where id=$1`, [g]);
  const c = await xpOf(A, 'career_goals_filled'); ok(c.n === 1 && c.p === 15, `goals ${c.n}/${c.p}`);
  await as(A, `insert into public.school_admissions_data(school_id,field,value_num,source_name,source_url) values ($1,'gmat_avg',700,'Class profile','https://example.edu/p')`, [schoolA]);
  ok((await xpOf(A, 'sourced_data_point')).p === 5, 'sourced data XP');
});
await test('XP: recommender +5, recommendation submitted +25 once, interview completed +20, feedback +5, scholarship applied +30, expense paid +5, admitted +200', async () => {
  const rc = (await as(A, `insert into public.recommenders(name) values ('Boss') returning id`)).rows[0].id;
  const rec = (await as(A, `insert into public.recommendations(recommender_id,application_id) values ($1,$2) returning id`, [rc, gApp])).rows[0].id;
  await as(A, `update public.recommendations set status='submitted' where id=$1`, [rec]);
  await as(A, `update public.recommendations set status='in_progress' where id=$1`, [rec]);
  await as(A, `update public.recommendations set status='submitted' where id=$1`, [rec]);
  const iv = (await as(A, `insert into public.interview_sessions(application_id) values ($1) returning id`, [gApp])).rows[0].id;
  await as(A, `update public.interview_sessions set status='completed' where id=$1`, [iv]);
  const q = (await as(A, `insert into public.interview_questions(session_id,category,question) values ($1,'x','why') returning id`, [iv])).rows[0].id;
  await as(A, `insert into public.interview_feedback(question_id,feedback) values ($1,'ok')`, [q]);
  const sc = (await as(A, `insert into public.scholarships(name) values ('S') returning id`)).rows[0].id;
  await as(A, `update public.scholarships set status='applied' where id=$1`, [sc]);
  const ex = (await as(A, `insert into public.expenses(category,estimated_cost) values ('test_fee',100) returning id`)).rows[0].id;
  await as(A, `update public.expenses set payment_status='paid' where id=$1`, [ex]);
  await as(A, `insert into public.admissions_decisions(application_id, decision) values ($1,'admitted') on conflict (application_id) do update set decision=excluded.decision`, [gApp]);
  const exp = { recommender_added: 5, recommendation_submitted: 25, interview_completed: 20, interview_feedback: 5, scholarship_applied: 30, expense_paid: 5, decision_admitted: 200 };
  for (const [k, p] of Object.entries(exp)) { const r = await xpOf(A, k); ok(r.n === 1 && r.p === p, `${k} ${r.n}/${r.p}`); }
});
await test('XP: submitting an application awards +100 exactly once', async () => {
  const id = (await as(A, `insert into public.applications(school_id, round) values ($1,'Submit XP') returning id`, [schoolA])).rows[0].id;
  ok((await xpOf(A, 'application_submitted')).n === 0, 'earned before submit');
  await as(A, `update public.applications set submission_confirmed_at=now(), stage='submitted' where id=$1`, [id]);
  await as(A, `update public.applications set stage='preparing' where id=$1`, [id]);
  await as(A, `update public.applications set stage='submitted' where id=$1`, [id]);
  const r = await xpOf(A, 'application_submitted'); ok(r.n === 1 && r.p === 100, `${r.n}/${r.p}`);
});
await test('XP: per-day cap stops bulk creation farming (story_created max 10 per day)', async () => {
  for (let i = 0; i < 14; i++) await as(A, `insert into public.story_bank(title,category) values ('bulk ${i}','teamwork')`);
  const r = await xpOf(A, 'story_created'); ok(r.n === 10, `stories earned ${r.n} events`);
});
await test('XP: user cannot insert, update or delete xp_events directly', async () => {
  await rejects(as(A, `insert into public.xp_events(kind,points,source_id) values ('fake',9999,gen_random_uuid())`), 'row-level security');
  await rejects(as(A, `insert into public.xp_events(user_id,kind,points,source_id) values ('${B}','fake',9999,gen_random_uuid())`), 'row-level security');
  const before = (await as(A, `select coalesce(sum(points),0)::int s from public.xp_events`)).rows[0].s;
  const u = await as(A, `update public.xp_events set points=99999`); const d = await as(A, `delete from public.xp_events`);
  ok(u.affectedRows === 0 && d.affectedRows === 0, `affected ${u.affectedRows}/${d.affectedRows}`);
  ok((await as(A, `select coalesce(sum(points),0)::int s from public.xp_events`)).rows[0].s === before, 'total changed');
});
await test('XP: award_xp cannot be called directly (not via rpc)', async () => {
  await rejects(as(A, `select public.award_xp('${A}','fake',500,'x',gen_random_uuid())`), 'trigger|permission');
});
await test('XP: user B cannot see user A events and starts at zero', async () => {
  const b = await as(B, `select count(*)::int n from public.xp_events`); ok(b.rows[0].n === 0, 'B sees ' + b.rows[0].n);
  const a = await as(A, `select count(*)::int n from public.xp_events`); ok(a.rows[0].n > 5, 'A has events');
});
await test('XP: update_gamification_settings merges without clobbering other settings, validates and never lowers last_seen_xp', async () => {
  await as(B, `insert into public.applicant_profiles(settings) values ('{"base_currency":"EUR","gamification":{"other":1}}')`);
  const r1 = (await as(B, `select public.update_gamification_settings('{"daily_goal_xp":50,"last_seen_xp":120}') r`)).rows[0].r; ok(r1.daily_goal_xp === 50 && r1.other === 1, 'merge ' + JSON.stringify(r1));
  const r2 = (await as(B, `select public.update_gamification_settings('{"last_seen_xp":40}') r`)).rows[0].r; ok(r2.last_seen_xp === 120 && r2.daily_goal_xp === 50, 'monotonic ' + JSON.stringify(r2));
  ok((await as(B, `select settings->>'base_currency' c from public.applicant_profiles`)).rows[0].c === 'EUR', 'clobbered other keys');
  await rejects(as(B, `select public.update_gamification_settings('{"daily_goal_xp":5}')`), 'daily_goal_xp');
  await rejects(as(B, `select public.update_gamification_settings('{"daily_goal_xp":500}')`), 'daily_goal_xp');
  await rejects(as(B, `select public.update_gamification_settings('{"daily_goal_xp":"30"}')`), 'daily_goal_xp');
  const C = '33333333-3333-3333-3333-333333333333';
  await db.exec(`insert into auth.users values ('${C}','c@test.dev'); `);
  const r3 = (await as(C, `select public.update_gamification_settings('{"last_seen_level":2}') r`)).rows[0].r; ok(r3.last_seen_level === 2, 'upsert missing profile');
});

await test('021: program_requirements readable by signed-in users, not writable', async () => {
  await db.query(`insert into public.program_requirements(school_name, program_name, degree_type, data, class_profile) values ('Cornell Johnson','Test MBA','mba','{"essays":{"items":[]}}','{"gmat_median":700}')`);
  const r = await as(B, `select count(*)::int n, max(collected_on)::text d, max((class_profile->>'gmat_median')::int) g from public.program_requirements where program_name='Test MBA'`);
  ok(r.rows[0].n === 1 && r.rows[0].d === '2026-11-16' && r.rows[0].g === 700, JSON.stringify(r.rows[0]));
  await rejects(as(A, `insert into public.program_requirements(school_name, program_name, data) values ('x','y','{}')`), 'row-level security');
  const u = await as(A, `update public.program_requirements set program_name='hacked'`); const d = await as(A, `delete from public.program_requirements`);
  ok(u.affectedRows === 0 && d.affectedRows === 0, `affected ${u.affectedRows}/${d.affectedRows}`);
});
await test('021: starting from a program replaces only that application\'s default requirements; Ready guard still applies', async () => {
  const pid = (await db.query(`select id from public.program_requirements where program_name='Test MBA'`)).rows[0].id;
  const other = (await as(A, `select count(*)::int n from public.application_requirements where application_id=$1`, [appA])).rows[0].n;
  const app = (await as(A, `insert into public.applications(school_id, program, intake, program_requirement_id) values ($1,'Test MBA','Fall 2027',$2) returning id`, [schoolA, pid])).rows[0].id;
  const e = (await as(A, `insert into public.essays(application_id, school_id, title, prompt, word_limit) values ($1,$2,'Essay 1: Why us?','Why us?',300) returning id`, [app, schoolA])).rows[0].id;
  await as(A, `delete from public.application_requirements where application_id=$1 and is_default`, [app]);
  await as(A, `insert into public.application_requirements(application_id,name,category,mandatory,notes,sort_order,is_default,essay_id) values
    ($1,'GMAT/GRE','tests',true,'GMAT or GRE required',1,false,null),($1,'Essay 1: Why us?','essays',true,'Why us? Limit: 300 words',2,false,$2),
    ($1,'Interview','other',false,'By invitation',3,false,null),($1,'Submission confirmation','other',true,'',4,true,null)`, [app, e]);
  const c = await as(A, `select count(*)::int n, count(*) filter (where is_default)::int d from public.application_requirements where application_id=$1`, [app]);
  ok(c.rows[0].n === 4 && c.rows[0].d === 1, JSON.stringify(c.rows[0]));
  ok((await as(A, `select count(*)::int n from public.application_requirements where application_id=$1`, [appA])).rows[0].n === other, 'other application touched');
  await rejects(as(A, `update public.applications set stage='ready' where id=$1`, [app]), 'mandatory');
  await as(A, `update public.application_requirements set status='complete' where application_id=$1 and mandatory and name <> 'Submission confirmation'`, [app]);
  await as(A, `update public.applications set stage='ready' where id=$1`, [app]);
  await rejects(as(B, `insert into public.application_requirements(application_id,name) values ($1,'x')`, [app]), 'another user|row-level|owned');
  await db.query(`delete from public.program_requirements where id=$1`, [pid]);
  ok((await as(A, `select program_requirement_id from public.applications where id=$1`, [app])).rows[0].program_requirement_id === null, 'not set null');
});
await test('023: owner can submit straight from preparing with open mandatory items; confirmation still required; RLS kept', async () => {
  const app = (await as(A, `insert into public.applications(school_id, program, intake, round, stage) values ($1,'Simple MBA','Fall 2027','Round 2','preparing') returning id`, [schoolA])).rows[0].id;
  const open = (await as(A, `select count(*)::int n from public.application_requirements where application_id=$1 and mandatory and status not in ('complete','waived')`, [app])).rows[0].n;
  ok(open > 0, 'expected open mandatory requirements');
  await rejects(as(A, `update public.applications set stage='submitted' where id=$1`, [app]), 'confirmed');
  const b = await as(B, `update public.applications set stage='submitted', submission_confirmed_at=now(), submitted_at=date '2026-11-23' where id=$1`, [app]);
  ok(b.affectedRows === 0, 'another user could submit it');
  await as(A, `update public.applications set stage='submitted', submission_confirmed_at=now(), submitted_at=date '2026-11-23' where id=$1`, [app]);
  const g = (await as(A, `select stage, submitted_at::text d from public.applications where id=$1`, [app])).rows[0];
  ok(g.stage === 'submitted' && g.d === '2026-11-23', JSON.stringify(g));
  // outcome buttons: interview invite, then a final result, and back to preparing if it was a mistake
  await as(A, `insert into public.admissions_decisions(application_id, decision) values ($1,'awaiting') on conflict (application_id) do nothing`, [app]);
  await as(A, `update public.applications set stage='interview_invited' where id=$1`, [app]);
  await as(A, `update public.applications set stage='admitted' where id=$1`, [app]);
  await as(A, `update public.applications set stage='submitted' where id=$1`, [app]);
  await as(A, `update public.applications set stage='preparing', submission_confirmed_at=null, submitted_at=null where id=$1`, [app]);
  await as(A, `delete from public.admissions_decisions where application_id=$1`, [app]);
  ok((await as(A, `select stage from public.applications where id=$1`, [app])).rows[0].stage === 'preparing', 'undo submit');
});
await test('023: decision_dates on programs (read only), expected_result_on and result_round on applications; migration is idempotent', async () => {
  await db.exec(readFileSync(path.join(dir, '023_submit_simple.sql'), 'utf8'));
  await db.query(`insert into public.program_requirements(school_name, program_name, degree_type, data, decision_dates) values ('Duke Fuqua','Dates MBA','mba','{}',
    '{"cycle":"2026-2027","rounds":[{"round":"Round 2","deadline":"2027-01-06","decision_date":"2027-03-18","decision_text":null}],"policy":"Fixed dates","source_url":"https://example.edu/dates"}')`);
  const pid = (await db.query(`select id from public.program_requirements where program_name='Dates MBA'`)).rows[0].id;
  const r = (await as(B, `select decision_dates->'rounds'->0->>'decision_date' d from public.program_requirements where id=$1`, [pid])).rows[0];
  ok(r.d === '2027-03-18', JSON.stringify(r));
  const u = await as(A, `update public.program_requirements set decision_dates='{}' where id=$1`, [pid]); ok(u.affectedRows === 0, 'user could edit decision dates');
  const app = (await as(A, `insert into public.applications(school_id, program, intake, program_requirement_id) values ($1,'Dates MBA','Fall 2027',$2) returning id, expected_result_on, result_round`, [schoolA, pid])).rows[0];
  ok(app.expected_result_on === null && app.result_round === null, 'new columns should start empty');
  await as(A, `update public.applications set expected_result_on=date '2027-03-20', result_round='Round 2' where id=$1`, [app.id]);
  const g = (await as(A, `select expected_result_on::text d, result_round r from public.applications where id=$1`, [app.id])).rows[0];
  ok(g.d === '2027-03-20' && g.r === 'Round 2', JSON.stringify(g));
  const b = await as(B, `update public.applications set expected_result_on=date '2027-01-01' where id=$1`, [app.id]); ok(b.affectedRows === 0, 'another user could set the date');
  await db.query(`delete from public.program_requirements where id=$1`, [pid]);
});


console.table(results.map(([n, s, e]) => ({ test: n, result: s, detail: e || '' })));
const failed = results.filter((r) => r[1] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
