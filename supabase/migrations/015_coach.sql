-- Coach / Interview module: additive changes only.
-- Verified historical interview questions must carry a source note and can only be entered by the user.
alter table public.interview_questions add column if not exists source_note text;
alter table public.interview_questions drop constraint if exists interview_questions_verified_needs_source;
alter table public.interview_questions add constraint interview_questions_verified_needs_source
  check (origin <> 'verified_historical' or (source_note is not null and length(btrim(source_note)) > 0));
create index if not exists interview_questions_user_session_idx on public.interview_questions (user_id, session_id);
create index if not exists ai_assessments_user_kind_idx on public.ai_assessments (user_id, kind, created_at desc);
create index if not exists interview_feedback_question_idx on public.interview_feedback (question_id);
