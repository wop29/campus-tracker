'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
/** Runs a Supabase query on mount and whenever deps change. `reload()` re-runs it after a write. */
export function useQuery<T>(fn: (sb: SupabaseClient) => Res<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fnRef.current(supabaseBrowser());
    setData(data); setError(error?.message ?? null); setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, error, loading, reload };
}
/** Throws on a Supabase error so callers can try/catch and show it. */
export async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
