'use client';
import { useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { friendlyDbError } from '@/lib/applications';
import { startProgramApplication } from '@/components/applications/program-start';
import { planAdd, type CatalogueProgram, type ExistingSchool, type University } from '@/lib/catalogue';

type Props = {
  open: boolean; onClose: () => void; picks: CatalogueProgram[]; unis: University[]; mine: ExistingSchool[];
  started: Set<string>; intake?: string; onDone: () => void;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errText = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); try { return friendlyDbError(m); } catch { return m; } };

/** Confirms the picked programs, then adds their universities to the student's list and, if asked, starts the applications. */
export function CatalogueAddModal({ open, onClose, picks, unis, mine, started, intake, onDone }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'add' | 'start'>(null);
  const names = [...new Set(picks.map((p) => p.school))];
  const toStart = picks.filter((p) => !started.has(p.program.id));
  const already = picks.length - toStart.length;

  async function run(start: boolean) {
    if (busy) return; setBusy(start ? 'start' : 'add');
    const sb = supabaseBrowser();
    try {
      const plan = planAdd(unis.filter((u) => names.includes(u.name)), mine);
      const ids = new Map(plan.existing);
      if (plan.existing.size) await must(sb.from('schools').update({ in_portfolio: true }).in('id', [...plan.existing.values()]).select('id'));
      if (plan.restore.length) {
        await must(sb.from('schools').update({ deleted_at: null, in_portfolio: true }).in('id', plan.restore.map((r) => r.id)).select('id'));
        plan.restore.forEach((r) => ids.set(r.name, r.id));
      }
      if (plan.create.length) {
        const made = (await must(sb.from('schools').insert(plan.create.map((c) => ({ ...c, in_portfolio: true }))).select('id, name'))) as { id: string; name: string }[];
        made.forEach((m) => ids.set(m.name, m.id));
      }
      let made = 0; const failed: string[] = [];
      if (start) {
        for (const p of toStart) {
          const schoolId = ids.get(p.school);
          if (!schoolId) { failed.push(p.program.program_name); continue; }
          try { await startProgramApplication(sb, { schoolId, program: p.program, fallbackIntake: intake }); made++; } catch (e) { failed.push(`${p.school} ${p.program.program_name}: ${errText(e)}`); }
        }
      }
      const added = plan.create.length + plan.restore.length;
      const parts = [added ? `${plural(added, 'university', 'universities')} added to your list` : 'Already on your list'];
      if (start) parts.push(made ? `${plural(made, 'application')} started` : 'no new applications');
      toast(`${parts.join(', ')}.`);
      if (failed.length) toast(`We could not start: ${failed.join('; ')}`, 'err');
      onDone(); onClose();
    } catch (e) {
      toast(errText(e), 'err');
    } finally { setBusy(null); }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={`Add ${plural(names.length, 'university', 'universities')} to your list`}>
      <ul className="mb-4 max-h-64 space-y-2 overflow-auto text-sm">
        {names.map((n) => (
          <li key={n} className="rounded-xl border-2 p-2">
            <p className="font-bold text-ink">{n}</p>
            <ul className="text-secondary">{picks.filter((p) => p.school === n).map((p) => <li key={p.program.id}>{p.program.program_name}{started.has(p.program.id) && <span className="ml-1 text-xs">(already started)</span>}</li>)}</ul>
          </li>
        ))}
      </ul>
      <p className="mb-4 text-sm text-secondary">
        Starting an application makes a checklist from the school&apos;s own requirements, with its essay prompts ready to write.
        {already > 0 && ` ${plural(already, 'program')} you already started will be skipped.`}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => void run(false)} disabled={!!busy} className="min-h-11">{busy === 'add' ? 'Adding...' : 'Add to my list'}</Button>
        <Button onClick={() => void run(true)} disabled={!!busy || toStart.length === 0} className="min-h-11">{busy === 'start' ? 'Starting...' : `Add and start ${plural(toStart.length, 'application')}`}</Button>
      </div>
    </Modal>
  );
}
