// Backup -> restore round trip across two separate PGlite databases (real migrations, RLS as a user).
// Usage: npm run test:import   (needs Node 22.18+ or 23+, which runs the .ts imports natively)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const { buildBackup, BACKUP_TABLES } = await import(path.join(root, 'lib', 'backup.ts'));
const { parseBackup, runImport, IMPORT_ORDER } = await import(path.join(root, 'lib', 'import.ts'));

const A = '11111111-1111-1111-1111-111111111111';   // owner in the source project
const N = '33333333-3333-3333-3333-333333333333';   // new owner in the destination project
const M = '44444444-4444-4444-4444-444444444444';   // bystander in the destination project

async function makeDb(users) {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create role authenticated nologin; create role anon nologin;
  `);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));
  await db.exec(`
    grant usage on schema public, auth, storage to authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all tables in schema storage to authenticated;
    grant execute on all functions in schema public to authenticated;
    grant execute on function auth.uid() to authenticated;
    ${users.map((u) => `insert into auth.users values ('${u}','${u.slice(0, 2)}@test.dev');`).join('\n')}
  `);
  return db;
}
const as = async (db, uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
};
const results = [];
async function test(name, fn) { try { await fn(); results.push([name, 'PASS']); } catch (e) { results.push([name, 'FAIL', e.message.split('\n')[0]]); } }
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---------- source project: one realistic user ----------
const src = await makeDb([A]);
const q = async (sql, p) => (await as(src, A, sql, p)).rows;
await q('select public.seed_my_schools()');
const johnson = (await q(`select id from public.schools where short_name='Johnson'`))[0].id;
const booth = (await q(`select id from public.schools where short_name='Booth'`))[0].id;
await q(`update public.schools set notes='Visited campus' where id=$1`, [johnson]).catch(() => {});
await q(`insert into public.applicant_profiles(full_name, settings) values ('Test Applicant','{"baseCurrency":"IDR"}')`);
const app1 = (await q(`insert into public.applications(school_id, round) values ($1,'Round 1') returning id`, [johnson]))[0].id;      // will be Ready
const app2 = (await q(`insert into public.applications(school_id, round) values ($1,'Round 1') returning id`, [booth]))[0].id;         // essays, recs
await q(`update public.application_requirements set status='complete' where application_id=$1 and mandatory`, [app1]);
await q(`update public.applications set stage='ready' where id=$1`, [app1]);
const essay1 = (await q(`insert into public.essays(application_id,school_id,title,draft,word_limit) values ($1,$2,'Goals','one two three',500) returning id`, [app2, booth]))[0].id;
await q(`update public.essays set draft='one two three four', change_notes='expanded' where id=$1`, [essay1]);
await q(`update public.essays set draft='one two three four five', change_notes='final' where id=$1`, [essay1]);
const essay2 = (await q(`insert into public.essays(application_id,title,draft,duplicated_from) values ($1,'Goals copy','copy text',$2) returning id`, [app2, essay1]))[0].id;
const story = (await q(`insert into public.story_bank(title,category) values ('Led a turnaround','leadership') returning id`))[0].id;
await q(`insert into public.essay_stories(essay_id, story_id) values ($1,$2)`, [essay1, story]);
const recr = (await q(`insert into public.recommenders(name,position) values ('Pat Manager','Director') returning id`))[0].id;
const rec = (await q(`insert into public.recommendations(recommender_id, application_id, status) values ($1,$2,'agreed') returning id`, [recr, app2]))[0].id;
await q(`update public.application_requirements set essay_id=$1, status='in_progress' where application_id=$2 and name='Essay 1'`, [essay1, app2]);
await q(`update public.application_requirements set recommendation_id=$1 where application_id=$2 and name='Recommendation 1'`, [rec, app2]);
await q(`insert into public.expenses(category, description, estimated_cost, currency) values ('test_fee','GMAT',275,'USD'),('application_fee','Booth fee',250,'USD')`);
await q(`insert into public.admissions_decisions(application_id, decision) values ($1,'awaiting')`, [app1]);
await q(`insert into public.deadlines(application_id, due_at) values ($1, now() + interval '30 days')`, [app2]);
const doc = (await q(`insert into public.documents(name, category, application_id) values ('Resume','resume',$1) returning id`, [app2]))[0].id;
await q(`insert into public.document_versions(document_id, version_number, storage_path, file_name) values ($1,1,'${A}/resume.pdf','resume.pdf')`, [doc]);
const countsSrc = {};
for (const t of BACKUP_TABLES) countsSrc[t] = (await q(`select count(*)::int n from public.${t}`))[0].n;

// Export through the real lib/backup.ts code path with a client shaped like supabase-js
const fakeClient = { from: (t) => {
  const st = { cols: [], from: 0, to: 0 };
  const b = { select: () => b, order: (c) => { st.cols.push(c); return b; }, range: (f, to) => { st.from = f; st.to = to; return b; },
    then: (res, rej) => (async () => {
      const order = st.cols.length ? ' order by ' + st.cols.map((c) => `"${c}"`).join(',') : '';
      try { const r = await as(src, A, `select * from public."${t}"${order} limit ${st.to - st.from + 1} offset ${st.from}`); return { data: r.rows, error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
    })().then(res, rej) };
  return b;
} };
const backup = await buildBackup(fakeClient);
const text = JSON.stringify(backup);   // what the user downloads

// ---------- destination project ----------
const dstMain = await makeDb([N, M]); const dst = dstMain;
const dq = async (uid, sql, p) => (await as(dst, uid, sql, p)).rows;
function executor(uid, dst = dstMain) {
  const qi = (s) => '"' + s.replace(/"/g, '""') + '"';
  const run = async (sql, p) => { await dst.exec(`select set_config('request.jwt.claim.sub','${uid}', false); set role authenticated;`); try { return await dst.query(sql, p); } finally { await dst.exec('reset role;'); } };
  return {
    // mirrors PostgREST upsert with ignore-duplicates: one atomic request per batch, returns only inserted keys
    async insertMissing(table, rows, pk) {
      await dst.exec(`select set_config('request.jwt.claim.sub','${uid}', false); set role authenticated; begin;`);
      try {
        const out = [];
        for (const r of rows) {
          const cols = Object.keys(r).map(qi).join(',');
          const res = await dst.query(`insert into public.${qi(table)} (${cols}) select ${cols} from jsonb_populate_record(null::public.${qi(table)}, $1::jsonb) on conflict (${pk.map(qi).join(',')}) do nothing returning ${pk.map(qi).join(',')}`, [JSON.stringify(r)]);
          out.push(...res.rows);
        }
        await dst.exec('commit; reset role;'); return out;
      } catch (e) { await dst.exec('rollback; reset role;'); throw e; }
    },
    async deleteWhereIn(table, col, vals) { await run(`delete from public.${qi(table)} where ${qi(col)} = any($1::uuid[])`, [vals]); },
    async updateById(table, id, patch) { const ks = Object.keys(patch); await run(`update public.${qi(table)} set ${ks.map((k, i) => `${qi(k)}=$${i + 2}`).join(',')} where id=$1`, [id, ...ks.map((k) => patch[k])]); },
  };
}

let parsed, report, report2;
await test('backup file validates and the preview matches the source counts', async () => {
  parsed = parseBackup(text); ok(parsed.ok, parsed.error);
  const restorable = IMPORT_ORDER.reduce((a, t) => a + countsSrc[t], 0);
  ok(parsed.preview.totalRows === restorable, `preview ${parsed.preview.totalRows} vs ${restorable}`);
  ok(parsed.preview.skipped.some((s) => s.table === 'activity_logs'), 'activity_logs should be listed as skipped');
});
await test('import as a different user in a fresh database: nothing failed', async () => {
  report = await runImport(parsed.backup, N, executor(N));
  ok(report.failed === 0, 'failed ' + report.failed + ' ' + JSON.stringify(report.tables.filter((t) => t.failed)));
  ok(report.notes.length === 0, 'notes: ' + report.notes.join('; '));
  ok(report.skipped === 0, 'skipped ' + report.skipped);
});
await test('row counts match the source for every restored table', async () => {
  for (const t of IMPORT_ORDER) { const n = (await dq(N, `select count(*)::int n from public.${t}`))[0].n; ok(n === countsSrc[t], `${t}: ${n} vs ${countsSrc[t]}`); }
  ok(report.inserted === IMPORT_ORDER.reduce((a, t) => a + countsSrc[t], 0), 'report.inserted ' + report.inserted);
});
await test('requirements and essay versions are not duplicated by the triggers', async () => {
  const r = await dq(N, `select application_id, count(*)::int n from public.application_requirements group by 1`);
  ok(r.length === 2 && r.every((x) => x.n === 17), 'requirements per app ' + JSON.stringify(r));
  const v = await dq(N, `select version_number, word_count, change_notes from public.essay_versions where essay_id=$1 order by 1`, [essay1]);
  ok(v.length === 3 && v.map((x) => x.version_number).join() === '1,2,3', 'versions ' + JSON.stringify(v));
  ok(v[2].change_notes === 'final' && v[2].word_count === 5, 'version 3 content');
  const v2 = await dq(N, `select count(*)::int n from public.essay_versions where essay_id=$1`, [essay2]); ok(v2[0].n === 1, 'essay2 versions ' + v2[0].n);
});
await test('document version storage paths point at the new owner folder', async () => {
  const r = await dq(N, 'select storage_path from public.document_versions'); ok(r.length === 1 && r[0].storage_path === `${N}/resume.pdf`, JSON.stringify(r));
});
await test('Ready stage restored, original requirement status and links preserved', async () => {
  const a = await dq(N, 'select stage from public.applications where id=$1', [app1]); ok(a[0].stage === 'ready', a[0].stage);
  const r = await dq(N, `select essay_id, status from public.application_requirements where application_id=$1 and name='Essay 1'`, [app2]); ok(r[0].essay_id === essay1 && r[0].status === 'in_progress', JSON.stringify(r));
  const d = await dq(N, 'select duplicated_from from public.essays where id=$1', [essay2]); ok(d[0].duplicated_from === essay1, 'duplicated_from not restored');
});
await test('every row is owned by the new user and keeps its primary key', async () => {
  for (const t of IMPORT_ORDER) {
    const bad = (await dq(N, `select count(*)::int n from public.${t} where user_id <> $1`, [N]))[0].n; ok(bad === 0, `${t} has ${bad} foreign-owned rows`);
  }
  const ids = (await dq(N, 'select id from public.schools')).map((x) => x.id).sort().join(); ok(ids === backup.tables.schools.map((x) => x.id).sort().join(), 'school ids changed');
  const owner = await as(dst, M, 'select count(*)::int n from public.schools'); ok(owner.rows[0].n === 0, 'bystander sees schools');
  const srcOwner = (await dq(N, `select count(*)::int n from public.applications where user_id='${A}'`))[0].n; ok(srcOwner === 0, 'old owner id leaked');
});
await test('foreign keys are valid (no orphans) and ownership consistent with parents', async () => {
  const checks = [
    `select count(*)::int n from public.application_requirements r left join public.applications a on a.id=r.application_id where a.id is null`,
    `select count(*)::int n from public.essay_versions r left join public.essays a on a.id=r.essay_id where a.id is null`,
    `select count(*)::int n from public.recommendations r left join public.recommenders a on a.id=r.recommender_id where a.id is null`,
    `select count(*)::int n from public.applications r left join public.schools a on a.id=r.school_id where a.id is null`,
    `select count(*)::int n from public.application_requirements r join public.applications a on a.id=r.application_id where a.user_id <> r.user_id`,
  ];
  for (const c of checks) ok((await dq(N, c))[0].n === 0, 'orphan or mismatch: ' + c);
});
await test('RLS isolation intact: bystander sees nothing, cannot touch imported rows', async () => {
  for (const t of ['applications', 'essays', 'essay_versions', 'application_requirements', 'expenses']) ok((await dq(M, `select count(*)::int n from public.${t}`))[0].n === 0, `M sees ${t}`);
  const u = await as(dst, M, `update public.applications set notes='x' where id=$1`, [app1]); ok(u.affectedRows === 0, 'M updated N row');
});
await test('re-running the import skips everything and changes nothing', async () => {
  report2 = await runImport(parsed.backup, N, executor(N));
  const expect = IMPORT_ORDER.reduce((a, t) => a + countsSrc[t], 0);
  ok(report2.inserted === 0 && report2.failed === 0 && report2.skipped === expect, `ins ${report2.inserted} skip ${report2.skipped} fail ${report2.failed}`);
  ok((await dq(N, `select count(*)::int n from public.application_requirements`))[0].n === 34, 'requirements changed');
  ok((await dq(N, `select count(*)::int n from public.essay_versions`))[0].n === 4, 'essay versions changed');
});
await test('a user cannot import over another user\'s rows (same primary keys): skipped or failed, never overwritten', async () => {
  const rep = await runImport(parsed.backup, M, executor(M));
  ok(rep.inserted === 0, 'M inserted ' + rep.inserted);
  ok((await dq(N, `select count(*)::int n from public.applications where user_id='${N}'`))[0].n === 2, 'N rows changed');
  ok((await dq(M, `select count(*)::int n from public.applications`))[0].n === 0, 'M got rows');
});
await test('import into a project where the account already has data merges without touching existing rows', async () => {
  const P = '55555555-5555-5555-5555-555555555555';
  const db2 = await makeDb([P]);
  await as(db2, P, `insert into public.applicant_profiles(full_name) values ('Existing Name')`);
  await as(db2, P, `insert into public.schools(name) values ('My own school')`);
  const rep = await runImport(parsed.backup, P, executor(P, db2));
  ok(rep.failed === 0, 'failed ' + JSON.stringify(rep.tables.filter((t) => t.failed)));
  const prof = (await as(db2, P, 'select full_name from public.applicant_profiles')).rows; ok(prof.length === 1 && prof[0].full_name === 'Existing Name', 'profile overwritten: ' + JSON.stringify(prof));
  ok((await as(db2, P, `select count(*)::int n from public.schools`)).rows[0].n === countsSrc.schools + 1, 'schools not merged');
  ok((await as(db2, P, `select count(*)::int n from public.essay_versions`)).rows[0].n === 4, 'versions after merge');
  ok((await as(db2, P, `select stage from public.applications where id=$1`, [app1])).rows[0].stage === 'ready', 'ready not restored');
});
await test('tampered files are refused before any database call', async () => {
  const bad = [
    ['wrong app', JSON.stringify({ ...backup, app: 'other' })],
    ['wrong version', JSON.stringify({ ...backup, format_version: 99 })],
    ['unknown table', JSON.stringify({ ...backup, tables: { ...backup.tables, 'auth.users': [] } })],
    ['bad key', JSON.stringify({ ...backup, tables: { ...backup.tables, schools: [{ id: backup.tables.schools[0].id, 'name"; drop': 1 }] } })],
    ['bad id', JSON.stringify({ ...backup, tables: { ...backup.tables, schools: [{ id: 'nope' }] } })],
    ['not json', '{{{'],
  ];
  for (const [n, t] of bad) ok(!parseBackup(t).ok, 'accepted: ' + n);
});

console.table(results.map(([n, s, e]) => ({ test: n, result: s, detail: e || '' })));
const failed = results.filter((r) => r[1] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed. Source rows restorable: ${IMPORT_ORDER.reduce((a, t) => a + countsSrc[t], 0)}; first run inserted ${report?.inserted}; re-run skipped ${report2?.skipped}.`);
process.exit(failed ? 1 : 0);
