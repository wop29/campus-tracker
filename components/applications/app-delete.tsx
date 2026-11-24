'use client';
// Safe delete for an application: an in-app dialog that names it, then an Undo bar for a few seconds.
// Deletes are soft (deleted_at), so Undo just clears deleted_at again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Button, Modal } from '@/components/ui';
import { useAction } from './data';

export const UNDO_MS = 8000;
export type DeleteTarget = { id: string; label: string };

/** "Duke Fuqua, Full-time MBA" */
export const deleteLabel = (school: string, program: string | null | undefined) => (program ? `${school}, ${program}` : school);

export function DeleteApplicationDialog({ target, onClose, onDeleted }: { target: DeleteTarget | null; onClose: () => void; onDeleted: (t: DeleteTarget) => void }) {
  const { busy, run } = useAction();
  async function del() {
    if (!target) return;
    const t = target;
    const ok = await run(async () => { await must(supabaseBrowser().from('applications').update({ deleted_at: new Date().toISOString() }).eq('id', t.id).select('id')); });
    if (ok) onDeleted(t);
  }
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `Delete ${target.label}?` : 'Delete application?'}>
      <p className="text-[15px] text-secondary">The checklist and deadlines for this application go with it. Your essays are kept. You can undo this for a few seconds after.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" className="min-h-11" onClick={onClose} autoFocus>Keep it</Button>
        <Button variant="danger" className="min-h-11" disabled={busy} onClick={() => void del()}><Trash2 size={14} aria-hidden /> {busy ? 'Deleting...' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}

/** Bottom bar with an Undo button, shown for UNDO_MS after a delete. */
export function UndoDeleteBar({ target, onDone, onRestored }: { target: DeleteTarget | null; onDone: () => void; onRestored: (t: DeleteTarget) => void }) {
  const { busy, run } = useAction();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const stop = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => {
    stop();
    if (!target) { setShownFor(null); return; }
    setShownFor(target.id);
    timer.current = setTimeout(onDone, UNDO_MS);
    return stop;
    // restart only when a different application is deleted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);
  if (!target || shownFor !== target.id) return null;
  async function undo() {
    if (!target) return;
    const t = target;
    stop();
    const ok = await run(async () => { await must(supabaseBrowser().from('applications').update({ deleted_at: null }).eq('id', t.id).select('id')); }, `${t.label} is back`);
    if (ok) onRestored(t); else onDone();
  }
  return (
    <div role="status" aria-live="polite" className="toast-in fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border-2 border-b-4 border-ink/80 bg-ink px-4 py-3 text-sm font-bold text-white shadow-lg">
      <span className="min-w-0 flex-1">Deleted {target.label}.</span>
      <button type="button" disabled={busy} onClick={() => void undo()} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border-2 border-white/70 px-3 font-extrabold hover:bg-white/15 disabled:opacity-60">
        <Undo2 size={15} aria-hidden /> Undo
      </button>
    </div>
  );
}
