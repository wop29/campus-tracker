'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader, Loading } from '@/components/ui';
import { COACH_MODES, COACH_MODE_LABEL, type CoachMode } from '@/lib/coach';
import { CoachChat } from '@/components/coach/coach-chat';
import { Assessments } from '@/components/coach/assessments';
import { cn } from '@/lib/utils';

type Tab = CoachMode | 'assess';
function Inner() {
  const sp = useSearchParams();
  const m = sp.get('mode');
  const [tab, setTab] = useState<Tab>(m === 'assess' ? 'assess' : (COACH_MODES as readonly string[]).includes(m ?? '') ? (m as CoachMode) : 'strategist');
  const initial = { schoolId: sp.get('school') ?? undefined, applicationId: sp.get('application') ?? undefined, essayId: sp.get('essay') ?? undefined };
  const tabs: { key: Tab; label: string }[] = [...COACH_MODES.map((k) => ({ key: k, label: COACH_MODE_LABEL[k] })), { key: 'assess', label: 'Assessments' }];
  return (
    <div>
      <PageHeader title="AI Admissions Coach" subtitle="Grounded in the records you entered. AI output is never verified and never an official evaluation." />
      <div className="mb-4 flex flex-wrap gap-1 border-b" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-accent font-medium text-primary' : 'border-transparent text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      {tab === 'assess' ? <Assessments /> : <CoachChat key={tab} mode={tab} initial={initial} />}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
