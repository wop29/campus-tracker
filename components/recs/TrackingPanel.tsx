'use client';
import { useMemo, useState } from 'react';
import { CalendarClock, LayoutGrid, Plus, Sparkles, Table2, Trash2, Pencil } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { REC_STATUSES, REC_STATUS_LABEL, daysUntil, recRisk, reminderDue, type RecStatus, type RecommendationRow, type RecommenderRow } from '@/lib/recommendations';
import { appLabel, errMsg, type AppLite } from '@/components/essays/data';
import { changeRecStatus, deleteRecommendation } from './actions';
import { AssignModal, EditAssignmentModal } from './AssignmentModals';
import { RecAiModal } from './RecAiModal';

export function TrackingPanel({ recommenders, recs, apps, onChanged }: { recommenders: RecommenderRow[]; recs: RecommendationRow[]; apps: AppLite[]; onChanged: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<'table' | 'board'>('table');
  const [assign, setAssign] = useState(false);
  const [edit, setEdit] = useState<RecommendationRow | null>(null);
  const [ai, setAi] = useState<RecommendationRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const recr = (id: string) => recommenders.find((r) => r.id === id);
  const app = (id: string) => apps.find((a) => a.id === id);
  const visible = useMemo(() => recs.filter((r) => recr(r.recommender_id) && (!filter || r.application_id === filter)), [recs, recommenders, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = new Date();
  const flagged = visible.filter((r) => ['overdue', 'at_risk'].includes(recRisk(r, now)));
  const byApp = useMemo(() => { const m = new Map<string, RecommendationRow[]>(); for (const r of visible) m.set(r.application_id, [...(m.get(r.application_id) ?? []), r]); return Array.from(m.entries()).sort((a, b) => { const la = app(a[0]) ? appLabel(app(a[0])!) : ''; const lb = app(b[0]) ? appLabel(app(b[0])!) : ''; return la.localeCompare(lb); }); }, [visible, apps]); // eslint-disable-line react-hooks/exhaustive-deps

  async function move(r: RecommendationRow, s: RecStatus) {
    if (busy) return; setBusy(r.id);
    try { const warn = await changeRecStatus(supabaseBrowser(), r, recs, s); toast(warn ?? `Moved to ${REC_STATUS_LABEL[s]}`, warn ? 'err' : 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(null); onChanged(); }
  }
  async function logContact(r: RecommendationRow) {
    try { await must(supabaseBrowser().from('recommendations').update({ last_contact_at: new Date().toISOString().slice(0, 10) }).eq('id', r.id)); toast('Last contact set to today'); onChanged(); } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function remove(r: RecommendationRow) {
    try { await deleteRecommendation(supabaseBrowser(), r, recs); toast('Assignment removed'); } catch (e) { toast(errMsg(e), 'err'); } finally { onChanged(); }
  }
  const RiskBadges = ({ r }: { r: RecommendationRow }) => { const k = recRisk(r, now); return (<>
    {k === 'overdue' && <Badge tone="danger">Overdue</Badge>}{k === 'at_risk' && <Badge tone="warning">At risk: {daysUntil(r.deadline!, now)}d left</Badge>}{k === 'follow_up' && <Badge tone="warning">Follow up</Badge>}
    {reminderDue(r, now) && <Badge tone="accent">Reminder suggested</Badge>}</>); };
  const actions = (r: RecommendationRow) => (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="secondary" onClick={() => setAi(r)}><Sparkles size={12} /> AI help</Button>
      <Button size="sm" variant="ghost" onClick={() => void logContact(r)} title="Set last contact to today"><CalendarClock size={12} /></Button>
      <Button size="sm" variant="ghost" aria-label="Edit tracking" onClick={() => setEdit(r)}><Pencil size={12} /></Button>
      <Button size="sm" variant="ghost" aria-label="Remove assignment" onClick={() => { if (window.confirm('Remove this assignment? A submitted status would reopen the checklist item.')) void remove(r); }}><Trash2 size={12} /></Button>
    </div>);
  const StatusSelect = ({ r }: { r: RecommendationRow }) => <Select aria-label="Status" className="py-1 text-xs" value={r.status} disabled={busy === r.id} onChange={(e) => void move(r, e.target.value as RecStatus)}>{REC_STATUSES.map((s) => <option key={s} value={s}>{REC_STATUS_LABEL[s]}</option>)}</Select>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="max-w-[260px]" aria-label="Filter by application" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All applications</option>{apps.map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}</Select>
        <div className="flex rounded-md border bg-white" role="group" aria-label="View">
          <button className={cn('flex items-center gap-1 px-3 py-1.5 text-sm', view === 'table' && 'bg-bg font-medium')} aria-pressed={view === 'table'} onClick={() => setView('table')}><Table2 size={14} /> Table</button>
          <button className={cn('flex items-center gap-1 px-3 py-1.5 text-sm', view === 'board' && 'bg-bg font-medium')} aria-pressed={view === 'board'} onClick={() => setView('board')}><LayoutGrid size={14} /> Board</button>
        </div>
        <Button className="ml-auto" disabled={!recommenders.length || !apps.length} onClick={() => setAssign(true)}><Plus size={14} /> Assign to application</Button>
      </div>
      {flagged.length > 0 && <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm" role="status"><strong>{flagged.length} recommendation{flagged.length === 1 ? '' : 's'} need attention:</strong> {flagged.map((r) => `${recr(r.recommender_id)?.name} for ${app(r.application_id)?.schools?.short_name ?? app(r.application_id)?.schools?.name ?? 'a school'} (${recRisk(r, now) === 'overdue' ? 'overdue' : `due ${fmtDate(r.deadline)}`})`).join('; ')}.</div>}
      {!recommenders.length ? <EmptyState title="Add a recommender first" hint="Use the Recommenders tab, then assign them to applications here." /> : !apps.length ? <EmptyState title="No applications yet" hint="Create an application in Applications, then assign recommenders to it." /> : !visible.length ? <EmptyState title="No assignments yet" hint="Assign a recommender to an application to start tracking it." action={<Button onClick={() => setAssign(true)}>Assign recommender</Button>} /> : view === 'table' ? (
        <div className="space-y-4">{byApp.map(([appId, rows]) => { const a = app(appId); const done = rows.filter((r) => r.status === 'submitted').length; return (
          <div key={appId} className="overflow-x-auto rounded-lg border bg-surface">
            <div className="flex items-center justify-between border-b bg-bg px-3 py-2 text-sm"><span className="font-medium">{a ? appLabel(a) : 'Application'}</span><span className="text-xs text-secondary">{done} of {rows.length} submitted</span></div>
            <table className="w-full text-sm"><thead className="text-left text-xs text-secondary"><tr><th className="p-2">Recommender</th><th className="p-2">Status</th><th className="p-2">Deadline</th><th className="p-2">Last contact</th><th className="p-2">Flags</th><th className="p-2 text-right">Actions</th></tr></thead>
              <tbody>{rows.map((r) => (<tr key={r.id} className="border-t align-top"><td className="p-2 font-medium">{recr(r.recommender_id)?.name}</td><td className="w-44 p-2"><StatusSelect r={r} /></td>
                <td className="p-2">{fmtDate(r.deadline)}</td><td className="p-2">{fmtDate(r.last_contact_at)}</td><td className="p-2"><div className="flex flex-wrap gap-1"><RiskBadges r={r} />{r.status === 'submitted' && <Badge tone="success">Submitted {fmtDate(r.submitted_at)}</Badge>}</div></td>
                <td className="p-2"><div className="flex justify-end">{actions(r)}</div></td></tr>))}</tbody></table>
          </div>); })}</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">{REC_STATUSES.map((s) => { const col = visible.filter((r) => r.status === s); return (
          <div key={s} className="w-64 shrink-0 rounded-lg bg-bg p-2"><h3 className="mb-2 flex items-center justify-between text-xs font-semibold">{REC_STATUS_LABEL[s]}<span className="text-secondary">{col.length}</span></h3>
            <div className="space-y-2">{col.length === 0 && <p className="px-1 text-xs text-secondary">None</p>}{col.map((r) => (
              <Card key={r.id} className="space-y-1.5 p-2.5"><p className="text-sm font-medium">{recr(r.recommender_id)?.name}</p><p className="text-xs text-secondary">{app(r.application_id) ? appLabel(app(r.application_id)!) : ''}</p>
                <p className="text-xs">Due: {fmtDate(r.deadline)}</p><div className="flex flex-wrap gap-1"><RiskBadges r={r} /></div><StatusSelect r={r} />{actions(r)}</Card>))}</div></div>); })}</div>
      )}
      {assign && <AssignModal recommenders={recommenders} apps={apps} recs={recs} onClose={() => setAssign(false)} onDone={() => { setAssign(false); onChanged(); }} />}
      {edit && <EditAssignmentModal rec={edit} recs={recs} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChanged(); }} />}
      {ai && recr(ai.recommender_id) && <RecAiModal rec={ai} recommender={recr(ai.recommender_id)!} app={app(ai.application_id)} onClose={() => setAi(null)} />}
    </div>
  );
}
