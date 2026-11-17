-- Applications module: additive columns only.
-- submission_checklist: user confirmations for final-review items, keyed by item id (true/false).
-- final_essay_versions: snapshot { essay_id: version_number } recorded at submission.
alter table public.applications add column if not exists submission_checklist jsonb not null default '{}';
alter table public.applications add column if not exists final_essay_versions jsonb not null default '{}';
alter table public.applications add column if not exists submission_notes text;
alter table public.applications add column if not exists additional_requirements text;
-- Waitlist workspace and scholarship decision fields.
alter table public.admissions_decisions add column if not exists waitlist_contact text;
alter table public.admissions_decisions add column if not exists waitlist_materials text;
alter table public.admissions_decisions add column if not exists scholarship_decision text check (scholarship_decision is null or scholarship_decision in ('pending','awarded','none'));
