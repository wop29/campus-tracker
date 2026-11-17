'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { Button, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { EMPTY_FILTERS, VIEWS, enrich, filterApps, parseQuick, parseView, sortApps, type AppListRow, type Enriched, type ListFilters, type School, type SortKey, type Task } from '@/lib/applications';
import { ApplicationDialog } from '@/components/applications/create-dialog';
import { FilterBar, PipelineView, TableView, schoolLabel } from '@/components/applications/list-views';
import { TasksPanel } from '@/components/applications/tasks-panel';
import { DecisionsView } from '@/components/applications/decisions-view';
import { useAction, useWeights } from '@/components/applications/data';

const VIEW_LABEL = { pipeline: 'Pipeline', table: 'Table', tasks: 'Tasks', decisions: 'Offer comparison' } as const;

function ApplicationsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const view = parseView(sp.get('view'));
  const quickParam = parseQuick(sp.get('filter'));
  const newSchool = sp.get('new');
  const { weights } = useWeights();
  const [f, setF] = useState<ListFilters>({ ...EMPTY_FILTERS, quick: quickParam });
  const [sort, setSort] = useState<SortKey>('deadline');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [dialog, setDialog] = useState<{ open: boolean; editing: Enriched | null; school: string | null }>({ open: false, editing: null, school: null });
  const { busy, run } = useAction();

  useEffect(() => { setF((s) => (s.quick === quickParam ? s : { ...s, quick: quickParam })); }, [quickParam]);

  const apps = useQuery<AppListRow[]>((sb) => sb.from('applications')
    .select('*, school:schools(id,name,short_name,country,tier), deadlines(id,application_id,name,due_at,timezone,kind,is_primary), application_requirements(id,name,category,status,mandatory), decision:admissions_decisions(decision)')
    .is('deleted_at', null).order('created_at', { ascending: false }) as never);
  const schools = useQuery<School[]>((sb) => sb.from('schools').select('id,name,short_name,country,tier').is('deleted_at', null).order('name') as never);
  const tasks = useQuery<Task[]>((sb) => sb.from('application_tasks').select('*').order('created_at', { ascending: false }) as never);

  const rows = useMemo(() => (apps.data ?? []).map((r) => enrich({ ...r, decision: Array.isArray(r.decision) ? (r.decision[0] ?? null) : r.decision }, weights)), [apps.data, weights]);
  const shown = useMemo(() => sortApps(filterApps(rows, f), sort, dir), [rows, f, sort, dir]);
  const taskApps = useMemo(() => rows.map((r) => ({ id: r.id, label: `${schoolLabel(r)} · ${r.program}${r.round ? ` · ${r.round}` : ''}` })), [rows]);

  // ?new=<schoolId> opens the create dialog once the schools are known
  useEffect(() => {
    if (newSchool && schools.data && !dialog.open) setDialog({ open: true, editing: null, school: newSchool });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSchool, schools.data]);

  const go = (params: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) { if (v) q.set(k, v); else q.delete(k); }
    router.replace(`/applications${q.toString() ? `?${q}` : ''}`);
  };
  const closeDialog = () => { setDialog({ open: false, editing: null, school: null }); if (newSchool) go({ new: null }); };
  const setFilters = (next: ListFilters) => { setF(next); if (next.quick !== f.quick) go({ filter: next.quick === 'all' ? null : next.quick }); };
  async function del(r: Enriched) {
    if (await run(async () => { await must(supabaseBrowser().from('applications').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)); }, 'Application deleted')) void apps.reload();
  }

  const listView = view === 'pipeline' || view === 'table';
  return (
    <div>
      <PageHeader title="Applications" subtitle="Track every application from research to decision."
        actions={<Button onClick={() => setDialog({ open: true, editing: null, school: null })}><Plus size={14} /> New application</Button>} />
      <nav className="mb-4 flex gap-1 border-b" aria-label="Application views">
        {VIEWS.map((v) => (
          <Link key={v} href={v === 'pipeline' ? '/applications' : `/applications?view=${v}`} aria-current={view === v ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v ? 'border-primary font-medium' : 'border-transparent text-secondary hover:text-primary'}`}>{VIEW_LABEL[v]}</Link>
        ))}
      </nav>
      {listView && (apps.loading && !apps.data ? <Loading /> : apps.error ? <ErrorBox message={apps.error} onRetry={apps.reload} /> : !rows.length ? (
        <EmptyState title="No applications yet" hint={schools.data?.length ? 'Create your first application from one of your schools.' : 'Add schools in the School Portfolio first, then create an application.'}
          action={schools.data?.length ? <Button onClick={() => setDialog({ open: true, editing: null, school: null })}>New application</Button> : <Link href="/schools" className="text-sm underline">Go to School Portfolio</Link>} />
      ) : (
        <>
          <FilterBar rows={rows} f={f} setF={setFilters} sort={sort} setSort={setSort} dir={dir} setDir={setDir} />
          {view === 'pipeline' ? <PipelineView rows={shown} /> : <TableView rows={shown} onEdit={(r) => setDialog({ open: true, editing: r, school: null })} onDelete={(r) => { if (!busy) void del(r); }} />}
        </>
      ))}
      {view === 'tasks' && (tasks.loading && !tasks.data ? <Loading /> : tasks.error ? <ErrorBox message={tasks.error} onRetry={tasks.reload} /> : <TasksPanel tasks={tasks.data ?? []} apps={taskApps} reload={() => void tasks.reload()} />)}
      {view === 'decisions' && <DecisionsView />}
      <ApplicationDialog open={dialog.open} onClose={closeDialog} schools={schools.data ?? []} presetSchoolId={dialog.school} editing={dialog.editing}
        onSaved={(id) => { void apps.reload(); if (!dialog.editing) router.push(`/applications/${id}`); }} />
    </div>
  );
}

export default function Page() { return <Suspense fallback={<Loading />}><ApplicationsPage /></Suspense>; }
