'use client';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { essayFormSchema, fieldErrors, type EssayRow } from '@/lib/essays';
import { appDeadline, appLabel, errMsg, type AppLite, type SchoolLite } from './data';
import { essayDeadlineNote } from '@/lib/essays';

/** Creates an essay, or (when `source` is given) duplicates one for another school: draft and prompt are copied and duplicated_from is set. */
export function EssayFormModal({ open, onClose, schools, apps, source, onDone }: { open: boolean; onClose: () => void; schools: SchoolLite[]; apps: AppLite[]; source?: EssayRow | null; onDone: (id: string) => void }) {
  const toast = useToast();
  const [v, setV] = useState({ title: source ? `${source.title} (copy)` : '', school_id: '', application_id: '', prompt: source?.prompt ?? '', word_limit: source?.word_limit?.toString() ?? '', deadline: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const appsForSchool = apps.filter((a) => !v.school_id || a.school_id === v.school_id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = essayFormSchema.safeParse(v);
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({}); setBusy(true);
    try {
      const d = parsed.data; const sb = supabaseBrowser();
      const row = await must(sb.from('essays').insert({
        title: d.title, school_id: d.school_id ?? null, application_id: d.application_id ?? null, prompt: d.prompt || null, word_limit: d.word_limit ?? null,
        ...(source ? { draft: source.draft, duplicated_from: source.id, change_notes: `Duplicated from "${source.title}"`, status: 'first_draft' as const } : {}),
      }).select('id').single());
      toast(source ? 'Essay duplicated' : 'Essay created'); onDone((row as { id: string }).id);
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={source ? `Duplicate "${source.title}" for another school` : 'New essay'} wide>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {source && <p className="rounded-md bg-bg p-2 text-xs text-secondary">The draft and prompt are copied into a new essay with its own version history. Edit the prompt below so it matches the new school.</p>}
        <Field label="Title" error={errors.title}><Input value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="School" error={errors.school_id}>
            <Select value={v.school_id} onChange={(e) => { set('school_id', e.target.value); if (v.application_id && !apps.find((a) => a.id === v.application_id && a.school_id === e.target.value)) set('application_id', ''); }}>
              <option value="">No school</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Application" error={errors.application_id}>
            <Select value={v.application_id} onChange={(e) => { const a = apps.find((x) => x.id === e.target.value); setV((s) => ({ ...s, application_id: e.target.value, school_id: a ? a.school_id : s.school_id })); }}>
              <option value="">No application</option>{appsForSchool.map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Original prompt" error={errors.prompt} hint="Paste the exact prompt from the school."><Textarea value={v.prompt} onChange={(e) => set('prompt', e.target.value)} rows={4} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Word limit" error={errors.word_limit}><Input inputMode="numeric" value={v.word_limit} onChange={(e) => set('word_limit', e.target.value)} placeholder="e.g. 500" /></Field>
<div className="rounded-xl border-2 bg-bg p-3 text-sm">
            <p className="font-semibold">Deadline</p>
            <p className="mt-0.5 text-secondary">{essayDeadlineNote(v.application_id ? appDeadline(apps.find((a) => a.id === v.application_id)) : undefined)}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : source ? 'Duplicate' : 'Create essay'}</Button></div>
      </form>
    </Modal>
  );
}
