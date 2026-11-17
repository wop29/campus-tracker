'use client';
import { useState } from 'react';
import { useQuery, must } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { DEFAULT_BASE_CURRENCY, currencyCode } from '@/lib/finance';

/** Base currency lives in applicant_profiles.settings.base_currency. Falls back to USD (flagged as `isSet = false`). */
export function useBaseCurrency() {
  const q = useQuery<{ id: string; settings: Record<string, unknown> | null } | null>((sb) => sb.from('applicant_profiles').select('id,settings').maybeSingle(), []);
  const [saving, setSaving] = useState(false);
  const stored = typeof q.data?.settings?.base_currency === 'string' ? (q.data.settings.base_currency as string).toUpperCase() : null;
  async function save(code: string): Promise<string | null> {
    const p = currencyCode.safeParse(code); if (!p.success) return p.error.issues[0].message;
    if (saving) return null;
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const settings = { ...(q.data?.settings ?? {}), base_currency: p.data };
      if (q.data?.id) await must(sb.from('applicant_profiles').update({ settings }).eq('id', q.data.id));
      else await must(sb.from('applicant_profiles').insert({ settings }));
      await q.reload(); return null;
    } catch (e) { return (e as Error).message; } finally { setSaving(false); }
  }
  return { base: stored ?? DEFAULT_BASE_CURRENCY, isSet: stored != null, loading: q.loading, error: q.error, save, saving };
}
