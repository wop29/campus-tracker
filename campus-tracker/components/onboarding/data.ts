'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveSettingsPatch } from '@/lib/settings';
import { parseOnboarding, toStoredOnboarding, type Onboarding } from '@/lib/onboarding';

/** Fired on window when the user finishes or skips onboarding, so the app shell stops redirecting to /welcome. */
export const ONBOARDING_DONE_EVENT = 'onboarding:done';

/** Reads the whole settings jsonb for the signed-in user (null when there is no profile row yet). */
export async function loadSettings(sb: SupabaseClient): Promise<Record<string, unknown> | null> {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.settings as Record<string, unknown> | null) ?? null;
}

export async function loadOnboarding(sb: SupabaseClient): Promise<Onboarding> {
  return parseOnboarding(await loadSettings(sb));
}

/** Saves onboarding (plus optional extra settings keys such as theme) without touching other settings keys. */
export async function saveOnboarding(sb: SupabaseClient, ob: Onboarding, extra: Record<string, unknown> = {}): Promise<Onboarding> {
  const stored = toStoredOnboarding(ob);
  await saveSettingsPatch(sb, { ...extra, onboarding: stored });
  if (typeof window !== 'undefined' && stored.done) window.dispatchEvent(new Event(ONBOARDING_DONE_EVENT));
  return stored;
}
