'use client';
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, ConfirmButton, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { REQ_CATEGORIES, RequirementSchema, zodFieldErrors, type FieldErrors, type Requirement } from '@/lib/applications';
import { REQ_STATUS } from '@/lib/constants';
import { fmtDate, titleCase } from '@/lib/utils';
import { useAction, type TabProps } from './data';

type Form = { name: string; category: string; status: string; due_date: string; priority: string; mandatory: boolean; document_id: string; essay_id: string; recommendation_id: string; assigned_to: string; notes: string };
const blank: Form = { name: '', category: 'other', status: 'not_started', due_date: '', priority: '3', mandatory: true, document_id: '', essay_id: '', recommendation_id: '', assigned_to: '', notes: '' };
const tone = (s: string) => (s === 'complete' ? 'success' : s === 'waived' ? 'neutral' : s === 'in_progress' ? 'accent' : 'warning') as 'success';

export function RequirementsTab({ b, reload }: TabProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [errs, setErrs] = useState<FieldErrors>({});
  const [essays, setEssays] = useState<{ id: string; title: string }[]>([]);
  const { busy, run } = useAction();
  const sb = supabaseBrowser();
  const docName = (id: string | null) => b.docs.find((d) => d.id === id)?.name;
  const essayName = (id: string | null) => [...b.essays, ...(b.letter ? [b.letter] : [])].find((e) => e.id === id)?.title ?? essays.find((e) => e.id === id)?.title;

  useEffect(() => {
    if (!open) return;
    let live = true;
    void sb.from('essays').select('id,title').is('deleted_at', null).or(`application_id.eq.${b.app.id},application_id.is.null`).order('title').then(({ data }) => { if (live) setEssays((data ?? []) as { id: string; title: string }[]); });
    return () => { live = false; };
  }, [open, b.app.id, sb]);

  function openNew() { setEditing(null); setF(blank); setErrs({}); setOpen(true); }
  function openEdit(r: Requirement) {
    setEditing(r); setErrs({});
    setF({ name: r.name, category: r.category, status: r.status, due_date: r.due_date ?? '', priority: String(r.priority), mandatory: r.mandatory, document_id: r.document_id ?? '', essay_id: r.essay_id ?? '', recommendation_id: r.recommendation_id ?? '', assigned_to: r.assigned_to ?? '', notes: r.notes ?? '' });
    setOpen(true);
  }
  async function save() {
    const p = RequirementSchema.safeParse(f);
    if (!p.success) { setErrs(zodFieldErrors(p.error)); return; }
    setErrs({});
    const ok = await run(async () => {
      if (editing) {
        // default requirements keep their name and category: the database guards refer to them by name
        const patch = editing.is_default ? { ...p.data, name: editing.name, category: editing.category } : p.data;
        await must(sb.from('application_requirements').update(patch).eq('id', editing.id));
      } else await must(sb.from('application_requirements').insert({ ...p.data, application_id: b.app.id, is_default: false, sort_order: 100 + b.reqs.length }));
    }, editing ? 'Requirement updated' : 'Requirement added');
    if (ok) { setOpen(false); reload(); }
  }
  async function setStatus(r: Requirement, status: string) { if (await run(async () => { await must(sb.from('application_requirements').update({ status }).eq('id', r.id)); })) reload(); }
  async function remove(r: Requirement) { if (await run(async () => { await must(sb.from('application_requirements').delete().eq('id', r.id)); }, 'Requirement deleted')) reload(); }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-xs text-secondary">The 17 default requirements cannot be deleted or renamed. Completion date is recorded automatically.</p><Button onClick={openNew}><Plus size={14} /> Add custom requirement</Button></div>
      {!b.reqs.length ? <EmptyState title="No requirements" /> : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b bg-bg text-xs text-secondary"><tr>{['Requirement', 'Status', 'Due', 'Linked', 'Assigned', 'Completed', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {b.reqs.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2"><p className="font-medium">{r.name}</p><p className="text-xs text-secondary">{titleCase(r.category)} · P{r.priority} · {r.mandatory ? 'Mandatory' : 'Optional'}{!r.is_default && <> · <Badge tone="neutral">Custom</Badge></>}</p>{r.notes && <p className="text-xs text-secondary">{r.notes}</p>}</td>
                  <td className="px-3 py-2"><Select aria-label={`Status of ${r.name}`} className="!py-1 text-xs" value={r.status} disabled={busy} onChange={(e) => void setStatus(r, e.target.value)}>{REQ_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select><div className="mt-1"><Badge tone={tone(r.status)}>{titleCase(r.status)}</Badge></div></td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.due_date)}</td>
                  <td className="px-3 py-2 text-xs">{[docName(r.document_id) && `Doc: ${docName(r.document_id)}`, essayName(r.essay_id) && `Essay: ${essayName(r.essay_id)}`, r.recommendation_id && 'Recommendation linked'].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="px-3 py-2 text-xs">{r.assigned_to || '-'}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.completed_at)}</td>
                  <td className="px-3 py-2"><div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    {!r.is_default && <ConfirmButton size="sm" variant="ghost" aria-label={`Delete ${r.name}`} message={`Delete the requirement "${r.name}"?`} onConfirm={() => void remove(r)}><Trash2 size={14} /></ConfirmButton>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add custom requirement'} wide>
        <form className="grid gap-3 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Name" error={errs.name}><Input value={f.name} disabled={!!editing?.is_default} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Category" error={errs.category}><Select value={f.category} disabled={!!editing?.is_default} onChange={(e) => setF({ ...f, category: e.target.value })}>{REQ_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{REQ_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Due date" error={errs.due_date}><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Priority (1 = highest)" error={errs.priority}><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} /> Mandatory</label>
          <Field label="Associated document"><Select value={f.document_id} onChange={(e) => setF({ ...f, document_id: e.target.value })}><option value="">None</option>{b.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Associated essay"><Select value={f.essay_id} onChange={(e) => setF({ ...f, essay_id: e.target.value })}><option value="">None</option>{essays.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}{f.essay_id && !essays.some((x) => x.id === f.essay_id) && <option value={f.essay_id}>Linked essay</option>}</Select></Field>
          <Field label="Associated recommendation"><Select value={f.recommendation_id} onChange={(e) => setF({ ...f, recommendation_id: e.target.value })}><option value="">None</option>{b.recs.map((d) => <option key={d.id} value={d.id}>{d.recommender?.name ?? 'Recommender'} ({titleCase(d.status)})</option>)}</Select></Field>
          <Field label="Assigned person" error={errs.assigned_to}><Input value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} placeholder="Yourself, a recommender, an advisor" /></Field>
          <Field label="Notes" error={errs.notes} className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save requirement'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
