-- 024: reminder kinds (see docs/REMINDERS.md).
-- Emails are no longer "one every day". Each email now has a kind, recorded here so the cadence can be worked out
-- from history (for example: which nudges already went out since the student was last active).
--   deadline_week   a deadline is 7, 3 or 1 day(s) away
--   result_soon     a result is expected tomorrow or today
--   nudge           a gentle check-in after 2 full days without progress (then day 5 and day 12)
--   nudge_final     the single "we will be here when you are ready" note after 3 weeks; nothing after it
--   celebration     a milestone was reached yesterday
-- Rows written before this migration keep kind = null; the app counts those as nudges.
-- Safe to run more than once.
alter table public.reminder_log add column if not exists kind text;
comment on column public.reminder_log.kind is 'deadline_week | result_soon | nudge | nudge_final | celebration (null = sent before migration 024)';
create index if not exists reminder_log_user_kind_idx on public.reminder_log (user_id, kind, sent_on);
