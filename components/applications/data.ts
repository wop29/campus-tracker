'use client';
import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/toast';
import { friendlyDbError } from '@/lib/applications';

/** Runs a write with a double-submit guard, surfaces errors verbatim (trigger messages included) and toasts on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { toast(friendlyDbError(e instanceof Error ? e.message : String(e)), 'err'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [toast]);
  return { busy, run };
}
