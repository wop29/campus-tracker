'use client';
import { useEffect, useLayoutEffect } from 'react';
import { supabaseBrowser, supabaseConfigured } from '@/lib/supabase/client';
import { DEFAULT_THEME, applyTheme, isThemeId, readThemeCookie, writeThemeCookie } from './themes';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Renders nothing. Applies the cookie hint immediately, then (when `fromDb`) reads the saved theme from
 * applicant_profiles.settings.theme and applies it. A failed read keeps whatever is already applied.
 */
export function ThemeLoader({ fromDb = true }: { fromDb?: boolean }) {
  useIsoLayoutEffect(() => { applyTheme(readThemeCookie() ?? DEFAULT_THEME); }, []);
  useEffect(() => {
    if (!fromDb || !supabaseConfigured()) return;
    let cancelled = false;
    const sb = supabaseBrowser();
    void (async () => {
      try {
        const { data: u } = await sb.auth.getUser();
        if (!u.user) return;
        const { data, error } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
        if (error || cancelled) return;
        const t = (data?.settings as Record<string, unknown> | null)?.theme;
        if (isThemeId(t)) { applyTheme(t); writeThemeCookie(t); }
      } catch { /* keep current theme */ }
    })();
    return () => { cancelled = true; };
  }, [fromDb]);
  return null;
}
