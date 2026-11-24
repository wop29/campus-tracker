-- BUG-001: the Ready guard did not run correctly on INSERT, because default requirements are created
-- after the row exists, so a new application could be inserted directly as 'ready'.
-- A brand new application always has unfinished mandatory requirements, so Ready is never valid on insert.
create or replace function public.guard_application_stage() returns trigger language plpgsql security definer set search_path = public as $$
declare open_count int;
begin
  if new.stage = 'ready' and tg_op = 'INSERT' then
    raise exception 'Cannot create an application as Ready: mandatory requirements are not complete' using errcode = 'P0001';
  end if;
  if new.stage = 'ready' and tg_op = 'UPDATE' and old.stage is distinct from 'ready' then
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
