// Server-only data access for the reminder cron. Uses the Supabase service role key, which bypasses RLS,
// so every query here is explicitly filtered by user_id. Never import this from client code.
// The rows the decision needs are loaded by ./reminder-rows (shared with the Settings preview).
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { all, type Q } from './reminder-rows';

export type ProfileRow = { user_id: string; preferred_name: string | null; full_name: string | null; email: string | null; settings: Record<string, unknown> | null; created_at: string | null };

/** Service role client, or null when the env is missing. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Profiles that finished onboarding (the only ones that can ever be emailed). */
export async function loadOnboardedProfiles(sb: SupabaseClient, limit: number): Promise<ProfileRow[]> {
  const { data, error } = await sb.from('applicant_profiles').select('user_id,preferred_name,full_name,email,settings,created_at')
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
