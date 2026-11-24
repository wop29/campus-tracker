-- 023: simple submit flow and result countdown. Additive and idempotent: safe to run more than once.
--
-- Submitting: no guard change is needed. guard_application_stage (001, fixed in 017) only asks that
-- submission_confirmed_at is set when the stage becomes 'submitted'. It does not ask for stage 'ready' first or for
-- every mandatory requirement to be complete, so the owner can already move straight from any preparing stage to
-- 'submitted' with an explicit submitted_at. Row level security on applications is unchanged.
-- scripts/test-db.mjs covers this ("023: owner can submit straight from preparing ...").

-- Published decision dates per program. Loaded separately; null until researched. Shape:
-- {"cycle": "2026-2027", "rounds": [{"round": "Round 1", "deadline": "2026-09-10", "decision_date": "2026-12-10", "decision_text": null}],
--  "policy": "rolling or fixed, free text", "source_url": "https://..."}
alter table public.program_requirements add column if not exists decision_dates jsonb;

-- The applicant's own expected result date, used when the school has not published one.
alter table public.applications add column if not exists expected_result_on date;
-- The round the applicant picked for the result countdown, when it cannot be worked out from the submitted date.
alter table public.applications add column if not exists result_round text;
