'use client';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fieldErrors } from '@/lib/essays';
import { STORY_CATEGORIES, STORY_CATEGORY_LABEL, splitList, storyFormSchema, type StoryRow } from '@/lib/stories';
import { errMsg, type SchoolLite } from './data';

export function StoryFormModal({ story, schools, onClose, onDone }: { story: StoryRow | null; schools: SchoolLite[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({
    title: story?.title ?? '', category: story?.category ?? '', situation: story?.situation ?? '', task: story?.task ?? '', action: story?.action ?? '', result: story?.result ?? '',
    lessons_learned: story?.lessons_learned ?? '', quantified_impact: story?.quantified_impact ?? '', related_prompts: story?.related_prompts ?? '', competencies: (story?.competencies ?? []).join(', '),
  });
  const [schoolIds, setSchoolIds] = useState<string[]>(story?.related_school_ids ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const ta = (k: keyof typeof v, label: string, hint?: string) => <Field label={label} error={errors[k]} hint={hint}><Textarea rows={3} value={v[k]} onChange={(e) => set(k, e.target.value)} /></Field>;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const parsed = storyFormSchema.safeParse(v);
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({}); setBusy(true);
    try {
      const d = parsed.data;
      const row = { title: d.title, category: d.category, situation: d.situation || null, task: d.task || null, action: d.action || null, result: d.result || null, lessons_learned: d.lessons_learned || null,
        quantified_impact: d.quantified_impact || null, related_prompts: d.related_prompts || null, competencies: splitList(d.competencies ?? ''), related_school_ids: schoolIds };
      const sb = supabaseBrowser();
      if (story) await must(sb.from('story_bank').update(row).eq('id', story.id)); else await must(sb.from('story_bank').insert(row));
      toast(story ? 'Story updated' : 'Story added'); onDone();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={story ? 'Edit story' : 'New story'} wide>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" error={errors.title}><Input value={v.title} onChange={(e) => set('title', e.target.value)} autoFocus /></Field>
          <Field label="Category" error={errors.category}><Select value={v.category} onChange={(e) => set('category', e.target.value)}><option value="">Choose...</option>{STORY_CATEGORIES.map((c) => <option key={c} value={c}>{STORY_CATEGORY_LABEL[c]}</option>)}</Select></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{ta('situation', 'Situation')}{ta('task', 'Task')}{ta('action', 'Action')}{ta('result', 'Result')}</div>
        {ta('lessons_learned', 'Lessons learned')}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantified impact" error={errors.quantified_impact} hint="Only numbers you can stand behind."><Input value={v.quantified_impact} onChange={(e) => set('quantified_impact', e.target.value)} /></Field>
          <Field label="Competencies" error={errors.competencies} hint="Comma separated, e.g. stakeholder management, analytics"><Input value={v.competencies} onChange={(e) => set('competencies', e.target.value)} /></Field>
        </div>
        {ta('related_prompts', 'Related prompts', 'Prompts or themes this story could answer. Used when recommending stories for an essay.')}
        <fieldset><legend className="mb-1 text-xs font-medium text-secondary">Related schools</legend>
          {schools.length === 0 ? <p className="text-xs text-secondary">No schools yet. Add schools in School Portfolio first.</p> : (
            <div className="grid max-h-36 grid-cols-2 gap-1 overflow-auto rounded-md border p-2 text-sm sm:grid-cols-3">
              {schools.map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" checked={schoolIds.includes(s.id)} onChange={(e) => setSchoolIds((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.short_name || s.name}</label>)}
            </div>)}
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save story'}</Button></div>
      </form>
    </Modal>
  );
}
