'use client';
// Recommendation writes, including keeping the matching application_requirements row in step.
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirementNameFor, requirementTarget, statusPatch, type RecStatus, type RecommendationRow } from '@/lib/recommendations';

type ReqRow = { id: string; status: string; recommendation_id: string | null };
async function findRequirement(sb: SupabaseClient, applicationId: string, name: string): Promise<ReqRow | null> {
  const { data, error } = await sb.from('application_requirements').select('id,status,recommendation_id').eq('application_id', applicationId).eq('category', 'recommendations').eq('name', name).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as ReqRow | undefined) ?? null;
}

/** Marks the matching requirement complete / reopens it. Returns a note for the user when nothing could be matched. */
export async function syncRequirement(sb: SupabaseClient, rec: RecommendationRow, allRecs: RecommendationRow[], prev: RecStatus | null, next: RecStatus): Promise<string | null> {
  const target = requirementTarget(prev, next); if (!target) return null;
  const name = requirementNameFor(rec.id, allRecs.filter((r) => r.application_id === rec.application_id));
  if (!name) return 'This is the third or later recommender for this application, so no default checklist item was updated.';
  const req = await findRequirement(sb, rec.application_id, name);
  if (!req) return `No "${name}" item exists on this application's checklist, so it was not updated.`;
  if (req.status === 'waived') return `"${name}" is waived on the checklist, so it was left as is.`;
  if (target === 'complete') {
    const { error } = await sb.from('application_requirements').update({ status: 'complete', recommendation_id: rec.id }).eq('id', req.id);
    if (error) throw new Error(error.message);
  } else if (req.status === 'complete' && (req.recommendation_id === rec.id || req.recommendation_id === null)) {
    const { error } = await sb.from('application_requirements').update({ status: 'in_progress' }).eq('id', req.id);
    if (error) throw new Error(error.message);
  }
  return null;
}

export async function changeRecStatus(sb: SupabaseClient, rec: RecommendationRow, allRecs: RecommendationRow[], next: RecStatus): Promise<string | null> {
  if (rec.status === next) return null;
  const { error } = await sb.from('recommendations').update(statusPatch(next)).eq('id', rec.id);
  if (error) throw new Error(error.message);
  try { return await syncRequirement(sb, rec, allRecs, rec.status, next); }
  catch (e) { throw new Error(`Status saved, but the application checklist could not be updated: ${(e as Error).message}`); }
}

export async function deleteRecommendation(sb: SupabaseClient, rec: RecommendationRow, allRecs: RecommendationRow[]) {
  if (rec.status === 'submitted') await syncRequirement(sb, rec, allRecs, 'submitted', 'not_contacted');
  const { error } = await sb.from('recommendations').delete().eq('id', rec.id);
  if (error) throw new Error(error.message);
}

/** Links the new recommendation to its default checklist item (by order of assignment) without changing the item's status. */
export async function linkRequirement(sb: SupabaseClient, rec: RecommendationRow, allRecs: RecommendationRow[]) {
  const name = requirementNameFor(rec.id, allRecs.filter((r) => r.application_id === rec.application_id)); if (!name) return;
  const req = await findRequirement(sb, rec.application_id, name);
  if (req && req.recommendation_id === null) await sb.from('application_requirements').update({ recommendation_id: rec.id }).eq('id', req.id);
}
