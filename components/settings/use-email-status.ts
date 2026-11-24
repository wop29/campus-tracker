'use client';
import { useEffect, useState } from 'react';

/**
 * Whether the server can send reminder emails. null while checking (or if the check fails), so callers can
 * show the neutral promise until the answer arrives instead of a wrong "not connected" flash.
 */
export function useEmailConfigured(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/reminders/status', { cache: 'no-store' })
      .then(async (r) => { const j = r.ok ? ((await r.json()) as { email?: unknown }) : null; if (!cancelled) setOn(typeof j?.email === 'boolean' ? j.email : null); })
      .catch(() => { if (!cancelled) setOn(null); });
    return () => { cancelled = true; };
  }, []);
  return on;
}
