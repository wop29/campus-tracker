-- 028: My Profile tests for every track. Adds SAT, ACT, PTE Academic and the Duolingo English Test, plus a status so a
-- student can save a test they plan to take ('planned', target date optional, no score yet). Existing rows stay 'taken'.
-- Idempotent. Only constraints and a column change, so the existing row-level security policies keep applying.
alter table public.test_scores drop constraint if exists test_scores_test_type_check;
alter table public.test_scores add constraint test_scores_test_type_check
  check (test_type in ('GMAT','GRE','SAT','ACT','IELTS','TOEFL','PTE','DUOLINGO','OTHER'));
alter table public.test_scores add column if not exists status text not null default 'taken';
alter table public.test_scores drop constraint if exists test_scores_status_check;
alter table public.test_scores add constraint test_scores_status_check check (status in ('taken','planned'));
