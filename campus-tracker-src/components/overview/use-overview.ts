'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { loadOverviewData, type OverviewData } from '@/lib/overview-data';

/** Loads all dashboard data. `reload()` refetches after a write without flashing the whole page. */
export function useOverviewData() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const reload = useCallback(async () => {
    try {
      const d = await loadOverviewData(supabaseBrowser());
      setData(d); setNow(new Date()); setError(null);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, now };
}
