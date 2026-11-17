'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { Badge, Button, ConfirmButton, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { STAGE_LABEL } from '@/lib/constants';
import { type School } from '@/lib/applications';
import { ApplicationDialog } from '@/components/applications/create-dialog';
import { loadBundle, useAction, useWeights, type Bundle } from '@/components/applications/data';
import { OverviewTab } from '@/components/applications/tab-overview';
import { DeadlinesTab } from '@/components/applications/tab-deadlines';
import { RequirementsTab } from '@/components/applications/tab-requirements';
import { ReadinessTab } from '@/components/applications/tab-readiness';
import { TasksPanel } from '@/components/applications/tasks-panel';
import { SubmissionTab } from '@/components/applications/tab-submission';
import { PostSubmissionTab } from '@/components/applications/tab-post';
import { DecisionTab } from '@/components/applications/tab-decision';

const TABS = [['overview', 'Overview'], ['deadlines', 'Deadlines'], ['requirements', 'Requirements'], ['readiness', 'Readiness'], ['tasks', 'Tasks'], ['submission', 'Final review & submission'], ['post', 'Post-submission'], ['decision', 'Decision']] as const;

function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab')! : 'overview';
  const [b, setB] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const { weights, custom, reload: reloadWeights } = useWeights();
  const schools = useQuery<School[]>((sb) => sb.from('schools').select('id,name,short_name,country,tier').is('deleted_at', null).order('name') as never);
  const { run } = useAction();

  const load = useCallback(async () => {
    try { setB(await loadBundle(id)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  const goTab = (t: string) => router.replace(`/applications/${id}?tab=${t}`);
  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!b) return <EmptyState title="Application not found" hint="It may have been deleted." action={<Link href="/applications" className="text-sm underline">Back to applications</Link>} />;
  const props = { b, reload: () => void load(), weights };

  return (
    <div>
      <Link href="/applications" className="mb-2 inline-flex items-center gap-1 text-xs text-secondary hover:text-primary"><ArrowLeft size={12} /> Applications</Link>
      <PageHeader title={b.app.school?.name ?? 'Application'} subtitle={`${b.app.program} · ${b.app.intake}${b.app.round ? ` · ${b.app.round}` : ''}`}
        actions={<>
          <Badge tone="accent" className="self-center">{STAGE_LABEL[b.app.stage]}</Badge>
          <Button variant="secondary" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</Button>
          <ConfirmButton variant="secondary" message="Delete this application? Its essays are kept. It will be hidden from your lists." onConfirm={() => void run(async () => { await must(supabaseBrowser().from('applications').update({ deleted_at: new Date().toISOString() }).eq('id', id)); }, 'Application deleted').then((ok) => { if (ok) router.push('/applications'); })}><Trash2 size={14} /> Delete</ConfirmButton>
        </>} />
      <div role="tablist" aria-label="Application sections" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => goTab(k)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-primary font-medium' : 'border-transparent text-secondary hover:text-primary'}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab {...props} goTab={goTab} />}
        {tab === 'deadlines' && <DeadlinesTab {...props} />}
        {tab === 'requirements' && <RequirementsTab {...props} />}
        {tab === 'readiness' && <ReadinessTab {...props} reloadWeights={reloadWeights} customWeights={custom} />}
        {tab === 'tasks' && <TasksPanel tasks={b.tasks} apps={[{ id: b.app.id, label: b.app.school?.name ?? 'This application' }]} fixedApplicationId={b.app.id} reload={props.reload} />}
        {tab === 'submission' && <SubmissionTab {...props} />}
        {tab === 'post' && <PostSubmissionTab {...props} goTab={goTab} />}
        {tab === 'decision' && <DecisionTab {...props} />}
      </div>
      <ApplicationDialog open={edit} onClose={() => setEdit(false)} schools={schools.data ?? []} editing={b.app} onSaved={() => void load()} />
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading />}><Detail /></Suspense>; }
