-- Additive: explicit user confirmation that they have checked eligibility against published requirements.
alter table public.scholarships add column if not exists eligibility_checked boolean not null default false;
-- One tracking record per scholarship keeps the "applied" link idempotent.
create unique index if not exists scholarship_applications_one_per_scholarship on public.scholarship_applications (scholarship_id);
