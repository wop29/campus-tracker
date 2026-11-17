'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { countWords, wordLimitState } from '@/lib/logic/text';
import { ESSAY_STATUSES, ESSAY_STATUS_LABEL, type EssayRow } from '@/lib/essays';
import { appLabel, errMsg, syncStoryUsage, useSchoolsApps } from './data';
import { EssayFormModal } from './EssayFormModal';
import { useRouter } from 'next/navigation';

export function EssaysTab() {
  const toast = useToast(); const router = useRouter();
  const { schools, apps, error: refErr } = useSchoolsApps();
  const { data, error, loading, reload } = useQuery<EssayRow[]>((sb) => sb.from('essays').select('*').is('deleted_at', null).order('updated_at', { ascending: false }), []);
  const [f, setF] = useState({ q: '', school: '', app: '', status: '' });
  const [creating, setCreating] = useState(false);
  const [dup, setDup] = useState<EssayRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = useMemo(() => (data ?? []).filter((e) => (!f.school || e.school_id === f.school) && (!f.app || e.application_id === f.app) && (!f.status || e.status === f.status) && (!f.q || e.title.toLowerCase().includes(f.q.toLowerCase()))), [data, f]);
  const schoolName = (id: string | null) => schools.find((s) => s.id === id)?.name ?? '-';
  const appText = (id: string | null) => { const a = apps.find((x) => x.id === id); return a ? appLabel(a) : '-'; };

  async function remove(e: EssayRow) {
    setBusyId(e.id);
    try {
      const sb = supabaseBrowser();
      const links = await must(sb.from('essay_stories').select('story_id').eq('essay_id', e.id)) as { story_id: string }[];
      await must(sb.from('essays').update({ deleted_at: new Date().toISOString() }).eq('id', e.id));
      await syncStoryUsage(sb, links.map((l) => l.story_id));
      toast('Essay deleted. Its version history is kept.'); await reload();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="max-w-[220px]" placeholder="Search title" aria-label="Search essays" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select className="max-w-[200px]" aria-label="Filter by school" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value, app: '' })}><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select className="max-w-[240px]" aria-label="Filter by application" value={f.app} onChange={(e) => setF({ ...f, app: e.target.value })}><option value="">All applications</option>{apps.filter((a) => !f.school || a.school_id === f.school).map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}</Select>
        <Select className="max-w-[170px]" aria-label="Filter by status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{ESSAY_STATUSES.map((s) => <option key={s} value={s}>{ESSAY_STATUS_LABEL[s]}</option>)}</Select>
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus size={14} /> New essay</Button>
      </div>
      {refErr && <ErrorBox message={`Could not load schools or applications: ${refErr}`} />}
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState title="No essays yet" hint="Create an essay for a school, paste the prompt, and start drafting. Every save is kept as a version." action={<Button onClick={() => setCreating(true)}>New essay</Button>} />
      ) : !rows.length ? <EmptyState title="No essays match these filters" /> : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b bg-bg text-left text-xs text-secondary"><tr><th className="p-2">Essay</th><th className="p-2">School</th><th className="p-2">Application</th><th className="p-2">Status</th><th className="p-2">Words</th><th className="p-2">Deadline</th><th className="p-2 text-right">Actions</th></tr></thead>
            <tbody>{rows.map((e) => {
              const w = countWords(e.draft); const st = wordLimitState(w, e.word_limit);
              return (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="p-2"><Link href={`/essays/${e.id}`} className="font-medium text-accent hover:underline">{e.title}</Link>{e.duplicated_from && <span className="ml-1 text-xs text-secondary">(duplicate)</span>}</td>
                  <td className="p-2">{schoolName(e.school_id)}</td><td className="p-2">{appText(e.application_id)}</td>
                  <td className="p-2"><Badge tone={e.status === 'approved' || e.status === 'submitted' ? 'success' : 'neutral'}>{ESSAY_STATUS_LABEL[e.status]}</Badge></td>
                  <td className="p-2"><span className={st === 'over' ? 'text-danger' : st === 'near' ? 'text-warning' : ''}>{w}{e.word_limit ? ` / ${e.word_limit}` : ''}</span></td>
                  <td className="p-2">{fmtDate(e.deadline)}</td>
                  <td className="p-2"><div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setDup(e)} aria-label={`Duplicate ${e.title} for another school`}><Copy size={12} /> Duplicate</Button>
                    <Button size="sm" variant="ghost" disabled={busyId === e.id} aria-label={`Delete ${e.title}`} onClick={() => { if (window.confirm(`Delete "${e.title}"? It is hidden but its versions are kept.`)) void remove(e); }}><Trash2 size={12} /></Button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {creating && <EssayFormModal open onClose={() => setCreating(false)} schools={schools} apps={apps} onDone={(id) => { setCreating(false); router.push(`/essays/${id}`); }} />}
      {dup && <EssayFormModal open onClose={() => setDup(null)} schools={schools} apps={apps} source={dup} onDone={(id) => { setDup(null); router.push(`/essays/${id}`); }} />}
    </div>
  );
}
