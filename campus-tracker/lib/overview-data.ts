import type { SupabaseClient } from '@supabase/supabase-js';

/** Minimal row shapes used by the overview, analytics, notifications and search modules. */
export type SchoolRow = { id: string; name: string; short_name: string | null; country: string | null; location: string | null; tier: string | null; in_portfolio: boolean; priority: number };
export type AppRow = {
  id: string; school_id: string; program: string; intake: string; round: string | null; priority: number; application_fee: number | null; fee_currency: string;
  stage: string; submission_confirmed_at: string | null; submitted_at: string | null; created_at: string;
};
export type DeadlineRow = { id: string; application_id: string; name: string; due_at: string; timezone: string; kind: string; is_primary: boolean };
export type ReqRow = { id: string; application_id: string; name: string; category: string; status: string; mandatory: boolean; due_date: string | null; essay_id: string | null; recommendation_id: string | null };
export type TaskRow = {
  id: string; application_id: string | null; title: string; status: string; due_date: string | null; estimated_minutes: number | null; priority: number;
  completed_at: string | null; created_at: string; source: string;
};
export type RecommendationRow = { id: string; recommender_id: string; application_id: string; status: string; deadline: string | null; submitted_at: string | null };
export type RecommenderRow = { id: string; name: string };
export type EssayRow = { id: string; application_id: string | null; school_id: string | null; title: string; word_limit: number | null; draft: string; status: string; deadline: string | null; created_at: string };
export type ExpenseRow = {
  id: string; school_id: string | null; application_id: string | null; category: string; description: string | null; estimated_cost: number | null; actual_cost: number | null;
  currency: string; fx_rate_to_base: number | null; payment_status: string; payment_date: string | null;
};
export type ScholarshipRow = { id: string; name: string; school_id: string | null; amount: number | null; currency: string; deadline: string | null; status: string };
export type InterviewRow = { id: string; application_id: string | null; school_id: string | null; kind: string; scheduled_at: string | null; status: string };
export type TestScoreRow = { id: string; test_type: string };
export type WorkRow = { id: string; company: string; position: string; measurable_impact: string | null };
export type AssessmentRow = { id: string; kind: string; subject_id: string | null };
export type DecisionRow = { id: string; application_id: string; decision: string; decision_date: string | null; deposit_deadline: string | null; waitlist_response_deadline: string | null; scholarship_amount: number | null; scholarship_currency: string | null; updated_at: string };
export type StoredRecommendation = {
  id: string; dedupe_key: string; title: string; description: string | null; school_id: string | null; application_id: string | null; priority: 'high' | 'medium' | 'low';
  reason: string | null; effort_minutes: number | null; due_date: string | null; expected_benefit: string | null; source: string; status: string;
  snoozed_until: string | null; task_id: string | null; score: number; score_breakdown: Record<string, number> | null; updated_at: string;
};

export type OverviewData = {
  schools: SchoolRow[]; applications: AppRow[]; deadlines: DeadlineRow[]; requirements: ReqRow[]; tasks: TaskRow[];
  recommendations: RecommendationRow[]; recommenders: RecommenderRow[]; essays: EssayRow[]; expenses: ExpenseRow[]; scholarships: ScholarshipRow[];
  interviews: InterviewRow[]; testScores: TestScoreRow[]; work: WorkRow[]; assessments: AssessmentRow[]; decisions: DecisionRow[];
  settings: Record<string, unknown>; profileExists: boolean;
};

const check = <T,>(r: { data: T[] | null; error: { message: string } | null }, label: string): T[] => {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data ?? [];
};

/** Loads every table the dashboard needs in parallel. Soft-deleted rows are excluded. Throws on any error. */
export async function loadOverviewData(sb: SupabaseClient): Promise<OverviewData> {
  const [schools, apps, deadlines, reqs, tasks, recs, recommenders, essays, expenses, scholarships, interviews, tests, work, assessments, decisions, profile] = await Promise.all([
    sb.from('schools').select('id,name,short_name,country,location,tier,in_portfolio,priority').is('deleted_at', null),
    sb.from('applications').select('id,school_id,program,intake,round,priority,application_fee,fee_currency,stage,submission_confirmed_at,submitted_at,created_at').is('deleted_at', null),
    sb.from('deadlines').select('id,application_id,name,due_at,timezone,kind,is_primary'),
    sb.from('application_requirements').select('id,application_id,name,category,status,mandatory,due_date,essay_id,recommendation_id'),
    sb.from('application_tasks').select('id,application_id,title,status,due_date,estimated_minutes,priority,completed_at,created_at,source'),
    sb.from('recommendations').select('id,recommender_id,application_id,status,deadline,submitted_at'),
    sb.from('recommenders').select('id,name').is('deleted_at', null),
    sb.from('essays').select('id,application_id,school_id,title,word_limit,draft,status,deadline,created_at').is('deleted_at', null),
    sb.from('expenses').select('id,school_id,application_id,category,description,estimated_cost,actual_cost,currency,fx_rate_to_base,payment_status,payment_date').is('deleted_at', null),
    sb.from('scholarships').select('id,name,school_id,amount,currency,deadline,status').is('deleted_at', null),
    sb.from('interview_sessions').select('id,application_id,school_id,kind,scheduled_at,status'),
    sb.from('test_scores').select('id,test_type').is('deleted_at', null),
    sb.from('work_experiences').select('id,company,position,measurable_impact').is('deleted_at', null),
    sb.from('ai_assessments').select('id,kind,subject_id'),
    sb.from('admissions_decisions').select('id,application_id,decision,decision_date,deposit_deadline,waitlist_response_deadline,scholarship_amount,scholarship_currency,updated_at'),
    sb.from('applicant_profiles').select('id,settings').is('deleted_at', null).maybeSingle(),
  ]);
  if (profile.error) throw new Error(`profile: ${profile.error.message}`);
  const appRows = check<AppRow>(apps as never, 'applications');
  const liveApps = new Set(appRows.map((a) => a.id));
  const ofLiveApp = <T extends { application_id: string | null }>(rows: T[]) => rows.filter((r) => r.application_id == null || liveApps.has(r.application_id));
  return {
    schools: check<SchoolRow>(schools as never, 'schools'),
    applications: appRows,
    deadlines: ofLiveApp(check<DeadlineRow>(deadlines as never, 'deadlines')),
    requirements: ofLiveApp(check<ReqRow>(reqs as never, 'requirements')),
    tasks: ofLiveApp(check<TaskRow>(tasks as never, 'tasks')),
    recommendations: ofLiveApp(check<RecommendationRow>(recs as never, 'recommendations')),
    recommenders: check<RecommenderRow>(recommenders as never, 'recommenders'),
    essays: check<EssayRow>(essays as never, 'essays'),
    expenses: check<ExpenseRow>(expenses as never, 'expenses'),
    scholarships: check<ScholarshipRow>(scholarships as never, 'scholarships'),
    interviews: ofLiveApp(check<InterviewRow>(interviews as never, 'interviews')),
    testScores: check<TestScoreRow>(tests as never, 'test scores'),
    work: check<WorkRow>(work as never, 'work experience'),
    assessments: check<AssessmentRow>(assessments as never, 'assessments'),
    decisions: ofLiveApp(check<DecisionRow>(decisions as never, 'decisions')),
    settings: ((profile.data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>,
    profileExists: Boolean(profile.data),
  };
}
