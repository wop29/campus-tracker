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
import { parseOnboarding } from '@/lib/onboarding';
import { sectionLabels, type SectionKey } from '@/lib/profile';

type Tab = 'summary' | 'competitiveness' | SectionKey;
type TabDef = { key: Tab; label: string };
// Main tabs are the few things everyone needs. The rest are optional extras, shown smaller so they do not overwhelm.
// Undergrads rarely have work history, so it moves to the extras, and activities move up to the main tabs.
function tabsFor(track: 'grad' | 'undergrad', program?: 'mba' | 'masters' | 'phd'): { main: TabDef[]; extra: TabDef[] } {
  const L = sectionLabels(track, program); const sec = (k: SectionKey): TabDef => ({ key: k, label: L[k] });
  const tail: TabDef[] = [{ key: 'summary', label: 'Completeness' }, { key: 'competitiveness', label: 'Competitiveness' }];
  if (track === 'undergrad') return { main: [...(['goals', 'education', 'tests', 'leadership', 'personal'] as SectionKey[]).map(sec)], extra: [...(['achievements', 'narrative', 'work'] as SectionKey[]).map(sec), ...tail] };
  return { main: [...(['goals', 'work', 'education', 'tests', 'personal'] as SectionKey[]).map(sec)], extra: [...(['leadership', 'achievements', 'narrative'] as SectionKey[]).map(sec), ...tail] };
}
const TAB_KEYS: Tab[] = ['summary', 'competitiveness', 'personal', 'education', 'tests', 'work', 'leadership', 'achievements', 'goals', 'narrative'];

function ProfileInner() {
  const router = useRouter(); const sp = useSearchParams();
  const tab = (TAB_KEYS.find((k) => k === sp.get('tab')) ?? 'goals') as Tab;
  const { data, error, loading, reload } = useProfileData();
  const ob = parseOnboarding(data?.profile?.settings);
  const { main, extra } = tabsFor(ob.track, ob.program);
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
      <PageHeader title="Your story" subtitle="Optional. The answers schools ask for again and again, kept in one place so you can copy them into your essays. Fill in what you like, skip the rest." />
      <div className="mb-2 flex flex-wrap gap-1 border-b" role="tablist">
        {main.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-accent font-medium text-primary' : 'border-transparent text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1 text-xs" role="tablist" aria-label="Optional extras">
        <span className="mr-1 text-secondary">Optional extras:</span>
        {extra.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('rounded-full border px-2.5 py-1', tab === t.key ? 'border-accent font-medium text-primary' : 'text-secondary hover:text-primary')}>{t.label}</button>)}
      </div>
      <div role="tabpanel">
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
