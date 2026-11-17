// Static QA: every table/column referenced in supabase-js calls must exist in the migrated schema.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const db = new PGlite();
await db.exec(`create schema auth; create schema storage; create table auth.users(id uuid primary key, email text);
 create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid, bucket_id text, name text); create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
 alter table storage.objects enable row level security;`);
const mdir = path.join(root, 'supabase/migrations');
for (const f of readdirSync(mdir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(mdir, f), 'utf8'));
const cols = {}; for (const r of (await db.query(`select table_name t, column_name c from information_schema.columns where table_schema='public'`)).rows) (cols[r.t] ??= new Set()).add(r.c);
const rpcs = new Set((await db.query(`select routine_name n from information_schema.routines where routine_schema='public'`)).rows.map((r) => r.n));

function* walk(d) { for (const n of readdirSync(d)) { if (['node_modules', '.next'].includes(n)) continue; const p = path.join(d, n); statSync(p).isDirectory() ? yield* walk(p) : /\.tsx?$/.test(p) && (yield p); } }
function topLevelKeys(src, start) { // src[start] === '{'
  let depth = 0, i = start, keys = [], buf = '', expectKey = true, inStr = null;
  for (; i < src.length; i++) { const ch = src[i];
    if (inStr) { if (ch === inStr && src[i - 1] !== '\\') inStr = null; buf += ch; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; buf += ch; continue; }
    if ('{[('.includes(ch)) { depth++; if (depth > 1) buf += ch; continue; }
    if ('}])'.includes(ch)) { depth--; if (depth === 0) { const m = buf.trim().match(/^(\w+)\s*(?::|$)/); if (m && expectKey) keys.push(m[1]); break; } buf += ch; continue; }
    if (depth === 1 && ch === ',') { const m = buf.trim().match(/^(\w+)\s*(?::|$)/); if (m) keys.push(m[1]); buf = ''; continue; }
    buf += ch; }
  return keys; }
function selectCols(s) { const out = []; let depth = 0, cur = '';
  for (const ch of s + ',') { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { const it = cur.trim(); cur = ''; if (!it || it === '*' || it.includes('(')) continue; let c = it.split('::')[0]; if (c.includes(':')) c = c.split(':')[1]; c = c.trim(); if (/^\w+$/.test(c)) out.push(c); } else cur += ch; }
  return out; }
const problems = []; let checked = 0;
for (const f of walk(root)) { if (f.includes('/tests/') || f.includes('/scripts/')) continue; const src = readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  for (const m of src.matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) if (!rpcs.has(m[1])) problems.push(`${rel}: unknown rpc ${m[1]}`);
  const froms = [...src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)];
  froms.forEach((m, idx) => { const t = m[1]; const end = Math.min(src.length, m.index + 1400, froms[idx + 1] ? froms[idx + 1].index : Infinity);
    let seg = src.slice(m.index, end); const semi = seg.search(/;\s*\n/); if (semi > 0) seg = seg.slice(0, semi);
    if (t === 'users' || t.startsWith('storage')) return;
    if (!cols[t]) { problems.push(`${rel}: unknown table '${t}'`); return; }
    checked++; const chk = (c, kind) => { if (!c || c.includes('.') || c.includes('->')) return; if (!cols[t].has(c)) problems.push(`${rel}: ${t}.${c} (${kind}) not in schema`); };
    for (const s of seg.matchAll(/\.select\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) selectCols(s[2]).forEach((c) => chk(c, 'select'));
    for (const s of seg.matchAll(/\.(eq|neq|is|in|gt|gte|lt|lte|like|ilike|order|not|contains|overlaps)\(\s*['"](\w+(?:\.\w+)?)['"]/g)) chk(s[2], s[1]);
    for (const s of seg.matchAll(/\.(insert|update|upsert)\(\s*(\[\s*)?\{/g)) { const braceAt = s.index + s[0].length - 1; topLevelKeys(seg, braceAt).forEach((k) => chk(k, s[1])); }
    for (const s of seg.matchAll(/onConflict:\s*['"]([\w, ]+)['"]/g)) s[1].split(',').forEach((c) => chk(c.trim(), 'onConflict')); }); }
console.log(`checked ${checked} table references`);
const uniq = [...new Set(problems)]; uniq.forEach((p) => console.log('PROBLEM', p)); console.log(`${uniq.length} problem(s)`); process.exit(uniq.length ? 1 : 0);
