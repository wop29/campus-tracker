import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRecommendations, planSync, snoozeUntil, type NbaInput, type Recommendation } from './nba.ts';
import type { StoredRecommendation } from './overview-data.ts';

let inFlight: Promise<void> | null = null;
const toRow = (r: Recommendation, userId: string) => ({ ...r, user_id: userId });
const fail = (e: { message: string } | null, what: string) => { if (e) throw new Error(`${what}: ${e.message}`); };

/**
 * Generates recommendations from the rules engine and persists them without duplicates.
 * Upserts on (user_id, dedupe_key); dismissed, completed and converted rows are never rewritten.
 * Concurrent calls share one run.
 */
export function syncRecommendations(sb: SupabaseClient, input: NbaInput): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run(sb, input).finally(() => { inFlight = null; });
  return inFlight;
}
async function run(sb: SupabaseClient, input: NbaInput) {
  const { data: u, error: ue } = await sb.auth.getUser();
  if (ue || !u.user) throw new Error('Not signed in');
  const uid = u.user.id;
  const { data: existing, error } = await sb.from('ai_recommendations').select('id,dedupe_key,status,snoozed_until');
  fail(error, 'Load recommendations');
  const plan = planSync(generateRecommendations(input), existing ?? [], input.now);
  const opts = { onConflict: 'user_id,dedupe_key' };
  if (plan.insert.length) fail((await sb.from('ai_recommendations').upsert(plan.insert.map((r) => ({ ...toRow(r, uid), status: 'new' })), { ...opts, ignoreDuplicates: true })).error, 'Save recommendations');
  if (plan.refresh.length) fail((await sb.from('ai_recommendations').upsert(plan.refresh.map((r) => toRow(r, uid)), opts)).error, 'Refresh recommendations');
  if (plan.resurface.length) fail((await sb.from('ai_recommendations').upsert(plan.resurface.map((r) => ({ ...toRow(r, uid), status: 'new', snoozed_until: null })), opts)).error, 'Resurface recommendations');
  if (plan.remove.length) fail((await sb.from('ai_recommendations').delete().in('id', plan.remove)).error, 'Remove resolved recommendations');
  if (plan.complete.length) fail((await sb.from('ai_recommendations').update({ status: 'completed' }).in('id', plan.complete)).error, 'Complete resolved recommendations');
}

export async function setRecStatus(sb: SupabaseClient, id: string, status: 'accepted' | 'dismissed' | 'completed') {
  fail((await sb.from('ai_recommendations').update({ status, snoozed_until: null }).eq('id', id)).error, 'Update recommendation');
}
export async function snoozeRec(sb: SupabaseClient, id: string, days: number, now = new Date()) {
  fail((await sb.from('ai_recommendations').update({ status: 'snoozed', snoozed_until: snoozeUntil(days, now) }).eq('id', id)).error, 'Snooze recommendation');
}
/** Creates a task from the recommendation, links it, and marks the recommendation converted. Task priority: 1 = highest. */
export async function convertRecToTask(sb: SupabaseClient, rec: StoredRecommendation) {
  const priority = { high: 1, medium: 3, low: 4 }[rec.priority];
  const { data, error } = await sb.from('application_tasks').insert({
    application_id: rec.application_id, title: rec.title, description: [rec.description, rec.reason].filter(Boolean).join(' '), due_date: rec.due_date,
    estimated_minutes: rec.effort_minutes && rec.effort_minutes > 0 ? rec.effort_minutes : null, priority, source: 'next_best_action',
  }).select('id').single();
  fail(error, 'Create task');
  const { error: e2 } = await sb.from('ai_recommendations').update({ status: 'converted', task_id: data!.id }).eq('id', rec.id);
  if (e2) {
    await sb.from('application_tasks').delete().eq('id', data!.id); // do not leave an orphan task if linking failed
    throw new Error(`Link task: ${e2.message}`);
  }
  return data!.id as string;
}
