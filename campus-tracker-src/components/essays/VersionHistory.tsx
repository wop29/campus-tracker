'use client';
import { useMemo, useState } from 'react';
import { Eye, GitCompare, RotateCcw } from 'lucide-react';
import { AiLabel, Badge, Button, Card, EmptyState, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { diffStats, diffWords, type EssayVersionRow } from '@/lib/essays';
import { errMsg } from './data';

const CURRENT = 'current';
export function VersionHistory({ versions, currentDraft, canRestore, onRestore, onChanged }: { versions: EssayVersionRow[]; currentDraft: string; canRestore: boolean; onRestore: (v: EssayVersionRow) => Promise<void>; onChanged: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<EssayVersionRow | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const textOf = (key: string) => (key === CURRENT ? currentDraft : versions.find((v) => v.id === key)?.text ?? '');
  const labelOf = (key: string) => (key === CURRENT ? 'Current editor text' : `Version ${versions.find((v) => v.id === key)?.version_number}`);
  const diff = useMemo(() => (cmp ? diffWords(textOf(cmp.a), textOf(cmp.b)) : null), [cmp, versions, currentDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = diff ? diffStats(diff) : null;

  async function saveComment(v: EssayVersionRow) {
    const val = comments[v.id]; if (val === undefined || savingId) return;
    setSavingId(v.id);
    try { await must(supabaseBrowser().from('essay_versions').update({ user_comments: val.trim() || null }).eq('id', v.id)); toast('Comment saved'); setComments((c) => { const n = { ...c }; delete n[v.id]; return n; }); onChanged(); }
    catch (e) { toast(errMsg(e), 'err'); } finally { setSavingId(null); }
  }
  if (!versions.length) return <EmptyState title="No versions yet" hint="Each time you save a changed draft, a version is recorded here." />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-md bg-bg p-2">
        <GitCompare size={14} className="mb-2.5 text-secondary" />
        <CompareControls versions={versions} onCompare={(a, b) => setCmp({ a, b })} />
      </div>
      <ul className="space-y-2">{versions.map((v, i) => (
        <li key={v.id}><Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Version {v.version_number}</span>{i === 0 && <Badge tone="success">Latest</Badge>}
            <span className="text-xs text-secondary">{fmtDateTime(v.created_at)} - {v.word_count} words</span>
            {v.ai_review && <Badge tone="accent">AI review stored</Badge>}
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setView(v)}><Eye size={12} /> View</Button>
              {i > 0 && <Button size="sm" variant="secondary" disabled={!canRestore || restoring === v.id} title={canRestore ? undefined : 'Save or discard your unsaved edits first'} onClick={async () => { if (!window.confirm(`Restore version ${v.version_number}? It will be saved as a new version. Nothing is deleted.`)) return; setRestoring(v.id); try { await onRestore(v); } finally { setRestoring(null); } }}><RotateCcw size={12} /> Restore</Button>}
            </div>
          </div>
          <p className="text-xs text-secondary">{v.change_notes ? <>Notes: {v.change_notes}</> : 'No change notes'}</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-secondary" htmlFor={`c-${v.id}`}>Your comments</label>
            <Textarea id={`c-${v.id}`} rows={2} value={comments[v.id] ?? v.user_comments ?? ''} onChange={(e) => setComments((c) => ({ ...c, [v.id]: e.target.value }))} placeholder="Add a comment about this version" />
            {comments[v.id] !== undefined && comments[v.id] !== (v.user_comments ?? '') && <Button size="sm" disabled={savingId === v.id} onClick={() => void saveComment(v)}>{savingId === v.id ? 'Saving...' : 'Save comment'}</Button>}
          </div>
          {v.ai_review && <details className="text-xs"><summary className="cursor-pointer text-secondary">AI review for this version <AiLabel /></summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2">{summariseReview(v.ai_review)}</pre></details>}
        </Card></li>))}
      </ul>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `Version ${view.version_number} (${view.word_count} words)` : ''} wide>
        {view && <><p className="mb-2 text-xs text-secondary">{fmtDateTime(view.created_at)}{view.change_notes ? ` - ${view.change_notes}` : ''}</p><div className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-white p-3 text-sm">{view.text || <em className="text-secondary">Empty draft</em>}</div></>}
      </Modal>
      <Modal open={!!cmp} onClose={() => setCmp(null)} title={cmp ? `${labelOf(cmp.a)} to ${labelOf(cmp.b)}` : ''} wide>
        {diff && stats && <>
          <p className="mb-2 text-xs text-secondary"><span className="rounded bg-success/15 px-1">+{stats.added} added</span> <span className="rounded bg-danger/15 px-1 line-through">-{stats.removed} removed</span> {stats.unchanged} unchanged. Word-level comparison; line breaks are shown as spaces.</p>
          {stats.added + stats.removed === 0 ? <p className="text-sm">These two texts have the same words.</p> :
            <div className="max-h-[60vh] overflow-auto rounded-md border bg-white p-3 text-sm leading-7">{diff.map((g, i) => g.type === 'equal' ? <span key={i}>{g.text} </span> : g.type === 'add' ? <ins key={i} className="rounded bg-success/15 px-0.5 no-underline">{g.text} </ins> : <del key={i} className="rounded bg-danger/15 px-0.5 text-danger">{g.text} </del>)}</div>}
        </>}
      </Modal>
    </div>
  );
}

function CompareControls({ versions, onCompare }: { versions: EssayVersionRow[]; onCompare: (a: string, b: string) => void }) {
  const [a, setA] = useState(versions[1]?.id ?? versions[0].id); const [b, setB] = useState(versions[0].id);
  const opts = <>{versions.map((v) => <option key={v.id} value={v.id}>Version {v.version_number}</option>)}<option value={CURRENT}>Current editor text</option></>;
  return (<>
    <label className="text-xs text-secondary">From<Select value={a} onChange={(e) => setA(e.target.value)} aria-label="Compare from">{opts}</Select></label>
    <label className="text-xs text-secondary">To<Select value={b} onChange={(e) => setB(e.target.value)} aria-label="Compare to">{opts}</Select></label>
    <Button size="sm" onClick={() => onCompare(a, b)} disabled={a === b}>Compare</Button>
  </>);
}
function summariseReview(r: NonNullable<EssayVersionRow['ai_review']>) {
  const sc = Object.entries(r.scores ?? {}).map(([k, v]) => `${k}: ${v}/10`).join('\n');
  const sec = Object.entries(r.review ?? {}).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k}:\n  - ${(v as string[]).join('\n  - ')}`).join('\n');
  return [r.mode ? `Mode: ${r.mode}` : '', sc, sec, r.suggestions ?? ''].filter(Boolean).join('\n\n');
}
