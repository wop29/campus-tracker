-- 021: per-program application requirements (official sources, collected 2026-11-16).
-- Reference table: one row per degree program per school. Readable by every signed-in user, writable by no one
-- through the API (no insert/update/delete policies). Data is loaded separately; this migration inserts nothing.
-- `data` holds the full researched object (see research PROGRAM_SPEC: tests, english, essays, interview, ...).
create table if not exists public.program_requirements (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  program_name text not null,
  degree_type text,
  format text,
  duration text,
  intake text,
  program_url text,
  data jsonb not null,
  collected_on date not null default date '2026-11-16',
  unique (school_name, program_name)
);
create index if not exists program_requirements_school_idx on public.program_requirements (school_name);
alter table public.program_requirements enable row level security;
drop policy if exists "program requirements read" on public.program_requirements;
create policy "program requirements read" on public.program_requirements for select to authenticated using (true);

-- Which researched program an application was started from (null for applications made by hand).
alter table public.applications add column if not exists program_requirement_id uuid references public.program_requirements(id) on delete set null;

-- Class profile ranges and employment report per program (research PROFILE_SPEC). Loaded separately; null when not found.
alter table public.program_requirements add column if not exists class_profile jsonb;
alter table public.program_requirements add column if not exists employment jsonb;
