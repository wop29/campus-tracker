'use client';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, ConfirmButton, EmptyState, Field, Input, Modal, Select } from '@/components/ui';
import { DEADLINE_KINDS, DeadlineSchema, TIMEZONES, isoToWall, wallToIso, zodFieldErrors, type Deadline, type FieldErrors } from '@/lib/applications';
import { timeRemaining } from '@/lib/logic/risk';
import { titleCase } from '@/lib/utils';
import { useAction, type TabProps } from './data';

type Form = { name: string; date: string; time: string; timezone: string; kind: string; is_primary: boolean };
const blank: Form = { name: '', date: '', time: '23:59', timezone: 'America/New_York', kind: 'submission', is_primary: false };

export function DeadlinesTab({ b, reload }: TabProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Deadline | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [errs, setErrs] = useState<FieldErrors>({});
  const { busy, run } = useAction();
  const appId = b.app.id;

  function openNew() { setEditing(null); setF({ ...blank, name: b.deadlines.length ? '' : 'Submission deadline', is_primary: !b.deadlines.some((d) => d.is_primary) }); setErrs({}); setOpen(true); }
  function openEdit(d: Deadline) { const w = isoToWall(d.due_at, d.timezone); setEditing(d); setF({ name: d.name, date: w.date, time: w.time, timezone: d.timezone, kind: d.kind, is_primary: d.is_primary }); setErrs({}); setOpen(true); }
  async function save() {
    const p = DeadlineSchema.safeParse(f);
    if (!p.success) { setErrs(zodFieldErrors(p.error)); return; }
    setErrs({});
    const sb = supabaseBrowser(); const v = p.data;
    const row = { name: v.name, kind: v.kind, timezone: v.timezone, is_primary: v.is_primary, due_at: wallToIso(v.date, v.time, v.timezone) };
    const ok = await run(async () => {
      let id = editing?.id;
      if (editing) await must(sb.from('deadlines').update(row).eq('id', editing.id));
      else id = ((await must(sb.from('deadlines').insert({ ...row, application_id: appId }).select('id').single())) as { id: string }).id;
      if (v.is_primary && id) await must(sb.from('deadlines').update({ is_primary: false }).eq('application_id', appId).neq('id', id));
    }, editing ? 'Deadline updated' : 'Deadline added');
    if (ok) { setOpen(false); reload(); }
  }
  async function remove(d: Deadline) { if (await run(async () => { await must(supabaseBrowser().from('deadlines').delete().eq('id', d.id)); }, 'Deadline deleted')) reload(); }

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={openNew}><Plus size={14} /> Add deadline</Button></div>
      {!b.deadlines.length ? <EmptyState title="No deadlines" hint="Add the submission deadline to see time remaining and risk." /> : (
        <ul className="divide-y rounded-lg border bg-white">
          {b.deadlines.map((d) => { const w = isoToWall(d.due_at, d.timezone); return (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{d.name} {d.is_primary && <Badge tone="accent">Primary</Badge>}</p>
                <p className="text-xs text-secondary">{titleCase(d.kind)} · {w.date} {w.time} ({d.timezone}) · {timeRemaining(d.due_at)}</p></div>
              <Button size="sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => openEdit(d)}><Pencil size={14} /></Button>
              <ConfirmButton size="sm" variant="ghost" aria-label={`Delete ${d.name}`} message={`Delete the deadline "${d.name}"?`} onConfirm={() => void remove(d)}><Trash2 size={14} /></ConfirmButton>
            </li>); })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit deadline' : 'Add deadline'}>
        <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Name" error={errs.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Kind" error={errs.kind}><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{DEADLINE_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date" error={errs.date}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Time" error={errs.time}><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          </div>
          <Field label="Timezone" error={errs.timezone}><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{[...new Set([f.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} /> Primary deadline (only one per application)</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save deadline'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
