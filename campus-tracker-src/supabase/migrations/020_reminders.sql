-- Daily email reminders (see docs/REMINDERS.md).
--
--  * reminder_log: one row per user per LOCAL date an email went out. The primary key (user_id, sent_on) makes the
--    cron idempotent: the server claims the row before sending, so calling the endpoint twice (or hourly) never
--    sends two emails on the same day. Written only by the server with the service role key; users can read their own.
--  * Unsubscribe links need no table: the token is an HMAC of the user id with REMINDER_SECRET (server env).
--  * reminder_streaks(): current streak per user in their own time zone, in one query, for the cron.
-- Safe to run more than once.

create table if not exists public.reminder_log (
  user_id uuid not null references public.users(id) on delete cascade,
  sent_on date not null,
  sent_at timestamptz default now(),
  subject text,
  primary key (user_id, sent_on)
);
alter table public.reminder_log enable row level security;
drop policy if exists owner_select on public.reminder_log;
create policy owner_select on public.reminder_log for select using (user_id = auth.uid());
-- No insert/update/delete policy: browsers cannot write here. The service role bypasses RLS.

-- Current streak per user: consecutive local days with at least one xp_events row, ending today or yesterday
-- (same rule as computeStreak in lib/gamification.ts). Security invoker, so a signed-in user only ever sees their
-- own rows through RLS; the cron calls it with the service role for a batch of users.
create or replace function public.reminder_streaks(p_users uuid[], p_tzs text[], p_now timestamptz default now())
returns table (user_id uuid, streak int, active_today boolean)
language sql stable set search_path = public as $$
  with u as (
    select t.uid, t.tz from unnest(p_users, p_tzs) as t(uid, tz)
  ),
  d as (
    select distinct u.uid, (x.occurred_at at time zone u.tz)::date as day, (p_now at time zone u.tz)::date as today
    from u join public.xp_events x on x.user_id = u.uid
    where x.occurred_at >= p_now - interval '400 days' and x.occurred_at <= p_now
  ),
  g as (
    select uid, day, today, day - (row_number() over (partition by uid order by day))::int as grp from d
  ),
  islands as (
    select uid, today, max(day) as last_day, count(*)::int as len from g group by uid, today, grp
  )
  select u.uid,
         coalesce(max(i.len) filter (where i.last_day >= i.today - 1), 0)::int,
         coalesce(bool_or(i.last_day = i.today), false)
  from u left join islands i on i.uid = u.uid
  group by u.uid
$$;
revoke all on function public.reminder_streaks(uuid[], text[], timestamptz) from public;
do $$ declare r text; begin
  foreach r in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.reminder_streaks(uuid[], text[], timestamptz) to %I', r);
    end if;
  end loop;
end $$;
