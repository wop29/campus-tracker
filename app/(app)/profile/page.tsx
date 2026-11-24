'use client';
import { Suspense, useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { currentUserId, useProfileData } from '@/components/profile/data';
import type { Verification } from '@/components/profile/forms';
import { AchievementsTab, EducationTab, GoalsTab, LeadershipTab, NarrativeTab, PersonalTab, TestsTab, WorkTab } from '@/components/profile/sections';
import { CompetitivenessPanel, CompletenessPanel } from '@/components/profile/summary';
import { ProgressPanel } from '@/components/profile/progress';
import { parseOnboarding } from '@/lib/onboarding';
import { SECTION_LABEL, type SectionKey } from '@/lib/profile';

type Tab = 'progress' | 'summary' | 'competitiveness' | SectionKey;
// Main tabs are the few things everyone needs. The rest are optional extras, shown smaller so they do not overwhelm.
const MAIN: { key: Tab; label: string }[] = [
  { key: 'progress', label: 'My progress' },
  ...(['personal', 'education', 'tests', 'work', 'goals'] as SectionKey[]).map((k) => ({ key: k as Tab, label: SECTION_LABEL[k] })),
];
const EXTRA: { key: Tab; label: string }[] = [
  ...(['leadership', 'achievements', 'narrative'] as SectionKey[]).map((k) => ({ key: k as Tab, label: SECTION_LABEL[k] })),
  { key: 'summary', label: 'Completeness' }, { key: 'competitiveness', label: 'Competitiveness' },
];
const TABS = [...MAIN, ...EXTRA];

function ProfileInner() {
  const router = useRouter(); const sp = useSearchParams();
  const tab = (TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'progress') as Tab;
  const { data, error, loading, reload } = useProfileData();
  // Undergrad applicants rarely have work history, so it moves to the optional extras for them.
  const track = parseOnboarding(data?.profile?.settings).track;
  const main = track === 'undergrad' ? MAIN.filter((t) => t.key !== 'work') : MAIN;
  const extra = track === 'undergrad' ? [MAIN.find((t) => t.key === 'work')!, ...EXTRA] : EXTRA;
  const [local, setLocal] = useState<Record<string, boolean> | null>(null);
  const latest = useRef<Record<string, boolean>>({}); latest.current = local ?? data?.profile?.field_verification ?? {};
  const setTab = (k: Tab) => router.replace(`/profile?tab=${k}`);

  const toggle = useCallback(async (key: string, on: boolean) => {
    const next = { ...latest.current, [key]: on }; if (!on) delete next[key];
    const sb = supabaseBrowser();
    await must(sb.from('applicant_profiles').upsert({ user_id: await currentUserId(sb), field_verification: next }, { onConflict: 'user_id' }).select('id'));
    setLocal(next); await reload();
  }, [reload]);
  const reloadAll = useCallback(async () => { await reload(); }, [reload]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Could not load your profile'} onRetry={() => void reload()} />;
  const ver: Verification = { map: local ?? data.profile?.field_verification ?? {}, toggle };
  const props = { data, ver, reload: reloadAll };
  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your progress, plus the basics schools ask for. Fill in what you have, skip the rest." />
      <div className="mb-2 flex flex-wrap gap-1 border-b" role="tablist">
        {main.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-accent font-medium text-primary' : 'border-transparent text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1 text-xs" role="tablist" aria-label="Optional extras">
        <span className="mr-1 text-secondary">Optional extras:</span>
        {extra.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('rounded-full border px-2.5 py-1', tab === t.key ? 'border-accent font-medium text-primary' : 'text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'progress' && <ProgressPanel />}
        {tab === 'summary' && <CompletenessPanel data={data} onOpen={(k) => setTab(k)} />}
        {tab === 'competitiveness' && <CompetitivenessPanel data={data} reload={reloadAll} />}
        {tab === 'personal' && <PersonalTab {...props} />}
        {tab === 'education' && <EducationTab {...props} />}
        {tab === 'tests' && <TestsTab {...props} />}
        {tab === 'work' && <WorkTab {...props} />}
        {tab === 'leadership' && <LeadershipTab {...props} />}
        {tab === 'achievements' && <AchievementsTab {...props} />}
        {tab === 'goals' && <GoalsTab {...props} />}
        {tab === 'narrative' && <NarrativeTab {...props} />}
      </div>
    </div>
  );
}
export default function ProfilePage() { return <Suspense fallback={<Loading />}><ProfileInner /></Suspense>; }
