-- MBA Admissions OS: core schema. Every row is owned by a user (user_id) and protected by RLS.

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 1 users (profile mirror of auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- 2 applicant_profiles
create table public.applicant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  full_name text, preferred_name text, email text, nationality text, current_country text, current_city text,
  personal_narrative jsonb not null default '{}',
  field_verification jsonb not null default '{}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (user_id)
);
-- 3 education_records
create table public.education_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  institution text not null, degree text, major text, country text, graduation_date date,
  gpa numeric, gpa_scale numeric, honors text, additional_qualifications text,
  enrollment_status text not null default 'completed' check (enrollment_status in ('completed','current','incomplete')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (gpa is null or gpa_scale is null or gpa <= gpa_scale)
);
-- 4 test_scores
create table public.test_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  test_type text not null check (test_type in ('GMAT','GRE','IELTS','TOEFL','OTHER')),
  exam_version text, overall numeric, quant numeric, verbal numeric, data_insights numeric, analytical_writing numeric,
  test_date date, attempt_number int not null default 1, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- 5 work_experiences
create table public.work_experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  company text not null, industry text, position text not null, location text,
  start_date date, end_date date, employment_type text, description text, responsibilities text, achievements text,
  team_size int check (team_size is null or team_size >= 0), budget_ownership text, promotions text, measurable_impact text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date)
);
-- 6 leadership_experiences
create table public.leadership_experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  organization text not null, role text, start_date date, end_date date, responsibilities text,
  leadership_experience text, achievements text, social_impact text, awards text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- 7 achievements
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  title text not null, description text, achieved_on date, quantified_impact text, source_type text, source_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- 8 career_goals
create table public.career_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  why_mba text, why_now text, short_term_goal text, long_term_goal text, target_industry text, target_function text,
  target_geography text, career_transition text, target_companies text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id)
);

-- 9 schools
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null, short_name text, country text, location text,
  website_url text, admissions_url text,
  tier text check (tier in ('dream','reach','competitive','target','safer')),
  in_portfolio boolean not null default false, priority int not null default 3 check (priority between 1 and 5),
  notes text, ranking int,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- 10 school_programs
create table public.school_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null default 'Full-time MBA', duration_months int, format text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- 12 school_sources
create table public.school_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  source_name text not null, source_url text not null, date_accessed date not null default current_date, publication_year int,
  created_at timestamptz not null default now()
);
-- 11 school_admissions_data: one row per researched data point, always with its source
create table public.school_admissions_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  field text not null,
  value_num numeric, value_text text, currency text,
  source_name text not null, source_url text not null, date_accessed date not null default current_date,
  publication_year int, verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','outdated')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (value_num is not null or value_text is not null),
  unique (school_id, field)
);
create table public.saved_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null, school_ids uuid[] not null check (cardinality(school_ids) between 2 and 5),
  created_at timestamptz not null default now()
);

-- 13 applications
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  program text not null default 'Full-time MBA', intake text not null default 'Fall 2027', round text,
  priority int not null default 3 check (priority between 1 and 5),
  application_fee numeric check (application_fee is null or application_fee >= 0), fee_currency text not null default 'USD',
  stage text not null default 'researching' check (stage in ('researching','shortlisted','preparing','ready','submitted','interview_invited','interview_scheduled','interview_completed','waitlisted','admitted','rejected','withdrawn')),
  notes text,
  submission_confirmed_at timestamptz, submitted_at date, confirmation_number text, confirmation_document_id uuid,
  portal_url text, final_resume_version_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index applications_unique_round on public.applications (user_id, school_id, program, intake, coalesce(round,'')) where deleted_at is null;
-- 20 documents / 21 document_versions
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null,
  category text not null default 'other' check (category in ('resume','transcripts','test_scores','essays','recommendation_materials','certificates','financial_records','other')),
  school_id uuid references public.schools(id) on delete set null, application_id uuid references public.applications(id) on delete set null,
  current_version int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number int not null, storage_path text not null, file_name text not null, mime_type text, size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);
-- 17 essays / 18 essay_versions
create table public.essays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  title text not null, prompt text, word_limit int check (word_limit is null or word_limit > 0),
  draft text not null default '', status text not null default 'not_started' check (status in ('not_started','brainstorming','first_draft','revision','final_review','approved','submitted')),
  deadline timestamptz, change_notes text, duplicated_from uuid references public.essays(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.essay_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  essay_id uuid not null references public.essays(id) on delete cascade,
  version_number int not null, text text not null, word_count int not null default 0, change_notes text,
  ai_review jsonb, user_comments text, created_at timestamptz not null default now(),
  unique (essay_id, version_number)
);
-- 19 story_bank
create table public.story_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  title text not null, category text not null check (category in ('leadership','failure','conflict','teamwork','innovation','entrepreneurship','social_impact','career_transition','personal_motivation','diversity','ethical_decisions','international')),
  situation text, task text, action text, result text, lessons_learned text, quantified_impact text,
  competencies text[] not null default '{}', related_school_ids uuid[] not null default '{}', related_prompts text,
  usage_count int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.essay_stories (
  essay_id uuid not null references public.essays(id) on delete cascade,
  story_id uuid not null references public.story_bank(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  primary key (essay_id, story_id)
);
-- 22 recommenders / 23 recommendations
create table public.recommenders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null, position text, company text, email text, relationship text, background text,
  contacted_at date, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  recommender_id uuid not null references public.recommenders(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  status text not null default 'not_contacted' check (status in ('not_contacted','contacted','agreed','briefing_sent','in_progress','submitted','follow_up_required')),
  deadline timestamptz, last_contact_at date, submitted_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (recommender_id, application_id)
);
-- 14 application_requirements / 15 application_tasks / 16 deadlines
create table public.application_requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  name text not null, category text not null default 'other' check (category in ('essays','recommendations','academics','tests','resume','form','other')),
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','waived')),
  due_date date, priority int not null default 3 check (priority between 1 and 5), mandatory boolean not null default true,
  document_id uuid references public.documents(id) on delete set null, essay_id uuid references public.essays(id) on delete set null,
  recommendation_id uuid references public.recommendations(id) on delete set null,
  assigned_to text, notes text, completed_at timestamptz, sort_order int not null default 0, is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.application_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade, requirement_id uuid references public.application_requirements(id) on delete set null,
  title text not null, description text, status text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date date, estimated_minutes int check (estimated_minutes is null or estimated_minutes > 0), priority int not null default 3 check (priority between 1 and 5),
  completed_at timestamptz, source text not null default 'manual', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  name text not null default 'Submission deadline', due_at timestamptz not null, timezone text not null default 'America/New_York',
  kind text not null default 'submission' check (kind in ('submission','essay','recommendation','interview','scholarship','deposit','other')),
  is_primary boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- 24-26 interviews
create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null, school_id uuid references public.schools(id) on delete set null,
  kind text not null default 'mock' check (kind in ('mock','real')), scheduled_at timestamptz, interviewer text, format text,
  started_at timestamptz, ended_at timestamptz, duration_seconds int, status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  session_id uuid references public.interview_sessions(id) on delete cascade, school_id uuid references public.schools(id) on delete set null,
  category text not null, question text not null, origin text not null default 'user' check (origin in ('ai_generated','verified_historical','user')),
  answer text, asked_order int, created_at timestamptz not null default now()
);
create table public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  question_id uuid not null references public.interview_questions(id) on delete cascade,
  scores jsonb not null default '{}', feedback text, source text not null default 'ai' check (source in ('ai','self')),
  created_at timestamptz not null default now()
);
-- 27-28 scholarships
create table public.scholarships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null, institution text, school_id uuid references public.schools(id) on delete set null,
  amount numeric check (amount is null or amount >= 0), currency text not null default 'USD',
  category text check (category in ('merit','need','institutional','external','fellowship','employer')),
  eligibility text, requirements text, deadline date, website_url text, source_verified_on date,
  status text not null default 'identified' check (status in ('identified','researching','potentially_eligible','eligible','preparing','applied','awarded','rejected')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.scholarship_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  status text not null default 'preparing', applied_at date, decision_at date, awarded_amount numeric, notes text,
  created_at timestamptz not null default now()
);
-- 29-30 finance
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null, application_id uuid references public.applications(id) on delete set null,
  category text not null check (category in ('application_fee','test_fee','test_prep','transcript','credential_evaluation','english_test','interview_travel','campus_visit','other')),
  description text, estimated_cost numeric check (estimated_cost is null or estimated_cost >= 0), actual_cost numeric check (actual_cost is null or actual_cost >= 0),
  currency text not null default 'USD', fx_rate_to_base numeric check (fx_rate_to_base is null or fx_rate_to_base > 0), fx_rate_date date,
  payment_date date, payment_status text not null default 'planned' check (payment_status in ('planned','due','paid','refunded')), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.financial_projections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  scenario text not null check (scenario in ('optimistic','base','conservative')),
  assumptions jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, scenario)
);
-- 31 admissions_decisions
create table public.admissions_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  application_id uuid not null unique references public.applications(id) on delete cascade,
  decision text not null default 'awaiting' check (decision in ('awaiting','interview_invited','waitlisted','admitted','rejected','withdrawn')),
  decision_date date, scholarship_amount numeric check (scholarship_amount is null or scholarship_amount >= 0), scholarship_currency text default 'USD',
  deposit_deadline date, waitlist_response_deadline date, waitlist_notes text, matrix_scores jsonb not null default '{}', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- 32-36 AI, notifications, audit
create table public.ai_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  kind text not null check (kind in ('profile','school_gap','essay','interview')), school_id uuid references public.schools(id) on delete set null,
  subject_id uuid, result jsonb not null, model text, input_snapshot jsonb, created_at timestamptz not null default now()
);
create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  dedupe_key text not null, title text not null, description text, school_id uuid references public.schools(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade, priority text not null default 'medium' check (priority in ('high','medium','low')),
  reason text, effort_minutes int, due_date date, expected_benefit text, source text not null default 'rules',
  status text not null default 'new' check (status in ('new','accepted','dismissed','snoozed','converted','completed')),
  snoozed_until timestamptz, task_id uuid references public.application_tasks(id) on delete set null,
  score numeric not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  mode text not null check (mode in ('strategist','essay_coach','interview_coach','execution')),
  messages jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  category text not null, title text not null, body text, link text, dedupe_key text, read_at timestamptz,
  created_at timestamptz not null default now(), unique (user_id, dedupe_key)
);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  table_name text not null, record_id uuid, action text not null, changes jsonb, created_at timestamptz not null default now()
);

-- updated_at triggers
do $$ declare t text; begin
  for t in select table_name from information_schema.columns where table_schema='public' and column_name='updated_at' loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop; end $$;

-- audit log trigger on the main tables (draft text is excluded to keep logs small)
create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; uid uuid;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  uid := (r->>'user_id')::uuid;
  if not exists (select 1 from public.users where id = uid) then return coalesce(new, old); end if;  -- user already deleted (cascade)
  insert into public.activity_logs(user_id, table_name, record_id, action, changes)
  values (uid, tg_table_name, (r->>'id')::uuid, tg_op,
          case when tg_op='UPDATE' then jsonb_build_object('old', to_jsonb(old) - 'draft', 'new', to_jsonb(new) - 'draft') else r - 'draft' end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['applicant_profiles','education_records','test_scores','work_experiences','schools','applications','application_requirements','documents','essays','recommenders','recommendations','scholarships','expenses','admissions_decisions','deadlines'] loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop; end $$;

-- ownership consistency: a row may only reference parents owned by the same user
create or replace function public.check_parent_owner() returns trigger language plpgsql security definer set search_path = public as $$
declare col text := tg_argv[0]; ptable text := tg_argv[1]; pid uuid; puid uuid;
begin
  pid := (to_jsonb(new)->>col)::uuid;
  if pid is null then return new; end if;
  execute format('select user_id from public.%I where id = $1', ptable) into puid using pid;
  if puid is distinct from new.user_id then raise exception 'foreign key % references a record owned by another user', col using errcode = '42501'; end if;
  return new;
end $$;
do $$ declare x text[]; begin
  foreach x slice 1 in array array[
    ['school_programs','school_id','schools'],['school_sources','school_id','schools'],['school_admissions_data','school_id','schools'],
    ['applications','school_id','schools'],['documents','school_id','schools'],['documents','application_id','applications'],
    ['document_versions','document_id','documents'],['essays','application_id','applications'],['essays','school_id','schools'],
    ['essay_versions','essay_id','essays'],['essay_stories','essay_id','essays'],['essay_stories','story_id','story_bank'],
    ['recommendations','recommender_id','recommenders'],['recommendations','application_id','applications'],
    ['application_requirements','application_id','applications'],['application_requirements','document_id','documents'],['application_requirements','essay_id','essays'],
    ['application_tasks','application_id','applications'],['deadlines','application_id','applications'],
    ['interview_sessions','application_id','applications'],['interview_questions','session_id','interview_sessions'],['interview_feedback','question_id','interview_questions'],
    ['scholarships','school_id','schools'],['scholarship_applications','scholarship_id','scholarships'],['scholarship_applications','application_id','applications'],
    ['expenses','school_id','schools'],['expenses','application_id','applications'],['financial_projections','school_id','schools'],
    ['admissions_decisions','application_id','applications'],['ai_recommendations','application_id','applications'],['ai_recommendations','school_id','schools']
  ] loop
    execute format('create trigger trg_%s_%s_owner before insert or update on public.%I for each row execute function public.check_parent_owner(%L, %L)', x[1], x[2], x[1], x[2], x[3]);
  end loop; end $$;

-- default requirements for each new application
create or replace function public.create_default_requirements() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.application_requirements(user_id, application_id, name, category, mandatory, sort_order, is_default)
  select new.user_id, new.id, r.name, r.category, r.mandatory, r.ord, true from (values
    (1,'Application profile','form',true),(2,'Resume','resume',true),(3,'Academic transcripts','academics',true),(4,'GMAT/GRE','tests',true),
    (5,'English proficiency','tests',true),(6,'Essay 1','essays',true),(7,'Essay 2','essays',true),(8,'Optional essay','essays',false),
    (9,'Recommendation 1','recommendations',true),(10,'Recommendation 2','recommendations',true),(11,'Employment history','other',true),
    (12,'Extracurricular information','other',false),(13,'Application form','form',true),(14,'Application fee','other',true),
    (15,'Interview preparation','other',false),(16,'Final review','other',true),(17,'Submission confirmation','other',true)
  ) as r(ord,name,category,mandatory);
  return new;
end $$;
create trigger trg_applications_defaults after insert on public.applications for each row execute function public.create_default_requirements();

-- requirement completion timestamp
create or replace function public.requirement_completion() returns trigger language plpgsql as $$
begin
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status is distinct from 'complete') then new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'complete' then new.completed_at := null; end if;
  return new;
end $$;
create trigger trg_requirements_completion before insert or update on public.application_requirements for each row execute function public.requirement_completion();

-- stage guards: Ready needs all mandatory requirements done; Submitted needs explicit confirmation
create or replace function public.guard_application_stage() returns trigger language plpgsql security definer set search_path = public as $$
declare open_count int;
begin
  if new.stage = 'ready' and (tg_op = 'INSERT' or old.stage is distinct from 'ready') then
    select count(*) into open_count from public.application_requirements
      where application_id = new.id and mandatory and status not in ('complete','waived') and name <> 'Submission confirmation';
    if open_count > 0 then raise exception 'Cannot mark Ready: % mandatory requirement(s) incomplete', open_count using errcode = 'P0001'; end if;
  end if;
  if new.stage = 'submitted' and (tg_op = 'INSERT' or old.stage is distinct from 'submitted') then
    if new.submission_confirmed_at is null then raise exception 'Submission must be explicitly confirmed' using errcode = 'P0001'; end if;
    new.submitted_at := coalesce(new.submitted_at, current_date);
  end if;
  return new;
end $$;
create trigger trg_applications_stage before insert or update on public.applications for each row execute function public.guard_application_stage();

-- essay versions: every saved draft is a new immutable version
create or replace function public.essay_version_snapshot() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; wc int;
begin
  if tg_op = 'UPDATE' and new.draft is not distinct from old.draft then return new; end if;
  select coalesce(max(version_number),0)+1 into n from public.essay_versions where essay_id = new.id;
  if btrim(new.draft) = '' then wc := 0; else wc := array_length(regexp_split_to_array(btrim(new.draft), '\s+'), 1); end if;
  insert into public.essay_versions(user_id, essay_id, version_number, text, word_count, change_notes) values (new.user_id, new.id, n, new.draft, wc, new.change_notes);
  return new;
end $$;
create trigger trg_essays_version after insert or update on public.essays for each row execute function public.essay_version_snapshot();
create or replace function public.block_version_edit() returns trigger language plpgsql as $$
begin
  if new.text is distinct from old.text or new.version_number is distinct from old.version_number then raise exception 'Essay versions are immutable'; end if;
  return new;
end $$;
create trigger trg_essay_versions_immutable before update on public.essay_versions for each row execute function public.block_version_edit();

-- row level security: owner only
do $$ declare t record; begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables tb on tb.table_name=c.table_name and tb.table_schema=c.table_schema and tb.table_type='BASE TABLE'
           where c.table_schema='public' and c.column_name='user_id' loop
    execute format('alter table public.%I enable row level security', t.table_name);
    if t.table_name = 'activity_logs' then
      execute format('create policy owner_select on public.%I for select using (user_id = auth.uid())', t.table_name);
    else
      execute format('create policy owner_all on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t.table_name);
    end if;
  end loop;
end $$;
alter table public.users enable row level security;
create policy self_select on public.users for select using (id = auth.uid());
create policy self_update on public.users for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users(id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;

create index on public.applications (user_id, stage);
create index on public.deadlines (user_id, due_at);
create index on public.application_requirements (application_id, status);
create index on public.recommendations (application_id);
create index on public.expenses (user_id, payment_status);
create index on public.ai_recommendations (user_id, status);
create index on public.notifications (user_id, read_at);
