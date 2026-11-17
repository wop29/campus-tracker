// Client-side data access for gamification. Everything is read through the Supabase browser client (RLS applies).
// Nothing here writes XP: xp_events is written only by database triggers.
import type { SupabaseClient } from '@supabase/supabase-js';
import { IN_PROGRESS, SUBMITTED_OR_LATER } from './constants.ts';
import { parseGamificationSettings, type GamificationSettings, type QuestContext, type XpEvent } from './gamification.ts';
import type { JourneyData } from './journey.ts';

const PAGE = 1000, MAX_ROWS = 20000;
export async function fetchXpEvents(sb: SupabaseClient): Promise<XpEvent[]> {
  const out: XpEvent[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await sb.from('xp_events').select('kind,points,occurred_at').order('occurred_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as XpEvent[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type CountRes = PromiseLike<{ count: number | null; error: { message: string } | null }>;
const n = async (q: CountRes) => { const { count, error } = await q; if (error) throw new Error(error.message); return count ?? 0; };
const rows = async <T,>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => { const { data, error } = await q; if (error) throw new Error(error.message); return data ?? []; };
const hasKeys = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0;
const anyTrue = (v: unknown) => !!v && typeof v === 'object' && Object.values(v as object).some((x) => x === true);
const filled = (s: unknown) => typeof s === 'string' && s.trim() !== '';
const HEAD = { count: 'exact' as const, head: true };

/** Real counts and flags that drive the journey lessons and quest availability. */
export async function fetchJourneyBundle(sb: SupabaseClient): Promise<{ journey: JourneyData; ctx: QuestContext }> {
  const [
    education, work, leadership, achievements, tests, goals, stories,
    inPortfolio, withTier, sourcedPoints, comparisons,
    apps, deadlines, reqComplete, reqOpen, tasksOpen,
    essaysTotal, essaysDraft, essaysApproved, essaysOpen, reviewedAi, reviewedNotes,
    recommenders, recs, completedSessions, feedback, scholarships, expenses, scenarios, decisions,
  ] = await Promise.all([
    n(sb.from('education_records').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('work_experiences').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('leadership_experiences').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('achievements').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('test_scores').select('id', HEAD).is('deleted_at', null)),
    sb.from('career_goals').select('why_mba,short_term_goal,long_term_goal').maybeSingle(),
    n(sb.from('story_bank').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('schools').select('id', HEAD).eq('in_portfolio', true).is('deleted_at', null)),
    n(sb.from('schools').select('id', HEAD).eq('in_portfolio', true).not('tier', 'is', null).is('deleted_at', null)),
    n(sb.from('school_admissions_data').select('id', HEAD)),
    n(sb.from('saved_comparisons').select('id', HEAD)),
    rows<{ id: string; stage: string; submission_checklist: unknown }>(sb.from('applications').select('id,stage,submission_checklist').is('deleted_at', null)),
    rows<{ application_id: string }>(sb.from('deadlines').select('application_id')),
    n(sb.from('application_requirements').select('id,application:applications!inner(deleted_at)', HEAD).eq('status', 'complete').is('application.deleted_at', null)),
    n(sb.from('application_requirements').select('id,application:applications!inner(deleted_at)', HEAD).in('status', ['not_started', 'in_progress']).is('application.deleted_at', null)),
    n(sb.from('application_tasks').select('id', HEAD).neq('status', 'done')),
    n(sb.from('essays').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('essays').select('id', HEAD).neq('draft', '').is('deleted_at', null)),
    n(sb.from('essays').select('id', HEAD).in('status', ['approved', 'submitted']).is('deleted_at', null)),
    n(sb.from('essays').select('id', HEAD).not('status', 'in', '(approved,submitted)').is('deleted_at', null)),
    n(sb.from('essay_versions').select('id', HEAD).not('ai_review', 'is', null)),
    n(sb.from('essay_versions').select('id', HEAD).not('user_comments', 'is', null)),
    n(sb.from('recommenders').select('id', HEAD).is('deleted_at', null)),
    rows<{ status: string }>(sb.from('recommendations').select('status,application:applications!inner(deleted_at)').is('application.deleted_at', null)),
    n(sb.from('interview_sessions').select('id', HEAD).eq('status', 'completed')),
    n(sb.from('interview_feedback').select('id', HEAD)),
    n(sb.from('scholarships').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('expenses').select('id', HEAD).is('deleted_at', null)),
    n(sb.from('financial_projections').select('id', HEAD)),
    rows<{ decision: string; matrix_scores: unknown }>(sb.from('admissions_decisions').select('decision,matrix_scores,application:applications!inner(deleted_at)').is('application.deleted_at', null)),
  ]);
  if (goals.error) throw new Error(goals.error.message);
  const g = goals.data as { why_mba: string | null; short_term_goal: string | null; long_term_goal: string | null } | null;
  const appIds = new Set(apps.map((a) => a.id));
  const journey: JourneyData = {
    profile: { education, work, leadership, achievements, tests, careerGoalsComplete: !!g && filled(g.why_mba) && filled(g.short_term_goal) && filled(g.long_term_goal), stories },
    schools: { inPortfolio, withTier, sourcedPoints, comparisons },
    applications: { total: apps.length, withDeadline: new Set(deadlines.map((d) => d.application_id).filter((id) => appIds.has(id))).size, requirementsComplete: reqComplete },
    essays: { total: essaysTotal, withDraft: essaysDraft, reviewedVersions: reviewedAi + reviewedNotes, approved: essaysApproved },
    recs: { recommenders, assigned: recs.length, briefed: recs.filter((r) => ['briefing_sent', 'in_progress', 'submitted'].includes(r.status)).length, submitted: recs.filter((r) => r.status === 'submitted').length },
    interview: { completedSessions, feedback },
    funding: { scholarships, expenses, scenarios },
    decide: { checklistStarted: apps.filter((a) => anyTrue(a.submission_checklist)).length, submitted: apps.filter((a) => (SUBMITTED_OR_LATER as readonly string[]).includes(a.stage)).length, decisionsRecorded: decisions.filter((d) => d.decision !== 'awaiting').length, offersCompared: decisions.filter((d) => hasKeys(d.matrix_scores)).length },
  };
  const ctx: QuestContext = { openRequirements: reqOpen, openTasks: tasksOpen, essaysInProgress: essaysOpen, activeApplications: apps.filter((a) => (IN_PROGRESS as readonly string[]).includes(a.stage)).length };
  return { journey, ctx };
}

export async function fetchGamificationSettings(sb: SupabaseClient): Promise<GamificationSettings> {
  const { data, error } = await sb.from('applicant_profiles').select('settings').maybeSingle();
  if (error) throw new Error(error.message);
  return parseGamificationSettings((data as { settings?: unknown } | null)?.settings);
}

export type GamificationPatch = { daily_goal_xp?: number; last_seen_xp?: number; last_seen_level?: number; last_seen_badges?: string[] };
/** Atomic merge on the server (rpc update_gamification_settings): never clobbers other settings keys, creates the profile row if missing. */
export async function saveGamificationSettings(sb: SupabaseClient, patch: GamificationPatch): Promise<GamificationSettings> {
  const { data, error } = await sb.rpc('update_gamification_settings', { p: patch });
  if (error) throw new Error(error.message);
  return parseGamificationSettings({ gamification: data });
}
