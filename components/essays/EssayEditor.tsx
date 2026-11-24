'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { countWords, wordLimitState } from '@/lib/logic/text';
import { ESSAY_STATUSES, ESSAY_STATUS_LABEL, draftChanged, essayFormSchema, essaySubtitle, statusAfterSave, fieldErrors, type EssayRow, type EssayStatus, type EssayVersionRow } from '@/lib/essays';
import { appLabel, errMsg, useSchoolsApps } from './data';
import { AiEvalPanel } from './AiEvalPanel';
import { StoryLinker } from './StoryLinker';
import { VersionHistory } from './VersionHistory';
import { useUnsavedWarning } from './useUnsavedWarning';

export function EssayEditor({ essayId }: { essayId: string }) {
  const toast = useToast();
  const { schools, apps } = useSchoolsApps();
  const essayQ = useQuery<EssayRow | null>((sb) => sb.from('essays').select('*').eq('id', essayId).is('deleted_at', null).maybeSingle(), [essayId]);
  const versionsQ = useQuery<EssayVersionRow[]>((sb) => sb.from('essay_versions').select('*').eq('essay_id', essayId).order('version_number', { ascending: false }), [essayId]);
  const essay = essayQ.data;
  const [draft, setDraft] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<{ title: string; school_id: string; application_id: string; prompt: string; word_limit: string; deadline: string } | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => { if (essay && draft === null) setDraft(essay.draft); }, [essay, draft]);
  useEffect(() => {
    if (essay) setDetails({ title: essay.title, school_id: essay.school_id ?? '', application_id: essay.application_id ?? '', prompt: essay.prompt ?? '', word_limit: essay.word_limit?.toString() ?? '', deadline: essay.deadline ? essay.deadline.slice(0, 10) : '' });
  }, [essay]);

  const text = draft ?? '';
  const dirty = !!essay && draft !== null && draftChanged(essay.draft, text);
  useUnsavedWarning(dirty);
  const words = countWords(text); const state = wordLimitState(words, essay?.word_limit);
  const versions = versionsQ.data ?? [];
  const reloadAll = async () => { await Promise.all([essayQ.reload(), versionsQ.reload()]); };

  async function saveDraft() {
    if (!essay || saving) return;
    if (!draftChanged(essay.draft, text)) { toast('No changes to save, so no new version was created.'); return; }
    setSaving(true);
    try {
      const nextStatus = statusAfterSave(essay.status, text);
      const row = await must(supabaseBrowser().from('essays').update({ draft: text, change_notes: notes.trim() || null, ...(nextStatus ? { status: nextStatus } : {}) }).eq('id', essay.id).select('id').maybeSingle());
      if (!row) throw new Error('The essay could not be updated. It may have been deleted.');
      setNotes(''); toast(nextStatus ? `Draft saved. Nice start, this essay is now "${ESSAY_STATUS_LABEL[nextStatus]}".` : 'Draft saved as a new version'); await reloadAll();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
  }
  async function setStatus(s: EssayStatus) {
    if (!essay) return;
    try { await must(supabaseBrowser().from('essays').update({ status: s }).eq('id', essay.id)); toast(`Status: ${ESSAY_STATUS_LABEL[s]}`); await essayQ.reload(); } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function restore(v: EssayVersionRow) {
    if (!essay) return;
    if (dirty) { toast('Save or discard your unsaved edits before restoring.', 'err'); return; }
    if (v.text === essay.draft) { toast(`Version ${v.version_number} already matches the current draft, so nothing was saved.`); return; }
    try {
      await must(supabaseBrowser().from('essays').update({ draft: v.text, change_notes: `Restored from version ${v.version_number}` }).eq('id', essay.id));
      setDraft(v.text); toast(`Version ${v.version_number} restored as a new version`); await reloadAll();
    } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function saveDetails(e: React.FormEvent) {
    e.preventDefault(); if (!essay || !details || savingDetails) return;
    const p = essayFormSchema.safeParse(details); if (!p.success) { setDetailErrors(fieldErrors(p.error)); return; }
    setDetailErrors({}); setSavingDetails(true);
    try {
      const d = p.data;
      await must(supabaseBrowser().from('essays').update({ title: d.title, school_id: d.school_id ?? null, application_id: d.application_id ?? null, prompt: d.prompt || null, word_limit: d.word_limit ?? null, deadline: d.deadline ? new Date(`${d.deadline}T23:59:00`).toISOString() : null }).eq('id', essay.id));
      toast('Details saved'); await essayQ.reload();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setSavingDetails(false); }
  }
  const schoolApps = useMemo(() => apps.filter((a) => !details?.school_id || a.school_id === details.school_id), [apps, details?.school_id]);

  const linkedApp = essay ? apps.find((a) => a.id === essay.application_id) : undefined;
  const subtitle = essay ? essaySubtitle(schools.find((s) => s.id === essay.school_id)?.name, linkedApp ? { schoolName: linkedApp.schools?.name, program: linkedApp.program, intake: linkedApp.intake, round: linkedApp.round } : null) : '';

  if (essayQ.loading && !essay) return <Loading />;
  if (essayQ.error) return <ErrorBox message={essayQ.error} onRetry={essayQ.reload} />;
  if (!essay || !details) return <EmptyState title="Essay not found" hint="It may have been deleted." action={<Link className="text-accent underline" href="/essays">Back to essays</Link>} />;

  const limitMsg = !essay.word_limit ? null : state === 'over' ? `${words - essay.word_limit} words over the limit` : state === 'near' ? `${essay.word_limit - words} words left, near the limit` : `${essay.word_limit - words} words left`;
  return (
    <div className="space-y-4">
      <Link href="/essays" className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"><ArrowLeft size={14} /> All essays</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{essay.title}</h1>
          <p className="text-sm text-secondary">{subtitle}</p></div>
        <label className="flex items-center gap-2 text-sm">Status<Select aria-label="Essay status" className="w-44" value={essay.status} onChange={(e) => void setStatus(e.target.value as EssayStatus)}>{ESSAY_STATUSES.map((s) => <option key={s} value={s}>{ESSAY_STATUS_LABEL[s]}</option>)}</Select></label>
      </div>
      {essay.prompt && <Card className="bg-bg"><p className="text-xs font-medium text-secondary">Prompt</p><p className="whitespace-pre-line text-sm">{essay.prompt}</p></Card>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card className="space-y-3">
            <label htmlFor="draft" className="sr-only">Essay draft</label>
            <Textarea id="draft" className="min-h-[360px] leading-relaxed" value={text} onChange={(e) => setDraft(e.target.value)} placeholder="Start writing your draft here." />
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
              <span className={cn('font-medium', state === 'over' && 'text-danger', state === 'near' && 'text-warning')}>{words} word{words === 1 ? '' : 's'}{essay.word_limit ? ` / ${essay.word_limit}` : ''}</span>
              {limitMsg && <Badge tone={state === 'over' ? 'danger' : state === 'near' ? 'warning' : 'neutral'}>{limitMsg}</Badge>}
              {dirty ? <Badge tone="warning">Unsaved changes</Badge> : <Badge tone="success">Saved</Badge>}
            </div>
            <Field label="Change notes (optional)" hint="Stored with the new version, e.g. Tightened the opening"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveDraft()} disabled={saving}><Save size={14} /> {saving ? 'Saving...' : 'Save draft'}</Button>
              {dirty && <Button variant="ghost" onClick={() => { if (window.confirm('Discard your unsaved edits?')) setDraft(essay.draft); }}>Discard edits</Button>}
            </div>
          </Card>
          <details className="rounded-lg border bg-surface p-4"><summary className="cursor-pointer text-sm font-semibold">Essay details</summary>
            <form onSubmit={saveDetails} className="mt-3 space-y-3" noValidate>
              <Field label="Title" error={detailErrors.title}><Input value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="School"><Select value={details.school_id} onChange={(e) => setDetails({ ...details, school_id: e.target.value, application_id: apps.find((a) => a.id === details.application_id)?.school_id === e.target.value ? details.application_id : '' })}><option value="">No school</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="Application"><Select value={details.application_id} onChange={(e) => { const a = apps.find((x) => x.id === e.target.value); setDetails({ ...details, application_id: e.target.value, school_id: a ? a.school_id : details.school_id }); }}><option value="">No application</option>{schoolApps.map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}</Select></Field>
              </div>
              <Field label="Original prompt" error={detailErrors.prompt}><Textarea rows={4} value={details.prompt} onChange={(e) => setDetails({ ...details, prompt: e.target.value })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Word limit" error={detailErrors.word_limit}><Input inputMode="numeric" value={details.word_limit} onChange={(e) => setDetails({ ...details, word_limit: e.target.value })} /></Field>
                <Field label="Deadline" error={detailErrors.deadline}><Input type="date" value={details.deadline} onChange={(e) => setDetails({ ...details, deadline: e.target.value })} /></Field>
              </div>
              <Button type="submit" disabled={savingDetails}>{savingDetails ? 'Saving...' : 'Save details'}</Button>
            </form>
          </details>
        </div>
        <div className="space-y-4">
          <AiEvalPanel essayId={essay.id} dirty={dirty} hasText={essay.draft.trim().length > 0} latest={versions[0] ?? null} onStored={() => void versionsQ.reload()} />
          <StoryLinker essayId={essay.id} prompt={essay.prompt} schoolId={essay.school_id} />
        </div>
      </div>

      <section aria-labelledby="vh"><h2 id="vh" className="mb-2 text-base font-semibold">Version history</h2>
        {versionsQ.loading && !versionsQ.data ? <Loading /> : versionsQ.error ? <ErrorBox message={versionsQ.error} onRetry={versionsQ.reload} /> :
          <VersionHistory versions={versions} currentDraft={text} canRestore={!dirty} onRestore={restore} onChanged={() => void versionsQ.reload()} />}
      </section>
    </div>
  );
}
