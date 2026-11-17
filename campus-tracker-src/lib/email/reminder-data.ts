// Server-only data access for the daily reminder cron. Uses the Supabase service role key, which bypasses RLS,
// so every query here is explicitly filtered by user_id. Never import this from client code.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NbaInput } from '@/lib/nba';
import type { AppRow, AssessmentRow, DeadlineRow, EssayRow, ExpenseRow, InterviewRow, RecommendationRow, RecommenderRow, ReqRow, SchoolRow, TaskRow, TestScoreRow, WorkRow } from '@/lib/overview-data';

export type ReminderInput = Omit<NbaInput, 'now'>;
export type ProfileRow = { user_id: string; preferred_name: string | null; full_name: string | null; email: string | null; settings: Record<string, unknown> | null };

/** Service role client, or null when the env is missing. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

const PAGE = 1000;
type Q = { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
/** Reads every page of a query (PostgREST returns at most 1000 rows per request). */
async function all<T>(make: () => Q, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Profiles that finished onboarding (the only ones that can ever be emailed). */
export async function loadOnboardedProfiles(sb: SupabaseClient, limit: number): Promise<ProfileRow[]> {
  const { data, error } = await sb.from('applicant_profiles').select('user_id,preferred_name,full_name,email,settings')
    .is('deleted_at', null).eq('settings->onboarding->>done', 'true').order('user_id').limit(limit);
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data ?? []) as ProfileRow[];
}

export async function loadAccountEmails(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await all<{ id: string; email: string | null }>(() => sb.from('users').select('id,email').in('id', ids.slice(i, i + 100)).order('id') as unknown as Q, 'users');
    for (const r of rows) if (r.email) out.set(r.id, r.email);
  }
  return out;
}

/** reminder_log dates on or after `since` (YYYY-MM-DD), grouped by user. */
export async function loadSentDates(sb: SupabaseClient, ids: string[], since: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await all<{ user_id: string; sent_on: string }>(() => sb.from('reminder_log').select('user_id,sent_on').in('user_id', ids.slice(i, i + 100)).gte('sent_on', since).order('user_id').order('sent_on') as unknown as Q, 'reminder_log');
    for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.sent_on]);
  }
  return out;
}

const CHUNK = 25;
type WithUser<T> = T & { user_id: string };

/** Loads what the Next Best Actions engine needs for many users with a handful of paged queries per chunk of 25. */
export async function loadReminderInputs(sb: SupabaseClient, ids: string[]): Promise<Map<string, ReminderInput>> {
  const out = new Map<string, ReminderInput>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const q = (table: string, cols: string, notDeleted = false) => () => {
      let b = sb.from(table).select(`user_id,${cols}`).in('user_id', chunk);
      if (notDeleted) b = b.is('deleted_at', null);
      return b.order('id') as unknown as Q;
    };
    const [schools, apps, deadlines, reqs, tasks, recs, recommenders, essays, expenses, interviews, tests, work, assessments] = await Promise.all([
      all<WithUser<SchoolRow>>(q('schools', 'id,name,short_name,country,location,tier,in_portfolio,priority', true), 'schools'),
      all<WithUser<AppRow>>(q('applications', 'id,school_id,program,intake,round,priority,application_fee,fee_currency,stage,submission_confirmed_at,submitted_at,created_at', true), 'applications'),
      all<WithUser<DeadlineRow>>(q('deadlines', 'id,application_id,name,due_at,timezone,kind,is_primary'), 'deadlines'),
      all<WithUser<ReqRow>>(q('application_requirements', 'id,application_id,name,category,status,mandatory,due_date,essay_id,recommendation_id'), 'requirements'),
      all<WithUser<TaskRow>>(q('application_tasks', 'id,application_id,title,status,due_date,estimated_minutes,priority,completed_at,created_at,source'), 'tasks'),
      all<WithUser<RecommendationRow>>(q('recommendations', 'id,recommender_id,application_id,status,deadline,submitted_at'), 'recommendations'),
      all<WithUser<RecommenderRow>>(q('recommenders', 'id,name', true), 'recommenders'),
      all<WithUser<EssayRow>>(q('essays', 'id,application_id,school_id,title,word_limit,draft,status,deadline,created_at', true), 'essays'),
      all<WithUser<ExpenseRow>>(q('expenses', 'id,school_id,application_id,category,description,estimated_cost,actual_cost,currency,fx_rate_to_base,payment_status,payment_date', true), 'expenses'),
      all<WithUser<InterviewRow>>(q('interview_sessions', 'id,application_id,school_id,kind,scheduled_at,status'), 'interviews'),
      all<WithUser<TestScoreRow>>(q('test_scores', 'id,test_type', true), 'test scores'),
      all<WithUser<WorkRow>>(q('work_experiences', 'id,company,position,measurable_impact', true), 'work'),
      all<WithUser<AssessmentRow>>(q('ai_assessments', 'id,kind,subject_id'), 'assessments'),
    ]);
    for (const uid of chunk) {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === uid);
      const applications = mine(apps);
      const live = new Set(applications.map((a) => a.id));
      const ofLive = <T extends { user_id: string; application_id: string | null }>(rows: T[]) => mine(rows).filter((r) => r.application_id == null || live.has(r.application_id));
      out.set(uid, {
        schools: mine(schools), applications, deadlines: ofLive(deadlines), requirements: ofLive(reqs), tasks: ofLive(tasks),
        recommendations: ofLive(recs), recommenders: mine(recommenders), essays: mine(essays), expenses: mine(expenses),
        interviews: ofLive(interviews), testScores: mine(tests), work: mine(work), assessments: mine(assessments),
      });
    }
  }
  return out;
}

/** Current streak per user in their own time zone (rpc reminder_streaks, migration 020). Missing users get 0. */
export async function loadStreaks(sb: SupabaseClient, users: { id: string; tz: string }[], now: Date): Promise<{ map: Map<string, { streak: number; activeToday: boolean }>; error: string | null }> {
  const map = new Map<string, { streak: number; activeToday: boolean }>();
  let error: string | null = null;
  for (let i = 0; i < users.length; i += 200) {
    const chunk = users.slice(i, i + 200);
    const { data, error: e } = await sb.rpc('reminder_streaks', { p_users: chunk.map((u) => u.id), p_tzs: chunk.map((u) => u.tz), p_now: now.toISOString() });
    if (e) { error = e.message; continue; }
    for (const r of (data ?? []) as { user_id: string; streak: number; active_today: boolean }[]) map.set(r.user_id, { streak: r.streak ?? 0, activeToday: Boolean(r.active_today) });
  }
  return { map, error };
}
