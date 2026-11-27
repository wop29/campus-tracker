-- 031: Oxford MBA 2027-28 stage deadlines and final decision dates, from Oxford Saïd's own pages (checked 2026-11-27).
-- Deadlines: https://www.sbs.ox.ac.uk/programmes/mbas/oxford-mba   Final decisions: https://www.sbs.ox.ac.uk/programmes/mbas/oxford-mba/how-apply
update public.program_requirements set
  decision_dates = '{"cycle": "2026-27", "policy": "fixed dates (hard deadlines, 23:59 UK time)", "rounds": [
    {"round": "Stage 1", "deadline": "2026-09-02", "decision_date": "2026-10-16", "decision_text": "Final decision: Friday 16 October 2026"},
    {"round": "Stage 2", "deadline": "2026-10-05", "decision_date": "2026-11-20", "decision_text": "Final decision: Friday 20 November 2026"},
    {"round": "Stage 3", "deadline": "2026-11-04", "decision_date": "2026-12-11", "decision_text": "Final decision: Friday 11 December 2026"},
    {"round": "Stage 4", "deadline": "2027-01-06", "decision_date": "2027-03-05", "decision_text": "Final decision: Friday 5 March 2027"},
    {"round": "Stage 5", "deadline": "2027-03-15", "decision_date": "2027-04-23", "decision_text": "Final decision: Friday 23 April 2027"},
    {"round": "Stage 6", "deadline": "2027-04-30", "decision_date": "2027-06-11", "decision_text": "Final decision: Friday 11 June 2027"}
  ], "source_url": "https://www.sbs.ox.ac.uk/programmes/mbas/oxford-mba"}'::jsonb,
  data = jsonb_set(coalesce(data, '{}'::jsonb), '{deadlines}', '{"value": "2027-28 cohort (September 2027 start). Stage 1: Sep 2, 2026 (decision Oct 16, 2026). Stage 2: Oct 5, 2026 (decision Nov 20, 2026). Stage 3: Nov 4, 2026 (decision Dec 11, 2026). Stage 4: Jan 6, 2027 (decision Mar 5, 2027). Stage 5: Mar 15, 2027 (decision Apr 23, 2027). Stage 6: Apr 30, 2027 (decision Jun 11, 2027). Deadlines are hard: an incomplete application is not considered in that stage. To be considered for University of Oxford scholarships, apply by Stage 4 (January).", "source_url": "https://www.sbs.ox.ac.uk/programmes/mbas/oxford-mba"}'::jsonb)
where school_name = 'Oxford Saïd' and program_name = 'Oxford MBA';

select program_name, jsonb_array_length(decision_dates->'rounds') as rounds, decision_dates->'rounds'->0->>'deadline' as first_deadline
from public.program_requirements where school_name = 'Oxford Saïd' and program_name = 'Oxford MBA';
