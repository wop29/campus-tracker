'use client';
// Shared data helpers for the essays and recommendations modules.
import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@/lib/hooks';

export type SchoolLite = { id: string; name: string; short_name: string | null };
export type AppLite = { id: string; school_id: string; program: string; intake: string; round: string | null; stage: string; schools: { name: string; short_name: string | null } | null; deadlines?: { due_at: string; is_primary: boolean; kind: string }[] | null };

/** The application's real deadline (primary first, then the earliest submission deadline), the same rule the database uses for essays. */
export function appDeadline(a: AppLite | undefined | null): string | null {
  const ds = [...(a?.deadlines ?? [])].sort((x, y) => Number(y.is_primary) - Number(x.is_primary) || Number(y.kind === 'submission') - Number(x.kind === 'submission') || x.due_at.localeCompare(y.due_at));
  return ds[0]?.due_at ?? null;
}

export const appLabel = (a: AppLite) => `${a.schools?.short_name || a.schools?.name || 'School'} - ${[a.program, a.intake, a.round].filter(Boolean).join(', ')}`;

/** Schools and live applications, for pickers and labels. */
export function useSchoolsApps() {
  const schools = useQuery<SchoolLite[]>((sb) => sb.from('schools').select('id,name,short_name').is('deleted_at', null).order('name'), []);
  const apps = useQuery<AppLite[]>((sb) => sb.from('applications').select('id,school_id,program,intake,round,stage,schools(name,short_name),deadlines(due_at,is_primary,kind)').is('deleted_at', null).order('created_at', { ascending: false }) as never, []);
  return { schools: schools.data ?? [], apps: apps.data ?? [], loading: schools.loading || apps.loading, error: schools.error || apps.error, reload: () => { void schools.reload(); void apps.reload(); } };
}

/** Recomputes story_bank.usage_count from live essay_stories links (links to soft-deleted essays do not count). Never increments blindly. */
export async function syncStoryUsage(sb: SupabaseClient, storyIds: string[]) {
  for (const id of Array.from(new Set(storyIds))) {
    const { data, error } = await sb.from('essay_stories').select('essay_id, essays!inner(deleted_at)').eq('story_id', id).is('essays.deleted_at', null);
    if (error) throw new Error(error.message);
    const { error: e2 } = await sb.from('story_bank').update({ usage_count: data?.length ?? 0 }).eq('id', id);
    if (e2) throw new Error(e2.message);
  }
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
