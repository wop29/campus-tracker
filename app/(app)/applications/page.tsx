'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { School, Task } from '@/lib/applications';
import { ApplicationDialog } from '@/components/applications/create-dialog';
import { ApplicationList } from '@/components/applications/app-list';
import { ApplicationDetail } from '@/components/applications/app-detail';
import { APP_SELECT, buildViews, type AppRow, type EssayDraftRow } from '@/components/applications/view-model';
import { TasksPanel } from '@/components/applications/tasks-panel';
import { DecisionsView } from '@/components/applications/decisions-view';
import { useAction } from '@/components/applications/data';

const findLink = 'btn-3d inline-flex items-center justify-center rounded-2xl border-2 border-b-4 border-fun-green-dark bg-fun-green px-4 py-2.5 text-sm font-bold text-on-fun';
const BackLink = () => <Link href="/applications" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-secondary hover:text-ink"><ArrowLeft size={14} /> My applications</Link>;

function TasksView() {
  const tasks = useQuery<Task[]>((sb) => sb.from('application_tasks').select('*').order('created_at', { ascending: false }) as never);
  const apps = useQuery<{ id: string; program: string; round: string | null; school: { name: string; short_name: string | null } | null }[]>((sb) => sb.from('applications').select('id,program,round,school:schools(name,short_name)').is('deleted_at', null) as never);
  const labels = (apps.data ?? []).map((r) => ({ id: r.id, label: `${r.school?.short_name || r.school?.name || 'Unknown school'} · ${r.program}${r.round ? ` · ${r.round}` : ''}` }));
  return (
    <div>
      <BackLink />
      <PageHeader title="My tasks" subtitle="Small things to do that are not on a school checklist." />
      {tasks.loading && !tasks.data ? <Loading /> : tasks.error ? <ErrorBox message={tasks.error} onRetry={tasks.reload} /> : <TasksPanel tasks={tasks.data ?? []} apps={labels} reload={() => void tasks.reload()} />}
    </div>
  );
}

function ApplicationsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const picked = sp.get('a');
  const newSchool = sp.get('new');
  const [dialog, setDialog] = useState<{ open: boolean; editingId: string | null; school: string | null }>({ open: false, editingId: null, school: null });
  const { run } = useAction();

  const apps = useQuery<AppRow[]>((sb) => sb.from('applications').select(APP_SELECT).is('deleted_at', null).order('created_at', { ascending: false }) as never);
  const essays = useQuery<EssayDraftRow[]>((sb) => sb.from('essays').select('id,draft,word_limit,application_id').not('application_id', 'is', null).is('deleted_at', null) as never);
  const schools = useQuery<School[]>((sb) => sb.from('schools').select('id,name,short_name,country,tier').is('deleted_at', null).order('name') as never);

  const views = useMemo(() => buildViews(apps.data ?? [], essays.data ?? []), [apps.data, essays.data]);
  const selected = views.find((v) => v.row.id === picked) ?? views[0] ?? null;
  const reload = () => { void apps.reload(); void essays.reload(); };

  // ?new=<schoolId> opens the add dialog once the schools are known
  useEffect(() => {
    if (newSchool && schools.data && !dialog.open) setDialog({ open: true, editingId: null, school: newSchool });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSchool, schools.data]);
  const closeDialog = () => { setDialog({ open: false, editingId: null, school: null }); if (newSchool) router.replace(picked ? `/applications?a=${picked}` : '/applications'); };
  async function del(id: string) {
    if (await run(async () => { await must(supabaseBrowser().from('applications').update({ deleted_at: new Date().toISOString() }).eq('id', id)); }, 'Application deleted')) { router.replace('/applications'); void apps.reload(); }
  }

  const dialogEl = (
    <ApplicationDialog open={dialog.open} onClose={closeDialog} schools={schools.data ?? []} presetSchoolId={dialog.school}
      editing={dialog.editingId ? views.find((v) => v.row.id === dialog.editingId)?.row ?? null : null}
      onSaved={(id) => { reload(); if (!dialog.editingId) router.replace(`/applications?a=${id}`); }} />
  );
  if (apps.loading && !apps.data) return <Loading />;
  if (apps.error) return <ErrorBox message={apps.error} onRetry={apps.reload} />;
  if (!views.length || !selected) {
    return (
      <div>
        <EmptyState mascot title="No applications yet" hint="Find a university you like, then add it here. We will build the checklist for you."
          action={<Link href="/schools" className={findLink}>Find universities</Link>} />
        {dialogEl}
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-[1216px] flex-col items-start gap-7 lg:flex-row">
      {/* On a phone, opening an application shows it on its own with a way back to the list. */}
      <ApplicationList views={views} selectedId={selected.row.id} className={picked ? 'hidden lg:flex' : 'flex'} />
      <div className="flex w-full min-w-0 flex-1 flex-col">
        {picked && <div className="lg:hidden"><BackLink /></div>}
        <ApplicationDetail key={selected.row.id} v={selected} reload={reload} onEdit={() => setDialog({ open: true, editingId: selected.row.id, school: null })} onDelete={() => void del(selected.row.id)} />
      </div>
      {dialogEl}
    </div>
  );
}

function Switch() {
  const view = useSearchParams().get('view');
  if (view === 'tasks') return <TasksView />;
  if (view === 'decisions') return <div><BackLink /><PageHeader title="Compare your offers" subtitle="Weigh the schools that said yes, side by side." /><DecisionsView /></div>;
  return <ApplicationsPage />;
}
export default function Page() { return <Suspense fallback={<Loading />}><Switch /></Suspense>; }
