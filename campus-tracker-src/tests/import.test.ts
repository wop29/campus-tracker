import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, planImport, runImport, transformRow, IMPORT_ORDER, SKIPPED_TABLES, MAX_IMPORT_BYTES, type ImportExecutor } from '../lib/import.ts';
import { BACKUP_TABLES } from '../lib/backup.ts';

const U = '99999999-9999-9999-9999-999999999999';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (tables: Record<string, unknown[]>, over: Record<string, unknown> = {}) =>
  JSON.stringify({ app: 'mba-admissions-os', format_version: 1, exported_at: '2026-11-01T10:00:00Z', tables, ...over });
const sample = {
  schools: [{ id: id(1), user_id: 'old', name: 'S' }],
  applications: [{ id: id(2), user_id: 'old', school_id: id(1), stage: 'ready' }, { id: id(3), user_id: 'old', school_id: id(1), stage: 'preparing' }],
  essays: [{ id: id(4), user_id: 'old', application_id: id(2), duplicated_from: id(5) }, { id: id(5), user_id: 'old', application_id: id(2), duplicated_from: null }],
  essay_versions: [{ id: id(6), user_id: 'old', essay_id: id(4), version_number: 1 }],
  application_requirements: [{ id: id(7), user_id: 'old', application_id: id(2), name: 'x' }],
  activity_logs: [{ id: id(8), user_id: 'old' }],
};

test('every backed-up table is either restored or deliberately skipped', () => {
  const covered = new Set<string>([...IMPORT_ORDER, ...SKIPPED_TABLES]);
  for (const t of BACKUP_TABLES) assert.ok(covered.has(t), `${t} is neither restored nor skipped`);
});
test('parse: accepts a valid backup and previews counts, listing skipped tables', () => {
  const r = parseBackup(file(sample)); assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.preview.totalRows, 7); assert.equal(r.preview.exportedAt, '2026-11-01T10:00:00Z');
    assert.deepEqual(r.preview.skipped.map((s) => s.table), ['activity_logs']);
    assert.equal(r.preview.counts[0].table, 'schools');
  }
});
test('parse: refuses wrong marker, version, unknown tables, bad ids, bad columns, bad JSON, oversize', () => {
  assert.equal(parseBackup(file(sample, { app: 'x' })).ok, false);
  assert.equal(parseBackup(file(sample, { format_version: 2 })).ok, false);
  assert.equal(parseBackup(file({ 'auth.users': [] })).ok, false);
  assert.equal(parseBackup(file({ schools: [{ id: 'nope' }] })).ok, false);
  assert.equal(parseBackup(file({ schools: [{ id: id(1), 'a;b': 1 }] })).ok, false);
  assert.equal(parseBackup(file({ essay_stories: [{ essay_id: id(1) }] })).ok, false);
  assert.equal(parseBackup('{nope').ok, false);
  assert.equal(parseBackup('[]').ok, false);
  assert.equal(parseBackup(' '.repeat(MAX_IMPORT_BYTES + 1)).ok, false);
});
test('transform: owner rewritten, ready becomes preparing, essay self link deferred; input not mutated', () => {
  const src = { id: id(2), user_id: 'old', stage: 'ready' };
  const t = transformRow('applications', src, U);
  assert.equal(t.user_id, U); assert.equal(t.stage, 'preparing'); assert.equal(src.stage, 'ready'); assert.equal(src.user_id, 'old');
  assert.equal(transformRow('essays', { id: id(4), duplicated_from: id(5) }, U).duplicated_from, null);
  const dv = transformRow('document_versions', { id: id(9), user_id: 'old', storage_path: 'old/resume.pdf' }, U);
  assert.equal(dv.storage_path, `${U}/resume.pdf`);
  assert.equal(transformRow('document_versions', { id: id(9), user_id: 'old', storage_path: 'elsewhere/x.pdf' }, U).storage_path, 'elsewhere/x.pdf');
  assert.equal(transformRow('applications', { id: id(3), stage: 'submitted' }, U).stage, 'submitted');
});
test('plan: parents come before children and skipped tables are absent', () => {
  const r = parseBackup(file(sample)); assert.ok(r.ok); if (!r.ok) return;
  const order = planImport(r.backup, U).steps.map((s) => s.table);
  assert.deepEqual(order, ['schools', 'applications', 'essays', 'essay_versions', 'application_requirements']);
  for (const s of planImport(r.backup, U).steps) for (const g of s.groups) for (const row of g) assert.equal(row.user_id, U);
});
test('plan: FK order is consistent (every parent table precedes its children)', () => {
  const pos = (t: string) => IMPORT_ORDER.indexOf(t as never);
  const edges: [string, string][] = [['schools', 'applications'], ['applications', 'documents'], ['applications', 'essays'], ['essays', 'essay_versions'], ['documents', 'document_versions'],
    ['story_bank', 'essay_stories'], ['essays', 'essay_stories'], ['recommenders', 'recommendations'], ['applications', 'recommendations'], ['recommendations', 'application_requirements'],
    ['essays', 'application_requirements'], ['documents', 'application_requirements'], ['application_requirements', 'application_tasks'], ['application_tasks', 'ai_recommendations'],
    ['interview_sessions', 'interview_questions'], ['interview_questions', 'interview_feedback'], ['scholarships', 'scholarship_applications'], ['applications', 'admissions_decisions']];
  for (const [p, c] of edges) assert.ok(pos(p) >= 0 && pos(p) < pos(c), `${p} must come before ${c}`);
});

function fakeExecutor(existing = new Set<string>(), failIds = new Set<string>()) {
  const calls: string[] = [];
  const ex: ImportExecutor = {
    async insertMissing(table, rows) {
      calls.push(`insert ${table} ${rows.length}`);
      if (rows.some((r) => failIds.has(String(r.id)))) throw new Error('check constraint violated');
      const fresh = rows.filter((r) => !existing.has(String(r.id)));
      return fresh.map((r) => ({ id: r.id }));
    },
    async deleteWhereIn(table, col, vals) { calls.push(`delete ${table}.${col} ${vals.sort().join(',')}`); },
    async updateById(table, i, patch) { calls.push(`update ${table} ${i} ${JSON.stringify(patch)}`); },
  };
  return { ex, calls };
}
test('run: trigger workarounds happen in the right order and only for new rows', async () => {
  const r = parseBackup(file(sample)); assert.ok(r.ok); if (!r.ok) return;
  const { ex, calls } = fakeExecutor(new Set([id(3)]));   // application 3 already exists
  const rep = await runImport(r.backup, U, ex);
  const at = (s: string) => calls.findIndex((c) => c.startsWith(s));
  assert.ok(at('insert applications') < at('delete application_requirements'));
  assert.ok(at('delete application_requirements') < at('insert application_requirements'));
  assert.equal(calls[at('delete application_requirements')], `delete application_requirements.application_id ${id(2)}`);   // not the existing app 3
  assert.ok(at('insert essays') < at('delete essay_versions') && at('delete essay_versions') < at('insert essay_versions'));
  assert.ok(calls.includes(`delete essay_versions.essay_id ${[id(4)].join()}`), 'only essays with backed-up versions');
  assert.ok(calls.includes(`update essays ${id(4)} {"duplicated_from":"${id(5)}"}`));
  assert.ok(at('insert application_requirements') < calls.findIndex((c) => c.includes('"stage":"ready"')));
  assert.equal(rep.failed, 0); assert.equal(rep.skipped, 1); assert.equal(rep.inserted, 6);
});
test('run: a failing row is isolated, counted and does not stop the others', async () => {
  const r = parseBackup(file(sample)); assert.ok(r.ok); if (!r.ok) return;
  const { ex } = fakeExecutor(new Set(), new Set([id(3)]));
  const rep = await runImport(r.backup, U, ex);
  const apps = rep.tables.find((t) => t.table === 'applications')!;
  assert.equal(apps.inserted, 1); assert.equal(apps.failed, 1); assert.match(apps.errors[0], /check constraint/);
  assert.equal(rep.tables.find((t) => t.table === 'schools')!.inserted, 1);
});
test('run: unique-constraint conflicts count as skipped, not failed', async () => {
  const r = parseBackup(file({ schools: sample.schools })); assert.ok(r.ok); if (!r.ok) return;
  const ex: ImportExecutor = { insertMissing: async () => { throw new Error('duplicate key value violates unique constraint'); }, deleteWhereIn: async () => {}, updateById: async () => {} };
  const rep = await runImport(r.backup, U, ex); assert.equal(rep.failed, 0); assert.equal(rep.skipped, 1);
});
