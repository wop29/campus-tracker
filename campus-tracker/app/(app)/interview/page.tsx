'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loading, PageHeader } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { QuestionBank } from '@/components/interview/question-bank';
import { MockInterview } from '@/components/interview/mock-interview';
import { PastSessions } from '@/components/interview/sessions';
import { Performance } from '@/components/interview/performance';
import { RealInterviews } from '@/components/interview/real-interviews';
import type { School } from '@/components/interview/shared';

const TABS = [['bank', 'Question bank'], ['mock', 'Mock interview'], ['past', 'Past sessions'], ['performance', 'Performance']] as const;
type Tab = (typeof TABS)[number][0];
function Inner() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(sp.get('tab') === 'mock' ? 'mock' : 'bank');
  const [schoolId, setSchoolId] = useState(sp.get('school') ?? '');
  const [practice, setPractice] = useState<string[] | null>(null);
  const [rk, setRk] = useState(0);
  const schools = useQuery<School[]>((sb) => sb.from('schools').select('id,name').is('deleted_at', null).order('name'));
  const list = schools.data ?? [];
  return (
    <div>
      <PageHeader title="Interview Preparation" subtitle="Practice with your own questions and AI practice questions. AI questions are never presented as questions a school really asks." />
      <section className="mb-5"><h2 className="mb-2 text-sm font-semibold">Scheduled interviews</h2><RealInterviews schools={list} onPrep={(id) => { setSchoolId(id); setTab('bank'); }} /></section>
      <div className="mb-4 flex flex-wrap gap-1 border-b" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-accent font-medium' : 'border-transparent text-secondary hover:text-primary')}>{l}</button>)}
      </div>
      {tab === 'bank' && <QuestionBank schools={list} schoolId={schoolId} setSchoolId={setSchoolId} onPractice={(ids) => { setPractice(ids); setTab('mock'); }} />}
      {tab === 'mock' && <MockInterview schools={list} schoolId={schoolId} setSchoolId={setSchoolId} practiceIds={practice} clearPractice={() => setPractice(null)} onChanged={() => setRk((n) => n + 1)} />}
      {tab === 'past' && <PastSessions schools={list} refreshKey={rk} onChanged={() => setRk((n) => n + 1)} />}
      {tab === 'performance' && <Performance refreshKey={rk} />}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
