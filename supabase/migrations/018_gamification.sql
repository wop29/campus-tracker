-- Gamification: an append-only XP ledger written ONLY by SECURITY DEFINER triggers on real records.
--
-- Rules
--  * Users can SELECT their own rows. There is no insert/update/delete policy, so every direct write is refused by RLS.
--  * Each real thing earns XP once: unique (user_id, kind, source_id) plus "insert ... on conflict do nothing".
--    Reopening and re-completing, or editing, never earns a second time. Rows are never deleted by the app.
--  * Soft-deleted rows earn nothing. Empty essay drafts earn nothing.
--  * Creation-type events also have a per-day cap (UTC day) so that bulk-creating throwaway rows cannot farm XP.
--  * award_xp() refuses to run outside a trigger (pg_trigger_depth() = 0), so it cannot be called through rpc.
--
-- XP table (kind, points, source_id, daily cap per kind; a dash means no cap)
--  requirement_complete   10 (15 if mandatory)  application_requirements.id   20/day   status becomes complete
--  task_done              10                    application_tasks.id          20/day   status becomes done
--  essay_first_version    10                    essays.id                     5/day    first non-empty saved draft of an essay
--  essay_version           3                    essay_versions.id             10/day   each later non-empty saved draft
--  essay_approved         20                    essays.id                     -        status becomes approved or submitted
--  story_created          10                    story_bank.id                 10/day
--  sourced_data_point      5                    school_admissions_data.id     20/day   row has a source name and url
--  profile_education/work/leadership/achievement/test   5 each   source row id   10/day per kind
--  career_goals_filled    15                    career_goals.id               -        why_mba, short_term_goal, long_term_goal all filled
--  recommender_added       5                    recommenders.id               10/day
--  recommendation_submitted 25                  recommendations.id            -        status becomes submitted
--  application_submitted 100                    applications.id               -        stage becomes submitted
--  interview_completed    20                    interview_sessions.id         -        status becomes completed
--  interview_feedback      5                    interview_feedback.id         10/day
--  scholarship_applied    30                    scholarships.id               -        status becomes applied
--  expense_paid            5                    expenses.id                   10/day   payment_status becomes paid
--  ai_rec_completed       10                    ai_recommendations.id         10/day   status becomes completed
--  decision_admitted     200                    admissions_decisions.id       -        decision becomes admitted
--  document_version        5                    document_versions.id          10/day
-- Keep this table in sync with lib/gamification.ts (XP_TABLE).

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  kind text not null,
  points int not null check (points > 0),
  source_table text,
  source_id uuid,
  occurred_at timestamptz not null default now(),
  unique (user_id, kind, source_id)
);
create index xp_events_user_time_idx on public.xp_events (user_id, occurred_at);
alter table public.xp_events enable row level security;
create policy owner_select on public.xp_events for select using (user_id = auth.uid());

-- Defence in depth: the ledger is append-only even for roles that bypass RLS via a policy mistake.
create or replace function public.xp_events_block_update() returns trigger language plpgsql as $$
begin raise exception 'xp_events is append-only' using errcode = 'P0001'; end $$;
create trigger trg_xp_events_no_update before update on public.xp_events for each row execute function public.xp_events_block_update();

-- The only writer. Callable from triggers only.
create or replace function public.award_xp(p_user uuid, p_kind text, p_points int, p_table text, p_source uuid, p_daily_cap int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() < 1 then raise exception 'award_xp can only run from a trigger' using errcode = '42501'; end if;
  if p_source is null or p_points <= 0 then return; end if;
  if p_daily_cap is not null and (
       select count(*) from public.xp_events
       where user_id = p_user and kind = p_kind
         and occurred_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= p_daily_cap then
    return;
  end if;
  insert into public.xp_events(user_id, kind, points, source_table, source_id)
  values (p_user, p_kind, p_points, p_table, p_source)
  on conflict (user_id, kind, source_id) do nothing;
end $$;
revoke all on function public.award_xp(uuid, text, int, text, uuid, int) from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.award_xp(uuid, text, int, text, uuid, int) from %I', r);
    end if;
  end loop;
end $$;

-- application_requirements -> requirement_complete
create or replace function public.xp_requirement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status is distinct from 'complete')
     and exists (select 1 from public.applications a where a.id = new.application_id and a.deleted_at is null) then
    perform public.award_xp(new.user_id, 'requirement_complete', case when new.mandatory then 15 else 10 end, 'application_requirements', new.id, 20);
  end if;
  return new;
end $$;
create trigger trg_xp_requirement after insert or update on public.application_requirements for each row execute function public.xp_requirement();

-- application_tasks -> task_done
create or replace function public.xp_task() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    perform public.award_xp(new.user_id, 'task_done', 10, 'application_tasks', new.id, 20);
  end if;
  return new;
end $$;
create trigger trg_xp_task after insert or update on public.application_tasks for each row execute function public.xp_task();

-- essay_versions -> essay_first_version / essay_version (empty drafts earn nothing)
create or replace function public.xp_essay_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if btrim(new.text) = '' then return new; end if;
  if exists (select 1 from public.essays e where e.id = new.essay_id and e.deleted_at is not null) then return new; end if;
  if not exists (select 1 from public.essay_versions v where v.essay_id = new.essay_id and v.id <> new.id and v.version_number < new.version_number and btrim(v.text) <> '') then
    perform public.award_xp(new.user_id, 'essay_first_version', 10, 'essays', new.essay_id, 5);
  else
    perform public.award_xp(new.user_id, 'essay_version', 3, 'essay_versions', new.id, 10);
  end if;
  return new;
end $$;
create trigger trg_xp_essay_version after insert on public.essay_versions for each row execute function public.xp_essay_version();

-- essays -> essay_approved
create or replace function public.xp_essay() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.status in ('approved','submitted') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.award_xp(new.user_id, 'essay_approved', 20, 'essays', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_essay after insert or update on public.essays for each row execute function public.xp_essay();

-- story_bank -> story_created
create or replace function public.xp_story() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null then perform public.award_xp(new.user_id, 'story_created', 10, 'story_bank', new.id, 10); end if;
  return new;
end $$;
create trigger trg_xp_story after insert on public.story_bank for each row execute function public.xp_story();

-- school_admissions_data -> sourced_data_point (only rows that carry a source)
create or replace function public.xp_school_data() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(new.source_name, '')) <> '' and btrim(coalesce(new.source_url, '')) <> '' then
    perform public.award_xp(new.user_id, 'sourced_data_point', 5, 'school_admissions_data', new.id, 20);
  end if;
  return new;
end $$;
create trigger trg_xp_school_data after insert on public.school_admissions_data for each row execute function public.xp_school_data();

-- profile sections: one generic trigger, kind passed as an argument
create or replace function public.xp_profile_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_jsonb(new)->>'deleted_at' is null then perform public.award_xp(new.user_id, tg_argv[0], 5, tg_table_name, new.id, 10); end if;
  return new;
end $$;
create trigger trg_xp_education after insert on public.education_records for each row execute function public.xp_profile_row('profile_education');
create trigger trg_xp_work after insert on public.work_experiences for each row execute function public.xp_profile_row('profile_work');
create trigger trg_xp_leadership after insert on public.leadership_experiences for each row execute function public.xp_profile_row('profile_leadership');
create trigger trg_xp_achievement after insert on public.achievements for each row execute function public.xp_profile_row('profile_achievement');
create trigger trg_xp_test after insert on public.test_scores for each row execute function public.xp_profile_row('profile_test');

-- career_goals -> career_goals_filled (once, when the three core fields are all non-empty)
create or replace function public.xp_career_goals() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(new.why_mba, '')) <> '' and btrim(coalesce(new.short_term_goal, '')) <> '' and btrim(coalesce(new.long_term_goal, '')) <> '' then
    perform public.award_xp(new.user_id, 'career_goals_filled', 15, 'career_goals', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_career_goals after insert or update on public.career_goals for each row execute function public.xp_career_goals();

-- recommenders -> recommender_added; recommendations -> recommendation_submitted
create or replace function public.xp_recommender() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null then perform public.award_xp(new.user_id, 'recommender_added', 5, 'recommenders', new.id, 10); end if;
  return new;
end $$;
create trigger trg_xp_recommender after insert on public.recommenders for each row execute function public.xp_recommender();

create or replace function public.xp_recommendation() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    perform public.award_xp(new.user_id, 'recommendation_submitted', 25, 'recommendations', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_recommendation after insert or update on public.recommendations for each row execute function public.xp_recommendation();

-- applications -> application_submitted
create or replace function public.xp_application() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.stage = 'submitted' and (tg_op = 'INSERT' or old.stage is distinct from 'submitted') then
    perform public.award_xp(new.user_id, 'application_submitted', 100, 'applications', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_application after insert or update on public.applications for each row execute function public.xp_application();

-- interview_sessions -> interview_completed; interview_feedback -> interview_feedback
create or replace function public.xp_interview_session() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform public.award_xp(new.user_id, 'interview_completed', 20, 'interview_sessions', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_interview_session after insert or update on public.interview_sessions for each row execute function public.xp_interview_session();

create or replace function public.xp_interview_feedback() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_xp(new.user_id, 'interview_feedback', 5, 'interview_feedback', new.id, 10);
  return new;
end $$;
create trigger trg_xp_interview_feedback after insert on public.interview_feedback for each row execute function public.xp_interview_feedback();

-- scholarships -> scholarship_applied
create or replace function public.xp_scholarship() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.status = 'applied' and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
    perform public.award_xp(new.user_id, 'scholarship_applied', 30, 'scholarships', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_scholarship after insert or update on public.scholarships for each row execute function public.xp_scholarship();

-- expenses -> expense_paid
create or replace function public.xp_expense() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    perform public.award_xp(new.user_id, 'expense_paid', 5, 'expenses', new.id, 10);
  end if;
  return new;
end $$;
create trigger trg_xp_expense after insert or update on public.expenses for each row execute function public.xp_expense();

-- ai_recommendations -> ai_rec_completed
create or replace function public.xp_ai_rec() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform public.award_xp(new.user_id, 'ai_rec_completed', 10, 'ai_recommendations', new.id, 10);
  end if;
  return new;
end $$;
create trigger trg_xp_ai_rec after insert or update on public.ai_recommendations for each row execute function public.xp_ai_rec();

-- admissions_decisions -> decision_admitted
create or replace function public.xp_decision() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.decision = 'admitted' and (tg_op = 'INSERT' or old.decision is distinct from 'admitted') then
    perform public.award_xp(new.user_id, 'decision_admitted', 200, 'admissions_decisions', new.id);
  end if;
  return new;
end $$;
create trigger trg_xp_decision after insert or update on public.admissions_decisions for each row execute function public.xp_decision();

-- document_versions -> document_version
create or replace function public.xp_document_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.documents d where d.id = new.document_id and d.deleted_at is not null) then
    perform public.award_xp(new.user_id, 'document_version', 5, 'document_versions', new.id, 10);
  end if;
  return new;
end $$;
create trigger trg_xp_document_version after insert on public.document_versions for each row execute function public.xp_document_version();

-- Atomic merge into applicant_profiles.settings.gamification (never touches other settings keys; creates the profile row if missing).
-- Allowed keys: daily_goal_xp (integer 10..200), last_seen_xp (>= 0, never lowered), last_seen_level (>= 1), last_seen_badges (array of text).
create or replace function public.update_gamification_settings(p jsonb) returns jsonb language plpgsql security invoker set search_path = public as $$
declare clean jsonb := '{}'; cur jsonb; v jsonb; result jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Expected an object'; end if;
  if p ? 'daily_goal_xp' then
    v := p->'daily_goal_xp';
    if jsonb_typeof(v) <> 'number' or (v::text) !~ '^[0-9]+$' or (v::text)::int not between 10 and 200 then raise exception 'daily_goal_xp must be a whole number from 10 to 200'; end if;
    clean := clean || jsonb_build_object('daily_goal_xp', v);
  end if;
  select settings->'gamification' into cur from public.applicant_profiles where user_id = auth.uid();
  if p ? 'last_seen_xp' then
    v := p->'last_seen_xp';
    if jsonb_typeof(v) <> 'number' or (v::text) !~ '^[0-9]+$' then raise exception 'last_seen_xp must be a non-negative whole number'; end if;
    clean := clean || jsonb_build_object('last_seen_xp', greatest((v::text)::bigint, coalesce(case when (cur->>'last_seen_xp') ~ '^[0-9]+$' then (cur->>'last_seen_xp')::bigint end, 0)));
  end if;
  if p ? 'last_seen_level' then
    v := p->'last_seen_level';
    if jsonb_typeof(v) <> 'number' or (v::text) !~ '^[0-9]+$' or (v::text)::int < 1 then raise exception 'last_seen_level must be a whole number of at least 1'; end if;
    clean := clean || jsonb_build_object('last_seen_level', v);
  end if;
  if p ? 'last_seen_badges' then
    v := p->'last_seen_badges';
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 then raise exception 'last_seen_badges must be a list'; end if;
    clean := clean || jsonb_build_object('last_seen_badges', v);
  end if;
  insert into public.applicant_profiles(user_id, settings) values (auth.uid(), jsonb_build_object('gamification', clean))
  on conflict (user_id) do update set settings = jsonb_set(public.applicant_profiles.settings, '{gamification}', coalesce(public.applicant_profiles.settings->'gamification', '{}'::jsonb) || clean, true)
  returning settings->'gamification' into result;
  return result;
end $$;
