'use client';
import { useState } from 'react';
import { Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Field, Input, Modal, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { fieldErrors } from '@/lib/essays';
import { recommenderSchema, type RecommenderRow } from '@/lib/recommendations';
import { errMsg } from '@/components/essays/data';

export function RecommendersPanel({ recommenders, onChanged }: { recommenders: RecommenderRow[]; onChanged: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<RecommenderRow | 'new' | null>(null);
  async function remove(r: RecommenderRow) {
    try { await must(supabaseBrowser().from('recommenders').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)); toast('Recommender removed'); onChanged(); } catch (e) { toast(errMsg(e), 'err'); }
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setEdit('new')}><Plus size={14} /> Add recommender</Button></div>
      {!recommenders.length ? <EmptyState title="No recommenders yet" hint="Add the people you plan to ask, then assign them to each school separately." action={<Button onClick={() => setEdit('new')}>Add recommender</Button>} /> : (
        <div className="grid gap-3 md:grid-cols-2">{recommenders.map((r) => (
          <Card key={r.id} className="space-y-1">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{r.name}</h3><p className="text-sm text-secondary">{[r.position, r.company].filter(Boolean).join(', ') || 'No position recorded'}</p></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEdit(r)}><Pencil size={13} /></Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => { if (window.confirm(`Remove ${r.name}? Their school assignments will be hidden too.`)) void remove(r); }}><Trash2 size={13} /></Button></div></div>
            {r.email && <p className="flex items-center gap-1 text-sm"><Mail size={12} /> <a className="text-accent hover:underline" href={`mailto:${r.email}`}>{r.email}</a></p>}
            {r.relationship && <p className="text-sm"><span className="text-secondary">Relationship: </span>{r.relationship}</p>}
            {r.background && <p className="whitespace-pre-line text-sm"><span className="text-secondary">Background: </span>{r.background}</p>}
            <p className="text-xs text-secondary">First contacted: {fmtDate(r.contacted_at)}</p>
            {r.notes && <p className="whitespace-pre-line text-xs text-secondary">Notes: {r.notes}</p>}
          </Card>))}</div>)}
      {edit && <RecommenderModal rec={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChanged(); }} />}
    </div>
  );
}

function RecommenderModal({ rec, onClose, onDone }: { rec: RecommenderRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: rec?.name ?? '', position: rec?.position ?? '', company: rec?.company ?? '', email: rec?.email ?? '', relationship: rec?.relationship ?? '', background: rec?.background ?? '', contacted_at: rec?.contacted_at ?? '', notes: rec?.notes ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = recommenderSchema.safeParse(v); if (!p.success) { setErrors(fieldErrors(p.error)); return; }
    setErrors({}); setBusy(true);
    try {
      const d = p.data; const row = { name: d.name, position: d.position || null, company: d.company || null, email: d.email ?? null, relationship: d.relationship || null, background: d.background || null, contacted_at: d.contacted_at ?? null, notes: d.notes || null };
      const sb = supabaseBrowser();
      if (rec) await must(sb.from('recommenders').update(row).eq('id', rec.id)); else await must(sb.from('recommenders').insert(row));
      toast(rec ? 'Recommender updated' : 'Recommender added'); onDone();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={rec ? 'Edit recommender' : 'Add recommender'} wide>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={errors.name}><Input value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Position" error={errors.position}><Input value={v.position} onChange={(e) => set('position', e.target.value)} /></Field>
          <Field label="Company" error={errors.company}><Input value={v.company} onChange={(e) => set('company', e.target.value)} /></Field>
          <Field label="Relationship to you" error={errors.relationship} hint="e.g. Direct manager for 3 years"><Input value={v.relationship} onChange={(e) => set('relationship', e.target.value)} /></Field>
          <Field label="First contacted" error={errors.contacted_at}><Input type="date" value={v.contacted_at} onChange={(e) => set('contacted_at', e.target.value)} /></Field>
        </div>
        <Field label="Background" error={errors.background} hint="Projects you worked on together, facts you want them to be aware of."><Textarea rows={3} value={v.background} onChange={(e) => set('background', e.target.value)} /></Field>
        <Field label="Notes" error={errors.notes}><Textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}
