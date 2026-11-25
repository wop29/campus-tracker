-- 030: an essay's deadline always comes from its application's real deadline (the deadlines table), never typed by hand.
-- Linked essays follow the application's primary (or earliest submission) deadline; when the application has none, it is null.
-- Essays with no application keep whatever they had. Plain (security invoker) triggers, so RLS still applies. Idempotent.
create or replace function public.application_deadline(p_app uuid) returns timestamptz
language sql stable set search_path = public as $$
  select d.due_at from public.deadlines d where d.application_id = p_app
  order by d.is_primary desc, (d.kind = 'submission') desc, d.due_at asc limit 1
$$;

create or replace function public.essay_deadline_from_application() returns trigger language plpgsql set search_path = public as $$
begin
  if new.application_id is not null then new.deadline := public.application_deadline(new.application_id); end if;
  return new;
end $$;
drop trigger if exists essays_deadline_from_application on public.essays;
create trigger essays_deadline_from_application before insert or update of application_id, deadline on public.essays
  for each row execute function public.essay_deadline_from_application();

create or replace function public.sync_essay_deadlines() returns trigger language plpgsql set search_path = public as $$
declare app uuid := coalesce(new.application_id, old.application_id);
begin
  update public.essays e set deadline = public.application_deadline(app) where e.application_id = app and e.deadline is distinct from public.application_deadline(app);
  if tg_op = 'UPDATE' and old.application_id is distinct from new.application_id then
    update public.essays e set deadline = public.application_deadline(old.application_id) where e.application_id = old.application_id;
  end if;
  return null;
end $$;
drop trigger if exists deadlines_sync_essays on public.deadlines;
create trigger deadlines_sync_essays after insert or update or delete on public.deadlines
  for each row execute function public.sync_essay_deadlines();

-- Backfill existing linked essays.
update public.essays e set deadline = public.application_deadline(e.application_id)
where e.application_id is not null and e.deadline is distinct from public.application_deadline(e.application_id);
