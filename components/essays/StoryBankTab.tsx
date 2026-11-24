'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { OVERUSE_THRESHOLD, STORY_CATEGORIES, STORY_CATEGORY_LABEL, deriveUsage, suggestAlternatives, usageState, type StoryRow } from '@/lib/stories';
import { errMsg, useSchoolsApps } from './data';
import { StoryFormModal } from './StoryFormModal';

type Link_ = { story_id: string; essay_id: string; essays: { id: string; title: string; deleted_at: string | null } | null };

export function StoryBankTab() {
  const toast = useToast();
  const { schools } = useSchoolsApps();
  const stories = useQuery<StoryRow[]>((sb) => sb.from('story_bank').select('*').is('deleted_at', null).order('created_at', { ascending: false }), []);
  const links = useQuery<Link_[]>((sb) => sb.from('essay_stories').select('story_id, essay_id, essays(id,title,deleted_at)') as never, []);
  const [f, setF] = useState({ q: '', category: '', competency: '' });
  const [edit, setEdit] = useState<StoryRow | 'new' | null>(null);

  const liveLinks = useMemo(() => (links.data ?? []).filter((l) => l.essays && !l.essays.deleted_at), [links.data]);
  const counts = useMemo(() => deriveUsage((links.data ?? []).map((l) => ({ story_id: l.story_id, essay_deleted_at: l.essays?.deleted_at ?? 'missing' }))), [links.data]);
  const all = stories.data ?? [];
  const competencies = useMemo(() => Array.from(new Set(all.flatMap((s) => s.competencies))).sort(), [all]);
  const rows = all.filter((s) => (!f.category || s.category === f.category) && (!f.competency || s.competencies.includes(f.competency)) &&
    (!f.q || [s.title, s.situation, s.action, s.result, s.related_prompts, s.competencies.join(' ')].join(' ').toLowerCase().includes(f.q.toLowerCase())));

  // Keep the stored usage_count equal to the live count (derived from essay_stories, never incremented by hand).
  useEffect(() => {
    if (!stories.data || !links.data) return;
    const drift = stories.data.filter((s) => s.usage_count !== (counts.get(s.id) ?? 0));
    if (!drift.length) return;
    const sb = supabaseBrowser();
    void Promise.all(drift.map((s) => sb.from('story_bank').update({ usage_count: counts.get(s.id) ?? 0 }).eq('id', s.id))).catch(() => {});
  }, [stories.data, links.data, counts]);

  async function remove(s: StoryRow) {
    try { await must(supabaseBrowser().from('story_bank').update({ deleted_at: new Date().toISOString() }).eq('id', s.id)); toast('Story deleted'); await stories.reload(); await links.reload(); }
    catch (e) { toast(errMsg(e), 'err'); }
  }
  const reloadAll = () => { void stories.reload(); void links.reload(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="max-w-[240px]" placeholder="Search stories" aria-label="Search stories" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select className="max-w-[200px]" aria-label="Filter by category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{STORY_CATEGORIES.map((c) => <option key={c} value={c}>{STORY_CATEGORY_LABEL[c]}</option>)}</Select>
        <Select className="max-w-[200px]" aria-label="Filter by competency" value={f.competency} onChange={(e) => setF({ ...f, competency: e.target.value })}><option value="">All competencies</option>{competencies.map((c) => <option key={c}>{c}</option>)}</Select>
        <Button className="ml-auto" onClick={() => setEdit('new')}><Plus size={14} /> New story</Button>
      </div>
      <p className="text-xs text-secondary">A story used in {OVERUSE_THRESHOLD} or more essays is flagged as overused. Usage is counted from the essays it is linked to.</p>
      {stories.loading || links.loading ? <Loading /> : stories.error ? <ErrorBox message={stories.error} onRetry={stories.reload} /> : links.error ? <ErrorBox message={links.error} onRetry={links.reload} /> : !all.length ? (
        <EmptyState title="Your story bank is empty" hint="Capture the experiences you may reuse across essays in STAR form: situation, task, action, result." action={<Button onClick={() => setEdit('new')}>Add a story</Button>} />
      ) : !rows.length ? <EmptyState title="No stories match these filters" /> : (
        <div className="grid gap-3 lg:grid-cols-2">{rows.map((s) => {
          const n = counts.get(s.id) ?? 0; const u = usageState(n);
          const used = liveLinks.filter((l) => l.story_id === s.id);
          const alts = u === 'overused' ? suggestAlternatives(s, all, counts) : [];
          return (
            <Card key={s.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-medium">{s.title}</h3><div className="mt-1 flex flex-wrap gap-1"><Badge tone="accent">{STORY_CATEGORY_LABEL[s.category]}</Badge>
                  <Badge tone={u === 'overused' ? 'danger' : u === 'unused' ? 'neutral' : 'success'}>{u === 'unused' ? 'Unused' : `Used in ${n} essay${n === 1 ? '' : 's'}`}</Badge>
                  {s.competencies.map((c) => <Badge key={c}>{c}</Badge>)}</div></div>
                <div className="flex shrink-0 gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${s.title}`} onClick={() => setEdit(s)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${s.title}`} onClick={() => { if (window.confirm(`Delete "${s.title}"? It will no longer be available to link.`)) void remove(s); }}><Trash2 size={13} /></Button></div>
              </div>
              <dl className="space-y-1 text-sm">
                {([['Situation', s.situation], ['Task', s.task], ['Action', s.action], ['Result', s.result], ['Lessons', s.lessons_learned], ['Impact', s.quantified_impact]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="inline font-medium text-secondary">{k}: </dt><dd className="inline whitespace-pre-line">{v}</dd></div>)}
              </dl>
              {used.length > 0 && <p className="text-xs text-secondary">Used in: {used.map((l, i) => <span key={l.essay_id}>{i > 0 && ', '}<Link className="text-accent hover:underline" href={`/essays/${l.essay_id}`}>{l.essays!.title}</Link></span>)}</p>}
              {u === 'overused' && (
                <div className="rounded-md bg-warning/10 p-2 text-xs"><p className="flex items-center gap-1 font-medium"><TriangleAlert size={12} /> Overused: this story appears in {n} essays.</p>
                  {alts.length ? <p className="mt-1">Consider: {alts.map((a) => `${a.title} (${counts.get(a.id) ?? 0} use${(counts.get(a.id) ?? 0) === 1 ? '' : 's'})`).join(', ')}.</p> : <p className="mt-1">No less-used story in this category yet. Add another {STORY_CATEGORY_LABEL[s.category].toLowerCase()} story.</p>}</div>)}
            </Card>
          );
        })}</div>
      )}
      {edit && <StoryFormModal story={edit === 'new' ? null : edit} schools={schools} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reloadAll(); }} />}
    </div>
  );
}
