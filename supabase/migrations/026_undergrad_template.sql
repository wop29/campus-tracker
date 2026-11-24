-- 026: track-aware default checklist.
-- New applications get the undergrad template when the owner's onboarding track is 'undergrad'
-- (applicant_profiles.settings->'onboarding'->>'track'), or when the application is linked to an undergrad program.
-- Everyone else keeps the grad template (Interview preparation stays optional).
-- "Application form", "Application fee" and "Submission confirmation" keep their exact names: other code relies on them.
-- Only replaces the trigger function, so existing requirement rows and RLS are untouched. Safe to run more than once.

create or replace function public.application_track(p_user uuid, p_program_requirement uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.program_requirements pr where pr.id = p_program_requirement and pr.degree_type = 'undergrad') then 'undergrad'
    when exists (select 1 from public.program_requirements pr where pr.id = p_program_requirement) then 'grad'
    when (select ap.settings->'onboarding'->>'track' from public.applicant_profiles ap where ap.user_id = p_user and ap.deleted_at is null limit 1) = 'undergrad' then 'undergrad'
    else 'grad'
  end
$$;
revoke all on function public.application_track(uuid, uuid) from public;

create or replace function public.create_default_requirements() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.application_track(new.user_id, new.program_requirement_id) = 'undergrad' then
    insert into public.application_requirements(user_id, application_id, name, category, mandatory, sort_order, is_default, notes)
    select new.user_id, new.id, r.name, r.category, r.mandatory, r.ord, true, r.notes from (values
      (1,'Application form','form',true,'Common App, UCAS or the university''s own online form.'),
      (2,'School transcripts (rapor) and translation','academics',true,'Rapor from Grade 10 to 12, plus a certified English translation if the school asks for one.'),
      (3,'English test (IELTS/TOEFL/Duolingo)','tests',true,'Check which tests and minimum scores the university accepts.'),
      (4,'SAT/ACT (if the school requires it)','tests',false,'Many universities are test-optional. Waive this item if your school does not need it.'),
      (5,'Personal statement','essays',true,null),
      (6,'Counselor or teacher recommendation','recommendations',true,'Ask your school counselor or a teacher who knows you well, at least a month ahead.'),
      (7,'Financial documents (bank statement or sponsor letter)','other',true,'Often needed for the student visa too.'),
      (8,'Passport copy','other',true,null),
      (9,'Application fee','other',true,null),
      (10,'Submission confirmation','other',true,'Marked complete when you record your submission.')
    ) as r(ord,name,category,mandatory,notes);
  else
    insert into public.application_requirements(user_id, application_id, name, category, mandatory, sort_order, is_default)
    select new.user_id, new.id, r.name, r.category, r.mandatory, r.ord, true from (values
      (1,'Application profile','form',true),(2,'Resume','resume',true),(3,'Academic transcripts','academics',true),(4,'GMAT/GRE','tests',true),
      (5,'English proficiency','tests',true),(6,'Essay 1','essays',true),(7,'Essay 2','essays',true),(8,'Optional essay','essays',false),
      (9,'Recommendation 1','recommendations',true),(10,'Recommendation 2','recommendations',true),(11,'Employment history','other',true),
      (12,'Extracurricular information','other',false),(13,'Application form','form',true),(14,'Application fee','other',true),
      (15,'Interview preparation','other',false),(16,'Final review','other',true),(17,'Submission confirmation','other',true)
    ) as r(ord,name,category,mandatory);
  end if;
  return new;
end $$;
