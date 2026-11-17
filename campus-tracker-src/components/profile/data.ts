'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import type { AchievementRow, EducationRow, GoalsRow, LeadershipRow, ProfileRow, TestRow, WorkRow } from '@/lib/profile';
import type { SchoolDataRow } from '@/lib/competitiveness';

export interface SnapshotRow { id: string; created_at: string; model: string | null; result: { dimensions?: { key: string; label: string; score: number | null; confidence: string | null }[]; narrative?: string } }
export interface ProfileData {
  profile: ProfileRow | null; education: EducationRow[]; tests: TestRow[]; work: WorkRow[]; leadership: LeadershipRow[]; achievements: AchievementRow[];
  goals: GoalsRow | null; schoolData: SchoolDataRow[]; snapshots: SnapshotRow[];
}

export async function currentUserId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error('You are signed out. Sign in again to save.');
  return data.user.id;
}

async function load(sb: SupabaseClient): Promise<ProfileData> {
  const live = <T,>(t: string, order: string, asc = false) => must(sb.from(t).select('*').is('deleted_at', null).order(order, { ascending: asc, nullsFirst: false })) as Promise<T[]>;
  const [profile, education, tests, work, leadership, achievements, goals, sdata, snaps] = await Promise.all([
    must(sb.from('applicant_profiles').select('*').maybeSingle()) as Promise<ProfileRow | null>,
    live<EducationRow>('education_records', 'graduation_date'),
    live<TestRow>('test_scores', 'test_date'),
    live<WorkRow>('work_experiences', 'start_date'),
    live<LeadershipRow>('leadership_experiences', 'start_date'),
    live<AchievementRow>('achievements', 'achieved_on'),
    must(sb.from('career_goals').select('*').maybeSingle()) as Promise<GoalsRow | null>,
    must(sb.from('school_admissions_data').select('*, schools!inner(name, deleted_at)').is('schools.deleted_at', null)) as Promise<(SchoolDataRow & { schools: { name: string } })[]>,
    must(sb.from('ai_assessments').select('id, created_at, model, result').eq('kind', 'profile').order('created_at', { ascending: false }).limit(5)) as Promise<SnapshotRow[]>,
  ]);
  return { profile, education, tests, work, leadership, achievements, goals, snapshots: snaps, schoolData: sdata.map((r) => ({ ...r, school_name: r.schools.name })) };
}

export function useProfileData() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setData(await load(supabaseBrowser())); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
